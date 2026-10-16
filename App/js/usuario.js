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

import { PERFIS_MOCK, CATEGORIAS, RARIDADE, escalaGrade, CORES_FAVORITAS } from './config.js';
import { catalogo, item as pecaDoCatalogo, nomeDaPeca, rotuloCategoria, proporcao, trocarImagem } from './catalog.js';
import { miniaturaSoltaAtual, miniaturaSoltaPronta } from './render.js';
import * as db from './db.js';
import { aparenciaDoPerfil, retrato } from './avatar.js';
import { el, $, mulberry32, sementeDoTexto, shuffle, toast } from './util.js';
import { ico, emo } from './icones.js';
import { abrirBuscaDePessoas } from './busca.js';
import { perfilDe, podeAbrir, carregarPerfil, roupasDoPerfil } from './pessoas.js';
import { chipsDeRedes } from './conexoes.js';
import { colecoesDaPeca, chipDaColecao } from './colecoes.js';
import { deslizavel, trocarComSlide } from './deslizar.js';
import { reordenavel } from './reordenar.js';
import { favoritasPrimeiro } from './minhavitrine.js';
import { irPara, paramAtual, viewAtual } from './router.js';
import {
  cardDoPost, alternarSeguir, gerarPostsDe, aoAtualizarFeed, postsDoAutor, garantirFeed,
} from './social.js';


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
  if (p.real) return p.redes || [];   // só as ligadas de verdade (lambda/redes.py)
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
  return [...vistas.values()];
}

const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

// Ids de peça → peças do catálogo, sem as que saíram dele.
const doCatalogo = (ids = []) => ids.map(pecaDoCatalogo).filter(Boolean);

// --------------------------------- Tela -----------------------------------
export function montarUsuario() {
  montarListaDePecas();
  montarFichaDePeca();
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

  // O retrato redondo, na cor da pessoa (a do retrato dela no feed), com o
  // nível no anel. Conta real não tem nível fora do save dela: anel sem selo.
  pintarFoto($('#up-avatar'), {
    foto: retratoDoPerfil(aparenciaDoPerfil(p), p.cor, roupasDoPerfil(p)),
    nivel: n.nivel,
  });

  // Numa conta real "segue você" é fato, então aparece antes de você seguir —
  // ao contrário dos fictícios, onde mostrar o sorteio cedo estragaria a graça.
  $('#up-handle').replaceChildren(p.handle,
    ...(p.real && p.segueVoce ? [el('span', { class: 'pf-segue-voce' }, 'segue você')] : []));
  // A cor favorita dela, discreta como no seu perfil: uma bolinha ao lado do nome.
  const fav = CORES_FAVORITAS.find(c => c.nome === p.corFavorita);
  $('#up-nome').replaceChildren(p.nome, fav
    ? el('span', { class: 'pf-cor-fav', style: { background: fav.hex }, title: `Cor favorita: ${fav.nome}` })
    : '');
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

  // O guarda-roupa inteiro e a wishlist dela, cada um num botão. Conta de
  // versão antiga do app, que não mandou a lista, fica sem o botão.
  const roupas = guardaRoupaDe(p);
  const desejos = wishlistDe(p);
  $('#up-listas').replaceChildren(...botoesDeListas(p.nome.split(' ')[0], roupas, desejos));

  const abas = p.real && (p.obras || p.favoritos) ? abasDaVitrine(p) : abasDosPosts(p, posts);
  abas.push(abaDePessoas(p));
  pintarAbas($('#up-abas'), $('#up-conteudo'), abas, abaAtual,
    (id) => { abaAtual = id; renderUsuario(); });
  if (postAberto) renderPostAberto();
}

