// Baús: a tela onde ficam os baús ganhos, fechados, esperando o toque.
//
// Todo baú vem para cá: o Baú dos dias, o Baú semanal, os da trilha de níveis
// e os das missões do tutorial. Os do mesmo tipo ficam num cartão só, com a
// quantidade, do mais raro para o mais comum. Tocar abre um (as peças são
// sorteadas na hora, pela regra de BAUS e CHANCE_NO_BAU) com a mesma animação
// de Tarefas. Baú novo acende o pontinho vermelho no caminho (o botão de
// Tarefas, o botão Baús e o próprio baú) só até a pessoa chegar nesta tela.
//
// Baú ganho em qualquer lugar é "jogado": sai de onde foi ganho (o cartão de
// prêmio do tutorial, o botão tocado ou o meio da tela) e voa num arco até o
// botão de Tarefas, que dá um pulinho ao receber.

import { BAUS } from './config.js';
import * as db from './db.js';
import { el, $ } from './util.js';
import { ico } from './icones.js';
import { viewAtual, voltar } from './router.js';
import { sortearPecas, entregarPecas, mostrarBau } from './tarefas.js';

// Do mais raro para o mais comum: o que a pessoa mais quer abrir vem primeiro.
const TIPOS = Object.keys(BAUS).reverse();

export function montarBaus() {
  $('#bs-voltar').addEventListener('click', () => voltar('tarefas'));
  $('#bs-todos').addEventListener('click', abrirTodos);
  db.onChange(() => { if (viewAtual() === 'baus') renderBaus(); });
  // O último toque: é de onde sai o baú pego num botão.
  document.addEventListener('pointerdown', (e) => { ultimoToque = { x: e.clientX, y: e.clientY, em: Date.now() }; }, true);
  db.onBauGuardado(jogarBau);
}

// ------------------------------ Baú voando --------------------------------
let ultimoToque = null;
let naFila = 0;   // vários de uma vez (pegar todos) saem um atrás do outro

function jogarBau(tipo) {
  const ordem = naFila++;
  // Espera o cartão de prêmio aparecer (no tutorial) e deixa ver o baú nele.
  setTimeout(() => { naFila = Math.max(0, naFila - 1); voar(tipo); }, 900 + ordem * 260);
}

const visivel = (r) => r && r.width > 0 && r.bottom > 0 && r.top < innerHeight;

function voar(tipo) {
  // O destino: o botão de Tarefas que estiver à vista (barra de baixo ou lateral).
  const alvo = [...document.querySelectorAll('.sidebar-btn[data-goto="tarefas"]')]
    .find(b => visivel(b.getBoundingClientRect()));
  if (!alvo) return;
  const fim = alvo.getBoundingClientRect();

  // A origem: o baú do cartão de prêmio, o toque recente ou o meio da tela.
  const noCartao = document.querySelector('.premio .premio-bau');
  const deCartao = noCartao && visivel(noCartao.getBoundingClientRect()) && noCartao.getBoundingClientRect();
  const toque = ultimoToque && Date.now() - ultimoToque.em < 4000 ? ultimoToque : null;
  const de = deCartao
    ? { x: deCartao.left + deCartao.width / 2, y: deCartao.top + deCartao.height / 2, tam: deCartao.width }
    : toque ? { x: toque.x, y: toque.y, tam: 64 } : { x: innerWidth / 2, y: innerHeight / 2, tam: 80 };
  const para = { x: fim.left + fim.width / 2, y: fim.top + fim.height / 2 };

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { receber(alvo); return; }

  const tam = 64;
  const voando = el('div', { class: `bau-caixa bau-voando bau-${tipo}`, 'aria-hidden': 'true' }, ico('presente'));
  Object.assign(voando.style, { left: `${de.x - tam / 2}px`, top: `${de.y - tam / 2}px` });
  document.body.append(voando);
  if (deCartao) noCartao.style.visibility = 'hidden';

  // Um arco: sobe um pouco, gira e encolhe até caber no botão.
  const dx = para.x - de.x, dy = para.y - de.y;
  const alto = Math.min(160, 60 + Math.abs(dx) * 0.3);
  const ini = de.tam / tam;
  voando.animate([
    { transform: `translate(0, 0) scale(${ini}) rotate(0)` },
    { transform: `translate(${dx * 0.15}px, ${-alto * 0.8}px) scale(${ini * 1.08}) rotate(-12deg)`, offset: 0.25 },
    { transform: `translate(${dx * 0.55}px, ${dy * 0.35 - alto}px) scale(${(ini + 0.4) / 2}) rotate(160deg)`, offset: 0.6 },
    { transform: `translate(${dx}px, ${dy}px) scale(.35) rotate(340deg)`, opacity: 0.9 },
  ], { duration: 850, easing: 'cubic-bezier(.45, 0, .6, 1)', fill: 'forwards' }).finished
    .then(() => { voando.remove(); receber(alvo); });
}

