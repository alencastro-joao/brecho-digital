// Perfil de outra pessoa — a página pública de quem aparece no feed.
//
// Aqui não há contas ligadas nem botões de teste: isso é do dono da conta. O
// que se vê de fora é quem a pessoa é (avatar, bio, desde quando), o que ela
// fez (looks e colagens publicados) e o que ela veste (as peças deles).
// O desenho é o do seu perfil (perfil.js): o cartão à esquerda e a coluna da
// direita com outras pessoas, as peças e as publicações. Clicar numa
// publicação abre o cartão inteiro do feed, num modal, para curtir e comentar.
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

// As peças de um post só, para a fileira do cartão.
const pecasDeUmPost = (post) => [...new Set(pecasDoPost(post).map(c => c.itemId))]
  .map(pecaDoCatalogo).filter(Boolean);

const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

// --------------------------------- Tela -----------------------------------
export function montarUsuario() {
  $('#up-voltar').addEventListener('click', () => irPara('social'));
  $('#up-buscar').addEventListener('click', () => abrirBuscaDePessoas(renderUsuario));

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
  $('#up-handle').replaceChildren(
    p.handle, el('br'), `no brechó desde ${mesAno(n.desde)}`,
    ...(p.real && p.segueVoce ? [el('span', { class: 'pf-segue-voce' }, 'segue você')] : []));
  $('#up-bio').textContent = p.bio;
  $('#up-bio').hidden = !p.bio;
  $('#up-redes').replaceChildren(...chipsDeRedes(redesDoPerfil(p)));

  // Três números, como no seu cartão; as curtidas vão no título.
  // Fictício: o sorteio não sabe que você o seguiu, então soma você à mão.
  // Conta real: o servidor já contou.
  const stats = [
    ['publicações', posts.length, `${plural(curtidas, 'curtida', 'curtidas')} nas publicações`],
    ['seguidores', n.seguidores + (!p.real && segue ? 1 : 0), ''],
    ['seguindo', n.seguindo, ''],
  ];
  $('#up-stats').replaceChildren(...stats.map(([rotulo, valor, dica]) =>
    el('div', { class: 'pf-stat', title: dica },
      el('strong', {}, String(valor)), el('small', {}, rotulo))));

  $('#up-acoes').replaceChildren(
    el('button', {
      class: segue ? 'btn-ghost' : 'btn-dark',
      onclick: () => alternarSeguir(p.id),
    }, segue ? 'Deixar de seguir' : 'Seguir'),
    el('button', { class: 'btn-ghost', onclick: () => irPara('social') }, 'Ver o feed')
  );

  renderOutros(p);
  renderVazio(p, posts, segue);
  renderPecas(p);
  renderPosts(posts);
  if (postAberto) renderPostAberto();
}

// Sem publicação nenhuma, o lugar das seções vazias é um aviso só — o mesmo
// bloco tracejado do "Complete a sua vitrine" do seu perfil.
function renderVazio(p, posts, segue) {
  const caixa = $('#up-vazio');
  caixa.hidden = posts.length > 0;
  if (caixa.hidden) return;

  caixa.replaceChildren(
    el('h3', {}, `${p.nome.split(' ')[0]} ainda não publicou nada`),
    el('div', { class: 'pf-dica' },
      el('span', { class: 'pf-dica-icone', style: { background: 'var(--social)' } }, '♡'),
      el('div', {},
        el('strong', {}, segue ? 'Você já segue' : 'Siga para não perder a primeira'),
        el('small', {}, 'os looks e as colagens publicados aparecem aqui e no seu feed')),
      segue ? null : el('button', {
        class: 'btn-ghost', onclick: () => alternarSeguir(p.id),
      }, 'Seguir')));
}

function renderPecas(p) {
  const pecas = pecasDe(p.id);
  $('#up-secao-pecas').hidden = !pecas.length;
  $('#up-pecas-sub').textContent = 'as que aparecem nas publicações';
  $('#up-pecas').replaceChildren(...gradeDePecas(pecas));
}

