// Feed: o que os outros postaram, curtidas e comentários.
//
// Duas fontes, uma tela só:
//   * as publicações de contas de verdade — a sua e as dos amigos — vêm do
//     servidor (publicacoes.js → /api/feed). Curtir e comentar nelas também é
//     no servidor, então todo mundo vê a mesma coisa;
//   * os perfis de exemplo (PERFIS_MOCK) continuam locais: os looks deles saem
//     do mesmo sorteio dos botões de gerar e servem para o feed nascer povoado.
//
// A tela é organizada em abas (Seguindo · Comunidade · Tudo), com um filtro de
// tipo (looks ou colagens) e os posts agrupados por quando saíram.

import { PERFIS_MOCK, COMENTARIOS_MOCK, NOMES_LOOK_MOCK, COLLAB, SERVICOS } from './config.js';
import { catalogo } from './catalog.js';
import * as db from './db.js';
import { miniatura, miniaturaBoard } from './render.js';
import { el, $, mulberry32, sementeDoTexto, shuffle, escolher, tempoRelativo, toast } from './util.js';
import { aparenciaDoPerfil, aparenciaAtual, retrato } from './avatar.js';
import { sortearConjunto, camadasParaAvatar, colagemAleatoria } from './sorteio.js';
import { abrirLook } from './stylist.js';
import { abrirBoard } from './board.js';
import { irPara, viewAtual } from './router.js';
import { chipNivel } from './nivel.js';
// Ciclo de propósito: o feed leva ao perfil de alguém e o perfil mostra os
// mesmos cards daqui. Os dois lados só se chamam em tempo de execução.
import { abrirPerfilDe } from './usuario.js';
import { renderPessoas, atualizarPessoas } from './busca.js';
import { ehFicticio, seguirNoServidor, perfilDe, roupasDoPerfil } from './pessoas.js';
import {
  publicacoes, feedLidoEm, carregarFeed, aoMudarPublicacoes, apagarPublicacao,
  curtirPublicacao, comentarPublicacao, apagarComentarioPublicado,
} from './publicacoes.js';

const sou = (id) => id === db.state.usuario.id;

// A sua cor no feed — o fundo do seu retrato nos posts e da moldura do avatar
// no seu perfil, como cada perfil fictício tem a dele em PERFIS_MOCK.
export const COR_PROPRIA = '#e8e2d8';

// Fictício ou conta real (o cartão veio junto com o feed ou da busca).
const autorDe = (id) => sou(id)
  ? { nome: db.state.usuario.nome, handle: db.state.usuario.handle, cor: COR_PROPRIA }
  : perfilDe(id) || { id, nome: 'alguém', handle: '@?', cor: '#eee' };

// O personagem de quem assina o post — e a roupinha dele. O retrato é um
// recorte da cabeça, então o que aparece aqui é chapéu e óculos.
const aparenciaDe = (id) => sou(id) ? aparenciaAtual() : aparenciaDoPerfil(autorDe(id));
const roupasDe = (id) => sou(id) ? db.roupasEquipadas() : roupasDoPerfil(autorDe(id));

const retratoDe = (id, tamanho = 34) =>
  retrato(aparenciaDe(id), tamanho, autorDe(id).cor, roupasDe(id));

// Clicar em quem assina abre o perfil: o seu é a tela de perfil de sempre,
// o dos outros é a página pública.
export const abrirAutor = (id) => sou(id) ? irPara('perfil') : abrirPerfilDe(id);

const ABAS = [
  ['seguindo', 'Seguindo', 'Você e quem você segue'],
  ['comunidade', 'Comunidade', 'Só contas de verdade do brechó'],
  ['tudo', 'Tudo', 'Contas de verdade e perfis de exemplo'],
];
const FILTROS = [['todos', 'Todos'], ['look', 'Looks'], ['board', 'Colagens']];

let aba = null;                           // escolhida na primeira entrada
let filtro = 'todos';
let expandidos = new Set();               // posts com a conversa aberta
const rascunhos = new Map();              // comentário meio escrito, por post

