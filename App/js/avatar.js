// Avatar 2D de corpo inteiro — o manequim base sobre o qual as colagens acontecem.
//
// Também serve como guia técnico para os ilustradores convidados: o palco é
// 600×1200, o corpo é desenhado num molde de 8 cabeças e os pontos de
// ancoragem por categoria estão em config.js (CATEGORIAS[*].anchor). A
// proporção que aparece na tela (cabeça maior, tronco menor) é aplicada por
// cima do molde — ver js/proporcao.js. Ligando o guia (ver Stylist) os pontos
// aparecem desenhados sobre o corpo.
//
// A aparência (pele, corte, cor do cabelo e nariz) vem do perfil. Quem não
// passa nada recebe a do usuário — assim Stylist, prancheta, molde e exportação
// mostram o mesmo personagem sem cada um precisar saber disso.
//
// `roupas` é o outro eixo: as roupinhas desenhadas do vestiário
// (js/roupinhas.js), equipadas por slot. Quem não passa nada recebe o corpo
// pelado, e é de propósito — o Stylist veste o avatar de roupa fotografada, e
// duas roupas no mesmo corpo seria uma em cima da outra. Quem pede as
// roupinhas é quem mostra a pessoa: perfil, retrato e página pública.

import {
  CONFIG, CATEGORIAS, CORPOS, PELES, CABELOS,
  CORES_CABELO, NARIZES, SOBRANCELHAS, SOBRANCELHAS_NO_AR, SOMBRA_ROSTO_NO_AR, PIERCINGS_ORELHA, PIERCINGS_BRIDGE,
  SARDAS,
} from './config.js';
import { partesDasRoupas } from './roupinhas.js';
import { naRegiao, escalaDe, ancoraNoCorpo, recorteNaRegiao } from './proporcao.js';
import * as db from './db.js';
import { el, mulberry32, escolher, sementeDoTexto } from './util.js';

// Cabeça: elipse em (300, 112), raios 56 × 70 → topo em y=42, base em y=182 —
// no molde. No palco ela sai na escala de js/proporcao.js, como o tronco.

// Corpo desenhado (proporção em teste com `corpo`): os corpos e os narizes da
// artista, cada um uma máscara de pele e uma de traço (js/corpo-artista.js),
// pintadas na cor da pele de quem veste. app.js entrega o desenho antes de
// qualquer tela desenhar o avatar; sem ele o corpo de código continua.
let corpoDesenhado = null;
export function usarCorpoDesenhado(desenho) { corpoDesenhado = desenho; }

// Os corpos e narizes que dá para escolher: os da artista quando ela está no
// palco, senão os de código (config.js). Os dois têm `nome`, e o id padrão
// (masculino, botao) existe nos dois.
export const catalogoCorpos = () => corpoDesenhado?.corpos || CORPOS;
export const catalogoNarizes = () => (corpoDesenhado
  ? { nenhum: NARIZES.nenhum, ...corpoDesenhado.narizes }
  : NARIZES);
// As sobrancelhas são de código nos dois corpos.
export const catalogoSobrancelhas = () => SOBRANCELHAS;
// Os cortes, do mesmo jeito: os da artista com ela no palco, senão os de
// código. O raspado é o mesmo nos dois.
export const catalogoCabelos = () => (corpoDesenhado?.cabelos
  ? { nenhum: CABELOS.nenhum, ...corpoDesenhado.cabelos }
  : CABELOS);

// Corte de código que a artista não desenhou → o desenhado mais parecido, para
// quem escolheu um deles continuar com cabelo parecido (o perfil guarda o id).
const CORTE_PARECIDO = {
  chanel: 'franja', longo: 'coque', moicano: 'espetado', topete: 'curto',
  dreads: 'trancas', rabo: 'coque', chiquinhas: 'coque', cortina: 'ondulado',
  coques: 'coque', chifres: 'espetado',
};
const corteDoCatalogo = (id) => {
  const cortes = catalogoCabelos();
  if (cortes[id]) return id;
  return cortes[CORTE_PARECIDO[id]] ? CORTE_PARECIDO[id] : 'curto';
};

// De ids (pele: 'clara') para cores prontas de desenhar.
export function resolverAparencia(cfg = {}) {
  const pele = PELES.find(p => p.id === cfg.pele) || PELES[1];
  return {
    pele: pele.cor,
    traco: pele.traco,
    corpo: catalogoCorpos()[cfg.corpo] ? cfg.corpo : 'masculino',
    cabelo: corteDoCatalogo(cfg.cabelo),
    corCabelo: cfg.corCabelo || '#3d2519',
    nariz: catalogoNarizes()[cfg.nariz] ? cfg.nariz : 'botao',
    sobrancelha: SOBRANCELHAS[cfg.sobrancelha] ? cfg.sobrancelha : 'nenhuma',
    corSobrancelha: cfg.corSobrancelha || '',
    ...piercingsDasOrelhas(cfg),
    bridge: PIERCINGS_BRIDGE[cfg.bridge] ? cfg.bridge : 'nenhum',
    sardas: SARDAS[cfg.sardas] ? cfg.sardas : 'nenhuma',
  };
}

