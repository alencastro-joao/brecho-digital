// Baús: a tela onde ficam os baús ganhos, fechados, esperando o toque.
//
// Todo baú vem para cá: o Baú dos dias, o Baú semanal, os da trilha de níveis
// e os das missões do tutorial. Os do mesmo tipo ficam num cartão só, com a
// quantidade, do mais raro para o mais comum. Tocar abre um (as peças são
// sorteadas na hora, pela regra de BAUS e CHANCE_NO_BAU) com a mesma animação
// de Tarefas. Enquanto houver baú fechado, o pontinho vermelho mostra o
// caminho: o botão de Tarefas, o botão Baús e o próprio baú.

import { BAUS } from './config.js';
import * as db from './db.js';
import { el, $ } from './util.js';
import { ico } from './icones.js';
import { irPara, viewAtual } from './router.js';
import { sortearPecas, entregarPecas, mostrarBau } from './tarefas.js';

// Do mais raro para o mais comum: o que a pessoa mais quer abrir vem primeiro.
const TIPOS = Object.keys(BAUS).reverse();

export function montarBaus() {
  $('#bs-voltar').addEventListener('click', () => irPara('tarefas'));
  $('#bs-todos').addEventListener('click', abrirTodos);
  db.onChange(() => { if (viewAtual() === 'baus') renderBaus(); });
}

export function renderBaus() {
  const baus = db.bausGuardados();
  $('#bs-resumo').textContent = baus.length ? `${baus.length} para abrir` : '';
  const tipos = TIPOS.filter(t => baus.some(b => b.tipo === t));
  $('#bs-grade').replaceChildren(...(tipos.length ? tipos.map(tipo => {
    const deste = baus.filter(b => b.tipo === tipo);
    const { nome, min, max } = BAUS[tipo];
    return el('button', {
      type: 'button', class: `bs-bau bau-${tipo} ponto-novo`, title: `Abrir ${nome.toLowerCase()}`,
      onclick: () => abrir(deste[0]),
    },
      el('div', { class: `bau-caixa bau-${tipo}` }, ico('presente')),
      ...(deste.length > 1 ? [el('span', { class: 'bs-qtd' }, `×${deste.length}`)] : []),
      el('strong', {}, nome),
      el('small', {}, `${min} a ${max} peças`));
  }) : [el('div', { class: 'bs-vazio' },
    el('div', { class: 'bau-caixa' }, ico('presente')),
    el('strong', {}, 'Nenhum baú para abrir'),
    el('small', {}, 'Eles chegam pelos níveis, pelos carimbos e pelas missões.'))]));
  const todos = $('#bs-todos');
  todos.hidden = baus.length < 2;
  todos.textContent = `Abrir todos (${baus.length})`;
}

function abrir(bau) {
  const r = db.abrirBauGuardado(bau.id, sortearPecas(bau.tipo));
  if (!r) return;
  entregarPecas(r.pecas);
  mostrarBau(BAUS[r.tipo].nome, r.pecas, { bau: r.tipo });
}

// Abre todos de uma vez: as peças saem juntas, num baú da cor do mais raro.
function abrirTodos() {
  const baus = [...db.bausGuardados()];
  if (!baus.length) return;
  const melhor = TIPOS.find(t => baus.some(b => b.tipo === t));
  const pecas = baus.flatMap(b => db.abrirBauGuardado(b.id, sortearPecas(b.tipo))?.pecas ?? []);
  entregarPecas(pecas);
  mostrarBau(`${baus.length} baús`, pecas, { bau: melhor });
}

export const aoEntrarNosBaus = renderBaus;
