// Feed: o que os outros postaram, curtidas e comentários.
//
// Duas fontes, uma tela só:
//   * as publicações de contas de verdade — a sua e as dos amigos — vêm do
//     servidor (publicacoes.js → /api/feed). Curtir e comentar nelas também é
//     no servidor, então todo mundo vê a mesma coisa;
//   * os perfis de exemplo (PERFIS_MOCK) também postam no servidor: a nuvem
//     publica por eles de tempos em tempos (nuvem/lambda/gerador.py), com as
//     peças e uma semente; o desenho é feito aqui (prepararGerado).
//
// A tela é organizada em abas (Seguindo · Tudo), sempre com looks
// e colagens juntos. Abre no desfile: um look por tela, com as peças dele
// logo embaixo. O botão ao lado do ↻ troca para o mural: colunas em que cada
// card tem a altura da própria imagem, e passar o mouse mostra as peças.
// Um toque abre o look grande (abrirPostGrande); dois toques curtem.

import { PERFIS_MOCK, COMENTARIOS_MOCK, NOMES_LOOK_MOCK, COLLAB, RARIDADE } from './config.js';
import { catalogo, item as pecaDoCatalogo, nomeDaPeca, aplicarContorno } from './catalog.js';
import * as db from './db.js';
import { miniatura, miniaturaBoard, imagemDoFeed, imagemDoFeedColagem } from './render.js';
import { el, $, mulberry32, sementeDoTexto, shuffle, escolher, tempoRelativo, toast } from './util.js';
import { confirmar } from './janela.js';
import { ico, emo } from './icones.js';
import { aparenciaDoPerfil, aparenciaAtual, cabeca } from './avatar.js';
import { sortearConjunto, camadasParaAvatar, colagemAleatoria } from './sorteio.js';
import { abrirLook } from './stylist.js';
import { abrirBoard } from './board.js';
import { irPara, viewAtual, paramAtual } from './router.js';
// Protótipo do feed como vitrines: só pelo link #/social/vitrine-a|b|c.
import { renderVitrines } from './vitrines.js';
// Ciclo de propósito: o feed leva ao perfil de alguém e o perfil mostra os
// mesmos cards daqui. Os dois lados só se chamam em tempo de execução.
import { abrirGavetaDe, abrirFichaDePeca, gradeDePecas } from './usuario.js';
import { renderPessoas, atualizarPessoas } from './busca.js';
import { ehFicticio, seguirNoServidor, perfilDe, roupasDoPerfil } from './pessoas.js';
import {
  publicacoes, feedLidoEm, carregarFeed, aoMudarPublicacoes, apagarPublicacao, gerarNoServidor,
  temMaisNoFeed, carregarMaisFeed,
  curtirPublicacao, comentarPublicacao, apagarComentarioPublicado,
} from './publicacoes.js';
import { festejar } from './animacoes.js';
import { cascataDoFeed, pulsoCurtida } from './movimento.js';
import { contar as contarNoMural } from './mural.js';

// Curtida que conta (a primeira de cada post na semana) anda nas missões do
// dia, da semana e do mural.
const curtiu = (post) => { if (db.progredirMissao('curtir', 1, post.id) !== false) contarNoMural('curtir'); };

const sou = (id) => id === db.state.usuario.id;

// A sua cor no feed — o fundo do seu retrato nos posts e da moldura do avatar
// no seu perfil, como cada perfil fictício tem a dele em PERFIS_MOCK.
export const COR_PROPRIA = '#e8e2d8';

// Fictício ou conta real (o cartão veio junto com o feed ou da busca).
export const autorDe = (id) => sou(id)
  ? { nome: db.state.usuario.nome, handle: db.state.usuario.handle, cor: COR_PROPRIA }
  : perfilDe(id) || { id, nome: 'alguém', handle: '@?', cor: '#eee' };

// O personagem de quem assina o post — e a roupinha dele. O retrato é só a
// cabeça, sem moldura, então o que aparece aqui é chapéu e óculos.
const aparenciaDe = (id) => sou(id) ? aparenciaAtual() : aparenciaDoPerfil(autorDe(id));
const roupasDe = (id) => sou(id) ? db.roupasEquipadas() : roupasDoPerfil(autorDe(id));

export const retratoDe = (id, tamanho = 34) =>
  cabeca(aparenciaDe(id), tamanho, roupasDe(id));

// Clicar em quem assina abre o perfil: o seu é a tela de perfil de sempre;
// o dos outros sobe numa gaveta por cima do feed (fora do feed, a página
// pública inteira).
export const abrirAutor = (id) => sou(id) ? irPara('perfil') : abrirGavetaDe(id);

const ABAS = [
  ['seguindo', 'Seguindo', 'Você e quem você segue'],
  ['tudo', 'Tudo', 'Contas de verdade e perfis de exemplo'],
];

let aba = null;                           // na primeira entrada abre em Tudo
let expandidos = new Set();               // posts com a conversa aberta
const rascunhos = new Map();              // comentário meio escrito, por post

// O perfil público mostra os mesmos cards do feed. Curtir lá tem que acender o
// coração aqui (e vice-versa), então quem repinta avisa os interessados.
const ouvintes = new Set();
export const aoAtualizarFeed = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };
const avisar = () => ouvintes.forEach(fn => fn());
function repintar() {
  if (viewAtual() === 'social') renderFeed();
  else precarregarFeed();
  pintarPontinhoDoFeed();
  avisar();
}

// Pontinho vermelho no botão do Feed: saiu post de quem você segue depois da
// última vez que você abriu o feed. Com o feed aberto, o mais novo já conta
// como visto. Guarda a data do post (do servidor), não a do relógio daqui.
export function pintarPontinhoDoFeed() {
  const seguindo = db.state.usuario?.seguindo ?? [];
  const ultimo = todosOsPosts().find(p => !sou(p.autor) && seguindo.includes(p.autor))?.criadoEm;
  const visto = db.state.feedVistoEm;
  const novo = !!ultimo && (!visto || new Date(ultimo) > new Date(visto));
  if (novo && viewAtual() === 'social') {
    db.state.feedVistoEm = ultimo;
    db.salvar();
  }
  const tem = novo && viewAtual() !== 'social';
  for (const botao of document.querySelectorAll('[data-goto="social"]')) {
    botao.classList.toggle('tem-premio', tem);
  }
}
aoMudarPublicacoes(repintar);

// O look dos perfis fictícios sai do mesmo sorteio dos botões de gerar,
// só que tirando do acervo inteiro (menos a cápsula, que é conquistada).
export function lookAleatorio(rnd = Math.random) {
  return camadasParaAvatar(sortearConjunto(acervoParaLooks(), rnd));
}

// Quanto do feed é colagem em vez de look no avatar. As duas coisas são o
// que o app faz, então as duas aparecem no feed dos outros também.
const CHANCE_COLAGEM = 0.4;