// Os tipos de uma orelha, na ordem do catálogo ('ambos' é de um formato de
// minutos antes: bolinhas e spikes).
export function tiposDaOrelha(valor) {
  const tem = String(valor || '').replace('ambos', 'bolinhas+spikes').split('+');
  return Object.keys(PIERCINGS_ORELHA).filter(t => tem.includes(t));
}
export const juntarTipos = (tipos) => (tipos.length ? tipos.join('+') : 'nenhum');

// Piercing de cada orelha. Os formatos de antes (21/10/2026, minutos no ar
// cada um) guardavam quantos brincos e spikes; quem salvou neles abre com o
// mesmo tipo, agora sempre três.
export function piercingsDasOrelhas(cfg = {}) {
  if (cfg.orelhaEsq || cfg.orelhaDir) {
    const ok = (v) => juntarTipos(tiposDaOrelha(v));
    return { orelhaEsq: ok(cfg.orelhaEsq), orelhaDir: ok(cfg.orelhaDir) };
  }
  const tem = (id) => !!id && id !== 'nenhum';
  const lado = (brinco, spike) => juntarTipos([
    ...(tem(brinco) ? ['bolinhas'] : []), ...(tem(spike) ? ['spikes'] : [])]);
  const antigo = (l) => (tem(cfg.brincos) && cfg.ladoBrincos !== l ? cfg.brincos : '');
  return {
    orelhaEsq: lado(cfg.brincoEsq || antigo('direita'), cfg.spikeEsq),
    orelhaDir: lado(cfg.brincoDir || antigo('esquerda'), cfg.spikeDir),
  };
}

// Piercings na cara da artista (o corpo de código não tem orelha).
// As bolinhas são as da orelha da esquerda da tela, no palco, da do lóbulo
// para cima, medidas no desenho dela; a da direita é espelhada em x=300, como
// o desenho. Ficam embaixo do cabelo da frente: cabelo comprido as cobre.
// Nada de círculo perfeito: cada bolinha é um borrão torto (sempre o mesmo,
// pela semente) e o filtro esfarela a borda, como o traço granulado dela.
const BOLINHAS_BRINCO = [[223.5, 168, 2.6], [219.5, 161.5, 2.2], [217.5, 155, 1.8]];
function bolinhaTorta(cx, cy, r, rnd) {
  const n = 9;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
    const k = r * (0.82 + rnd() * 0.3);
    return [cx + Math.cos(a) * k, cy + Math.sin(a) * k * (0.9 + rnd() * 0.15)];
  });
  // Curva pelos meios dos lados, com os pontos de controle: fecha redonda.
  const meio = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const f = (p) => p.map(v => v.toFixed(2)).join(' ');
  let d = `M${f(meio(pts[n - 1], pts[0]))}`;
  for (let i = 0; i < n; i++) d += ` Q${f(pts[i])} ${f(meio(pts[i], pts[(i + 1) % n]))}`;
  return `<path d="${d}Z"/>`;
}
// Spikes: [x, y] na borda de fora da orelha da esquerda e a direção para
// fora dela, do de trás para o de cima. A base entra um pouco na borda, para
// o espinho sair do traço e não flutuar ao lado dele.
const PONTOS_SPIKE = [[214.4, 138.2, -0.8, -0.6], [211.4, 146, -1, -0.15], [219.6, 133, -0.3, -1]];
function spikeTorto(x, y, dx, dy, rnd, escala = 1) {
  const n = Math.hypot(dx, dy), ux = dx / n, uy = dy / n;   // para fora
  const bx = x - ux * 0.9, by = y - uy * 0.9;               // base, já na borda
  const meia = (1.6 + rnd() * 0.4) * escala, alto = (4.6 + rnd() * 1.2) * escala;
  const torto = (rnd() - 0.5) * 1.2;                         // ponta meio de lado
  const p = [
    [bx - uy * meia, by + ux * meia],
    [bx + ux * alto - uy * torto, by + uy * alto + ux * torto],
    [bx + uy * meia, by - ux * meia],
  ].map(([a, b]) => `${a.toFixed(2)} ${b.toFixed(2)}`);
  return `<path d="M${p[0]} L${p[1]} L${p[2]} Z" stroke="#2b2522" stroke-width=".6"
    stroke-linejoin="round"/>`;
}
// Argolas: as faixas grossas que abraçam a borda de trás da orelha, como na
// foto. [x, y] no traço da borda da orelha da esquerda e a direção para fora;
// cada uma atravessa o traço, metade para fora e metade para dentro.
const PONTOS_ARGOLA = [[211.3, 150.5, -1, 0], [212.3, 157.5, -0.95, 0.3]];
function argolaTorta(x, y, dx, dy, rnd) {
  const n = Math.hypot(dx, dy), ux = dx / n, uy = dy / n;
  const fora = 2.8 + rnd() * 0.4, dentro = 2.4 + rnd() * 0.4;   // ao longo da direção
  const meia = 1.25 + rnd() * 0.25;                                // espessura / 2
  const p = [
    [x + ux * fora - uy * meia, y + uy * fora + ux * meia],
    [x + ux * fora + uy * meia, y + uy * fora - ux * meia],
    [x - ux * dentro + uy * meia * 0.9, y - uy * dentro - ux * meia * 0.9],
    [x - ux * dentro - uy * meia * 0.9, y - uy * dentro + ux * meia * 0.9],
  ].map(([a, b]) => `${a.toFixed(2)} ${b.toFixed(2)}`);
  return `<path d="M${p.join(' L')} Z" stroke="#2b2522" stroke-width=".9"
    stroke-linejoin="round"/>`;
}

