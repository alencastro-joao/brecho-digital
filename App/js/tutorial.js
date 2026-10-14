// Missões de introdução: o tutorial de conta nova, em forma de missão.
//
// Uma missão por vez (INTRO em config.js), cada uma ensinando uma parte do app
// — personagem, roupas, loja, Stylist, colagem, feed, seguir, favoritos — e
// pagando um prêmio que cresce com a cadeia: XP, fichas e peças, até a épica
// da última. O progresso vem dos mesmos eventos das missões do dia
// (db.progredirMissao), então fazer a coisa já conta, esteja onde estiver.
//
// Na tela é um cartão fixo acima da barra (no celular) ou ao lado dela (no
// computador): aberto mostra a missão inteira; minimizado vira uma faixa com a
// missão da vez e o botão de ir até ela. Cumprir a missão entrega o prêmio na
// hora (num aviso) e já passa para a próxima, sem tela de prêmio no meio.
//
// O cartão não pode ficar na frente do que a missão pede: a faixa fica em cima
// ou embaixo conforme a missão (`lugar`, em INTRO), qualquer toque fora dela a
// recolhe numa bolinha no canto, e tanto a faixa quanto a bolinha se arrastam.
//
// Começa sozinho na conta nova. Para testar de novo: Perfil › Testes ›
// "Recomeçar missões de introdução", ou abrir o site com ?tutorial.

import { INTRO, RARIDADE, RARIDADES, faixasDeTroca } from './config.js';
import { catalogo, nomeDaPeca } from './catalog.js';
import * as db from './db.js';
import * as estoque from './estoque.js';
import { irPara } from './router.js';
import { montarVitrine } from './vitrine.js';
import { el, $, toast } from './util.js';

let caixa = null;
let modo = 'barra';       // 'boasvindas' | 'aberta' | 'barra' | 'bolha'
let concluindo = false;
// Onde a pessoa arrastou: a faixa só sobe e desce (y), a bolinha vai a
// qualquer lugar. null = o lugar padrão da missão (CSS).
const posicao = { barra: null, bolha: null };
let arrasto = null;
let acabouDeArrastar = false;

export function montarTutorial() {
  $('#btn-tutorial')?.addEventListener('click', () => {
    $('#aj-fechar')?.click();   // fecha o modal de Testes antes
    comecar();
  });
  // Fora da pilha de quem fez a ação: o prêmio remonta a vitrine, e fazer isso
  // no meio do resgate dela atropelaria o próprio resgate.
  db.onIntro(() => setTimeout(() => {
    // Missão nova na vez: a faixa volta a aparecer para dizer qual é.
    if (concluirProntas() && modo === 'bolha') modo = 'barra';
    desenhar();
  }));
  // Tocar em qualquer coisa fora do cartão é ir fazer a missão: ele se recolhe.
  // Em captura e sem impedir nada, então o toque segue para onde foi dado.
  document.addEventListener('pointerdown', (e) => {
    if (caixa && !caixa.contains(e.target) && (modo === 'barra' || modo === 'aberta')) {
      modo = 'bolha';
      desenhar();
    }
  }, true);
  concluirProntas();
  desenhar();
}

// ?tutorial no endereço: o jeito de testar de qualquer aparelho.
export function pediuTutorialNaUrl() {
  return new URLSearchParams(location.search).has('tutorial');
}

export function comecar() {
  // Tira o ?tutorial do endereço: recarregar não recomeça de novo.
  if (pediuTutorialNaUrl()) history.replaceState(null, '', location.pathname + location.hash);
  modo = 'boasvindas';
  db.comecarIntro();
}

// ------------------------------- Prêmios ----------------------------------
// Uma peça por faixa pedida: que você não tem, que não esgotou e que não saiu
// neste mesmo prêmio. Sem nenhuma na faixa, tenta a vizinha (faixasDeTroca).
function sortearPecas(faixas) {
  const escolhidas = new Set();
  const out = [];
  for (const pedida of faixas) {
    for (const faixa of faixasDeTroca(pedida)) {
      const lista = catalogo.itens.filter(it => !escolhidas.has(it.id) &&
        !db.temPeca(it.id) && db.raridadeDoDia(it.id) === faixa && !estoque.esgotada(it.id, faixa));
      if (!lista.length) continue;
      const item = lista[Math.floor(Math.random() * lista.length)];
      escolhidas.add(item.id);
      out.push({ item, raridade: faixa });
      break;
    }
  }
  return out;
}

