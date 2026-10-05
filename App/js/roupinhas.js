// Roupinhas: a coleção de roupas desenhadas que veste o avatar.
//
// São outra coisa das peças do Stylist. Aquelas são recorte de roupa real,
// fotografada, e o avatar entra pelado embaixo delas — é colagem sobre o
// corpo. Estas são desenho, no mesmo traço do personagem, e nascem do jogo:
// cada uma abre com um nível ou com missão cumprida. É o que o perfil mostra.
//
// O desenho segue o mesmo contrato do corpo (CORPOS em js/config.js):
// `arte(m, extra)` devolve as formas, `extra` é o quanto elas engordam para
// virar contorno, e nada aqui pinta a si mesmo — a cor vem do grupo que
// envolve tudo (ver `desenhar`). Quem precisa de cor própria — bolso, botão,
// zíper — põe em `detalhe`, que é desenhado por cima das duas passadas.
//
// A roupa serve os dois corpos porque não tem coordenada fixa de cintura: ela
// lê `CORPOS[*].medidas`. Manga e calça são o próprio braço e a própria perna
// do corpo, engordados e cortados na altura que a peça pede — por isso a
// bermuda do corpo estreito não fica larga, e a manga cai no mesmo pulso.

import { CONFIG, CORPOS } from './config.js';
import { mulberry32, sementeDoTexto, escolher } from './util.js';
import { naRegiao, escalaDe, regiaoDaRoupinha } from './proporcao.js';

// ----------------------------- Lugares do corpo ---------------------------
// Os seis slots do vestiário. `z` é a camada de quem é desenhado depois do
// corpo; quem vai atrás dele (mochila, capa, capuz) usa `atras` na própria
// peça. Slot que junta coisas diferentes — Acessório guarda tanto óculos
// quanto luvas — deixa a peça mandar: `z` na própria peça vence o do slot, e
// é por isso que o óculos continua na frente do rosto e a luva continua na
// mão, no mesmo lugar em que estavam quando eram slots separados.
//
// Não há enquadramento de miniatura aqui: a casa do inventário mostra a peça
// solta, e o enquadramento dela é medido do próprio desenho (svgRoupinha).
//
// Peça de cabeça que cobre o cabelo declara `cabelo: <y>` — a altura a partir
// da qual o cabelo continua aparecendo. Quem só apoia em cima dele (coroa,
// fones) não declara nada, e o cabelo fica inteiro.
export const SLOTS = {
  cabeca:    { nome: 'Cabeça',    icone: '🎩', z: 65 },
  torso:     { nome: 'Tronco',    icone: '👕', z: 30 },
  pernas:    { nome: 'Pernas',    icone: '👖', z: 20 },
  acessorio: { nome: 'Acessório', icone: '🕶️', z: 62 },
  cintura:   { nome: 'Cintura',   icone: '🎒', z: 34 },
  pes:       { nome: 'Pés',       icone: '👟', z: 28 },
};

// A ordem é a das duas colunas do inventário, de cima para baixo: a primeira
// metade fica à esquerda do personagem, a segunda à direita. Mexer aqui move
// as caixas na tela — não há lista de posições em outro lugar.
export const ORDEM_SLOTS = Object.keys(SLOTS);

export const medidasDoCorpo = (corpo) => (CORPOS[corpo] || CORPOS.masculino).medidas;

// ------------------------------- Cor --------------------------------------
// O contorno de cada peça é ela mesma, mais escura: uma cor por roupa basta, e
// nenhuma escolha do jogador produz um contorno que destoa.
export function escurecer(hex, t = 0.34) {
  const n = parseInt(String(hex).slice(1), 16);
  const f = (c) => Math.round(c * (1 - t));
  return '#' + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)]
    .map(v => v.toString(16).padStart(2, '0')).join('');
}

// ------------------------- Geometria dos membros --------------------------
// Braço e perna do corpo são curvas cúbicas com os mesmos Y nos dois corpos —
// só o X muda, e está em CORPOS[*].medidas. A manga e a calça reaproveitam a
// curva: mesma linha, traço mais grosso. Assim a roupa nunca descola do
// membro, em nenhum dos dois corpos.
const Y_BRACO = [262, 344, 486, 660];
const Y_PERNA = [606, 768, 924, 1086];

const espelho = (xs) => xs.map(v => 600 - v);
const nn = (v) => Math.round(v * 10) / 10;

const emT = (p, t) => {
  const u = 1 - t;
  return u * u * u * p[0] + 3 * u * u * t * p[1] + 3 * u * t * t * p[2] + t * t * t * p[3];
};

// De Casteljau. É o que deixa cortar o membro na altura que a peça pede —
// manga curta, bermuda, cano de bota, punho de luva — sem redesenhar nada.
function partes(p, t) {
  const l = (a, b) => a + (b - a) * t;
  const [a, b, c, d] = p;
  const ab = l(a, b), bc = l(b, c), cd = l(c, d);
  const abc = l(ab, bc), bcd = l(bc, cd);
  const meio = l(abc, bcd);
  return { ate: [a, ab, abc, meio], de: [meio, bcd, cd, d] };
}

// A curva só desce, então achar a altura é bissecção.
function tNaAltura(ys, y) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const md = (lo + hi) / 2;
    if (emT(ys, md) < y) lo = md; else hi = md;
  }
  return (lo + hi) / 2;
}

// O membro entre duas alturas. `ate` corta em cima da curva (o pé dela),
// `de` corta embaixo (a cabeça) — nessa ordem, porque o segundo corte é
// medido já na curva encurtada.
function traco(xs, ys, { de = null, ate = null } = {}) {
  let x = xs, y = ys;
  if (ate != null) {
    const t = tNaAltura(y, ate);
    x = partes(x, t).ate; y = partes(y, t).ate;
  }
  if (de != null) {
    const t = tNaAltura(y, de);
    x = partes(x, t).de; y = partes(y, t).de;
  }
  return `M${nn(x[0])} ${nn(y[0])} C${nn(x[1])} ${nn(y[1])} ` +
         `${nn(x[2])} ${nn(y[2])} ${nn(x[3])} ${nn(y[3])}`;
}

const parDeMembros = (xs, ys, corte, grossura, extra, ponta = 'round') =>
  [xs, espelho(xs)].map(lado =>
    `<path d="${traco(lado, ys, corte)}" fill="none"
        stroke-width="${grossura + extra}" stroke-linecap="${ponta}"/>`).join('');

// A manga nasce um pouco abaixo do ombro: a ponta redonda do traço, saindo
// da junta em y=262, virava ombreira de blazer dos anos 80 em toda peça. Daqui
// para baixo ela sai de debaixo do ombro da roupa, que já cobre a junta.
const MANGA_TOPO = 288;

const mangas = (m, x, corte = {}, folga = 16, ponta = 'round') =>
  parDeMembros(m.bracoX, Y_BRACO, { de: MANGA_TOPO, ...corte }, m.braco * 2 + folga, x, ponta);

// As duas pernas passam a 18 unidades uma da outra na canela, e toda folga
// que a calça ganha sai desse vão pelos dois lados. Acima de ~14 elas se
// encostam no meio e a calça vira saia — por isso nenhuma peça daqui passa
// disso, e o que distingue a cargo da calça é o bolso, não a largura.
const pernas = (m, x, corte = {}, folga = 12, ponta = 'round') =>
  parDeMembros(m.pernaX, Y_PERNA, corte, m.coxa * 2 + folga, x, ponta);

// Onde o membro passa numa certa altura: para prender punho, bainha e cano.
const noMembro = (xs, ys, y) => emT(xs, tNaAltura(ys, y));

// Os dois pés, as duas mãos, os dois pulsos — pelo mesmo desenho.
const nosPes = (fn) => fn(250) + fn(350);
const nasMaos = (fn) => fn(172) + fn(428);

// --------------------------- A linha do ombro -----------------------------
// O ombro do corpo (CORPOS[*].partes) sai do pescoço em y≈207 e cai até a junta
// do braço em y=262. Toda peça de cima tem que seguir essa linha por fora: a
// gola que ia reta do pescoço até a junta passava por baixo dela e deixava o
// ombro do avatar aparecendo por cima da roupa — dava para ver a pele nos dois
// ombros de qualquer camisa, jaqueta ou blazer.
//
// Os pontos saem das medidas, não de números fixos, porque os dois corpos têm
// ombros de larguras diferentes: `ombro * .54` e `peito + 7` reproduzem as
// curvas dos dois com um erro de poucas unidades, e a folga da roupa cobre a
// diferença.
const OMBRO_TOPO = 206;     // onde a gola encosta no pescoço

const linhaDoOmbro = (m, lado, folga) => {
  const s = (d) => 300 + lado * d;
  return `C${s(m.ombro * .54)} ${OMBRO_TOPO - 4} ` +
         `${s(m.peito + 7 + folga)} 230 ` +
         `${s(m.ombro + folga)} 268`;
};

// ----------------------------- Peça de cima -------------------------------
// Gola, ombro, lateral e barra. Camiseta, moletom e manto são a mesma
// silhueta: o que muda é a folga e onde ela termina.
function tronco(m, {
  gola = 14, ombro = 8, peito = 8, barra = 10, ate = 566, decote = 262,
  topo = OMBRO_TOPO,
} = {}) {
  const g = m.pescoco + gola, o = m.ombro + ombro;
  const p = m.peito + peito, b = m.barra + barra;
  const meio = (400 + ate) / 2;
  return `<path d="M${300 - g} ${topo}
    ${linhaDoOmbro(m, -1, ombro)}
    C${300 - p} 348 ${300 - b - 6} ${meio} ${300 - b} ${ate}
    C${300 - b + 12} ${ate + 12} ${300 + b - 12} ${ate + 12} ${300 + b} ${ate}
    C${300 + b + 6} ${meio} ${300 + p} 348 ${300 + o} 268
    C${300 + p + 7 + ombro} 230 ${300 + m.ombro * .54} ${OMBRO_TOPO - 4} ${300 + g} ${topo}
    C${300 + g - 12} ${decote} ${300 - g + 12} ${decote} ${300 - g} ${topo} Z"/>`;
}

