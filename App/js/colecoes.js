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

import { CONFIG, COLECOES, ESTILOS, COLECOES_DE_COR, hexDaCor, idDaCor, idDoEstilo, escalaGrade, RARIDADE, logoDaColecao,
         migrarCategoria } from './config.js';
import { item as pecaDoCatalogo, nomeDaPeca } from './catalog.js';
import { ROUPINHAS, roupinha, svgRoupinha, pecasParaEscolha, escolhasDaColecao } from './roupinhas.js';
import { aparenciaAtual } from './avatar.js';
import * as db from './db.js';
import { el, $, toast } from './util.js';
import { ico, emo } from './icones.js';
import { irPara, paramAtual, viewAtual, voltar } from './router.js';
import { mostrar } from './janela.js';
import { abrirPecaNoCloset } from './closet.js';
import { flutuarTexto } from './animacoes.js';

let grupo = 'marcas';
let expandida = null;        // emblema da lista aberto mostrando as peças
let aberta = null;           // id da coleção aberta (a hash #/colecoes/<id>); null = lista

// Quantas peças o cartão da lista mostra. As que você tem vêm primeiro; o
// resto fica na tela da coleção.
const PECAS_NO_CARTAO = 6;

const GRUPOS = [
  ['marcas', 'Marcas'],
  ['cores', 'Cores'],
  ['estilos', 'Temas'],
];

// Como os itens saem, igual nas três abas.
const COMO_SAI = 'Na 3ª peça da coleção o dono separa o primeiro item do avatar no balcão; os outros saem de 3 em 3 peças (6, 9, 12...), sem nunca pedir a coleção inteira. Levar um item não gasta resgate.';

const EXPLICACAO = {
  marcas: 'Garimpe peças de uma marca para ganhar os itens dela no avatar. ' + COMO_SAI + ' Vestir os itens de uma marca ativa o efeito dela; os efeitos na arara valem pelo que você vestia ao abrir a loja no dia.',
  cores: 'Todas as peças da loja de uma mesma cor. Cada cor tem itens do avatar pintados nela. ' + COMO_SAI + ' Vestir 2 ou mais itens da mesma cor traz mais peças dessa cor na sua arara; vale pelo que você vestia ao abrir a loja no dia.',
  estilos: 'As peças da loja de cada tema. Cada tema tem itens do avatar. ' + COMO_SAI + ' Vestir 2 ou mais itens do mesmo tema acende um brilho no avatar.',
};


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
    efeito: { texto: '2 itens da mesma cor vestidos trazem mais peças dessa cor na arara' },
  }, prog)).filter(c => c.total > 0);
}

