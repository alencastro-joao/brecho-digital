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
  CORES_CABELO, NARIZES, SOBRANCELHAS, SOBRANCELHAS_NO_AR, BRINCOS,
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
    ...brincosDasOrelhas(cfg),
  };
}

// Brinco de cada orelha. O primeiro formato (21/10/2026, poucos minutos no
// ar) guardava quantos (`brincos`) e em que lado (`ladoBrincos`): quem salvou
// nele abre com o mesmo nas orelhas de agora.
export function brincosDasOrelhas(cfg = {}) {
  const ok = (id) => (BRINCOS[id] ? id : 'nenhum');
  if (cfg.brincoEsq || cfg.brincoDir || !cfg.brincos) {
    return { brincoEsq: ok(cfg.brincoEsq), brincoDir: ok(cfg.brincoDir) };
  }
  return {
    brincoEsq: cfg.ladoBrincos === 'direita' ? 'nenhum' : ok(cfg.brincos),
    brincoDir: cfg.ladoBrincos === 'esquerda' ? 'nenhum' : ok(cfg.brincos),
  };
}

// Brincos de bolinha na orelha da artista (o corpo de código não tem orelha).
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
function brincos(ap, id) {
  if (!corpoDesenhado) return '';
  const bolinhas = [[1, ap.brincoEsq], [-1, ap.brincoDir]].flatMap(([l, b]) => {
    const rnd = mulberry32(l === 1 ? 7 : 11);
    return BOLINHAS_BRINCO.slice(0, BRINCOS[b]?.qtd || 0).map(([x, y, r]) =>
      bolinhaTorta(l === 1 ? x : 600 - x, y, r, rnd));
  });
  if (!bolinhas.length) return '';
  return `<filter id="${id}-grao" x="-30%" y="-30%" width="160%" height="160%">
    <feTurbulence type="fractalNoise" baseFrequency="2.4" numOctaves="2" seed="4"/>
    <feDisplacementMap in="SourceGraphic" scale="1.3" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <g fill="#2b2522" opacity=".92" filter="url(#${id}-grao)">${bolinhas.join('')}</g>`;
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

// Retrato redondo: o mesmo avatar, recortado na cabeça. 150 unidades de altura
// (no molde) é o enquadramento que pega cabeça e ombros; ele acompanha a
// cabeça para onde a proporção a levou.
const [, RETRATO_Y, , RETRATO_H] = recorteNaRegiao('cabeca', [225, 43, 150, 150]);

// `quadro` abre o enquadramento: 1 é cabeça e ombros; mais que isso desce o
// centro e pega mais do corpo, como um busto, com uma folga acima da cabeça.
// `desce` é quanto do que abriu vai para baixo: menos que isso sobra mais
// espaço em cima, para o cabelo alto. `semRoupa` deixa só chapéu e óculos.
export function retrato(aparencia, tamanho = 34, cor = '#eee', roupas = null, quadro = 1, desce = 0.38, semRoupa = false) {
  const janela = RETRATO_H * quadro;
  const centro = RETRATO_Y + RETRATO_H / 2 + (janela - RETRATO_H) * desce;
  const k = tamanho / janela;
  const caixa = el('span', {
    class: 'retrato',
    style: { width: tamanho + 'px', height: tamanho + 'px', background: cor },
  });
  caixa.innerHTML = svgAvatar({ aparencia, roupas, roupaSoNaCabeca: semRoupa });
  Object.assign(caixa.querySelector('svg').style, {
    position: 'absolute',
    width: (CONFIG.STAGE_W * k) + 'px',
    height: 'auto',
    left: (tamanho / 2 - 300 * k) + 'px',
    top: (tamanho / 2 - centro * k) + 'px',
  });
  return caixa;
}

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
  centrarNaCaixa(svg);
  return caixa;
}

// Cada corte tem uma altura (espetado e afro sobem bem acima do raspado, um
// chapéu sobe mais ainda), e com o quadrado fixo a cabeça ficava ora alta, ora
// baixa na caixa. Quando ela já está na tela dá para medir: o quadrado desliza
// para o meio entre o topo do desenho e o queixo, no mesmo tamanho (a cabeça
// não muda de escala de um avatar para outro); só cresce se não couber.
function centrarNaCaixa(svg, tentativas = 20) {
  if (!svg.isConnected) {
    if (tentativas > 0) requestAnimationFrame(() => centrarNaCaixa(svg, tentativas - 1));
    return;
  }
  const desenho = svg.querySelector(':scope > g[mask]');
  if (!desenho) return;
  let topo;
  try { topo = desenho.getBBox().y; } catch { return; }
  const lado = Math.max(CABECINHA[3], QUEIXO - topo);
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
// `roupaSoNaCabeca` desenha o corpo inteiro, mas só com chapéu e óculos: é a
// foto do perfil, em que o corpo aparece sem roupa nenhuma.
export function svgAvatar({
  guia = false, fundo = 'none', aparencia = null, recorte = null, roupas = null,
  soCabeca = false, roupaSoNaCabeca = false,
} = {}) {
  const ap = aparencia || aparenciaAtual();
  const veste = partesDasRoupas(roupas, ap.corpo, soCabeca || roupaSoNaCabeca);
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
  const sobrancelhas = arteSobrancelha ? naRegiao('cabeca',
    `<g fill="${ap.corSobrancelha || escurecerTraco(ap.corCabelo, 0.8)}" stroke="none">
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
  ${sobrancelhas}

  <!-- brincos, também embaixo do cabelo da frente -->
  ${brincos(ap, idCorte)}

  <!-- cabelo por cima da cabeça -->
  ${cabelo('frente')}

  <!-- rosto por último: só o nariz, e o cabelo nunca o cobre. O traço é
       dividido pela escala da cabeça para não engrossar junto com ela. -->
  ${nariz ? naRegiao('cabeca', `<g fill="none" stroke="${ap.traco}"
       stroke-width="${(3.2 / escalaDe('cabeca')).toFixed(2)}"
       stroke-linecap="round" stroke-linejoin="round" opacity=".78">${nariz}</g>`) : ''}

  ${corpoDesenhado ? daArtista(idCorte + 'n', corpoDesenhado.narizes[ap.nariz], ap.pele,
    escurecerTraco(ap.traco)) : ''}

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