// Bridge: as duas pontas da barrinha, uma de cada lado do alto do nariz,
// entre os olhos (no palco, na cara da artista). Os spikes apontam para fora.
// Maiores que os da orelha para aparecer no rosto, mas com mais espaço entre
// as duas pontas para não lembrarem um par de olhos. As pontas são 20% maiores
// que as primeiras (pedido do João, 21/10/2026), e uma sombra fina e esfumada
// liga uma à outra por baixo da pele: lê como a barrinha atravessando, não
// como dois olhos.
const BRIDGE = { y: 143, meio: 6.6, r: 2.64, spike: 1.62, sombra: 0.3 };

// O rosto (pedido do João, 21/10/2026): olhos, nariz, sombras, sobrancelhas e
// o bridge 15% maiores, crescendo juntos em volta do meio da cara, sem mexer
// no contorno da cabeça (nem nas orelhas e nos brincos dela).
const ROSTO = { x: 300, y: 155, escala: 1.15 };
const noRosto = (svg) => (svg && svg.trim()
  ? `<g transform="translate(${ROSTO.x} ${ROSTO.y}) scale(${ROSTO.escala})
       translate(${-ROSTO.x} ${-ROSTO.y})">${svg}</g>`
  : '');

// Todos os piercings, embaixo do cabelo da frente (pedido do João): cabelo
// que cobre a orelha ou a franja comprida os cobre. Um filtro só esfarela a
// borda de todos.
function piercings(ap, id) {
  if (!corpoDesenhado) return '';
  const partes = [[1, ap.orelhaEsq], [-1, ap.orelhaDir]].flatMap(([l, escolha]) => {
    const tipos = tiposDaOrelha(escolha);
    const rnd = mulberry32(l === 1 ? 7 : 11);
    const lado = (x) => (l === 1 ? x : 600 - x);
    return [
      ...(tipos.includes('bolinhas')
        ? BOLINHAS_BRINCO.map(([x, y, r]) => bolinhaTorta(lado(x), y, r, rnd)) : []),
      ...(tipos.includes('spikes')
        ? PONTOS_SPIKE.map(([x, y, dx, dy]) => spikeTorto(lado(x), y, dx * l, dy, rnd)) : []),
      ...(tipos.includes('argolas')
        ? PONTOS_ARGOLA.map(([x, y, dx, dy]) => argolaTorta(lado(x), y, dx * l, dy, rnd)) : []),
    ];
  });
  const b = PIERCINGS_BRIDGE[ap.bridge] || {};
  const pontas = [];
  if (b.bolinhas || b.spikes) {
    const rnd = mulberry32(13);
    for (const l of [1, -1]) {
      const x = 300 - l * BRIDGE.meio;
      pontas.push(b.bolinhas
        ? bolinhaTorta(x, BRIDGE.y, BRIDGE.r, rnd)
        : spikeTorto(x + l * 0.9, BRIDGE.y, -l, 0, rnd, BRIDGE.spike));
    }
  }
  if (!partes.length && !pontas.length) return '';
  const sombraDoBridge = pontas.length ? `<filter id="${id}-barra" x="-50%" y="-200%" width="200%" height="500%">
    <feGaussianBlur stdDeviation=".9"/>
  </filter>
  <ellipse cx="300" cy="${BRIDGE.y}" rx="${BRIDGE.meio}" ry="1.3"
           fill="${escurecerTraco(ap.pele, 0.55)}" opacity="${BRIDGE.sombra}"
           filter="url(#${id}-barra)"/>` : '';
  return `<filter id="${id}-grao" x="-30%" y="-30%" width="160%" height="160%">
    <feTurbulence type="fractalNoise" baseFrequency="2.4" numOctaves="2" seed="4"/>
    <feDisplacementMap in="SourceGraphic" scale="1.3" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  ${noRosto(sombraDoBridge)}
  <g fill="#2b2522" opacity=".92" filter="url(#${id}-grao)">${partes.join('')}${noRosto(pontas.join(''))}</g>`;
}

