// Tarefas: o que o app pede de você — os pedidos do dia e da semana, os
// carimbos, as fichas e a trilha de níveis.
//
// A tela é uma lista limpa: nível e fichas numa fileira, as abas Hoje e
// Semana, um bloco por pedido (fica verde quando fecha) e a trilha dos
// carimbos até o baú. A explicação de cada coisa só aparece num toque. O
// formato das missões segue o Pokémon TCG Pocket (lista fixa, cumprir parte já
// paga); os prêmios dos marcos esperam um toque para sair.

import {
  MISSOES, MISSOES_SEMANA, MARCOS_DIA, MARCOS_SEMANA, PREMIO_SEMANA, BAU_ESPECIAL, FICHAS, premioDoBau, faixasDeTroca,
  RARIDADE, RARIDADES, escalaGrade,
} from './config.js';
import { catalogo, item as pecaDoCatalogo, nomeDaPeca } from './catalog.js';
import * as db from './db.js';
import * as estoque from './estoque.js';
import {
  el, $, toast, hojeISO, msAteMeiaNoite, msAteSegunda, formatarContagem, formatarDias,
} from './util.js';
import { ico } from './icones.js';
import { irPara, viewAtual } from './router.js';
import { todasAsColecoes, abrirColecao } from './colecoes.js';

export function montarTarefas() {
  // Missão fecha em qualquer tela: resgatar na vitrine, salvar um look,
  // publicar no feed. Toda gravação repinta esta aba — se ela estiver aberta —
  // e acende o pontinho do botão de Tarefas quando há prêmio esperando.
  db.onChange(() => {
    if (viewAtual() === 'tarefas') renderTarefas();
    else renderPontinho();
  });
  renderTarefas();
}

export function renderTarefas() {
  db.virarODiaSeNecessario();   // o dia e a semana podem ter virado com a aba aberta
  if (!aba) aba = premioNaSemana() && !premioNoDia() ? 'semana' : 'hoje';
  renderTopo();
  renderAbas();
  if (aba === 'hoje') renderDia(); else renderSemana();
  renderCartaoColecoes();
  renderPontinho();
}

// A aba aberta (Hoje ou Semana). Começa no Hoje, a não ser que só a semana
// tenha prêmio esperando.
let aba = null;
const premioNoDia = () => !!db.marcoDoDiaPronto() || db.bauDosDiasPronto();
const premioNaSemana = () =>
  db.carimboDaSemanaPronto() || db.fichasDaSemanaProntas() || db.bauEspecialPronto();

// O ícone de cada pedido, pelo evento que ele conta.
const ICONE = {
  entrar: 'abrir', resgates: 'sacola', raras: 'brilho', looks: 'varinha',
  publicar: 'camera', curtir: 'coracao',
};

// ------------------------------- Coleções ---------------------------------
// O botão que leva à tela de Coleções. Com item do avatar esperando escolha,
// ele vira o presente e abre direto a coleção.
function renderCartaoColecoes() {
  const botao = $('#tarefas-colecoes');
  const todas = todasAsColecoes();
  botao.hidden = !todas.length;
  if (!todas.length) return;
  const comEscolha = todas.find(c => c.livres > 0);
  const completas = todas.filter(c => c.completa).length;
  botao.classList.toggle('escolha', !!comEscolha);
  botao.title = comEscolha ? `${comEscolha.marca}: escolha um item do avatar` : '';
  botao.onclick = () => comEscolha ? abrirColecao(comEscolha.id) : irPara('colecoes');
  botao.replaceChildren(
    el('span', { class: 'tf-col-ico' }, ico(comEscolha ? 'presente' : 'trofeu')),
    el('strong', {}, 'Coleções'),
    el('small', {}, `${completas}/${todas.length}`),
    el('span', { class: 'tf-col-seta', 'aria-hidden': 'true' }, '›'));
}

