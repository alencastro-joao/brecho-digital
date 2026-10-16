// Proporção do personagem: cabeça maior, tronco menor.
//
// O corpo (CORPOS em config.js), os cortes de cabelo, os narizes, as
// roupinhas e as âncoras das peças fotografadas foram todos desenhados à mão
// num boneco de 8 cabeças, com coordenada fixa. Mudar a proporção redesenhando
// tudo isso seria refazer o acervo inteiro — então ninguém redesenha: o desenho
// continua no boneco antigo (o "molde") e a proporção é aplicada na hora de
// desenhar, uma escala por região do corpo.
//
// - tronco: tronco, pescoço, braços, mãos e tudo que se veste neles. Encolhe
//   em direção à linha do cós (y=572), onde a camisa termina e a calça começa
//   — assim a barra da camisa continua encostando na calça.
// - cabeça: cabeça, cabelo, nariz, chapéu, óculos. Cresce a partir da base do
//   pescoço e acompanha o ombro, que desceu junto com o tronco encolhido.
// - pernas e pés: ficam como estão. O chão não se mexe.
//
// A escala é a mesma nos dois eixos de propósito: a peça só fica maior ou
// menor, nunca torta. Por isso a miniatura do inventário (que se enquadra
// sozinha) e a proporção das fotos do Stylist não precisam saber de nada.
//
// Tudo que é GRAVADO continua no molde: a âncora medida de uma peça
// (`peca.ancora`) e o tamanho dela na vitrine. Quem mostra converte para o
// corpo (`ancoraNoCorpo`); quem mede no corpo converte de volta antes de
// gravar (`ancoraNoMolde`). Voltar os dois números para 1 devolve o boneco de
// antes, sem nada para desfazer.
export const PROPORCAO_PADRAO = {
  cabeca: 1.3,     // 1 = cabeça de antes
  tronco: 0.85,    // 1 = tronco de antes
  pernas: 1,       // 1 = pernas de antes
};

// Proporções em teste: abrir o site com ?proporcao=<nome> troca o boneco só
// naquela aba, sem gravar nada — as âncoras continuam no molde, então a mesma
// peça serve aos dois bonecos. Ex.: /?proporcao=chibi#/stylist
export const PROPORCOES_TESTE = {
  // tronco bem menor, pernas mais compridas, cabeça bem maior
  chibi: { cabeca: 1.45, tronco: 0.65, pernas: 1.15 },
  // o corpo desenhado pela artista (js/corpo-artista.js). Os números põem as
  // âncoras das roupas no corpo dela; [x, y] quando a largura e a altura não
  // crescem igual (tronco mais curto que largo, pernas mais grossas).
  artista: { cabeca: 1.32, tronco: [0.82, 0.718], pernas: [1.15, 1.09], corpo: 'artista' },
};
const pedida = (() => {
  try { return new URLSearchParams(globalThis.location?.search || '').get('proporcao'); }
  catch { return null; }
})();
export const PROPORCAO_EM_TESTE = PROPORCOES_TESTE[pedida] ? pedida : null;
export const PROPORCAO = PROPORCOES_TESTE[pedida] || PROPORCAO_PADRAO;

const CHAO = { x: 300, y: 1144 };     // sola do pé: as pernas crescem daqui para cima
const COS = { x: 300, y: 572 };       // o tronco encolhe na direção daqui
const PESCOCO = { x: 300, y: 208 };   // onde a cabeça encosta no tronco

// Cada região é uma escala por eixo: (x, y) → (kx·x + dx, ky·y + dy). No
// boneco de verdade kx = ky; só proporção em teste usa os dois diferentes.
const eixos = (k) => (Array.isArray(k) ? k : [k, k]);
const escalaEm = (p, k) => {
  const [kx, ky] = eixos(k);
  return { kx, ky, dx: p.x * (1 - kx), dy: p.y * (1 - ky) };
};
const aplicar = (t, x, y) => ({ x: t.kx * x + t.dx, y: t.ky * y + t.dy });
const desfazer = (t, x, y) => ({ x: (x - t.dx) / t.kx, y: (y - t.dy) / t.ky });
// Leva o ponto `de` (antes da escala) para onde está `para`.
const presoEm = (k, de, para) => {
  const [kx, ky] = eixos(k);
  return { kx, ky, dx: para.x - kx * de.x, dy: para.y - ky * de.y };
};

