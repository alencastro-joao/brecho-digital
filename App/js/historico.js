// O histórico de uma peça: de onde ela veio e por quem já passou.
//
// Cada cópia numerada (a nº 12 das 25 lendárias) é uma coisa só no jogo, e o
// servidor guarda a lista dos donos dela (ver nuvem/lambda/estoque.py). Hoje
// a lista tem um nome só, o de quem levou; quando existir troca e doação, quem
// recebe entra no fim, e esta janela já mostra a fila inteira.
//
// A janela abre na hora com o que o save sabe (você, a origem e a data) e
// troca pela lista do servidor quando ela chega. Peça sem número ou sem
// servidor fica só com o que o save sabe.

import { RARIDADE } from './config.js';
import { item as pecaDoCatalogo, nomeDaPeca } from './catalog.js';
import * as estoque from './estoque.js';
import * as db from './db.js';
import { el, $ } from './util.js';
import { ico } from './icones.js';

// Como a peça chegou a cada dono. "Trocou" e "ganhou de" chegam com a troca.
const COMO = {
  vitrine:        ['sacola',   'Garimpou na loja do dia'],
  presente:       ['presente', 'Ganhou no presente de boas-vindas'],
  missao:         ['trofeu',   'Ganhou numa missão'],
  semana:         ['presente', 'Abriu no baú dos dias'],
  'bau-especial': ['presente', 'Abriu no baú semanal'],
  nivel:          ['coroa',    'Ganhou na trilha de níveis'],
  collab:         ['brilho',   'Veio da cápsula do mês'],
  propria:        ['camera',   'Subiu a peça'],
  teste:          ['varinha',  'Peça de teste'],
};

let aberta = null;      // a peça na janela, para a resposta atrasada não pintar outra

const data = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
};

export function montarHistorico() {
  const modal = $('#modal-historico');
  $('#hp-fechar').addEventListener('click', fecharHistorico);
  modal.addEventListener('click', (e) => { if (e.target === modal) fecharHistorico(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) fecharHistorico(); });
}

export function abrirHistorico(peca) {
  if (!peca) return;
  aberta = peca;
  const r = RARIDADE[peca.raridade];
  $('#hp-titulo').textContent = peca.numero && r ? `nº ${peca.numero} de ${r.tiragem}` : 'Histórico';
  $('#hp-nome').textContent = nomeDaPeca(pecaDoCatalogo(peca.id));
  pintar(peca, doSave(peca));
  $('#modal-historico').hidden = false;
  document.body.classList.add('com-modal');

  estoque.historico(peca).then((donos) => {
    if (donos && aberta === peca && !$('#modal-historico').hidden) pintar(peca, donos);
  });
}

function fecharHistorico() {
  aberta = null;
  $('#modal-historico').hidden = true;
  if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('com-modal');
}

// Sem servidor, o único dono que se conhece é você.
const doSave = (peca) => [{
  handle: db.state.usuario.handle, como: peca.origem || 'vitrine', em: peca.obtidoEm, voce: true,
}];

function pintar(peca, donos) {
  const cat = pecaDoCatalogo(peca.id);
  const linhas = [];

  // De onde ela veio: a entrada no acervo do brechó. Peça sua e da cápsula
  // não passam pela curadoria, e quem subiu já aparece como primeiro dono.
  if (!['propria', 'collab', 'teste'].includes(peca.origem)) {
    linhas.push(linha('origem', ico(cat?.pin ? 'alfinete' : 'cabide'),
      'Chegou ao brechó',
      [cat?.pin ? 'Garimpada no Pinterest' : 'Curadoria do brechó', data(cat?.criadoEm)]));
  }

  donos.forEach((d, i) => {
    const [icone, texto] = COMO[d.como] || COMO.vitrine;
    const atual = i === donos.length - 1;
    linhas.push(linha(atual ? 'dono atual' : 'dono', ico(icone),
      el('span', {}, d.handle, d.voce ? el('em', { class: 'hp-voce' }, 'você') : null),
      [texto, data(d.em)]));
  });

  $('#hp-lista').replaceChildren(...linhas);
}

function linha(classe, icone, titulo, detalhes) {
  return el('div', { class: 'hp-linha ' + classe },
    el('span', { class: 'hp-ico' }, icone),
    el('div', { class: 'hp-texto' },
      el('strong', {}, titulo),
      el('small', {}, detalhes.filter(Boolean).join(' · '))));
}