// Sardas (pedido do João, 21/10/2026): pintinhas espalhadas nas manchas de
// config.SARDAS, cada uma um borrão torto como as bolinhas dos piercings e
// com o mesmo filtro granulado, na cor da pele bem mais escura. As posições
// saem de uma semente fixa (sempre as mesmas) e não deixam duas pintinhas
// encostarem.
function pintinhasNaMancha([cx, cy, rx, ry, n], s, rnd) {
  const [rMin, rMax] = s.raio || [0.85, 1.45], longe = s.afastamento || 3.4;
  const pontos = [];
  for (let tentativa = 0; pontos.length < n && tentativa < n * 40; tentativa++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd());
    const x = cx + Math.cos(a) * d * rx, y = cy + Math.sin(a) * d * ry;
    if (pontos.every(([px, py]) => Math.hypot(px - x, py - y) > longe)) pontos.push([x, y]);
  }
  return pontos.map(([x, y]) => bolinhaTorta(x, y, rMin + rnd() * (rMax - rMin), rnd));
}
function sardas(ap, id) {
  const s = SARDAS[ap.sardas];
  if (!corpoDesenhado || !s || !(s.manchas || s.fixas)) return '';
  const rnd = mulberry32(17);
  const partes = [
    ...(s.manchas || []).flatMap(m => pintinhasNaMancha(m, s, rnd)),
    ...(s.fixas || []).map(([x, y, r]) => bolinhaTorta(x, y, r, rnd)),
  ];
  return `<filter id="${id}-sardas" x="-30%" y="-30%" width="160%" height="160%">
    <feTurbulence type="fractalNoise" baseFrequency="2.4" numOctaves="2" seed="9"/>
    <feDisplacementMap in="SourceGraphic" scale=".8" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <g fill="${escurecerTraco(ap.pele, 0.5)}" opacity="${s.opacidade ?? 0.62}"
     filter="url(#${id}-sardas)">${partes.join('')}</g>`;
}

// Sombra do cabelo na testa (pedido do João, 21/10/2026): o próprio desenho
// da franja, descido um pouco e esfumado, na cor da pele mais escura. Assim
// ela acompanha a linha de cada corte, em vez de uma faixa reta. Fica presa à
// pele da cara (não vaza no fundo nem nas orelhas). Só na cara da artista e
// só com cabelo (careca não faz sombra).
function sombraDaTesta(ap, id) {
  const franja = corpoDesenhado?.cabelos?.[ap.cabelo]?.frente;
  const corpo = corpoDesenhado?.corpos[ap.corpo];
  if (!franja?.pele || !corpo) return '';
  const mascara = (nome, [x, y, w, h], img) => `<mask id="${nome}" maskUnits="userSpaceOnUse"
      x="0" y="-200" width="600" height="1400">
    <image href="${img}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/>
  </mask>`;
  const [x, y, w, h] = franja.caixa;
  return `${mascara(`${id}-testa-pele`, corpo.caixa, corpo.pele)}
  ${mascara(`${id}-testa-franja`, franja.caixa, franja.pele)}
  <filter id="${id}-testa" x="-20%" y="-30%" width="140%" height="160%">
    <feGaussianBlur stdDeviation="2.4"/>
  </filter>
  <g mask="url(#${id}-testa-pele)">
    <g filter="url(#${id}-testa)" opacity=".5">
      <g transform="translate(0 6)">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${escurecerTraco(ap.pele, 0.55)}"
              mask="url(#${id}-testa-franja)"/>
      </g>
    </g>
  </g>`;
}

// Nariz da artista (pedido do João, 21/10/2026): uma sombra esfumada do lado
// esquerdo, do tamanho do nariz, e o miolo pintado com a pele um pouco mais
// escura. Só os de contorno fechado (pontudo, largo) têm miolo: nos
// de traço aberto, como o botão, fica só a sombra.
function sombraDoNariz(ap, id) {
  const nariz = corpoDesenhado?.narizes[ap.nariz];
  if (!nariz) return '';
  const [x, y, w, h] = nariz.caixa;
  return `<filter id="${id}-nariz" x="-100%" y="-60%" width="300%" height="220%">
    <feGaussianBlur stdDeviation="2.6"/>
  </filter>
  <ellipse cx="${(x + w * 0.22).toFixed(1)}" cy="${(y + h * 0.5).toFixed(1)}"
           rx="${Math.max(4.2, w * 0.22).toFixed(1)}" ry="${Math.max(10, h * 0.55).toFixed(1)}"
           fill="${escurecerTraco(ap.pele, 0.55)}" opacity=".5" filter="url(#${id}-nariz)"/>`;
}

// Sombra do rosto (escolhida pelo João, 21/10/2026, a "17" das ideias;
// liga em config.SOMBRA_ROSTO_NO_AR): sem desenhar olho, um arco de sombra
// embaixo de cada olho e, do lado esquerdo, a sombra do nariz subindo até o
// olho, como no mangá. O claro que sobra em cima do arco lê como o olho.
// Medidas no palco, a cara no meio em x=300.
const OLHEIRA = { y: 151, meio: 28, largura: 13, fundo: 10, opacidade: 0.58 };
function sombraDoRosto(ap, id) {
  if (!SOMBRA_ROSTO_NO_AR || !corpoDesenhado) return '';
  const cor = escurecerTraco(ap.pele, 0.55);
  const { y, meio, largura: l, fundo, opacidade } = OLHEIRA;
  const arco = (cx) => `<path d="M${cx - l} ${y} Q${cx} ${y + fundo} ${cx + l} ${y}
    Q${cx} ${y + fundo * 0.6} ${cx - l} ${y}Z"/>`;
  // A linha do nariz sai da base dele, do lado esquerdo, e sobe até o canto
  // de dentro do olho esquerdo.
  const nariz = corpoDesenhado.narizes[ap.nariz];
  const [nx, ny, nw, nh] = nariz ? nariz.caixa : [290, 160, 20, 20];
  const olho = 300 - meio;
  const subida = `<path d="M${(nx + nw * 0.15).toFixed(1)} ${(ny + nh - 6).toFixed(1)}
    Q${(nx - 4).toFixed(1)} ${y + 1} ${olho - 4} ${y - 5}
    Q${olho + 12} ${y - 5} ${(nx + nw * 0.3).toFixed(1)} ${(ny + nh * 0.4).toFixed(1)}Z"
    opacity=".52" filter="url(#${id}-manga)"/>`;
  return `<filter id="${id}-olheira" x="-50%" y="-100%" width="200%" height="300%">
    <feGaussianBlur stdDeviation="2.1"/>
  </filter>
  <filter id="${id}-manga" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="2.2"/>
  </filter>
  <g fill="${cor}">
    <g opacity="${opacidade}" filter="url(#${id}-olheira)">${arco(300 - meio)}${arco(300 + meio)}</g>
    ${subida}
  </g>`;
}

