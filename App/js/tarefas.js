// Tarefas: o que o app pede de você — os pedidos do dia e da semana, os
// carimbos, as fichas e a trilha de níveis.
//
// A tela é um cartão de fidelidade de brechó: cada missão é uma etiqueta com a
// sua barra de progresso, que fica verde e riscada quando fecha, e os dias e as
// semanas fechados viram carimbos. O formato das missões segue o Pokémon TCG
// Pocket (lista fixa, cumprir parte já paga); os prêmios dos marcos esperam um
// toque para sair — é o momento bom do dia.

import {
  MISSOES, MISSOES_SEMANA, MARCOS_DIA, MARCOS_SEMANA, PREMIO_SEMANA, BAU_ESPECIAL, FICHAS,
  RARIDADE, escalaGrade,
} from './config.js';
import { catalogo, item as pecaDoCatalogo, nomeDaPeca } from './catalog.js';
import * as db from './db.js';
import * as estoque from './estoque.js';
import {
  el, $, toast, hojeISO, msAteMeiaNoite, msAteSegunda, formatarContagem, formatarDias,
} from './util.js';
import { barraDeNivel, listaDeFerramentas } from './nivel.js';
import { irPara, viewAtual } from './router.js';

export function montarTarefas() {
  // Missão fecha em qualquer tela: resgatar na vitrine, salvar um look,
  // publicar no feed. Toda gravação repinta esta aba — se ela estiver aberta —
  // e acende o pontinho do botão de Tarefas quando há prêmio esperando.
  db.onChange(() => {
    if (viewAtual() === 'tarefas') renderTarefas();
    else renderPontinho();
  });
  renderTarefas();
}

export function renderTarefas() {
  db.virarODiaSeNecessario();   // o dia e a semana podem ter virado com a aba aberta
  renderFaixa();
  renderDia();
  renderCarimbos();
  renderSemana();
  renderSemanas();
  $('#ferramenta-box').replaceChildren(listaDeFerramentas());
  renderPontinho();
}

function renderPontinho() {
  const tem = db.temPremioParaResgatar();
  for (const botao of document.querySelectorAll('[data-goto="tarefas"]')) {
    botao.classList.toggle('tem-premio', tem);
  }
}

// ------------------------------ Faixa do topo ------------------------------
// Nível, fichas e a troca de fichas por resgate, num lugar só.
function renderFaixa() {
  const n = db.fichas();
  const troca = FICHAS.porResgate;
  const usadas = db.state.dia.extras ?? 0;
  const pode = db.podeTrocarFichas();
  const nota = usadas >= FICHAS.extrasPorDia
    ? 'Resgate extra de hoje já usado.'
    : pode ? 'Dá para trocar por mais um resgate hoje.'
      : `Faltam ${troca - n} ${troca - n === 1 ? 'ficha' : 'fichas'} para um resgate.`;

  $('#tarefas-faixa').replaceChildren(
    el('div', { class: 'faixa-nivel' }, barraDeNivel()),
    el('div', { class: 'faixa-fichas' },
      el('div', { class: 'fichas-topo' },
        el('span', { class: 'ficha-moeda', 'aria-hidden': 'true' }),
        el('strong', {}, `${n} ${n === 1 ? 'ficha' : 'fichas'}`),
        el('small', {}, `${troca} fichas = 1 resgate`)),
      el('div', { class: 'barra' },
        el('span', { style: { width: Math.min(100, n / troca * 100) + '%' } })),
      el('small', { class: 'fichas-nota' }, nota),
      el('button', {
        class: 'btn-dark btn-trocar', disabled: !pode,
        onclick: () => {
          if (!db.trocarFichasPorResgate()) return;
          toast(`+1 resgate hoje. Corre para a vitrine!`, 'rare');
        },
      }, 'Trocar por resgate')),
  );
}

// ------------------------------- Etiquetas ---------------------------------
function etiqueta(m, atual) {
  const feito = Math.min(atual, m.meta);
  const ok = feito >= m.meta;
  return el('div', { class: 'etiqueta' + (ok ? ' ok' : '') },
    el('div', { class: 'etiqueta-linha' },
      el('strong', {}, m.nome),
      el('small', {}, `${feito}/${m.meta}${ok ? ' ✓' : ''}`)),
    el('div', { class: 'barra' },
      el('span', { style: { width: (feito / m.meta * 100) + '%' } })));
}

function botaoPremio(texto, acao, { dourado = true } = {}) {
  return el('button', { class: dourado ? 'btn-premio' : 'btn-dark', onclick: acao }, texto);
}

