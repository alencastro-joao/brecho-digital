// Troca de peças entre amigas.
//
// Como funciona (regras do João, 04/11/2026; números em TROCAS, config.js):
//   1. Na ficha de uma peça de uma amiga aparece o botão Trocar.
//   2. Você marca de 1 a `maxOpcoes` peças suas da mesma raridade e envia.
//   3. Ela recebe no sino, escolhe uma das suas (ou recusa).
//   4. Aceitou: uma peça vai, a outra vem, e as duas pagam as fichas.
//
// Quem decide é o servidor (nuvem/lambda/trocas.py): ele confere a amizade, a
// raridade e quem é dona de cada cópia numerada, e troca as duas de dono numa
// transação só. O save só aplica o resultado: tira a peça que foi (e os looks
// e colagens que a usavam), põe a que veio e cobra ou devolve as fichas.
// Ofertas e respostas chegam relendo /api/trocas (no boot, de tempos em
// tempos e ao voltar para a aba): não há push.

import * as db from './db.js';
import { TROCAS, RARIDADE } from './config.js';
import { item as pecaDoCatalogo, nomeDaPeca, trocarImagem } from './catalog.js';
import { el, toast } from './util.js';
import { avisarTroca, aoTocarEmTroca } from './avisos.js';
import { esquecerHistorico } from './estoque.js';
import { tocar } from './sons.js';

const INTERVALO = 2 * 60e3;
const LETRA = { c: 'common', u: 'uncommon', r: 'rare', e: 'epic', l: 'legendary' };

let ultimas = [];             // a última leitura de /api/trocas
let online = true;

const registro = () => (db.state.trocas ??= { cobradas: {}, avisadas: [] });
export const custoDa = (raridade) => TROCAS.custo[raridade] ?? 0;
const handle = (h) => String(h || '').startsWith('@') ? h : '@' + h;

async function chamar(rota, corpo) {
  const r = await fetch(rota, {
    method: corpo ? 'POST' : 'GET',
    credentials: 'include',
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || 'Não consegui falar com o servidor.');
  return dados;
}

// ------------------------------- A peça dela -------------------------------
// A raridade da peça no guarda-roupa dela: uma letra por peça, na mesma ordem
// da lista (pessoas.js). Sem as letras (versão antiga do app dela), sem troca.
export function raridadeNaPagina(p, id) {
  const i = (p?.guardaRoupa || []).indexOf(id);
  return i < 0 ? null : LETRA[(p.raridades || '')[i]] || null;
}


// As minhas peças que servem: mesma raridade, numeradas e que ela não tem.
function minhasParaOferecer(raridade, p) {
  const dela = new Set(p?.guardaRoupa || []);
  return db.state.inventario.filter(x =>
    x.raridade === raridade && x.numero && !dela.has(x.id) && pecaDoCatalogo(x.id));
}

// Por que não dá para trocar (null = dá).
function bloqueio(peca, p) {
  const rar = raridadeNaPagina(p, peca.id);
  if (!p?.real || !rar) return 'Essa peça não pode ser trocada';
  if (!(p.voceSegue && p.segueVoce)) return 'Só entre amigos (um segue o outro)';
  if (db.nivel() < TROCAS.nivel) return `Libera no nível ${TROCAS.nivel}`;
  if (db.temPeca(peca.id)) return null;          // a ficha já diz que está no seu guarda-roupa
  if (!minhasParaOferecer(rar, p).length) return `Você não tem peça ${RARIDADE[rar].nome.toLowerCase()} para oferecer`;
  if (db.fichas() < custoDa(rar)) return `Faltam fichas (custa ${custoDa(rar)})`;
  return null;
}

// O botão da ficha. Apagado, ele diz o motivo; peça que você já tem não leva.
export function botaoTrocar(peca, p, { antes = null } = {}) {
  if (!p?.real || db.temPeca(peca.id) || !(p.guardaRoupa || []).includes(peca.id)) return null;
  const motivo = bloqueio(peca, p);
  return el('button', {
    type: 'button', class: 'btn-dark troca-btn',
    disabled: motivo ? true : null,
    title: motivo || 'Oferecer uma troca',
    onclick: (e) => {
      e.stopPropagation();
      if (motivo) return toast(motivo);
      antes?.();
      abrirProposta(peca, p);
    },
  }, '⇄ ', motivo ? el('small', {}, motivo) : 'Trocar');
}

// --------------------------------- Janelas ---------------------------------
function janela(...conteudo) {
  const caixa = el('div', { class: 'modal-caixa pergunta-caixa troca-caixa', role: 'dialog', 'aria-modal': 'true' }, ...conteudo);
  const fundo = el('div', { class: 'modal pergunta troca-janela' }, caixa);
  const tinha = document.body.classList.contains('com-modal');
  const fechar = () => {
    fundo.remove();
    document.removeEventListener('keydown', tecla, true);
    if (!tinha && !document.querySelector('.modal:not([hidden])')) document.body.classList.remove('com-modal');
  };
  const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } };
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  document.addEventListener('keydown', tecla, true);
  document.body.append(fundo);
  document.body.classList.add('com-modal');
  tocar('janela');
  return { caixa, fechar };
}