function renderPontinho() {
  const tem = db.temPremioParaResgatar() || db.escolhasLivres() > 0;
  for (const botao of document.querySelectorAll('[data-goto="tarefas"]')) {
    botao.classList.toggle('tem-premio', tem);
  }
}

// ---------------------------------- Topo ----------------------------------
// Nível e fichas numa fileira. Tocar nas fichas troca por um resgate quando
// dá; quando não dá, diz quanto falta.
function renderTopo() {
  const p = db.progresso();
  const n = db.fichas();
  const troca = FICHAS.porResgate;
  const pode = db.podeTrocarFichas();
  const jaTrocou = (db.state.dia.extras ?? 0) >= FICHAS.extrasPorDia;

  $('#tarefas-faixa').replaceChildren(
    el('div', { class: 'tf-nivel', title: p.maximo ? 'Nível máximo' : `Faltam ${p.xpFaltando} XP para o nível ${p.nivel + 1}` },
      el('span', { class: 'tf-nv' }, 'NV', el('b', {}, String(p.nivel))),
      el('div', { class: 'tf-barra' }, el('span', { style: { width: p.pct + '%' } })),
      el('small', {}, p.maximo ? `${p.xpTotal} XP` : `${p.xpNoNivel}/${p.xpDoNivel}`)),
    el('button', {
      type: 'button', class: 'tf-fichas' + (pode ? ' pronto' : ''),
      title: `${troca} fichas = 1 resgate`,
      onclick: () => {
        if (pode) {
          if (db.trocarFichasPorResgate()) toast('+1 resgate. Ele fica guardado até você usar.', 'rare');
          return;
        }
        toast(jaTrocou ? 'Você já trocou fichas hoje. Amanhã dá de novo.'
          : `${troca} fichas = 1 resgate. Faltam ${troca - n}.`);
      },
    }, el('span', { class: 'ficha-moeda', 'aria-hidden': 'true' }),
      el('b', {}, pode ? 'Trocar' : `${Math.min(n, troca)}/${troca}`)));
}

// ---------------------------------- Abas -----------------------------------
function renderAbas() {
  const botao = (id, nome, feitas, total, premio, prazo) => el('button', {
    type: 'button', role: 'tab', class: (aba === id ? 'on' : '') + (premio ? ' tem-premio' : ''),
    'aria-selected': String(aba === id), title: prazo,
    onclick: () => { if (aba !== id) { aba = id; renderTarefas(); } },
  }, nome, el('small', {}, `${feitas}/${total}`));
  $('#tf-abas').replaceChildren(
    botao('hoje', 'Hoje', db.missoesFeitas(), MISSOES.length, premioNoDia(),
      `Zeram em ${formatarContagem(msAteMeiaNoite())}`),
    botao('semana', 'Semana', db.semanaisFeitas(), MISSOES_SEMANA.length, premioNaSemana(),
      `Zeram em ${formatarDias(msAteSegunda())}`));
}

// ------------------------------- Pedidos ----------------------------------
function pedido(m, atual) {
  const feito = Math.min(atual, m.meta);
  const ok = feito >= m.meta;
  return el('div', { class: 'tf-item' + (ok ? ' ok' : '') },
    el('span', { class: 'tf-ico' }, ico(ok ? 'ok' : (ICONE[m.evento] || 'estrela'))),
    el('div', { class: 'tf-info' },
      el('strong', {}, m.nome),
      ok ? null : el('div', { class: 'tf-barra' },
        el('span', { style: { width: (feito / m.meta * 100) + '%' } }))),
    el('small', {}, ok ? '' : `${feito}/${m.meta}`));
}

function botaoPremio(texto, acao) {
  return el('button', { type: 'button', class: 'btn-premio', onclick: acao }, texto);
}

// ---------------------------------- Dia -----------------------------------
const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