const NADA = { kx: 1, ky: 1, dx: 0, dy: 0 };

// As regiões de uma proporção. Pernas e pés crescem a partir do chão; o cós
// sobe junto, e o tronco vai atrás dele. A cabeça cresce em volta da base do
// pescoço e vai junto com ela para onde o tronco a levou. Mão vai no braço,
// que é do tronco: relógio, pulseira e bolsa acompanham a mão que subiu.
function regioes(P) {
  const PERNAS = escalaEm(CHAO, P.pernas);
  const TRONCO = presoEm(P.tronco, COS, aplicar(PERNAS, COS.x, COS.y));
  const CABECA = presoEm(P.cabeca, PESCOCO, aplicar(TRONCO, PESCOCO.x, PESCOCO.y));
  return { cabeca: CABECA, tronco: TRONCO, maos: TRONCO, perna: PERNAS, pes: PERNAS };
}
const REGIAO = regioes(PROPORCAO);
const REGIAO_PADRAO = regioes(PROPORCAO_PADRAO);
const daRegiao = (regiao) => REGIAO[regiao] || NADA;

const nn = (v) => Math.round(v * 100) / 100;

// O quanto a região cresce. Quem desenha contorno divide a espessura por ela:
// a linha do personagem tem a mesma grossura na cabeça grande e no tronco
// pequeno.
export const escalaDe = (regiao) => {
  const t = daRegiao(regiao);
  return Math.sqrt(t.kx * t.ky);
};

// SVG: o desenho de uma região, já na proporção.
export function naRegiao(regiao, svg) {
  const t = daRegiao(regiao);
  if (!svg || !svg.trim() || t === NADA || (t.kx === 1 && t.ky === 1 && !t.dx && !t.dy)) return svg;
  return `<g transform="matrix(${nn(t.kx)} 0 0 ${nn(t.ky)} ${nn(t.dx)} ${nn(t.dy)})">${svg}</g>`;
}

// Ponto de ancoragem { x, y, w } do molde para o corpo, e de volta.
export function ancoraNoCorpo(regiao, a) {
  const t = daRegiao(regiao);
  const p = aplicar(t, a.x, a.y);
  return { ...a, x: p.x, y: p.y, w: a.w * t.kx };
}

export function ancoraNoMolde(regiao, a) {
  const t = daRegiao(regiao);
  const p = desfazer(t, a.x, a.y);
  return { ...a, x: p.x, y: p.y, w: a.w / t.kx };
}

// Recorte [x, y, w, h] de uma região (a miniatura que mostra só a cabeça).
export function recorteNaRegiao(regiao, [x, y, w, h]) {
  const t = daRegiao(regiao);
  const p = aplicar(t, x, y);
  return [p.x, p.y, w * t.kx, h * t.ky];
}

// Ponto do palco gravado num look (no boneco de verdade) para o boneco em
// teste, e de volta. Os looks salvos continuam no boneco de verdade: abrir no
// teste converte, salvar no teste desconverte. Sem teste, não muda nada.
export function doPadraoParaAtual(regiao, { x, y }) {
  const m = desfazer(REGIAO_PADRAO[regiao] || NADA, x, y);
  return aplicar(daRegiao(regiao), m.x, m.y);
}
export function doAtualParaPadrao(regiao, { x, y }) {
  const m = desfazer(daRegiao(regiao), x, y);
  return aplicar(REGIAO_PADRAO[regiao] || NADA, m.x, m.y);
}

// O corpo desenhado que substitui o de código nesta proporção (ou null).
export const CORPO_EM_TESTE = PROPORCAO.corpo || null;

// Roupinha → região. O slot diz quase tudo; o Acessório mistura rosto (óculos,
// bandana, z ≥ 60) com mão e pescoço (luva, relógio, corrente), e a camada da
// peça é o que já separa um do outro.
export function regiaoDaRoupinha(r, z) {
  if (r.slot === 'cabeca') return 'cabeca';
  if (r.slot === 'acessorio') return z >= 60 ? 'cabeca' : 'tronco';
  if (r.slot === 'torso' || r.slot === 'cintura') return 'tronco';
  if (r.slot === 'pernas' || r.slot === 'pes') return 'perna';
  return null;
}