// Metade da frente de uma peça aberta — colete, jaqueta, blazer. Do ombro
// desce pela lateral, fecha na barra e sobe até o V do decote. `lado` é -1/1.
function frenteAberta(m, lado, {
  gola = 9, ombro = 6, barra = 10, ate = 556, v = 396, meio = 12,
} = {}) {
  const s = (d) => 300 + lado * d;
  const g = m.pescoco + gola, o = m.ombro + ombro;
  const b = m.barra + barra, p = m.peito + 8;
  // Sobe pela linha do ombro, como a peça fechada: a frente aberta cobre o
  // ombro inteiro, e o que fica de fora é só o peito, que é o ponto dela.
  return `<path d="M${s(g)} ${OMBRO_TOPO}
    ${linhaDoOmbro(m, lado, ombro)}
    C${s(p)} 350 ${s(b + 6)} ${(400 + ate) / 2} ${s(b)} ${ate}
    L${s(meio)} ${ate} L${s(meio + 2)} ${v} Z"/>`;
}

// Cós: o bloco do quadril de onde as pernas saem. Calça, bermuda e cargo
// dividem — o que muda é onde a perna termina.
function cos(m) {
  const q = m.quadril + 8, v = m.virilha + 8;
  return `<path d="M${300 - q} 572 L${300 + q} 572 L${300 + v} 724 L${300 - v} 724 Z"/>`;
}

// Costura da entreperna. As duas pernas do corpo passam a 18 unidades uma da
// outra, e o contorno da roupa come esse vão — sem esta linha por cima, calça
// e bermuda saem como um bloco só, que o olho lê como saia.
const entrepernas = (cor, ate) =>
  `<path d="M300 726 L300 ${ate}" fill="none" stroke="${escurecer(cor, .5)}"
     stroke-width="5" stroke-linecap="round" opacity=".5"/>`;

// Bainha: o anel que fecha a calça na altura do corte, para o tubo não morrer
// numa ponta solta.
function bainha(m, y, folga) {
  const cx = noMembro(m.pernaX, Y_PERNA, y - 6);
  return [cx, 600 - cx].map(x =>
    `<ellipse cx="${nn(x)}" cy="${y - 6}" rx="${m.coxa + folga / 2}" ry="10"/>`).join('');
}