function renderDia() {
  $('#tf-lista').replaceChildren(...MISSOES.map(m => pedido(m, db.progressoMissao(m.id))));

  const pronto = db.marcoDoDiaPronto();
  $('#tf-rodape').replaceChildren(...(pronto === 'carimbo'
    ? [botaoPremio('Carimbar o dia', resgatarDia)]
    : pronto === 'ficha' ? [botaoPremio(`Pegar ${MARCOS_DIA.ficha.fichas} ficha`, resgatarDia)] : []));

  // A trilha: os 7 dias da semana e o Baú dos dias na ponta.
  const carimbados = db.carimbosDaSemana();
  const [a, m, d] = db.state.semana.data.split('-').map(Number);
  const hoje = hojeISO();
  const selos = DIAS.map((nome, i) => {
    const iso = hojeISO(new Date(a, m - 1, d + i));
    const on = carimbados.includes(iso);
    return el('span', {
      class: 'tf-selo' + (on ? ' on' : '') + (iso === hoje ? ' hoje' : ''),
      title: on ? `${nome}: dia carimbado` : nome,
    }, on ? ico('ok') : nome[0].toUpperCase());
  });
  const premio = db.state.semana.premio;
  trilha(selos, {
    nome: 'Baú dos dias', bau: PREMIO_SEMANA, icone: 'presente',
    pronto: db.bauDosDiasPronto(), abrir: abrirBau,
    aberto: premio && { pecas: db.pecasDoBauDosDias(), xp: premio.xp ?? premioDoBau(PREMIO_SEMANA, 1).atual.xp },
  });
}

function resgatarDia() {
  const r = db.resgatarMarcoDoDia();
  if (!r) return;
  toast(r.marco === 'carimbo'
    ? `Dia carimbado! +${r.fichas} ${r.fichas === 1 ? 'ficha' : 'fichas'}.`
    : `+${r.fichas} ficha.`, r.marco === 'carimbo' ? 'rare' : undefined);
}

// -------------------------------- Semana ----------------------------------
function renderSemana() {
  $('#tf-lista').replaceChildren(
    ...MISSOES_SEMANA.map(m => pedido(m, db.progressoSemanal(m.id))));

  const { fichas } = MARCOS_SEMANA;
  let rodape = [];
  if (db.carimboDaSemanaPronto()) {
    rodape = [botaoPremio('Carimbar a semana', () => {
      const r = db.carimbarSemana();
      if (r) toast(`Semana carimbada!${r.fichas ? ` +${r.fichas} fichas.` : ''}`, 'rare');
    })];
  } else if (db.fichasDaSemanaProntas()) {
    rodape = [botaoPremio(`Pegar ${fichas.fichas} fichas`, () => {
      const n = db.resgatarFichasDaSemana();
      if (n) toast(`+${n} fichas da semana.`, 'rare');
    })];
  }
  $('#tf-rodape').replaceChildren(...rodape);

  // A trilha: as semanas carimbadas e o Baú semanal na ponta.
  const total = BAU_ESPECIAL.semanas;
  const n = Math.min(db.semanasFechadas(), total);
  const selos = Array.from({ length: total }, (_, i) =>
    el('span', { class: 'tf-selo' + (i < n ? ' on' : ''), title: `Semana ${i + 1}` },
      i < n ? ico('ok') : String(i + 1)));
  trilha(selos, {
    nome: 'Baú semanal', bau: BAU_ESPECIAL, icone: 'coroa', dourado: true,
    pronto: db.bauEspecialPronto(), abrir: abrirEspecial,
  });
}

