// Editar personagem: tom de pele, corte e cor do cabelo, nariz.
//
// O avatar é um SVG desenhado em código (js/avatar.js), então mudar a aparência
// é mudar quatro valores no perfil. A prévia aqui é o mesmo desenho que o
// Stylist, a prancheta e as imagens exportadas usam — não existe uma versão
// "de preview". O rosto tem só o nariz: sem olhos nem boca, a cabeça fica sendo
// silhueta, e uma pele verde ou um focinho não viram uma careta.

import {
  CORPOS, ORDEM_CORPOS, PELES, CABELOS, ORDEM_CABELOS, NARIZES, ORDEM_NARIZES,
  CORES_CABELO, APARENCIA_PADRAO,
} from './config.js';
import * as db from './db.js';
import { svgAvatar } from './avatar.js';
import { el, $, toast } from './util.js';
import { irPara } from './router.js';

// Trabalha numa cópia: só vai para o perfil quando você salva.
let rascunho = null;

const aparenciaDoRascunho = () => {
  const pele = PELES.find(p => p.id === rascunho.pele) || PELES[1];
  return {
    corpo: rascunho.corpo,
    pele: pele.cor,
    traco: pele.traco,
    cabelo: rascunho.cabelo,
    corCabelo: rascunho.corCabelo,
    nariz: rascunho.nariz,
  };
};

// Enquadramentos das miniaturas, no sistema do palco (600×1200): o corte
// precisa da cabeça com folga para os cabelos longos; o nariz, da cara.
const CROP_CORPO = [148, 18, 304, 716];
const CROP_CABELO = [190, 2, 220, 236];
const CROP_NARIZ = [234, 34, 132, 162];

function renderPrevia() {
  $('#pg-previa').innerHTML = svgAvatar({ aparencia: aparenciaDoRascunho() });
  $('#pg-resumo').textContent =
    `${CORPOS[rascunho.corpo]?.nome ?? '—'} · ` +
    `${PELES.find(p => p.id === rascunho.pele)?.nome ?? '—'} · ` +
    `${CABELOS[rascunho.cabelo]?.nome ?? '—'} · ` +
    `nariz ${(NARIZES[rascunho.nariz]?.nome ?? '—').toLowerCase()}`;
}

// Humana e fantasia na mesma grade: quem edita está escolhendo uma cor, não
// uma espécie. O grupo continua existindo em config.js só para o sorteio dos
// perfis do feed.
function renderPeles() {
  const caixa = $('#pg-peles');
  caixa.innerHTML = '';
  for (const p of PELES) {
    caixa.append(el('button', {
      class: 'pg-swatch' + (p.id === rascunho.pele ? ' ativa' : ''),
      title: p.nome,
      style: { background: p.cor, borderColor: p.traco },
      onclick: () => { rascunho.pele = p.id; renderTudo(); },
    }));
  }
}

// Miniaturas: o próprio avatar recortado, com o resto da aparência do rascunho.
// Escolher por desenho é mais rápido do que por nome — e o nome fica embaixo
// para quem quiser conferir.
function renderMiniaturas(seletor, ordem, catalogo, campo, recorte) {
  const caixa = $(seletor);
  caixa.innerHTML = '';
  for (const id of ordem) {
    const arte = el('span', { class: 'pg-corte-arte' });
    arte.innerHTML = svgAvatar({
      aparencia: { ...aparenciaDoRascunho(), [campo]: id },
      recorte,
    });
    caixa.append(el('button', {
      class: 'pg-corte' + (id === rascunho[campo] ? ' ativa' : ''),
      title: catalogo[id].nome,
      onclick: () => { rascunho[campo] = id; renderTudo(); },
    }, arte, el('small', {}, catalogo[id].nome)));
  }
}

function renderCores() {
  const caixa = $('#pg-cores');
  caixa.innerHTML = '';
  for (const cor of CORES_CABELO) {
    caixa.append(el('button', {
      class: 'pg-swatch redonda' + (cor === rascunho.corCabelo ? ' ativa' : ''),
      style: { background: cor },
      onclick: () => { rascunho.corCabelo = cor; renderTudo(); },
    }));
  }
}

function renderTudo() {
  renderPrevia();
  renderMiniaturas('#pg-corpos', ORDEM_CORPOS, CORPOS, 'corpo', CROP_CORPO);
  renderPeles();
  renderCores();
  renderMiniaturas('#pg-cortes', ORDEM_CABELOS, CABELOS, 'cabelo', CROP_CABELO);
  renderMiniaturas('#pg-narizes', ORDEM_NARIZES, NARIZES, 'nariz', CROP_NARIZ);
}

function salvar() {
  db.state.usuario.avatar = { ...rascunho };
  db.salvar();
  toast('Personagem salvo.');
  irPara('perfil');
}

export function aoEntrarNoPersonagem() {
  rascunho = { ...APARENCIA_PADRAO, ...db.state.usuario.avatar };
  renderTudo();
}

export function montarPersonagem() {
  $('#pg-salvar').addEventListener('click', salvar);
  $('#pg-voltar').addEventListener('click', () => irPara('perfil'));
  $('#pg-padrao').addEventListener('click', () => {
    rascunho = { ...APARENCIA_PADRAO };
    renderTudo();
  });
}
