// O feed compartilhado: o que as contas de verdade publicam, visto por todas.
//
// Até aqui um post morava só no save de quem publicou (state.feed), e por isso
// o amigo abria o feed e não via nada. Agora o post vai para o servidor
// (/api/feed — nuvem/lambda/feed.py, e o espelho local em tools/feed.py), e
// este módulo guarda a última leitura dele. Curtir e comentar num post de
// verdade também é no servidor: a curtida do amigo aparece para você.
//
// Os perfis fictícios continuam no save (state.feed): são de exemplo, cada
// navegador tem os seus, e o servidor nunca soube deles.
//
// Os posts que você publicou antes disto — os que só existiam no seu save —
// sobem sozinhos na primeira leitura que der certo (migrarPostsLocais).

import * as db from './db.js';
import { guardarCartao } from './pessoas.js';
import { imagemDoFeed, imagemDoFeedColagem } from './render.js';

let posts = [];                 // a última leitura do servidor, mais novos primeiro
let lidoEm = null;              // quando — null enquanto nunca deu certo
let lendo = null;               // a leitura em andamento, para não pedir duas

const ouvintes = new Set();
export const aoMudarPublicacoes = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };
const avisar = () => ouvintes.forEach(fn => fn());

export const publicacoes = () => posts;
export const feedLidoEm = () => lidoEm;

async function chamar(rota, opcoes = {}) {
  const r = await fetch(rota, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opcoes,
  });
  if (!r.ok) {
    const erro = new Error((await r.json().catch(() => ({}))).erro || 'HTTP ' + r.status);
    erro.status = r.status;
    throw erro;
  }
  return r.json();
}

// Toda resposta do feed traz os posts e os cartões de quem aparece neles.
// Os cartões entram no mesmo lugar dos que a busca de pessoas traz, então o
// retrato, o nome e o perfil público de quem postou funcionam sem mais nada.
function receber({ posts: novos, autores }) {
  Object.values(autores || {}).forEach(guardarCartao);
  return novos || [];
}

function trocar(post) {
  const i = posts.findIndex(p => p.id === post.id);
  if (i >= 0) posts[i] = post;
  else posts = [post, ...posts].sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));
  avisar();
  return post;
}

// ------------------------------- Ler ---------------------------------------
export function carregarFeed() {
  lendo ??= chamar('/api/feed')
    .then(dados => {
      posts = receber(dados);
      lidoEm = new Date();
      avisar();
      migrarPostsLocais();
      return true;
    })
    .catch(e => {
      console.warn('não consegui ler o feed.', e.message);
      return false;
    })
    .finally(() => { lendo = null; });
  return lendo;
}

// ------------------------------- Publicar ---------------------------------
// A chave é o look ou a colagem de origem: o servidor monta o id do post a
// partir dela, então publicar de novo o mesmo look devolve o mesmo post.
export async function publicarNoFeed({ chave, tipo, nome, thumb, pecas, camadas, origem, criadoEm }) {
  const dados = await chamar('/api/feed', {
    method: 'POST',
    body: JSON.stringify({ chave, tipo, nome, thumb, pecas, camadas, origem, criadoEm }),
  });
  return trocar(receber(dados)[0]);
}

export async function apagarPublicacao(post) {
  await chamar('/api/feed/' + encodeURIComponent(post.id), { method: 'DELETE' });
  posts = posts.filter(p => p.id !== post.id);
  avisar();
}

// ---------------------------- Curtir e comentar ---------------------------
// Otimista: a tela muda na hora e o servidor confirma (ou desfaz) depois.
export async function curtirPublicacao(post) {
  const curte = !post.curtido;
  const antes = { curtido: post.curtido, curtidas: post.curtidas };
  post.curtido = curte;
  post.curtidas = Math.max(0, post.curtidas + (curte ? 1 : -1));
  avisar();
  try {
    const dados = await chamar(`/api/feed/${encodeURIComponent(post.id)}/curtir`, {
      method: 'POST', body: JSON.stringify({ curte }),
    });
    trocar(receber(dados)[0]);
  } catch (e) {
    Object.assign(post, antes);
    avisar();
    throw e;
  }
}

export async function comentarPublicacao(post, texto) {
  const dados = await chamar(`/api/feed/${encodeURIComponent(post.id)}/comentarios`, {
    method: 'POST', body: JSON.stringify({ texto }),
  });
  return trocar(receber(dados)[0]);
}

export async function apagarComentarioPublicado(post, comentarioId) {
  const dados = await chamar(
    `/api/feed/${encodeURIComponent(post.id)}/comentarios/${encodeURIComponent(comentarioId)}`,
    { method: 'DELETE' });
  return trocar(receber(dados)[0]);
}

