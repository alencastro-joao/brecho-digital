// Sorteio de conjuntos.
//
// Monta um look plausível a partir de um acervo: vestido OU top+calça, um
// calçado e alguns acessórios por chance. É o mesmo miolo usado pelo botão de
// gerar do Stylist, pelo da Colagem e pelos perfis fictícios do feed — assim
// os três sorteiam com o mesmo critério.

import { BOARD, ASSINATURA_PADRAO, ancoraDaPeca, escalaMural } from './config.js';
import { proporcao } from './catalog.js';
import { alturaDe, areaUtil } from './boardgeo.js';
import { shuffle } from './util.js';

// Chance de cada categoria opcional entrar no conjunto.
const CHANCES = {
  hats: 0.55, bags: 0.5, coats: 0.35, acc: 0.4, watches: 0.25, rings: 0.2,
};

export function sortearConjunto(acervo, rnd = Math.random, { minimo = 3 } = {}) {
  const por = (cat) => acervo.filter(i => i.cat === cat);
  const um = (cat) => { const l = por(cat); return l.length ? shuffle(l, rnd)[0] : null; };

  const escolhidas = [];
  const temVestido = por('dresses').length > 0;
  const temConjunto = por('tops').length > 0 && por('pants').length > 0;

  if (temVestido && (!temConjunto || rnd() < 0.4)) {
    escolhidas.push(um('dresses'));
  } else {
    // Parte de cima é camisa OU casaco, nunca os dois e nunca nenhum.
    const comCasaco = por('coats').length > 0 && (por('tops').length === 0 || rnd() < CHANCES.coats);
    escolhidas.push(um(comCasaco ? 'coats' : 'tops'));
    escolhidas.push(um('pants'));
  }
  escolhidas.push(um('shoes'));

  for (const [cat, chance] of Object.entries(CHANCES)) {
    if (cat === 'coats') continue;
    if (rnd() < chance) escolhidas.push(um(cat));
  }

  let lista = escolhidas.filter(Boolean);

  // Guarda-roupa pequeno: completa com o que houver para não sair quase vazio,
  // sem repetir categoria nem empilhar casaco sobre camisa.
  if (lista.length < minimo) {
    const usadas = new Set(lista.map(p => p.cat));
    const cobreTronco = ['tops', 'coats', 'dresses'].some(c => usadas.has(c));
    const resto = shuffle(acervo.filter(p => !lista.includes(p) && !usadas.has(p.cat)
      && !(cobreTronco && ['tops', 'coats', 'dresses'].includes(p.cat))), rnd);
    lista = [...lista, ...resto.slice(0, minimo - lista.length)];
  }
  return lista;
}

// Converte o conjunto em camadas vestidas no avatar (usa as âncoras da categoria).
export function camadasParaAvatar(pecas, rnd = Math.random) {
  return pecas.map(peca => {
    const a = ancoraDaPeca(peca);
    return {
      itemId: peca.id,
      cat: peca.cat,
      x: a.x + (rnd() - 0.5) * 14,
      y: a.y + (rnd() - 0.5) * 20,
      escala: 0.92 + rnd() * 0.24,
      rot: (rnd() - 0.5) * 7,
      flip: false,
      z: a.z,
    };
  });
}

// ------------------------------- Colagem ----------------------------------
// A mesma ideia do look, mas para a Colagem: o conjunto vira peças espalhadas
// numa grade com folga e leve inclinação. Devolve a colagem inteira — margem,
// assinatura e itens —, que é o que render.js pede para desenhar.
//
// Sem DOM e sem tocar no editor: quem chama pode ser o botão de sortear da
// Colagem (que passa `base` para manter o enquadramento que você escolheu) ou
// o feed, montando a colagem de um perfil fictício do nada.

export function colagemAleatoria(pecas, rnd = Math.random, { base = null, assinatura = null } = {}) {
  const board = {
    nome: '',
    formato: base?.formato ?? BOARD.FORMATO_PADRAO,
    margem: base?.margem ?? BOARD.MARGEM_PADRAO,
    assinatura: { ...ASSINATURA_PADRAO, ...(base?.assinatura ?? {}), ...(assinatura ?? {}) },
    itens: [],
    guias: { h: [], v: [] },
  };

  // A grade cabe na área útil — margem e assinatura já descontadas —, e o
  // deslocamento sorteado dentro de cada célula é o que faz a colagem não
  // parecer planilha. É o mesmo cálculo do "espalhar" da Colagem.
  const area = areaUtil(board, BOARD.W, alturaDe(board.formato));
  const util = { w: area.x1 - area.x0, h: area.y1 - area.y0 };
  const colunas = Math.max(1, Math.ceil(Math.sqrt(pecas.length * (util.w / util.h))));
  const linhas = Math.ceil(pecas.length / colunas);
  const cw = util.w / colunas;
  const ch = util.h / linhas;

  board.itens = pecas.map((peca, i) => {
    const coluna = i % colunas;
    const linha = Math.floor(i / colunas);
    const cabe = Math.min(cw * 0.9, ch * 0.9 * proporcao(peca));
    return {
      itemId: peca.id,
      cat: peca.cat,
      x: area.x0 + cw * (coluna + 0.5) + (rnd() - 0.5) * cw * 0.25,
      y: area.y0 + ch * (linha + 0.5) + (rnd() - 0.5) * ch * 0.25,
      w: Math.max(50, cabe * escalaMural(peca) * (0.9 + rnd() * 0.25)),
      rot: (rnd() - 0.5) * 16,
      flip: false,
      opacidade: 100,
      sombra: true,
      travado: false,
      z: i + 1,
    };
  });

  return board;
}