// ======================= Posts dos perfis de exemplo ======================
async function criarPostFicticio(rnd = Math.random, idadeHoras = null, quem = null) {
  const autor = quem || escolher(PERFIS_MOCK, rnd);
  const pecas = sortearConjunto(acervoParaLooks(), rnd, { minimo: 5 });
  const horas = idadeHoras ?? (0.5 + rnd() * 90);

  const post = {
    id: 'p' + Math.random().toString(36).slice(2, 9),
    autor: autor.id,
    nome: escolher(NOMES_LOOK_MOCK, rnd),
    criadoEm: new Date(Date.now() - horas * 3600e3).toISOString(),
    curtidas: Math.floor(rnd() * 80),
    curtido: false,
    comentarios: [],
  };

  if (rnd() < CHANCE_COLAGEM) {
    // Colagem: a colagem inteira fica guardada no post — é o equivalente das
    // camadas, e é dela que o perfil da pessoa tira as peças que ela veste.
    // A assinatura é o @ de quem montou, como seria se ela tivesse montado.
    post.tipo = 'board';
    post.colagem = colagemAleatoria(pecas, rnd, {
      assinatura: { texto: autor.handle, visivel: true },
    });
    post.thumb = await miniaturaBoard(post.colagem);
  } else {
    // Look: renderizado no personagem de quem postou, não no seu.
    post.tipo = 'look';
    post.camadas = camadasParaAvatar(pecas);
    post.thumb = await miniatura(post.camadas, aparenciaDoPerfil(autor));
  }

  // Alguns já nascem com conversa.
  const quantos = rnd() < 0.55 ? 1 + Math.floor(rnd() * 3) : 0;
  const gente = shuffle(PERFIS_MOCK.filter(p => p.id !== autor.id), rnd);
  for (let i = 0; i < quantos; i++) {
    post.comentarios.push({
      id: 'c' + Math.random().toString(36).slice(2, 9),
      autor: gente[i % gente.length].id,
      texto: escolher(COMENTARIOS_MOCK, rnd),
      em: new Date(Date.now() - (horas - 0.2 * (i + 1)) * 3600e3).toISOString(),
    });
  }
  return post;
}

// Versão da semente: subindo o número, quem já tinha o feed antigo (só looks no
// avatar, antes das colagens) recebe o novo — sem perder o que você publicou.
const VERSAO_SEED = 6;

function acervoParaLooks() {
  return catalogo.itens.filter(i => !COLLAB.itens.includes(i.id));
}

// Versão 5: os perfis de exemplo passaram a postar no servidor, iguais para
// todo mundo. Os doze que cada navegador sorteava saem do save — ficam os seus.
// Versão 6: junto com a renovação dos posts de exemplo no servidor
// (VERSAO_POSTS em gerador.py), os de exemplo que ainda moravam no save saem.
async function semearFeed() {
  if (db.state.feedSemeado === VERSAO_SEED) return;
  db.state.feed = db.state.feed.filter(p => sou(p.autor));
  db.state.feedSemeado = VERSAO_SEED;
  db.salvar();
}

// O post que a nuvem gerou traz as peças e a semente, não a imagem: o look é
// vestido no personagem de quem postou, a colagem é montada com a semente
// (sempre a mesma, então todo mundo vê a mesma colagem). Sem o acervo ainda
// carregado, fica para o próximo desenho.
function prepararGerado(post) {
  if (!post.gerado || post.camadas?.length || post.colagem) return;
  const pecas = [...new Set(post.pecas || [])].map(pecaDoCatalogo).filter(Boolean);
  if (!pecas.length) return;
  if (post.tipo === 'board') {
    post.colagem = colagemAleatoria(pecas, mulberry32(post.semente || 1), {
      assinatura: { texto: autorDe(post.autor).handle, visivel: true },
    });
  } else {
    post.camadas = camadasParaAvatar(pecas);
  }
}

// Botão de teste: mais posts dos perfis de exemplo. Para o admin, a nuvem
// posta no feed de todo mundo; sem permissão (ou sem servidor), o jeito
// antigo, só neste navegador.
export async function gerarPostsFicticios(quantos = 3) {
  if (acervoParaLooks().length < 4) {
    return toast('Poucas peças no acervo para montar look. Adicione algumas primeiro.', 'aviso');
  }
  try {
    const feitos = await gerarNoServidor(quantos);
    return toast(`${feitos} posts novos no feed de todo mundo.`);
  } catch (e) {
    console.warn('gerador do servidor indisponível, gerando aqui.', e.message);
  }
  for (let i = 0; i < quantos; i++) {
    db.state.feed.unshift(await criarPostFicticio(Math.random, Math.random() * 6));
  }
  db.salvar();
  repintar();
  toast(`${quantos} posts novos no feed.`);
}

// Colagens de uma pessoa específica. O perfil público chama quando abre alguém
// que o sorteio do feed nunca escolheu: a semente é o id, então a pessoa tem
// sempre as mesmas colagens, e elas passam a existir no feed de todo mundo.
export async function gerarPostsDe(id, quantos = 2) {
  const quem = PERFIS_MOCK.find(p => p.id === id);
  if (!quem || acervoParaLooks().length < 4) return false;
  const rnd = mulberry32(sementeDoTexto(id));
  for (let i = 0; i < quantos; i++) {
    db.state.feed.push(await criarPostFicticio(rnd, 6 + i * 27, quem));
  }
  db.salvar();
  return true;
}

// ============================ Juntar as fontes ============================
const maisNovoPrimeiro = (a, b) => new Date(b.criadoEm) - new Date(a.criadoEm);

// Os do servidor e os do save. No save ficam os perfis de exemplo e, enquanto
// não sobem, os seus posts de antes do feed compartilhado.
export const todosOsPosts = () => [...publicacoes(), ...db.state.feed].sort(maisNovoPrimeiro);

export const postsDoAutor = (id) => todosOsPosts().filter(p => p.autor === id);

// As telas de perfil chamam ao abrir: o feed lido há pouco serve.
export function garantirFeed() {
  const lido = feedLidoEm();
  if (lido && Date.now() - lido < 30e3) return Promise.resolve(false);
  return carregarFeed();
}

// ================================= Feed ===================================
export async function montarSocial() {
  await semearFeed();
  if (!aba) aba = 'tudo';
  render();
  rolarAoAlvo();
  pintarPontinhoDoFeed();
  // Quem entrou no brechó desde a última vez aparece na coluna sem ninguém
  // digitar nada.
  atualizarPessoas();
  await atualizarFeed();
  rolarAoAlvo();
  postAlvo = null;
}

// Tocar num post do perfil leva ao feed, já nele (pedido do João,
// 30/10/2026): abre em Tudo, com o lote grande o bastante para o card estar
// lá, e rola até ele.
let postAlvo = null;
export function irAoPost(id) {
  postAlvo = id;
  aba = 'tudo';
  if (viewAtual() !== 'social') return irPara('social');
  render();                  // já no feed (a gaveta): só rola
  rolarAoAlvo();
  postAlvo = null;
}

function rolarAoAlvo() {
  if (!postAlvo) return;
  const card = $('#feed')?.querySelector(`.post[data-post="${CSS.escape(postAlvo)}"]`);
  card?.scrollIntoView({ block: modo === 'desfile' ? 'start' : 'center' });
}

async function atualizarFeed() {
  const botao = $('#feed-atualizar');
  botao?.classList.add('girando');
  const deu = await carregarFeed();
  botao?.classList.remove('girando');
  // Quando a leitura dá certo, o aviso de publicacoes.js já repintou o feed;
  // repintar de novo aqui era montar o mural inteiro duas vezes.
  if (!deu && viewAtual() === 'social') renderFeed();
}

// Voltar para a aba do navegador com o feed aberto traz o que saiu enquanto isso.
let ouvindoFoco = false;
function ouvirFoco() {
  if (ouvindoFoco) return;
  ouvindoFoco = true;
  window.addEventListener('focus', () => { if (viewAtual() === 'social') garantirFeed(); });
  // Janela mais larga ou mais estreita pode pedir outro número de colunas.
  window.addEventListener('resize', () => {
    if (viewAtual() !== 'social') return;
    if (modo === 'desfile') medirDesfile();
    else if (colunasDoMural($('#feed')) !== colunasDesenhadas) renderFeed();
  });
  $('#feed-atualizar')?.addEventListener('click', atualizarFeed);
  $('#feed-modo')?.addEventListener('click', trocarModo);
}

function render() {
  ouvirFoco();
  renderAbas();
  pintarBotaoModo();
  renderFeed();
  renderPessoas();
}

function postsVisiveis() {
  const seguindo = db.state.usuario.seguindo;
  return todosOsPosts().filter(p => {
    if (aba === 'seguindo') return sou(p.autor) || seguindo.includes(p.autor);
    return true;
  });
}

