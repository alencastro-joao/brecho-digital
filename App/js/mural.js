// Mural de Tarefas: missões em post-its que chegam de tempos em tempos (regras
// em MURAL, config.js). Cada missão tem um nível (o prêmio), um prazo e, às
// vezes, um alvo sorteado do acervo — uma cor, um tipo ou os dois. A tela
// avisa o que aconteceu com contar() e contarJogo(); quem desenha é tarefas.js.
//
// state.mural = {
//   missoes: [{ uid, id, nivel, meta, feito, alvo: { cor?, cat? }, dourada, chegou, vence, pega? }],
//   proxima: ms da próxima chegada,
//   jogo: { jogo, meta, feito, fichas, pega? } | null,   // a missão de jogo
//   jogoVolta: ms em que a próxima missão de jogo chega,
// }

import { MURAL, BAUS, migrarCategoria } from './config.js';
import { catalogo, item as pecaDoCatalogo } from './catalog.js';
import * as db from './db.js';

const HORA = 3600e3;
export const VAGAS = MURAL.vagas - 1;     // uma vaga do mural é sempre a da missão de jogo
const MODELO = new Map(MURAL.missoes.map(m => [m.id, m]));
export const modeloDe = (m) => MODELO.get(m.id);

// --- Português: o nome do tipo e a cor concordando com ele -----------------
const TIPOS = {
  shoes: ['sapato', 'sapatos', 'm'], pants: ['calça', 'calças', 'f'], shorts: ['bermuda', 'bermudas', 'f'],
  skirts: ['saia', 'saias', 'f'], dresses: ['vestido', 'vestidos', 'm'], shirts: ['camisa', 'camisas', 'f'],
  coats: ['casaco', 'casacos', 'm'], cropped: ['top', 'tops', 'm'], watches: ['relógio', 'relógios', 'm'],
  bracelets: ['pulseira', 'pulseiras', 'f'], necklaces: ['colar', 'colares', 'm'], glasses: ['óculos', 'óculos', 'm'],
  hats: ['chapéu', 'chapéus', 'm'], bags: ['bolsa', 'bolsas', 'f'], belts: ['cinto', 'cintos', 'm'],
};
const SEM_PLURAL = new Set(['cinza', 'bege', 'rosa', 'laranja']);
function cor(nome, genero = 'f', plural = false) {
  let c = nome.toLowerCase();
  if (c.endsWith('o')) c = c.slice(0, -1) + (genero === 'f' ? 'a' : 'o');
  if (!plural || SEM_PLURAL.has(c)) return c;
  if (c.endsWith('l')) return c.slice(0, -1) + 'is';       // azul → azuis
  if (c.endsWith('m')) return c.slice(0, -1) + 'ns';       // marrom → marrons
  return c + 's';
}
// "1 peça azul", "2 calças", "um casaco preto"
function coisa(alvo, n, { artigo = false } = {}) {
  const [um, varios, g] = alvo.cat ? TIPOS[alvo.cat] ?? ['peça', 'peças', 'f'] : ['peça', 'peças', 'f'];
  const nome = n > 1 ? varios : um;
  const qtd = artigo ? (g === 'f' ? 'uma' : 'um') : String(n);
  return [qtd, nome, alvo.cor ? cor(alvo.cor, g, n > 1) : null].filter(Boolean).join(' ');
}

export function textoDa(m) {
  const md = modeloDe(m);
  if (!md) return '';
  const a = m.alvo || {};
  switch (md.evento) {
    case 'curtir': return `Curtir ${m.meta} posts`;
    case 'garimpar': return md.raridade ? 'Garimpar 1 peça épica' : `Garimpar ${coisa(a, m.meta)}`;
    case 'publicar': return `Publicar ${m.onde === 'colagem' ? 'uma colagem' : 'um look'} com ${coisa(a, 1, { artigo: true })}`;
    case 'look': return md.mesma ? `Publicar um look com ${m.meta} peças da mesma cor` : `Publicar um look com ${coisa(a, 1, { artigo: true })}`;
    case 'colagem': return md.mesma ? `Publicar uma colagem com ${m.meta} peças da mesma cor` : `Publicar uma colagem com ${coisa(a, 1, { artigo: true })}`;
    default: return '';
  }
}

// Onde se cumpre cada missão: tocar no post-it leva para lá.
export function telaDa(m) {
  const md = modeloDe(m);
  const ev = md?.evento === 'publicar' ? m.onde || 'look' : md?.evento;
  return { curtir: 'social', garimpar: 'vitrine', look: 'stylist', colagem: 'board' }[ev] || null;
}