export const aparenciaAtual = () => resolverAparencia(db.state.usuario.avatar || {});

// Aparência sorteada a partir de um texto (o id do perfil). Mesma semente,
// mesma pessoa: o avatar de alguém não muda a cada render nem a cada sessão,
// e perfil novo já nasce com cara própria sem ninguém cadastrar nada.
// (A semente vem de util.js: o perfil público sorteia os números dele com a
// mesma, então a pessoa é coerente da cara aos seguidores.)

// O feed continua parecendo gente: a pele de fantasia entra em uma pessoa a
// cada cinco, e o focinho fica de fora — esses são escolhas de quem edita.
export function aparenciaSorteada(chave) {
  const rnd = mulberry32(sementeDoTexto(chave));
  const grupo = rnd() < 0.8 ? 'humana' : 'fantasia';
  return {
    corpo: escolher(Object.keys(catalogoCorpos()), rnd),
    pele: escolher(PELES.filter(p => p.grupo === grupo), rnd).id,
    cabelo: escolher(Object.keys(catalogoCabelos()).filter(c => c !== 'nenhum'), rnd),
    corCabelo: escolher(CORES_CABELO, rnd),
    nariz: escolher(Object.keys(catalogoNarizes()).filter(n => n !== 'nenhum' && n !== 'focinho'), rnd),
  };
}

// A de um perfil: a explícita, quando existir; senão a sorteada pelo id.
export const aparenciaDoPerfil = (perfil) =>
  resolverAparencia(perfil?.aparencia || aparenciaSorteada(perfil?.id || '?'));

// Cabecinha: só a cabeça do avatar (cabelo, rosto, chapéu e óculos), sem
// fundo nem moldura — é o que aparece no lugar das bolinhas (botão do topo,
// feed, avisos, busca, amigos). O quadrado pega a cabeça com folga para o
// cabelo dos lados e de cima, no molde, e acompanha a proporção.
const CABECINHA = recorteNaRegiao('cabeca', [212, 21, 176, 176]);
// O queixo, no palco: o de baixo da cabeça (y=182 no molde) e um respiro.
const [, QUEIXO] = recorteNaRegiao('cabeca', [0, 186, 0, 0]);

export function cabeca(aparencia, tamanho = 34, roupas = null) {
  const caixa = el('span', {
    class: 'cabecinha',
    style: { width: tamanho + 'px', height: tamanho + 'px' },
  });
  caixa.innerHTML = svgAvatar({ aparencia, roupas, recorte: CABECINHA, soCabeca: true });
  const svg = caixa.querySelector('svg');
  Object.assign(svg.style, { width: '100%', height: '100%' });
  centrarNaCaixa(svg, larguraDoCabelo(aparencia));
  return caixa;
}

// O cabelo cheio (afro, cacheado, ondulado) passa dos lados do quadrado e saía
// da caixa (pedido do João, 21/10/2026): a largura do desenho do corte, nos
// dois lados do meio da cara (x=300), entra na conta do quadrado.
function larguraDoCabelo(aparencia) {
  const corte = catalogoCabelos()[corteDoCatalogo(aparencia?.cabelo)];
  const caixas = [corte?.atras?.caixa, corte?.frente?.caixa].filter(Array.isArray);
  if (!caixas.length) return 0;
  const meia = Math.max(...caixas.map(([x, , w]) => Math.max(300 - x, x + w - 300)));
  return meia * 2 + 4;
}

// Cada corte tem uma altura (espetado e afro sobem bem acima do raspado, um
// chapéu sobe mais ainda), e com o quadrado fixo a cabeça ficava ora alta, ora
// baixa na caixa. Quando ela já está na tela dá para medir: o quadrado desliza
// para o meio entre o topo do desenho e o queixo, no mesmo tamanho (a cabeça
// não muda de escala de um avatar para outro); só cresce se não couber.
function centrarNaCaixa(svg, largura = 0, tentativas = 20) {
  if (!svg.isConnected) {
    if (tentativas > 0) requestAnimationFrame(() => centrarNaCaixa(svg, largura, tentativas - 1));
    return;
  }
  const desenho = svg.querySelector(':scope > g[mask]');
  if (!desenho) return;
  let topo;
  try { topo = desenho.getBBox().y; } catch { return; }
  const lado = Math.max(CABECINHA[3], QUEIXO - topo, largura);
  const y = (topo + QUEIXO) / 2 - lado / 2;
  svg.setAttribute('viewBox', `${300 - lado / 2} ${y} ${lado} ${lado}`);
}

