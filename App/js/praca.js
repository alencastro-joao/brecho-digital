// Praça: uma rua sem fim com os avatares dos seus amigos, cada um com a roupa
// desenhada que está vestindo, e as casas que levam às telas principais.
//
// Por enquanto só o admin vê (botão no menu do perfil). A rua é um trecho de
// LARGURA px repetido três vezes; ao chegar perto de uma ponta o scroll pula
// um trecho inteiro e fica sempre no do meio, então ela "dá a volta".

import * as db from './db.js';
import { PRACA } from './config.js';
import { svgAvatar, aparenciaAtual, aparenciaDoPerfil } from './avatar.js';
import { roupasDoPerfil, perfilDe } from './pessoas.js';
import { segueDeVolta, abrirPerfilDe } from './usuario.js';
import { postsDoAutor } from './social.js';
import { irPara, viewAtual } from './router.js';
import { desenhoDaCasa, ARVORE, HIDRANTE, LIXEIRA, PASSARINHOS, BORBOLETA, BALAO, PIPA, GATO, CAVALETE, MESA } from './pracacasas.js';
import { el, $, sementeDoTexto } from './util.js';

const LARGURA = 3000;
// Corpo inteiro, sem o vazio dos lados do palco (600×1200).
const RECORTE = [130, 0, 340, 1160];
const UM_DIA = 24 * 3600e3;

// As cores são as dos botões da barra (base.css); o desenho está em pracacasas.js.
const CASAS = [
  { cor: '#c8e6c9', toldo: '#81c784', view: 'vitrine', x: 40, h: 260 },
  { cor: '#b2ebf2', toldo: '#4dd0e1', view: 'closet', x: 420, h: 240 },
  { cor: '#fff9c4', toldo: '#ffd54f', view: 'stylist', x: 800, h: 300 },
  { cor: '#f8bbd0', toldo: '#f48fb1', view: 'board', x: 1180, h: 250 },
  { cor: '#d1c4e9', toldo: '#9575cd', view: 'social', x: 1700, h: 270 },
  { cor: '#ffe0b2', toldo: '#ffb74d', view: 'tarefas', x: 2080, h: 240 },
  { cor: '#ffccbc', toldo: '#ff8a65', view: 'perfil', x: 2460, h: 280 },
];

const ENFEITES = `
  <div class="pc-nuvem" style="left:120px;top:40px;width:110px"></div>
  <div class="pc-nuvem" style="left:980px;top:70px;width:90px;animation-duration:80s"></div>
  <div class="pc-nuvem" style="left:1900px;top:36px;width:120px"></div>
  <div class="pc-arvore" style="left:300px">${ARVORE}</div><div class="pc-poste" style="left:700px"></div>
  <div class="pc-arvore" style="left:1050px">${ARVORE}</div><div class="pc-chafariz" style="left:1460px"></div>
  <div class="pc-poste" style="left:1990px"></div><div class="pc-arvore" style="left:2330px">${ARVORE}</div>
  <div class="pc-enfeite" style="left:740px">${HIDRANTE}</div><div class="pc-enfeite" style="left:1120px">${LIXEIRA}</div>
  <div class="pc-enfeite" style="left:2015px">${LIXEIRA}</div><div class="pc-enfeite" style="left:2395px">${HIDRANTE}</div>
  <div class="pc-ceu" style="left:300px;top:110px">${PASSARINHOS}</div><div class="pc-ceu" style="left:1700px;top:60px">${PASSARINHOS}</div>
  <div class="pc-ceu" style="left:1210px;top:20px">${BALAO}</div><div class="pc-ceu" style="left:2700px;top:16px">${PIPA}</div>
  <div class="pc-ceu" style="left:960px;bottom:30%">${BORBOLETA}</div><div class="pc-ceu" style="left:2290px;bottom:32%">${BORBOLETA}</div>
  <div class="pc-enfeite" style="left:2560px;bottom:28%">${GATO}</div>`;

// O cavalete e a mesa de café: às vezes tem um amigo usando, às vezes não.
// A pessoa fica um pouco atrás (y maior) para a coisa cobrir as pernas.
const OBJETOS = [
  { svg: CAVALETE, x: 640, y: 20, pessoa: [48, 2] },
  { svg: MESA, x: 2780, y: 18, pessoa: [44, 3] },
];
// A rua muda a cada meia hora: quem sai e volta depois disso acha as pessoas
// em outros lugares (pedido do João, 28/10/2026).
const TURNO = 30 * 60e3;
const turno = () => Math.floor(Date.now() / TURNO);