function figura(copia, { rotulo = '', classe = '' } = {}) {
  const peca = pecaDoCatalogo(copia.id);
  const img = el('img', { alt: peca ? nomeDaPeca(peca) : '', loading: 'lazy' });
  if (peca) trocarImagem(img, peca, 220);
  const r = RARIDADE[copia.raridade];
  return el('div', { class: 'troca-fig ' + classe, style: { '--rar': r?.aura && r.aura !== 'arco-iris' ? r.aura : r?.cor || '#ccc' } },
    img,
    el('span', { class: 'troca-fig-nome' }, peca ? nomeDaPeca(peca) : 'Peça'),
    el('small', {}, [r?.nome, copia.numero ? `nº ${copia.numero}` : ''].filter(Boolean).join(' · ')),
    rotulo ? el('em', {}, rotulo) : null);
}

// Uma grade de peças para escolher: `max` 1 é escolha única.
function grade(copias, max, aoMudar) {
  const marcadas = new Set();
  const botoes = copias.map((c, i) => {
    const b = el('button', { type: 'button', class: 'troca-opcao', 'aria-pressed': 'false' }, figura(c));
    b.addEventListener('click', () => {
      if (marcadas.has(i)) marcadas.delete(i);
      else {
        if (max === 1) marcadas.clear();
        if (marcadas.size >= max) return toast(`No máximo ${max} peças.`);
        marcadas.add(i);
      }
      botoes.forEach((x, j) => x.setAttribute('aria-pressed', String(marcadas.has(j))));
      aoMudar([...marcadas]);
    });
    return b;
  });
  return el('div', { class: 'troca-grade' }, ...botoes);
}

const linhaDeCusto = (rar) =>
  el('p', { class: 'troca-custo' }, `Custa ${custoDa(rar)} ficha${custoDa(rar) === 1 ? '' : 's'} para cada um · você tem ${db.fichas()}`);