function entregar(premio) {
  const r = { xp: premio.xp || 0, fichas: premio.fichas || 0, pecas: [] };
  for (const { item, raridade } of sortearPecas(premio.pecas || [])) {
    const peca = db.adicionarPeca(item, { origem: 'missao', raridade });
    if (peca) r.pecas.push({ item, peca });
  }
  if (r.fichas) db.ganharFicha(r.fichas);
  if (r.xp) db.ganharXP(r.xp);   // sem motivo: o aviso é o da missão (anunciar)
  db.salvar();
  if (r.pecas.length) {
    const pecas = r.pecas.map(({ peca }) => peca);
    estoque.levar(pecas.map(p => ({ id: p.id, raridade: p.raridade })))
      .then(() => { estoque.numerar(pecas); db.salvar(); });
    montarVitrine();   // a peça ganha sai do mural, se estava nele
  }
  return r;
}

// Paga e avança cada missão da vez que já está feita — em cadeia, porque fazer
// a coisa antes de chegar na missão já vale. avancarIntro avisa os ouvintes, e
// a trava impede que esse aviso entre aqui de novo no meio do laço.
function concluirProntas() {
  if (concluindo) return false;
  concluindo = true;
  let alguma = false;
  try {
    while (db.introPronta()) {
      const passo = db.state.intro.passo;
      const m = INTRO[passo];
      const r = entregar(m.premio);
      const ultima = passo === INTRO.length - 1;
      db.avancarIntro();
      anunciar(m, r, ultima);
      alguma = true;
    }
  } finally {
    concluindo = false;
  }
  return alguma;
}

// Um aviso só por missão, com tudo o que ela pagou.
function anunciar(m, r, ultima) {
  const coisas = [
    ...r.pecas.map(({ item, peca }) => `${nomeDaPeca(item)} (${RARIDADE[peca.raridade]?.nome ?? ''})`),
    r.fichas && (r.fichas === 1 ? '1 ficha' : `${r.fichas} fichas`),
    r.xp && `${r.xp} XP`,
  ].filter(Boolean);
  const melhor = r.pecas.map(p => p.peca.raridade)
    .sort((a, b) => ordem(b) - ordem(a))[0] || 'uncommon';
  const ganhou = coisas.length ? ` Ganhou ${coisas.join(' e ')}.` : '';
  toast(ultima
    ? `Introdução completa!${ganhou} Agora as missões do dia, em Tarefas, continuam dando prêmio.`
    : `✓ ${m.nome}.${ganhou}`, melhor);
}
const ordem = (f) => RARIDADES.findIndex(r => r.id === f);

// ------------------------------- Desenho ----------------------------------
const nomeFaixa = (f) => RARIDADE[f]?.nome?.toLowerCase() ?? f;

function rotuloDoPremio(p) {
  const partes = [];
  for (const f of p.pecas || []) partes.push(`peça ${nomeFaixa(f)}`);
  if (p.fichas) partes.push(p.fichas === 1 ? '1 ficha' : `${p.fichas} fichas`);
  if (p.xp) partes.push(`${p.xp} XP`);
  return partes.join(' + ');
}

function pontos(passo) {
  return `<div class="intro-pontos">${INTRO.map((_, i) =>
    `<i class="${i < passo ? 'feito' : i === passo ? 'ativo' : ''}"></i>`).join('')}</div>`;
}

function htmlBoasVindas() {
  return `
    <p class="intro-sobre">Missões de introdução</p>
    <h2>Bem-vindo ao Brechó Digital!</h2>
    <p class="intro-dica">São ${INTRO.length} missões rápidas que mostram tudo o que dá pra fazer aqui.
      Cada uma dá um prêmio, e a última é uma <b>peça épica</b>.</p>
    <div class="intro-acoes">
      <button class="btn-ghost" data-acao="pular" type="button">Agora não</button>
      <button class="btn-dark" data-acao="abrir" type="button">Começar</button>
    </div>`;
}

function htmlAberta(m, passo) {
  return `
    <div class="intro-topo">
      <span class="intro-sobre">Missão ${passo + 1} de ${INTRO.length}</span>
      <button class="intro-min" data-acao="minimizar" type="button" aria-label="Minimizar">–</button>
    </div>
    <h2>${m.nome}</h2>
    <p class="intro-dica">${m.dica}</p>
    <p class="intro-premio">🎁 ${rotuloDoPremio(m.premio)}</p>
    ${pontos(passo)}
    <div class="intro-acoes">
      <button class="btn-ghost" data-acao="pular" type="button">Pular introdução</button>
      <button class="btn-dark" data-acao="ir" type="button">Ir para lá</button>
    </div>`;
}

