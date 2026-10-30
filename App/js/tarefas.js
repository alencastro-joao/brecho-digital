// Tarefas: o que o app pede de você — o mural de missões, os pedidos do dia e
// da semana, os carimbos, as fichas e a trilha de níveis.
//
// No topo, nível, fichas e os botões redondos de Baús e Coleções. Abas Mural,
// Diário e Semana: o Mural tem as missões em post-its (js/mural.js); Diário e
// Semana, um bloco por pedido (fica verde quando fecha) e a trilha dos
// carimbos até o baú. Embaixo, a prateleira dos baús guardados e a fita das
// coleções. A explicação de cada coisa só aparece num toque. Os
// baús ganhos vão fechados para a tela de Baús (js/baus.js). O
// formato das missões segue o Pokémon TCG Pocket (lista fixa, cumprir parte já
// paga); os prêmios dos marcos esperam um toque para sair.

import {
  MISSOES, MISSOES_SEMANA, MARCOS_DIA, MARCOS_SEMANA, PREMIO_SEMANA, BAU_ESPECIAL, FICHAS, premioDoBau, faixasDeTroca,
  RARIDADE, escalaGrade, BAUS, CHANCE_NO_BAU, PREMIOS_DE_NIVEL, MURAL, logoDaColecao,
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
import { animarBau, animando } from './movimento.js';
import { tocar } from './sons.js';
import * as mural from './mural.js';
import { JOGO } from './ajudas.js';

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
  // O mural anda sozinho (missão chega, vence, prazo diminui): repinta a cada minuto.
  setInterval(() => { if (viewAtual() === 'tarefas') renderTarefas(); else renderPontinho(); }, 60e3);
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
  if (mural.atualizar()) { db.salvar(); return; }   // gravar repinta
  if (!aba) aba = mural.prontas() ? 'mural' : premioNoDia() ? 'hoje' : premioNaSemana() ? 'semana' : 'mural';
  // Chegou: as fichas e a aba aberta já foram vistas (fora desta pintura,
  // porque marcar grava e repinta).
  const vistas = [...db.novidadesDoTopo(), ...(aba === 'hoje' ? db.novidadesDoDia() : aba === 'semana' ? db.novidadesDaSemana() : [])];
  if (db.naoVistas(vistas).length) setTimeout(() => db.marcarVistas(vistas));
  renderTopo();
  renderAbas();
  $('#tf-mural').hidden = aba !== 'mural';
  $('#tf-painel').hidden = aba === 'mural';
  if (aba === 'mural') renderMural(); else if (aba === 'hoje') renderDia(); else renderSemana();
  renderFitaColecoes();
  renderPrateleira();
  renderPontinho();
}

// A aba aberta (Mural, Diário ou Semana). Começa no Mural, a não ser que só o
// dia ou a semana tenham prêmio esperando.
let aba = null;
const premioNoDia = () => !!db.marcoDoDiaPronto() || db.bauDosDiasPronto();
const premioNaSemana = () =>
  db.carimboDaSemanaPronto() || db.bauEspecialPronto();

// O ícone de cada pedido, pelo evento que ele conta.
const ICONE = {
  entrar: 'abrir', resgates: 'sacola', raras: 'brilho', looks: 'varinha',
  publicar: 'camera', curtir: 'coracao', 'postar-colagem': 'quadro',
};

// ------------------------------- Coleções ---------------------------------
// A fita das coleções: um logo por coleção, coloridas as completas. Com item
// do avatar esperando escolha, o botão redondo do topo vira o presente.
function renderFitaColecoes() {
  const fita = $('#tarefas-colecoes');
  const todas = todasAsColecoes();
  fita.hidden = !todas.length;
  if (!todas.length) return;
  const completas = todas.filter(c => c.completa).length;
  const ordem = [...todas].sort((a, b) => (b.completa - a.completa) || (b.pct - a.pct));
  fita.replaceChildren(
    el('button', { type: 'button', class: 'tf-sec-topo', onclick: () => irPara('colecoes') },
      el('b', {}, ico('trofeu'), 'Coleções'), el('small', {}, `${completas}/${todas.length} ›`)),
    el('div', { class: 'tf-logos' }, ...ordem.map(c => {
      const logo = logoDaColecao(c);
      return el('button', {
        type: 'button', class: 'tf-logo' + (c.completa ? ' ok' : ''), title: c.marca,
        style: c.hex ? { '--cor': c.hex } : {}, onclick: () => abrirColecao(c.id),
      }, logo ? el('img', { src: logo, alt: c.marca, loading: 'lazy' }) : el('span', {}, c.marca[0]));
    })));
}

