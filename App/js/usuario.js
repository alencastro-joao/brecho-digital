// Perfil de outra pessoa — a página pública de quem aparece no feed.
//
// Aqui não há contas ligadas nem botões de teste: isso é do dono da conta. O
// desenho é o do seu perfil (perfil.js), no jeito do Instagram: o retrato, os
// números, o nome e a bio em cima; embaixo, abas com a grade de cada uma — as
// roupas, looks e colagens que a pessoa favoritou com a estrela. É o que uma
// conta real manda ao servidor (pessoas.js); clicar num look ou colagem abre a
// miniatura grande, com as peças, num modal.
//
// Perfil de exemplo, ou conta que ainda não mandou os favoritos (versão antiga
// do app), não tem vitrine: aí as abas mostram as publicações e as peças delas,
// e clicar numa publicação abre o cartão inteiro do feed.
//
// Os números não vêm de lugar nenhum — são sorteados a partir do id, como o
// avatar (ver avatar.js). Mesma semente, mesma pessoa: @liamoreno tem sempre os
// mesmos seguidores e a mesma data de entrada, em qualquer navegador, sem
// ninguém cadastrar nada. Quando existir backend, é essa função que some.

import { PERFIS_MOCK, escalaGrade } from './config.js';
import { item as pecaDoCatalogo, nomeDaPeca, rotuloCategoria } from './catalog.js';
import * as db from './db.js';
import { aparenciaDoPerfil, retrato } from './avatar.js';
import { el, $, mulberry32, sementeDoTexto, toast } from './util.js';
import { ico, emo } from './icones.js';
import { abrirBuscaDePessoas } from './busca.js';
import { perfilDe, podeAbrir, carregarPerfil, roupasDoPerfil } from './pessoas.js';
import { chipNivel } from './nivel.js';
import { chipsDeRedes } from './conexoes.js';
import { irPara, paramAtual, viewAtual } from './router.js';
import {
  cardDoPost, alternarSeguir, gerarPostsDe, aoAtualizarFeed, postsDoAutor, garantirFeed,
} from './social.js';

const MAX_PECAS = 12;

let idAtual = null;          // de quem é a página aberta
let gerando = false;         // uma leva de colagens por vez
let postAberto = null;       // o post aberto no modal, se houver
let obraAberta = false;      // ou um look/colagem favorito
let abaAtual = null;         // a aba de baixo escolhida; null é a primeira

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

// Os de uma conta real vêm do feed compartilhado; os de um perfil de exemplo,
// do save. postsDoAutor junta os dois, já do mais novo para o mais velho.
// Função, e não apelido: social.js ainda não terminou de carregar aqui.
const postsDe = (id) => postsDoAutor(id);

// As peças que aparecem nas publicações dela, sem repetir e na ordem em que
// postou. Post antigo pode citar peça que saiu do acervo (o usuário desligou a
// pasta): o que o catálogo não tem hoje simplesmente não entra.
// Post de look traz as camadas vestidas no avatar; post de colagem traz a
// colagem inteira. Os dois listam as peças em `itemId`, então o que interessa
// aqui é só de onde ler. Post do feed compartilhado traz só a lista de ids.
const pecasDoPost = (post) =>
  post.pecas?.map(itemId => ({ itemId })) || post.camadas || post.colagem?.itens || [];

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

const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

// Ids de peça → peças do catálogo, sem as que saíram dele.
const doCatalogo = (ids = []) => ids.map(pecaDoCatalogo).filter(Boolean);

// --------------------------------- Tela -----------------------------------
export function montarUsuario() {
  $('#up-voltar').addEventListener('click', () => irPara('social'));

  const modal = $('#modal-post');
  $('#up-post-fechar').addEventListener('click', fecharPost);
  modal.addEventListener('click', (e) => { if (e.target === modal) fecharPost(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) fecharPost();
  });

  // Curtir ou comentar aqui é curtir no feed: quando ele repinta, esta tela
  // repinta junto, senão o coração ficaria aceso só de um lado.
  aoAtualizarFeed(() => { if (viewAtual() === 'usuario') renderUsuario(); });
}