// Perfil de exemplo, ou conta antiga sem vitrine: o que ela publicou, e as
// peças que aparecem nas publicações.
function abasDosPosts(p, posts) {
  // O look do perfil de exemplo sai solto, redesenhado das camadas com o rosto
  // dela; post do feed compartilhado (só ids de peças) fica com a miniatura.
  const aparencia = aparenciaDoPerfil(p);
  const obras = (lista) => lista.map(post => cartaoDeObra({
    nome: post.nome,
    thumb: post.tipo !== 'board' && post.camadas?.length
      ? miniaturaSoltaPronta(post.camadas, aparencia) || miniaturaSoltaAtual(post.camadas, aparencia)
      : post.thumb,
    solto: post.tipo !== 'board' && Boolean(post.camadas?.length),
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
    abaDeRoupasDe(p, []),
  ];
}

// A prévia do guarda-roupa dela, na ordem em que ela arrumou (a conta real já
// manda a lista assim: as favoritas primeiro, ou o que ela arrastou).
function abaDeRoupasDe(p, favoritas) {
  const todas = guardaRoupaDe(p) || [];
  return {
    id: 'roupas', icone: 'cabide', rotulo: 'Roupas', grade: 'pf-grade-pecas',
    itens: gradeDaPrevia(todas, favoritas,
      () => abrirListaDePecas(`Guarda-roupa de ${p.nome.split(' ')[0]}`, todas)),
    vazio: 'Nenhuma roupa ainda',
  };
}

// ------------------------------- A vitrine --------------------------------
// O que o perfil da pessoa mostra a ela: as roupas com estrela e todos os
// looks e colagens, nas mesmas abas e com os mesmos quadrinhos do seu perfil
// (perfil.js). Versão antiga do app só mandou os favoritos: ficam eles.
function abasDaVitrine(p) {
  const favoritos = p.favoritos || {};
  const todas = p.obras || { looks: favoritos.looks, colagens: favoritos.colagens };
  // Com `obras` a lista já vem na ordem do perfil dela; só os favoritos da
  // versão antiga precisam ir com a estrela na frente.
  const obras = (tipo, lista = []) => (p.obras ? lista : favoritasPrimeiro(lista)).map(obra => cartaoDeObra({
    nome: obra.nome || (tipo === 'look' ? 'Look' : 'Colagem'),
    thumb: obra.thumb,
    solto: tipo === 'look' && Boolean(p.obras),
    tipo,
    selo: obra.favorito ? ico('estrela-cheia') : null,
    abrir: () => abrirObra(obra, tipo),
  }));
  return [
    abaDeRoupasDe(p, doCatalogo(favoritos.pecas)),
    { id: 'looks', icone: 'varinha', rotulo: 'Stylists', grade: 'pf-grade-obras',
      itens: obras('look', todas.looks), vazio: 'Nenhum look ainda' },
    { id: 'colagens', icone: 'quadro', rotulo: 'Colagens', grade: 'pf-grade-obras',
      itens: obras('colagem', todas.colagens), vazio: 'Nenhuma colagem ainda' },
  ];
}

// ------------------------------- A prévia ---------------------------------
// A aba Roupas é uma prévia do guarda-roupa: as favoritas primeiro e, para
// completar, as outras peças. A lista inteira mora no botão Guarda-roupa, e o
// último quadrinho da prévia também a abre. Looks e colagens seguem a mesma
// ordem: as (até três) favoritas na frente, depois o resto.
export const PREVIA_DE_ROUPAS = 15;

// A grade da aba Roupas: a prévia e, se sobrou peça de fora, o "ver todas".
// Tocar numa peça abre a ficha dela, e o deslizar segue pela lista inteira.
export function gradeDaPrevia(pecas, favoritas, abrirTudo, { minha = false } = {}) {
  const marcadas = new Set(favoritas.map(p => p.id));
  // Passou do tamanho da prévia: o último quadrinho vira o "ver todas", para a
  // grade fechar certinho (15 = três ou cinco por fileira).
  const cabem = pecas.length > PREVIA_DE_ROUPAS ? PREVIA_DE_ROUPAS - 1 : PREVIA_DE_ROUPAS;
  const celulas = gradeDePecas(pecas.slice(0, cabem), {
    favoritas: marcadas, abrir: (i) => abrirFichaDePeca(pecas, i, { minha }) });
  const sobra = pecas.length - cabem;
  if (sobra > 0) {
    celulas.push(el('button', { type: 'button', class: 'up-peca pf-ver-todas', onclick: abrirTudo },
      el('strong', {}, `+${sobra}`), el('small', {}, 'ver todas')));
  }
  return celulas;
}

// ------------------------- Guarda-roupa e wishlist -------------------------
// Conta real: as listas que ela mandou (null quando a versão do app dela não
// manda). Perfil de exemplo: as peças das publicações mais um punhado do
// acervo, e uma wishlist, os dois sorteados com a semente do id — sempre os
// mesmos, em qualquer navegador.
const ROUPAS_DE_EXEMPLO = 24;
const DESEJOS_DE_EXEMPLO = 8;

function sorteioDoAcervo(id, fio, quantos, fora = new Set()) {
  const rnd = mulberry32(sementeDoTexto(id + fio));
  const ordem = shuffle([...catalogo.itens].sort((a, b) => a.id < b.id ? -1 : 1), rnd);
  return ordem.filter(peca => !fora.has(peca.id)).slice(0, quantos);
}

export function guardaRoupaDe(p) {
  if (p.real) return p.guardaRoupa ? doCatalogo(p.guardaRoupa) : null;
  const dosPosts = pecasDe(p.id);
  const ja = new Set(dosPosts.map(x => x.id));
  return [...dosPosts, ...sorteioDoAcervo(p.id, ':guarda-roupa',
    Math.max(0, ROUPAS_DE_EXEMPLO - dosPosts.length), ja)];
}

export function wishlistDe(p) {
  if (p.real) return p.wishlist ? doCatalogo(p.wishlist) : null;
  const tem = new Set((guardaRoupaDe(p) || []).map(x => x.id));
  return sorteioDoAcervo(p.id, ':wishlist', DESEJOS_DE_EXEMPLO, tem);
}

// Os dois botões embaixo dos outros: abrem a lista inteira num modal. Lista
// nula (conta que não mandou) não tem botão.
export function botoesDeListas(dono, roupas, desejos, { minha = false, aoFechar = null } = {}) {
  const botao = (icone, rotulo, lista, titulo, vazio) => lista && el('button', {
    type: 'button', class: 'pf-lista-btn',
    onclick: () => abrirListaDePecas(titulo, lista, { vazio, aoFechar, minha }),
  }, ico(icone), el('span', {}, rotulo), el('strong', {}, String(lista.length)));
  return [
    botao('cabide', 'Guarda-roupa', roupas, minha ? 'Seu guarda-roupa' : `Guarda-roupa de ${dono}`,
      'Nenhuma peça ainda'),
    botao('coracao', 'Wishlist', desejos, minha ? 'Sua wishlist' : `Wishlist de ${dono}`,
      minha ? 'Abra uma peça na Loja ou no perfil de alguém e toque no ♡' : 'Nada na wishlist ainda'),
  ].filter(Boolean);
}

// O modal das listas: a grade das peças; tocar numa abre a ficha dela, onde
// mora o ♡ da wishlist. `aoFechar` repinta quem abriu, para os números dos
// botões acompanharem.
let aoFecharLista = null;

export function abrirListaDePecas(titulo, pecas, { vazio = '', aoFechar = null, minha = false } = {}) {
  aoFecharLista = aoFechar;
  $('#lp-titulo').textContent = titulo;
  $('#lp-corpo').replaceChildren(pecas.length
    ? el('div', { class: 'pf-grade pf-grade-pecas' },
      ...gradeDePecas(pecas, { abrir: (i) => abrirFichaDePeca(pecas, i, { minha }) }))
    : el('p', { class: 'lp-vazio' }, vazio));
  $('#modal-lista').hidden = false;
  document.body.classList.add('com-modal');
}

// Só destrava a rolagem da página quando não sobrou modal aberto (a ficha da
// peça abre por cima da lista).
const destravarSeNada = () => {
  if (!document.querySelector('.modal:not([hidden])')) document.body.classList.remove('com-modal');
};

function fecharLista() {
  $('#modal-lista').hidden = true;
  destravarSeNada();
  const depois = aoFecharLista;
  aoFecharLista = null;
  depois?.();
}

export function montarListaDePecas() {
  const modal = $('#modal-lista');
  $('#lp-fechar').addEventListener('click', fecharLista);
  modal.addEventListener('click', (e) => { if (e.target === modal) fecharLista(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) fecharLista();
  });
}

// ------------------------------ A ficha da peça ----------------------------
// Tocar numa peça do perfil (o seu ou o de alguém), das listas ou de um look
// aberto abre a ficha dela, como a do guarda-roupa: a foto grande, a
// raridade, o nome e as linhas de informação. Arrastar para o lado (ou as
// setas) passa para a vizinha da mesma lista. É aqui, vendo a peça, que ela
// entra na sua wishlist: a peça que você ainda não tem leva o ♡ embaixo.
let fichaPecas = [];
let fichaPos = 0;
let fichaMinha = false;

export function abrirFichaDePeca(pecas, i, { minha = false } = {}) {
  fichaPecas = pecas;
  fichaMinha = minha;
  pintarFicha(i);
  $('#modal-pp').hidden = false;
  document.body.classList.add('com-modal');
}

function fecharFicha() {
  $('#modal-pp').hidden = true;
  destravarSeNada();
}

// A raridade de quem não é você não viaja com o perfil: aparece a sua cópia,
// se você tem a peça, ou a raridade fixa do acervo; sem nenhuma, fica sem.
const raridadeDaPeca = (id) =>
  RARIDADE[db.pecaDoInventario(id)?.raridade] || RARIDADE[db.raridadesFixas.get(id)] || null;

function pintarFicha(i) {
  fichaPos = Math.max(0, Math.min(i, fichaPecas.length - 1));
  const peca = fichaPecas[fichaPos];
  if (!peca) return fecharFicha();
  const img = $('#pp-img');
  trocarImagem(img, peca, 420 * proporcao(peca));
  img.alt = nomeDaPeca(peca);

  $('#pp-pos').textContent = fichaPecas.length > 1 ? `${fichaPos + 1}/${fichaPecas.length}` : '';
  $('#pp-ant').disabled = fichaPos <= 0;
  $('#pp-prox').disabled = fichaPos >= fichaPecas.length - 1;

  const r = raridadeDaPeca(peca.id);
  const cor = r && (r.aura && r.aura !== 'arco-iris' ? r.aura : r.cor);
  const nome = peca.nome?.trim() || nomeDaPeca(peca);
  const linhas = [['Tipo', CATEGORIAS[peca.cat]?.nome ?? rotuloCategoria(peca.cat)]];
  if (peca.cor?.trim()) linhas.push(['Cor', peca.cor.trim()]);
  if (peca.marca?.trim()) linhas.push(['Marca', peca.marca.trim()]);
  const tem = db.temPeca(peca.id);

  $('#pp-dados').replaceChildren(
    r ? el('span', { class: 'pp-raridade', style: { '--rar-borda': cor } }, r.nome) : null,
    el('h3', { class: 'pp-nome' }, nome),
    el('p', { class: 'pp-linhas' }, ...linhas.map(([rotulo, valor]) =>
      el('span', { class: 'pp-linha', dataset: { rotulo } }, valor))),
    el('div', { class: 'pp-rodape' },
      el('div', { class: 'col-chips pp-colecoes' }, ...colecoesDaPeca(peca.id).map(chipDaColecao)),
      tem
        ? (fichaMinha ? null : el('span', { class: 'pp-tenho' }, ico('ok'), ' Está no seu guarda-roupa'))
        : botaoDesejo(peca, null, { rotulo: true })));
}

function montarFichaDePeca() {
  const modal = $('#modal-pp');
  const cartao = $('#pp-cartao');
  const ir = (passo) => pintarFicha(fichaPos + passo);
  const pode = (passo) => Boolean(fichaPecas[fichaPos + passo]);
  $('#pp-fechar').addEventListener('click', fecharFicha);
  $('#pp-ant').addEventListener('click', () => pode(-1) && trocarComSlide(cartao, -1, ir));
  $('#pp-prox').addEventListener('click', () => pode(1) && trocarComSlide(cartao, 1, ir));
  deslizavel(cartao, { pode, ir });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) fecharFicha();
    // A coleção abre na tela dela: a ficha e a lista por baixo saem da frente.
    if (e.target.closest('.col-chip')) { fecharFicha(); if (!$('#modal-lista').hidden) fecharLista(); }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (modal.hidden) return;
    if (e.key === 'Escape') { e.stopImmediatePropagation(); fecharFicha(); }
    if (e.key === 'ArrowLeft' && pode(-1)) trocarComSlide(cartao, -1, ir);
    if (e.key === 'ArrowRight' && pode(1)) trocarComSlide(cartao, 1, ir);
  }, true);
}

