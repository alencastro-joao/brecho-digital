// Coleções (#/colecoes): as peças da loja juntadas por marca, por cor e por
// estilo, em três abas.
//
// Cada coleção mostra as peças do acervo — as que você já garimpou e, em
// cinza, as que faltam — e os itens do avatar que ela libera. A tela abre
// pelo cartão "Coleções" da aba Tarefas e pelos emblemas do perfil; o botão de
// Tarefas fica aceso enquanto ela está aberta (ver BOTAO_DA_VIEW, router.js).
//
// Nada aqui é gravado: o progresso é o guarda-roupa lido na hora
// (db.progressoDasColecoes), do mesmo jeito que o nível é lido do XP.

import { COLECOES, ESTILOS, COLECOES_DE_COR, hexDaCor, idDaCor, idDoEstilo, escalaGrade, RARIDADE, logoDaColecao } from './config.js';
import { item as pecaDoCatalogo, nomeDaPeca } from './catalog.js';
import { ROUPINHAS, roupinha, svgRoupinha } from './roupinhas.js';
import { aparenciaAtual } from './avatar.js';
import * as db from './db.js';
import { el, $, toast } from './util.js';
import { irPara, viewAtual } from './router.js';

let filtro = 'todas';
let grupo = 'marcas';
let expandida = null;        // emblema da lista aberto mostrando as peças
let aberta = null;           // id da coleção aberta na tela dela; null = lista
let pedida = null;           // a que abrirColecao pediu para a próxima entrada

// Quantas peças o cartão da lista mostra. As que você tem vêm primeiro; o
// resto fica na tela da coleção.
const PECAS_NO_CARTAO = 6;

const GRUPOS = [
  ['marcas', 'Marcas'],
  ['cores', 'Cores'],
  ['estilos', 'Temas'],
];

const EXPLICACAO = {
  marcas: 'Garimpe peças de uma marca para ganhar os itens dela no avatar. Na 3ª peça da coleção você escolhe um item do avatar, e a cada 2 peças depois ganha outra escolha; completar a coleção libera os que faltam. Vestir os itens de uma marca ativa o efeito dela; os efeitos na arara valem pelo que você vestia ao abrir a loja no dia.',
  cores: 'Todas as peças da loja de uma mesma cor. Cada cor tem itens do avatar pintados nela. Na 3ª peça da coleção você escolhe um item do avatar, e a cada 2 peças depois ganha outra escolha; completar a coleção libera os que faltam. Vestir 2 ou mais itens da mesma cor dá XP extra nas missões.',
  estilos: 'As peças da loja de cada tema. Cada tema tem itens do avatar. Na 3ª peça da coleção você escolhe um item do avatar, e a cada 2 peças depois ganha outra escolha; completar a coleção libera os que faltam. Vestir 2 ou mais itens do mesmo tema acende um brilho no avatar.',
};

const FILTROS = [
  ['todas', 'Todas'],
  ['perto', 'Perto de fechar'],
  ['completas', 'Completas'],
];

// As coleções com o progresso de cada uma, na ordem de quem está mais perto
// de fechar. Coleção sem peça no acervo (marca que saiu) não aparece.
export function minhasColecoes() {
  const prog = db.progressoDasColecoes();
  return COLECOES
    .map(c => ({ ...c, ...prog[c.id] }))
    .filter(c => c.total > 0)
    .map(c => ({ ...c, completa: c.tem >= c.total, pct: c.tem / c.total }));
}

// Cor e estilo: o progresso vem do mesmo lugar que o das marcas
// (db.progressoDasColecoes); os itens são os que cada uma libera.
const comProgresso = (c, prog) => {
  const p = prog[c.id] || { ids: [], total: 0, tem: 0 };
  return { ...c, ...p, completa: p.total > 0 && p.tem >= p.total, pct: p.total ? p.tem / p.total : 0 };
};
const itensQueLibera = (id) => ROUPINHAS
  .filter(r => r.desbloqueio?.tipo === 'colecao' && r.desbloqueio.colecao === id)
  .sort((a, b) => a.desbloqueio.ordem - b.desbloqueio.ordem)
  .map(r => r.id);

export function colecoesPorCor() {
  const prog = db.progressoDasColecoes();
  return Object.keys(COLECOES_DE_COR).map(nome => comProgresso({
    id: idDaCor(nome), tipo: 'cor', marca: nome, hex: hexDaCor(nome),
    itens: itensQueLibera(idDaCor(nome)),
    efeito: { texto: '2 itens da mesma cor vestidos dão XP extra nas missões' },
  }, prog)).filter(c => c.total > 0);
}

