// Coleções (#/colecoes): uma página por marca da loja.
//
// Cada coleção mostra as peças da marca no acervo — as que você já garimpou e,
// em cinza, as que faltam — e os itens do avatar que ela libera. A tela abre
// pelo cartão "Coleções" da aba Tarefas e pelos emblemas do perfil; o botão de
// Tarefas fica aceso enquanto ela está aberta (ver BOTAO_DA_VIEW, router.js).
//
// Nada aqui é gravado: o progresso é o guarda-roupa lido na hora
// (db.progressoDasColecoes), do mesmo jeito que o nível é lido do XP.

import { COLECOES, ESTILOS, escalaGrade, RARIDADE } from './config.js';
import { item as pecaDoCatalogo, nomeDaPeca } from './catalog.js';
import { roupinha, svgRoupinha } from './roupinhas.js';
import { aparenciaAtual } from './avatar.js';
import * as db from './db.js';
import { el, $ } from './util.js';
import { irPara, viewAtual } from './router.js';

let filtro = 'todas';

const FILTROS = [
  ['todas', 'Todas'],
  ['perto', 'Perto de fechar'],
  ['completas', 'Completas'],
];

// As coleções com o progresso de cada uma, na ordem de quem está mais perto
// de fechar. Coleção sem peça no acervo (marca que saiu) não aparece.
export function minhasColecoes() {
  const prog = db.progressoDasColecoes();
  return COLECOES
    .map(c => ({ ...c, ...prog[c.id] }))
    .filter(c => c.total > 0)
    .map(c => ({ ...c, completa: c.tem >= c.total, pct: c.tem / c.total }));
}

// A mais perto de fechar sem estar fechada; empate vai para a que falta menos.
export function colecaoMaisPerto() {
  const abertas = minhasColecoes().filter(c => !c.completa);
  if (!abertas.length) return null;
  return abertas.sort((a, b) =>
    (b.pct - a.pct) || ((a.total - a.tem) - (b.total - b.tem)))[0];
}

// A peça que representa a coleção num emblema: a primeira que você tem, ou a
// primeira do acervo quando ainda não tem nenhuma.
export function capaDaColecao(c) {
  const minha = c.ids.find(id => db.temPeca(id));
  return pecaDoCatalogo(minha ?? c.ids[0]) || null;
}

export function montarColecoes() {
  db.onChange(() => { if (viewAtual() === 'colecoes') renderColecoes(); });
  $('#col-voltar').addEventListener('click', () => irPara('tarefas'));
}

export function renderColecoes() {
  const todas = minhasColecoes();
  const completas = todas.filter(c => c.completa).length;
  $('#col-resumo').textContent =
    `${completas} de ${todas.length} ${todas.length === 1 ? 'completa' : 'completas'}`;

  $('#col-filtros').replaceChildren(...FILTROS.map(([id, rotulo]) =>
    el('button', {
      class: 'col-filtro' + (filtro === id ? ' ativo' : ''),
      onclick: () => { filtro = id; renderColecoes(); },
    }, rotulo)));

  const lista = todas
    .filter(c => filtro === 'todas' ||
      (filtro === 'completas' ? c.completa : !c.completa && c.tem > 0))
    .sort((a, b) => Number(b.completa) - Number(a.completa) || b.pct - a.pct);

  $('#col-lista').replaceChildren(...(lista.length ? lista.map(cartaoDaColecao) : [
    el('p', { class: 'col-vazio' }, filtro === 'completas'
      ? 'Nenhuma coleção completa ainda. Garimpe as peças que faltam na vitrine.'
      : 'Nenhuma coleção começada. A primeira peça de uma marca já abre um item do avatar.'),
  ]));
}

function cartaoDaColecao(c) {
  const estilo = ESTILOS[c.estilo];
  return el('section', { class: 'col-cartao' + (c.completa ? ' completa' : '') },
    el('header', { class: 'col-topo' },
      el('div', { class: 'col-titulo' },
        el('h2', {}, c.marca),
        estilo ? el('span', { class: 'col-estilo' }, estilo.nome) : null),
      el('small', { class: 'col-conta' }, c.completa ? '✓ Completa' : `${c.tem} de ${c.total}`)),
    el('div', { class: 'col-pecas' }, ...c.ids.map(id => casaDaPeca(id))),
    c.completa ? null : el('div', { class: 'barra' },
      el('span', { style: { width: (c.pct * 100) + '%' } })),
    el('div', { class: 'col-itens' },
      el('h3', {}, 'Itens do avatar'),
      el('div', { class: 'col-itens-lista' }, ...c.itens.map(id => itemDaColecao(id)).filter(Boolean))),
    el('p', { class: 'col-efeito' },
      el('strong', {}, 'Efeito ao vestir: '), c.efeito.texto,
      el('span', { class: 'col-breve' }, c.itens.length > 2 ? '2 itens +5% · completa +20%' : 'completa +20%')));
}

function casaDaPeca(id) {
  const peca = pecaDoCatalogo(id);
  if (!peca) return null;
  const tem = db.temPeca(id);
  const rar = RARIDADE[peca.raridade];
  return el('div', {
    class: 'col-peca' + (tem ? '' : ' falta'),
    title: tem ? nomeDaPeca(peca) : `Falta: ${nomeDaPeca(peca)}${rar ? ` (${rar.nome.toLowerCase()})` : ''}`,
  },
    el('div', { class: 'peca-caixa', style: { '--esc': String(escalaGrade(peca)) } },
      el('img', { src: peca.src, alt: nomeDaPeca(peca), loading: 'lazy' })));
}

function itemDaColecao(id) {
  const r = roupinha(id);
  if (!r) return null;
  const e = db.estadoDaRoupinha(r);
  const arte = el('div', { class: 'col-item-arte' });
  arte.innerHTML = svgRoupinha(r, aparenciaAtual().corpo);
  return el('button', {
    class: 'col-item' + (e.liberada ? ' aberto' : ''),
    title: e.liberada ? `${r.nome}: no seu inventário` : e.rotulo,
    onclick: () => { if (e.liberada) irPara('vestiario'); },
  },
    arte,
    el('div', { class: 'col-item-info' },
      el('strong', {}, r.nome),
      el('small', {}, e.liberada ? '✓ No inventário' : `🔒 ${e.rotulo}`)));
}

export const aoEntrarNasColecoes = renderColecoes;