// --------------------------- O que dá para publicar -----------------------
// O pacote que o servidor espera, a partir de um look ou de uma colagem salva.
// A imagem é desenhada de novo, no tamanho do feed (render.js, imagemDoFeed):
// a miniatura guardada no save é pequena demais para a coluna do mural. Sem
// camadas para desenhar, vai a guardada mesmo.
export async function pacoteDoLook(look, criadoEm) {
  return {
    chave: 'look:' + look.id,
    tipo: 'look',
    nome: look.nome,
    thumb: look.camadas?.length ? await imagemDoFeed(look.camadas) : look.thumb,
    pecas: (look.camadas || []).map(c => c.itemId),
    // Com as camadas, o feed redesenha o post no personagem de agora (social.js).
    camadas: (look.camadas || []).map(({ itemId, x, y, z, escala, rot, flip }) =>
      ({ itemId, x, y, z, escala, rot, flip })),
    origem: { lookId: look.id },
    criadoEm,
  };
}

export async function pacoteDaColagem(board, criadoEm) {
  return {
    chave: 'board:' + board.id,
    tipo: 'board',
    nome: board.nome,
    thumb: board.itens?.length ? await imagemDoFeedColagem(board) : board.thumb,
    pecas: (board.itens || []).map(i => i.itemId),
    origem: { boardId: board.id },
    criadoEm,
  };
}

// ----------------------- Os posts de antes do servidor --------------------
// Um post seu que só existe no save sobe com a data original; depois de subir,
// sai do save. Os comentários e curtidas que ele tinha eram dos perfis
// fictícios — de mentira —, e ficam para trás.
let migrando = false;

async function pacoteDoPostLocal(post) {
  const look = post.lookId && db.state.looks.find(l => l.id === post.lookId);
  const board = post.boardId && db.state.boards.find(b => b.id === post.boardId);
  if (look) return pacoteDoLook({ ...look, thumb: post.thumb || look.thumb }, post.criadoEm);
  if (board) return pacoteDaColagem({ ...board, thumb: post.thumb || board.thumb }, post.criadoEm);
  if (!post.thumb) return null;          // sem origem e sem imagem: nada a mostrar
  return {
    chave: 'post:' + post.id,
    tipo: post.tipo === 'board' ? 'board' : 'look',
    nome: post.nome,
    thumb: post.thumb,
    pecas: (post.camadas || post.colagem?.itens || []).map(c => c.itemId),
    criadoEm: post.criadoEm,
  };
}

async function migrarPostsLocais() {
  const eu = db.state.usuario.id;
  const meus = db.state.feed.filter(p => p.autor === eu && !p.naoSobe);
  if (migrando || !meus.length) return;
  migrando = true;
  let subiram = 0;
  try {
    for (const post of meus) {
      const pacote = await pacoteDoPostLocal(post);
      if (!pacote) continue;
      try {
        await publicarNoFeed(pacote);
      } catch (e) {
        // Sem rede ou servidor caído: fica para a próxima leitura.
        if (!e.status || e.status >= 500) break;
        // Recusado (miniatura inválida, por exemplo): tentar de novo não muda
        // nada. Fica no save, visível só aqui, como sempre foi.
        console.warn('post antigo recusado pelo servidor.', e.message);
        post.naoSobe = true;
        subiram += 1;
        continue;
      }
      db.state.feed = db.state.feed.filter(p => p.id !== post.id);
      subiram += 1;
    }
  } finally {
    migrando = false;
    if (subiram) db.salvar();
  }
}

// ------------------------- Publicar do Stylist e da Colagem ----------------
// Sem servidor (rede caída), o post fica no save como era antes e sobe sozinho
// na próxima leitura que der certo. Recusa de verdade (sessão vencida,
// miniatura inválida) vai para quem chamou mostrar.
export async function publicarOuGuardar(pacote) {
  try {
    await publicarNoFeed(pacote);
    return 'servidor';
  } catch (e) {
    if (e.status && e.status < 500) throw e;
    db.state.feed.unshift({
      id: 'p' + Date.now(),
      tipo: pacote.tipo,
      autor: db.state.usuario.id,
      ...pacote.origem,
      nome: pacote.nome,
      thumb: pacote.thumb,
      criadoEm: new Date().toISOString(),
      curtidas: 0,
      curtido: false,
      comentarios: [],
    });
    return 'local';
  }
}

// Já está no feed? O save diz que sim (`publicado`), e o servidor confirma —
// o post pode ter sido apagado de outro aparelho.
export const jaPublicado = (campo, id) =>
  publicacoes().some(p => p[campo] === id) ||
  db.state.feed.some(p => p[campo] === id && p.autor === db.state.usuario.id);