export function colecoesPorEstilo() {
  const prog = db.progressoDasColecoes();
  return Object.entries(ESTILOS).map(([id, e]) => comProgresso({
    id: idDoEstilo(id), tipo: 'estilo', marca: e.nome, hex: e.brilho, icone: e.icone,
    itens: itensQueLibera(idDoEstilo(id)),
    efeito: { texto: `2 itens de ${e.nome} vestidos acendem um brilho no avatar` },
  }, prog));                 // tema ainda sem peças também aparece ("em breve")
}

const COLECOES_DO_GRUPO = {
  marcas: minhasColecoes, cores: colecoesPorCor, estilos: colecoesPorEstilo,
};

// A mais perto de fechar sem estar fechada; empate vai para a que falta menos.
// Marcas, cores e estilos juntos: o que o perfil e o cartão de Tarefas contam.
export const GRUPOS_DE_COLECAO = [
  ['marcas', 'Marcas', () => minhasColecoes()],
  ['cores', 'Cores', () => colecoesPorCor()],
  ['estilos', 'Temas', () => colecoesPorEstilo()],
];
export const todasAsColecoes = () => GRUPOS_DE_COLECAO.flatMap(([, , lista]) => lista());

export function colecaoMaisPerto() {
  const abertas = todasAsColecoes().filter(c => c.total > 0 && !c.completa);
  if (!abertas.length) return null;
  return abertas.sort((a, b) =>
    (b.pct - a.pct) || ((a.total - a.tem) - (b.total - b.tem)))[0];
}

// A peça que representa a coleção num emblema: a primeira que você tem, ou a
// primeira do acervo quando ainda não tem nenhuma.
export function capaDaColecao(c) {
  const minha = c.ids.find(id => db.temPeca(id));
  return pecaDoCatalogo(minha ?? c.ids[0]) || null;
}

export function montarColecoes() {
  db.onChange(() => { if (viewAtual() === 'colecoes') renderColecoes(); });
  $('#col-voltar').addEventListener('click', () => {
    if (aberta) { aberta = null; renderColecoes(); $('.view-colecoes').scrollTop = 0; }
    else irPara('tarefas');
  });
}

// Abre a tela de uma coleção (pelo emblema do perfil, por exemplo).
export function abrirColecao(id) {
  const g = Object.keys(COLECOES_DO_GRUPO).find(k => COLECOES_DO_GRUPO[k]().some(c => c.id === id));
  if (g) { grupo = g; pedida = id; }
  irPara('colecoes');
}

export function renderColecoes() {
  const c = aberta && COLECOES_DO_GRUPO[grupo]().find(x => x.id === aberta);
  if (aberta && !c) aberta = null;
  $('#col-voltar').textContent = c ? '‹ Coleções' : '‹ Tarefas';
  $('#col-head').hidden = Boolean(c);
  $('#col-lista').hidden = Boolean(c);
  $('#col-detalhe').hidden = !c;
  if (c) { renderDetalhe(c); return; }

  $('#col-grupos').replaceChildren(...GRUPOS.map(([id, rotulo]) =>
    el('button', {
      class: 'col-grupo' + (grupo === id ? ' ativo' : ''),
      onclick: () => { grupo = id; filtro = 'todas'; renderColecoes(); },
    }, rotulo)));
  $('#col-sub').textContent = EXPLICACAO[grupo];
  if (!aberta) expandida = expandida && COLECOES_DO_GRUPO[grupo]().some(x => x.id === expandida) ? expandida : null;

  const todas = COLECOES_DO_GRUPO[grupo]();
  const completas = todas.filter(c => c.completa).length;
  $('#col-resumo').textContent =
    `${completas} de ${todas.length} ${todas.length === 1 ? 'completa' : 'completas'}`;

  $('#col-filtros').replaceChildren(...FILTROS.map(([id, rotulo]) =>
    el('button', {
      class: 'col-filtro' + (filtro === id ? ' ativo' : ''),
      onclick: () => { filtro = id; renderColecoes(); },
    }, rotulo)));

  const lista = todas
    .filter(c => filtro === 'todas' ||
      (filtro === 'completas' ? c.completa : !c.completa && c.tem > 0))
    .sort((a, b) => Number(b.livres > 0) - Number(a.livres > 0)
      || Number(b.completa) - Number(a.completa) || b.pct - a.pct);

  $('#col-lista').replaceChildren(...(lista.length ? lista.map(cartaoDaColecao) : [
    el('p', { class: 'col-vazio' }, filtro === 'completas'
      ? 'Nenhuma coleção completa ainda. Garimpe as peças que faltam na vitrine.'
      : grupo === 'marcas'
        ? 'Nenhuma coleção começada. Garimpe peças de uma marca para abrir os itens dela.'
        : 'Nenhuma coleção começada. Garimpe peças na vitrine para começar.'),
  ]));
}