// ------------------------------- A coleção --------------------------------
// `desbloqueio.tipo` casa com METAS, mais abaixo: é o que a grade lê para
// escrever "faltam 4 peças" em vez de só um cadeado.
export const ROUPINHAS = [
  // ------------------------------ Torso -----------------------------------
  {
    id: 'camiseta', nome: 'Camiseta', slot: 'torso', raridade: 'common',
    cor: '#f0ebe3',
    desbloqueio: { tipo: 'inicial' },
    arte: (m, x) => tronco(m) + mangas(m, x, { ate: 408 }, 13),
  },
  {
    id: 'regata', nome: 'Regata', slot: 'torso', raridade: 'common',
    cor: '#e9e4dc',
    desbloqueio: { tipo: 'inicial' },
    arte: (m) => {
      const g = m.pescoco + 24, a = m.ombro - 30, p = m.peito + 8, b = m.barra + 10;
      return `<path d="M${300 - g} 230 L${300 - a} 268
        C${300 - p} 350 ${300 - b - 6} 480 ${300 - b} 572
        L${300 + b} 572
        C${300 + b + 6} 480 ${300 + p} 350 ${300 + a} 268
        L${300 + g} 230
        C${300 + g - 18} 314 ${300 - g + 18} 314 ${300 - g} 230 Z"/>`;
    },
  },
  {
    id: 'moletom', nome: 'Moletom', slot: 'torso', raridade: 'uncommon',
    cor: '#8fa5b8',
    desbloqueio: { tipo: 'nivel', meta: 3 },
    // O capuz caído fica atrás do corpo — senão ele cobriria o queixo.
    atras: () => `<path d="M214 282 C202 194 244 166 300 166
                            C356 166 398 194 386 282 Z"/>`,
    arte: (m, x) => tronco(m, { gola: 18, ombro: 10, peito: 8, barra: 12, ate: 600 })
      + mangas(m, x, {}, 19),
    detalhe: (m, cor) => `
      <path d="M${300 - 66} 474 L${300 + 66} 474 L${300 + 54} 542 L${300 - 54} 542 Z"
            fill="${escurecer(cor, .12)}" stroke="${escurecer(cor, .32)}" stroke-width="3"/>
      <path d="M284 258 L281 330 M316 258 L319 330" fill="none"
            stroke="${escurecer(cor, .34)}" stroke-width="7" stroke-linecap="round"/>`,
  },
  {
    id: 'colete', nome: 'Colete', slot: 'torso', raridade: 'uncommon',
    cor: '#6b5f52',
    desbloqueio: { tipo: 'resgates', meta: 15 },
    arte: (m) => frenteAberta(m, -1, { ate: 570 }) + frenteAberta(m, 1, { ate: 570 }),
    detalhe: () => `<circle cx="300" cy="446" r="7" fill="rgba(0,0,0,.28)"/>
                    <circle cx="300" cy="500" r="7" fill="rgba(0,0,0,.28)"/>`,
  },
  {
    id: 'jaqueta', nome: 'Jaqueta', slot: 'torso', raridade: 'rare',
    cor: '#4e6a86',
    desbloqueio: { tipo: 'nivel', meta: 6 },
    arte: (m, x) => {
      const aberta = { gola: 14, ombro: 10, barra: 14, ate: 552, v: 322, meio: 1 };
      return frenteAberta(m, -1, aberta) + frenteAberta(m, 1, aberta)
        + mangas(m, x, {}, 18)
        + `<path d="M${300 - m.barra - 16} 524 L${300 + m.barra + 16} 524
                    L${300 + m.barra + 12} 574 L${300 - m.barra - 12} 574 Z"/>`;
    },
    detalhe: (m, cor) => `
      <path d="M300 332 L300 556" fill="none" stroke="${escurecer(cor, .48)}"
            stroke-width="6" stroke-linecap="round"/>
      <path d="M${300 - m.pescoco - 16} 212 L${300 - 14} 324 L${300 - 50} 316 Z
               M${300 + m.pescoco + 16} 212 L${300 + 14} 324 L${300 + 50} 316 Z"
            fill="${escurecer(cor, .2)}" stroke="${escurecer(cor, .4)}" stroke-width="3"/>`,
  },
  {
    id: 'blazer', nome: 'Blazer', slot: 'torso', raridade: 'epic',
    cor: '#2b2f3a',
    desbloqueio: { tipo: 'looks', meta: 5 },
    arte: (m, x) => {
      const aberta = { gola: 12, ombro: 12, barra: 12, ate: 640, v: 432, meio: 14 };
      return frenteAberta(m, -1, aberta) + frenteAberta(m, 1, aberta)
        + mangas(m, x, {}, 16);
    },
    detalhe: (m, cor) => `
      <path d="M${300 - m.pescoco - 14} 212 L${300 - 18} 432 L${300 - 68} 344 Z
               M${300 + m.pescoco + 14} 212 L${300 + 18} 432 L${300 + 68} 344 Z"
            fill="${escurecer(cor, .18)}" stroke="${escurecer(cor, .42)}" stroke-width="3"/>
      <circle cx="280" cy="474" r="6" fill="rgba(255,255,255,.55)"/>
      <circle cx="280" cy="518" r="6" fill="rgba(255,255,255,.55)"/>`,
  },
  {
    id: 'manto', nome: 'Manto da coleção', slot: 'torso', raridade: 'legendary',
    cor: '#3b2f63',
    desbloqueio: { tipo: 'nivel', meta: 12 },
    arte: (m, x) => tronco(m, {
      gola: 20, ombro: 14, peito: 16, barra: 46, ate: 980, decote: 302,
    }) + mangas(m, x, {}, 26),
    detalhe: (m, cor) => {
      const estrela = (cx, cy, r) =>
        `<path d="M${cx} ${cy - r} L${cx + r * .3} ${cy - r * .3} L${cx + r} ${cy}
                  L${cx + r * .3} ${cy + r * .3} L${cx} ${cy + r}
                  L${cx - r * .3} ${cy + r * .3} L${cx - r} ${cy}
                  L${cx - r * .3} ${cy - r * .3} Z" fill="#f5e6a8" opacity=".85"/>`;
      return [[264, 470, 13], [344, 552, 9], [276, 662, 11], [352, 764, 14],
              [250, 812, 8], [330, 890, 10]].map(p => estrela(...p)).join('')
        + `<path d="M${300 - m.pescoco - 26} 272 C300 336 300 336 ${300 + m.pescoco + 26} 272"
                 fill="none" stroke="${escurecer(cor, .55)}" stroke-width="8"/>`;
    },
  },

  {
    id: 'polo', nome: 'Camisa polo', slot: 'torso', raridade: 'common',
    cor: '#5f8d78',
    desbloqueio: { tipo: 'nivel', meta: 3 },
    arte: (m, x) => tronco(m, { gola: 15, decote: 264, ate: 560 })
      + mangas(m, x, { ate: 424 }, 12),
    detalhe: (m, cor) => `
      <path d="M${300 - m.pescoco - 13} 218 L${300 - 10} 310 L${300 + 10} 310
               L${300 + m.pescoco + 13} 218 Z"
            fill="${escurecer(cor, .1)}" stroke="${escurecer(cor, .34)}" stroke-width="3"/>
      <path d="M300 288 L300 348" fill="none" stroke="${escurecer(cor, .38)}" stroke-width="4"/>
      <circle cx="300" cy="304" r="5" fill="${escurecer(cor, .45)}"/>
      <circle cx="300" cy="336" r="5" fill="${escurecer(cor, .45)}"/>`,
  },
  {
    id: 'camisa', nome: 'Camisa', slot: 'torso', raridade: 'uncommon',
    cor: '#e4e7ec',
    desbloqueio: { tipo: 'nivel', meta: 7 },
    arte: (m, x) => tronco(m, { gola: 16, ombro: 10, peito: 10, barra: 12, ate: 586 })
      + mangas(m, x, {}, 20, 'butt')
      + nasMaos(cx => `<ellipse cx="${cx}" cy="646" rx="${m.braco + 11}" ry="12"/>`),
    detalhe: (m, cor) => `
      <path d="M${300 - m.pescoco - 14} 216 L${300 - 12} 308 L${300 - 58} 288 Z
               M${300 + m.pescoco + 14} 216 L${300 + 12} 308 L${300 + 58} 288 Z"
            fill="${escurecer(cor, .08)}" stroke="${escurecer(cor, .3)}" stroke-width="3"/>
      <path d="M300 292 L300 576" fill="none" stroke="${escurecer(cor, .26)}" stroke-width="4"/>
      ${[360, 420, 480, 540].map(y =>
        `<circle cx="300" cy="${y}" r="5" fill="${escurecer(cor, .4)}"/>`).join('')}
      <rect x="${300 - m.peito + 6}" y="372" width="46" height="54" rx="6"
            fill="none" stroke="${escurecer(cor, .3)}" stroke-width="4"/>`,
  },
  {
    id: 'sueter', nome: 'Suéter de tricô', slot: 'torso', raridade: 'uncommon',
    cor: '#c98f6b',
    desbloqueio: { tipo: 'resgates', meta: 10 },
    arte: (m, x) => tronco(m, {
      gola: 22, ombro: 12, peito: 12, barra: 14, ate: 590, decote: 286,
    }) + mangas(m, x, {}, 24, 'butt')
      + nasMaos(cx => `<ellipse cx="${cx}" cy="644" rx="${m.braco + 13}" ry="14"/>`),
    // Canelado: a barra e os punhos são o mesmo traço mais escuro, que é o que
    // faz o tricô parecer tricô sem desenhar ponto por ponto.
    detalhe: (m, cor) => {
      const risca = escurecer(cor, .2);
      const tranca = (cx) => `<path d="M${cx} 330 C${cx - 16} 370 ${cx + 16} 410 ${cx} 450
        C${cx - 16} 490 ${cx + 16} 530 ${cx} 570" fill="none" stroke="${risca}"
        stroke-width="6" stroke-linecap="round" opacity=".75"/>`;
      return `<path d="M${300 - m.barra - 12} 578 L${300 + m.barra + 12} 578" fill="none"
                stroke="${risca}" stroke-width="16" opacity=".55"/>`
        + tranca(268) + tranca(332);
    },
  },
  {
    id: 'corta-vento', nome: 'Corta-vento', slot: 'torso', raridade: 'rare',
    cor: '#e0714f',
    desbloqueio: { tipo: 'looks', meta: 6 },
    arte: (m, x) => tronco(m, { gola: 18, ombro: 12, peito: 12, barra: 16, ate: 596 })
      + mangas(m, x, {}, 22, 'butt')
      + nasMaos(cx => `<ellipse cx="${cx}" cy="644" rx="${m.braco + 12}" ry="13"/>`),
    detalhe: (m, cor) => `
      <path d="M${300 - m.peito - 4} 404 C300 428 300 428 ${300 + m.peito + 4} 404
               L${300 + m.barra + 12} 470 C300 494 300 494 ${300 - m.barra - 12} 470 Z"
            fill="${escurecer(cor, .34)}" opacity=".9"/>
      <path d="M300 248 L300 588" fill="none" stroke="${escurecer(cor, .5)}"
            stroke-width="6" stroke-linecap="round"/>
      <path d="M${300 - m.pescoco - 18} 228 C300 258 300 258 ${300 + m.pescoco + 18} 228"
            fill="none" stroke="${escurecer(cor, .3)}" stroke-width="10"/>`,
  },

  {
    id: 'cropped', nome: 'Cropped', slot: 'torso', raridade: 'uncommon',
    cor: '#d9a3b5',
    desbloqueio: { tipo: 'nivel', meta: 5 },
    // Para na cintura, não no quadril: é a única peça de cima daqui que deixa
    // aparecer o corpo embaixo dela.
    arte: (m, x) => tronco(m, { gola: 18, ombro: 6, peito: 4, barra: -4, ate: 438,
      decote: 254 }) + mangas(m, x, { ate: 380 }, 10),
    detalhe: (m, cor) => `<path d="M${300 - m.barra + 2} 430 L${300 + m.barra - 2} 430"
      fill="none" stroke="${escurecer(cor, .22)}" stroke-width="8" opacity=".6"/>`,
  },
  {
    id: 'gola-alta', nome: 'Gola alta', slot: 'torso', raridade: 'uncommon',
    cor: '#3d4a5c',
    desbloqueio: { tipo: 'resgates', meta: 12 },
    // O tubo da gola começa em 174, logo abaixo do queixo: mais alto que isso
    // e ele come o rosto, que está desenhado no mesmo palco.
    arte: (m, x) => `<rect x="${300 - m.pescoco - 11}" y="174"
        width="${(m.pescoco + 11) * 2}" height="58" rx="16"/>`
      + tronco(m, { gola: 9, ombro: 10, peito: 10, barra: 12, ate: 580, decote: 226 })
      + mangas(m, x, {}, 20, 'butt')
      + nasMaos(cx => `<ellipse cx="${cx}" cy="646" rx="${m.braco + 11}" ry="13"/>`),
    detalhe: (m, cor) => `<path d="M${300 - m.pescoco - 9} 186
      L${300 + m.pescoco + 9} 186" fill="none" stroke="${escurecer(cor, .25)}"
      stroke-width="6" opacity=".7"/>`,
  },
  {
    id: 'xadrez', nome: 'Camisa xadrez', slot: 'torso', raridade: 'rare',
    cor: '#a8443f',
    desbloqueio: { tipo: 'resgates', meta: 18 },
    arte: (m, x) => {
      const aberta = { gola: 12, ombro: 10, barra: 14, ate: 604, v: 300, meio: 7 };
      return frenteAberta(m, -1, aberta) + frenteAberta(m, 1, aberta)
        + mangas(m, x, {}, 20, 'butt')
        + nasMaos(cx => `<ellipse cx="${cx}" cy="646" rx="${m.braco + 11}" ry="13"/>`);
    },
    // O xadrez fica na área que as duas frentes ocupam em qualquer largura de
    // corpo (|dx| de 14 a 78): riscar até a borda passaria por fora da peça,
    // que é curva, e a listra apareceria no ar ao lado do corpo.
    detalhe: (m, cor) => {
      const claro = escurecer(cor, .12), escuro = escurecer(cor, .45);
      const vertical = [22, 48, 74].flatMap(dx => [-1, 1].map(l =>
        `<path d="M${300 + l * dx} 264 L${300 + l * dx} 592" fill="none"
           stroke="${l < 0 ? escuro : claro}" stroke-width="9" opacity=".8"/>`));
      const horizontal = [300, 366, 432, 498, 564].map(y =>
        `<path d="M${300 - 78} ${y} L${300 - 14} ${y} M${300 + 14} ${y} L${300 + 78} ${y}"
           fill="none" stroke="${escuro}" stroke-width="7" opacity=".55"/>`);
      return vertical.join('') + horizontal.join('');
    },
  },
  {
    id: 'vestido', nome: 'Vestido', slot: 'torso', raridade: 'rare',
    cor: '#7b4b7d',
    desbloqueio: { tipo: 'publicacoes', meta: 4 },
    // Peça de cima que não acaba na cintura: a barra em 880 é o que faz dela
    // um vestido, e a folga de 40 é a roda da saia.
    arte: (m, x) => tronco(m, { gola: 16, ombro: 6, peito: 2, barra: 40, ate: 880,
      decote: 276 }) + mangas(m, x, { ate: 368 }, 8),
    detalhe: (m, cor) => `
      <path d="M${300 - m.cintura - 14} 566 C300 590 300 590 ${300 + m.cintura + 14} 566"
            fill="none" stroke="${escurecer(cor, .3)}" stroke-width="14"/>
      <path d="M300 592 L300 872" fill="none" stroke="${escurecer(cor, .18)}"
            stroke-width="5" opacity=".6"/>`,
  },
  {
    id: 'kimono', nome: 'Kimono', slot: 'torso', raridade: 'epic',
    cor: '#2f4858',
    desbloqueio: { tipo: 'looks', meta: 14 },
    arte: (m, x) => {
      const aberta = { gola: 14, ombro: 14, barra: 34, ate: 826, v: 286, meio: 18 };
      return frenteAberta(m, -1, aberta) + frenteAberta(m, 1, aberta)
        + mangas(m, x, { ate: 560 }, 62, 'butt');
    },
    detalhe: (m, cor) => `
      <rect x="${300 - m.cintura - 30}" y="556" width="${(m.cintura + 30) * 2}"
            height="46" rx="8" fill="${escurecer(cor, .45)}"/>
      <path d="M${300 - m.pescoco - 20} 214 L${300 - 22} 300
               M${300 + m.pescoco + 20} 214 L${300 + 22} 300" fill="none"
            stroke="${escurecer(cor, .25)}" stroke-width="12"/>`,
  },
  {
    id: 'sobretudo', nome: 'Sobretudo', slot: 'torso', raridade: 'epic',
    cor: '#7a6a52',
    desbloqueio: { tipo: 'dias', meta: 4 },
    arte: (m, x) => {
      const aberta = { gola: 12, ombro: 12, barra: 26, ate: 904, v: 352, meio: 12 };
      return frenteAberta(m, -1, aberta) + frenteAberta(m, 1, aberta)
        + mangas(m, x, {}, 24, 'butt');
    },
    detalhe: (m, cor) => `
      <path d="M${300 - m.pescoco - 14} 212 L${300 - 18} 352 L${300 - 70} 320 Z
               M${300 + m.pescoco + 14} 212 L${300 + 18} 352 L${300 + 70} 320 Z"
            fill="${escurecer(cor, .16)}" stroke="${escurecer(cor, .4)}" stroke-width="3"/>
      <rect x="${300 - m.cintura - 26}" y="576" width="${(m.cintura + 26) * 2}"
            height="30" rx="6" fill="${escurecer(cor, .5)}"/>
      <circle cx="${300 - 40}" cy="440" r="7" fill="${escurecer(cor, .45)}"/>
      <circle cx="${300 - 40}" cy="508" r="7" fill="${escurecer(cor, .45)}"/>`,
  },

  // ------------------------------ Pernas ----------------------------------
  {
    id: 'calca', nome: 'Calça', slot: 'pernas', raridade: 'common',
    cor: '#4a5d73',
    desbloqueio: { tipo: 'inicial' },
    arte: (m, x) => cos(m) + pernas(m, x, {}, 12, 'butt') + bainha(m, 1086, 12),
    detalhe: (m, cor) => entrepernas(cor, 1064),
  },
  {
    id: 'bermuda', nome: 'Bermuda', slot: 'pernas', raridade: 'common',
    cor: '#6f8a6a',
    desbloqueio: { tipo: 'inicial' },
    arte: (m, x) => cos(m) + pernas(m, x, { ate: 866 }, 12, 'butt') + bainha(m, 866, 12),
    detalhe: (m, cor) => entrepernas(cor, 848),
  },
  {
    id: 'saia', nome: 'Saia', slot: 'pernas', raridade: 'uncommon',
    cor: '#c96f7e',
    desbloqueio: { tipo: 'nivel', meta: 2 },
    arte: (m) => {
      const q = m.quadril + 8, l = m.quadril + 74;
      return `<path d="M${300 - q} 576 L${300 + q} 576
        C${300 + q + 20} 690 ${300 + l - 8} 760 ${300 + l} 808
        C${300 + l * .5} 830 ${300 - l * .5} 830 ${300 - l} 808
        C${300 - l + 8} 760 ${300 - q - 20} 690 ${300 - q} 576 Z"/>`;
    },
  },
  {
    id: 'cargo', nome: 'Calça cargo', slot: 'pernas', raridade: 'rare',
    cor: '#7d7a5e',
    desbloqueio: { tipo: 'resgates', meta: 30 },
    arte: (m, x) => cos(m) + pernas(m, x, {}, 14, 'butt') + bainha(m, 1086, 14),
    detalhe: (m, cor) => {
      const cx = noMembro(m.pernaX, Y_PERNA, 792);
      const seam = entrepernas(cor, 1064);
      const bolso = (x) => `<rect x="${nn(x - 25)}" y="762" width="50" height="70" rx="8"
        fill="${escurecer(cor, .12)}" stroke="${escurecer(cor, .4)}" stroke-width="4"/>`;
      // +28 e não +2: o bolso tem 50 de largura, e centrado na borda da perna
      // metade dele ficava pendurado fora da calça.
      return seam + bolso(cx - m.coxa + 28) + bolso(600 - cx + m.coxa - 28);
    },
  },
  {
    id: 'saia-longa', nome: 'Saia longa', slot: 'pernas', raridade: 'epic',
    cor: '#4a3f6b',
    desbloqueio: { tipo: 'publicacoes', meta: 6 },
    arte: (m) => {
      const q = m.quadril + 8, l = m.quadril + 58;
      return `<path d="M${300 - q} 572 L${300 + q} 572
        C${300 + q + 10} 760 ${300 + l - 6} 900 ${300 + l} 1044
        C${300 + l * .5} 1070 ${300 - l * .5} 1070 ${300 - l} 1044
        C${300 - l + 6} 900 ${300 - q - 10} 760 ${300 - q} 572 Z"/>`;
    },
    detalhe: (m, cor) => `<path d="M300 582 L300 1054" fill="none"
      stroke="${escurecer(cor, .22)}" stroke-width="5" opacity=".7"/>`,
  },

  {
    id: 'jeans', nome: 'Jeans', slot: 'pernas', raridade: 'common',
    cor: '#3f5a78',
    desbloqueio: { tipo: 'nivel', meta: 2 },
    arte: (m, x) => cos(m) + pernas(m, x, {}, 13, 'butt') + bainha(m, 1086, 13),
    detalhe: (m, cor) => {
      const linha = escurecer(cor, .45);
      const bolso = (lado) => {
        const x = 300 + lado * (m.quadril - 20);
        return `<path d="M${x - 24} 598 C${x - 9} 648 ${x + 9} 648 ${x + 24} 598"
          fill="none" stroke="${linha}" stroke-width="4" opacity=".8"/>`;
      };
      return entrepernas(cor, 1064) + bolso(-1) + bolso(1)
        + `<path d="M${300 - m.quadril - 2} 592 L${300 + m.quadril + 2} 592" fill="none"
             stroke="${linha}" stroke-width="5" opacity=".7"/>
           <rect x="290" y="568" width="20" height="16" rx="4" fill="${escurecer(cor, .3)}"/>`;
    },
  },
  {
    id: 'moletom-calca', nome: 'Calça de moletom', slot: 'pernas', raridade: 'uncommon',
    cor: '#8a8f98',
    desbloqueio: { tipo: 'resgates', meta: 20 },
    // Termina no tornozelo, não no chão: o punho é o que diz que ela é de
    // moletom e não de alfaiataria.
    arte: (m, x) => cos(m) + pernas(m, x, { ate: 1046 }, 18, 'butt') + bainha(m, 1046, 18),
    detalhe: (m, cor) => {
      const cordao = escurecer(cor, .34);
      return entrepernas(cor, 1024)
        + `<path d="M292 588 C288 620 284 636 280 650 M308 588 C312 620 316 636 320 650"
             fill="none" stroke="${cordao}" stroke-width="7" stroke-linecap="round"/>
           <path d="M${300 - m.quadril} 600 L${300 + m.quadril} 600" fill="none"
             stroke="${cordao}" stroke-width="14" opacity=".45"/>`;
    },
  },
  {
    id: 'legging', nome: 'Legging', slot: 'pernas', raridade: 'uncommon',
    cor: '#2f3038',
    desbloqueio: { tipo: 'nivel', meta: 4 },
    // Folga 2: a legging é a própria perna, e é a única peça daqui em que não
    // sobra pano nenhum.
    arte: (m, x) => cos(m) + pernas(m, x, { ate: 1062 }, 2, 'butt') + bainha(m, 1062, 2),
    detalhe: (m, cor) => {
      const risca = escurecer(cor, .45);
      const cx = noMembro(m.pernaX, Y_PERNA, 860);
      return entrepernas(cor, 1040)
        + [cx - m.coxa + 5, 600 - cx + m.coxa - 5].map(x =>
            `<path d="M${nn(x)} 744 L${nn(x)} 1036" fill="none" stroke="${risca}"
               stroke-width="5" opacity=".7"/>`).join('');
    },
  },

  {
    id: 'shortinho', nome: 'Short jeans', slot: 'pernas', raridade: 'common',
    cor: '#5b7da0',
    desbloqueio: { tipo: 'nivel', meta: 3 },
    arte: (m, x) => cos(m) + pernas(m, x, { ate: 794 }, 14, 'butt') + bainha(m, 794, 14),
    detalhe: (m, cor) => {
      const linha = escurecer(cor, .45);
      const barra = (lado) => {
        const cx = noMembro(m.pernaX, Y_PERNA, 780);
        const x = lado < 0 ? cx : 600 - cx;
        return `<path d="M${nn(x - m.coxa - 6)} 772 L${nn(x + m.coxa + 6)} 772"
          fill="none" stroke="${linha}" stroke-width="6" opacity=".7"/>`;
      };
      return entrepernas(cor, 772) + barra(-1) + barra(1)
        + `<path d="M${300 - m.quadril - 2} 592 L${300 + m.quadril + 2} 592" fill="none"
             stroke="${linha}" stroke-width="5" opacity=".7"/>`;
    },
  },
  {
    id: 'alfaiataria', nome: 'Calça de alfaiataria', slot: 'pernas', raridade: 'uncommon',
    cor: '#3a3d46',
    desbloqueio: { tipo: 'looks', meta: 7 },
    // Folga 18, e não mais: as duas pernas do corpo passam a 18 unidades uma da
    // outra na canela, e cada unidade de folga come metade desse vão pelos dois
    // lados — larga demais, as duas viram um bloco só e a calça lê como saia.
    arte: (m, x) => cos(m) + pernas(m, x, {}, 18, 'butt') + bainha(m, 1086, 18),
    detalhe: (m, cor) => {
      const vinco = escurecer(cor, .3);
      const cx = noMembro(m.pernaX, Y_PERNA, 860);
      return entrepernas(cor, 1064)
        + [cx, 600 - cx].map(x => `<path d="M${nn(x)} 736 L${nn(x)} 1076" fill="none"
             stroke="${vinco}" stroke-width="6" opacity=".85"/>`).join('')
        + `<path d="M${300 - m.quadril} 600 L${300 + m.quadril} 600" fill="none"
             stroke="${vinco}" stroke-width="12" opacity=".5"/>`;
    },
  },
  {
    id: 'plissada', nome: 'Saia plissada', slot: 'pernas', raridade: 'rare',
    cor: '#5c6b4a',
    desbloqueio: { tipo: 'resgates', meta: 22 },
    arte: (m) => {
      const q = m.quadril + 8, l = m.quadril + 88;
      return `<path d="M${300 - q} 576 L${300 + q} 576
        C${300 + q + 24} 700 ${300 + l - 10} 780 ${300 + l} 836
        C${300 + l * .5} 860 ${300 - l * .5} 860 ${300 - l} 836
        C${300 - l + 10} 780 ${300 - q - 24} 700 ${300 - q} 576 Z"/>`;
    },
    // A prega vai do cós até a barra, abrindo junto com a saia: régua reta
    // sairia pela lateral na altura em que ela é mais rodada.
    detalhe: (m, cor) => {
      const q = m.quadril + 4, l = m.quadril + 80;
      return [-.75, -.4, 0, .4, .75].map(k => `<path d="M${nn(300 + q * k)} 582
        L${nn(300 + l * k)} ${nn(844 - Math.abs(k) * 14)}" fill="none"
        stroke="${escurecer(cor, .26)}" stroke-width="5" opacity=".7"/>`).join('');
    },
  },
  {
    id: 'flare', nome: 'Calça flare', slot: 'pernas', raridade: 'rare',
    cor: '#6b4f7a',
    desbloqueio: { tipo: 'publicacoes', meta: 8 },
    // Justa até o joelho e aberta daí para baixo: o tubo é a perna do corpo,
    // e a boca é um trapézio que sai dela na altura certa.
    arte: (m, x) => {
      const boca = [-1, 1].map(lado => {
        const cx = noMembro(m.pernaX, Y_PERNA, 900);
        const px = noMembro(m.pernaX, Y_PERNA, 1086);
        const a = lado < 0 ? cx : 600 - cx, b = lado < 0 ? px : 600 - px;
        return `<path d="M${nn(a - m.coxa - 4)} 898 L${nn(a + m.coxa + 4)} 898
          L${nn(b + m.coxa + 34)} 1090 L${nn(b - m.coxa - 34)} 1090 Z"/>`;
      }).join('');
      return cos(m) + pernas(m, x, { ate: 910 }, 8, 'butt') + boca;
    },
    detalhe: (m, cor) => entrepernas(cor, 1064),
  },

  // ------------------------------- Pés ------------------------------------
  {
    id: 'tenis', nome: 'Tênis', slot: 'pes', raridade: 'common',
    cor: '#f2efe9',
    desbloqueio: { tipo: 'inicial' },
    arte: (m) => nosPes(cx => `
      <rect x="${cx - 27}" y="1050" width="54" height="58" rx="16"/>
      <ellipse cx="${cx}" cy="1110" rx="${m.pe + 8}" ry="30"/>`),
    detalhe: (m) => nosPes(cx => `
      <path d="M${cx - m.pe - 8} 1116 C${cx - m.pe} 1142 ${cx + m.pe} 1142 ${cx + m.pe + 8} 1116
               C${cx + m.pe + 6} 1134 ${cx - m.pe - 6} 1134 ${cx - m.pe - 8} 1116 Z"
            fill="rgba(0,0,0,.3)"/>
      <path d="M${cx - 17} 1066 L${cx + 17} 1078 M${cx - 17} 1086 L${cx + 17} 1098"
            fill="none" stroke="rgba(0,0,0,.26)" stroke-width="5" stroke-linecap="round"/>`),
  },
  {
    id: 'sapatilha', nome: 'Sapatilha', slot: 'pes', raridade: 'uncommon',
    cor: '#c96f8a',
    desbloqueio: { tipo: 'nivel', meta: 4 },
    arte: (m) => nosPes(cx => `<ellipse cx="${cx}" cy="1112" rx="${m.pe + 6}" ry="27"/>`),
    detalhe: (m) => nosPes(cx =>
      `<ellipse cx="${cx}" cy="1096" rx="${m.pe - 14}" ry="12" fill="rgba(0,0,0,.2)"/>`),
  },
  {
    id: 'bota', nome: 'Bota', slot: 'pes', raridade: 'rare',
    cor: '#6b4a35',
    desbloqueio: { tipo: 'nivel', meta: 8 },
    arte: (m, x) => pernas(m, x, { de: 966 }, 12, 'butt')
      + nosPes(cx => `<ellipse cx="${cx}" cy="1108" rx="${m.pe + 9}" ry="32"/>`),
    detalhe: (m) => nosPes(cx => `
      <ellipse cx="${cx}" cy="1124" rx="${m.pe + 9}" ry="17" fill="rgba(0,0,0,.3)"/>
      <path d="M${cx - m.coxa - 6} 992 L${cx + m.coxa + 6} 992" fill="none"
            stroke="rgba(0,0,0,.24)" stroke-width="7"/>`),
  },
  {
    id: 'coturno', nome: 'Coturno', slot: 'pes', raridade: 'epic',
    cor: '#33333a',
    desbloqueio: { tipo: 'dias', meta: 3 },
    arte: (m, x) => pernas(m, x, { de: 1000 }, 20, 'butt')
      + nosPes(cx => `<ellipse cx="${cx}" cy="1106" rx="${m.pe + 12}" ry="34"/>`),
    detalhe: (m) => nosPes(cx => `
      <path d="M${cx - 19} 1020 L${cx + 19} 1032 M${cx - 19} 1042 L${cx + 19} 1054
               M${cx - 19} 1064 L${cx + 19} 1076" fill="none"
            stroke="rgba(255,255,255,.4)" stroke-width="5" stroke-linecap="round"/>
      <path d="M${cx - m.pe - 10} 1122 L${cx + m.pe + 10} 1122" fill="none"
            stroke="rgba(0,0,0,.35)" stroke-width="16" stroke-linecap="round"/>`),
  },

  {
    id: 'chinelo', nome: 'Chinelo', slot: 'pes', raridade: 'common',
    cor: '#2f6f7a',
    desbloqueio: { tipo: 'resgates', meta: 5 },
    arte: (m) => nosPes(cx => `<ellipse cx="${cx}" cy="1124" rx="${m.pe + 4}" ry="20"/>`),
    detalhe: (m, cor) => nosPes(cx => `
      <path d="M${cx - m.pe + 12} 1110 L${cx} 1124 L${cx + m.pe - 12} 1110" fill="none"
            stroke="${escurecer(cor, .3)}" stroke-width="9" stroke-linecap="round"/>`),
  },
  {
    id: 'sapato', nome: 'Sapato social', slot: 'pes', raridade: 'uncommon',
    cor: '#2a2119',
    desbloqueio: { tipo: 'looks', meta: 3 },
    arte: (m) => nosPes(cx => `
      <ellipse cx="${cx}" cy="1110" rx="${m.pe + 5}" ry="28"/>
      <rect x="${cx - 21}" y="1074" width="42" height="34" rx="12"/>`),
    detalhe: (m) => nosPes(cx => `
      <ellipse cx="${cx}" cy="1128" rx="${m.pe + 5}" ry="12" fill="rgba(0,0,0,.4)"/>
      <ellipse cx="${cx - 4}" cy="1096" rx="13" ry="7" fill="rgba(255,255,255,.22)"/>`),
  },

  {
    id: 'pantufa', nome: 'Pantufa', slot: 'pes', raridade: 'common',
    cor: '#c9b8d6',
    desbloqueio: { tipo: 'dias', meta: 1 },
    arte: (m) => nosPes(cx => `
      <ellipse cx="${cx}" cy="1112" rx="${m.pe + 12}" ry="32"/>
      <ellipse cx="${cx}" cy="1076" rx="${m.pe + 4}" ry="16"/>`),
    detalhe: (m, cor) => nosPes(cx => `
      <ellipse cx="${cx}" cy="1074" rx="${m.pe + 6}" ry="13"
               fill="${escurecer(cor, .1)}" opacity=".9"/>
      <circle cx="${cx - 13}" cy="1108" r="5" fill="rgba(0,0,0,.35)"/>
      <circle cx="${cx + 13}" cy="1108" r="5" fill="rgba(0,0,0,.35)"/>`),
  },
  {
    id: 'cano-alto', nome: 'Tênis de cano alto', slot: 'pes', raridade: 'uncommon',
    cor: '#e8e4dc',
    desbloqueio: { tipo: 'nivel', meta: 6 },
    arte: (m, x) => pernas(m, x, { de: 1006 }, 16, 'butt')
      + nosPes(cx => `<ellipse cx="${cx}" cy="1110" rx="${m.pe + 10}" ry="30"/>`),
    detalhe: (m, cor) => nosPes(cx => `
      <ellipse cx="${cx}" cy="1126" rx="${m.pe + 10}" ry="14" fill="rgba(0,0,0,.3)"/>
      <path d="M${cx - 17} 1032 L${cx + 17} 1044 M${cx - 17} 1054 L${cx + 17} 1066
               M${cx - 17} 1076 L${cx + 17} 1088" fill="none"
            stroke="${escurecer(cor, .35)}" stroke-width="5" stroke-linecap="round"/>`),
  },
  {
    id: 'galocha', nome: 'Galocha', slot: 'pes', raridade: 'uncommon',
    cor: '#3f7d6a',
    desbloqueio: { tipo: 'resgates', meta: 14 },
    // Folga 14: com 22 os dois canos se encostavam no vão da canela e a
    // galocha virava um balde só.
    arte: (m, x) => pernas(m, x, { de: 926 }, 14, 'butt')
      + nosPes(cx => `<ellipse cx="${cx}" cy="1108" rx="${m.pe + 11}" ry="33"/>`),
    detalhe: (m, cor) => nosPes(cx => `
      <ellipse cx="${cx}" cy="1126" rx="${m.pe + 11}" ry="15" fill="rgba(0,0,0,.32)"/>
      <path d="M${cx - m.coxa - 8} 948 L${cx + m.coxa + 8} 948" fill="none"
            stroke="${escurecer(cor, .3)}" stroke-width="10"/>
      <ellipse cx="${cx - 12}" cy="1044" rx="10" ry="26" fill="rgba(255,255,255,.18)"/>`),
  },
  {
    id: 'salto', nome: 'Sandália de salto', slot: 'pes', raridade: 'rare',
    cor: '#9c2f4a',
    desbloqueio: { tipo: 'looks', meta: 9 },
    arte: (m) => nosPes(cx => `
      <ellipse cx="${cx}" cy="1102" rx="${m.pe - 2}" ry="22"/>
      <rect x="${cx - 7}" y="1104" width="14" height="40" rx="4"/>
      <path d="M${cx - m.pe + 6} 1082 C${cx} 1062 ${cx} 1062 ${cx + m.pe - 6} 1082"
            fill="none" stroke-width="11" stroke-linecap="round"/>`),
    detalhe: (m) => nosPes(cx =>
      `<ellipse cx="${cx}" cy="1140" rx="11" ry="6" fill="rgba(0,0,0,.4)"/>`),
  },

  // ------------------------------ Cabeça ----------------------------------
  {
    id: 'bone', nome: 'Boné', slot: 'cabeca', raridade: 'common',
    cabelo: 128,
    cor: '#d95f4a',
    desbloqueio: { tipo: 'inicial' },
    // Copa baixa e aba na frente. Com a aba saindo igual para os dois lados
    // (uma elipse em volta da cabeça) o boné lia como capacete.
    arte: () => `<path d="M243 104 C243 50 267 30 300 30 C333 30 357 50 357 104 Z"/>
                 <path d="M237 100 L363 100 C383 110 377 130 353 133
                          C318 123 282 123 247 133 C223 130 217 110 237 100 Z"/>`,
    detalhe: (m, cor) => `
      <circle cx="300" cy="33" r="8" fill="${escurecer(cor, .3)}"/>
      <path d="M300 31 L300 100" fill="none" stroke="${escurecer(cor, .22)}"
            stroke-width="4" opacity=".7"/>`,
  },
  {
    id: 'gorro', nome: 'Gorro', slot: 'cabeca', raridade: 'uncommon',
    cabelo: 110,
    cor: '#8c5a6b',
    desbloqueio: { tipo: 'nivel', meta: 5 },
    arte: () => `<path d="M240 94 C240 34 266 16 300 16 C334 16 360 34 360 94 Z"/>
                 <rect x="236" y="82" width="128" height="32" rx="15"/>
                 <circle cx="300" cy="14" r="16"/>`,
  },
  {
    id: 'bucket', nome: 'Chapéu bucket', slot: 'cabeca', raridade: 'rare',
    cabelo: 124,
    cor: '#7d7a5e',
    desbloqueio: { tipo: 'resgates', meta: 25 },
    arte: () => `<path d="M246 94 C246 40 268 24 300 24 C332 24 354 40 354 94 Z"/>
                 <path d="M246 90 L206 122 C240 140 360 140 394 122 L354 90 Z"/>`,
  },
  {
    id: 'coroa', nome: 'Coroa', slot: 'cabeca', raridade: 'legendary',
    cor: '#e8c25a',
    desbloqueio: { tipo: 'dias', meta: 5 },
    arte: () => `<path d="M248 92 L242 24 L272 56 L300 14 L328 56 L358 24 L352 92 Z"/>`,
    detalhe: () => `<circle cx="300" cy="72" r="8" fill="#c9566b"/>
                    <circle cx="266" cy="76" r="6" fill="#4f7cac"/>
                    <circle cx="334" cy="76" r="6" fill="#4f7cac"/>`,
  },

  {
    id: 'boina', nome: 'Boina', slot: 'cabeca', raridade: 'uncommon',
    cabelo: 112,
    cor: '#7a3b4a',
    desbloqueio: { tipo: 'publicacoes', meta: 3 },
    // Ela cai para um lado: boina reta na cabeça vira touca.
    arte: () => `<path d="M238 96 C232 44 268 26 306 26 C352 26 378 46 372 74
                          C368 92 340 100 300 102 Z"/>
                 <path d="M240 92 C270 104 336 104 366 88 C364 108 336 116 300 116
                          C264 116 240 108 240 92 Z"/>`,
    detalhe: (m, cor) => `<circle cx="312" cy="28" r="7" fill="${escurecer(cor, .3)}"/>`,
  },
  {
    id: 'fones', nome: 'Fones de ouvido', slot: 'cabeca', raridade: 'rare',
    cor: '#33333a',
    desbloqueio: { tipo: 'nivel', meta: 9 },
    arte: (m, x) => `
      <path d="M240 108 C240 40 268 22 300 22 C332 22 360 40 360 108" fill="none"
            stroke-width="${18 + x}" stroke-linecap="round"/>
      <rect x="224" y="90" width="36" height="58" rx="16"/>
      <rect x="340" y="90" width="36" height="58" rx="16"/>`,
    detalhe: (m, cor) => `
      <rect x="232" y="102" width="20" height="34" rx="9" fill="${escurecer(cor, .35)}"/>
      <rect x="348" y="102" width="20" height="34" rx="9" fill="${escurecer(cor, .35)}"/>`,
  },

  {
    id: 'palha', nome: 'Chapéu de palha', slot: 'cabeca', raridade: 'uncommon',
    cor: '#dcc188',
    cabelo: 132,
    desbloqueio: { tipo: 'dias', meta: 6 },
    arte: () => `<path d="M252 104 C252 52 272 34 300 34 C328 34 348 52 348 104 Z"/>
                 <path d="M252 100 L348 100 C412 108 430 128 426 136
                          C404 150 196 150 174 136 C170 128 188 108 252 100 Z"/>`,
    detalhe: (m, cor) => `
      <path d="M254 92 L346 92" fill="none" stroke="${escurecer(cor, .32)}"
            stroke-width="16"/>
      <path d="M190 134 C240 146 360 146 410 134" fill="none"
            stroke="${escurecer(cor, .2)}" stroke-width="4" opacity=".8"/>`,
  },
  {
    id: 'viseira', nome: 'Viseira', slot: 'cabeca', raridade: 'common',
    cor: '#3f7d6a',
    desbloqueio: { tipo: 'nivel', meta: 4 },
    // Sem `cabelo`: a viseira é aberta em cima, então o cabelo continua
    // inteiro por dentro dela — é o contrário do boné.
    arte: () => `<path d="M240 108 C242 78 266 66 300 66 C334 66 358 78 360 108
                          C340 98 260 98 240 108 Z"/>
                 <path d="M236 104 L364 104 C384 116 378 136 354 138
                          C318 128 282 128 246 138 C222 136 216 116 236 104 Z"/>`,
    detalhe: (m, cor) => `<path d="M244 100 L356 100" fill="none"
      stroke="${escurecer(cor, .3)}" stroke-width="8" opacity=".8"/>`,
  },
  {
    id: 'tiara', nome: 'Tiara de laço', slot: 'cabeca', raridade: 'common',
    cor: '#d46a8b',
    desbloqueio: { tipo: 'publicacoes', meta: 2 },
    // Ela se apoia no cabelo, não o cobre: por isso não declara `cabelo`.
    arte: (m, x) => `
      <path d="M248 98 C248 54 270 40 300 40 C330 40 352 54 352 98" fill="none"
            stroke-width="${12 + x}" stroke-linecap="round"/>
      <path d="M330 44 C352 22 380 30 378 50 C376 68 350 68 330 56
               C350 70 352 92 336 96 C320 100 314 78 322 52 Z"/>`,
    detalhe: (m, cor) => `<circle cx="328" cy="52" r="7" fill="${escurecer(cor, .35)}"/>`,
  },

  // --------------------- Acessório: no rosto ------------------------------
  {
    id: 'bandana', nome: 'Bandana', slot: 'acessorio', z: 62, raridade: 'uncommon',
    cor: '#b8433f',
    desbloqueio: { tipo: 'resgates', meta: 16 },
    arte: () => `<path d="M250 118 C270 108 330 108 350 118
                          C352 150 332 176 300 176 C268 176 248 150 250 118 Z"/>`,
    detalhe: (m, cor) => `
      <path d="M252 124 C280 132 320 132 348 124" fill="none"
            stroke="${escurecer(cor, .3)}" stroke-width="6" opacity=".8"/>
      <path d="M262 150 C284 158 316 158 338 150" fill="none"
            stroke="${escurecer(cor, .25)}" stroke-width="5" opacity=".6"/>`,
  },
  {
    id: 'oculos', nome: 'Óculos', slot: 'acessorio', z: 62, raridade: 'common',
    cor: '#3a3a3f',
    desbloqueio: { tipo: 'inicial' },
    arte: (m, x) => `
      <circle cx="277" cy="106" r="21" fill="none" stroke-width="${7 + x}"/>
      <circle cx="323" cy="106" r="21" fill="none" stroke-width="${7 + x}"/>
      <path d="M298 106 L302 106 M256 101 L237 95 M344 101 L363 95" fill="none"
            stroke-width="${6 + x}" stroke-linecap="round"/>`,
  },
  {
    id: 'oculos-sol', nome: 'Óculos escuros', slot: 'acessorio', z: 62, raridade: 'uncommon',
    cor: '#2b2b30',
    desbloqueio: { tipo: 'nivel', meta: 3 },
    arte: (m, x) => `
      <path d="M254 94 L296 94 L294 122 C282 130 262 128 256 118 Z"/>
      <path d="M346 94 L304 94 L306 122 C318 130 338 128 344 118 Z"/>
      <path d="M296 98 L304 98 M254 94 L235 90 M346 94 L365 90" fill="none"
            stroke-width="${6 + x}" stroke-linecap="round"/>`,
  },
  {
    id: 'antifaz', nome: 'Antifaz', slot: 'acessorio', z: 62, raridade: 'epic',
    cor: '#3b2f63',
    desbloqueio: { tipo: 'looks', meta: 8 },
    arte: () => `<path d="M246 90 C266 76 334 76 354 90
                          C356 116 344 132 322 132 C310 132 304 124 300 118
                          C296 124 290 132 278 132 C256 132 244 116 246 90 Z"/>`,
    detalhe: () => `<ellipse cx="278" cy="102" rx="12" ry="9" fill="rgba(255,255,255,.62)"/>
                    <ellipse cx="322" cy="102" rx="12" ry="9" fill="rgba(255,255,255,.62)"/>`,
  },

  // --------------------- Acessório: nas mãos ------------------------------
  {
    id: 'luvas', nome: 'Luvas', slot: 'acessorio', z: 55, raridade: 'uncommon',
    cor: '#3a3a3f',
    caixa: [104, 596, 140, 140],
    desbloqueio: { tipo: 'nivel', meta: 7 },
    arte: (m, x) => mangas(m, x, { de: 632 }, 8)
      + nasMaos(cx => `<circle cx="${cx}" cy="694" r="${m.mao + 3}"/>`),
  },
  {
    id: 'pulseiras', nome: 'Pulseiras', slot: 'acessorio', z: 55, raridade: 'rare',
    cor: '#e8c25a',
    caixa: [118, 596, 112, 112],
    desbloqueio: { tipo: 'looks', meta: 12 },
    arte: (m) => nasMaos(cx => `
      <ellipse cx="${cx}" cy="658" rx="${m.braco + 6}" ry="10"/>
      <ellipse cx="${cx}" cy="638" rx="${m.braco + 5}" ry="9"/>`),
  },

  // ------------------- Acessório: no pescoço e no pulso -------------------
  {
    id: 'corrente', nome: 'Corrente', slot: 'acessorio', z: 58, raridade: 'common',
    cor: '#d8b45c',
    desbloqueio: { tipo: 'nivel', meta: 3 },
    arte: (m, x) => `
      <path d="M${300 - m.pescoco - 8} 216 C300 268 300 268 ${300 + m.pescoco + 8} 216"
            fill="none" stroke-width="${9 + x}" stroke-linecap="round"/>
      <circle cx="300" cy="272" r="13"/>`,
    detalhe: (m, cor) => `<circle cx="300" cy="272" r="6"
      fill="${escurecer(cor, .4)}"/>`,
  },
  {
    id: 'gravata', nome: 'Gravata', slot: 'acessorio', z: 58, raridade: 'uncommon',
    cor: '#7a2f3a',
    desbloqueio: { tipo: 'looks', meta: 4 },
    arte: () => `<path d="M288 224 L312 224 L318 252 L300 264 L282 252 Z"/>
                 <path d="M290 262 L310 262 L318 400 L300 428 L282 400 Z"/>`,
    detalhe: (m, cor) => `<path d="M290 262 L310 262" fill="none"
      stroke="${escurecer(cor, .4)}" stroke-width="6"/>`,
  },

  {
    id: 'cachecol', nome: 'Cachecol', slot: 'acessorio', z: 58, raridade: 'uncommon',
    cor: '#9c5f4e',
    desbloqueio: { tipo: 'dias', meta: 2 },
    // z 58: por cima da roupa do tronco (30) e por baixo do rosto (60) — ele
    // dá a volta no pescoço, não na camisa.
    // A volta no pescoço e duas pontas de comprimentos diferentes: com uma só,
    // no meio do peito, ele lia como gravata.
    arte: (m, x) => `
      <path d="M${300 - m.pescoco - 24} 206 C300 248 300 248 ${300 + m.pescoco + 24} 206
               C${300 + m.pescoco + 32} 256 300 290 300 290
               C300 290 ${300 - m.pescoco - 32} 256 ${300 - m.pescoco - 24} 206 Z"/>
      <path d="M${300 - 30} 266 C${300 - 42} 332 ${300 - 36} 392 ${300 - 42} 446"
            fill="none" stroke-width="${36 + x}" stroke-linecap="butt"/>
      <path d="M${300 + 24} 272 C${300 + 32} 318 ${300 + 30} 346 ${300 + 28} 374"
            fill="none" stroke-width="${30 + x}" stroke-linecap="butt"/>`,
    detalhe: (m, cor) => {
      const franja = (x1, x2, y) => `<path d="M${x1} ${y} L${x2} ${y}" fill="none"
        stroke="${escurecer(cor, .3)}" stroke-width="12" stroke-linecap="round"/>`;
      return franja(258, 300, 450) + franja(316, 340, 378);
    },
  },
  {
    id: 'relogio', nome: 'Relógio', slot: 'acessorio', z: 55, raridade: 'common',
    cor: '#2f3a44',
    desbloqueio: { tipo: 'nivel', meta: 2 },
    // Um pulso só, como relógio de verdade. A caixa da miniatura vem daqui
    // (`caixa`): medida sozinha, ela pegaria os dois braços e o vão entre eles.
    caixa: [382, 600, 96, 96],
    arte: (m) => `<rect x="${428 - m.braco - 8}" y="634" width="${(m.braco + 8) * 2}"
                        height="24" rx="8"/>
                  <rect x="${428 - 17}" y="626" width="34" height="40" rx="10"/>`,
    detalhe: () => `<circle cx="428" cy="646" r="11" fill="rgba(255,255,255,.72)"/>
                    <path d="M428 640 L428 646 L433 650" fill="none" stroke="#2f3a44"
                          stroke-width="3" stroke-linecap="round"/>`,
  },

  // ------------------------- Cintura (nas costas) -------------------------
  {
    id: 'suspensorios', nome: 'Suspensórios', slot: 'cintura', z: 31, raridade: 'uncommon',
    cor: '#4a3426',
    desbloqueio: { tipo: 'nivel', meta: 8 },
    // z 31: por cima da peça de cima (30), que é onde suspensório fica.
    arte: (m, x) => {
      const o = m.ombro * .52, q = m.quadril - 24;
      return [-1, 1].map(lado => `<path d="M${300 + lado * o} 248
        C${300 + lado * (o + 4)} 380 ${300 + lado * (q + 8)} 480 ${300 + lado * q} 590"
        fill="none" stroke-width="${20 + x}" stroke-linecap="butt"/>`).join('');
    },
    detalhe: (m, cor) => {
      const q = m.quadril - 24;
      return [-1, 1].map(lado => `<rect x="${300 + lado * q - 13}" y="578"
        width="26" height="24" rx="5" fill="${escurecer(cor, .45)}"/>`).join('');
    },
  },
  {
    id: 'tiracolo', nome: 'Bolsa a tiracolo', slot: 'cintura', z: 40, raridade: 'rare',
    cor: '#8a5a3c',
    desbloqueio: { tipo: 'publicacoes', meta: 5 },
    arte: (m, x) => `
      <path d="M${300 - m.ombro * .5} 250 C${300 - 20} 400 ${300 + 40} 480
               ${300 + m.quadril - 16} 596" fill="none" stroke-width="${18 + x}"
            stroke-linecap="butt"/>
      <rect x="${300 + m.quadril - 74}" y="586" width="112" height="84" rx="16"/>`,
    detalhe: (m, cor) => `
      <path d="M${300 + m.quadril - 70} 616 L${300 + m.quadril + 34} 616" fill="none"
            stroke="${escurecer(cor, .4)}" stroke-width="7"/>
      <rect x="${300 + m.quadril - 30}" y="600" width="24" height="26" rx="6"
            fill="${escurecer(cor, .5)}"/>`,
  },
  {
    id: 'cauda', nome: 'Cauda', slot: 'cintura', raridade: 'legendary',
    cor: '#c9713f',
    desbloqueio: { tipo: 'dias', meta: 10 },
    // Só existe atrás do corpo, como as asas: de frente o que se vê é a ponta
    // saindo por um dos lados.
    atras: (m) => `<path d="M${300 - m.quadril + 10} 612
      C${300 - m.quadril - 90} 700 ${300 - m.quadril - 150} 850 ${300 - m.quadril - 96} 946
      C${300 - m.quadril - 60} 1008 ${300 - m.quadril - 6} 986 ${300 - m.quadril - 14} 934
      C${300 - m.quadril - 22} 896 ${300 - m.quadril - 62} 902 ${300 - m.quadril - 60} 938
      C${300 - m.quadril - 96} 862 ${300 - m.quadril - 30} 726 ${300 - m.quadril + 46} 668 Z"/>`,
    detalhe: (m, cor) => `<path d="M${300 - m.quadril - 70} 930
      C${300 - m.quadril - 96} 890 ${300 - m.quadril - 40} 874 ${300 - m.quadril - 30} 908"
      fill="none" stroke="${escurecer(cor, .3)}" stroke-width="6" opacity=".8"/>`,
  },
  {
    id: 'cinto', nome: 'Cinto', slot: 'cintura', z: 24, raridade: 'common',
    cor: '#4a3426',
    desbloqueio: { tipo: 'resgates', meta: 8 },
    // z 24: por cima da calça (20) e por baixo da peça de cima (30) — é onde
    // um cinto fica, e é por isso que ele some sob a camiseta comprida.
    arte: (m) => `<rect x="${300 - m.quadril - 6}" y="576" width="${(m.quadril + 6) * 2}"
                        height="34" rx="6"/>`,
    detalhe: (m, cor) => `
      <rect x="282" y="570" width="36" height="46" rx="8" fill="${escurecer(cor, .55)}"/>
      <rect x="292" y="580" width="16" height="26" rx="4" fill="${cor}"/>`,
  },
  {
    id: 'pochete', nome: 'Pochete', slot: 'cintura', z: 36, raridade: 'uncommon',
    cor: '#b4693f',
    desbloqueio: { tipo: 'looks', meta: 10 },
    arte: (m, x) => `
      <path d="M${300 - m.quadril - 4} 600 C300 588 300 588 ${300 + m.quadril + 4} 600"
            fill="none" stroke-width="${16 + x}" stroke-linecap="round"/>
      <rect x="${300 - 62}" y="604" width="124" height="66" rx="22"/>`,
    detalhe: (m, cor) => `
      <path d="M${300 - 58} 630 L${300 + 58} 630" fill="none"
            stroke="${escurecer(cor, .38)}" stroke-width="6"/>
      <rect x="288" y="592" width="24" height="26" rx="6" fill="${escurecer(cor, .5)}"/>`,
  },
  {
    id: 'mochila', nome: 'Mochila', slot: 'cintura', raridade: 'common',
    cor: '#6b7a52',
    desbloqueio: { tipo: 'nivel', meta: 2 },
    atras: (m) => {
      // Passa da camiseta e do braço de propósito, e sobe acima da linha do
      // ombro. Uma mochila do tamanho das costas some inteira: de frente, o
      // corpo cobre o meio, a peça de cima cobre as laterais e o braço cobre o
      // resto. O que se vê de uma mochila é o canto de cima e a beirada.
      const w = m.peito + 34;
      return `<rect x="${300 - w}" y="252" width="${w * 2}" height="330" rx="40"/>`;
    },
    // As alças passam por cima do peito: é o que faz a mochila estar de costas.
    arte: (m, x) => {
      const a = m.peito * .55, b = m.peito * .42;
      return `<path d="M${300 - a} 268 C${300 - a - 6} 360 ${300 - a - 4} 430 ${300 - b} 496
               M${300 + a} 268 C${300 + a + 6} 360 ${300 + a + 4} 430 ${300 + b} 496"
            fill="none" stroke-width="${18 + x}" stroke-linecap="round"/>`;
    },
    // A alça não morre no ar: ela acaba numa fivela, que é o que diz que ela
    // continua por baixo do braço.
    detalhe: (m, cor) => {
      const b = m.peito * .42;
      return [-1, 1].map(lado => `<rect x="${300 + lado * b - 13}" y="480" width="26"
        height="22" rx="6" fill="${escurecer(cor, .34)}"/>`).join('');
    },
  },
  {
    id: 'capa', nome: 'Capa', slot: 'cintura', raridade: 'rare',
    cor: '#8c2f3a',
    desbloqueio: { tipo: 'nivel', meta: 10 },
    atras: (m) => {
      const o = m.ombro + 16, b = m.ombro + 82;
      return `<path d="M${300 - o} 252 L${300 + o} 252
        C${300 + o + 30} 500 ${300 + b - 10} 760 ${300 + b} 940
        C${300 + b * .5} 970 ${300 - b * .5} 970 ${300 - b} 940
        C${300 - b + 10} 760 ${300 - o - 30} 500 ${300 - o} 252 Z"/>`;
    },
    arte: (m) => `<path d="M${300 - m.pescoco - 26} 248
      C300 234 300 234 ${300 + m.pescoco + 26} 248
      C300 288 300 288 ${300 - m.pescoco - 26} 248 Z"/>`,
    detalhe: () => `<circle cx="300" cy="256" r="9" fill="#e8c25a"
                            stroke="rgba(0,0,0,.3)" stroke-width="3"/>`,
  },
  {
    id: 'asas', nome: 'Asas', slot: 'cintura', raridade: 'legendary',
    cor: '#f2efe9',
    desbloqueio: { tipo: 'dias', meta: 7 },
    atras: (m) => [-1, 1].map(lado => {
      const s = (d) => 300 + lado * d;
      const o = m.ombro;
      return `<path d="M${s(o - 10)} 300
        C${s(o + 120)} 228 ${s(o + 192)} 330 ${s(o + 178)} 472
        C${s(o + 120)} 440 ${s(o + 108)} 480 ${s(o + 118)} 562
        C${s(o + 58)} 500 ${s(o + 20)} 430 ${s(o - 6)} 380 Z"/>`;
    }).join(''),
    detalhe: (m, cor) => [-1, 1].map(lado => {
      const s = (d) => 300 + lado * d;
      const o = m.ombro;
      return `<path d="M${s(o + 10)} 332 C${s(o + 92)} 322 ${s(o + 142)} 372 ${s(o + 162)} 452
               M${s(o + 6)} 368 C${s(o + 70)} 388 ${s(o + 100)} 442 ${s(o + 112)} 522"
            fill="none" stroke="${escurecer(cor, .25)}" stroke-width="4" opacity=".8"/>`;
    }).join(''),
  },
];