// O ♡ de uma peça: põe ou tira da sua wishlist. Peça que você já tem não
// leva o botão — não faz sentido desejar o que está no seu closet. `rotulo`
// é o botão largo da ficha, com o texto ao lado do coração.
export function botaoDesejo(peca, aoMudar = null, { rotulo = false } = {}) {
  const pintar = (b) => {
    const tem = db.naWishlist(peca.id);
    b.classList.toggle('ativo', tem);
    b.title = tem ? 'Tirar da wishlist' : 'Pôr na wishlist';
    b.setAttribute('aria-pressed', String(tem));
    b.replaceChildren(ico(tem ? 'coracao-cheio' : 'coracao'),
      ...(rotulo ? [el('span', {}, tem ? 'Na sua wishlist' : 'Pôr na wishlist')] : []));
  };
  const b = el('button', {
    type: 'button', class: 'pf-desejo' + (rotulo ? ' largo' : ''),
    onclick: (e) => {
      e.stopPropagation();
      const entrou = db.alternarWishlist(peca.id);
      pintar(b);
      toast(entrou ? 'Na sua wishlist.' : 'Saiu da wishlist.');
      aoMudar?.(entrou);
    },
  });
  pintar(b);
  return b;
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
        el('div', { class: 'pf-grade' }, ...gradeDePecas(pecas, { abrir: (i) => abrirFichaDePeca(pecas, i) })))
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
  $('#up-post-corpo').replaceChildren(cardDoPost(post, { abrivel: false }));
}

