// Efeitos de conjunto: o que vestir itens parecidos faz.
//
// Cada item do avatar tem três atributos — marca, cor e estilo (ver
// roupinhas.atributosDe) — e eles se combinam no corpo, como as sinergias de
// um jogo de RPG: 2 itens com o mesmo atributo ativam o efeito, 3 e 4 o
// reforçam. Os três correm juntos, então 3 azuis de marcas diferentes ativam
// o efeito da cor mesmo sem conjunto de marca nenhum.
//
// Cada atributo age numa área, para os bônus não se somarem no mesmo número:
//   marca  → garimpo (o efeito próprio de cada coleção, em config.COLECOES)
//   cor    → loja (mais peças daquela cor na arara)
//   estilo → visual (brilho no avatar)
//
// Aqui só se calcula o que está ativo; quem aplica cada efeito é a tela dele.

import { colecao, ESTILOS } from './config.js';
import { roupinha, atributosDe } from './roupinhas.js';

// Quantos itens iguais → quanto de bônus. A marca tem um degrau a mais: a
// coleção inteira vestida vale +20%, mesmo que ela tenha só 2 ou 3 itens.
export const DEGRAUS = [
  { n: 2, pct: 5 },
  { n: 3, pct: 10 },
  { n: 4, pct: 15 },
  { n: 5, pct: 20 },
];
export const BONUS_COLECAO_COMPLETA = 20;

const TIPOS = {
  marca:  { nome: 'Marca',  area: 'garimpo' },
  cor:    { nome: 'Cor',    area: 'loja' },
  estilo: { nome: 'Tema',   area: 'visual' },
};

function textoDoEfeito(tipo, valor, pct) {
  if (tipo === 'marca') return colecao(valor)?.efeito.texto ?? '';
  if (tipo === 'cor') return `Mais peças ${valor.toLowerCase()} na sua arara`;
  return `Brilho ${ESTILOS[valor]?.nome ?? valor} no seu avatar`;
}

const degrauDe = (n) => [...DEGRAUS].reverse().find(d => n >= d.n) ?? null;
const proximoDegrau = (n) => DEGRAUS.find(d => d.n > n) ?? null;

// `equipado` é o que db.roupasEquipadas() devolve: { slot: id }.
// Devolve uma linha por marca, cor e estilo vestidos, com o que está ativo
// (`pct` > 0) e o que falta para o próximo degrau.
export function efeitosDoLook(equipado) {
  const grupos = new Map();
  const somar = (tipo, valor, nome) => {
    if (!valor) return;
    const chave = tipo + ':' + valor;
    const g = grupos.get(chave) || { tipo, valor, nome, n: 0 };
    g.n++;
    grupos.set(chave, g);
  };
  for (const id of Object.values(equipado || {})) {
    const r = roupinha(id);
    if (!r) continue;
    const a = atributosDe(r);
    somar('marca', a.colecao, a.marca);
    somar('cor', a.cor, a.cor);
    somar('estilo', a.estilo, a.estiloNome);
  }

  return [...grupos.values()].map(g => {
    let pct = degrauDe(g.n)?.pct ?? 0;
    let completa = false;
    let proximo = proximoDegrau(g.n);
    let meta = proximo?.n ?? null;
    if (g.tipo === 'marca') {
      const total = colecao(g.valor)?.itens.length ?? 0;
      completa = total >= 2 && g.n >= total;
      if (completa) { pct = BONUS_COLECAO_COMPLETA; proximo = null; meta = null; }
      else if (proximo && proximo.n >= total) { proximo = { n: total, pct: BONUS_COLECAO_COMPLETA }; meta = total; }
    }
    return {
      ...g,
      tipoNome: TIPOS[g.tipo].nome,
      area: TIPOS[g.tipo].area,
      pct, completa, ativo: pct > 0,
      proximo: proximo && { n: proximo.n, pct: proximo.pct, faltam: proximo.n - g.n },
      meta,
      texto: textoDoEfeito(g.tipo, g.valor, pct || proximo?.pct || 0),
    };
  });
}

// O bônus de um tipo de efeito, somado entre as marcas vestidas que o têm.
// Ex.: bonusDeEfeito(equipado, 'raridade-acima') → 10 (por cento).
export function bonusDeEfeito(equipado, tipoDoEfeito) {
  return efeitosDoLook(equipado)
    .filter(e => e.ativo && e.tipo === 'marca' && colecao(e.valor)?.efeito.tipo === tipoDoEfeito)
    .reduce((soma, e) => soma + e.pct, 0);
}

// As marcas vestidas com o efeito ativo, para quem precisa saber qual marca
// (o efeito "mais peças da marca na arara").
export const marcasAtivas = (equipado) => efeitosDoLook(equipado)
  .filter(e => e.ativo && e.tipo === 'marca')
  .map(e => ({ colecao: colecao(e.valor), pct: e.pct }));

// As cores vestidas com o efeito ativo (o efeito "mais peças da cor na arara").
export const coresAtivas = (equipado) => efeitosDoLook(equipado)
  .filter(e => e.ativo && e.tipo === 'cor')
  .map(e => ({ cor: e.valor, pct: e.pct }));

export const estiloAtivo = (equipado) => efeitosDoLook(equipado)
  .filter(e => e.ativo && e.tipo === 'estilo')
  .sort((a, b) => b.pct - a.pct)[0] ?? null;

// O brilho do estilo mais vestido, como filtro CSS para o SVG do avatar.
// Cresce com o degrau: +5% é um contorno leve, +20% um halo forte.
export function brilhoDoEstilo(equipado) {
  const e = estiloAtivo(equipado);
  const cor = e && ESTILOS[e.valor]?.brilho;
  if (!cor) return '';
  const raio = Math.round(e.pct * 0.9);
  return `drop-shadow(0 0 ${raio}px ${cor}) drop-shadow(0 0 ${Math.round(raio / 3)}px ${cor})`;
}