// Com o que se começa. Ninguém entra pelado no próprio perfil: as três peças
// de `inicial` já vêm vestidas, e trocar é o primeiro gesto do inventário.
export const VESTIARIO_PADRAO = {
  torso: 'camiseta', pernas: 'calca', pes: 'tenis',
};

export const ROUPINHA = Object.fromEntries(ROUPINHAS.map(r => [r.id, r]));
export const roupinha = (id) => ROUPINHA[id] || null;
export const doSlot = (slot) => ROUPINHAS.filter(r => r.slot === slot);
// Cada peça tem uma cor, e ela é da peça: o desenho e a cor são a mesma
// decisão de quem desenhou. O que está vestido é só o id.
export const corDaPeca = (r) => r?.cor ?? '#e9e4dc';

// --------------------------- Desbloqueio ----------------------------------
// Nada fica gravado como "desbloqueado": a condição é lida do progresso, do
// mesmo jeito que o nível é lido do XP. Mexer numa meta aqui revale para todo
// mundo, sem migração de save — e nada que abriu fecha de novo, porque tudo
// que alimenta isso só sobe.
//
// `progresso` é o que db.progressoDoJogador() devolve:
// { nivel, resgates, looks, publicacoes, dias }.
export const METAS = {
  inicial: {
    rotulo: () => 'Você já começa com ela',
    atual: () => 1, meta: () => 1,
  },
  nivel: {
    rotulo: (d) => `Chegue ao nível ${d.meta}`,
    atual: (p) => p.nivel, meta: (d) => d.meta,
  },
  resgates: {
    rotulo: (d) => `Garimpe ${d.meta} peças na vitrine`,
    atual: (p) => p.resgates, meta: (d) => d.meta,
  },
  looks: {
    rotulo: (d) => `Monte ${d.meta} looks no Stylist`,
    atual: (p) => p.looks, meta: (d) => d.meta,
  },
  publicacoes: {
    rotulo: (d) => `Publique ${d.meta} colagens no feed`,
    atual: (p) => p.publicacoes, meta: (d) => d.meta,
  },
  dias: {
    rotulo: (d) => `Feche as missões do dia ${d.meta}×`,
    atual: (p) => p.dias, meta: (d) => d.meta,
  },
};