const temPrimeiro = (ids) => [...ids].sort((a, b) => Number(db.temPeca(b)) - Number(db.temPeca(a)));

const textoDoBonus = (c) => c.tipo ? '2 itens +5% · 5 itens +20%'
  : c.itens.length > 2 ? '2 itens +5% · completa +20%' : 'completa +20%';

function tituloDaColecao(c, tag = 'h2') {
  const estilo = ESTILOS[c.estilo];
  const logo = logoDaColecao(c);
  return el('div', { class: 'col-titulo' },
    logo ? el('img', { class: 'col-logo', src: logo, alt: '', loading: 'lazy',
      onerror: (e) => e.target.remove() }) : null,
    c.tipo === 'cor' ? el('span', { class: 'col-logo col-amostra', style: { background: c.hex } })
      : c.hex && !logo ? el('span', { class: 'col-bolinha', style: { background: c.hex } }) : null,
    el(tag, {}, c.marca),
    estilo ? el('span', { class: 'col-estilo' }, estilo.nome) : null);
}

// A lista é uma grade de emblemas: logo (ou a cor, ou uma peça) com um anel
// de progresso e o nome. Tocar abre o emblema ali mesmo, com as peças; tocar
// de novo abre a tela da coleção.
function cartaoDaColecao(c) {
  const ids = temPrimeiro(c.ids);
  const aberto = expandida === c.id;
  const abrir = () => {
    if (aberto) { aberta = c.id; expandida = null; renderColecoes(); $('.view-colecoes').scrollTop = 0; }
    else { expandida = c.id; renderColecoes(); }
  };
  const emblema = el('span', {
    class: 'col-disco' + (c.completa ? ' completa' : ''),
    style: { '--pct': (c.pct * 100) + '%' },
  }, discoDaColecao(c));
  const status = c.livres > 0 ? el('span', { class: 'col-tem-escolha' }, '🎁')
    : el('small', {}, !c.total ? 'Em breve' : c.completa ? '✓' : `${c.tem}/${c.total}`);

  if (!aberto) {
    return el('button', {
      type: 'button', class: 'col-tile' + (c.completa ? ' completa' : ''), onclick: abrir,
      title: c.marca,
    }, emblema, el('strong', {}, c.marca), status);
  }

  const cabem = ids.length > PECAS_NO_CARTAO ? PECAS_NO_CARTAO - 1 : PECAS_NO_CARTAO;
  const resto = ids.length - cabem;
  return el('div', { class: 'col-tile aberto' + (c.completa ? ' completa' : '') },
    el('button', { type: 'button', class: 'col-tile-topo', onclick: () => { expandida = null; renderColecoes(); } },
      emblema,
      el('span', { class: 'col-tile-nome' }, el('strong', {}, c.marca),
        el('small', {}, !c.total ? 'Em breve' : c.completa ? '✓ Completa' : `${c.tem} de ${c.total} peças`)),
      c.livres > 0 ? el('span', { class: 'col-tem-escolha' }, '🎁 Escolha um item') : null),
    c.total ? el('div', { class: 'col-pecas' },
      ...ids.slice(0, cabem).map(id => casaDaPeca(id)),
      resto > 0 ? el('div', { class: 'col-peca col-mais' }, `+${resto}`) : null)
      : el('p', { class: 'col-vazio' }, 'As peças deste tema chegam em breve.'),
    el('button', { type: 'button', class: 'col-ver', onclick: abrir }, 'Ver coleção ›'));
}

// O que vai dentro do disco: o logo da marca, a cor pintada ou uma peça.
function discoDaColecao(c) {
  const logo = logoDaColecao(c);
  if (logo) return el('img', { src: logo, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() });
  if (c.tipo === 'cor') return el('span', { class: 'col-disco-cor', style: { background: c.hex } });
  const capa = c.ids.length ? capaDaColecao(c) : null;
  return capa ? el('div', { class: 'peca-caixa', style: { '--esc': String(escalaGrade(capa)) } },
    el('img', { src: capa.src, alt: '', loading: 'lazy' }))
    : el('span', { class: 'col-disco-cor', style: { background: c.hex || '#eee' } });
}