// ------------------------------ Propor (Ana) -------------------------------
export function abrirProposta(peca, p) {
  const rar = raridadeNaPagina(p, peca.id);
  const minhas = minhasParaOferecer(rar, p);
  let escolhidas = [];
  const enviar = el('button', { type: 'button', class: 'btn-dark', disabled: true }, 'Enviar');
  const { fechar } = janela(
    el('h2', { class: 'pergunta-titulo' }, 'Propor troca'),
    figura({ id: peca.id, raridade: rar }, { rotulo: `de ${handle(p.handle)}`, classe: 'troca-alvo' }),
    el('p', { class: 'pergunta-texto' },
      `Marque até ${TROCAS.maxOpcoes} peças suas da mesma raridade. ${handle(p.handle)} escolhe uma delas.`),
    grade(minhas, TROCAS.maxOpcoes, (lista) => { escolhidas = lista; enviar.disabled = !lista.length; }),
    linhaDeCusto(rar),
    el('div', { class: 'pergunta-botoes' },
      el('button', { type: 'button', class: 'btn-ghost', onclick: () => fechar() }, 'Cancelar'),
      enviar));
  enviar.addEventListener('click', async () => {
    const custo = custoDa(rar);
    if (db.fichas() < custo) return toast(`Faltam fichas: a troca custa ${custo}.`);
    enviar.disabled = true;
    try {
      const { troca } = await chamar('/api/trocas', {
        para: p.id, quero: { id: peca.id, raridade: rar },
        opcoes: escolhidas.map(i => minhas[i]).map(c => ({
          id: c.id, raridade: c.raridade, numero: c.numero,
          origem: c.origem || 'vitrine', desde: c.obtidoEm })),
      });
      db.state.fichas = db.fichas() - custo;
      registro().cobradas[troca.id] = custo;
      db.salvar();
      ultimas = [troca, ...ultimas.filter(t => t.id !== troca.id)];
      fechar();
      toast(`Oferta enviada para ${handle(p.handle)}.`, 'ok');
    } catch (e) {
      enviar.disabled = false;
      toast(e.message, 'erro');
    }
  });
}

// --------------------------- A oferta (as duas) ----------------------------
export async function abrirOferta(trocaId) {
  let t = ultimas.find(x => x.id === trocaId);
  if (!t || t.estado === 'aberta') { await sincronizarTrocas(); t = ultimas.find(x => x.id === trocaId) || t; }
  if (!t) return toast('Essa troca não está mais aqui.');
  if (t.souEu === 'para' && t.estado === 'aberta') return janelaDeResposta(t);
  const outra = t.souEu === 'de' ? t.para.handle : t.de.handle;
  const texto = {
    aberta: `Esperando ${outra} escolher.`,
    feita: 'Troca feita.',
    recusada: `${outra} recusou. As fichas voltaram.`,
    cancelada: 'Oferta cancelada.',
    vencida: 'A oferta venceu sem resposta.',
    invalida: `A troca não deu certo${t.motivo ? ': ' + t.motivo : ''}.`,
  }[t.estado] || '';
  const acoes = el('div', { class: 'pergunta-botoes' });
  const { fechar } = janela(
    el('h2', { class: 'pergunta-titulo' }, t.souEu === 'de' ? `Sua oferta para ${outra}` : `Oferta de ${outra}`),
    figura(t.quero, { classe: 'troca-alvo', rotulo: t.souEu === 'de' ? 'a peça que você pediu' : 'a sua peça' }),
    el('p', { class: 'pergunta-texto' }, texto),
    el('div', { class: 'troca-grade' }, ...t.opcoes.map((c, i) =>
      figura(c, { classe: t.escolhida === i ? 'escolhida' : '' }))),
    acoes);
  if (t.souEu === 'de' && t.estado === 'aberta') {
    acoes.append(el('button', {
      type: 'button', class: 'btn-dark perigo',
      onclick: async () => {
        try {
          guardar((await chamar(`/api/trocas/${t.id}/cancelar`, {})).troca);
          await aplicarPendentes();
          fechar();
          toast('Oferta cancelada. As fichas voltaram.');
        } catch (e) { toast(e.message, 'erro'); }
      },
    }, 'Cancelar oferta'));
  }
  acoes.append(el('button', { type: 'button', class: 'btn-ghost', onclick: () => fechar() }, 'Fechar'));
}

