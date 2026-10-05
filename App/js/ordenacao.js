// O "Organizar" das telas de roupa: em que ordem as peças aparecem e, quando
// faz sentido, em que grupos com rótulo a grade se separa.
//
// Como o [Peça | Corpo] de agrupamento.js, é uma escolha só, guardada nas
// preferências: trocar no closet troca também no Stylist e na Colagem. Só
// ordena a vista; o `ordem` gravado no inventário (a "Minha ordem", que se
// arrasta no closet) não muda.

import { RARIDADE, RARIDADES } from './config.js';
import { item as pecaDoCatalogo } from './catalog.js';
import { agrupamento, grupoDe, compararPorGrupo } from './agrupamento.js';
import * as db from './db.js';
import { el } from './util.js';

const NIVEL = Object.fromEntries(RARIDADES.map((r, i) => [r.id, i]));
const ORIGENS = { collab: 'Cápsula do mês', propria: 'Peças suas', teste: 'Teste', vitrine: 'Garimpo' };
const quando = p => new Date(p.obtidoEm).getTime() || 0;
// Cor e marca são campo livre: "verde", "Verde " e "VERDE" têm que cair no
// mesmo grupo. Normaliza espaços (inclusive o não-separável) e a caixa, e
// devolve com só a primeira letra maiúscula.
const texto = (v, vazio) => {
  const t = (v || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR');
  return t ? t[0].toLocaleUpperCase('pt-BR') + t.slice(1) : vazio;
};
export const porTexto = (a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });

function mesAno(p) {
  const d = new Date(p.obtidoEm);
  if (isNaN(d)) return 'Sem data';
  const s = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s[0].toUpperCase() + s.slice(1);
}
const corDe = p => texto(pecaDoCatalogo(p.id)?.cor, 'Sem cor');
const marcaDe = p => texto(pecaDoCatalogo(p.id)?.marca, 'Sem marca');
const origemDe = p => ORIGENS[p.origem] || 'Garimpo';

// Cada modo: o nome no seletor, como comparar e (opcional) em que grupo a
// peça cai.
const ORDENS = {
  manual:    { nome: 'Minha ordem',
               cmp: (a, b) => a.ordem - b.ordem },
  raridade:  { nome: 'Raridade (maior primeiro)',
               cmp: (a, b) => (NIVEL[b.raridade] ?? 0) - (NIVEL[a.raridade] ?? 0) || quando(b) - quando(a),
               grupo: p => (RARIDADE[p.raridade] || RARIDADE.common).nome },
  recentes:  { nome: 'Mais recentes',
               cmp: (a, b) => quando(b) - quando(a), grupo: mesAno },
  antigas:   { nome: 'Mais antigas',
               cmp: (a, b) => quando(a) - quando(b), grupo: mesAno },
  favoritas: { nome: 'Favoritas primeiro',
               cmp: (a, b) => (b.favorito ? 1 : 0) - (a.favorito ? 1 : 0) || a.ordem - b.ordem,
               grupo: p => p.favorito ? 'Favoritas' : 'Outras' },
  cor:       { nome: 'Por cor',
               cmp: (a, b) => porTexto(corDe(a), corDe(b)) || a.ordem - b.ordem, grupo: corDe },
  marca:     { nome: 'Por marca',
               cmp: (a, b) => porTexto(marcaDe(a), marcaDe(b)) || a.ordem - b.ordem, grupo: marcaDe },
  // Segue a organização escolhida: por tipo de peça ou por parte do corpo.
  categoria: { nome: 'Por categoria',
               cmp: (a, b) => compararPorGrupo(a, b) || a.ordem - b.ordem,
               grupo: p => agrupamento().grupos[grupoDe(p)]?.nome || 'Outras' },
  origem:    { nome: 'Por origem',
               cmp: (a, b) => porTexto(origemDe(a), origemDe(b)) || quando(b) - quando(a), grupo: origemDe },
};

// Antes a escolha morava só no navegador, com a chave do closet: quem já
// tinha escolhido continua com ela até trocar de novo.
const CHAVE_ANTIGA = 'closet.ordem';
export function ordemAtual() {
  const salva = db.state.usuario.preferencias?.ordem;
  if (salva in ORDENS) return salva;
  try {
    const antiga = localStorage.getItem(CHAVE_ANTIGA);
    if (antiga in ORDENS) return antiga;
  } catch {}
  return 'manual';
}

export const ordenar = (pecas) => pecas.sort(ORDENS[ordemAtual()].cmp);

// Monta a grade com os rótulos de grupo entre as peças. `criar` devolve o nó
// da peça (ou nada, para pular). Dentro de uma aba de categoria, ordenar "por
// categoria" daria um grupo só — aí fica sem rótulo.
export function preencherComGrupos(grid, pecas, criar, { categoriaAberta = false } = {}) {
  const modo = ordemAtual();
  const grupo = !(modo === 'categoria' && categoriaAberta) && ORDENS[modo].grupo;
  let ultimo = null;
  for (const p of pecas) {
    const no = criar(p);
    if (!no) continue;
    if (grupo) {
      const g = grupo(p);
      // Compara sem acento/caixa, igual ao sort, para não partir um grupo.
      if (ultimo === null || porTexto(g, ultimo) !== 0) {
        grid.append(el('h3', { class: 'grupo-rotulo' }, g));
        ultimo = g;
      }
    }
    grid.append(no);
  }
}

// O <select> "Organizar" que as três telas mostram.
export function seletorDeOrdem(aoTrocar) {
  const atual = ordemAtual();
  return el('select', {
    class: 'ordem-sel', title: 'Como organizar as peças', 'aria-label': 'Organizar as peças',
    onchange: (e) => {
      db.state.usuario.preferencias.ordem = e.target.value;
      db.salvar();
      aoTrocar(e.target.value);
    },
  }, ...Object.entries(ORDENS).map(([id, o]) =>
    el('option', { value: id, selected: id === atual }, o.nome)));
}