// O mesmo cartão dos seus favoritos, em duas seções como no seu perfil:
// Stylists e Colagens. Curtidas e comentários vão na linha de baixo do nome, e
// o clique abre a publicação inteira.
function renderPosts(posts) {
  const secao = (chave, lista, um, muitos) => {
    $(`#up-secao-${chave}`).hidden = !lista.length;
    $(`#up-${chave}-sub`).textContent = lista.length
      ? `${plural(lista.length, um, muitos)} · a última ${tempoRelativo(lista[0].criadoEm)}`
      : '';
    $(`#up-${chave}`).replaceChildren(...lista.map(post => cartaoDeObra({
      nome: post.nome,
      thumb: post.thumb,
      tipo: post.tipo === 'board' ? 'colagem' : 'look',
      pecas: pecasDeUmPost(post),
      selo: post.curtido ? '♥ curtido' : null,
      resumo: `♥ ${post.curtidas || 0} · 💬 ${(post.comentarios || []).length}`,
      abrir: () => abrirPost(post.id),
    })));
  };
  secao('looks', posts.filter(post => post.tipo !== 'board'), 'look', 'looks');
  secao('colagens', posts.filter(post => post.tipo === 'board'), 'colagem', 'colagens');
}

// Pular para a próxima pessoa sem voltar ao feed.
function renderOutros(p) {
  $('#up-outros').replaceChildren(...botoesDeOutrosPerfis(p.id));
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
  if (!postAberto) return;
  postAberto = null;
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

// Quantas peças a fileira de baixo do cartão de look mostra antes do "+N".
const PECAS_NO_CARTAO = 4;

// O cartão de um look ou colagem: a miniatura no formato dela, o nome, um
// resumo e a fileira das peças que o compõem — num brechó, o que interessa num
// look é de onde saiu cada peça. `selo` é o rótulo escuro no canto da foto.
export function cartaoDeObra({ nome, thumb, tipo, pecas, selo = null, resumo = null, abrir }) {
  const sobra = pecas.length - PECAS_NO_CARTAO;
  return el('button', { class: `pf-obra ${tipo}`, title: `Abrir "${nome}"`, onclick: abrir },
    el('div', { class: 'pf-obra-foto' },
      thumb
        ? el('img', { src: thumb, alt: nome, loading: 'lazy' })
        : el('span', { class: 'sem-thumb' }, 'sem prévia'),
      selo ? el('span', { class: 'pf-etiqueta' }, selo) : null),
    el('div', { class: 'pf-obra-info' },
      el('strong', {}, nome),
      el('small', {}, [
        tipo === 'look' ? 'Look' : 'Colagem',
        plural(pecas.length, 'peça', 'peças'),
        resumo,
      ].filter(Boolean).join(' · '))),
    pecas.length
      ? el('div', { class: 'pf-obra-pecas' },
        ...pecas.slice(0, PECAS_NO_CARTAO).map(p =>
          el('span', { class: 'pf-obra-peca', title: nomeDaPeca(p) },
            el('img', { src: p.src, alt: nomeDaPeca(p), loading: 'lazy' }))),
        sobra > 0 ? el('span', { class: 'pf-obra-peca mais' }, `+${sobra}`) : null)
      : null
  );
}

// Um atalho para a página de alguém: o retrato redondo e o primeiro nome.
// É a fileira de amigos do seu perfil e a de outros perfis daqui.
export const botaoDePerfil = (p) =>
  el('button', {
    class: 'pf-amigo',
    title: p.bio,
    onclick: () => abrirPerfilDe(p.id),
  },
    retrato(aparenciaDoPerfil(p), 54, p.cor, roupasDoPerfil(p)),
    el('small', {}, p.nome.split(' ')[0])
  );

// "Outros perfis" do perfil público. `exceto` é quem já está na tela aberta.
export const botoesDeOutrosPerfis = (exceto = null, quantos = 6) =>
  PERFIS_MOCK.filter(o => o.id !== exceto).slice(0, quantos).map(botaoDePerfil);
