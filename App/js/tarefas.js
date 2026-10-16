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
  RARIDADE, escalaGrade, BAUS, CHANCE_NO_BAU, PREMIOS_DE_NIVEL,
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
import { abrirFichaDePeca } from './usuario.js';

export function montarTarefas() {
  // Missão fecha em qualquer tela: resgatar na vitrine, salvar um look,
  // publicar no feed. Toda gravação repinta esta aba — se ela estiver aberta —
  // e acende o pontinho do botão de Tarefas quando há prêmio esperando.
  db.onChange(() => {
    if (viewAtual() === 'tarefas') renderTarefas();
    else renderPontinho();
  });
  $('#bau-ok').addEventListener('click', fecharBau);
  const modal = $('#modal-trilha');
  $('#tn-fechar').addEventListener('click', fecharTrilha);
  $('#tn-todos').addEventListener('click', pegarTodos);
  modal.addEventListener('click', (e) => { if (e.target === modal) fecharTrilha(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) fecharTrilha(); });
  renderTarefas();
}

// Uma vez por save: a trilha volta a zero e as peças dela voltam para a loja.
function zerarTrilha() {
  const tiradas = db.zerarTrilhaDeNiveis();
  if (tiradas.length) estoque.devolver(tiradas);
}

export function renderTarefas() {
  zerarTrilha();
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
  botao.classList.toggle('ponto-novo', !!comEscolha);
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
    el('button', {
      type: 'button', class: 'tf-nivel' + (db.premiosDoNivelProntos().length ? ' tem-premio' : ''),
      title: 'Prêmios dos níveis', onclick: abrirTrilha,
    },
      el('span', { class: 'tf-nv' }, 'NV', el('b', {}, String(p.nivel))),
      el('div', { class: 'tf-barra' }, el('span', { style: { width: p.pct + '%' } })),
      el('small', {}, p.maximo ? `${p.xpTotal} XP` : `${p.xpNoNivel}/${p.xpDoNivel}`)),
    ...(db.fichasDeRepor() ? [el('button', {
      type: 'button', class: 'tf-repor', title: 'Fichas de repor a loja', onclick: () => irPara('vitrine'),
    }, ico('atualizar'), el('b', {}, String(db.fichasDeRepor())))] : []),
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
  const dica = `${nome} · ${descreverPremio(atual)}.`;
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

// "Baú raro: 3 a 5 peças + 300 XP"
function descreverPremio({ bau, xp }) {
  const b = BAUS[bau];
  return `${b.nome}: ${b.min} a ${b.max} peças + ${xp} XP`;
}

function miniPeca(peca) {
  return el('div', { class: 'bau-peca', style: { '--esc': String(escalaGrade(peca)) } },
    el('div', { class: 'peca-caixa' }, el('img', { src: peca.src, alt: nomeDaPeca(peca) })));
}

// As peças de um baú: a quantidade sai da faixa do baú (BAUS) e a raridade de
// cada uma de CHANCE_NO_BAU. Cada peça é uma que você ainda não tem e que não
// esgotou; sem nenhuma na raridade sorteada, tenta a de baixo (e só sobe se
// não houver nada abaixo). Nunca repete no mesmo baú.
function sortearRaridadeDoBau() {
  const opcoes = Object.entries(CHANCE_NO_BAU);
  let x = Math.random() * opcoes.reduce((t, [, pct]) => t + pct, 0);
  for (const [id, pct] of opcoes) {
    if (x < pct) return id;
    x -= pct;
  }
  return opcoes[0][0];
}

export function sortearPecas(bauId) {
  const { min, max } = BAUS[bauId];
  const qtd = min + Math.floor(Math.random() * (max - min + 1));
  const escolhidas = new Set();
  const sorteadas = [];
  for (let i = 0; i < qtd; i++) {
    const pedida = sortearRaridadeDoBau();
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
  const tipo = premioDoBau(bau, db.nivel()).atual.bau;
  const r = abrir(sortearPecas(tipo));
  if (!r) return;
  entregarPecas(r.pecas);
  mostrarBau(nome, r.pecas, { xp: r.xp, bau: tipo });
}

// As peças que saíram de um baú: tiram do estoque da loja e ganham número.
function entregarPecas(pecas) {
  if (!pecas.length) return;
  const doGuardaRoupa = pecas.map(p => db.pecaDoInventario(p.id)).filter(Boolean);
  estoque.levar(doGuardaRoupa)
    .then(() => { estoque.numerar(doGuardaRoupa); db.salvar(); });
}

const abrirBau = () => abrirUmBau('Baú dos dias', PREMIO_SEMANA, db.abrirPremioDaSemana);
const abrirEspecial = () => abrirUmBau('Baú semanal', BAU_ESPECIAL, db.abrirBauEspecial);

// ---------------------------- Trilha de níveis ------------------------------
// Tocar no nível abre a trilha: um prêmio por nível, do 2 ao último. Os que
// já chegaram esperam o toque; os de cima ficam com o cadeado.
function rotuloDoPremio(p) {
  if (p.tipo === 'fichas') return `${p.qtd} fichas`;
  if (p.tipo === 'repor') return p.qtd > 1 ? `Repor a loja ×${p.qtd}` : 'Repor a loja';
  return BAUS[p.bau].nome;
}

function iconeDoPremio(p) {
  if (p.tipo === 'fichas') return el('span', { class: 'ficha-moeda', 'aria-hidden': 'true' });
  if (p.tipo === 'repor') return ico('atualizar');
  return ico('presente');
}

function abrirTrilha() {
  renderTrilha();
  $('#modal-trilha').hidden = false;
  document.body.classList.add('com-modal');
  // Rola até o primeiro prêmio esperando, ou até o próximo nível.
  const alvo = $('#tn-lista .pronto') || $('#tn-lista .proximo');
  alvo?.scrollIntoView({ block: 'center' });
}

function fecharTrilha() {
  $('#modal-trilha').hidden = true;
  if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('com-modal');
}

function renderTrilha() {
  const nivel = db.nivel();
  const prontos = db.premiosDoNivelProntos();
  $('#tn-titulo').textContent = `Nível ${nivel}`;
  $('#tn-lista').replaceChildren(...PREMIOS_DE_NIVEL.map(p => {
    const pego = db.premioDoNivelPego(p.nivel);
    const pronto = db.premioDoNivelPronto(p.nivel);
    const estado = pego ? 'pego' : pronto ? 'pronto' : p.nivel === nivel + 1 ? 'travado proximo' : 'travado';
    return el('div', { class: `tn-nivel ${estado} ${p.tipo}` + (p.bau ? ' bau-' + p.bau : '') },
      el('span', { class: 'tn-num' }, String(p.nivel)),
      el('span', { class: 'tn-ico' }, iconeDoPremio(p)),
      el('strong', {}, rotuloDoPremio(p)),
      pronto ? el('button', { type: 'button', class: 'btn-premio', onclick: () => pegarPremio(p.nivel) }, 'Pegar')
        : el('span', { class: 'tn-fim' }, ico(pego ? 'ok' : 'cadeado')));
  }));
  const todos = $('#tn-todos');
  todos.hidden = prontos.length < 2;
  todos.textContent = `Pegar todos (${prontos.length})`;
}

// Pega um prêmio (ou vários, com `quieto` para juntar num toast só) e devolve
// o que saiu.
function pegarPremio(n, { quieto = false } = {}) {
  const p = PREMIOS_DE_NIVEL.find(x => x.nivel === n);
  const r = db.pegarPremioDoNivel(n, p?.tipo === 'bau' ? sortearPecas(p.bau) : []);
  if (!r) return null;
  entregarPecas(r.pecas);
  if (!quieto && r.tipo === 'bau') mostrarBau(BAUS[r.bau].nome, r.pecas, { bau: r.bau });
  else if (!quieto) {
    toast(r.tipo === 'repor' ? `+${r.qtd} ${r.qtd === 1 ? 'ficha' : 'fichas'} de repor a loja. Use na Loja.`
      : `+${r.qtd} fichas.`, 'rare');
  }
  renderTrilha();
  return r;
}

function pegarTodos() {
  const saiu = db.premiosDoNivelProntos().map(p => pegarPremio(p.nivel, { quieto: true })).filter(Boolean);
  if (!saiu.length) return;
  const fichas = saiu.filter(r => r.tipo === 'fichas').reduce((t, r) => t + r.qtd, 0);
  const repor = saiu.filter(r => r.tipo === 'repor').reduce((t, r) => t + r.qtd, 0);
  const pecas = saiu.flatMap(r => r.pecas);
  const partes = [
    fichas && `${fichas} fichas`,
    repor && `${repor} ${repor === 1 ? 'ficha' : 'fichas'} de repor a loja`,
    pecas.length && `${pecas.length} ${pecas.length === 1 ? 'peça' : 'peças'}`,
  ].filter(Boolean);
  if (pecas.length) {
    mostrarBau('Prêmios dos níveis', pecas, {
      extra: partes.filter(t => !t.endsWith('peça') && !t.endsWith('peças')).map(t => '+' + t).join(' · '),
    });
  } else toast(`+${partes.join(', ')}`, 'rare');
}

// ------------------------------ Baú abrindo --------------------------------
// O baú treme, abre e as peças pulam uma a uma, com o brilho da raridade.
// Tocar numa peça fecha o baú e abre a ficha dela.
function mostrarBau(nome, pecas, { xp = 0, bau = null, extra = '' } = {}) {
  const lista = pecas.map(p => ({ ...p, peca: pecaDoCatalogo(p.id) })).filter(p => p.peca);
  const modal = $('#modal-bau');
  const caixa = $('#bau-caixa');
  caixa.className = 'bau-caixa' + (bau ? ' bau-' + bau : '');
  caixa.replaceChildren(ico('presente'));
  $('#bau-nome').textContent = nome;
  $('#bau-extra').textContent = [xp ? `+${xp} XP` : '', extra].filter(Boolean).join(' · ');
  const passo = Math.min(0.2, 1.8 / Math.max(1, lista.length));
  $('#bau-saiu').className = 'bau-saiu' + (lista.length > 6 ? ' muitas' : '');
  // As mais raras primeiro: é o que a pessoa quer ver.
  lista.sort((a, b) => ordem(b.raridade) - ordem(a.raridade));
  $('#bau-saiu').replaceChildren(...(lista.length ? lista.map(({ peca, raridade }, i) => {
    const r = RARIDADE[raridade];
    const cor = r?.aura && r.aura !== 'arco-iris' ? r.aura : '#8a96a0';
    return el('button', {
      type: 'button', class: 'bau-item', title: nomeDaPeca(peca),
      style: { '--atraso': `${0.8 + i * passo}s`, '--aura': cor },
      onclick: () => { fecharBau(); abrirFichaDePeca(lista.map(x => x.peca), i, { minha: true }); },
    },
      el('div', { class: 'bau-item-img' },
        el('div', { class: 'peca-caixa', style: { '--esc': String(escalaGrade(peca)) } },
          el('img', { src: peca.src, alt: nomeDaPeca(peca) }))),
      el('small', {}, r?.nome ?? ''));
  }) : [el('p', { class: 'bau-vazio' }, 'Vazio desta vez.')]));
  modal.classList.remove('abrindo');
  modal.hidden = false;
  document.body.classList.add('com-modal');
  void modal.offsetWidth;            // reinicia a animação se abrir dois seguidos
  modal.classList.add('abrindo');
}

const ordem = (f) => Object.keys(CHANCE_NO_BAU).indexOf(f);

function fecharBau() {
  $('#modal-bau').hidden = true;
  if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('com-modal');
}

export const aoEntrarNasTarefas = renderTarefas;
