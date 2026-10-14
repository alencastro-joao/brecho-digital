// Tarefas: o que o app pede de você — os pedidos do dia e da semana, os
// carimbos, as fichas e a trilha de níveis.
//
// A tela é um cartão de fidelidade de brechó: cada missão é uma etiqueta com a
// sua barra de progresso, que fica verde e riscada quando fecha, e os dias e as
// semanas fechados viram carimbos. O formato das missões segue o Pokémon TCG
// Pocket (lista fixa, cumprir parte já paga); os prêmios dos marcos esperam um
// toque para sair — é o momento bom do dia.

import {
  MISSOES, MISSOES_SEMANA, MARCOS_DIA, MARCOS_SEMANA, PREMIO_SEMANA, BAU_ESPECIAL, FICHAS, premioDoBau, faixasDeTroca,
  RARIDADE, RARIDADES, escalaGrade,
} from './config.js';
import { catalogo, item as pecaDoCatalogo, nomeDaPeca } from './catalog.js';
import * as db from './db.js';
import * as estoque from './estoque.js';
import {
  el, $, toast, hojeISO, msAteMeiaNoite, msAteSegunda, formatarContagem, formatarDias,
} from './util.js';
import { barraDeNivel } from './nivel.js';
import { irPara, viewAtual } from './router.js';
import { colecaoMaisPerto, todasAsColecoes, abrirColecao } from './colecoes.js';

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
  renderCartaoColecoes();
  renderPontinho();
}

// ------------------------------- Coleções ---------------------------------
// O cartão que leva à tela de Coleções: puxa pela que está mais perto de
// fechar, com as peças que você já tem dela empilhadas.
function renderCartaoColecoes() {
  const botao = $('#tarefas-colecoes');
  const todas = todasAsColecoes();
  botao.hidden = !todas.length;
  if (!todas.length) return;
  // Escolha esperando vem antes de tudo: é item de graça parado.
  const comEscolha = todas.find(c => c.livres > 0);
  const perto = comEscolha || colecaoMaisPerto();
  const completas = todas.filter(c => c.completa).length;
  const faltam = perto ? perto.total - perto.tem : 0;
  const ids = perto ? perto.ids : todas[0].ids;
  const pilha = [...ids.filter(id => db.temPeca(id)), ...ids.filter(id => !db.temPeca(id))]
    .slice(0, 3).map(id => pecaDoCatalogo(id)).filter(Boolean);

  botao.onclick = () => comEscolha ? abrirColecao(comEscolha.id) : irPara('colecoes');
  botao.replaceChildren(
    el('span', { class: 'tf-col-pilha' }, ...pilha.map(miniPeca)),
    el('span', { class: 'tf-col-info' },
      el('strong', {}, 'Coleções'),
      el('small', {}, comEscolha
        ? `🎁 ${comEscolha.marca}: escolha um item do avatar`
        : perto
        ? (perto.tem
          ? `${perto.marca}: ${faltam === 1 ? 'falta 1 peça' : `faltam ${faltam} peças`} para fechar`
          : `Garimpe peças ${perto.tipo === 'cor' ? 'da cor ' : perto.tipo === 'estilo' ? 'de ' : 'da '}${perto.marca} para abrir o primeiro item`)
        : 'Todas completas!'),
      el('small', { class: 'tf-col-conta' },
        `${completas} de ${todas.length} ${todas.length === 1 ? 'completa' : 'completas'}`)),
    el('span', { class: 'tf-col-seta', 'aria-hidden': 'true' }, '›'));
}

function renderPontinho() {
  const tem = db.temPremioParaResgatar() || db.escolhasLivres() > 0;
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
    ? 'Você já trocou fichas hoje. Amanhã dá de novo.'
    : pode ? 'Dá para trocar por mais um resgate.'
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
          toast('+1 resgate. Ele fica guardado até você usar.', 'rare');
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
  linhaDeBau($('#carimbos-bau'), {
    nome: 'Baú dos dias', bau: PREMIO_SEMANA,
    feitos: carimbados.length, meta: PREMIO_SEMANA.carimbos, unidade: 'dias carimbados',
    pronto: db.bauDosDiasPronto(), abrir: abrirBau,
    aberto: premio && { pecas: db.pecasDoBauDosDias(), xp: premio.xp ?? premioDoBau(PREMIO_SEMANA, 1).atual.xp },
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
    nome: 'Baú semanal', bau: BAU_ESPECIAL,
    feitos: n, meta: total, unidade: 'semanas carimbadas',
    pronto: db.bauEspecialPronto(), abrir: abrirEspecial, dourado: true,
  });
}