function renderAbas() {
  const caixa = $('#feed-abas');
  if (caixa) {
    caixa.replaceChildren(...ABAS.map(([id, rotulo, dica]) => el('button', {
      class: 'feed-aba' + (aba === id ? ' ativa' : ''),
      title: dica,
      onclick: () => { aba = id; mostrando = LOTE; render(); },
    }, rotulo)));
  }
}

// ================================= Mural ==================================
// As colunas são montadas aqui, e não com `columns` do CSS: assim o post mais
// novo fica no alto à esquerda e abrir os comentários de um card só alonga a
// coluna dele, sem embaralhar o mural inteiro.
// Quantas colunas a tela pede: 2 no celular, 3 no PC e 4 a partir de 1280px.
// A largura mínima só entra para a coluna não ficar estreita demais para o
// rodapé do card (janela de PC pequena, com as duas barras laterais).
const TELA_LARGA = window.matchMedia('(min-width: 1280px)');
const LARGURA_MIN_COLUNA = 170;
// No celular (css/mobile.css) o card pode ser bem mais estreito: duas colunas
// de ~170px leem melhor que uma só, gigante, com um post por tela.
const LARGURA_MIN_COLUNA_CELULAR = 150;
const VAO_MURAL = 18;                     // o mesmo gap de .mural em social.css
const celular = window.matchMedia('(max-width: 900px)');
let colunasDesenhadas = 0;

function colunasDoMural(caixa) {
  const pedidas = celular.matches ? 2 : TELA_LARGA.matches ? 4 : 3;
  const largura = caixa?.clientWidth || 0;
  if (!largura) return pedidas;
  const minima = celular.matches ? LARGURA_MIN_COLUNA_CELULAR : LARGURA_MIN_COLUNA;
  const cabem = Math.floor((largura + VAO_MURAL) / (minima + VAO_MURAL));
  return Math.max(1, Math.min(pedidas, cabem));
}

// As colunas pares começam mais abaixo (o ::before de .mural-coluna em
// social.css, 0,35 da largura, mais o gap). Sem isso, um feed só de looks —
// todos 3:5 — vira uma grade de linhas alinhadas, e o mural perde o desencontro.
const DESNIVEL_COLUNA_PAR = 0.45;

// Altura da imagem em larguras de coluna, antes de ela carregar: o look é a
// miniatura 3:5 do render, a colagem é 4:5 (ou 9:16).
const proporcaoDaImagem = (post) => post.tipo === 'board'
  ? (post.colagem?.formato === '9:16' ? 16 / 9 : 5 / 4)
  : 5 / 3;

// O card inteiro: a imagem e o rodapé, que soma um pouco.
const alturaEstimada = (post) => proporcaoDaImagem(post) + 0.16;

function montarMural(colunas) {
  const cols = Array.from({ length: colunas }, (_, i) => ({
    altura: i % 2 ? DESNIVEL_COLUNA_PAR : 0, no: el('div', { class: 'mural-coluna' }),
  }));
  return { cols, no: el('div', { class: 'mural' }, ...cols.map(c => c.no)) };
}

function porNoMural({ cols }, posts) {
  for (const post of posts) {
    const c = cols.reduce((a, b) => (b.altura < a.altura ? b : a));
    c.no.append(cardDoPost(post));
    c.altura += alturaEstimada(post);
  }
}

// O desfile não tem colunas: os cards entram um embaixo do outro.
function porNoFeed(m, posts) {
  if (m.cols) porNoMural(m, posts);
  else m.no.append(...posts.map(cardDoDesfile));
}

// O mural não monta os 120 cards de uma vez: cada card tem dois retratos (SVG
// com máscara, medido na tela) e as peças por cima, e montar tudo a cada
// curtida travava a rolagem. Entra um lote, e o próximo quando a rolagem
// chega perto do fim. Repintar (curtida, comentário) mantém quantos já
// estavam à vista, para a rolagem não voltar para o alto.
const LOTE = 18;
let mostrando = LOTE;
let muralAtual = null;                   // { cols, no, posts, feitos, fim }
let vigiaDoFim = null;

function vigiarFim(fim) {
  vigiaDoFim?.disconnect();
  vigiaDoFim = null;
  if (!fim || !('IntersectionObserver' in window)) return;
  vigiaDoFim = new IntersectionObserver(entradas => {
    if (entradas.some(e => e.isIntersecting)) mostrarMais();
  }, { root: caixaQueRola(fim), rootMargin: '1200px 0px' });
  vigiaDoFim.observe(fim);
}

function mostrarMais() {
  const m = muralAtual;
  if (!m?.no.isConnected) return;
  // Acabou o que já veio: pede a página seguinte ao servidor. Quando ela
  // chega, o aviso de publicacoes.js repinta o mural com os novos no fim.
  if (m.feitos >= m.posts.length) { if (temMaisNoFeed()) carregarMaisFeed(); return; }
  porNoFeed(m, m.posts.slice(m.feitos, m.feitos + LOTE));
  m.feitos = Math.min(m.posts.length, m.feitos + LOTE);
  mostrando = m.feitos;
  cascataDoFeed($('#feed'));
  if (m.feitos >= m.posts.length && !temMaisNoFeed()) {
    m.fim.remove();
    vigiarFim(null);
  } else {
    // O vigia só avisa quando muda: se o fim continua perto, observa de novo
    // para ele avisar outra vez.
    vigiaDoFim?.unobserve(m.fim);
    vigiaDoFim?.observe(m.fim);
  }
}

function renderFeed() {
  const feed = $('#feed');
  if (!feed) return;
  // Uma resposta do servidor (a curtida, o feed atualizado) pode chegar com
  // alguém escrevendo um comentário: o campo é refeito, mas o foco volta.
  const escrevendo = document.activeElement?.dataset?.post;
  const posts = postsVisiveis();
  const u = db.state.usuario;

  $('#feed-sub').textContent =
    `${posts.length} ${posts.length === 1 ? 'publicação' : 'publicações'} · ` +
    `seguindo ${u.seguindo.length}`;

  const lido = feedLidoEm();
  const estado = $('#feed-estado');
  if (estado) {
    estado.textContent = lido
      ? `atualizado ${tempoRelativo(lido.toISOString())}`
      : 'sem conexão — mostrando só o deste navegador';
    estado.classList.toggle('offline', !lido);
  }

  $('.view-social')?.classList.toggle('em-desfile',
    modo === 'desfile' && posts.length > 0 && !/^vitrine-/.test(paramAtual() || ''));
  if (modo === 'desfile') medirDesfile();

  if (!posts.length) {
    feed.replaceChildren(el('div', { class: 'feed-vazio' }, ...mensagemVazia()));
    return;
  }

  const prototipo = /^vitrine-([abc])$/.exec(paramAtual() || '')?.[1];
  if (prototipo) {
    feed.replaceChildren(renderVitrines(posts, prototipo, renderFeed));
    return;
  }

  let mural;
  if (modo === 'desfile') mural = { no: el('div', { class: 'desfile' }) };
  else {
    colunasDesenhadas = colunasDoMural(feed);
    mural = montarMural(colunasDesenhadas);
  }
  if (postAlvo) mostrando = Math.max(mostrando, posts.findIndex(p => p.id === postAlvo) + 1);
  const feitos = Math.min(posts.length, Math.max(mostrando, LOTE));
  porNoFeed(mural, posts.slice(0, feitos));
  const fim = feitos < posts.length || temMaisNoFeed()
    ? el('div', { class: 'mural-fim', 'aria-hidden': 'true' }) : null;
  muralAtual = { ...mural, posts, feitos, fim };
  feed.replaceChildren(mural.no, ...(fim ? [fim] : []));
  vigiarFim(fim);
  cascataDoFeed(feed);

  if (escrevendo) {
    const campo = feed.querySelector(`.campo-comentario[data-post="${CSS.escape(escrevendo)}"]`);
    campo?.focus();
    campo?.setSelectionRange(campo.value.length, campo.value.length);
  }
}

