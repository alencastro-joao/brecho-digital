// As duas formas de organizar as telas de roupa — por tipo de peça (Camisas,
// Saias, Óculos...) ou por parte do corpo (Cabeça, Tronco, Perna, Pés, Mãos).
//
// É uma escolha só, guardada nas preferências: trocar no closet troca também
// no Stylist e na Colagem. Só organiza a vista; a peça continua gravada com a
// categoria, e a parte do corpo sai dela (ver CATEGORIAS em config.js).

import { AGRUPAMENTOS, ORDEM_CATEGORIAS } from './config.js';
import { item as pecaDoCatalogo } from './catalog.js';
import * as db from './db.js';
import { el } from './util.js';

export const agrupamento = () =>
  AGRUPAMENTOS[db.state.usuario.preferencias?.agrupamento] ?? AGRUPAMENTOS.tipo;

// A categoria vem do catálogo, não da cópia guardada no inventário: se o
// admin reclassifica a peça, as telas acompanham sem mexer no save de ninguém.
export const categoriaDe = (p) => pecaDoCatalogo(p.id)?.cat ?? p.cat;

// Em que grupo da organização escolhida a peça cai.
export const grupoDe = (p) => agrupamento().de(categoriaDe(p));

// Os grupos que aparecem nas abas, na ordem, com nome, ícone e quantas peças
// do inventário caem em cada um.
export function gruposDoInventario() {
  const ag = agrupamento();
  return ag.ordem.map(id => ({
    id, ...ag.grupos[id],
    qtd: db.state.inventario.filter(p => grupoDe(p) === id).length,
  }));
}

// Ordem de "todas as peças": pelo grupo e, dentro de Tronco, Perna etc., pelo
// tipo — a camisa não fica no meio das saias.
export function compararPorGrupo(a, b) {
  const ordem = agrupamento().ordem;
  return ordem.indexOf(grupoDe(a)) - ordem.indexOf(grupoDe(b))
    || ORDEM_CATEGORIAS.indexOf(categoriaDe(a)) - ORDEM_CATEGORIAS.indexOf(categoriaDe(b));
}

// O seletor [Peça | Corpo] que as três telas mostram em cima das abas.
export function seletorDeAgrupamento(aoTrocar) {
  const atual = db.state.usuario.preferencias?.agrupamento in AGRUPAMENTOS
    ? db.state.usuario.preferencias.agrupamento : 'tipo';
  return el('div', { class: 'agrupar', role: 'group', 'aria-label': 'Organizar as peças' },
    ...Object.entries(AGRUPAMENTOS).map(([id, ag]) => el('button', {
      type: 'button',
      class: 'agrupar-op' + (id === atual ? ' active' : ''),
      title: ag.titulo,
      'aria-pressed': String(id === atual),
      onclick: () => {
        if (id === atual) return;
        db.state.usuario.preferencias.agrupamento = id;
        db.salvar();
        aoTrocar(id);
      },
    }, ag.nome)));
}
