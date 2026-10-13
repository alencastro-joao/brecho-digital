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
  renderBaus();
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
}

// -------------------------------- Semana ----------------------------------
function renderSemana() {
  const feitas = db.semanaisFeitas();
  $('#semana-titulo').textContent = `Pedidos da semana · ${feitas} de ${MISSOES_SEMANA.length}`;
  $('#semana-prazo').textContent = `zeram em ${formatarDias(msAteSegunda())}`;
  $('#semana-lista').replaceChildren(
    ...MISSOES_SEMANA.map(m => etiqueta(m, db.progressoSemanal(m.id))));

  const { fichas } = MARCOS_SEMANA;
  const rodape = db.fichasDaSemanaProntas() && !db.semanaCompleta()
    ? botaoPremio(`Pegar ${fichas.fichas} fichas`, () => {
        const n = db.resgatarFichasDaSemana();
        if (n) toast(`+${n} fichas da semana.`, 'rare');
      })
    : el('p', { class: 'cartao-nota' },
        `Com ${fichas.missoes} pedidos: ${fichas.fichas} fichas. Com os ${MISSOES_SEMANA.length}: abre o baú da semana.`);
  $('#semana-rodape').replaceChildren(rodape);
}

// ---------------------------------- Baús -----------------------------------
// Uma fileira de 3 baús, um por semana fechada. O terceiro é o especial: além
// do prêmio da semana, traz o do baú especial, num toque só.
function renderBaus() {
  const total = BAU_ESPECIAL.semanas;
  const aberto = !!db.state.semana.premio;
  let n = db.semanasFechadas();
  if (aberto && n === 0) n = total;           // o especial acabou de sair: fileira cheia até segunda
  const atual = Math.min(aberto ? n - 1 : n, total - 1);
  const pronto = db.semanaCompleta() && !aberto;
  const feitas = db.semanaisFeitas();

  $('#baus-titulo').textContent = `Baús · ${Math.min(n, total)} de ${total}`;
  $('#baus-fila').replaceChildren(...Array.from({ length: total }, (_, i) => {
    const especial = i === total - 1;
    const nome = especial ? 'Especial' : `Semana ${i + 1}`;
    const classe = 'bau-slot' + (especial ? ' especial' : '');

    // Já aberto (numa semana anterior, ou nesta).
    if (i < n && !(i === atual && db.bauEspecialPronto())) {
      const peca = i === atual && aberto && db.state.semana.premio.id && pecaDoCatalogo(db.state.semana.premio.id);
      return el('div', { class: classe + ' aberto' },
        peca ? miniPeca(peca) : el('span', { class: 'bau-icone' }, '✓'),
        el('strong', {}, nome), el('small', {}, i === atual && aberto ? 'aberto nesta semana' : 'aberto'));
    }
    // O especial que ficou para trás (semana 3 aberta antes desta tela existir).
    if (especial && db.bauEspecialPronto()) {
      return el('div', { class: classe + ' pronto' },
        el('span', { class: 'bau-icone' }, '👑'), el('strong', {}, nome),
        botaoPremio('Abrir', abrirEspecial));
    }
    // O baú desta semana.
    if (i === atual) {
      return el('div', { class: classe + (pronto ? ' pronto' : ' atual') },
        el('span', { class: 'bau-icone' }, especial ? '👑' : '🎁'),
        el('strong', {}, nome),
        pronto
          ? botaoPremio('Abrir', abrirBau)
          : el('div', { class: 'bau-progresso' },
              el('div', { class: 'barra' }, el('span', { style: { width: feitas / MISSOES_SEMANA.length * 100 + '%' } })),
              el('small', {}, `${feitas} de ${MISSOES_SEMANA.length} pedidos`)));
    }
    // Semanas que ainda vêm.
    return el('div', { class: classe + ' futuro' },
      el('span', { class: 'bau-icone' }, especial ? '👑' : '🔒'),
      el('strong', {}, nome), el('small', {}, 'próximas semanas'));
  }));

  const rara = RARIDADE[PREMIO_SEMANA.faixas[0]]?.nome.toLowerCase();
  const epica = RARIDADE[BAU_ESPECIAL.faixas[0]]?.nome.toLowerCase();
  $('#baus-nota').textContent =
    `Cada baú dá uma peça ${rara} e ${PREMIO_SEMANA.xp} XP. ` +
    `O ${total}º também traz uma peça ${epica} e mais ${BAU_ESPECIAL.xp} XP. ` +
    'Não precisam ser semanas seguidas.';
}

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
    toast(`Baú aberto: ${nomeDaPeca(item)} (${RARIDADE[faixa].nome}) no seu guarda-roupa.`, faixa);
  } else {
    toast(`Baú aberto: +${PREMIO_SEMANA.xp} XP.`);
  }
  if (db.bauEspecialPronto()) abrirEspecial();
}

function abrirEspecial() {
  const { item, faixa } = sortearPremio(BAU_ESPECIAL.faixas);
  const r = db.abrirBauEspecial(item, faixa);
  if (!r) return;
  if (r.peca) {
    estoque.levar([{ id: r.peca.id, raridade: r.peca.raridade }]);
    toast(`Baú especial: ${nomeDaPeca(item)} (${RARIDADE[faixa].nome}) no seu guarda-roupa.`, faixa);
  } else {
    toast(`Baú especial aberto: +${BAU_ESPECIAL.xp} XP.`);
  }
}

export const aoEntrarNasTarefas = renderTarefas;