// O botão de Tarefas dá um pulinho quando o baú chega.
function receber(alvo) {
  alvo.classList.remove('recebeu');
  void alvo.offsetWidth;
  alvo.classList.add('recebeu');
  setTimeout(() => alvo.classList.remove('recebeu'), 600);
}

// Os baús que chegaram desde a última visita: o pontinho fica neles enquanto
// a tela está aberta, e não volta mais.
let novosNaVisita = new Set();

export function renderBaus() {
  const baus = db.bausGuardados();
  $('#bs-resumo').textContent = baus.length ? `${baus.length} para abrir` : '';
  const tipos = TIPOS.filter(t => baus.some(b => b.tipo === t));
  $('#bs-grade').replaceChildren(...(tipos.length ? tipos.map(tipo => {
    const deste = baus.filter(b => b.tipo === tipo);
    const { nome, min, max } = BAUS[tipo];
    return el('button', {
      type: 'button', title: `Abrir ${nome.toLowerCase()}`,
      class: `bs-bau bau-${tipo}` + (deste.some(b => novosNaVisita.has(`bau:${b.id}`)) ? ' ponto-novo' : ''),
      onclick: () => abrir(deste[0]),
    },
      el('div', { class: `bau-caixa bau-${tipo}` }, ico('presente')),
      ...(deste.length > 1 ? [el('span', { class: 'bs-qtd' }, `×${deste.length}`)] : []),
      el('strong', {}, nome),
      el('small', {}, `${min} a ${max} peças`));
  }) : [el('div', { class: 'bs-vazio' },
    el('div', { class: 'bau-caixa' }, ico('presente')),
    el('strong', {}, 'Nenhum baú para abrir'),
    el('small', {}, 'Eles chegam pelos níveis, pelos carimbos e pelas missões.'))]));
  const todos = $('#bs-todos');
  todos.hidden = baus.length < 2;
  todos.textContent = `Abrir todos (${baus.length})`;
}

function abrir(bau) {
  const r = db.abrirBauGuardado(bau.id, sortearPecas(bau.tipo));
  if (!r) return;
  entregarPecas(r.pecas);
  mostrarBau(BAUS[r.tipo].nome, r.pecas, { bau: r.tipo });
}

// Abre todos de uma vez: as peças saem juntas, num baú da cor do mais raro.
function abrirTodos() {
  const baus = [...db.bausGuardados()];
  if (!baus.length) return;
  const melhor = TIPOS.find(t => baus.some(b => b.tipo === t));
  const pecas = baus.flatMap(b => db.abrirBauGuardado(b.id, sortearPecas(b.tipo))?.pecas ?? []);
  entregarPecas(pecas);
  mostrarBau(`${baus.length} baús`, pecas, { bau: melhor });
}

export function aoEntrarNosBaus() {
  novosNaVisita = new Set(db.naoVistas(db.novidadesDosBaus()));
  renderBaus();
  if (novosNaVisita.size) setTimeout(() => db.marcarVistas([...novosNaVisita]));
}