export function colecoesPorEstilo() {
  const prog = db.progressoDasColecoes();
  return Object.entries(ESTILOS).filter(([, e]) => !e.oculto).map(([id, e]) => comProgresso({
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

// ------------------------- Atalhos de fora da tela -------------------------
// Outras telas levam às coleções: o aviso de peça nova, a peça no guarda-roupa,
// a ficha da loja e o item do avatar em Roupas.

// As coleções de que a peça do acervo faz parte (marca, cor, tema). Quem
// chama várias vezes seguidas passa a lista pronta.
export function colecoesDaPeca(id, lista = todasAsColecoes()) {
  return lista.filter(c => c.ids?.includes(id));
}

// Pegar mais uma peça desta coleção dá uma escolha de item do avatar? Só
// conta se ainda sobrar item trancado depois das escolhas que já esperam.
export function rendeEscolha(c) {
  const n = c.itens?.length || 0;
  if (!n || c.completa) return false;
  const trancados = c.itens.filter(id => roupinha(id) && !db.estadoDaRoupinha(roupinha(id)).liberada).length;
  return trancados > (c.livres || 0) && escolhasDaColecao(c.tem + 1, c.total, n) > escolhasDaColecao(c.tem, c.total, n);
}

// Um botãozinho com o emblema, o nome e a conta; toca e abre a coleção.
export function chipDaColecao(c) {
  const disco = el('span', { class: 'col-chip-disco' }, discoDaColecao(c));
  return el('button', {
    type: 'button',
    class: 'col-chip' + (c.livres > 0 ? ' presente' : '') + (c.completa ? ' completa' : ''),
    title: `Ver a coleção ${c.marca}`,
    onclick: (e) => { e.stopPropagation(); abrirColecao(c.id); },
  }, disco, el('span', {}, c.marca), el('small', {}, c.completa ? ico('ok') : `${c.tem}/${c.total}`),
  c.livres > 0 ? el('span', { class: 'col-chip-gift' }, emo('🎁')) : null);
}

// Logo depois de ganhar uma peça: o emblema da coleção sai de onde a peça
// estava e voa num arco até o botão de Tarefas (como o baú, em baus.js), que
// dá um pulinho e mostra o "+1". Sem texto: o pontinho e a tela de coleções
// contam o resto. Vai a que tem escolha esperando; senão, a mais perto de fechar.
export function avisarColecaoDaPeca(id, origem = null) {
  const cols = colecoesDaPeca(id);
  if (!cols.length) return;
  const c = [...cols].sort((a, b) => (b.livres > 0) - (a.livres > 0) || b.pct - a.pct)[0];
  const r = origem?.isConnected && origem.getBoundingClientRect();
  const de = r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
                          : { x: innerWidth / 2, y: innerHeight / 2 };
  // Deixa a peça sair voando para o closet primeiro.
  setTimeout(() => voarParaTarefas(c, de), 350);
}

const visivel = (r) => r && r.width > 0 && r.bottom > 0 && r.top < innerHeight;

function voarParaTarefas(c, de) {
  const alvo = [...document.querySelectorAll('.sidebar-btn[data-goto="tarefas"]')]
    .find(b => visivel(b.getBoundingClientRect()));
  if (!alvo) return;
  const fim = alvo.getBoundingClientRect();
  const para = { x: fim.left + fim.width / 2, y: fim.top + fim.height / 2 };
  const chegar = () => {
    alvo.classList.remove('recebeu');
    void alvo.offsetWidth;
    alvo.classList.add('recebeu');
    setTimeout(() => alvo.classList.remove('recebeu'), 600);
    flutuarTexto(alvo, '+1');
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { chegar(); return; }

  const tam = 54;
  const voando = el('div', { class: 'col-voando', 'aria-hidden': 'true' },
    el('span', { class: 'col-chip-disco' }, discoDaColecao(c)));
  Object.assign(voando.style, { left: `${de.x - tam / 2}px`, top: `${de.y - tam / 2}px` });
  document.body.append(voando);

  const dx = para.x - de.x, dy = para.y - de.y;
  const alto = Math.min(140, 50 + Math.abs(dx) * 0.3);
  voando.animate([
    { transform: 'translate(0, 0) scale(.4)', opacity: 0 },
    { transform: `translate(${dx * 0.1}px, ${-alto * 0.7}px) scale(1.1)`, opacity: 1, offset: 0.25 },
    { transform: `translate(${dx * 0.55}px, ${dy * 0.35 - alto}px) scale(.85) rotate(-10deg)`, offset: 0.6 },
    { transform: `translate(${dx}px, ${dy}px) scale(.35)`, opacity: 0.9 },
  ], { duration: 950, easing: 'cubic-bezier(.45, 0, .6, 1)', fill: 'forwards' }).finished
    .then(() => { voando.remove(); chegar(); });
}

export function montarColecoes() {
  db.onChange(() => { if (viewAtual() === 'colecoes') renderColecoes(); });
  // A coleção aberta é uma entrada no histórico: o ‹ e o voltar do aparelho
  // voltam para a lista, ou para quem a abriu (o perfil, a ficha da peça).
  $('#col-voltar').addEventListener('click', () => voltar(aberta ? 'colecoes' : 'tarefas'));
}

const grupoDa = (id) => Object.keys(COLECOES_DO_GRUPO).find(k => COLECOES_DO_GRUPO[k]().some(c => c.id === id));

// Abre a tela de uma coleção (pelo emblema do perfil, por exemplo).
export function abrirColecao(id) {
  irPara('colecoes', grupoDa(id) ? id : null);
}

export function renderColecoes() {
  const c = aberta && COLECOES_DO_GRUPO[grupo]().find(x => x.id === aberta);
  if (aberta && !c) aberta = null;
  $('#col-voltar').textContent = c ? '‹ Coleções' : '‹ Tarefas';
  $('#col-head').hidden = Boolean(c);
  $('#col-lista').hidden = Boolean(c);
  $('#col-detalhe').hidden = !c;
  if (c) { renderDetalhe(c); return; }
  novaNaVisita = null;   // saiu da coleção: a visita acabou

  $('#col-grupos').replaceChildren(...GRUPOS.map(([id, rotulo]) =>
    el('button', {
      // Pontinho vermelho: o caminho até o item novo para escolher.
      class: 'col-grupo' + (grupo === id ? ' ativo' : '') +
        (COLECOES_DO_GRUPO[id]().some(novaParaVer) ? ' ponto-novo' : ''),
      onclick: () => { grupo = id; renderColecoes(); },
    }, rotulo)));
  $('#col-sub').textContent = EXPLICACAO[grupo];
  if (!aberta) expandida = expandida && COLECOES_DO_GRUPO[grupo]().some(x => x.id === expandida) ? expandida : null;

  const todas = COLECOES_DO_GRUPO[grupo]();
  const completas = todas.filter(c => c.completa).length;
  $('#col-resumo').textContent =
    `${completas} de ${todas.length} ${todas.length === 1 ? 'completa' : 'completas'}`;

  // Sem filtro: a ordem já diz o que importa. Escolha esperando primeiro,
  // depois as mais perto de fechar, as que nem começaram e, no fim, as
  // completas e os temas ainda sem peças.
  const peso = (c) => c.livres > 0 ? 0 : !c.total ? 4 : c.completa ? 3 : c.tem ? 1 : 2;
  const lista = [...todas].sort((a, b) => peso(a) - peso(b) || b.pct - a.pct);

  const grade = $('#col-lista');
  const nos = lista.map(cartaoDaColecao);
  // A prévia da coleção tocada abre sempre logo abaixo da fileira dela, com a
  // grade parada no lugar: sem empurrar emblemas para outra linha.
  const i = lista.findIndex(c => c.id === expandida);
  if (i >= 0) {
    grade.replaceChildren(...nos);                     // para medir as colunas
    const colunas = getComputedStyle(grade).gridTemplateColumns.split(' ').filter(Boolean).length || 3;
    nos.splice(Math.min(nos.length, (Math.floor(i / colunas) + 1) * colunas), 0, painelDaColecao(lista[i]));
  }
  grade.replaceChildren(...(nos.length ? nos : [
    el('p', { class: 'col-vazio' }, 'Nenhuma coleção por aqui ainda.'),
  ]));
}

// Os tipos de peça na ordem do corpo, de cima para baixo, e os acessórios no fim.
const ORDEM_DO_ALBUM = ['hats', 'glasses', 'necklaces', 'shirts', 'cropped', 'coats', 'dresses',
  'belts', 'pants', 'shorts', 'skirts', 'shoes', 'bags', 'watches', 'bracelets'];
const tipoDe = (id) => migrarCategoria(pecaDoCatalogo(id)?.cat);
const posDoTipo = (id) => {
  const i = ORDEM_DO_ALBUM.indexOf(tipoDe(id));
  return i < 0 ? ORDEM_DO_ALBUM.length : i;
};
// Dentro do tipo, a cor: na ordem das coleções de cor, e peça sem cor no fim.
const ORDEM_DAS_CORES = Object.keys(COLECOES_DE_COR).map(c => c.toLowerCase());
const posDaCor = (id) => {
  const i = ORDEM_DAS_CORES.indexOf((pecaDoCatalogo(id)?.cor || '').trim().toLowerCase());
  return i < 0 ? ORDEM_DAS_CORES.length : i;
};
const porTipoECor = (a, b) => posDoTipo(a) - posDoTipo(b) || posDaCor(a) - posDaCor(b);
// O álbum: uma grade só, por tipo e depois por cor, sem título separando.
const emOrdem = (ids) => [...ids].sort(porTipoECor);
// A prévia: as que você tem primeiro; dentro disso, tipo e cor.
const temPrimeiro = (ids) => [...ids].sort((a, b) =>
  Number(db.temPeca(b)) - Number(db.temPeca(a)) || porTipoECor(a, b));

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
  const aberto = expandida === c.id;
  const abrir = () => {
    if (aberto) { expandida = null; abrirColecao(c.id); }
    else { expandida = c.id; renderColecoes(); }
  };
  const emblema = el('span', {
    class: 'col-disco' + (c.completa ? ' completa' : ''),
    style: { '--pct': (c.pct * 100) + '%' },
  }, discoDaColecao(c));
  const status = c.livres > 0 ? el('span', { class: 'col-tem-escolha' }, emo('🎁'))
    : el('small', {}, !c.total ? 'Em breve' : c.completa ? ico('ok') : `${c.tem}/${c.total}`);

  return el('button', {
    type: 'button', class: 'col-tile' + (c.completa ? ' completa' : '') + (aberto ? ' selecionado' : '') +
      (novaParaVer(c) ? ' ponto-novo' : ''),
    onclick: abrir, title: c.marca,
  }, emblema, el('strong', {}, c.marca), status);
}

// A prévia aberta embaixo da fileira: as peças e o botão para a coleção.
function painelDaColecao(c) {
  const ids = temPrimeiro(c.ids);
  const fechar = () => { expandida = null; renderColecoes(); };
  const abrir = () => { expandida = null; abrirColecao(c.id); };
  const emblema = el('span', {
    class: 'col-disco' + (c.completa ? ' completa' : ''),
    style: { '--pct': (c.pct * 100) + '%' },
  }, discoDaColecao(c));
  const cabem = ids.length > PECAS_NO_CARTAO ? PECAS_NO_CARTAO - 1 : PECAS_NO_CARTAO;
  const resto = ids.length - cabem;
  return el('div', { class: 'col-tile aberto' + (c.completa ? ' completa' : '') },
    el('button', { type: 'button', class: 'col-tile-topo', onclick: fechar },
      emblema,
      el('span', { class: 'col-tile-nome' }, el('strong', {}, c.marca),
        el('small', {}, !c.total ? 'Em breve' : c.completa ? [ico('ok'), ' Completa'] : `${c.tem} de ${c.total} peças`)),
      c.livres > 0 ? el('span', { class: 'col-tem-escolha' }, emo('🎁'), ' Escolha um item') : null),
    c.total ? el('div', { class: 'col-pecas' },
      ...ids.slice(0, cabem).map(id => casaDaPeca(id)),
      resto > 0 ? el('div', { class: 'col-peca col-mais' }, `+${resto}`) : null)
      : el('p', { class: 'col-vazio' }, 'As peças deste tema chegam em breve.'),
    el('button', { type: 'button', class: 'col-ver' + (novaParaVer(c) ? ' ponto-novo' : ''), onclick: abrir }, 'Ver coleção ›'));
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

// A tela da coleção, como um álbum: no topo o emblema com o anel e a conta;
// embaixo a trilha de recompensas (cada marco é um item do avatar); a
// escolha, só quando há uma esperando; depois o álbum de peças, com as que
// faltam em silhueta; e o efeito numa linha no fim.
// Pontinho vermelho: o caminho até o item novo para escolher, só até a pessoa
// abrir a coleção. Lá dentro ele fica nos itens durante essa visita.
const novaParaVer = (c) => {
  const chave = db.novidadeDaColecao(c.id);
  return Boolean(chave && db.naoVistas([chave]).length);
};
let novaNaVisita = null;

function renderDetalhe(c) {
  const chave = db.novidadeDaColecao(c.id);
  if (chave && db.naoVistas([chave]).length) {
    novaNaVisita = c.id;
    setTimeout(() => db.marcarVistas([chave]));
  } else if (novaNaVisita !== c.id) novaNaVisita = null;
  const faltam = c.total - c.tem;
  $('#col-detalhe').replaceChildren(...[
    el('header', { class: 'col-hero' + (c.completa ? ' completa' : '') },
      el('span', { class: 'col-disco grande' + (c.completa ? ' completa' : ''),
        style: { '--pct': (c.pct * 100) + '%' } }, discoDaColecao(c)),
      el('h1', {}, c.marca),
      !c.total ? el('p', { class: 'col-hero-sub' }, 'As peças deste tema chegam em breve.')
        : el('p', { class: 'col-hero-conta' }, el('strong', {}, String(c.tem)), ` / ${c.total}`),
      c.total ? el('p', { class: 'col-hero-sub' }, c.completa ? [emo('✨'), ' Coleção completa!']
        : faltam === 1 ? 'Falta só 1 peça para completar' : `Faltam ${faltam} peças para completar`) : null),
    c.total && c.itens.length ? faixaDeEscolhas(c) : null,
    c.total && c.itens.length ? araraDaColecao(c) : null,
    c.total ? el('section', { class: 'col-album' },
      el('h3', {}, 'Álbum', el('small', {}, `${c.tem} de ${c.total}`)),
      el('div', { class: 'col-album-grade' }, ...emOrdem(c.ids).map((id, _, todas) => casaDoAlbum(id, todas)))) : null,
    el('p', { class: 'col-det-efeito' }, ico('brilho'), ' Vestindo: ', c.efeito.texto,
      el('small', {}, ` (${textoDoBonus(c)})`)),
  ].filter(Boolean));
}

// A faixa de escolhas: um marco por degrau (3, 8, 18...). Cada degrau dá uma
// escolha livre de qualquer item da coleção; mostra até 5 em volta de onde você está.
function faixaDeEscolhas(c) {
  const meus = c.itens.filter(id => roupinha(id) && db.estadoDaRoupinha(roupinha(id)).liberada).length;
  const marcos = c.itens.map((_, k) => pecasParaEscolha(k, c.total, c.itens.length));
  const ganhas = marcos.filter(n => n <= c.tem).length;
  const proximo = marcos.find(n => n > c.tem);
  const atual = Math.max(0, marcos.findIndex(n => n > c.tem));
  const inicio = Math.max(0, Math.min(atual - 1, marcos.length - 5));
  const passos = [];
  marcos.slice(inicio, inicio + 5).forEach((n, j) => {
    const k = inicio + j;
    if (j > 0) passos.push(el('span', { class: 'col-trilha-liga' + (n <= c.tem ? ' cheia' : '') }));
    const usada = k < meus, livre = !usada && k < ganhas;
    const marco = el('span', { class: 'col-marco' + (usada ? ' meu' : livre ? ' presente' : ''),
      title: usada ? 'Escolha usada' : livre ? 'Escolha livre' : `${n} peças` });
    marco.replaceChildren(usada ? ico('ok') : emo(livre ? '🎁' : '🔒'));
    passos.push(el('span', { class: 'col-marco-casa' }, marco, el('small', {}, `${n} peças`)));
  });
  return el('section', { class: 'col-trilha' },
    el('div', { class: 'col-trilha-passos' }, ...passos),
    el('p', { class: 'col-trilha-texto' }, c.livres > 0
      ? [emo('🎁'), c.livres === 1 ? ' Você tem 1 escolha livre: leve qualquer item da arara.'
        : ` Você tem ${c.livres} escolhas livres: leve qualquer item da arara.`]
      : proximo ? `Mais ${proximo - c.tem} ${proximo - c.tem === 1 ? 'peça' : 'peças'} para a próxima escolha`
      : 'Todos os itens desta coleção são seus.'));
}

// A arara: todos os itens da coleção pendurados. Os seus aparecem coloridos; os
// que faltam são escolhidos com um toque (quando há escolha livre) e abrem no painel.
let itemSel = null;
function araraDaColecao(c) {
  const itens = c.itens.map(id => roupinha(id)).filter(Boolean);
  if (!itens.length) return null;
  const meu = r => db.estadoDaRoupinha(r).liberada;
  const faltam = itens.filter(r => !meu(r));
  const sel = faltam.find(r => r.id === itemSel) || faltam[0] || null;
  const cabides = itens.map(r => {
    const tem = meu(r);
    const arte = el('span', { class: 'col-cabide-arte' });
    arte.innerHTML = svgRoupinha(r, aparenciaAtual().corpo);
    const estado = tem ? 'tem' : c.livres > 0 ? 'livre' : 'falta';
    return el('button', { type: 'button',
      class: 'col-cabide ' + estado + (sel === r ? ' sel' : '')
        + (estado === 'livre' && novaNaVisita === c.id ? ' ponto-novo' : ''),
      disabled: tem, title: `${r.nome} · ${tem ? 'já é seu' : c.livres > 0 ? 'pode escolher' : 'ainda não'}`,
      'aria-label': r.nome,
      onclick: () => { itemSel = r.id; renderDetalhe(c); } },
      arte, el('span', { class: 'col-cabide-selo' }, tem ? ico('ok') : emo(c.livres > 0 ? '🎁' : '🔒')));
  });
  const painel = sel ? (() => {
    const arte = el('span', { class: 'col-painel-arte' });
    arte.innerHTML = svgRoupinha(sel, aparenciaAtual().corpo);
    return el('aside', { class: 'col-painel-item' }, arte, el('strong', {}, sel.nome),
      el('p', {}, c.livres > 0 ? custoDoItem() : 'Ainda sem escolha livre: veja o item e garimpe mais peças da coleção.'),
      c.livres > 0 ? el('button', { type: 'button', class: 'btn-dark', onclick: () => resgatarItem(c, sel.id, sel) }, 'Escolher este item')
        : el('button', { type: 'button', class: 'col-lupa-grande', onclick: () => verItemMaior(sel) }, emo('🔍'), ' Ver maior'));
  })() : el('aside', { class: 'col-painel-item' }, el('strong', {}, 'Coleção completa'), el('p', {}, 'Todos os itens são seus.'));
  return el('section', { class: 'col-arara' },
    el('div', { class: 'col-arara-rail' }, el('div', { class: 'col-arara-fio' }, ...cabides)), painel);
}

// O que levar o item custa, dito antes do toque.
function custoDoItem() {
  return 'Não gasta resgate: leve quando quiser.';
}

function resgatarItem(c, id, r) {
  if (!db.podeResgatarItem()) { toast('Seus resgates de hoje acabaram. O item fica separado no balcão até amanhã.'); return; }
  if (db.escolherItem(c.id, id)) toast(`${r.nome} resgatado: está no inventário.`, 'rare');
}

// O item trancado em tamanho grande, só para ver de perto.
function verItemMaior(r) {
  const arte = el('div', { class: 'col-item-grande' });
  arte.innerHTML = svgRoupinha(r, aparenciaAtual().corpo);
  mostrar(el('div', { class: 'col-item-grande-caixa' }, arte,
    el('p', {}, emo('🔒'), ' Ainda trancado. Junte peças desta coleção para escolher.')), { titulo: r.nome });
}

// Uma casa do álbum: a peça, ou a silhueta dela quando ainda falta.
function casaDoAlbum(id, ids) {
  const peca = pecaDoCatalogo(id);
  if (!peca) return null;
  const tem = db.temPeca(id);
  const rar = RARIDADE[peca.raridade];
  return el('div', {
    class: 'col-album-casa' + (tem ? ' tem' : ' falta'),
    title: tem ? `${nomeDaPeca(peca)} · ver no guarda-roupa` : `Falta: ${nomeDaPeca(peca)}${rar ? ` (${rar.nome.toLowerCase()})` : ''}`,
    onclick: tem ? () => abrirPecaNoCloset(id, ids) : null,
  },
    el('div', { class: 'peca-caixa', style: { '--esc': String(escalaGrade(peca)) } },
      el('img', { src: peca.src, alt: nomeDaPeca(peca), loading: 'lazy' })),
    !tem && rar ? el('span', { class: 'col-album-rar', style: { background: rar.cor || '' } }) : null);
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
      el('small', {}, tem ? [ico('ok'), ' No guarda-roupa'] : `Falta${rar ? ` · ${rar.nome.toLowerCase()}` : ''}`)));
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
      else if (pode) resgatarItem(c, id, r);
    },
  },
    arte,
    el('div', { class: 'col-item-info' },
      el('strong', {}, r.nome),
      el('small', {}, e.liberada ? [ico('ok'), ' No inventário'] : pode ? [emo('🎁'), ' Resgatar este'] : [emo('🔒'), ` ${e.rotulo}`])));
}

// Entrar pela navegação abre a lista; pelo emblema, a coleção dele.
export function aoEntrarNasColecoes() {
  novaNaVisita = null;
  aberta = paramAtual();
  const g = aberta && grupoDa(aberta);
  if (g) grupo = g;
  renderColecoes();
  if (aberta) $('.view-colecoes').scrollTop = 0;
}