// O boneco é um monte de peça sobreposta (braço, tronco, pescoço, cabeça). Dar
// contorno a cada uma mostraria as costuras por dentro da silhueta, então ele é
// desenhado duas vezes: primeiro engordado na cor do traço, depois na cor da
// pele por cima. Sobra só a linha de fora, que é a do corpo inteiro.
const CONTORNO = 6;   // largura da borda; metade sobra para fora da silhueta

// Cada parte na escala dela (js/proporcao.js), e as duas passadas continuam
// valendo: o contorno é o da união das partes já escaladas. A engorda de cada
// parte é dividida pela escala dela, para a linha sair da mesma grossura na
// cabeça e no tronco.
// `soCabeca` deixa o pescoço e o resto de fora: é a cabecinha que flutua nos
// botões, sem moldura.
const corpo = (id, cor, extra, soCabeca = false) => {
  const forma = CORPOS[id] || CORPOS.masculino;
  const parte = (regiao, nome) => {
    const e = extra / escalaDe(regiao);
    return naRegiao(regiao, `<g stroke-width="${e}">${forma.partes(e)[nome]}</g>`);
  };
  return `
  <g fill="${cor}" stroke="${cor}"
     stroke-linejoin="round" stroke-linecap="round">
    ${soCabeca ? '' : parte('perna', 'pernas') + parte('tronco', 'tronco')}${parte('cabeca', 'cabeca')}
  </g>`;
};

// Um desenho da artista (corpo ou nariz): a pele pintada embaixo e o traço por
// cima, cada um num retângulo do tamanho da `caixa` dele no palco. `id` tem de
// ser único no SVG: a página desenha vários avatares, e máscara com id
// repetido pinta um com o desenho do outro.
const daArtista = (id, desenho, pele, traco) => {
  if (!desenho) return '';
  const [x, y, w, h] = desenho.caixa;
  const camada = (nome, cor) => (desenho[nome] ? `
  <mask id="${id}-${nome}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}">
    <image href="${desenho[nome]}" x="${x}" y="${y}" width="${w}" height="${h}"
           preserveAspectRatio="none"/>
  </mask>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${cor}" mask="url(#${id}-${nome})"/>` : '');
  return camada('pele', pele) + camada('linha', traco);
};

// O cabelo engorda o mesmo tanto que o corpo. A silhueta ganhou CONTORNO/2 de
// borda para fora, e corte desenhado rente à cabeça antiga (quase todos vão de
// x=244 a x=356, que era a largura exata dela) passou a deixar aparecer um
// filete de pele em volta. Engordar o desenho na própria cor resolve sem mexer
// corte por corte — volume de cabelo não tem medida exata a respeitar.
// A conta é feita na escala da cabeça, como o contorno dela.
const VOLUME = CONTORNO / escalaDe('cabeca') + 2;   // dois a mais: sobra 1 de folga

const comVolume = (arte, cor) => (arte.trim()
  ? `<g stroke="${cor}" stroke-width="${VOLUME}"
        stroke-linejoin="round" stroke-linecap="round">${arte}</g>`
  : '');

