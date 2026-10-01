// Perfil de outra pessoa — a página pública de quem aparece no feed.
//
// Aqui não há contas ligadas nem botões de teste: isso é do dono da conta. O
// que se vê de fora é quem a pessoa é (avatar, bio, desde quando), o que ela
// fez (colagens, curtidas recebidas) e o que ela veste (as peças dos looks).
// O seu perfil é esta mesma página, montada com os seus dados — ver perfil.js.
//
// Os números não vêm de lugar nenhum — são sorteados a partir do id, como o
// avatar (ver avatar.js). Mesma semente, mesma pessoa: @liamoreno tem sempre os
// mesmos seguidores e a mesma data de entrada, em qualquer navegador, sem
// ninguém cadastrar nada. Quando existir backend, é essa função que some.

import { PERFIS_MOCK, escalaGrade } from './config.js';
import { item as pecaDoCatalogo, nomeDaPeca, rotuloCategoria } from './catalog.js';
import * as db from './db.js';
import { aparenciaDoPerfil, svgAvatar, retrato } from './avatar.js';
import { el, $, mulberry32, sementeDoTexto, tempoRelativo, toast } from './util.js';
import { perfilDe, podeAbrir, carregarPerfil, roupasDoPerfil } from './pessoas.js';
import { chipNivel } from './nivel.js';
import { chipsDeRedes } from './conexoes.js';
import { irPara, paramAtual, viewAtual } from './router.js';
import { cardDoPost, alternarSeguir, gerarPostsDe, aoAtualizarFeed } from './social.js';

const MAX_PECAS = 12;

let idAtual = null;          // de quem é a página aberta
let gerando = false;         // uma leva de colagens por vez

// Fictício (PERFIS_MOCK) ou conta real (pessoas.js): o mesmo formato.
export const perfilPublico = perfilDe;

// Ponto de entrada de todo mundo: feed, comentários, sugestões. Clicar em você
// mesmo cai na tela de perfil, que é esta página com o que só você vê.
export function abrirPerfilDe(id) {
  if (!id || id === db.state.usuario.id) return irPara('perfil');
  if (!podeAbrir(id)) return toast('Esse perfil não existe mais.', 'aviso');
  irPara('usuario', id);
}

// ------------------------------- Os números -------------------------------
function numerosDe(p) {
  // Conta real: os números são os do servidor, e "retribui" é um fato — a
  // pessoa segue você agora —, não um sorteio. O nível não existe fora do save
  // de cada um, então fica nulo e a tela não mostra o selo.
  if (p.real) {
    return {
      seguidores: p.nSeguidores,
      seguindo: p.nSeguindo,
      nivel: null,
      desde: new Date(p.criadoEm),
      retribui: p.segueVoce,
    };
  }

  const rnd = mulberry32(sementeDoTexto(p.id));
  const dias = 40 + Math.floor(rnd() * 900);
  return {
    seguidores: 120 + Math.floor(rnd() * 4200),
    seguindo: 35 + Math.floor(rnd() * 460),
    nivel: 1 + Math.floor(rnd() * 5),
    desde: new Date(Date.now() - dias * 864e5),
    retribui: rnd() < 0.65,   // segue você de volta quando você segue
  };
}

// As redes de fora da pessoa. Nem todo mundo tem: perfil sem rede nenhuma é o
// que faz a informação valer alguma coisa quando ela aparece. A semente é um
// fio próprio (o id + um sufixo) para não deslocar os números de numerosDe.
export function redesDoPerfil(p) {
  if (p.real) return [];      // ligar contas de fora ainda é do save de cada um
  const rnd = mulberry32(sementeDoTexto(p.id + ':redes'));
  const arroba = p.handle.replace(/^@+/, '');
  const redes = [];
  if (rnd() < 0.7) redes.push({ id: 'instagram', usuario: arroba });
  if (rnd() < 0.45) redes.push({ id: 'pinterest', usuario: arroba });
  return redes;
}

// Amizade, no protótipo, é seguir e ser seguido de volta. Sem grafo social de
// verdade, a retribuição sai da mesma semente do id: @liamoreno sempre segue
// você de volta, @tomarruda nunca — em qualquer navegador. Quando existir
// backend, é esta função que vira uma consulta.
export const segueDeVolta = (id) => {
  const p = perfilPublico(id);
  return Boolean(p && numerosDe(p).retribui);
};