function miniItem(id) {
  const r = roupinha(id);
  if (!r) return null;
  const aberto = db.estadoDaRoupinha(r).liberada;
  const arte = el('span', { class: 'col-mini' + (aberto ? ' aberto' : ''), title: r.nome });
  arte.innerHTML = svgRoupinha(r, aparenciaAtual().corpo);
  return arte;
}

// A tela da coleção: todas as peças (as que faltam em cinza, com raridade),
// os itens do avatar com o que falta para cada um e o efeito ao vestir.
function renderDetalhe(c) {
  const ids = temPrimeiro(c.ids);
  const faltam = c.total - c.tem;
  $('#col-detalhe').replaceChildren(...[
    el('header', { class: 'col-det-topo' + (c.completa ? ' completa' : '') },
      tituloDaColecao(c, 'h1'),
      el('p', { class: 'col-det-conta' }, !c.total ? 'As peças deste tema chegam em breve.' : c.completa
        ? `✓ Coleção completa · ${c.total} peças`
        : `${c.tem} de ${c.total} peças · ${faltam === 1 ? 'falta 1' : `faltam ${faltam}`}`),
      el('div', { class: 'barra' + (c.completa ? ' cheia' : '') },
        el('span', { style: { width: (c.pct * 100) + '%' } }))),
    !c.itens.length ? null : el('section', { class: 'col-det-secao' },
      el('h3', {}, 'Itens do avatar'),
      c.livres > 0 ? el('p', { class: 'col-escolha-aviso' },
        `🎁 Você pode escolher ${c.livres === 1 ? '1 item' : `${c.livres} itens`}. Toque no que quiser.`) : null,
      el('div', { class: 'col-itens-lista' }, ...c.itens.map(id => itemDaColecao(id, c)).filter(Boolean))),
    el('section', { class: 'col-det-secao' },
      el('h3', {}, 'Efeito ao vestir'),
      el('p', { class: 'col-efeito' }, c.efeito.texto,
        el('span', { class: 'col-breve' }, textoDoBonus(c)))),
    el('section', { class: 'col-det-secao' },
      el('h3', {}, 'Peças'),
      el('div', { class: 'col-det-pecas' }, ...ids.map(id => casaDaPeca(id, true))))].filter(Boolean)); // replaceChildren escreveria "null"
}

function casaDaPeca(id, comNome = false) {
  const peca = pecaDoCatalogo(id);
  if (!peca) return null;
  const tem = db.temPeca(id);
  const rar = RARIDADE[peca.raridade];
  const casa = el('div', {
    class: 'col-peca' + (tem ? '' : ' falta'),
    title: tem ? nomeDaPeca(peca) : `Falta: ${nomeDaPeca(peca)}${rar ? ` (${rar.nome.toLowerCase()})` : ''}`,
  },
    el('div', { class: 'peca-caixa', style: { '--esc': String(escalaGrade(peca)) } },
      el('img', { src: peca.src, alt: nomeDaPeca(peca), loading: 'lazy' })));
  if (!comNome) return casa;
  return el('figure', { class: 'col-det-peca' + (tem ? '' : ' falta') },
    casa,
    el('figcaption', {},
      el('strong', {}, nomeDaPeca(peca)),
      el('small', {}, tem ? '✓ No guarda-roupa' : `Falta${rar ? ` · ${rar.nome.toLowerCase()}` : ''}`)));
}

function itemDaColecao(id, c) {
  const r = roupinha(id);
  if (!r) return null;
  const e = db.estadoDaRoupinha(r);
  const pode = !e.liberada && c?.livres > 0;
  const arte = el('div', { class: 'col-item-arte' });
  arte.innerHTML = svgRoupinha(r, aparenciaAtual().corpo);
  return el('button', {
    class: 'col-item' + (e.liberada ? ' aberto' : '') + (pode ? ' escolher' : ''),
    title: e.liberada ? `${r.nome}: no seu inventário` : pode ? `Escolher ${r.nome}` : e.rotulo,
    onclick: () => {
      if (e.liberada) irPara('vestiario');
      else if (pode && db.escolherItem(c.id, id)) toast(`${r.nome} foi para o seu inventário`, 'rare');
    },
  },
    arte,
    el('div', { class: 'col-item-info' },
      el('strong', {}, r.nome),
      el('small', {}, e.liberada ? '✓ No inventário' : pode ? '🎁 Escolher este' : `🔒 ${e.rotulo}`)));
}

// Entrar pela navegação abre a lista; pelo emblema, a coleção dele.
export function aoEntrarNasColecoes() {
  aberta = pedida;
  pedida = null;
  renderColecoes();
}
