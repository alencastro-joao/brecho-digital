// Feed: o que os outros postaram, curtidas e comentários.
//
// O grafo real (seguidores, timeline, notificações) é PostgreSQL no roadmap.
// Aqui os perfis são fictícios e os looks deles saem do mesmo sorteio dos botões
// de gerar — serve para o feed nascer povoado e para testar o fluxo social
// inteiro (seguir, curtir, comentar) sem depender de backend.

import { PERFIS_MOCK, COMENTARIOS_MOCK, NOMES_LOOK_MOCK, COLLAB, SERVICOS } from './config.js';
import { catalogo } from './catalog.js';
import * as db from './db.js';
import { miniatura, miniaturaBoard } from './render.js';
import { el, $, mulberry32, sementeDoTexto, shuffle, escolher, tempoRelativo, toast } from './util.js';
import { aparenciaDoPerfil, aparenciaAtual, retrato } from './avatar.js';
import { roupasSorteadas } from './roupinhas.js';
import { sortearConjunto, camadasParaAvatar, colagemAleatoria } from './sorteio.js';
import { abrirLook } from './stylist.js';
import { abrirBoard } from './board.js';
import { irPara } from './router.js';
import { chipNivel } from './nivel.js';
// Ciclo de propósito: o feed leva ao perfil de alguém e o perfil mostra os
// mesmos cards daqui. Os dois lados só se chamam em tempo de execução.
import { abrirPerfilDe } from './usuario.js';
import { renderPessoas, atualizarPessoas } from './busca.js';
import { ehFicticio, seguirNoServidor } from './pessoas.js';

const perfil = (id) => PERFIS_MOCK.find(p => p.id === id);
const sou = (id) => id === db.state.usuario.id;

// A sua cor no feed — o fundo do seu retrato nos posts e da moldura do avatar
// no seu perfil, como cada perfil fictício tem a dele em PERFIS_MOCK.
export const COR_PROPRIA = '#e8e2d8';

const autorDe = (id) => sou(id)
  ? { nome: db.state.usuario.nome, handle: db.state.usuario.handle, cor: COR_PROPRIA }
  : perfil(id) || { nome: 'alguém', handle: '@?', cor: '#eee' };

// O personagem de quem assina o post: o seu, ou o sorteado para aquele perfil.
const aparenciaDe = (id) => sou(id) ? aparenciaAtual() : aparenciaDoPerfil(perfil(id));

// E a roupinha dele. O retrato é um recorte da cabeça, então o que aparece
// aqui é chapéu e óculos — o resto fica fora do enquadramento.
const roupasDe = (id) => sou(id) ? db.roupasEquipadas() : roupasSorteadas(id);

const retratoDe = (id, tamanho = 34) =>
  retrato(aparenciaDe(id), tamanho, autorDe(id).cor, roupasDe(id));

// Clicar em quem assina abre o perfil: o seu é a tela de perfil de sempre,
// o dos outros é a página pública.
export const abrirAutor = (id) => sou(id) ? irPara('perfil') : abrirPerfilDe(id);

let aba = 'descobrir';                    // 'seguindo' | 'descobrir'
let expandidos = new Set();               // posts com a thread aberta

// O perfil público mostra os mesmos cards do feed. Curtir lá tem que acender o
// coração aqui (e vice-versa), então quem repinta avisa os interessados.
const ouvintes = new Set();
export const aoAtualizarFeed = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };
const avisar = () => ouvintes.forEach(fn => fn());
function repintar() { renderFeed(); avisar(); }

// O look dos perfis fictícios sai do mesmo sorteio dos botões de gerar,
// só que tirando do acervo inteiro (menos a cápsula, que é conquistada).
export function lookAleatorio(rnd = Math.random) {
  return camadasParaAvatar(sortearConjunto(acervoParaLooks(), rnd), rnd);
}

// Quanto do feed é colagem em vez de look no avatar. As duas coisas são o
// que o app faz, então as duas aparecem no feed dos outros também.
const CHANCE_COLAGEM = 0.4;

// ============================== Gerar posts ===============================
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