export function estadoDoDesbloqueio(r, progresso) {
  const d = r.desbloqueio || { tipo: 'inicial' };
  const regra = METAS[d.tipo] || METAS.inicial;
  const meta = regra.meta(d);
  const atual = Math.max(0, regra.atual(progresso) ?? 0);
  return {
    rotulo: regra.rotulo(d),
    atual: Math.min(atual, meta),
    meta,
    liberada: atual >= meta,
    pct: meta ? Math.min(100, (atual / meta) * 100) : 100,
  };
}

// ---------------------------- Desenhar ------------------------------------
// Duas passadas, como o corpo: primeiro tudo engordado na cor do contorno,
// depois na cor da peça por cima. Dar contorno forma a forma mostraria as
// costuras de dentro da silhueta — e roupa é feita de formas sobrepostas.
const CONTORNO = 5;

// `k` é a escala em que a peça vai ser desenhada (js/proporcao.js): o contorno
// é dividido por ela para sair da mesma grossura em qualquer parte do corpo.
const desenhar = (arte, m, cor, k = 1) => `
  <g fill="${escurecer(cor)}" stroke="${escurecer(cor)}" stroke-width="${CONTORNO / k}"
     stroke-linejoin="round" stroke-linecap="round">${arte(m, CONTORNO / k)}</g>
  <g fill="${cor}" stroke="${cor}" stroke-width="0"
     stroke-linejoin="round" stroke-linecap="round">${arte(m, 0)}</g>`;