export async function aoEntrarNoUsuario() {
  const id = paramAtual();
  let p = perfilPublico(id);
  fecharPost();

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

  if (idAtual !== id) abaAtual = null;
  idAtual = id;
  renderUsuario();
  // Pular de um perfil para outro é a mesma tela com outro parâmetro: sem isto,
  // a página nova abriria na altura em que a anterior tinha parado.
  $('.view-usuario').scrollTop = 0;

  // O cartão de uma conta real envelhece — seguidores, "segue você", o rosto
  // que ela trocou —, então abrir a página o renova em segundo plano. As
  // publicações dela também: vêm do feed compartilhado.
  if (p.real) {
    const repintarSeAinda = () => {
      if (idAtual === id && viewAtual() === 'usuario') renderUsuario();
    };
    carregarPerfil(id).then(repintarSeAinda).catch(() => {});
    garantirFeed().then(repintarSeAinda);
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

  // O retrato redondo, na cor da pessoa (a do retrato dela no feed).
  $('#up-avatar').replaceChildren(
    retratoDoPerfil(aparenciaDoPerfil(p), p.cor, roupasDoPerfil(p)));

  // Numa conta real "segue você" é fato, então aparece antes de você seguir —
  // ao contrário dos fictícios, onde mostrar o sorteio cedo estragaria a graça.
  $('#up-handle').textContent = p.handle;
  $('#up-nivel').replaceChildren(
    ...(n.nivel == null ? [] : [chipNivel(n.nivel)]),
    ...(p.real && p.segueVoce ? [el('span', { class: 'pf-segue-voce' }, 'segue você')] : []));
  $('#up-nome').textContent = p.nome;
  $('#up-bio').textContent = p.bio;
  $('#up-bio').hidden = !p.bio;
  $('#up-redes').replaceChildren(...chipsDeRedes(redesDoPerfil(p)));

  // Três números, como no seu perfil; as curtidas vão no título.
  // Fictício: o sorteio não sabe que você o seguiu, então soma você à mão.
  // Conta real: o servidor já contou — e, com a página completa, os amigos.
  const stats = [
    ['publicações', posts.length, `${plural(curtidas, 'curtida', 'curtidas')} nas publicações`],
    ['seguidores', n.seguidores + (!p.real && segue ? 1 : 0), ''],
    p.amigos
      ? ['amigos', p.amigos.length, `segue ${plural(n.seguindo, 'pessoa', 'pessoas')}`]
      : ['seguindo', n.seguindo, ''],
  ];
  $('#up-stats').replaceChildren(...stats.map(([rotulo, valor, dica]) =>
    numeroDoPerfil(valor, rotulo, dica)));

  $('#up-acoes').replaceChildren(
    el('button', {
      class: segue ? 'btn-ghost' : 'btn-dark',
      onclick: () => alternarSeguir(p.id),
    }, segue ? 'Seguindo' : 'Seguir'));

  const abas = p.real && p.favoritos ? abasDaVitrine(p.favoritos) : abasDosPosts(p, posts);
  abas.push(abaDePessoas(p));
  pintarAbas($('#up-abas'), $('#up-conteudo'), abas, abaAtual,
    (id) => { abaAtual = id; renderUsuario(); });
  if (postAberto) renderPostAberto();
}

// Perfil de exemplo, ou conta antiga sem vitrine: o que ela publicou, e as
// peças que aparecem nas publicações.
function abasDosPosts(p, posts) {
  const obras = (lista) => lista.map(post => cartaoDeObra({
    nome: post.nome,
    thumb: post.thumb,
    tipo: post.tipo === 'board' ? 'colagem' : 'look',
    selo: post.curtido ? ico('coracao-cheio') : null,
    resumo: [ico('coracao-cheio'), ` ${post.curtidas || 0}`, ' ', emo('💬'), ` ${(post.comentarios || []).length}`],
    abrir: () => abrirPost(post.id),
  }));
  return [
    { id: 'looks', icone: 'varinha', rotulo: 'Stylists', grade: 'pf-grade-obras',
      itens: obras(posts.filter(post => post.tipo !== 'board')), vazio: 'Nenhum look ainda' },
    { id: 'colagens', icone: 'quadro', rotulo: 'Colagens', grade: 'pf-grade-obras',
      itens: obras(posts.filter(post => post.tipo === 'board')), vazio: 'Nenhuma colagem ainda' },
    { id: 'roupas', icone: 'cabide', rotulo: 'Roupas', grade: 'pf-grade-pecas',
      itens: gradeDePecas(pecasDe(p.id)), vazio: 'Nenhuma roupa ainda' },
  ];
}

// ------------------------------- A vitrine --------------------------------
// O que o perfil da pessoa mostra a ela: roupas, looks e colagens com estrela,
// nas mesmas abas e com os mesmos quadrinhos do seu perfil (perfil.js).
function abasDaVitrine(favoritos) {
  const obras = (tipo, lista = []) => lista.map(obra => cartaoDeObra({
    nome: obra.nome || (tipo === 'look' ? 'Look' : 'Colagem'),
    thumb: obra.thumb,
    tipo,
    abrir: () => abrirObra(obra, tipo),
  }));
  return [
    { id: 'roupas', icone: 'cabide', rotulo: 'Roupas', grade: 'pf-grade-pecas',
      itens: gradeDePecas(doCatalogo(favoritos.pecas)), vazio: 'Nenhuma roupa favorita' },
    { id: 'looks', icone: 'varinha', rotulo: 'Stylists', grade: 'pf-grade-obras',
      itens: obras('look', favoritos.looks), vazio: 'Nenhum look favorito' },
    { id: 'colagens', icone: 'quadro', rotulo: 'Colagens', grade: 'pf-grade-obras',
      itens: obras('colagem', favoritos.colagens), vazio: 'Nenhuma colagem favorita' },
  ];
}

// Amigos dela, quando a página veio completa do servidor (conta real); senão,
// outros perfis para pular para a próxima pessoa sem voltar ao feed.
function abaDePessoas(p) {
  const pessoas = p.amigos
    ? p.amigos.map(perfilPublico).filter(Boolean).map(botaoDePerfil)
    : botoesDeOutrosPerfis(p.id);
  return {
    id: 'pessoas', icone: 'usuario', rotulo: p.amigos ? 'Amigos' : 'Pessoas', grade: 'pf-grade-pessoas',
    itens: [...pessoas, botaoProcurar(() => abrirBuscaDePessoas(renderUsuario))],
  };
}

// Um look ou colagem favorito, aberto grande no modal das publicações: a
// miniatura e as peças que o compõem. Só leitura — é a vitrine de outra pessoa.
function abrirObra(obra, tipo) {
  fecharPost();
  obraAberta = true;
  const pecas = doCatalogo(obra.pecas);
  $('#up-post-titulo').textContent = obra.nome || (tipo === 'look' ? 'Look' : 'Colagem');
  $('#up-post-corpo').replaceChildren(
    el('div', { class: `up-obra-foto ${tipo}` },
      obra.thumb
        ? el('img', { src: obra.thumb, alt: obra.nome || '' })
        : el('span', { class: 'sem-thumb' }, 'sem prévia')),
    pecas.length
      ? el('div', { class: 'up-obra-pecas' },
        el('small', {}, plural(pecas.length, 'peça', 'peças')),
        el('div', { class: 'pf-grade' }, ...gradeDePecas(pecas)))
      : null);
  $('#modal-post').hidden = false;
  document.body.classList.add('com-modal');
}

// ------------------------------ Post aberto -------------------------------
// O cartão do feed inteiro (cardDoPost): curtir, comentar e o menu. Quando o
// feed repinta, renderUsuario repinta o modal junto.
function abrirPost(id) {
  postAberto = id;
  renderPostAberto();
  $('#modal-post').hidden = false;
  document.body.classList.add('com-modal');
}

function renderPostAberto() {
  const post = postsDe(idAtual).find(x => x.id === postAberto);
  if (!post) return fecharPost();
  $('#up-post-titulo').textContent = post.nome;
  $('#up-post-corpo').replaceChildren(cardDoPost(post));
}

function fecharPost() {
  if (!postAberto && !obraAberta) return;
  postAberto = null;
  obraAberta = false;
  $('#modal-post').hidden = true;
  $('#up-post-corpo').replaceChildren();
  document.body.classList.remove('com-modal');
}

// ------------------------- Pedaços que o perfil usa ------------------------
// As duas telas são a mesma página vista de fora e de dentro (ver perfil.js),
// então estas seções nascem aqui e o perfil próprio as enche com o que é dele:
// as favoritas no lugar das peças dos posts, e os seus looks no lugar dos dela.

// A célula é a mesma do guarda-roupa, sem aura nem arrastar.
export const gradeDePecas = (pecas) => pecas.map(peca =>
  el('div', {
    class: 'up-peca',
    title: `${nomeDaPeca(peca)} · ${rotuloCategoria(peca.cat)}`,
  },
    el('div', { class: 'peca-caixa', style: { '--esc': String(escalaGrade(peca)) } },
      el('img', { src: peca.src, alt: nomeDaPeca(peca), loading: 'lazy' }))
  ));

// Um look ou colagem na grade: só a miniatura, no formato dela, como um post
// na grade do Instagram. O nome vai no título; `selo` é o ícone no canto, e
// `resumo` (curtidas e comentários) aparece por cima quando o mouse passa.
export function cartaoDeObra({ nome, thumb, tipo, selo = null, resumo = null, abrir }) {
  return el('button', { class: `pf-obra ${tipo}`, title: nome, 'aria-label': nome, onclick: abrir },
    el('div', { class: 'pf-obra-foto' },
      thumb
        ? el('img', { src: thumb, alt: nome, loading: 'lazy' })
        : el('span', { class: 'sem-thumb' }, nome),
      selo ? el('span', { class: 'pf-etiqueta' }, selo) : null,
      resumo ? el('span', { class: 'pf-obra-resumo' }, ...resumo) : null));
}

// Um atalho para a página de alguém: o retrato redondo e o primeiro nome.
// É a aba de amigos do seu perfil e a de pessoas daqui.
export const botaoDePerfil = (p) =>
  el('button', {
    class: 'pf-amigo',
    title: p.bio,
    onclick: () => abrirPerfilDe(p.id),
  },
    retrato(aparenciaDoPerfil(p), 64, p.cor, roupasDoPerfil(p)),
    el('small', {}, p.nome.split(' ')[0])
  );

// O último da aba de pessoas: o "+" que abre a busca.
export const botaoProcurar = (aoFechar) =>
  el('button', { class: 'pf-amigo', title: 'Procurar pessoas', onclick: aoFechar },
    el('span', { class: 'pf-mais' }, '+'),
    el('small', {}, 'procurar'));

// Outros perfis do perfil público. `exceto` é quem já está na tela aberta.
export const botoesDeOutrosPerfis = (exceto = null, quantos = 6) =>
  PERFIS_MOCK.filter(o => o.id !== exceto).slice(0, quantos).map(botaoDePerfil);

// O retrato grande do topo: o busto dentro do anel na cor da paleta. Nasce em
// 150px; no celular o CSS o encolhe (zoom), sem redesenhar.
export const retratoDoPerfil = (aparencia, cor, roupas) =>
  retrato(aparencia, 150, cor, roupas, 1.75);

// Um dos três números do topo: o valor em negrito e o rótulo ao lado.
export const numeroDoPerfil = (valor, rotulo, dica = '', aoTocar = null) =>
  el(aoTocar ? 'button' : 'div', {
    class: 'pf-stat', title: dica || null, ...(aoTocar ? { type: 'button', onclick: aoTocar } : {}),
  }, el('strong', {}, String(valor)), el('small', {}, rotulo));

// As abas de baixo do perfil, o seu e o dos outros: um ícone por aba e a grade
// da escolhida embaixo. Aba vazia mostra uma linha curta e, se houver, o
// atalho para onde se resolve. `atual` nulo abre na primeira.
export function pintarAbas(nav, conteudo, abas, atual, escolher) {
  const ativa = abas.find(a => a.id === atual) || abas[0];
  nav.replaceChildren(...abas.map(a => el('button', {
    type: 'button', role: 'tab', class: 'pf-aba' + (a === ativa ? ' ativa' : ''),
    title: a.rotulo, 'aria-selected': String(a === ativa),
    onclick: () => { if (a !== ativa) escolher(a.id); },
  }, ico(a.icone), el('span', {}, a.rotulo))));

  conteudo.replaceChildren(ativa.itens.length
    ? el('div', { class: `pf-grade ${ativa.grade || ''}` }, ...ativa.itens)
    : el('div', { class: 'pf-vazio' },
      el('span', { class: 'pf-vazio-icone' }, ico(ativa.icone)),
      el('p', {}, ativa.vazio),
      ativa.botao ? el('button', { class: 'btn-ghost', onclick: ativa.botao[1] }, ativa.botao[0]) : null));
}