export const NOMES_JOGO = { avaliar: 'Avaliar', ajustar: 'Ajustar', preencher: 'Preencher' };
export const textoDoJogo = (j) => j.jogo === 'preencher'
  ? `Preencher ${j.meta} campos` : `${NOMES_JOGO[j.jogo]} ${j.meta} peças`;

// --- Sorteio ---------------------------------------------------------------
const umDe = (lista) => lista[Math.floor(Math.random() * lista.length)];
function porChance(pesos) {
  const total = Object.values(pesos).reduce((t, p) => t + p, 0);
  let r = Math.random() * total;
  for (const [k, p] of Object.entries(pesos)) if ((r -= p) < 0) return k;
  return Object.keys(pesos)[0];
}

// Peças do acervo com cor e tipo: o alvo sai delas, então sempre existe.
const pecasComAlvo = () => catalogo.itens.filter(i => i.cor && TIPOS[migrarCategoria(i.cat)]);

function alvoPara(md) {
  if (!md.filtro) return {};
  const p = umDe(pecasComAlvo());
  if (!p) return null;
  const alvo = {};
  if (md.filtro.includes('cor')) alvo.cor = p.cor;
  if (md.filtro.includes('cat')) alvo.cat = migrarCategoria(p.cat);
  return alvo;
}

function novaMissao(chegou, ocupadas) {
  const nivel = porChance(Object.fromEntries(Object.entries(MURAL.niveis).map(([k, n]) => [k, n.chance])));
  // Sem repetir o que já está no mural (mesmo modelo e mesmo alvo).
  for (let tentativa = 0; tentativa < 12; tentativa++) {
    const md = umDe(MURAL.missoes.filter(m => m.nivel === nivel));
    const alvo = alvoPara(md);
    if (!alvo) continue;
    const chave = md.id + JSON.stringify(alvo);
    if (ocupadas.has(chave)) continue;
    return {
      uid: chegou.toString(36) + Math.random().toString(36).slice(2, 5),
      id: md.id, nivel, meta: md.meta, feito: 0, alvo,
      // 'publicar' sorteia onde: look ou colagem.
      ...(md.evento === 'publicar' ? { onde: umDe(['look', 'colagem']) } : {}),
      dourada: Math.random() * 100 < MURAL.dourada,
      chegou, vence: chegou + MURAL.duraHoras * HORA,
    };
  }
  return null;
}

const fichasDoJogo = (jogo, meta) => Math.max(1, Math.round(meta / MURAL.jogos[jogo].cada * MURAL.jogos[jogo].fichas));

function novoJogo(jogos = Object.keys(NOMES_JOGO)) {
  const jogo = umDe(jogos);
  const meta = umDe(MURAL.jogos[jogo].metas);
  return { jogo, meta, feito: 0, fichas: fichasDoJogo(jogo, meta) };
}

// Os jogos só têm as peças que o admin mandou da esteira: se o que dá para
// fazer agora (`livres`: jogo → quantas ajudas ainda cabem) não chega à meta,
// a meta desce até o que dá, e as fichas acompanham. Jogo sem nada para
// fazer troca por outro que tenha. Devolve se mudou.
export function caberNoQueTem(livres) {
  const j = mural().jogo;
  if (!j || j.feito >= j.meta) return false;
  const cabe = livres[j.jogo] ?? 0;
  if (cabe >= j.meta - j.feito) return false;
  if (cabe > 0 || j.feito > 0) {
    j.meta = j.feito + cabe;
    j.fichas = fichasDoJogo(j.jogo, j.meta);
  } else {
    const outros = Object.keys(NOMES_JOGO).filter(k => (livres[k] ?? 0) > 0);
    if (!outros.length) return false;
    const novo = novoJogo(outros);
    novo.meta = Math.min(novo.meta, livres[novo.jogo]);
    novo.fichas = fichasDoJogo(novo.jogo, novo.meta);
    mural().jogo = novo;
  }
  db.salvar();
  return true;
}

// --- Estado ----------------------------------------------------------------
function mural() {
  if (!db.state.mural) {
    // Conta nova (ou save de antes do mural): o mural já nasce com as missões
    // das últimas horas, como se estivesse aberto.
    db.state.mural = { missoes: [], proxima: Date.now() - 2 * MURAL.cadaHoras * HORA, jogo: null, jogoVolta: 0 };
  }
  return db.state.mural;
}

const chaveDe = (m) => m.id + JSON.stringify(m.alvo || {});
export const completa = (m) => m.feito >= m.meta;