// As três pilhas em que o avatar encaixa a roupa: o que vai atrás do corpo, o
// que vai na frente dele (por camada) e o que vai depois do rosto.
//
// `roupas` é um mapa de lugar do corpo para id da peça — { torso: 'camiseta' }.
export function partesDasRoupas(roupas, corpo) {
  const m = medidasDoCorpo(corpo);
  const atras = [], frente = [], rosto = [];
  // Peça de cabeça que cobre o cabelo diz a partir de que altura ele ainda
  // aparece (`cabelo`). O avatar corta o cabelo nessa linha: sem isso o
  // espetado atravessa o boné por cima, e cada corte novo teria que ser
  // conferido contra cada chapéu.
  let corteDoCabelo = null;

  for (const slot of ORDEM_SLOTS) {
    const r = roupinha(roupas?.[slot]);
    if (!r || r.slot !== slot) continue;
    const cor = corDaPeca(r);
    // O detalhe (bolso, fivela, pena) acompanha a camada que a peça tem. Peça
    // que só existe atrás do corpo — as asas — teria perdido o dela se ele
    // morasse sempre na camada da frente.
    const detalhe = r.detalhe ? r.detalhe(m, cor) : '';
    // A peça vai na escala da parte do corpo que ela veste (js/proporcao.js):
    // desenhada no molde, sai do tamanho da cabeça ou do tronco de agora.
    const z = r.z ?? SLOTS[slot].z;
    const regiao = regiaoDaRoupinha(r, z);
    const k = escalaDe(regiao);

    if (r.atras) atras.push(naRegiao(regiao, desenhar(r.atras, m, cor, k) + (r.arte ? '' : detalhe)));
    if (!r.arte) continue;
    const svg = naRegiao(regiao, desenhar(r.arte, m, cor, k) + detalhe);
    (z >= 60 ? rosto : frente).push({ z, svg });
  }

  for (const slot of ORDEM_SLOTS) {
    const r = roupinha(roupas?.[slot]);
    if (r?.cabelo != null) corteDoCabelo = Math.max(corteDoCabelo ?? 0, r.cabelo);
  }

  const ordenado = (lista) => lista.sort((a, b) => a.z - b.z).map(p => p.svg).join('');
  return {
    atras: atras.join(''), frente: ordenado(frente), rosto: ordenado(rosto),
    corteDoCabelo,
  };
}