// `recorte` é [x, y, w, h] no sistema do palco: o mesmo desenho, enquadrado em
// um pedaço dele. É como as miniaturas de corte e de nariz mostram só a cabeça
// sem existir um segundo desenho para manter em dia.
// `soCabeca` desenha só a cabeça: cabelo, rosto, chapéu e óculos, sem pescoço,
// corpo nem a roupa dele.
export function svgAvatar({
  guia = false, fundo = 'none', aparencia = null, recorte = null, roupas = null,
  soCabeca = false,
} = {}) {
  const ap = aparencia || aparenciaAtual();
  const veste = partesDasRoupas(roupas, ap.corpo, soCabeca);
  const corte = catalogoCabelos()[ap.cabelo] || CABELOS.curto;

  // Chapéu na cabeça corta o cabelo na altura que ele mandar (roupinhas.js:
  // `cabelo` na peça). O que sobra é o que apareceria por baixo da aba — e o
  // espetado para de atravessar o boné por cima sem ninguém desenhar uma
  // versão "de chapéu" de cada corte.
  //
  // O id do recorte é único por SVG: a mesma página desenha vários avatares
  // (o feed, o perfil, as miniaturas), e id repetido faz um usar o recorte do
  // outro.
  const idCorte = 'cab' + Math.random().toString(36).slice(2, 8);
  const cortado = (svg) => (veste.corteDoCabelo == null || !svg.trim())
    ? svg
    : `<g clip-path="url(#${idCorte})">${svg}</g>`;

  // O corte da artista já está no palco (como o corpo dela) e tem a linha do
  // chapéu passada para o palco; o de código é desenhado na cabeça do molde.
  const cabelo = (parte) => (typeof corte[parte] === 'object'
    ? cortadoNoPalco(daArtista(idCorte + parte, corte[parte], ap.corCabelo,
      escurecerTraco(ap.corCabelo, 0.55)))
    : naRegiao('cabeca', cortado(
      comVolume((corte[parte] || '').replaceAll('{cor}', ap.corCabelo), ap.corCabelo))));
  const cortadoNoPalco = (svg) => (veste.corteDoCabelo == null || !svg)
    ? svg
    : `<g clip-path="url(#${idCorte}-palco)">${svg}</g>`;
  // O nariz da artista é desenhado com o corpo dela, mais abaixo.
  const nariz = corpoDesenhado ? ''
    : (NARIZES[ap.nariz] || NARIZES.botao).arte.replaceAll('{traco}', ap.traco);
  // Sobrancelha: a arte é a da esquerda; a da direita é ela espelhada no meio
  // da cara (x=300). Fica na testa do molde, de x=262 a 292, um pouco esticada
  // na altura para o traço acompanhar o da artista; a franja passa
  // por cima dela.
  const arteSobrancelha = SOBRANCELHAS_NO_AR
    ? (SOBRANCELHAS[ap.sobrancelha] || SOBRANCELHAS.nenhuma).arte : '';
  // Borda irregular, como o traço da artista (pedido do João, 21/10/2026):
  // o ruído só entorta o contorno; o miolo fica cheio, sem falhas.
  const sobrancelhas = arteSobrancelha ? `<filter id="${idCorte}-sobr" x="-30%" y="-30%" width="160%" height="160%">
    <feTurbulence type="fractalNoise" baseFrequency="1.2" numOctaves="2" seed="6"/>
    <feDisplacementMap in="SourceGraphic" scale="1.6" xChannelSelector="R" yChannelSelector="G"/>
  </filter>` + naRegiao('cabeca',
    `<g fill="${ap.corSobrancelha || escurecerTraco(ap.corCabelo, 0.8)}" stroke="none"
        filter="url(#${idCorte}-sobr)">
      <g transform="translate(262 104) scale(1 1.4)">${arteSobrancelha}</g>
      <g transform="translate(338 104) scale(-1 1.4)">${arteSobrancelha}</g>
    </g>`) : '';
  // O afro e o coque da artista passam do alto do palco: no corpo inteiro o
  // SVG deixa o desenho sair da caixa em vez de cortá-los retos. Com recorte
  // não, que ali a caixa é a moldura (retrato, miniatura).
  const [vx, vy, vw, vh] = recorte || [0, 0, CONFIG.STAGE_W, CONFIG.STAGE_H];

  const pontos = guia ? Object.entries(CATEGORIAS).map(([cat, c]) => {
    const a = ancoraNoCorpo(c.regiao, c.anchor);
    return `
      <g class="guia">
        <circle cx="${a.x}" cy="${a.y}" r="6" fill="#ff2e63" opacity=".85"/>
        <line x1="${a.x - a.w / 2}" y1="${a.y}"
              x2="${a.x + a.w / 2}" y2="${a.y}"
              stroke="#ff2e63" stroke-width="2" stroke-dasharray="6 5" opacity=".55"/>
        <text x="${a.x + a.w / 2 + 10}" y="${a.y + 5}"
              font-family="monospace" font-size="19" fill="#ff2e63">${cat}</text>
      </g>`;
  }).join('') : '';

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}"
     width="${vw}" height="${vh}"${recorte ? '' : ' overflow="visible"'}>
  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${fundo}"/>
  ${soCabeca ? esmaecerEmbaixo(idCorte, vy + vh) : ''}
  ${veste.corteDoCabelo == null ? '' : `<clipPath id="${idCorte}">
    <rect x="0" y="${veste.corteDoCabelo}" width="${CONFIG.STAGE_W}"
          height="${CONFIG.STAGE_H}"/>
  </clipPath>
  <clipPath id="${idCorte}-palco">
    <rect x="0" y="${recorteNaRegiao('cabeca', [0, veste.corteDoCabelo, 0, 0])[1]}"
          width="${CONFIG.STAGE_W}" height="${CONFIG.STAGE_H * 2}"/>
  </clipPath>`}

  <!-- cabelo que fica atrás do corpo (o da artista vai inteiro aqui) -->
  ${cabelo('atras')}

  <!-- roupinha que fica atrás do corpo: capa, mochila, asas, capuz caído -->
  ${veste.atras}

  ${corpoDesenhado ? cortadoNaCabeca(idCorte, soCabeca,
    daArtista(idCorte, corpoDesenhado.corpos[ap.corpo], ap.pele, escurecerTraco(ap.traco))) : `
  ${corpo(ap.corpo, ap.traco, CONTORNO, soCabeca)}
  ${corpo(ap.corpo, ap.pele, 0, soCabeca)}`}

  <!-- roupinha vestida, por camada: calça, calçado, torso, alça, luva -->
  ${veste.frente}

  <!-- sobrancelhas embaixo do cabelo da frente: a franja as cobre -->
  ${noRosto(sobrancelhas)}

  <!-- sombra que o cabelo faz na testa, embaixo dele -->
  ${cortadoNoPalco(sombraDaTesta(ap, idCorte))}

  <!-- sombra embaixo dos olhos e a do nariz subindo até o olho -->
  ${noRosto(sombraDoRosto(ap, idCorte))}

  <!-- piercings, também embaixo do cabelo da frente -->
  ${piercings(ap, idCorte)}

  <!-- cabelo por cima da cabeça -->
  ${cabelo('frente')}

  <!-- rosto por último: só o nariz, e o cabelo nunca o cobre. O traço é
       dividido pela escala da cabeça para não engrossar junto com ela. -->
  ${noRosto(nariz ? naRegiao('cabeca', `<g fill="none" stroke="${ap.traco}"
       stroke-width="${(3.2 / escalaDe('cabeca')).toFixed(2)}"
       stroke-linecap="round" stroke-linejoin="round" opacity=".78">${nariz}</g>`) : '')}

  ${noRosto(sombraDoNariz(ap, idCorte))}
  ${noRosto(corpoDesenhado ? daArtista(idCorte + 'n', corpoDesenhado.narizes[ap.nariz],
    escurecerTraco(ap.pele, 0.9),
    escurecerTraco(ap.traco)) : '')}

  <!-- sardas por cima do nariz, como ele: o cabelo não as cobre -->
  ${sardas(ap, idCorte)}

  <!-- o que vem depois do rosto: óculos e chapéu, por cima do cabelo -->
  ${veste.rosto}
  ${soCabeca ? '</g>' : ''}
  ${pontos}