// Botão de teste: mais posts e alguma reação no que é seu.
export async function gerarPostsFicticios(quantos = 3) {
  if (acervoParaLooks().length < 4) {
    return toast('Poucas peças no acervo para montar look. Adicione algumas primeiro.', 'aviso');
  }
  for (let i = 0; i < quantos; i++) {
    db.state.feed.unshift(await criarPostFicticio(Math.random, Math.random() * 6));
  }

  const meus = db.state.feed.filter(p => sou(p.autor));
  for (const meu of meus.slice(0, 2)) {
    meu.curtidas += 1 + Math.floor(Math.random() * 6);
    meu.comentarios ??= [];
    meu.comentarios.push({
      id: 'c' + Math.random().toString(36).slice(2, 9),
      autor: escolher(PERFIS_MOCK).id,
      texto: escolher(COMENTARIOS_MOCK),
      em: new Date().toISOString(),
    });
  }

  db.salvar();
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

// ================================= Feed ===================================
export async function montarSocial() {
  await semearFeed();
  if (db.state.usuario.seguindo.length && aba === 'descobrir') aba = 'seguindo';
  render();
  // Quem entrou no brechó desde a última vez aparece na coluna sem ninguém
  // digitar nada.
  atualizarPessoas();
}

function render() {
  renderAbas();
  renderFeed();
  renderPessoas();
}

function postsVisiveis() {
  const todos = [...db.state.feed].sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
  if (aba === 'descobrir') return todos;
  const seguindo = db.state.usuario.seguindo;
  return todos.filter(p => sou(p.autor) || seguindo.includes(p.autor));
}

function renderAbas() {
  const caixa = $('#feed-abas');
  if (!caixa) return;
  caixa.innerHTML = '';
  for (const [id, rotulo] of [['seguindo', 'Seguindo'], ['descobrir', 'Descobrir']]) {
    caixa.append(el('button', {
      class: 'feed-aba' + (aba === id ? ' ativa' : ''),
      onclick: () => { aba = id; render(); },
    }, rotulo));
  }
}

function renderFeed() {
  const feed = $('#feed');
  feed.innerHTML = '';

  const posts = postsVisiveis();
  const u = db.state.usuario;
  $('#feed-sub').textContent =
    `${posts.length} ${posts.length === 1 ? 'colagem' : 'colagens'} · ` +
    `seguindo ${u.seguindo.length} · ${u.seguidores} seguidores`;

  if (!posts.length) {
    feed.append(el('p', { class: 'feed-vazio' },
      aba === 'seguindo'
        ? u.seguindo.length
          // Contas reais ainda não publicam para as outras: quem você segue pode
          // simplesmente não ter nada no feed, e isso não é "não seguir ninguém".
          ? 'As pessoas que você segue ainda não publicaram nada por aqui. ' +
            'Vá em Descobrir para ver o que os outros estão montando.'
          : 'Você ainda não segue ninguém. Vá em Descobrir ou siga alguém na coluna ao lado.'
        : acervoParaLooks().length < 4
          ? 'Sem peças no acervo ainda — os perfis fictícios só postam quando houver roupa para vestir.'
          : 'Feed vazio. Publique um look no Stylist para começar.'));
    return;
  }

  for (const post of posts) feed.append(cardDoPost(post));
}

export function cardDoPost(post) {
  const meu = sou(post.autor);
  const autor = autorDe(post.autor);
  const segue = db.state.usuario.seguindo.includes(post.autor);
  post.comentarios ??= [];

  return el('article', { class: 'post' },
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
        : el('div', { class: 'sem-thumb' }, 'sem prévia')
    ),

    el('div', { class: 'post-acoes' },
      el('button', {
        class: 'curtir' + (post.curtido ? ' on' : ''),
        title: post.curtido ? 'Descurtir' : 'Curtir',
        onclick: () => alternarCurtida(post),
      }, post.curtido ? '♥' : '♡', el('span', {}, String(post.curtidas))),

      el('button', {
        class: 'comentar-btn',
        title: 'Comentários',
        onclick: () => alternarThread(post),
      }, '💬', el('span', {}, String(post.comentarios.length))),

      el('span', { class: 'post-nome' }, post.nome),

      meu && (post.lookId || post.boardId)
        ? el('button', {
            class: 'link-btn',
            onclick: () => {
              if (post.tipo === 'board') { irPara('board'); abrirBoard(post.boardId); }
              else { abrirLook(post.lookId); irPara('stylist'); }
            },
          }, 'editar')
        : el('button', {
            class: 'link-btn',
            onclick: (e) => compartilhar(post, e.currentTarget),
          }, 'compartilhar')
    ),

    thread(post)
  );
}