function mensagemVazia() {
  const u = db.state.usuario;
  const ir = (rotulo, destino) => el('button', {
    class: 'link-btn', onclick: () => { aba = destino; mostrando = LOTE; render(); },
  }, rotulo);

  if (aba === 'seguindo') {
    return u.seguindo.length
      ? ['Quem você segue ainda não publicou nada por aqui. ', ir('Ver tudo', 'tudo')]
      : ['Você ainda não segue ninguém. Siga alguém na coluna ao lado ou ', ir('veja tudo', 'tudo'), '.'];
  }
  return [acervoParaLooks().length < 4
    ? 'Sem peças no acervo ainda — os perfis de exemplo só postam quando houver roupa para vestir.'
    : 'Feed vazio. Publique um look no Stylist para começar.'];
}


// ================================ Desfile =================================
// O feed como uma passarela: um look por tela, que ocupa a tela inteira e
// se rola para o próximo. Em cima, quem postou; no meio, o look inteiro (um
// toque abre o post, dois curtem); embaixo, quem curtiu e a conversa. As
// peças usadas só aparecem no post aberto. No desfile a coluna "Quem seguir"
// sai da tela (.em-desfile em social.css); no mural ela volta.
// O mural continua a um toque (#feed-modo); a escolha fica neste navegador.
const CHAVE_MODO = 'brecho-feed-modo';
const COMENTARIOS_NO_DESFILE = 2;
let modo = lerModo();

function lerModo() {
  try { return localStorage.getItem(CHAVE_MODO) === 'mural' ? 'mural' : 'desfile'; }
  catch { return 'desfile'; }
}

function trocarModo() {
  modo = modo === 'desfile' ? 'mural' : 'desfile';
  try { localStorage.setItem(CHAVE_MODO, modo); } catch {}
  mostrando = LOTE;
  pintarBotaoModo();
  renderFeed();
  $('#feed')?.scrollIntoView({ block: 'start' });
}

// O botão mostra para onde ele leva, não onde você está.
function pintarBotaoModo() {
  const botao = $('#feed-modo');
  if (!botao) return;
  const vaiPara = modo === 'desfile' ? 'mural' : 'desfile';
  const rotulo = vaiPara === 'mural' ? 'Ver em mural' : 'Ver em desfile, um look por tela';
  botao.title = rotulo;
  botao.setAttribute('aria-label', rotulo);
  botao.replaceChildren(ico(vaiPara === 'mural' ? 'grade' : 'quadro'));
}

function cardDoDesfile(post) {
  const meu = sou(post.autor);
  const segue = db.state.usuario.seguindo.includes(post.autor);
  post.comentarios ??= [];
  prepararGerado(post);
  const autor = autorDe(post.autor);
  const n = post.comentarios.length;
  const abrirConversa = (e) => { e?.stopPropagation(); focarEm = post.id; abrirPostGrande(post.id); };

  return el('article', { class: 'post desfile-post' + (meu ? ' meu' : ''), dataset: { post: post.id } },
    el('header', { class: 'desfile-topo' },
      el('button', {
        class: 'autor-link', title: `Ver o perfil de ${autor.nome}`, onclick: () => abrirAutor(post.autor),
      }, retratoDe(post.autor, 36)),
      el('div', { class: 'post-autor' },
        el('strong', {}, el('button', { class: 'autor-link nome', onclick: () => abrirAutor(post.autor) }, autor.nome)),
        el('small', {}, `${post.nome} · ${tempoCurto(post.criadoEm)}`)),
      meu || segue ? null : el('button', { class: 'btn-seguir mini', onclick: () => alternarSeguir(post.autor) }, 'seguir'),
      el('button', {
        class: 'post-mais', title: 'Mais opções', onclick: (e) => menuDoPost(post, e.currentTarget),
      }, ico('mais'))),
    el('div', {
      class: 'post-thumb desfile-foto abrivel' + (post.tipo === 'board' ? ' colagem' : ''),
      onclick: (e) => tocarNaImagem(post, e),
    },
      post.thumb || post.gerado ? imagemDoPost(post) : el('div', { class: 'sem-thumb' }, 'sem prévia'),
      el('div', { class: 'desfile-lado' },
        botaoCurtir(post),
        el('button', { class: 'desfile-comentar', title: 'Comentários', onclick: abrirConversa },
          ico('balao'), n ? el('span', {}, String(n)) : null))),
    el('div', { class: 'desfile-info' },
      quemCurtiu(post),
      el('div', { class: 'desfile-conversa' },
        ...post.comentarios.slice(-COMENTARIOS_NO_DESFILE).map(c => el('p', {},
          el('button', { class: 'autor-link nome forte', onclick: () => abrirAutor(c.autor) }, autorDe(c.autor).nome),
          ' ', c.texto)),
        el('button', { class: 'link-btn', onclick: abrirConversa },
          n > COMENTARIOS_NO_DESFILE ? `ver os ${n} comentários` : n ? 'responder' : 'comentar'))));
}

// Cada look tem a altura da caixa que rola (no PC é .feed-wrapper, no celular
// a tela do feed, acima da barra de baixo): medida aqui, porque nenhuma unidade
// do CSS sabe a altura dessa caixa.
function medirDesfile() {
  const feed = $('#feed');
  const caixa = feed && caixaQueRola(feed);
  if (caixa?.clientHeight) feed.style.setProperty('--altura-desfile', caixa.clientHeight + 'px');
}

// ================================ O card ==================================
// A imagem manda: o card tem a altura dela. Por cima, o coração (curtir) e,
// passando o mouse, as peças usadas. Embaixo, quem postou, comentários e o menu.
// O card no mural é só o look: o retrato de quem postou no canto de cima à
// esquerda da imagem, o coração no da direita e, embaixo, quem curtiu. O
// resto (nome, tempo, comentários, o menu) fica no look aberto: um toque na
// imagem abre (abrirPostGrande), dois curtem, como no Instagram. Número zero
// não aparece: um mural cheio de "0" parece vazio. `abrivel: false` é o card
// já aberto num modal (perfil de alguém): aí ele vem inteiro, com o topo.
export function cardDoPost(post, { abrivel = true } = {}) {
  const meu = sou(post.autor);
  post.comentarios ??= [];
  prepararGerado(post);
  const pecas = pecasDoPost(post);

  return el('article', { class: 'post' + (meu ? ' meu' : ''), dataset: { post: post.id } },
    abrivel ? null : topoDoPost(post),
    el('div', {
      class: 'post-thumb' + (post.tipo === 'board' ? ' colagem' : '') + (abrivel ? ' abrivel' : ''),
      onclick: abrivel ? (e) => tocarNaImagem(post, e) : null,
    },
      post.thumb || post.gerado
        ? imagemDoPost(post)
        : el('div', { class: 'sem-thumb' }, 'sem prévia'),
      abrivel ? retratoNaImagem(post) : null,
      botaoCurtir(post),
      pecasPorCima(post, pecas)
    ),
    quemCurtiu(post),
    abrivel ? null : thread(post)
  );
}

function retratoNaImagem(post) {
  const autor = autorDe(post.autor);
  return el('button', {
    class: 'autor-link post-retrato post-retrato-img', title: `Ver o perfil de ${autor.nome}`,
    onclick: () => abrirAutor(post.autor),
  }, retratoDe(post.autor, 30),
    sou(post.autor) ? el('span', { class: 'post-nivel', title: `Nível ${db.nivel()}` }, String(db.nivel())) : null);
}

// "8h" no lugar de "há 8 h": no card de 160px do celular o "há" quebrava a
// linha em três.
const tempoCurto = (iso) => tempoRelativo(iso).replace(/^há /, '').replace(/ (min|h|d)$/, '$1');