function fecharPost() {
  if (!postAberto && !obraAberta) return;
  postAberto = null;
  obraAberta = false;
  $('#modal-post').hidden = true;
  $('#up-post-corpo').replaceChildren();
  destravarSeNada();
}

// ------------------------- Pedaços que o perfil usa ------------------------
// As duas telas são a mesma página vista de fora e de dentro (ver perfil.js),
// então estas seções nascem aqui e o perfil próprio as enche com o que é dele:
// as favoritas no lugar das peças dos posts, e os seus looks no lugar dos dela.

// A célula é a mesma do guarda-roupa, sem aura. Tocar chama `abrir` com a
// posição da peça (a ficha, com o ♡ da wishlist lá dentro). `favoritas` (ids)
// ganham a estrela no canto.
export const gradeDePecas = (pecas, { favoritas = null, abrir = null } = {}) => pecas.map((peca, i) =>
  el('button', {
    type: 'button', class: 'up-peca', dataset: { id: peca.id },
    title: `${nomeDaPeca(peca)} · ${rotuloCategoria(peca.cat)}`,
    onclick: () => (abrir ? abrir(i) : abrirFichaDePeca(pecas, i)),
  },
    el('div', { class: 'peca-caixa', style: { '--esc': String(escalaGrade(peca)) } },
      el('img', { src: peca.src, alt: nomeDaPeca(peca), loading: 'lazy', draggable: 'false' })),
    favoritas?.has(peca.id) ? el('span', { class: 'pf-estrela', title: 'Favorita' }, ico('estrela-cheia')) : null
  ));