// ---------------------------------- Baús -----------------------------------
// Os dois baús usam a mesma linha: fechado com a barra dos carimbos, pronto
// com o botão, ou aberto com a peça que saiu.
function linhaDeBau(box, { nome, bau, feitos, meta, unidade, pronto, abrir, aberto, dourado }) {
  if (aberto) {
    const pecas = aberto.pecas.map(p => pecaDoCatalogo(p.id)).filter(Boolean);
    box.className = 'bau aberto';
    box.replaceChildren(
      pecas.length ? el('div', { class: 'bau-pecas' }, ...pecas.slice(0, 3).map(miniPeca))
                   : el('span', { class: 'bau-icone' }, '🎁'),
      el('div', { class: 'bau-info' },
        el('strong', {}, `${nome} aberto`),
        el('small', {}, [...pecas.map(nomeDaPeca), `${aberto.xp} XP`].join(' + '))),
      ...(pecas.length ? [el('button', { class: 'btn-ghost', onclick: () => irPara('closet') }, 'Ver')] : []));
    return;
  }
  const nivel = db.nivel();
  const { atual, proximo } = premioDoBau(bau, nivel);
  box.className = 'bau' + (pronto ? ' pronto' : '') + (dourado ? ' dourado' : '');
  box.replaceChildren(
    el('span', { class: 'bau-icone' }, pronto ? '🎁' : dourado ? '👑' : '🔒'),
    el('div', { class: 'bau-info' },
      el('strong', {}, nome),
      el('small', {}, `${descreverPremio(atual)}.`),
      ...(pronto ? [] : [
        el('div', { class: 'barra' }, el('span', { style: { width: Math.min(100, feitos / meta * 100) + '%' } })),
        el('small', { class: 'bau-conta' }, `${feitos} de ${meta} ${unidade}`)]),
      ...(proximo ? [el('small', { class: 'bau-proximo' },
        `No nível ${proximo.desde}: ${descreverPremio(proximo)}.`)] : [])),
    ...(pronto ? [botaoPremio('Abrir', abrir)] : []));
}

// "2 peças (rara e incomum) + 250 XP"
function descreverPremio({ pecas, xp }) {
  const nomes = pecas.map(f => RARIDADE[f]?.nome.toLowerCase());
  const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}` : nomes[0];
  return `${pecas.length === 1 ? '1 peça' : `${pecas.length} peças`} (${lista}) + ${xp} XP`;
}

function miniPeca(peca) {
  return el('div', { class: 'bau-peca', style: { '--esc': String(escalaGrade(peca)) } },
    el('div', { class: 'peca-caixa' }, el('img', { src: peca.src, alt: nomeDaPeca(peca) })));
}

// As peças de um baú: uma por faixa do degrau do seu nível. Cada uma é uma
// peça que você ainda não tem e que não esgotou; sem nenhuma na faixa, tenta a
// de baixo (e só sobe se não houver nada abaixo). Nunca repete no mesmo baú.
function sortearPremio(bau) {
  const { atual } = premioDoBau(bau, db.nivel());
  const escolhidas = new Set();
  const sorteadas = [];
  for (const pedida of atual.pecas) {
    for (const faixa of faixasDeTroca(pedida)) {
      const lista = catalogo.itens.filter(it => !escolhidas.has(it.id) &&
        !db.temPeca(it.id) && db.raridadeDoDia(it.id) === faixa && !estoque.esgotada(it.id, faixa));
      if (!lista.length) continue;
      const item = lista[Math.floor(Math.random() * lista.length)];
      escolhidas.add(item.id);
      sorteadas.push({ item, raridade: faixa });
      break;
    }
  }
  return sorteadas;
}

function abrirUmBau(nome, bau, abrir) {
  const r = abrir(sortearPremio(bau));
  if (!r) return;
  if (r.pecas.length) estoque.levar(r.pecas.map(p => ({ id: p.id, raridade: p.raridade })));
  const nomes = r.pecas.map(p => `${nomeDaPeca(pecaDoCatalogo(p.id))} (${RARIDADE[p.raridade]?.nome})`);
  const melhor = r.pecas.map(p => p.raridade)
    .sort((a, b) => ordemDaFaixa(b) - ordemDaFaixa(a))[0];
  toast(nomes.length
    ? `${nome}: ${nomes.join(', ')} no seu guarda-roupa. +${r.xp} XP.`
    : `${nome} aberto: +${r.xp} XP.`, melhor);
}

const ordemDaFaixa = (f) => RARIDADES.findIndex(r => r.id === f);
const abrirBau = () => abrirUmBau('Baú dos dias', PREMIO_SEMANA, db.abrirPremioDaSemana);
const abrirEspecial = () => abrirUmBau('Baú semanal', BAU_ESPECIAL, db.abrirBauEspecial);

export const aoEntrarNasTarefas = renderTarefas;