function janelaDeResposta(t) {
  const rar = t.quero.raridade;
  const minha = db.pecaDoInventario(t.quero.id);
  let escolhida = null;
  const aceitar = el('button', { type: 'button', class: 'btn-dark', disabled: true }, 'Aceitar');
  const recusar = el('button', { type: 'button', class: 'btn-ghost' }, 'Recusar');
  const { fechar } = janela(
    el('h2', { class: 'pergunta-titulo' }, `${t.de.handle} quer trocar`),
    figura({ ...t.quero, numero: minha?.numero }, { classe: 'troca-alvo', rotulo: 'a sua peça' }),
    el('p', { class: 'pergunta-texto' }, 'Escolha a peça que você quer em troca, ou recuse.'),
    grade(t.opcoes, 1, (lista) => { escolhida = lista[0] ?? null; aceitar.disabled = escolhida === null; }),
    linhaDeCusto(rar),
    el('div', { class: 'pergunta-botoes' }, recusar, aceitar));
  recusar.addEventListener('click', async () => {
    try {
      guardar((await chamar(`/api/trocas/${t.id}/recusar`, {})).troca);
      fechar();
      toast('Oferta recusada.');
    } catch (e) { toast(e.message, 'erro'); }
  });
  aceitar.addEventListener('click', async () => {
    if (!minha) return toast('Essa peça não está mais no seu guarda-roupa.', 'erro');
    if (!minha.numero) return toast('Essa peça ainda não tem número. Tente de novo daqui a pouco.', 'erro');
    if (db.fichas() < custoDa(rar)) return toast(`Faltam fichas: a troca custa ${custoDa(rar)}.`, 'erro');
    if (db.nivel() < TROCAS.nivel) return toast(`A troca libera no nível ${TROCAS.nivel}.`, 'erro');
    aceitar.disabled = true;
    try {
      const { troca } = await chamar(`/api/trocas/${t.id}/aceitar`, {
        escolhida, minha: { numero: minha.numero, origem: minha.origem || 'vitrine', desde: minha.obtidoEm } });
      guardar(troca);
      fechar();
      if (troca.estado === 'feita') await aplicarPendentes();
      else toast(`A troca não deu certo${troca.motivo ? ': ' + troca.motivo : ''}.`, 'erro');
    } catch (e) {
      aceitar.disabled = false;
      toast(e.message, 'erro');
    }
  });
}

const guardar = (troca) => { ultimas = [troca, ...ultimas.filter(t => t.id !== troca.id)]; };

// ------------------------------ Aplicar no save ----------------------------
// O que vai e o que vem para quem está jogando.
function lados(t) {
  const escolhida = t.opcoes[t.escolhida];
  return t.souEu === 'de' ? { dou: escolhida, recebo: t.quero } : { dou: t.quero, recebo: escolhida };
}

// Tira a peça do guarda-roupa e dos looks e colagens que a usavam (regra do João).
function tirar(id) {
  const st = db.state;
  const usou = (look) => (look.camadas || []).some(c => c.itemId === id);
  const naColagem = (b) => (b.itens || []).some(c => c.itemId === id);
  const looks = (st.looks || []).filter(usou).length;
  const colagens = (st.boards || []).filter(naColagem).length;
  st.inventario = st.inventario.filter(p => p.id !== id);
  st.inventario.forEach((p, i) => { p.ordem = i; });
  st.looks = (st.looks || []).filter(l => !usou(l));
  st.boards = (st.boards || []).filter(b => !naColagem(b));
  return { looks, colagens };
}

function aplicarFeita(t) {
  const { dou, recebo } = lados(t);
  const perdidos = db.temPeca(dou.id) ? tirar(dou.id) : { looks: 0, colagens: 0 };
  const peca = pecaDoCatalogo(recebo.id);
  if (peca && !db.temPeca(recebo.id)) {
    const nova = db.adicionarPeca(peca, { origem: 'troca', raridade: recebo.raridade });
    if (nova) nova.numero = recebo.numero;
  }
  if (db.naWishlist(recebo.id)) db.alternarWishlist(recebo.id);
  esquecerHistorico(dou);
  esquecerHistorico(recebo);
  if (t.souEu === 'para') {
    // Quem aceita paga agora; quem pediu já pagou ao enviar.
    db.state.fichas = Math.max(0, db.fichas() - custoDa(recebo.raridade));
  }
  delete registro().cobradas[t.id];
  db.progredirMissao('trocar');
  return { dou, recebo, perdidos };
}