// Um look ou colagem na grade: só a miniatura, no formato dela, como um post
// na grade do Instagram. O nome vai no título; `selo` é o ícone no canto, e
// `resumo` (curtidas e comentários) aparece por cima quando o mouse passa.
// `solto` é o look sem moldura: o boneco inteiro, sem fundo nem borda.
// `thumb` pode ser uma promessa (o look ainda sendo desenhado): a vaga fica
// vazia e a imagem entra quando ficar pronta.
export function cartaoDeObra({ id = null, nome, thumb, tipo, solto = false, selo = null, resumo = null, abrir }) {
  const imagem = (src) => el('img', { src, alt: nome, loading: 'lazy', draggable: 'false' });
  const espera = thumb && typeof thumb.then === 'function';
  const foto = el('div', { class: 'pf-obra-foto' },
    espera ? el('span', { class: 'sem-thumb' }) : thumb ? imagem(thumb) : el('span', { class: 'sem-thumb' }, nome),
    selo ? el('span', { class: 'pf-etiqueta' }, selo) : null,
    resumo ? el('span', { class: 'pf-obra-resumo' }, ...resumo) : null);
  if (espera) {
    thumb.then(url => foto.querySelector('.sem-thumb')?.replaceWith(imagem(url)),
      () => { const v = foto.querySelector('.sem-thumb'); if (v) v.textContent = nome; });
  }
  return el('button', {
    class: `pf-obra ${tipo}${solto ? ' solto' : ''}`, title: nome, 'aria-label': nome, onclick: abrir,
    ...(id ? { dataset: { id } } : {}),
  }, foto);
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

// O retrato do topo com o nível em volta dele: o anel enche com o XP do
// nível (`pct`, de 0 a 1; sem ele, o anel vem cheio) e a moeda embaixo diz o
// número. Sem nível, só o anel.
export function pintarFoto(caixa, { foto, nivel = null, pct = 1, dica = '' }) {
  caixa.style.setProperty('--xp', `${Math.round(pct * 100)}%`);
  caixa.title = dica || (nivel == null ? '' : `Nível ${nivel}`);
  caixa.replaceChildren(foto, nivel == null ? '' : el('span', { class: 'pf-nivel' },
    el('small', {}, 'Nv'), el('strong', {}, String(nivel))));
}

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

  const grade = ativa.itens.length && el('div', { class: `pf-grade ${ativa.grade || ''}` }, ...ativa.itens);
  // `reordenar`: no seu perfil, segurar e arrastar muda a ordem da aba.
  if (grade && ativa.reordenar) reordenavel(grade, { aoSoltar: ativa.reordenar });
  conteudo.replaceChildren(grade
    || el('div', { class: 'pf-vazio' },
      el('span', { class: 'pf-vazio-icone' }, ico(ativa.icone)),
      el('p', {}, ativa.vazio),
      ativa.botao ? el('button', { class: 'btn-ghost', onclick: ativa.botao[1] }, ativa.botao[0]) : null));
}