export const mesAno = (data) =>
  data.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

const postsDe = (id) => db.state.feed
  .filter(p => p.autor === id)
  .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

// As peças que aparecem nas publicações dela, sem repetir e na ordem em que
// postou. Post antigo pode citar peça que saiu do acervo (o usuário desligou a
// pasta): o que o catálogo não tem hoje simplesmente não entra.
// Post de look traz as camadas vestidas no avatar; post de colagem traz a
// colagem inteira. Os dois listam as peças em `itemId`, então o que interessa
// aqui é só de onde ler.
const pecasDoPost = (post) => post.camadas || post.colagem?.itens || [];

function pecasDe(id) {
  const vistas = new Map();
  for (const post of postsDe(id)) {
    for (const camada of pecasDoPost(post)) {
      if (vistas.has(camada.itemId)) continue;
      const peca = pecaDoCatalogo(camada.itemId);
      if (peca) vistas.set(camada.itemId, peca);
    }
  }
  return [...vistas.values()].slice(0, MAX_PECAS);
}

// --------------------------------- Tela -----------------------------------
export function montarUsuario() {
  $('#up-voltar').addEventListener('click', () => irPara('social'));

  // Curtir ou comentar aqui é curtir no feed: quando ele repinta, esta tela
  // repinta junto, senão o coração ficaria aceso só de um lado.
  aoAtualizarFeed(() => { if (viewAtual() === 'usuario') renderUsuario(); });
}

export async function aoEntrarNoUsuario() {
  const id = paramAtual();
  let p = perfilPublico(id);

  // Conta real que este navegador ainda não viu (link direto, ou um seguido de
  // outro aparelho): o cartão vem do servidor antes de a página existir.
  if (!p) {
    try {
      p = await carregarPerfil(id);
    } catch {
      toast('Perfil não encontrado.', 'aviso');
      return irPara('social');
    }
    // Deu tempo de a pessoa ir para outro lugar enquanto isso.
    if (paramAtual() !== id || viewAtual() !== 'usuario') return;
  }

  idAtual = id;
  renderUsuario();
  // Pular de um perfil para outro é a mesma tela com outro parâmetro: sem isto,
  // a página nova abriria na altura em que a anterior tinha parado.
  $('.view-usuario').scrollTop = 0;

  // O cartão de uma conta real envelhece — seguidores, "segue você", o rosto
  // que ela trocou —, então abrir a página o renova em segundo plano.
  if (p.real) {
    carregarPerfil(id).then(() => {
      if (idAtual === id && viewAtual() === 'usuario') renderUsuario();
    }).catch(() => {});
    return;
  }

  // Quem o sorteio do feed nunca escolheu chegaria aqui com a página vazia.
  // A primeira visita monta as colagens dela — com a semente do id, então são
  // sempre as mesmas — e elas passam a existir no feed de todo mundo.
  if (!postsDe(id).length && !gerando) {
    gerando = true;
    const fez = await gerarPostsDe(id, 2);
    gerando = false;
    if (fez && idAtual === id && viewAtual() === 'usuario') renderUsuario();
  }
}