// Lugares na calçada, fora das portas. y é a distância do chão em %:
// menor fica mais à frente e maior.
const LUGARES = [
  [200, 18], [560, 8], [940, 24], [1280, 6], [1820, 16], [2150, 4], [2520, 20],
  [760, 28], [1100, 12], [2000, 26], [2380, 10], [2800, 22], [330, 30], [1640, 30],
];
const VOCE = { x: 1560, y: 10 };

const meusAmigos = () => db.state.usuario.seguindo
  .filter(segueDeVolta).map(perfilDe).filter(Boolean);

// Novidade do cartão: a última publicação, se for de hoje.
function novidadeDe(id) {
  const ultimo = postsDoAutor(id)
    .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm))[0];
  if (!ultimo || Date.now() - new Date(ultimo.criadoEm) > UM_DIA) return null;
  return ultimo.tipo === 'board' ? 'Colagem nova' : 'Look novo!';
}

// Nome de conta real vai para o HTML da rua: escapar.

const corpo = (aparencia, roupas) =>
  svgAvatar({ aparencia, roupas, recorte: RECORTE });

function pessoas() {
  const amigos = meusAmigos();
  const eu = {
    eu: true, nome: 'Você', ...VOCE,
    svg: corpo(aparenciaAtual(), db.roupasEquipadas()),
  };
  // Lugar sorteado pelo id e pelo turno: fica parado enquanto dura o turno.
  const livres = [...LUGARES];
  const usando = [];
  for (const [n, o] of OBJETOS.entries()) {
    // Sorteio do turno: em uns dois terços das vezes tem alguém ali.
    const s = sementeDoTexto(`praca:${turno()}:${n}`);
    if (!amigos.length || s % 3 === 0) continue;
    const p = amigos.splice(s % amigos.length, 1)[0];
    usando.push({
      p, x: o.x + o.pessoa[0], y: o.y + o.pessoa[1], nome: p.nome.split(' ')[0],
      novidade: novidadeDe(p.id), svg: corpo(aparenciaDoPerfil(p), roupasDoPerfil(p)),
    });
  }
  const soltos = amigos.slice(0, LUGARES.length).map(p => {
    const i = sementeDoTexto(`praca:${p.id}:${turno()}`) % livres.length;
    const [x, y] = livres.splice(i, 1)[0];
    return {
      p, x, y, nome: p.nome.split(' ')[0],
      novidade: novidadeDe(p.id),
      svg: corpo(aparenciaDoPerfil(p), roupasDoPerfil(p)),
    };
  });
  // Às vezes dois amigos param lado a lado e ficam conversando (sem texto:
  // pontinhos e um símbolo, um de cada vez). Em metade dos turnos, um par.
  const s = sementeDoTexto(`praca:conversa:${turno()}`);
  if (soltos.length >= 2 && s % 2 === 0) {
    const a = soltos[s % soltos.length];
    const b = soltos[(s + 1) % soltos.length];
    b.x = a.x + 130; b.y = a.y;
    a.conversa = 'fala'; b.conversa = 'responde';
    b.simbolo = SIMBOLOS[s % SIMBOLOS.length];
  }
  return [eu, ...usando, ...soltos];
}

// O que o amigo responde na conversa: só desenho, nada escrito.
const SIMBOLOS = ['♥', '★', '♪', '☕', '☺'];

function balaoDaConversa(g) {
  if (!g.conversa) return '';
  const miolo = g.conversa === 'fala' ? '<i></i><i></i><i></i>' : `<b>${g.simbolo}</b>`;
  return `<span class="pc-balao pc-conversa ${g.conversa}">${miolo}</span>`;
}

function trecho(k, gente) {
  const casas = CASAS.map((c, i) => `
    <button class="pc-casa" data-casa="${i}" style="left:${c.x}px;height:${c.h}px">
      ${desenhoDaCasa(c)}
    </button>`).join('');
  const objetos = OBJETOS.map(o =>
    `<div class="pc-objeto" style="left:${o.x}px;bottom:${o.y}%;z-index:${100 - o.y}">${o.svg}</div>`).join('');
  const pessoasHtml = gente.map((g, i) => `
    <button class="pc-pessoa${g.eu ? ' eu' : ''}${g.conversa === 'responde' ? ' virado' : ''}" data-pessoa="${i}"
      style="left:${g.x}px;bottom:${g.y}%;z-index:${100 - g.y};--h:${Math.round(250 - g.y * 3)}px">
      ${balaoDaConversa(g)}
      <span class="pc-corpo"><span class="pc-chao"></span>${g.svg}</span>
    </button>`).join('');
  return `<div class="pc-trecho" style="left:${k * LARGURA}px;width:${LARGURA}px">
    <div class="pc-calcada"></div>${ENFEITES}${casas}${objetos}${pessoasHtml}</div>`;
}