// Põe o mural em dia: tira as vencidas (as feitas esperam o resgate), faz
// chegar as missões das horas que passaram e a de jogo, se for a hora.
// Devolve se mudou algo (quem chamou grava).
export function atualizar(agora = Date.now()) {
  const mu = mural();
  let mudou = false;
  const antes = mu.missoes.length;
  mu.missoes = mu.missoes.filter(m => m.vence > agora || (completa(m) && !m.pega));
  mu.missoes = mu.missoes.filter(m => !m.pega);
  if (mu.missoes.length !== antes) mudou = true;
  if (!catalogo.itens.length) return mudou;          // sem acervo ainda não dá para sortear alvo
  // Quem ficou dias fora não vê a fila inteira: só chega o que ainda não venceu.
  mu.proxima = Math.max(mu.proxima, agora - MURAL.duraHoras * HORA);
  while (mu.proxima <= agora) {
    if (mu.missoes.length < VAGAS) {
      const m = novaMissao(mu.proxima, new Set(mu.missoes.map(chaveDe)));
      if (m && m.vence > agora) mu.missoes.push(m);
    }
    mu.proxima += MURAL.cadaHoras * HORA;
    mudou = true;
  }
  if (!mu.jogo && agora >= mu.jogoVolta) { mu.jogo = novoJogo(); mudou = true; }
  return mudou;
}

export const missoes = () => { atualizar(); return mural().missoes; };
export const proximaChegada = () => mural().proxima;
export const missaoDeJogo = () => { atualizar(); return mural().jogo; };
export const voltaDoJogo = () => mural().jogoVolta;
export const prontas = () => missoes().filter(m => completa(m) && !m.pega).length
  + (missaoDeJogo() && mural().jogo.feito >= mural().jogo.meta ? 1 : 0);

// --- Progresso -------------------------------------------------------------
const pecaCombina = (p, alvo) => !!p
  && (!alvo.cor || p.cor === alvo.cor)
  && (!alvo.cat || migrarCategoria(p.cat) === alvo.cat);

// O maior grupo de peças com a mesma cor.
function maiorGrupoDeCor(pecas) {
  const n = {};
  for (const p of pecas) if (p.cor) n[p.cor] = (n[p.cor] || 0) + 1;
  return Math.max(0, ...Object.values(n));
}

// evento: 'curtir'; 'garimpar' com { peca, raridade }; 'look' ou 'colagem'
// com { ids } (as peças do post). Não grava: quem chamou já grava.
export function contar(evento, { peca = null, raridade = null, ids = [] } = {}) {
  atualizar();
  const pecas = ids.map(id => pecaDoCatalogo(id)).filter(Boolean);
  for (const m of mural().missoes) {
    if (completa(m) || m.vence <= Date.now()) continue;
    const md = modeloDe(m);
    if (!md) continue;
    if (md.evento === 'curtir' && evento === 'curtir') m.feito += 1;
    else if (md.evento === 'garimpar' && evento === 'garimpar') {
      const ok = md.raridade ? ['epic', 'legendary'].includes(raridade) : pecaCombina(peca, m.alvo);
      if (ok) m.feito += 1;
    } else if (md.evento === evento || (md.evento === 'publicar' && evento === (m.onde || evento))) {
      if (md.mesma) m.feito = Math.max(m.feito, Math.min(m.meta, maiorGrupoDeCor(pecas)));
      else if (pecas.some(p => pecaCombina(p, m.alvo))) m.feito = m.meta;
    }
    m.feito = Math.min(m.feito, m.meta);
  }
}

// Ajudas aceitas num jogo (no Preencher, os campos respondidos).
export function contarJogo(jogo, n = 1) {
  const j = mural().jogo;
  if (!j || j.jogo !== jogo || j.feito >= j.meta) return;
  j.feito = Math.min(j.meta, j.feito + n);
  db.salvar();
}

// --- Resgate ---------------------------------------------------------------
// Devolve { fichas, bau } do que pagou, ou null.
export function resgatar(uid) {
  const m = mural().missoes.find(x => x.uid === uid);
  if (!m || !completa(m) || m.pega) return null;
  const n = MURAL.niveis[m.nivel];
  m.pega = true;
  db.ganharFicha(n.fichas);
  if (m.dourada) db.guardarBau(n.bau, 'mural', 'Missão dourada');
  mural().missoes = mural().missoes.filter(x => x !== m);
  db.salvar();
  return { fichas: n.fichas, bau: m.dourada ? BAUS[n.bau].nome : null };
}

export function resgatarJogo() {
  const mu = mural();
  const j = mu.jogo;
  if (!j || j.feito < j.meta) return null;
  db.ganharFicha(j.fichas);
  mu.jogo = null;
  mu.jogoVolta = Date.now() + MURAL.jogos.esperaHoras * HORA;
  db.salvar();
  return { fichas: j.fichas };
}