// --------------------------- A peça sozinha -------------------------------
// A roupinha fora do corpo: é assim que ela aparece na casa do inventário.
// Item é item, e recorte de gente vestida não lê como item — a manga some
// atrás do braço, a bota vira um pedaço de perna, e duas peças parecidas
// ficam idênticas porque o que aparece é o corpo, não a roupa.
//
// O desenho é exatamente o mesmo que vai no corpo (as mesmas medidas, a manga
// que é o braço engordado): o que muda é que ninguém veste.
//
// O enquadramento é **medido do desenho**, não escrito à mão. Peça nova entra
// centrada sozinha, e mexer numa peça não deixa um recorte velho para trás.
// A medida sai de `getBoundingClientRect`, não de `getBBox`: metade desta
// coleção é traço grosso (manga, calça, cano de bota), e o getBBox mede a
// linha do meio, sem a grossura — a manga sairia cortada ao meio.
// O palco das roupinhas é o mesmo do avatar: elas são desenhadas no corpo.
const PALCO_W = CONFIG.STAGE_W, PALCO_H = CONFIG.STAGE_H;

const caixas = new Map();
let medidor = null;

function medir(interno) {
  if (typeof document === 'undefined' || !document.body) return null;
  if (!medidor) {
    medidor = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    medidor.setAttribute('viewBox', `0 0 ${PALCO_W} ${PALCO_H}`);
    medidor.setAttribute('aria-hidden', 'true');
    Object.assign(medidor.style, {
      position: 'absolute', left: '-10000px', top: '0',
      width: PALCO_W + 'px', height: PALCO_H + 'px',
      opacity: '0', pointerEvents: 'none',
    });
    document.body.append(medidor);
  }
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.innerHTML = interno;
  medidor.replaceChildren(g);

  const fora = medidor.getBoundingClientRect();
  const dentro = g.getBoundingClientRect();
  medidor.replaceChildren();
  // Escala de px por unidade de palco: com zoom de página os dois retângulos
  // crescem juntos, então dividir por ela devolve o desenho ao palco.
  const k = fora.width / PALCO_W;
  if (!k || !dentro.width || !dentro.height) return null;
  return [
    (dentro.left - fora.left) / k, (dentro.top - fora.top) / k,
    dentro.width / k, dentro.height / k,
  ];
}