function htmlBarra(m, passo) {
  return `
    <button class="intro-faixa" data-acao="abrir" type="button">
      <span class="intro-num">${passo + 1}/${INTRO.length}</span>
      <span class="intro-texto"><b>${m.nome}</b><small>🎁 ${rotuloDoPremio(m.premio)}</small></span>
    </button>
    <button class="btn-dark" data-acao="ir" type="button">Ir</button>`;
}

function htmlBolha(passo) {
  return `<button class="intro-bolha" data-acao="barra" type="button"
    aria-label="Missão ${passo + 1} de ${INTRO.length}: mostrar">${passo + 1}/${INTRO.length}</button>`;
}

function desenhar() {
  if (!db.introAtiva()) { fechar(); return; }

  if (!caixa) {
    caixa = el('div', { class: 'intro', role: 'region', 'aria-label': 'Missões de introdução' });
    caixa.addEventListener('click', clique);
    caixa.addEventListener('pointerdown', comecarArrasto);
    document.body.append(caixa);
    document.body.classList.add('com-intro');
  }

  const passo = db.state.intro.passo;
  const m = INTRO[passo];
  caixa.dataset.modo = modo;
  caixa.dataset.lugar = modo === 'boasvindas' ? 'baixo' : m.lugar;
  document.body.classList.toggle('intro-embaixo', caixa.dataset.lugar === 'baixo' && modo !== 'bolha');
  caixa.innerHTML =
    modo === 'boasvindas' ? htmlBoasVindas() :
    modo === 'aberta' ? htmlAberta(m, passo) :
    modo === 'bolha' ? htmlBolha(passo) :
    htmlBarra(m, passo);
  posicionar();
}

function fechar() {
  caixa?.remove();
  caixa = null;
  document.body.classList.remove('com-intro', 'intro-embaixo');
}

// --------------------------------- Arrastar -------------------------------
const tipoDePosicao = () => (modo === 'bolha' ? 'bolha' : modo === 'barra' ? 'barra' : null);

function posicionar() {
  const tipo = tipoDePosicao();
  const p = tipo && posicao[tipo];
  const s = caixa.style;
  s.top = s.left = s.right = s.bottom = '';
  if (!p) return;
  s.top = `${p.y}px`;
  s.bottom = 'auto';
  if (tipo === 'bolha') { s.left = `${p.x}px`; s.right = 'auto'; }
}

function comecarArrasto(e) {
  if (!tipoDePosicao() || e.button > 0) return;
  const r = caixa.getBoundingClientRect();
  arrasto = { x0: e.clientX, y0: e.clientY, top: r.top, left: r.left, w: r.width, h: r.height, movendo: false };
  window.addEventListener('pointermove', moverArrasto);
  window.addEventListener('pointerup', soltarArrasto, { once: true });
  window.addEventListener('pointercancel', soltarArrasto, { once: true });
}

function moverArrasto(e) {
  const a = arrasto;
  if (!a) return;
  const dx = e.clientX - a.x0, dy = e.clientY - a.y0;
  if (!a.movendo && Math.hypot(dx, dy) < 6) return;   // abaixo disso é toque
  a.movendo = true;
  const tipo = tipoDePosicao();
  const y = Math.min(Math.max(4, a.top + dy), innerHeight - a.h - 4);
  const x = Math.min(Math.max(4, a.left + dx), innerWidth - a.w - 4);
  posicao[tipo] = tipo === 'bolha' ? { x, y } : { y };
  posicionar();
}

function soltarArrasto() {
  window.removeEventListener('pointermove', moverArrasto);
  // O click que vem depois de um arrasto não é toque: não abre nem vai.
  if (arrasto?.movendo) acabouDeArrastar = true;
  arrasto = null;
}

function clique(e) {
  if (acabouDeArrastar) { acabouDeArrastar = false; return; }
  const acao = e.target.closest('[data-acao]')?.dataset.acao;
  if (!acao) return;
  if (acao === 'abrir') { modo = 'aberta'; desenhar(); }
  else if (acao === 'barra') { modo = 'barra'; desenhar(); }
  else if (acao === 'minimizar') { modo = 'barra'; desenhar(); }
  else if (acao === 'ir') { modo = 'barra'; irPara(INTRO[db.state.intro.passo].ir); desenhar(); }
  else if (acao === 'pular') { modo = 'barra'; db.pularIntro(); }
}