let gente = [];

// O cartão da pessoa: o avatar grande ao lado, quem é e o caminho para o perfil.
function abrirCartao(g) {
  const fundo = $('#pc-fundo');
  const botoes = g.eu
    ? [['Trocar de roupa', () => irPara('vestiario')], ['Meu perfil', () => irPara('perfil')]]
    : [['Ver perfil', () => abrirPerfilDe(g.p.id)]];
  const lado = el('span', { class: 'pc-lado' });
  lado.innerHTML = g.svg;
  $('#pc-cartao').replaceChildren(
    el('button', { class: 'pc-fechar', 'aria-label': 'Fechar', onclick: fecharCartao }, '✕'),
    lado,
    el('div', { class: 'pc-info' },
      el('h2', {}, g.eu ? 'Você' : g.p.nome),
      g.eu ? null : el('div', { class: 'pc-handle' }, g.p.handle || ''),
      g.p?.bio ? el('div', { class: 'pc-bio' }, g.p.bio) : null,
      g.novidade ? el('div', { class: 'pc-novidade' }, `${g.novidade} · hoje`) : null,
      el('div', { class: 'pc-botoes' }, ...botoes.map(([rotulo, fn], i) =>
        el('button', { class: 'pc-pilula' + (i ? '' : ' ativa'), onclick: () => { fecharCartao(); fn(); } }, rotulo)))));
  fundo.hidden = false;
}
const fecharCartao = () => { $('#pc-fundo').hidden = true; };

// O céu segue o relógio de quem joga: amanhecer, dia, fim de tarde e noite.
function horaDoDia(h = new Date().getHours()) {
  if (h >= 5 && h < 7) return 'amanhecer';
  if (h >= 7 && h < 17) return 'dia';
  if (h >= 17 && h < 19) return 'tarde';
  return 'noite';
}
function acertarCeu() {
  const mundo = $('#pc-mundo');
  for (const c of ['amanhecer', 'dia', 'tarde', 'noite']) mundo.classList.toggle('pc-' + c, horaDoDia() === c);
}

function pintar() {
  gente = pessoas();
  const mundo = $('#pc-mundo');
  acertarCeu();
  mundo.style.width = 3 * LARGURA + 'px';
  mundo.innerHTML = trecho(0, gente) + trecho(1, gente) + trecho(2, gente);


  const cena = $('#pc-cena');
  cena.scrollLeft = LARGURA + VOCE.x - cena.clientWidth / 2 + 60;
}

export function montarPraca() {
  setInterval(() => { if (viewAtual() === 'praca') acertarCeu(); }, 5 * 60e3);
  const cena = $('#pc-cena');
  cena.addEventListener('scroll', () => {
    if (cena.scrollLeft < LARGURA * 0.5) cena.scrollLeft += LARGURA;
    else if (cena.scrollLeft > LARGURA * 1.5) cena.scrollLeft -= LARGURA;
  });

  // Arrastar com o mouse (no toque o navegador já rola). Arrasto não vira clique.
  let ini = null, moveu = false;
  cena.addEventListener('mousedown', (e) => { ini = { x: e.clientX, s: cena.scrollLeft }; moveu = false; });
  addEventListener('mousemove', (e) => {
    if (!ini) return;
    const dx = e.clientX - ini.x;
    if (Math.abs(dx) > 4) moveu = true;
    cena.scrollLeft = ini.s - dx;
    if (cena.scrollLeft !== ini.s - dx) ini.s = cena.scrollLeft + dx;   // deu a volta
  });
  addEventListener('mouseup', () => { ini = null; });
  cena.addEventListener('click', (e) => {
    if (moveu) { e.stopPropagation(); moveu = false; return; }
    const casa = e.target.closest('[data-casa]');
    if (casa) return irPara(CASAS[casa.dataset.casa].view);
    const pessoa = e.target.closest('[data-pessoa]');
    if (pessoa) abrirCartao(gente[pessoa.dataset.pessoa]);
  }, true);

  $('#pc-fundo').addEventListener('click', (e) => { if (e.target.id === 'pc-fundo') fecharCartao(); });
}

export function aoEntrarNaPraca() {
  if (!PRACA) { irPara('perfil'); return; }
  fecharCartao();
  pintar();
}