// --------------------------------- Baús -----------------------------------
// A prateleira: os baús guardados, um por tipo (com quantos), e as vagas
// vazias. Tocar leva à tela de Baús, onde eles abrem.
const VAGAS_DA_PRATELEIRA = 4;
function renderPrateleira() {
  const baus = db.bausGuardados();
  const tipos = Object.keys(BAUS).reverse().filter(t => baus.some(b => b.tipo === t));
  const novos = db.naoVistas(db.novidadesDosBaus()).length > 0;
  const vagas = Array.from({ length: Math.max(0, VAGAS_DA_PRATELEIRA - tipos.length) },
    () => el('span', { class: 'tf-pbau vazio' }));
  $('#tarefas-baus').replaceChildren(
    el('button', { type: 'button', class: 'tf-sec-topo', onclick: () => irPara('baus') },
      el('b', {}, ico('presente'), 'Baús'), el('small', {}, baus.length ? 'toque para abrir' : 'nenhum guardado')),
    el('div', { class: 'tf-prateleira-baus' },
      ...tipos.slice(0, VAGAS_DA_PRATELEIRA).map((t, i) => {
        const n = baus.filter(b => b.tipo === t).length;
        return el('button', {
          type: 'button', class: `tf-pbau bau-${t}` + (i === 0 ? ' pronto' : '') + (i === 0 && novos ? ' ponto-novo' : ''),
          title: `Abrir ${BAUS[t].nome.toLowerCase()}`, onclick: () => irPara('baus'),
        }, ico('presente'), el('small', {}, BAUS[t].nome.replace('Baú ', '')),
        n > 1 ? el('span', { class: 'tf-pbau-qtd' }, `×${n}`) : null);
      }), ...vagas));
}

function renderPontinho() {
  const tem = db.temNovidade() || mural.prontas() > 0;
  for (const botao of document.querySelectorAll('[data-goto="tarefas"]')) {
    botao.classList.toggle('tem-premio', tem);
  }
}