// ---------------------------------- Dia -----------------------------------
function renderDia() {
  const feitas = db.missoesFeitas();
  $('#dia-titulo').textContent = `Pedidos de hoje · ${feitas} de ${MISSOES.length}`;
  $('#dia-prazo').textContent = `zeram em ${formatarContagem(msAteMeiaNoite())}`;
  $('#dia-lista').replaceChildren(...MISSOES.map(m => etiqueta(m, db.progressoMissao(m.id))));

  const pronto = db.marcoDoDiaPronto();
  const { ficha, carimbo } = MARCOS_DIA;
  let rodape;
  if (pronto === 'carimbo') {
    rodape = botaoPremio('Carimbar o dia', resgatarDia);
  } else if (pronto === 'ficha') {
    rodape = botaoPremio(`Pegar ${ficha.fichas} ficha`, resgatarDia);
  } else if (db.diaCarimbado()) {
    rodape = el('p', { class: 'cartao-nota ok' }, 'Dia carimbado. Amanhã tem pedido novo.');
  } else {
    const faltam = (feitas < ficha.missoes ? ficha.missoes : carimbo.missoes) - feitas;
    rodape = el('p', { class: 'cartao-nota' }, feitas < ficha.missoes
      ? `Mais ${faltam} ${faltam === 1 ? 'pedido' : 'pedidos'}: ${ficha.fichas} ficha.`
      : `Mais ${faltam} ${faltam === 1 ? 'pedido' : 'pedidos'}: carimbo do dia e +${carimbo.fichas} fichas.`);
  }
  $('#dia-rodape').replaceChildren(rodape);
}

function resgatarDia() {
  const r = db.resgatarMarcoDoDia();
  if (!r) return;
  toast(r.marco === 'carimbo'
    ? `Dia carimbado! +${r.fichas} ${r.fichas === 1 ? 'ficha' : 'fichas'}.`
    : `+${r.fichas} ficha.`, r.marco === 'carimbo' ? 'rare' : undefined);
}

// ------------------------------- Carimbos ---------------------------------
const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

function renderCarimbos() {
  const carimbados = db.carimbosDaSemana();
  const [a, m, d] = db.state.semana.data.split('-').map(Number);
  const hoje = hojeISO();
  $('#carimbos-titulo').textContent = `Carimbos da semana · ${carimbados.length} de 7`;
  $('#carimbos-cartela').replaceChildren(...DIAS.map((nome, i) => {
    const iso = hojeISO(new Date(a, m - 1, d + i));
    const on = carimbados.includes(iso);
    return el('span', {
      class: 'selo' + (on ? ' on' : '') + (iso === hoje ? ' hoje' : ''),
      title: on ? `${nome}: dia carimbado` : nome,
    }, nome);
  }));

  const premio = db.state.semana.premio;
  const peca = premio?.id && pecaDoCatalogo(premio.id);
  linhaDeBau($('#carimbos-bau'), {
    nome: 'Baú dos dias',
    premio: `Uma peça ${nomeDaFaixa(PREMIO_SEMANA)} + ${PREMIO_SEMANA.xp} XP.`,
    feitos: carimbados.length, meta: PREMIO_SEMANA.carimbos, unidade: 'dias carimbados',
    pronto: db.bauDosDiasPronto(), abrir: abrirBau,
    aberto: premio && (peca
      ? { peca, texto: `${nomeDaPeca(peca)} (${RARIDADE[premio.raridade]?.nome ?? ''}) + ${PREMIO_SEMANA.xp} XP` }
      : { texto: `+${PREMIO_SEMANA.xp} XP` }),
  });
}

// -------------------------------- Semana ----------------------------------
function renderSemana() {
  const feitas = db.semanaisFeitas();
  $('#semana-titulo').textContent = `Pedidos da semana · ${feitas} de ${MISSOES_SEMANA.length}`;
  $('#semana-prazo').textContent = `zeram em ${formatarDias(msAteSegunda())}`;
  $('#semana-lista').replaceChildren(
    ...MISSOES_SEMANA.map(m => etiqueta(m, db.progressoSemanal(m.id))));

  const { fichas } = MARCOS_SEMANA;
  let rodape;
  if (db.carimboDaSemanaPronto()) {
    rodape = botaoPremio('Carimbar a semana', () => {
      const r = db.carimbarSemana();
      if (r) toast(`Semana carimbada!${r.fichas ? ` +${r.fichas} fichas.` : ''}`, 'rare');
    });
  } else if (db.fichasDaSemanaProntas()) {
    rodape = botaoPremio(`Pegar ${fichas.fichas} fichas`, () => {
      const n = db.resgatarFichasDaSemana();
      if (n) toast(`+${n} fichas da semana.`, 'rare');
    });
  } else if (db.semanaCarimbada()) {
    rodape = el('p', { class: 'cartao-nota ok' }, 'Semana carimbada. Segunda tem pedido novo.');
  } else {
    rodape = el('p', { class: 'cartao-nota' },
      `Com ${fichas.missoes} pedidos: ${fichas.fichas} fichas. Com os ${MISSOES_SEMANA.length}: carimbo da semana.`);
  }
  $('#semana-rodape').replaceChildren(rodape);
}