// ---------------------------------- Baús -----------------------------------
// A trilha termina no baú. Fechado, um toque diz o que tem dentro; pronto, ele
// brilha e o toque abre; aberto, a peça que saiu aparece embaixo.
function trilha(selos, { nome, bau, icone, dourado, pronto, abrir, aberto }) {
  const { atual } = premioDoBau(bau, db.nivel());
  const dica = `${nome}: ${descreverPremio(atual)}.`;
  const botaoBau = el('button', {
    type: 'button', 'aria-label': nome,
    class: 'tf-bau' + (dourado ? ' ouro' : '') + (pronto ? ' pronto' : '') + (aberto ? ' aberto' : ''),
    title: aberto ? `${nome} aberto` : dica,
    onclick: () => pronto ? abrir() : toast(aberto ? `${nome} aberto. Semana que vem tem outro.` : dica),
  }, ico(aberto ? 'ok' : pronto ? 'presente' : icone));
  $('#tf-trilha').className = 'tf-trilha' + (selos.length < 5 ? ' curta' : '');
  $('#tf-trilha').replaceChildren(...selos, botaoBau);

  const box = $('#tf-bau-aberto');
  const pecas = aberto ? aberto.pecas.map(p => pecaDoCatalogo(p.id)).filter(Boolean) : [];
  box.hidden = !pecas.length;
  box.replaceChildren(...(pecas.length ? [
    el('div', { class: 'bau-pecas' }, ...pecas.slice(0, 3).map(miniPeca)),
    el('small', {}, `+${aberto.xp} XP`),
    el('button', { type: 'button', class: 'btn-ghost', onclick: () => irPara('closet') }, 'Ver'),
  ] : []));
}

// "2 peças (rara e incomum) + 250 XP"
function descreverPremio({ pecas, xp }) {
  const nomes = pecas.map(f => RARIDADE[f]?.nome.toLowerCase());
  const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}` : nomes[0];
  return `${pecas.length === 1 ? '1 peça' : `${pecas.length} peças`} (${lista}) + ${xp} XP`;
}

function miniPeca(peca) {
  return el('div', { class: 'bau-peca', style: { '--esc': String(escalaGrade(peca)) } },
    el('div', { class: 'peca-caixa' }, el('img', { src: peca.src, alt: nomeDaPeca(peca) })));
}

// As peças de um baú: uma por faixa do degrau do seu nível. Cada uma é uma
// peça que você ainda não tem e que não esgotou; sem nenhuma na faixa, tenta a
// de baixo (e só sobe se não houver nada abaixo). Nunca repete no mesmo baú.
function sortearPremio(bau) {
  const { atual } = premioDoBau(bau, db.nivel());
  const escolhidas = new Set();
  const sorteadas = [];
  for (const pedida of atual.pecas) {
    for (const faixa of faixasDeTroca(pedida)) {
      const lista = catalogo.itens.filter(it => !escolhidas.has(it.id) &&
        !db.temPeca(it.id) && db.raridadeDoDia(it.id) === faixa && !estoque.esgotada(it.id, faixa));
      if (!lista.length) continue;
      const item = lista[Math.floor(Math.random() * lista.length)];
      escolhidas.add(item.id);
      sorteadas.push({ item, raridade: faixa });
      break;
    }
  }
  return sorteadas;
}

function abrirUmBau(nome, bau, abrir) {
  const r = abrir(sortearPremio(bau));
  if (!r) return;
  if (r.pecas.length) {
    estoque.levar(r.pecas.map(p => ({ id: p.id, raridade: p.raridade })))
      .then(() => { estoque.numerar(r.pecas.map(p => db.pecaDoInventario(p.id)).filter(Boolean)); db.salvar(); });
  }
  const nomes = r.pecas.map(p => `${nomeDaPeca(pecaDoCatalogo(p.id))} (${RARIDADE[p.raridade]?.nome})`);
  const melhor = r.pecas.map(p => p.raridade)
    .sort((a, b) => ordemDaFaixa(b) - ordemDaFaixa(a))[0];
  toast(nomes.length
    ? `${nome}: ${nomes.join(', ')} no seu guarda-roupa. +${r.xp} XP.`
    : `${nome} aberto: +${r.xp} XP.`, melhor);
}

const ordemDaFaixa = (f) => RARIDADES.findIndex(r => r.id === f);
const abrirBau = () => abrirUmBau('Baú dos dias', PREMIO_SEMANA, db.abrirPremioDaSemana);
const abrirEspecial = () => abrirUmBau('Baú semanal', BAU_ESPECIAL, db.abrirBauEspecial);

export const aoEntrarNasTarefas = renderTarefas;