// O perfil público mostra os mesmos cards do feed. Curtir lá tem que acender o
// coração aqui (e vice-versa), então quem repinta avisa os interessados.
const ouvintes = new Set();
export const aoAtualizarFeed = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };
const avisar = () => ouvintes.forEach(fn => fn());
function repintar() {
  if (viewAtual() === 'social') renderFeed();
  avisar();
}
aoMudarPublicacoes(repintar);

// O look dos perfis fictícios sai do mesmo sorteio dos botões de gerar,
// só que tirando do acervo inteiro (menos a cápsula, que é conquistada).
export function lookAleatorio(rnd = Math.random) {
  return camadasParaAvatar(sortearConjunto(acervoParaLooks(), rnd), rnd);
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
    post.camadas = camadasParaAvatar(pecas, rnd);
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
const VERSAO_SEED = 4;

function acervoParaLooks() {
  return catalogo.itens.filter(i => !COLLAB.itens.includes(i.id));
}

async function semearFeed() {
  if (db.state.feedSemeado === VERSAO_SEED) return;
  // Sem acervo os fictícios postariam avatar pelado: melhor não semear ainda.
  if (acervoParaLooks().length < 4) return;

  db.state.feed = db.state.feed.filter(p => sou(p.autor));
  const rnd = mulberry32(20260901);
  for (let i = 0; i < 12; i++) {
    db.state.feed.push(await criarPostFicticio(rnd, 2 + i * 7));
  }
  db.state.feedSemeado = VERSAO_SEED;
  db.salvar();
}

// Botão de teste: mais posts dos perfis de exemplo.
export async function gerarPostsFicticios(quantos = 3) {
  if (acervoParaLooks().length < 4) {
    return toast('Poucas peças no acervo para montar look. Adicione algumas primeiro.', 'aviso');
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
  if (!aba) aba = db.state.usuario.seguindo.length ? 'seguindo' : 'comunidade';
  render();
  // Quem entrou no brechó desde a última vez aparece na coluna sem ninguém
  // digitar nada.
  atualizarPessoas();
  await atualizarFeed();
}

async function atualizarFeed() {
  const botao = $('#feed-atualizar');
  botao?.classList.add('girando');
  await carregarFeed();
  botao?.classList.remove('girando');
  if (viewAtual() === 'social') renderFeed();
}

// Voltar para a aba do navegador com o feed aberto traz o que saiu enquanto isso.
let ouvindoFoco = false;
function ouvirFoco() {
  if (ouvindoFoco) return;
  ouvindoFoco = true;
  window.addEventListener('focus', () => { if (viewAtual() === 'social') garantirFeed(); });
  $('#feed-atualizar')?.addEventListener('click', atualizarFeed);
}

function render() {
  ouvirFoco();
  renderAbas();
  renderFeed();
  renderPessoas();
}

function postsVisiveis() {
  const seguindo = db.state.usuario.seguindo;
  return todosOsPosts().filter(p => {
    if (filtro !== 'todos' && (p.tipo || 'look') !== filtro) return false;
    if (aba === 'seguindo') return sou(p.autor) || seguindo.includes(p.autor);
    if (aba === 'comunidade') return !ehFicticio(p.autor);
    return true;
  });
}

function renderAbas() {
  const caixa = $('#feed-abas');
  if (caixa) {
    caixa.replaceChildren(...ABAS.map(([id, rotulo, dica]) => el('button', {
      class: 'feed-aba' + (aba === id ? ' ativa' : ''),
      title: dica,
      onclick: () => { aba = id; render(); },
    }, rotulo)));
  }
  const filtros = $('#feed-filtros');
  if (filtros) {
    filtros.replaceChildren(...FILTROS.map(([id, rotulo]) => el('button', {
      class: 'feed-filtro' + (filtro === id ? ' ativo' : ''),
      onclick: () => { filtro = id; render(); },
    }, rotulo)));
  }
}

// Hoje, ontem, esta semana... — a régua que separa o feed em blocos.
function periodoDe(iso) {
  const dia = (d) => { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; };
  const dias = Math.round((dia(Date.now()) - dia(iso)) / 864e5);
  if (dias <= 0) return 'Hoje';
  if (dias === 1) return 'Ontem';
  if (dias < 7) return 'Esta semana';
  if (dias < 31) return 'Este mês';
  return 'Mais antigos';
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

  if (!posts.length) {
    feed.replaceChildren(el('div', { class: 'feed-vazio' }, ...mensagemVazia()));
    return;
  }

  // Um bloco por período, cada um com a sua grade: os cards de um mesmo dia
  // ficam juntos e o olho acha "o que saiu hoje" sem ler as datas.
  const blocos = new Map();
  for (const post of posts) {
    const periodo = periodoDe(post.criadoEm);
    if (!blocos.has(periodo)) blocos.set(periodo, []);
    blocos.get(periodo).push(post);
  }
  feed.replaceChildren(...[...blocos].map(([periodo, lista]) =>
    el('section', { class: 'feed-bloco' },
      el('h2', { class: 'feed-periodo' }, periodo, el('small', {}, String(lista.length))),
      el('div', { class: 'feed-grade' }, ...lista.map(cardDoPost)))));

  if (escrevendo) {
    const campo = feed.querySelector(`.campo-comentario[data-post="${CSS.escape(escrevendo)}"]`);
    campo?.focus();
    campo?.setSelectionRange(campo.value.length, campo.value.length);
  }
}

function mensagemVazia() {
  const u = db.state.usuario;
  const ir = (rotulo, destino) => el('button', {
    class: 'link-btn', onclick: () => { aba = destino; render(); },
  }, rotulo);
  const tipo = filtro === 'look' ? 'look' : filtro === 'board' ? 'colagem' : 'publicação';

  if (aba === 'seguindo') {
    return u.seguindo.length
      ? [`Quem você segue ainda não tem ${tipo} por aqui. `, ir('Ver a comunidade', 'comunidade')]
      : ['Você ainda não segue ninguém. Siga alguém na coluna ao lado ou ', ir('veja a comunidade', 'comunidade'), '.'];
  }
  if (aba === 'comunidade') {
    return [`Nenhuma ${tipo} de conta de verdade ainda. Publique um look no Stylist ou uma colagem — `,
      'seus amigos veem aqui. ', ir('Ver tudo', 'tudo')];
  }
  return [acervoParaLooks().length < 4
    ? 'Sem peças no acervo ainda — os perfis de exemplo só postam quando houver roupa para vestir.'
    : 'Feed vazio. Publique um look no Stylist para começar.'];
}

export function cardDoPost(post) {
  const meu = sou(post.autor);
  const autor = autorDe(post.autor);
  const segue = db.state.usuario.seguindo.includes(post.autor);
  post.comentarios ??= [];

  return el('article', { class: 'post' + (meu ? ' meu' : '') },
    el('header', { class: 'post-head' },
      el('button', {
        class: 'autor-link', title: `Ver o perfil de ${autor.nome}`,
        onclick: () => abrirAutor(post.autor),
      }, retratoDe(post.autor, 36)),
      el('div', { class: 'post-autor' },
        el('strong', {},
          el('button', {
            class: 'autor-link nome',
            onclick: () => abrirAutor(post.autor),
          }, autor.nome),
          meu ? chipNivel() : null),
        el('small', {}, `${autor.handle} · ${tempoRelativo(post.criadoEm)}`)
      ),
      meu
        ? el('span', { class: 'tag-meu' }, 'seu')
        : el('button', {
            class: 'btn-seguir mini' + (segue ? ' seguindo' : ''),
            onclick: () => alternarSeguir(post.autor),
          }, segue ? 'seguindo' : 'seguir')
    ),

    el('div', { class: 'post-thumb' },
      post.thumb
        ? el('img', { src: post.thumb, alt: post.nome, loading: 'lazy' })
        : el('div', { class: 'sem-thumb' }, 'sem prévia'),
      el('span', { class: 'post-tipo' }, post.tipo === 'board' ? 'colagem' : 'look')
    ),

    el('div', { class: 'post-acoes' },
      el('button', {
        class: 'curtir' + (post.curtido ? ' on' : ''),
        title: post.curtido ? 'Descurtir' : 'Curtir',
        onclick: () => alternarCurtida(post),
      }, post.curtido ? '♥' : '♡', el('span', {}, String(post.curtidas))),

      el('button', {
        class: 'comentar-btn' + (expandidos.has(post.id) ? ' on' : ''),
        title: 'Comentários',
        onclick: () => alternarThread(post),
      }, '💬', el('span', {}, String(post.comentarios.length))),

      el('span', { class: 'post-nome', title: post.nome }, post.nome),

      el('button', {
        class: 'post-mais', title: 'Mais opções',
        onclick: (e) => menuDoPost(post, e.currentTarget),
      }, '⋯')
    ),

    thread(post)
  );
}

// ============================== Comentários ===============================
// Fechada, a conversa é uma linha: o último comentário. Aberta, é a lista
// inteira e o campo — assim os cards da grade ficam do mesmo tamanho.
function thread(post) {
  const aberta = expandidos.has(post.id);
  const caixa = el('div', { class: 'post-thread' + (aberta ? ' aberta' : '') });

  if (!aberta) {
    const ultimo = post.comentarios.at(-1);
    caixa.append(ultimo
      ? el('button', { class: 'thread-previa', onclick: () => alternarThread(post) },
          el('strong', {}, autorDe(ultimo.autor).nome), ' ', ultimo.texto,
          post.comentarios.length > 1
            ? el('small', {}, `ver os ${post.comentarios.length}`)
            : null)
      : el('button', { class: 'thread-previa vazia', onclick: () => alternarThread(post) },
          'comentar…'));
    return caixa;
  }

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
          }, '✕')
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
  expandidos.add(post.id);
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

async function alternarCurtida(post) {
  if (post.real) {
    try { await curtirPublicacao(post); }
    catch (e) { toast(e.message || 'Não consegui curtir agora.', 'aviso'); }
    return;
  }
  post.curtido = !post.curtido;
  post.curtidas = Math.max(0, post.curtidas + (post.curtido ? 1 : -1));
  db.salvar();
  repintar();
}

// ============================ O menu do post ==============================
// Tudo o que não é curtir e comentar mora aqui: editar e apagar (os seus),
// publicar fora (Instagram e Pinterest, quando ligados) e baixar a imagem.
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

  for (const [id, s] of Object.entries(SERVICOS)) {
    if (!db.estaLigado(id)) continue;
    const quem = db.state.conexoes[id].usuario;
    itens.push(item(`Publicar no ${s.nome}`, s.cor, () =>
      toast(`Publicaria "${post.nome}" no ${s.nome} de @${quem}. Com o backend ligado, vai direto.`)));
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
  if (!confirm(`Apagar "${post.nome}" do feed? Curtidas e comentários vão junto.`)) return;
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
  toast('Post apagado do feed.');
}

function baixarPost(post) {
  if (!post.thumb) return toast('Esse post não tem imagem guardada.', 'aviso');
  const ext = /webp/.test(post.thumb) ? 'webp' : /jpe?g/.test(post.thumb) ? 'jpg' : 'png';
  const a = document.createElement('a');
  a.download = `brecho-${(post.nome || 'post').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${ext}`;
  a.href = post.thumb;
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
    // O contador de seguidores do fictício é só um número do protótipo. O de uma
    // conta real vem do servidor, então não há o que somar aqui.
    if (ehFicticio(id)) db.state.usuario.seguidores += 1;
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

export const aoEntrarNoSocial = montarSocial;
