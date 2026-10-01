// Avatar 2D de corpo inteiro — o manequim base sobre o qual as colagens acontecem.
//
// Também serve como guia técnico para os ilustradores convidados: o palco é
// 600×1200, o corpo ocupa 8 cabeças e os pontos de ancoragem por categoria estão
// em config.js (CATEGORIAS[*].anchor). Ligando o guia (ver Stylist) os pontos
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
  CONFIG, CATEGORIAS, CORPOS, ORDEM_CORPOS, PELES, CABELOS, ORDEM_CABELOS,
  CORES_CABELO, NARIZES, ORDEM_NARIZES,
} from './config.js';
import { partesDasRoupas } from './roupinhas.js';
import * as db from './db.js';
import { el, mulberry32, escolher, sementeDoTexto } from './util.js';

// Cabeça: elipse em (300, 112), raios 56 × 70 → topo em y=42, base em y=182.

// De ids (pele: 'clara') para cores prontas de desenhar.
export function resolverAparencia(cfg = {}) {
  const pele = PELES.find(p => p.id === cfg.pele) || PELES[1];
  return {
    pele: pele.cor,
    traco: pele.traco,
    corpo: CORPOS[cfg.corpo] ? cfg.corpo : 'masculino',
    cabelo: CABELOS[cfg.cabelo] ? cfg.cabelo : 'curto',
    corCabelo: cfg.corCabelo || '#3d2519',
    nariz: NARIZES[cfg.nariz] ? cfg.nariz : 'botao',
  };
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
    corpo: escolher(ORDEM_CORPOS, rnd),
    pele: escolher(PELES.filter(p => p.grupo === grupo), rnd).id,
    cabelo: escolher(ORDEM_CABELOS.filter(c => c !== 'nenhum'), rnd),
    corCabelo: escolher(CORES_CABELO, rnd),
    nariz: escolher(ORDEM_NARIZES.filter(n => n !== 'nenhum' && n !== 'focinho'), rnd),
  };
}

// A de um perfil: a explícita, quando existir; senão a sorteada pelo id.
export const aparenciaDoPerfil = (perfil) =>
  resolverAparencia(perfil?.aparencia || aparenciaSorteada(perfil?.id || '?'));

// Retrato redondo: o mesmo avatar, recortado na cabeça. 150 unidades de altura
// é o enquadramento que pega cabeça e ombros.
export function retrato(aparencia, tamanho = 34, cor = '#eee', roupas = null) {
  const k = tamanho / 150;
  const caixa = el('span', {
    class: 'retrato',
    style: { width: tamanho + 'px', height: tamanho + 'px', background: cor },
  });
  caixa.innerHTML = svgAvatar({ aparencia, roupas });
  Object.assign(caixa.querySelector('svg').style, {
    position: 'absolute',
    width: (CONFIG.STAGE_W * k) + 'px',
    height: 'auto',
    left: (tamanho / 2 - 300 * k) + 'px',
    top: (tamanho / 2 - 118 * k) + 'px',
  });
  return caixa;
}

// O boneco é um monte de peça sobreposta (braço, tronco, pescoço, cabeça). Dar
// contorno a cada uma mostraria as costuras por dentro da silhueta, então ele é
// desenhado duas vezes: primeiro engordado na cor do traço, depois na cor da
// pele por cima. Sobra só a linha de fora, que é a do corpo inteiro.
const CONTORNO = 6;   // largura da borda; metade sobra para fora da silhueta

const corpo = (id, cor, extra) => `
  <g fill="${cor}" stroke="${cor}" stroke-width="${extra}"
     stroke-linejoin="round" stroke-linecap="round">${(CORPOS[id] || CORPOS.masculino).arte(extra)}
  </g>`;

// O cabelo engorda o mesmo tanto que o corpo. A silhueta ganhou CONTORNO/2 de
// borda para fora, e corte desenhado rente à cabeça antiga (quase todos vão de
// x=244 a x=356, que era a largura exata dela) passou a deixar aparecer um
// filete de pele em volta. Engordar o desenho na própria cor resolve sem mexer
// corte por corte — volume de cabelo não tem medida exata a respeitar.
const VOLUME = CONTORNO + 2;   // dois a mais: sobra 1 de folga sobre a cabeça

const comVolume = (arte, cor) => (arte.trim()
  ? `<g stroke="${cor}" stroke-width="${VOLUME}"
        stroke-linejoin="round" stroke-linecap="round">${arte}</g>`
  : '');

// `recorte` é [x, y, w, h] no sistema do palco: o mesmo desenho, enquadrado em
// um pedaço dele. É como as miniaturas de corte e de nariz mostram só a cabeça
// sem existir um segundo desenho para manter em dia.
export function svgAvatar({
  guia = false, fundo = 'none', aparencia = null, recorte = null, roupas = null,
} = {}) {
  const ap = aparencia || aparenciaAtual();
  const veste = partesDasRoupas(roupas, ap.corpo);
  const corte = CABELOS[ap.cabelo] || CABELOS.curto;

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

  const cabelo = (parte) => cortado(
    comVolume((corte[parte] || '').replaceAll('{cor}', ap.corCabelo), ap.corCabelo));
  const nariz = (NARIZES[ap.nariz] || NARIZES.botao).arte.replaceAll('{traco}', ap.traco);
  const [vx, vy, vw, vh] = recorte || [0, 0, CONFIG.STAGE_W, CONFIG.STAGE_H];

  const pontos = guia ? Object.entries(CATEGORIAS).map(([cat, c]) => `
      <g class="guia">
        <circle cx="${c.anchor.x}" cy="${c.anchor.y}" r="6" fill="#ff2e63" opacity=".85"/>
        <line x1="${c.anchor.x - c.anchor.w / 2}" y1="${c.anchor.y}"
              x2="${c.anchor.x + c.anchor.w / 2}" y2="${c.anchor.y}"
              stroke="#ff2e63" stroke-width="2" stroke-dasharray="6 5" opacity=".55"/>
        <text x="${c.anchor.x + c.anchor.w / 2 + 10}" y="${c.anchor.y + 5}"
              font-family="monospace" font-size="19" fill="#ff2e63">${cat}</text>
      </g>`).join('') : '';

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}"
     width="${vw}" height="${vh}">
  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${fundo}"/>
  ${veste.corteDoCabelo == null ? '' : `<clipPath id="${idCorte}">
    <rect x="0" y="${veste.corteDoCabelo}" width="${CONFIG.STAGE_W}"
          height="${CONFIG.STAGE_H}"/>
  </clipPath>`}

  <!-- cabelo que fica atrás do corpo (chanel, longo) -->
  ${cabelo('atras')}

  <!-- roupinha que fica atrás do corpo: capa, mochila, asas, capuz caído -->
  ${veste.atras}

  ${corpo(ap.corpo, ap.traco, CONTORNO)}
  ${corpo(ap.corpo, ap.pele, 0)}

  <!-- roupinha vestida, por camada: calça, calçado, torso, alça, luva -->
  ${veste.frente}

  <!-- cabelo por cima da cabeça -->
  ${cabelo('frente')}

  <!-- rosto por último: só o nariz, e o cabelo nunca o cobre -->
  ${nariz ? `<g fill="none" stroke="${ap.traco}" stroke-width="3.2"
       stroke-linecap="round" stroke-linejoin="round" opacity=".78">${nariz}</g>` : ''}

  <!-- o que vem depois do rosto: óculos e chapéu, por cima do cabelo -->
  ${veste.rosto}
  ${pontos}
</svg>`.trim();
}

export const avatarDataURL = (opts) =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgAvatar(opts));