function topoDoPost(post) {
  const meu = sou(post.autor);
  const autor = autorDe(post.autor);
  const segue = db.state.usuario.seguindo.includes(post.autor);
  const n = post.comentarios.length;
  return el('header', { class: 'post-pe post-topo' },
    // O nível é um selinho no retrato, não um chip solto ao lado do nome.
    el('button', {
      class: 'autor-link post-retrato', title: `Ver o perfil de ${autor.nome}`,
      onclick: () => abrirAutor(post.autor),
    }, retratoDe(post.autor, 28), meu ? el('span', { class: 'post-nivel', title: `Nível ${db.nivel()}` }, String(db.nivel())) : null),
    el('div', { class: 'post-autor' },
      el('strong', {},
        el('button', {
          class: 'autor-link nome', title: autor.handle,
          onclick: () => abrirAutor(post.autor),
        }, autor.nome)),
      el('small', { title: tempoRelativo(post.criadoEm) }, tempoCurto(post.criadoEm))
    ),
    // Seguir só aparece para quem você ainda não segue: deixar de seguir
    // fica no perfil da pessoa e na coluna ao lado.
    meu || segue ? null : el('button', {
      class: 'btn-seguir mini',
      onclick: () => alternarSeguir(post.autor),
    }, 'seguir'),
    el('button', {
      class: 'comentar-btn' + (expandidos.has(post.id) ? ' on' : ''),
      title: 'Comentários',
      onclick: () => alternarThread(post),
    }, emo('💬'), n ? el('span', {}, String(n)) : null),
    el('button', {
      class: 'post-mais', title: 'Mais opções',
      onclick: (e) => menuDoPost(post, e.currentTarget),
    }, ico('mais'))
  );
}

function botaoCurtir(post) {
  return el('button', {
    class: 'curtir' + (post.curtido ? ' on' : ''),
    title: post.curtido ? 'Descurtir' : 'Curtir',
    onclick: (e) => { e.stopPropagation(); alternarCurtida(post, e.currentTarget); },
  }, ico(post.curtido ? 'coracao-cheio' : 'coracao'), post.curtidas ? el('span', {}, String(post.curtidas)) : null);
}

// "♥ Rafa e mais 2": um rosto vale mais que um número. Só existe para os
// posts do servidor, que trazem quem curtiu (os de exemplo só têm a conta).
function quemCurtiu(post, { completo = false } = {}) {
  const outros = (post.curtiram || []).filter(id => !sou(id) && podeMostrar(id));
  if (!outros.length || !post.curtidas) return null;
  const primeiro = outros[0];
  const resto = post.curtidas - 1;
  return el('p', { class: 'post-curtiram' + (completo ? ' completo' : '') },
    completo ? null : el('span', { class: 'post-curtiram-ico' }, ico('coracao-cheio')),
    retratoDe(primeiro, 16),
    el('span', {},
      completo ? 'curtido por ' : '',
      el('button', { class: 'autor-link nome forte', onclick: () => abrirAutor(primeiro) }, autorDe(primeiro).nome),
      resto > 0 ? ` e mais ${resto}` : ''));
}

const podeMostrar = (id) => Boolean(perfilDe(id));

// Um toque espera um instante para ver se vem o segundo: dois toques curtem
// (e só curtem — como no Instagram, não descurtem), um só abre o look.
const TOQUE_DUPLO = 280;
let toque = null;

function tocarNaImagem(post, e, umToque = () => abrirPostGrande(post.id)) {
  if (e.target.closest('button, a, input')) return;
  const thumb = e.currentTarget;
  if (toque?.id === post.id) {
    clearTimeout(toque.timer);
    toque = null;
    estourarCoracao(thumb);
    if (!post.curtido) alternarCurtida(post, thumb.querySelector('.curtir'));
    return;
  }
  if (toque) clearTimeout(toque.timer);
  toque = { id: post.id, timer: setTimeout(() => { toque = null; umToque?.(); }, TOQUE_DUPLO) };
}

