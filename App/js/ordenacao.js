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
import { ico } from './icones.js';

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
// peça cai. O sentido não entra no nome: a seta ao lado do seletor inverte
// qualquer um (ver `invertida`).
const ORDENS = {
  manual:    { nome: 'Minha ordem',
               cmp: (a, b) => a.ordem - b.ordem },
  raridade:  { nome: 'Raridade',
               cmp: (a, b) => (NIVEL[b.raridade] ?? 0) - (NIVEL[a.raridade] ?? 0) || quando(b) - quando(a),
               grupo: p => (RARIDADE[p.raridade] || RARIDADE.common).nome },
  recentes:  { nome: 'Data',
               cmp: (a, b) => quando(b) - quando(a), grupo: mesAno },
  favoritas: { nome: 'Favoritas',
               cmp: (a, b) => (b.favorito ? 1 : 0) - (a.favorito ? 1 : 0) || a.ordem - b.ordem,
               grupo: p => p.favorito ? 'Favoritas' : 'Outras' },
  cor:       { nome: 'Cor',
               cmp: (a, b) => porTexto(corDe(a), corDe(b)) || a.ordem - b.ordem, grupo: corDe },
  marca:     { nome: 'Marca',
               cmp: (a, b) => porTexto(marcaDe(a), marcaDe(b)) || a.ordem - b.ordem, grupo: marcaDe },
  // Segue a organização escolhida: por tipo de peça ou por parte do corpo.
  categoria: { nome: 'Categoria',
               cmp: (a, b) => compararPorGrupo(a, b) || a.ordem - b.ordem,
               grupo: p => agrupamento().grupos[grupoDe(p)]?.nome || 'Outras' },
  origem:    { nome: 'Origem',
               cmp: (a, b) => porTexto(origemDe(a), origemDe(b)) || quando(b) - quando(a), grupo: origemDe },
};

// Antes a escolha morava só no navegador, com a chave do closet: quem já
// tinha escolhido continua com ela até trocar de novo.
const CHAVE_ANTIGA = 'closet.ordem';
export function ordemAtual() {
  const salva = db.state.usuario.preferencias?.ordem;
  if (salva === 'antigas') return 'recentes';   // virou "Data" com a seta invertida
  if (salva in ORDENS) return salva;
  try {
    const antiga = localStorage.getItem(CHAVE_ANTIGA);
    if (antiga in ORDENS) return antiga;
  } catch {}
  return 'manual';
}

// O sentido: cada modo tem o natural (raridade maior primeiro, data mais
// recente primeiro, A→Z); a seta inverte. "Mais antigas" de antes já nasce
// invertida.
export function invertida() {
  const pref = db.state.usuario.preferencias || {};
  if (typeof pref.ordemInvertida === 'boolean') return pref.ordemInvertida;
  return pref.ordem === 'antigas';
}

export function ordenar(pecas) {
  const cmp = ORDENS[ordemAtual()].cmp;
  return pecas.sort(invertida() ? (a, b) => cmp(b, a) : cmp);
}

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

// O "Organizar" que as três telas mostram: o <select> do modo e, ao lado, a
// seta que inverte o sentido.
export function seletorDeOrdem(aoTrocar) {
  const atual = ordemAtual();
  const pref = () => db.state.usuario.preferencias;
  const seta = el('button', { type: 'button', class: 'ordem-sentido' });
  const rotular = () => {
    const inv = invertida();
    seta.replaceChildren(ico(inv ? 'seta-cima' : 'seta-baixo'));
    seta.title = inv ? 'Ordem invertida — tocar volta ao normal' : 'Inverter a ordem';
    seta.setAttribute('aria-label', seta.title);
    seta.classList.toggle('on', inv);
  };
  seta.addEventListener('click', () => {
    pref().ordemInvertida = !invertida();
    db.salvar();
    rotular();
    aoTrocar(ordemAtual());
  });
  rotular();
  const select = el('select', {
    class: 'ordem-sel', title: 'Como organizar as peças', 'aria-label': 'Organizar as peças',
    onchange: (e) => {
      // Quem tinha "Mais antigas" guardado passa a ter a seta explícita.
      if (typeof pref().ordemInvertida !== 'boolean') pref().ordemInvertida = invertida();
      pref().ordem = e.target.value;
      db.salvar();
      aoTrocar(e.target.value);
    },
  }, ...Object.entries(ORDENS).map(([id, o]) =>
    el('option', { value: id, selected: id === atual }, o.nome)));
  return el('span', { class: 'ordem-ctrl' }, select, seta);
}