// As trocas resolvidas que o save ainda não aplicou: feitas (peças) e as que
// não saíram (fichas de volta para quem pediu).
async function aplicarPendentes() {
  const feitas = [];
  let mudou = false;
  for (const t of ultimas) {
    if (t.aplicada || t.estado === 'aberta') continue;
    if (t.estado === 'feita') {
      feitas.push(aplicarFeita(t));
      if (t.souEu === 'de') avisarTroca({ troca: t.id, quem: t.para.id, texto: `${t.para.handle} aceitou sua troca.` });
    } else if (t.souEu === 'de') {
      const volta = registro().cobradas[t.id] || 0;
      if (volta) db.state.fichas = db.fichas() + volta;
      delete registro().cobradas[t.id];
      if (t.estado !== 'cancelada') {
        const como = { recusada: 'recusou', vencida: 'não respondeu', invalida: 'não conseguiu fazer' }[t.estado];
        avisarTroca({ troca: t.id, quem: t.para.id,
          texto: `${t.para.handle} ${como} sua troca${volta ? '. As fichas voltaram.' : '.'}` });
      }
    }
    t.aplicada = true;
    mudou = true;
    chamar(`/api/trocas/${t.id}/aplicada`, {}).catch(() => { t.aplicada = false; });
  }
  if (mudou) db.salvar();
  for (const f of feitas) await animarTroca(f);
}

// Oferta nova para mim: vira aviso uma vez só.
function avisarNovas() {
  const r = registro();
  for (const t of ultimas) {
    if (t.souEu !== 'para' || t.estado !== 'aberta' || r.avisadas.includes(t.id)) continue;
    const peca = pecaDoCatalogo(t.quero.id);
    avisarTroca({ troca: t.id, quem: t.de.id,
      texto: `${t.de.handle} quer trocar ${peca ? nomeDaPeca(peca) : 'uma peça sua'}.` });
    r.avisadas.push(t.id);
  }
  r.avisadas = r.avisadas.slice(-60);
}

export async function sincronizarTrocas() {
  if (!online || document.hidden) return;
  try {
    ultimas = (await chamar('/api/trocas')).trocas || [];
  } catch {
    return;
  }
  avisarNovas();
  await aplicarPendentes();
}

// ------------------------------- A animação --------------------------------
// A sua peça sai pela esquerda, a outra cruza para o centro e pula com a aura
// da raridade, como na abertura do baú.
function animarTroca({ dou, recebo, perdidos }) {
  return new Promise((pronto) => {
    const extra = perdidos.looks + perdidos.colagens
      ? `${[perdidos.looks && `${perdidos.looks} look${perdidos.looks > 1 ? 's' : ''}`,
          perdidos.colagens && `${perdidos.colagens} colage${perdidos.colagens > 1 ? 'ns' : 'm'}`]
        .filter(Boolean).join(' e ')} com a peça que foi saíram.`
      : '';
    const palco = el('div', { class: 'troca-palco' },
      figura(dou, { classe: 'troca-vai', rotulo: 'foi' }),
      figura(recebo, { classe: 'troca-vem', rotulo: 'chegou' }));
    const fundo = el('div', { class: 'troca-anim', role: 'dialog', 'aria-label': 'Troca feita' },
      el('h2', {}, 'Troca feita!'),
      palco,
      el('p', { class: 'troca-anim-texto' }, 'Nova no seu guarda-roupa.', extra ? el('small', {}, extra) : null),
      el('button', { type: 'button', class: 'btn-dark' }, 'Oba!'));
    const fechar = () => { fundo.remove(); pronto(); };
    fundo.querySelector('button').addEventListener('click', fechar);
    fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
    document.body.append(fundo);
    tocar('bau');
    requestAnimationFrame(() => fundo.classList.add('rodando'));
  });
}

// --------------------------------- Boot ------------------------------------
export function montarTrocas() {
  aoTocarEmTroca(abrirOferta);
  sincronizarTrocas();
  setInterval(sincronizarTrocas, INTERVALO);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronizarTrocas(); });
}

// Sem servidor (file://) não há troca.
if (location.protocol === 'file:') online = false;