// ============================== Comentários ===============================
function thread(post) {
  const aberta = expandidos.has(post.id);
  const lista = aberta ? post.comentarios : post.comentarios.slice(-2);

  const caixa = el('div', { class: 'post-thread' });

  if (post.comentarios.length > 2 && !aberta) {
    caixa.append(el('button', {
      class: 'link-btn ver-todos',
      onclick: () => alternarThread(post),
    }, `ver os ${post.comentarios.length} comentários`));
  }

  for (const c of lista) {
    const a = autorDe(c.autor);
    caixa.append(el('p', { class: 'comentario' },
      el('button', {
        class: 'autor-link nome forte',
        style: { color: sou(c.autor) ? 'var(--tinta)' : 'inherit' },
        onclick: () => abrirAutor(c.autor),
      }, a.nome),
      ' ', c.texto,
      el('small', {}, tempoRelativo(c.em)),
      sou(c.autor)
        ? el('button', {
            class: 'apagar-com', title: 'Apagar',
            onclick: () => {
              post.comentarios = post.comentarios.filter(x => x.id !== c.id);
              db.salvar(); repintar();
            },
          }, '✕')
        : null
    ));
  }

  const campo = el('input', {
    type: 'text', class: 'campo-comentario',
    placeholder: 'escreva um comentário…', maxlength: '140',
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      comentar(post, e.target.value);
      e.target.value = '';
    },
  });

  caixa.append(el('div', { class: 'comentar-linha' },
    campo,
    el('button', {
      class: 'enviar-com',
      onclick: () => { comentar(post, campo.value); campo.value = ''; },
    }, 'enviar')
  ));

  return caixa;
}

function comentar(post, texto) {
  const limpo = (texto || '').trim();
  if (!limpo) return;
  post.comentarios ??= [];
  post.comentarios.push({
    id: 'c' + Math.random().toString(36).slice(2, 9),
    autor: db.state.usuario.id,
    texto: limpo,
    em: new Date().toISOString(),
  });
  expandidos.add(post.id);
  db.salvar();
  repintar();
}

function alternarThread(post) {
  if (expandidos.has(post.id)) expandidos.delete(post.id);
  else expandidos.add(post.id);
  repintar();
}

function alternarCurtida(post) {
  post.curtido = !post.curtido;
  post.curtidas = Math.max(0, post.curtidas + (post.curtido ? 1 : -1));
  db.salvar();
  repintar();
}

// Um menu com os destinos ligados. Instagram e Pinterest publicam; o Pinterest
// ainda serve de entrada (importar pins), mas isso mora no perfil.
function compartilhar(post, botao) {
  document.querySelector('.menu-compartilhar')?.remove();

  const destinos = [];
  for (const [id, s] of Object.entries(SERVICOS)) {
    if (!db.estaLigado(id)) continue;
    const quem = db.state.conexoes[id].usuario;
    destinos.push(el('button', {
      class: 'menu-item',
      onclick: () => {
        fecharMenu();
        toast(`Publicaria "${post.nome}" no ${s.nome} de @${quem}. Com o backend ligado, vai direto.`);
      },
    }, el('span', { class: 'ponto', style: { background: s.cor } }), s.nome));
  }

  destinos.push(el('button', {
    class: 'menu-item',
    onclick: () => { fecharMenu(); baixarPost(post); },
  }, el('span', { class: 'ponto', style: { background: '#1a1a1a' } }), 'Baixar PNG'));

  if (!destinos.length > 1 && !db.estaLigado('instagram') && !db.estaLigado('pinterest')) {
    destinos.unshift(el('p', { class: 'menu-aviso' },
      'Nenhuma conta ligada. Conecte no perfil para publicar direto.'));
  }

  const menu = el('div', { class: 'menu-compartilhar' }, ...destinos);
  document.body.append(menu);

  const r = botao.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  menu.style.left = Math.round(Math.min(r.left, window.innerWidth - m.width - 110)) + 'px';
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

function baixarPost(post) {
  if (!post.thumb) return toast('Esse post não tem imagem guardada.', 'aviso');
  const a = document.createElement('a');
  a.download = `brecho-${(post.nome || 'post').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
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