</svg>`.trim();
}

// A cabecinha não tem moldura, então o SVG deixa o desenho passar da caixa
// (afro e coque sobem um pouco além dela). Só embaixo há um limite: cabelo
// comprido desceria até a cintura, e ele some num degradê no fim da caixa em
// vez de terminar numa linha reta. Abre um <g> que svgAvatar fecha.
function esmaecerEmbaixo(id, fim) {
  const comeco = fim - 26;
  return `<linearGradient id="${id}-fim" gradientUnits="userSpaceOnUse"
      x1="0" y1="${comeco}" x2="0" y2="${fim}">
    <stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <mask id="${id}-mascara" maskUnits="userSpaceOnUse" x="-${CONFIG.STAGE_W}" y="-${CONFIG.STAGE_H}"
        width="${CONFIG.STAGE_W * 3}" height="${CONFIG.STAGE_H * 2}">
    <rect x="-${CONFIG.STAGE_W}" y="-${CONFIG.STAGE_H}" width="${CONFIG.STAGE_W * 3}"
          height="${CONFIG.STAGE_H + fim}" fill="url(#${id}-fim)"/>
  </mask>
  <g mask="url(#${id}-mascara)">`;
}

// O corpo da artista é um desenho só, do topo ao pé: para sobrar a cabeça ele
// é recortado numa oval que pega as orelhas e para no queixo, antes do pescoço.
// (Feita já no palco: dentro de <clipPath> não vale <g>, então não dá para
// usar o naRegiao.)
function cortadoNaCabeca(id, soCabeca, svg) {
  if (!soCabeca || !svg) return svg;
  // Duas ovais no molde, em volta do centro da cabeça (300, 112): uma larga e
  // baixa que pega as orelhas, e uma rente ao rosto (a cabeça de código é
  // 56 × 70) que fecha no queixo sem deixar o pescoço aparecer embaixo dele.
  const oval = (rx, ry) => {
    const [x, y, w, h] = recorteNaRegiao('cabeca', [300 - rx, 112 - ry, rx * 2, ry * 2]);
    return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}"/>`;
  };
  const [, meio] = recorteNaRegiao('cabeca', [0, 112, 0, 0]);
  return `<clipPath id="${id}-cabeca">
    ${oval(80, 50)}${oval(54, 68)}
    <rect x="0" y="-${CONFIG.STAGE_H}" width="${CONFIG.STAGE_W}" height="${CONFIG.STAGE_H + meio}"/>
  </clipPath>
  <g clip-path="url(#${id}-cabeca)">${svg}</g>`;
}

// O traço do desenho é fino: na cor exata do contorno de código ele some.
// O do cabelo é bem mais escuro que ele, como a artista desenhou (`fator`).
function escurecerTraco(hex, fator = 0.72) {
  const n = parseInt(String(hex).slice(1), 16);
  const f = (c) => Math.round(c * fator);
  return '#' + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)]
    .map(v => v.toString(16).padStart(2, '0')).join('');
}

export const avatarDataURL = (opts) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgAvatar(opts));

// Imagem solta dentro de um SVG usado como <img> não carrega (as roupas
// desenhadas são arquivos). Para exportar, cada uma vira data URI antes.
const inlines = new Map();
const comoDataURI = (href) => {
  if (!inlines.has(href)) {
    inlines.set(href, fetch(href).then(r => r.blob()).then(b => new Promise((ok, erro) => {
      const f = new FileReader();
      f.onload = () => ok(f.result);
      f.onerror = erro;
      f.readAsDataURL(b);
    })));
  }
  return inlines.get(href);
};

export async function avatarDataURLPronto(opts) {
  let svg = svgAvatar(opts);
  for (const href of new Set(svg.match(/assets\/roupas\/[\w-]+\.webp/g) || [])) {
    svg = svg.replaceAll(`href="${href}"`, `href="${await comoDataURI(href)}"`);
  }
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