// O coração grande que estoura no meio da imagem. Mora no body, por cima:
// curtir repinta o feed e a imagem de baixo é trocada no meio da animação.
function estourarCoracao(alvo) {
  navigator.vibrate?.(12);
  const r = alvo.getBoundingClientRect();
  const c = el('span', { class: 'coracao-estouro', 'aria-hidden': 'true' }, ico('coracao-cheio'));
  Object.assign(c.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` });
  document.body.append(c);
  c.addEventListener('animationend', () => c.remove());
  setTimeout(() => c.remove(), 1200);
}

// ============================ Imagem do post ==============================
// O post guardado no save traz a miniatura pequena: a grande não caberia no
// localStorage. Quando o post tem com o que desenhar (as camadas do look ou a
// colagem — os dos perfis de exemplo e os seus de antes do servidor), a imagem
// no tamanho do feed é feita aqui, uma vez por post, e fica só na memória. O
// card abre com a miniatura e troca quando a grande fica pronta: a proporção é
// a mesma, então nada pula no mural. Post do servidor já vem grande.
//
// O look é sempre desenhado no personagem de agora de quem postou: trocou o
// cabelo, os posts antigos acompanham. Por isso a aparência entra na chave.
// Post do servidor traz as camadas desde que elas passaram a subir junto; o
// seu de antes disso usa o look salvo de origem, se ainda tem as mesmas peças.
//
// Desenhar é caro (canvas + webp), e o feed traz até 120 posts — os dos perfis
// de exemplo nem têm imagem, são todos desenhados aqui. Desenhar todos de uma
// vez, ao abrir o feed, travava a tela (no celular, por segundos). Agora cada
// imagem só é desenhada quando o card chega perto da tela, e uma de cada vez
// (filaDeDesenho), com um respiro entre elas para a rolagem não engasgar.
//
// A chave leva a versão do post (o caminho da imagem do servidor muda quando o
// dono edita): sem ela, o post editado continuava com o desenho antigo até
// recarregar a página.
const imagensGrandes = new Map();        // chave → Promise<dataURL | null>
const imagensProntas = new Map();        // chave → dataURL, para repintar sem piscar

const fila = [];
let desenhando = false;
function filaDeDesenho(desenhar) {
  return new Promise(pronto => {
    fila.push(() => desenhar().then(pronto, () => pronto(null)));
    andarFila();
  });
}
async function andarFila() {
  if (desenhando) return;
  desenhando = true;
  while (fila.length) {
    // Fora do feed (o pré-carregamento), só desenha quando a tela está à toa,
    // para não engasgar a loja ou o closet.
    if (viewAtual() !== 'social') await quandoAToa();
    await fila.shift()();
    await new Promise(r => setTimeout(r, 0));
  }
  desenhando = false;
}

const quandoAToa = () => new Promise(r => window.requestIdleCallback
  ? requestIdleCallback(() => r(), { timeout: 1500 })
  : setTimeout(r, 50));

// ============================ Pré-carregar ================================
// Os posts que aparecem primeiro quando você abre o feed já ficam prontos
// antes: assim que a leitura do feed chega (avisos.js lê no boot), as imagens
// do primeiro lote entram na fila de desenho, e as do servidor são baixadas.
// Abrir o feed depois mostra tudo na hora, sem a imagem surgir aos poucos.
const baixadas = new Map();              // caminho → Image, para o cache não soltar

export function precarregarFeed() {
  if (!aba) aba = 'tudo';
  for (const post of postsVisiveis().slice(0, LOTE)) {
    post.comentarios ??= [];
    prepararGerado(post);
    const desenho = desenhoDoPost(post);
    if (desenho) imagemGrande(desenho);
    // A colagem do servidor aparece com a imagem dele enquanto é redesenhada;
    // o look, só depois do desenho.
    const thumb = String(post.thumb || '');
    if (thumb && !thumb.startsWith('data:') && (!desenho || post.tipo === 'board') && !baixadas.has(thumb)) {
      const img = new Image();
      img.decoding = 'async';
      img.src = thumb;
      baixadas.set(thumb, img);
    }
  }
}

// O caminho da imagem no site (assets/posts/<id>-<hash>.webp) muda a cada
// edição; a miniatura em data URL dos posts do save não entra (é enorme e não
// muda).
const versaoDoPost = (post) => String(post.thumb || '').startsWith('data:') ? '' : (post.thumb || '');

function camadasDoPost(post) {
  if (post.camadas?.length) return post.camadas;
  if (!sou(post.autor) || !post.lookId) return null;
  const look = db.state.looks.find(l => l.id === post.lookId);
  if (!look?.camadas?.length) return null;
  const mesmas = (a, b) => a.length === b.length && a.every(id => b.includes(id));
  const doLook = [...new Set(look.camadas.map(c => c.itemId))];
  return mesmas(doLook, [...new Set(post.pecas || [])]) ? look.camadas : null;
}

// O que desenhar para este post, sem desenhar ainda: { chave, desenhar } ou null.
function desenhoDoPost(post) {
  if (post.colagem?.itens?.length) {
    const colagem = post.colagem;
    return { chave: post.id + '|' + versaoDoPost(post), desenhar: () => imagemDoFeedColagem(colagem) };
  }
  const camadas = camadasDoPost(post);
  if (!camadas) return null;
  const aparencia = aparenciaDe(post.autor);
  return {
    chave: post.id + '|' + versaoDoPost(post) + '|' + JSON.stringify(aparencia),
    desenhar: () => imagemDoFeed(camadas, aparencia),
  };
}

function imagemGrande({ chave, desenhar }) {
  if (!imagensGrandes.has(chave)) {
    imagensGrandes.set(chave, filaDeDesenho(desenhar).then(url => {
      if (url) imagensProntas.set(chave, url);
      return url;
    }));
  }
  return imagensGrandes.get(chave);
}

// Avisa quando a imagem está a uma tela de distância, e aí ela entra na fila.
// A margem tem de ser medida na caixa que rola (no PC é .feed-wrapper, no
// celular outra), senão a imagem só entra na fila quando já está à vista:
// um vigia por caixa que rola.
const aoChegarPerto = new WeakMap();
const vigias = new Map();                // caixa que rola (ou null) → vigia
const DISTANCIA = '700px 0px';

function caixaQueRola(no) {
  for (let p = no.parentElement; p && p !== document.body; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

function vigiaDe(raiz) {
  if (!vigias.has(raiz)) {
    const vigia = new IntersectionObserver(entradas => entradas.forEach(e => {
      if (!e.isIntersecting) return;
      vigia.unobserve(e.target);
      const fazer = aoChegarPerto.get(e.target);
      aoChegarPerto.delete(e.target);
      fazer?.();
    }), { root: raiz, rootMargin: DISTANCIA });
    vigias.set(raiz, vigia);
  }
  return vigias.get(raiz);
}

// O card é montado fora da página e só depois entra: espera o próximo quadro
// para saber em que caixa ele está. Card que não entrou em alguns quadros foi
// jogado fora (o feed repintou) e sai da espera.
let esperando = [];
function quandoPerto(no, fazer) {
  if (!('IntersectionObserver' in window)) return fazer();
  aoChegarPerto.set(no, fazer);
  esperar(no, 10);
}

function esperar(no, quadros) {
  esperando.push([no, quadros]);
  if (esperando.length === 1) requestAnimationFrame(observarEsperando);
}

function observarEsperando() {
  const lote = esperando;
  esperando = [];
  const raizes = new Map();              // o mural → a caixa que rola
  for (const [n, quadros] of lote) {
    if (!aoChegarPerto.has(n)) continue;
    if (!n.isConnected) {
      if (quadros > 0) esperar(n, quadros - 1);
      else aoChegarPerto.delete(n);
      continue;
    }
    const grupo = n.closest('.mural') || n.parentElement;
    if (!raizes.has(grupo)) raizes.set(grupo, caixaQueRola(n));
    vigiaDe(raizes.get(grupo)).observe(n);
  }
}

export function imagemDoPost(post) {
  // width/height só guardam o lugar enquanto a imagem não chega (o card não
  // nasce achatado e o mural não pula); carregada, vale a proporção dela.
  const img = el('img', {
    src: post.thumb || null, alt: post.nome, loading: 'lazy',
    width: 300, height: Math.round(300 * proporcaoDaImagem(post)),
  });
  const desenho = desenhoDoPost(post);
  if (!desenho) return img;
  // Já desenhada antes (o feed repintou por uma curtida, por exemplo): na hora.
  const pronta = imagensProntas.get(desenho.chave);
  if (pronta) {
    img.src = pronta;
    return img;
  }
  // O look redesenhado não mostra antes a imagem do dia: seria o personagem
  // de antes piscando. Se o desenho falhar, ela volta.
  if (post.tipo !== 'board' || !post.thumb) img.style.visibility = 'hidden';
  quandoPerto(img, () => imagemGrande(desenho).then(url => {
    if (url) img.src = url;
    img.style.visibility = '';
  }));
  return img;
}

// ============================ Peças do post ===============================
// Post publicado no servidor traz a lista de ids; o dos perfis de exemplo tem
// as camadas do look ou os itens da colagem. Peça que saiu do acervo some.
function pecasDoPost(post) {
  const ids = post.pecas || (post.camadas || post.colagem?.itens || []).map(c => c.itemId);
  return [...new Set(ids)].map(pecaDoCatalogo).filter(Boolean);
}

const raridadeDaPeca = (p) =>
  RARIDADE[p.raridade] || RARIDADE[db.raridadesFixas.get(p.id)] || RARIDADE.common;

const PECAS_POR_CIMA = 6;

function pecasPorCima(post, pecas) {
  if (!pecas.length) return null;
  const tem = pecas.filter(p => db.temPeca(p.id)).length;
  const sobra = pecas.length - PECAS_POR_CIMA;
  return el('div', { class: 'post-pecas' },
    el('strong', { class: 'post-titulo' }, post.nome),
    el('div', { class: 'post-pecas-lista' },
      ...pecas.slice(0, PECAS_POR_CIMA).map(pecaMini),
      sobra > 0 ? el('span', { class: 'peca-mini mais' }, `+${sobra}`) : null),
    el('small', {}, tem
      ? ['você tem ', el('b', {}, `${tem} de ${pecas.length}`), ' peças']
      : `${pecas.length} ${pecas.length === 1 ? 'peça' : 'peças'} do brechó`));
}

function pecaMini(p) {
  const r = raridadeDaPeca(p);
  const tenho = db.temPeca(p.id);
  const img = el('img', { src: p.src, alt: '', loading: 'lazy' });
  aplicarContorno(img, p);
  return el('span', {
    class: 'peca-mini' + (tenho ? ' tenho' : ''),
    title: `${nomeDaPeca(p)} · ${r.nome}${tenho ? ' · você tem' : ''}`,
    style: { '--rar-cor': r.cor, '--rar-bg': r.bg },
  }, img);
}

// ============================== Comentários ===============================
// Fechada, a conversa é só o contador no rodapé do card. Aberta, é a lista
// inteira e o campo, logo abaixo — a coluna do mural alonga, as outras não.
function thread(post) {
  if (!expandidos.has(post.id)) return null;
  const caixa = el('div', { class: 'post-thread aberta' });

  for (const c of post.comentarios) {
    const a = autorDe(c.autor);
    const podeApagar = sou(c.autor) || (post.real && sou(post.autor));
    caixa.append(el('p', { class: 'comentario' },
      el('button', {
        class: 'autor-link nome forte',
        style: { color: sou(c.autor) ? 'var(--tinta)' : 'inherit' },
        onclick: () => abrirAutor(c.autor),
      }, a.nome),
      ' ', c.texto,
      el('small', {}, tempoRelativo(c.em)),
      podeApagar
        ? el('button', {
            class: 'apagar-com', title: 'Apagar',
            onclick: () => apagarComentario(post, c),
          }, ico('x'))
        : null
    ));
  }

  const campo = el('input', {
    type: 'text', class: 'campo-comentario',
    dataset: { post: post.id },
    placeholder: 'escreva um comentário…', maxlength: '140',
    value: rascunhos.get(post.id) || '',
    oninput: (e) => rascunhos.set(post.id, e.target.value),
    onkeydown: (e) => { if (e.key === 'Enter') enviar(); },
  });
  const enviar = () => comentar(post, campo);

  caixa.append(el('div', { class: 'comentar-linha' },
    campo,
    el('button', { class: 'enviar-com', onclick: enviar }, 'enviar')
  ));
  // Abriu agora: o cursor já vai para o campo.
  if (post.id === focarEm) { focarEm = null; requestAnimationFrame(() => campo.focus()); }

  return caixa;
}

let focarEm = null;

async function comentar(post, campo) {
  const limpo = (campo.value || '').trim();
  if (!limpo) return;
  campo.disabled = true;

  if (post.real) {
    try {
      await comentarPublicacao(post, limpo);
      rascunhos.delete(post.id);
    } catch (e) {
      campo.disabled = false;
      return toast(e.message || 'Não consegui comentar agora.', 'aviso');
    }
  } else {
    post.comentarios ??= [];
    post.comentarios.push({
      id: 'c' + Math.random().toString(36).slice(2, 9),
      autor: db.state.usuario.id,
      texto: limpo,
      em: new Date().toISOString(),
    });
    rascunhos.delete(post.id);
    db.salvar();
  }
  // Comentado no look aberto: a conversa não abre também no card do mural.
  if (!campo.closest('#modal-look')) expandidos.add(post.id);
  focarEm = post.id;
  repintar();
}

async function apagarComentario(post, c) {
  if (post.real) {
    try { await apagarComentarioPublicado(post, c.id); }
    catch (e) { toast(e.message || 'Não consegui apagar agora.', 'aviso'); }
    return;
  }
  post.comentarios = post.comentarios.filter(x => x.id !== c.id);
  db.salvar();
  repintar();
}

function alternarThread(post) {
  if (expandidos.has(post.id)) expandidos.delete(post.id);
  else { expandidos.add(post.id); focarEm = post.id; }
  repintar();
}

export async function alternarCurtida(post, botao) {
  // Curtir o look de outra pessoa conta para a missão da semana (uma vez por post).
  const conta = !post.curtido && !sou(post.autor);
  const antes = post.curtidas;
  const liberando = !post.curtido;
  const pulsar = (de, ate) => pulsoCurtida(
    document.querySelector(`.post[data-post="${CSS.escape(post.id)}"] .curtir`), de, ate);
  if (!post.curtido) festejar(botao, 'coracao');
  if (post.real) {
    try { await curtirPublicacao(post); }
    catch (e) { return toast(e.message || 'Não consegui curtir agora.', 'aviso'); }
    if (conta) { curtiu(post); db.salvar(); }
    pulsar(antes, antes + (liberando ? 1 : -1));
    return;
  }
  post.curtido = !post.curtido;
  post.curtidas = Math.max(0, post.curtidas + (post.curtido ? 1 : -1));
  if (conta) curtiu(post);
  db.salvar();
  repintar();
  pulsar(antes, post.curtidas);
}

// ============================ O menu do post ==============================
// Tudo o que não é curtir e comentar mora aqui: editar e apagar (os seus),
// e baixar a imagem.
function menuDoPost(post, botao) {
  fecharMenu();
  const meu = sou(post.autor);
  const item = (rotulo, cor, acao, classe = '') => el('button', {
    class: 'menu-item ' + classe,
    onclick: () => { fecharMenu(); acao(); },
  }, el('span', { class: 'ponto', style: { background: cor } }), rotulo);

  const itens = [];
  if (meu && (post.lookId || post.boardId)) {
    itens.push(item('Editar', '#8a8178', () => {
      if (post.tipo === 'board') { irPara('board'); abrirBoard(post.boardId); }
      else { abrirLook(post.lookId); irPara('stylist'); }
    }));
  }

  itens.push(item('Baixar imagem', '#1a1a1a', () => baixarPost(post)));

  if (meu) {
    itens.push(item('Apagar do feed', '#c0392b', () => apagarPost(post), 'perigo'));
  }

  const menu = el('div', { class: 'menu-compartilhar' }, ...itens);
  document.body.append(menu);

  const r = botao.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  menu.style.left = Math.round(Math.max(12, Math.min(r.right - m.width, window.innerWidth - m.width - 12))) + 'px';
  menu.style.top = Math.round(Math.min(r.bottom + 6, window.innerHeight - m.height - 12)) + 'px';

  setTimeout(() => document.addEventListener('pointerdown', fecharMenuUmaVez), 0);
}

function fecharMenu() {
  document.querySelector('.menu-compartilhar')?.remove();
  document.removeEventListener('pointerdown', fecharMenuUmaVez);
}
function fecharMenuUmaVez(e) {
  // closest só existe em Element: clique que cai no documento fecha direto.
  if (e.target?.closest?.('.menu-compartilhar')) return;
  fecharMenu();
}

async function apagarPost(post) {
  if (!await confirmar('Curtidas e comentários vão junto.',
    { titulo: `Apagar "${post.nome}" do feed?`, sim: 'Apagar', perigo: true })) return;
  if (post.real) {
    try { await apagarPublicacao(post); }
    catch (e) { return toast(e.message || 'Não consegui apagar agora.', 'aviso'); }
  } else {
    db.state.feed = db.state.feed.filter(p => p.id !== post.id);
  }
  // O look (ou a colagem) volta a poder ser publicado.
  const origem = post.lookId
    ? db.state.looks.find(l => l.id === post.lookId)
    : db.state.boards.find(b => b.id === post.boardId);
  if (origem) origem.publicado = false;
  db.salvar();
  repintar();
}

async function baixarPost(post) {
  // O post gerado não tem imagem guardada: baixa a que foi desenhada aqui.
  const desenho = !post.thumb && desenhoDoPost(post);
  const src = post.thumb || (desenho ? await imagemGrande(desenho) : null);
  if (!src) return toast('Esse post não tem imagem guardada.', 'aviso');
  const ext = /webp/.test(src) ? 'webp' : /jpe?g/.test(src) ? 'jpg' : 'png';
  const a = document.createElement('a');
  a.download = `brecho-${(post.nome || 'post').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${ext}`;
  a.href = src;
  a.click();
}

// ================================ Sugestões ===============================
// A coluna "quem seguir" é a busca de pessoas (busca.js): sem termo mostra as
// sugestões — quem você ainda não segue primeiro —, com termo mostra o achado.
export function alternarSeguir(id) {
  const lista = db.state.usuario.seguindo;
  const i = lista.indexOf(id);
  const passouASeguir = i < 0;
  if (i >= 0) {
    lista.splice(i, 1);
  } else {
    lista.push(id);
    db.progredirMissao('seguir');
  }
  db.salvar();
  render();
  avisar();

  // Conta real: quem manda é o servidor. A tela já mudou (não faz esperar rede
  // para um botão), e se ele recusar volta atrás e avisa.
  if (ehFicticio(id)) return;
  seguirNoServidor(id, passouASeguir).then(() => { render(); avisar(); }).catch(erro => {
    const atual = db.state.usuario.seguindo;
    const pos = atual.indexOf(id);
    if (passouASeguir && pos >= 0) atual.splice(pos, 1);
    else if (!passouASeguir && pos < 0) atual.push(id);
    db.salvar();
    render();
    avisar();
    toast(erro.message || 'Não consegui seguir agora. Tente de novo.', 'aviso');
  });
}

// ============================== Look aberto ===============================
// Um toque no card abre o look grande: quem postou, a imagem, curtir, as
// peças que ele usa (tocar numa abre a ficha, com o ♡ da wishlist) e os
// comentários. Embaixo, "mais como este": looks com as mesmas peças ou marcas,
// para ir de um a outro sem voltar ao mural.
let lookAberto = null;
let lookMontado = false;
const MAIS_COMO_ESTE = 6;

function montarLook() {
  if (lookMontado) return;
  lookMontado = true;
  const modal = $('#modal-look');
  $('#look-fechar').addEventListener('click', fecharPostGrande);
  modal.addEventListener('click', (e) => { if (e.target === modal) fecharPostGrande(); });
  document.addEventListener('keydown', (e) => {
    // A ficha da peça abre por cima e fecha primeiro (usuario.js).
    if (e.key === 'Escape' && !modal.hidden && $('#modal-pp').hidden) fecharPostGrande();
  });
  // Editar pelo menu leva a outra tela: o look aberto sai da frente.
  window.addEventListener('hashchange', fecharPostGrande);
  // Curtir ou comentar aqui repinta o feed; o look aberto repinta junto.
  aoAtualizarFeed(() => { if (lookAberto) renderLook(); });
}

export function abrirPostGrande(id) {
  montarLook();
  lookAberto = id;
  renderLook();
  $('#look-corpo').scrollTop = 0;
  $('#modal-look').hidden = false;
  document.body.classList.add('com-modal');
}

function fecharPostGrande() {
  if (!lookAberto) return;
  lookAberto = null;
  $('#modal-look').hidden = true;
  $('#look-corpo').replaceChildren();
  if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('com-modal');
}

function renderLook() {
  const post = todosOsPosts().find(p => p.id === lookAberto);
  if (!post) return fecharPostGrande();
  post.comentarios ??= [];
  prepararGerado(post);
  const autor = autorDe(post.autor);
  const pecas = pecasDoPost(post);
  const corpo = $('#look-corpo');
  const rolagem = corpo.scrollTop;
  const ir = (fn) => () => { fecharPostGrande(); fn(); };

  $('#look-autor').replaceChildren(
    el('button', { class: 'autor-link', title: `Ver o perfil de ${autor.nome}`, onclick: ir(() => abrirAutor(post.autor)) },
      retratoDe(post.autor, 34)),
    el('div', { class: 'post-autor' },
      el('strong', {}, el('button', { class: 'autor-link nome', onclick: ir(() => abrirAutor(post.autor)) }, autor.nome)),
      el('small', {}, tempoRelativo(post.criadoEm))),
    el('button', {
      class: 'post-mais', title: 'Mais opções',
      onclick: (e) => menuDoPost(post, e.currentTarget),
    }, ico('mais')));

  const tenho = pecas.filter(p => db.temPeca(p.id)).length;
  const grade = gradeDePecas(pecas, { abrir: (i) => abrirFichaDePeca(pecas, i) });
  grade.forEach((b, i) => b.classList.toggle('tenho', db.temPeca(pecas[i].id)));
  const parecidos = maisComoEste(post);

  // replaceChildren escreveria "null" no lugar das seções que não existem.
  corpo.replaceChildren(...[
    // As peças vêm antes da imagem: é o que se procura num brechó.
    pecas.length
      ? el('section', { class: 'look-secao look-secao-pecas' },
        el('h4', {}, `${pecas.length} ${pecas.length === 1 ? 'peça' : 'peças'}`,
          tenho ? el('small', {}, ` · você tem ${tenho}`) : null),
        el('div', { class: 'pf-grade look-pecas' }, ...grade))
      : null,
    el('div', {
      class: 'look-foto post-thumb' + (post.tipo === 'board' ? ' colagem' : ''),
      // Aqui um toque não tem o que abrir: dois curtem, como no card.
      onclick: (e) => tocarNaImagem(post, e, null),
    },
      post.thumb || post.gerado ? imagemDoPost(post) : el('div', { class: 'sem-thumb' }, 'sem prévia'),
      botaoCurtir(post)),
    el('h3', { class: 'look-nome' }, post.nome),
    quemCurtiu(post, { completo: true }),
    conversaDoLook(post),
    parecidos.length
      ? el('section', { class: 'look-secao' },
        el('h4', {}, 'Mais como este'),
        el('div', { class: 'look-parecidos' }, ...parecidos.map(p => el('button', {
          class: 'look-parecido' + (p.tipo === 'board' ? ' colagem' : ''), title: p.nome,
          onclick: () => abrirPostGrande(p.id),
        }, imagemDoPost(p)))))
      : null,
  ].filter(Boolean));
  corpo.scrollTop = rolagem;
}

// Os comentários do look aberto, no jeito do Instagram: soltos na tela, cada
// um com o retrato de quem escreveu, o nome e o texto juntos e o tempo
// embaixo; o campo é uma linha com o seu retrato e "Publicar".
function conversaDoLook(post) {
  const lista = post.comentarios.map(c => {
    const podeApagar = sou(c.autor) || (post.real && sou(post.autor));
    return el('div', { class: 'ig-comentario' },
      el('button', { class: 'autor-link', onclick: () => abrirAutor(c.autor) }, retratoDe(c.autor, 30)),
      el('div', { class: 'ig-comentario-texto' },
        el('p', {},
          el('button', { class: 'autor-link nome forte', onclick: () => abrirAutor(c.autor) }, autorDe(c.autor).nome),
          ' ', c.texto),
        el('small', {}, tempoRelativo(c.em))),
      podeApagar
        ? el('button', { class: 'apagar-com', title: 'Apagar', onclick: () => apagarComentario(post, c) }, ico('x'))
        : null);
  });

  const campo = el('input', {
    type: 'text', class: 'campo-comentario',
    dataset: { post: post.id },
    placeholder: 'Adicione um comentário…', maxlength: '140',
    value: rascunhos.get(post.id) || '',
    oninput: (e) => rascunhos.set(post.id, e.target.value),
    onkeydown: (e) => { if (e.key === 'Enter') comentar(post, campo); },
  });
  if (post.id === focarEm) { focarEm = null; requestAnimationFrame(() => campo.focus()); }

  return el('section', { class: 'look-secao ig-conversa' },
    ...(lista.length ? lista : [el('p', { class: 'ig-vazio' }, 'Ninguém comentou ainda.')]),
    el('div', { class: 'ig-campo' },
      retratoDe(db.state.usuario.id, 30),
      campo,
      el('button', { class: 'ig-publicar', onclick: () => comentar(post, campo) }, 'Publicar')));
}

// Parecido é quem divide peças com este look (vale mais), depois marca e
// tipo de peça. Empate fica com o mais novo; sem nada em comum, não entra.
function maisComoEste(post) {
  const minhas = pecasDoPost(post);
  const ids = new Set(minhas.map(p => p.id));
  const marcas = new Set(minhas.map(p => p.marca?.trim().toLowerCase()).filter(Boolean));
  const cats = new Set(minhas.map(p => p.cat));
  return todosOsPosts()
    .filter(p => p.id !== post.id && (p.thumb || p.gerado))
    .map(p => {
      prepararGerado(p);
      let nota = 0;
      for (const peca of pecasDoPost(p)) {
        if (ids.has(peca.id)) nota += 4;
        else if (marcas.has(peca.marca?.trim().toLowerCase())) nota += 2;
        else if (cats.has(peca.cat)) nota += 0.3;
      }
      if (p.tipo === post.tipo) nota += 0.5;
      return { p, nota };
    })
    .filter(x => x.nota >= 2)
    .sort((a, b) => b.nota - a.nota || maisNovoPrimeiro(a.p, b.p))
    .slice(0, MAIS_COMO_ESTE)
    .map(x => x.p);
}

export const aoEntrarNoSocial = montarSocial;