// --------------------------- Carimbos das semanas --------------------------
function renderSemanas() {
  const total = BAU_ESPECIAL.semanas;
  const n = Math.min(db.semanasFechadas(), total);
  $('#semanas-titulo').textContent = `Carimbos das semanas · ${n} de ${total}`;
  $('#semanas-cartela').replaceChildren(...Array.from({ length: total }, (_, i) =>
    el('span', { class: 'selo' + (i < n ? ' on' : '') }, `S${i + 1}`)));
  linhaDeBau($('#semanas-bau'), {
    nome: 'Baú semanal',
    premio: `Uma peça ${nomeDaFaixa(BAU_ESPECIAL)} + ${BAU_ESPECIAL.xp} XP.`,
    feitos: n, meta: total, unidade: 'semanas carimbadas',
    pronto: db.bauEspecialPronto(), abrir: abrirEspecial, dourado: true,
  });
}

// ---------------------------------- Baús -----------------------------------
// Os dois baús usam a mesma linha: fechado com a barra dos carimbos, pronto
// com o botão, ou aberto com a peça que saiu.
function linhaDeBau(box, { nome, premio, feitos, meta, unidade, pronto, abrir, aberto, dourado }) {
  if (aberto) {
    box.className = 'bau aberto';
    box.replaceChildren(
      aberto.peca ? miniPeca(aberto.peca) : el('span', { class: 'bau-icone' }, '🎁'),
      el('div', { class: 'bau-info' },
        el('strong', {}, `${nome} aberto`), el('small', {}, aberto.texto)),
      ...(aberto.peca ? [el('button', { class: 'btn-ghost', onclick: () => irPara('closet') }, 'Ver')] : []));
    return;
  }
  box.className = 'bau' + (pronto ? ' pronto' : '') + (dourado ? ' dourado' : '');
  box.replaceChildren(
    el('span', { class: 'bau-icone' }, pronto ? '🎁' : dourado ? '👑' : '🔒'),
    el('div', { class: 'bau-info' },
      el('strong', {}, nome),
      el('small', {}, premio),
      ...(pronto ? [] : [
        el('div', { class: 'barra' }, el('span', { style: { width: Math.min(100, feitos / meta * 100) + '%' } })),
        el('small', { class: 'bau-conta' }, `${feitos} de ${meta} ${unidade}`)])),
    ...(pronto ? [botaoPremio('Abrir', abrir)] : []));
}

const nomeDaFaixa = (premio) => RARIDADE[premio.faixas[0]]?.nome.toLowerCase();

function miniPeca(peca) {
  return el('div', { class: 'bau-peca', style: { '--esc': String(escalaGrade(peca)) } },
    el('div', { class: 'peca-caixa' }, el('img', { src: peca.src, alt: nomeDaPeca(peca) })));
}

// A peça de um baú: a primeira faixa da lista que ainda tem peça que você não
// tem e que não esgotou.
function sortearPremio(faixas) {
  for (const faixa of faixas) {
    const lista = catalogo.itens.filter(it =>
      !db.temPeca(it.id) && db.raridadeDoDia(it.id) === faixa && !estoque.esgotada(it.id, faixa));
    if (lista.length) return { item: lista[Math.floor(Math.random() * lista.length)], faixa };
  }
  return { item: null, faixa: null };
}

function abrirBau() {
  const { item, faixa } = sortearPremio(PREMIO_SEMANA.faixas);
  const peca = db.abrirPremioDaSemana(item, faixa);
  if (peca) {
    estoque.levar([{ id: peca.id, raridade: peca.raridade }]);
    toast(`Baú dos dias: ${nomeDaPeca(item)} (${RARIDADE[faixa].nome}) no seu guarda-roupa.`, faixa);
  } else {
    toast(`Baú dos dias aberto: +${PREMIO_SEMANA.xp} XP.`);
  }
}

function abrirEspecial() {
  const { item, faixa } = sortearPremio(BAU_ESPECIAL.faixas);
  const r = db.abrirBauEspecial(item, faixa);
  if (!r) return;
  if (r.peca) {
    estoque.levar([{ id: r.peca.id, raridade: r.peca.raridade }]);
    toast(`Baú semanal: ${nomeDaPeca(item)} (${RARIDADE[faixa].nome}) no seu guarda-roupa.`, faixa);
  } else {
    toast(`Baú semanal aberto: +${BAU_ESPECIAL.xp} XP.`);
  }
}

export const aoEntrarNasTarefas = renderTarefas;
