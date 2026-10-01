// Geometria da colagem, em unidades de board (largura = BOARD.W).
//
// Mora num arquivo só porque duas coisas diferentes desenham a mesma colagem:
// o DOM (o que você edita) e o canvas (a exportação). Se a conta ficasse
// duplicada, o PNG sairia diferente da tela.

import { BOARD } from './config.js';

export const alturaDe = (formato) => (BOARD.FORMATOS[formato] || BOARD.FORMATOS['4:5']).h;

// Margem interna da colagem. Colagens salvas antes de a moldura sair guardavam
// a margem dentro dela; o `??` é o que faz essas continuarem abrindo certo.
export const margemDe = (board) =>
  board?.margem ?? board?.moldura?.margem ?? BOARD.MARGEM_PADRAO;

// Onde a assinatura encosta. align: 'centro' | 'esquerda' | 'direita'.
export function posAssinatura(board, W, H) {
  const a = board.assinatura;
  const m = margemDe(board);

  // A assinatura fica logo acima da margem de baixo, dentro do enquadramento.
  const base = H - m - 22;
  const topo = m + a.tamanho + 16;

  switch (a.posicao) {
    case 'superior': return { x: W / 2, y: topo, align: 'centro' };
    case 'esquerda': return { x: m + 20, y: base, align: 'esquerda' };
    case 'direita':  return { x: W - m - 20, y: base, align: 'direita' };
    default:         return { x: W / 2, y: base, align: 'centro' };
  }
}

// Área livre para as peças: dentro da margem, descontando a faixa da assinatura.
export function areaUtil(board, W, H) {
  const m = margemDe(board);
  const a = board.assinatura;
  const faixa = a?.visivel && a.texto?.trim() ? a.tamanho * 1.5 : 0;
  const folga = 26;
  return {
    x0: m + folga,
    y0: m + folga + (a?.visivel && a.posicao === 'superior' ? a.tamanho * 1.4 : 0),
    x1: W - m - folga,
    y1: H - m - folga - (a?.posicao === 'superior' ? 0 : faixa),
  };
}

export const fonteCss = (id) =>
  (BOARD.FONTES.find(f => f.id === id) || BOARD.FONTES[0]).css;

// Caixa não rotacionada da peça (usada pelo ímã e pelo laço).
export const caixaDoItem = (it, proporcao) => ({
  x: it.x, y: it.y,
  w: it.w, h: it.w / (proporcao || 1),
});