function renderUsuario() {
  const p = perfilPublico(idAtual);
  if (!p) return;

  const n = numerosDe(p);
  const segue = db.state.usuario.seguindo.includes(p.id);
  const posts = postsDe(p.id);
  const curtidas = posts.reduce((soma, post) => soma + (post.curtidas || 0), 0);

  // O SVG nasce em 600×1200: quem o encolhe para caber na moldura é .avatar-svg,
  // a mesma caixa do perfil próprio. O fundo é a cor da pessoa, que é a do
  // retrato dela no feed.
  const moldura = el('div', { class: 'avatar-svg' });
  moldura.innerHTML = svgAvatar({
    aparencia: aparenciaDoPerfil(p),
    roupas: roupasDoPerfil(p),
  });
  $('#up-avatar').replaceChildren(moldura);
  $('#up-avatar').style.background = p.cor;

  $('#up-nome').replaceChildren(p.nome,
    ...(n.nivel == null ? [] : [chipNivel(n.nivel, { titulo: false })]));
  // Numa conta real "segue você" é fato, então aparece antes de você seguir —
  // ao contrário dos fictícios, onde mostrar o sorteio cedo estragaria a graça.
  $('#up-handle').textContent = `${p.handle} · no brechó desde ${mesAno(n.desde)}` +
    (p.real && p.segueVoce ? ' · segue você' : '');
  $('#up-bio').textContent = p.bio;
  $('#up-redes').replaceChildren(...chipsDeRedes(redesDoPerfil(p)));

  // Fictício: o sorteio não sabe que você o seguiu, então soma você à mão.
  // Conta real: o servidor já contou.
  const stats = [
    ['colagens', posts.length],
    ['curtidas', curtidas],
    ['seguidores', n.seguidores + (!p.real && segue ? 1 : 0)],
    ['seguindo', n.seguindo],
  ];
  $('#up-stats').replaceChildren(...stats.map(([rotulo, valor]) =>
    el('div', { class: 'stat' },
      el('strong', {}, String(valor)), el('small', {}, rotulo))));

  $('#up-acoes').replaceChildren(
    el('button', {
      class: segue ? 'btn-ghost' : 'btn-dark',
      onclick: () => alternarSeguir(p.id),
    }, segue ? 'Deixar de seguir' : 'Seguir'),
    el('button', { class: 'btn-ghost', onclick: () => irPara('social') }, 'Ver o feed')
  );

  renderPosts(p, posts);
  renderPecas(p);
  renderOutros(p);
}

function renderPosts(p, posts) {
  const nomeCurto = p.nome.split(' ')[0];
  $('#up-posts-sub').textContent = posts.length
    ? `${posts.length} ${posts.length === 1 ? 'colagem publicada' : 'colagens publicadas'} · ` +
      `a última ${tempoRelativo(posts[0].criadoEm)}`
    : `${nomeCurto} ainda não publicou nada.`;

  const caixa = $('#up-posts');
  if (!posts.length) {
    caixa.replaceChildren(el('p', { class: 'feed-vazio' },
      'Sem colagens por aqui — siga a pessoa para não perder a primeira.'));
    return;
  }
  caixa.replaceChildren(...posts.map(cardDoPost));
}

function renderPecas(p) {
  const pecas = pecasDe(p.id);

  $('#up-pecas-sub').textContent = pecas.length
    ? `${pecas.length} ${pecas.length === 1 ? 'peça' : 'peças'} que aparecem nas colagens ` +
      `de ${p.nome.split(' ')[0]}.`
    : 'As peças aparecem aqui quando houver colagem publicada.';

  $('#up-pecas').replaceChildren(...gradeDePecas(pecas));
}

// Rodapé: pular para a próxima pessoa sem voltar ao feed.
function renderOutros(p) {
  $('#up-outros').replaceChildren(...botoesDeOutrosPerfis(p.id));
}

// ------------------------- Pedaços que o perfil usa ------------------------
// As duas telas são a mesma página vista de fora e de dentro (ver perfil.js),
// então estas seções nascem aqui e o perfil próprio as enche com o que é dele:
// o guarda-roupa no lugar das peças dos looks, e a lista inteira de perfis.

// A célula é a mesma do guarda-roupa, sem aura nem arrastar.
export const gradeDePecas = (pecas) => pecas.map(peca =>
  el('div', {
    class: 'up-peca',
    title: `${nomeDaPeca(peca)} · ${rotuloCategoria(peca.cat)}`,
  },
    el('div', { class: 'peca-caixa', style: { '--esc': String(escalaGrade(peca)) } },
      el('img', { src: peca.src, alt: nomeDaPeca(peca), loading: 'lazy' }))
  ));

// Um atalho para a página de alguém: retrato, primeiro nome e o clique.
export const botaoDePerfil = (p) =>
  el('button', {
    class: 'up-outro',
    title: p.bio,
    onclick: () => abrirPerfilDe(p.id),
  },
    retrato(aparenciaDoPerfil(p), 40, p.cor, roupasDoPerfil(p)),
    el('small', {}, p.nome.split(' ')[0])
  );

// Rodapé do perfil público. `exceto` é quem já está na tela aberta.
export const botoesDeOutrosPerfis = (exceto = null, quantos = 6) =>
  PERFIS_MOCK.filter(o => o.id !== exceto).slice(0, quantos).map(botaoDePerfil);