// A caixa vira quadrada em volta do centro da peça: a casa do inventário é
// quadrada, e desenho esticado num lado é desenho torto.
function caixaDaPeca(chave, interno, margem) {
  if (caixas.has(chave)) return caixas.get(chave);
  const medida = medir(interno);
  let caixa = [0, 0, PALCO_W, PALCO_H];
  if (medida) {
    const [x, y, w, h] = medida;
    const lado = Math.max(w, h) + margem * 2;
    caixa = [x + w / 2 - lado / 2, y + h / 2 - lado / 2, lado, lado];
    caixas.set(chave, caixa);     // só guarda o que foi medido de verdade
  }
  return caixa;
}

// `atras` entra junto: a asa e a capa só existem nessa camada, e sem ela a
// peça apareceria vazia na casa.
export function svgRoupinha(r, corpo = 'masculino', { margem = 26 } = {}) {
  if (!r) return '';
  const m = medidasDoCorpo(corpo);
  const cor = corDaPeca(r);
  const interno =
    (r.atras ? desenhar(r.atras, m, cor) : '') +
    (r.arte ? desenhar(r.arte, m, cor) : '') +
    (r.detalhe ? r.detalhe(m, cor) : '');

  // `caixa` na peça vence a medida: par que mora longe um do outro — as duas
  // luvas, as duas pulseiras — daria um quadrado enorme com dois pingos nos
  // cantos. Aí a casa mostra um dos dois, de perto.
  const [x, y, w, h] = r.caixa
    ? r.caixa
    : caixaDaPeca(`${r.id}:${corpo}:${margem}`, interno, margem);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${nn(x)} ${nn(y)} ${nn(w)} ${nn(h)}"
     width="${nn(w)}" height="${nn(h)}">${interno}</svg>`;
}

// ------------------------- Roupa dos outros -------------------------------
// Perfil fictício também anda vestido, senão o feed vira uma fila de gente
// pelada ao lado do seu avatar de roupa. Mesma semente do id, como a
// aparência: a mesma pessoa usa sempre a mesma roupa, em qualquer navegador.
export function roupasSorteadas(chave) {
  const rnd = mulberry32(sementeDoTexto('roupinhas:' + chave));
  const roupas = {};
  const vestir = (slot, chance) => {
    const opcoes = doSlot(slot).filter(r => ['common', 'uncommon'].includes(r.raridade));
    if (!opcoes.length || rnd() >= chance) return;
    roupas[slot] = escolher(opcoes, rnd).id;
  };
  vestir('torso', 1);
  vestir('pernas', 1);
  vestir('pes', 0.9);
  vestir('cabeca', 0.35);
  vestir('acessorio', 0.4);
  vestir('cintura', 0.2);
  return roupas;
}