// ---------------------------------- Mural ---------------------------------
// As missões em post-its, a de jogo primeiro, e as vagas que faltam. A
// primeira vaga vazia diz quando chega a próxima.
const COR_DO_NIVEL = { facil: 'var(--stylist)', medio: 'var(--inventario)', dificil: 'var(--board)' };
const ICONE_DO_EVENTO = { curtir: 'coracao', garimpar: 'sacola', publicar: 'camera', look: 'varinha', colagem: 'quadro' };
const giro = (uid) => ((parseInt(String(uid).slice(-3), 36) || 0) % 5 - 2) * 0.8;   // cada papel torto de um jeito
const prazo = (ms) => {
  const h = Math.floor(ms / 3600e3), m = Math.floor(ms / 60e3) % 60;
  return h ? `${h}h` : `${Math.max(1, m)}min`;
};
const tempoAte = (ms) => {
  const h = Math.floor(ms / 3600e3), m = Math.floor(ms / 60e3) % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${Math.max(1, m)}min`;
};

function papel({ cor, icone, texto, feito, meta, premio, tempo, rot, classe = '', resgatar, abrir, nivel }) {
  const pronta = feito >= meta;
  return el('article', {
    class: 'tf-papel' + (pronta ? ' pronta' : '') + (abrir && !pronta ? ' abre' : '') + classe,
    style: { '--cor': cor, '--rot': rot + 'deg' },
    onclick: abrir && !pronta ? abrir : null,
  },
    el('span', { class: 'tf-alfinete', 'aria-hidden': 'true' }),
    el('div', { class: 'tf-papel-topo' },
      el('span', { class: 'tf-papel-ico' }, ico(icone)),
      nivel ? el('small', { class: 'tf-nivel-chip' }, nivel) : null),
    el('b', {}, texto),
    el('div', { class: 'tf-papel-prog' },
      el('div', { class: 'tf-barra' }, el('span', { style: { width: (Math.min(feito, meta) / meta * 100) + '%' } })),
      el('small', {}, `${Math.min(feito, meta)}/${meta}`)),
    el('footer', {},
      pronta
        ? el('button', { type: 'button', class: 'tf-papel-premio resgatar', onclick: (e) => { e.stopPropagation(); resgatar(); } },
          'Resgatar ', premio)
        : el('span', { class: 'tf-papel-premio' }, premio),
      tempo ? el('small', { class: 'tf-papel-tempo' }, ico('relogio'), tempo) : null));
}

const premioEmFichas = (n, bau) => el('span', { class: 'tf-premio-n' }, `+${n}`,
  el('span', { class: 'ficha-moeda', 'aria-hidden': 'true' }), bau ? ico('presente') : null);

function renderMural() {
  const agora = Date.now();
  const lista = mural.missoes();
  const jogo = mural.missaoDeJogo();
  const papeis = [];

  if (jogo) {
    const j = JOGO[jogo.jogo];
    papeis.push(papel({
      cor: 'var(--loja)', icone: j.icone, texto: mural.textoDoJogo(jogo), feito: jogo.feito, meta: jogo.meta,
      premio: premioEmFichas(jogo.fichas), rot: -1.2, classe: ' jogo', nivel: 'Jogo',
      abrir: () => irPara('ajudas'),
      resgatar: () => {
        const r = mural.resgatarJogo();
        if (r) { tocar('missao'); toast(`+${r.fichas} fichas.`, 'rare'); }
      },
    }));
  } else {
    papeis.push(el('article', { class: 'tf-papel vazio jogo', style: { '--rot': '-1deg' } },
      el('b', {}, 'Novo jogo'), el('small', {}, `em ${tempoAte(mural.voltaDoJogo() - agora)}`)));
  }

  for (const m of lista) {
    const md = mural.modeloDe(m);
    const nivel = MURAL.niveis[m.nivel];
    papeis.push(papel({
      cor: COR_DO_NIVEL[m.nivel], icone: md.raridade ? 'brilho' : ICONE_DO_EVENTO[md.evento] || 'estrela',
      texto: mural.textoDa(m), feito: m.feito, meta: m.meta, rot: giro(m.uid),
      premio: premioEmFichas(nivel.fichas, m.dourada), tempo: prazo(m.vence - agora),
      classe: m.dourada ? ' dourada' : '', nivel: m.dourada ? `${nivel.nome} · dourada` : nivel.nome,
      resgatar: () => {
        const r = mural.resgatar(m.uid);
        if (!r) return;
        tocar('missao');
        toast(r.bau ? `+${r.fichas} fichas e ${r.bau}!` : `+${r.fichas} fichas.`, 'rare');
      },
    }));
  }

  const livres = MURAL.vagas - lista.length;
  for (let i = 0; i < livres; i++) {
    papeis.push(i === 0
      ? el('article', { class: 'tf-papel vazio', style: { '--rot': '1deg' } },
        el('b', {}, 'Nova missão'), el('small', {}, `em ${tempoAte(mural.proximaChegada() - agora)}`))
      : el('article', { class: 'tf-papel vazio fantasma', style: { '--rot': (i % 2 ? -1 : 1) + 'deg' } }));
  }

  $('#tf-mural').replaceChildren(el('div', { class: 'tf-mural-grade' }, ...papeis));
}

// ---------------------------------- Topo ----------------------------------
// Nível e fichas numa fileira. As fichas mostram só quantas você tem; tocar
// nelas abre as Trocas.

// Tudo que se compra com fichas, numa janela só. Cada compra fica guardada
// até a pessoa usar (o repor no ↻ da vitrine, como o das missões). `acao`
// devolve se deu certo, para tocar o som de gastar.
const TROCAS = [
  { id: 'resgate', nome: 'Resgate extra', texto: 'Mais uma peça na loja. Fica guardado até usar.',
    icone: () => ico('sacola'), preco: () => FICHAS.porResgate,
    acao: () => { const ok = db.trocarFichasPorResgate(); if (ok) toast('+1 resgate.', 'rare'); return ok; } },
  { id: 'repor', nome: 'Repor a loja', texto: 'Arara nova quando quiser: use no ↻ da vitrine.',
    icone: () => ico('atualizar'), preco: () => FICHAS.porRepor,
    acao: () => { const ok = db.comprarRepor(); if (ok) toast('+1 repor. Use no ↻ da vitrine.', 'rare'); return ok; },
    guardados: () => db.fichasDeRepor() },
  { id: 'congelar', nome: 'Congelar', texto: 'Segura uma peça na loja até amanhã. Use na ficha dela.',
    icone: () => ico('floco'), preco: () => FICHAS.porCongelar,
    acao: () => { const ok = db.comprarCongelamento(); if (ok) toast('+1 congelamento.', 'rare'); return ok; },
    guardados: () => db.congelamentos() },
];

// Também abre pelas fichas dos mini games; `aoFechar` redesenha o saldo de lá.
export function abrirTrocas(aoFechar = renderTopo) {
  const fechar = () => {
    fundo.remove();
    document.body.classList.remove('com-modal');
    document.removeEventListener('keydown', tecla);
    aoFechar();
  };
  const n = db.fichas();
  const opcao = (t) => {
    const preco = t.preco();
    const pode = n >= preco;
    const tem = t.guardados?.();
    return el('button', {
      type: 'button', class: 'tf-troca' + (pode ? ' pronto' : ''),
      disabled: pode ? null : true,
      onclick: () => { if (t.acao()) tocar('gastar'); fechar(); },
    },
      el('span', { class: 'tf-troca-ico', 'aria-hidden': 'true' }, t.icone()),
      el('span', { class: 'tf-troca-txt' },
        el('b', {}, t.nome, tem ? el('small', { class: 'tf-tem' }, `${tem} guardado${tem > 1 ? 's' : ''}`) : null),
        el('small', {}, pode ? t.texto : `Faltam ${preco - n} fichas.`)),
      el('span', { class: 'tf-preco' }, el('span', { class: 'ficha-moeda', 'aria-hidden': 'true' }), String(preco)));
  };

  const caixa = el('div', { class: 'modal-caixa pergunta-caixa tf-trocas-caixa', role: 'dialog', 'aria-modal': 'true' },
    el('h2', { class: 'pergunta-titulo' }, 'Trocas'),
    el('p', { class: 'tf-trocas-saldo' }, el('span', { class: 'ficha-moeda', 'aria-hidden': 'true' }),
      el('b', {}, String(n)), n === 1 ? ' ficha' : ' fichas'),
    el('div', { class: 'tf-trocas-lista' }, ...TROCAS.map(opcao)),
    el('div', { class: 'pergunta-botoes' },
      el('button', { type: 'button', class: 'btn-ghost', onclick: fechar }, 'Fechar')));
  const fundo = el('div', { class: 'modal pergunta' }, caixa);
  const tecla = (e) => { if (e.key === 'Escape') fechar(); };
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  document.addEventListener('keydown', tecla);
  document.body.append(fundo);
  document.body.classList.add('com-modal');
}

function renderTopo() {
  const p = db.progresso();
  const todas = todasAsColecoes();
  const comEscolha = todas.find(c => c.livres > 0);
  const n = db.fichas();
  const podeAlguma = TROCAS.some(t => n >= t.preco());

  $('#tarefas-faixa').replaceChildren(
    el('button', {
      type: 'button', class: 'tf-nivel' + (db.naoVistas(db.novidadesDosNiveis()).length ? ' tem-premio' : ''),
      title: 'Prêmios dos níveis', onclick: abrirTrilha,
    },
      el('span', { class: 'tf-nv' }, 'NV', el('b', {}, String(p.nivel))),
      el('div', { class: 'tf-barra' }, el('span', { style: { width: p.pct + '%' } })),
      el('small', {}, p.maximo ? `${p.xpTotal} XP` : `${p.xpNoNivel}/${p.xpDoNivel}`)),
    el('button', {
      type: 'button', class: 'tf-fichas' + (podeAlguma ? ' pronto' : ''),
      title: 'Fichas: toque para ver as trocas', onclick: () => abrirTrocas(),
    }, el('span', { class: 'ficha-moeda', 'aria-hidden': 'true' }), el('b', {}, String(n))),
    el('button', {
      type: 'button', class: 'tf-redondo' + (db.naoVistas(db.novidadesDosBaus()).length ? ' ponto-novo' : ''),
      title: 'Baús', 'aria-label': 'Baús', onclick: () => irPara('baus'),
    }, ico('presente')),
    el('button', {
      type: 'button',
      class: 'tf-redondo' + (comEscolha ? ' escolha' : '') + (db.naoVistas(db.novidadesDasColecoes()).length ? ' ponto-novo' : ''),
      title: comEscolha ? `${comEscolha.marca}: escolha um item do avatar` : 'Coleções', 'aria-label': 'Coleções',
      onclick: () => comEscolha ? abrirColecao(comEscolha.id) : irPara('colecoes'),
    }, ico(comEscolha ? 'presente' : 'trofeu'),
    todas.length ? el('small', {}, `${todas.filter(c => c.completa).length}/${todas.length}`) : null));
}

// ---------------------------------- Abas -----------------------------------
function renderAbas() {
  const botao = (id, nome, feitas, total, premio, prazo) => el('button', {
    type: 'button', role: 'tab', class: (aba === id ? 'on' : '') + (premio && aba !== id ? ' tem-premio' : ''),
    'aria-selected': String(aba === id), title: prazo,
    onclick: () => { if (aba !== id) { aba = id; renderTarefas(); } },
  }, nome, el('small', {}, `${feitas}/${total}`));
  const noMural = mural.missoes().length + (mural.missaoDeJogo() ? 1 : 0);
  const prontas = mural.prontas();
  $('#tf-abas').replaceChildren(
    el('button', {
      type: 'button', role: 'tab', class: (aba === 'mural' ? 'on' : '') + (prontas && aba !== 'mural' ? ' tem-premio' : ''),
      'aria-selected': String(aba === 'mural'),
      onclick: () => { if (aba !== 'mural') { aba = 'mural'; renderTarefas(); } },
    }, ico('alfinete'), 'Mural', el('small', {}, String(noMural))),
    botao('hoje', 'Diário', db.missoesFeitas(), MISSOES.length, db.naoVistas(db.novidadesDoDia()).length > 0,
      `Zeram em ${formatarContagem(msAteMeiaNoite())}`),
    botao('semana', 'Semana', db.semanaisFeitas(), MISSOES_SEMANA.length, db.naoVistas(db.novidadesDaSemana()).length > 0,
      `Zeram em ${formatarDias(msAteSegunda())}`));
}

// ------------------------------- Pedidos ----------------------------------
function pedido(m, atual, { resgatada, fichas, resgatar }) {
  const feito = Math.min(atual, m.meta);
  const ok = feito >= m.meta;
  return el('div', { class: 'tf-item' + (ok && resgatada ? ' ok' : '') },
    el('span', { class: 'tf-ico' }, ico(ok && resgatada ? 'ok' : (ICONE[m.evento] || 'estrela'))),
    el('div', { class: 'tf-info' },
      el('strong', {}, m.nome),
      ok ? null : el('div', { class: 'tf-barra' },
        el('span', { style: { width: (feito / m.meta * 100) + '%' } }))),
    ok && !resgatada
      ? el('button', { type: 'button', class: 'btn-premio', onclick: () => {
        if (resgatar(m.id)) toast(`+${fichas} fichas.`, 'rare');
      } }, `Resgatar +${fichas}`)
      : el('small', {}, ok ? '' : `${feito}/${m.meta}`));
}

function botaoPremio(texto, acao) {
  return el('button', { type: 'button', class: 'btn-premio', onclick: acao }, texto);
}

// ---------------------------------- Dia -----------------------------------
const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

function renderDia() {
  $('#tf-lista').replaceChildren(...MISSOES.map(m => pedido(m, db.progressoMissao(m.id), { resgatada: db.missaoResgatada(m.id), fichas: MARCOS_DIA.fichasPorMissao, resgatar: db.resgatarMissao })));

  const pronto = db.marcoDoDiaPronto();
  $('#tf-rodape').replaceChildren(...(pronto ? [botaoPremio('Carimbar o dia', resgatarDia)] : []));

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
  toast(`Dia carimbado! +${BAUS[r.bau].nome}`, 'rare');
}

// -------------------------------- Semana ----------------------------------
function renderSemana() {
  $('#tf-lista').replaceChildren(
    ...MISSOES_SEMANA.map(m => pedido(m, db.progressoSemanal(m.id), { resgatada: db.semanalResgatada(m.id), fichas: MARCOS_SEMANA.fichasPorMissao, resgatar: db.resgatarSemanal })));

  let rodape = [];
  if (db.carimboDaSemanaPronto()) {
    rodape = [botaoPremio('Carimbar a semana', () => {
      const r = db.carimbarSemana();
      if (r) toast(`Semana carimbada! +${BAUS[r.bau].nome}`, 'rare');
    })];
  }
  $('#tf-rodape').replaceChildren(...rodape);

  // A trilha: as semanas carimbadas e o Baú mensal na ponta.
  const total = BAU_ESPECIAL.semanas;
  const n = Math.min(db.semanasFechadas(), total);
  const selos = Array.from({ length: total }, (_, i) =>
    el('span', { class: 'tf-selo' + (i < n ? ' on' : ''), title: `Semana ${i + 1}` },
      i < n ? ico('ok') : String(i + 1)));
  trilha(selos, {
    nome: 'Baú mensal', bau: BAU_ESPECIAL, icone: 'coroa', especial: true,
    pronto: db.bauEspecialPronto(), abrir: abrirEspecial,
  });
}

// ---------------------------------- Baús -----------------------------------
// A trilha termina no baú. Fechado, um toque diz o que tem dentro; pronto, ele
// brilha e o toque abre; aberto, a peça que saiu aparece embaixo.
function trilha(selos, { nome, bau, icone, especial, pronto, abrir, aberto }) {
  const { atual } = premioDoBau(bau, db.nivel());
  const dica = `${nome} · ${descreverPremio(atual)}.`;
  const botaoBau = el('button', {
    type: 'button', 'aria-label': nome,
    class: 'tf-bau' + (especial ? ' especial' : '') + (pronto ? ' pronto' : '') + (aberto ? ' aberto' : ''),
    title: aberto ? `${nome} aberto` : dica,
    onclick: () => pronto ? abrir() : toast(aberto ? `${nome} já pego esta semana.` : dica),
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

// Pegar o baú da trilha: o XP entra na hora e o baú voa fechado para Tarefas,
// onde fica na tela de Baús até ser aberto.
function pegarUmBau(pegar) {
  const r = pegar();
  if (!r) return;
  toast(`+${BAUS[r.bau].nome}`, 'rare');
}

// As peças que saíram de um baú: tiram do estoque da loja e ganham número.
export function entregarPecas(pecas) {
  if (!pecas.length) return;
  const doGuardaRoupa = pecas.map(p => db.pecaDoInventario(p.id)).filter(Boolean);
  estoque.levar(doGuardaRoupa)
    .then(() => { estoque.numerar(doGuardaRoupa); db.salvar(); });
}

const abrirBau = () => pegarUmBau(db.abrirPremioDaSemana);
const abrirEspecial = () => pegarUmBau(db.abrirBauEspecial);

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
  db.marcarVistas(db.novidadesDosNiveis());
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
  const r = db.pegarPremioDoNivel(n);
  if (!r) return null;
  if (!quieto) {
    toast(r.tipo === 'bau' ? `+${BAUS[r.bau].nome}`
      : r.tipo === 'repor' ? `+${r.qtd} ${r.qtd === 1 ? 'ficha' : 'fichas'} de repor.`
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
  const baus = saiu.filter(r => r.tipo === 'bau').length;
  const partes = [
    fichas && `+${fichas} fichas`,
    repor && `+${repor} de repor`,
    baus && `+${baus} ${baus === 1 ? 'baú' : 'baús'}`,
  ].filter(Boolean);
  toast(partes.join(', ') + '.', 'rare');
}

// ------------------------------ Baú abrindo --------------------------------
// O baú treme, abre e as peças pulam uma a uma, com o brilho da raridade.
// Tocar numa peça fecha o baú e abre a ficha dela.
export function mostrarBau(nome, pecas, { xp = 0, bau = null, extra = '' } = {}) {
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
  tocar('bau');
  if (animando()) {
    modal.classList.add('com-gsap');
    animarBau([...modal.querySelectorAll('.bau-item, .bau-extra, .bau-vazio')]);
  }
}

const ordem = (f) => Object.keys(CHANCE_NO_BAU).indexOf(f);

function fecharBau() {
  $('#modal-bau').hidden = true;
  if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('com-modal');
}

export const aoEntrarNasTarefas = renderTarefas;
