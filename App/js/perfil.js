// Perfil: a sua página no brechó.
//
// Duas colunas. À esquerda, o cartão de quem você é — avatar, nome, bio, os
// três números que importam e o que se faz com a página —, parado enquanto a
// vitrine rola. À direita, primeiro os amigos e o que falta fazer; depois a
// vitrine: roupas, looks e colagens.
//
// A vitrine é curada: mostra só o que você marcou com a estrela — ver
// favoritos.js. Ter 60 peças não vira uma parede de 60 peças; o perfil é o que
// você escolheu mostrar. Seção sem nada marcado some, e o que falta vira dica
// no bloco "Complete a sua vitrine" — que fica no alto, junto dos amigos —,
// com o atalho para onde se resolve.
//
// O que é da conta e não da página — contas conectadas, senha, sair, testes —
// mora no menu do pé do cartão e abre por cima, num modal, uma seção por vez.
//
// O que é progresso — missões do dia, XP, ferramentas por nível e a cápsula —
// mora na aba Tarefas (tarefas.js).

import { catalogo, item as pecaDoCatalogo } from './catalog.js';
import * as db from './db.js';
import * as auth from './auth.js';
import { svgAvatar } from './avatar.js';
import { el, $, shuffle, toast } from './util.js';
import { chipNivel } from './nivel.js';
import { irPara, viewAtual } from './router.js';
import { darPecasAleatorias } from './closet.js';
import { renderConexoes, chipsDeRedes, minhasRedes } from './conexoes.js';
import {
  gerarPostsFicticios, aoAtualizarFeed, COR_PROPRIA, postsDoAutor, garantirFeed,
} from './social.js';
import { atualizarBadge, montarVitrine } from './vitrine.js';
import { abrirLook } from './stylist.js';
import { abrirBoard } from './board.js';
import { abrirBuscaDePessoas } from './busca.js';
import { LIMITE_FAVORITOS } from './favoritos.js';
import { sincronizarSocial } from './pessoas.js';
import {
  gradeDePecas, perfilPublico, segueDeVolta, mesAno, cartaoDeObra, botaoDePerfil,
} from './usuario.js';

// Os seus posts moram no feed compartilhado (e, sem rede, no save até subirem).
const meusPosts = () => postsDoAutor(db.state.usuario.id);

const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

// Do mais novo para o mais velho: a vitrine abre pelo que você acabou de fazer.
const porData = (lista) => [...lista]
  .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

// As peças favoritas. O inventário guarda só o id, então a imagem vem do
// catálogo: favorita de acervo desligado simplesmente não entra.
const pecasFavoritas = () => db.favoritos('peca')
  .map(p => pecaDoCatalogo(p.id))
  .filter(Boolean);

export function montarPerfil() {
  montarEdicao();
  montarAjustes();
  montarConta();
  montarTestes();

  // A busca abre por cima do perfil e, ao fechar, refaz a página: quem foi
  // seguido lá dentro entra em "seguindo" e, se retribui, em "amigos".
  $('#btn-buscar-pessoas').addEventListener('click', () => abrirBuscaDePessoas(renderPerfil));

  // Os atalhos dos cabeçalhos ("Ver guarda-roupa →") levam à tela de origem.
  document.querySelectorAll('.view-perfil .pf-link[data-goto]').forEach(b =>
    b.addEventListener('click', () => irPara(b.dataset.goto)));

  // Curtir ou comentar aqui é curtir no feed: quando ele repinta, esta tela
  // repinta junto (o mesmo acordo do perfil público).
  aoAtualizarFeed(() => { if (viewAtual() === 'perfil') renderPerfil(); });

  renderPerfil();
}

export function renderPerfil() {
  const u = db.state.usuario;
  const curtidas = meusPosts().reduce((soma, post) => soma + (post.curtidas || 0), 0);

  // O SVG nasce em 600×1200 e quem o encolhe é .avatar-svg. O fundo é a cor
  // que assina os seus posts no feed — a sua, como cada perfil tem a dele.
  //
  // É aqui que as roupinhas do vestiário aparecem: o perfil é a sua página, e
  // a coleção é sua. No Stylist o avatar segue pelado, para a roupa
  // fotografada cair no corpo sem duas roupas sobrepostas.
  const moldura = el('div', { class: 'avatar-svg' });
  moldura.innerHTML = svgAvatar({ roupas: db.roupasEquipadas() });
  $('#perfil-avatar').replaceChildren(moldura);
  $('#perfil-avatar').style.background = COR_PROPRIA;

  $('#perfil-nome').replaceChildren(u.nome, chipNivel());
  $('#perfil-handle').replaceChildren(
    u.handle, el('br'), `no brechó desde ${mesAno(new Date(u.criadoEm))}`);
  $('#perfil-bio').textContent = u.bio;
  $('#perfil-bio').hidden = !u.bio;
  renderConta();
  // As suas são as que estão ligadas de verdade — o menu "Contas conectadas",
  // no pé do cartão, é onde se liga e desliga.
  const redes = minhasRedes();
  $('#perfil-redes').replaceChildren(...chipsDeRedes(redes));
  $('#pf-menu-conexoes').textContent =
    (redes.length ? plural(redes.length, 'ligada', 'ligadas') : 'nenhuma') + ' ›';

  // Três números no cartão; o resto vai no título, para quem passar o mouse.
  const amigos = meusAmigos();
  const stats = [
    ['peças', db.state.inventario.length,
      `${plural(db.state.looks.length, 'look', 'looks')} · ` +
      `${plural(db.state.boards.length, 'colagem', 'colagens')}`],
    ['seguidores', u.seguidores,
      `você segue ${plural(u.seguindo.length, 'pessoa', 'pessoas')}`],
    ['amigos', amigos.length,
      `${plural(curtidas, 'curtida', 'curtidas')} nos seus posts`],
  ];
  $('#perfil-stats').replaceChildren(...stats.map(([rotulo, valor, dica]) =>
    el('div', { class: 'pf-stat', title: dica },
      el('strong', {}, String(valor)), el('small', {}, rotulo))));

  $('#perfil-acoes').replaceChildren(
    el('button', { class: 'btn-dark', onclick: abrirEdicao }, 'Editar perfil'),
    el('div', { class: 'pf-dupla' },
      el('button', { class: 'btn-ghost', onclick: () => irPara('personagem') },
        'Personagem'),
      el('button', { class: 'btn-ghost', onclick: () => irPara('vestiario') },
        'Inventário'))
  );

  const pecas = renderPecas();
  const obras = renderObras();
  renderAmigos(amigos);
  renderDicas({ pecas, ...obras, amigos: amigos.length, redes: redes.length });
  renderConexoes(renderPerfil);
}

// ------------------------------- Vitrines ---------------------------------
// As duas seguem a mesma regra: aparece o que tem estrela, e a seção sem nada
// marcado some. Quem diz onde fica a estrela é o bloco de dicas.
function renderPecas() {
  const pecas = pecasFavoritas();
  const total = db.state.inventario.length;

  $('#pf-secao-pecas').hidden = !pecas.length;
  $('#perfil-pecas-sub').textContent = `${pecas.length} de ${total}`;
  $('#perfil-pecas').replaceChildren(...gradeDePecas(pecas));
  return pecas.length;
}

// Looks do Stylist e colagens em seções separadas, até três de cada (a
// estrela não deixa passar disso — ver favoritos.js; o corte aqui é para save
// antigo que favoritou mais). O clique devolve ao editor de origem.
function renderObras() {
  const secao = (tipo, chave, abrir) => {
    const mostrados = porData(db.favoritos(tipo)).slice(0, LIMITE_FAVORITOS[tipo]);
    $(`#pf-secao-${chave}`).hidden = !mostrados.length;
    $(`#perfil-${chave}-sub`).textContent =
      `${mostrados.length} de ${LIMITE_FAVORITOS[tipo]}`;
    $(`#perfil-${chave}`).replaceChildren(...mostrados.map(item =>
      cartaoFavorito({ ...item, tipo }, () => abrir(item.id))));
    return mostrados.length;
  };
  return {
    looks: secao('look', 'looks', (id) => { abrirLook(id); irPara('stylist'); }),
    colagens: secao('colagem', 'colagens', (id) => { irPara('board'); abrirBoard(id); }),
  };
}

// As peças que entraram no look (camadas) ou na colagem (itens), sem repetir
// e sem as que saíram do catálogo. Etiqueta de texto da colagem não tem peça.
const pecasDaObra = (item) => [...new Set(
  (item.camadas || item.itens || []).map(c => c.itemId).filter(Boolean)
)].map(pecaDoCatalogo).filter(Boolean);

// O cartão é o mesmo das publicações no perfil dos outros (usuario.js).
const cartaoFavorito = (item, abrir) => cartaoDeObra({
  nome: item.nome,
  thumb: item.thumb,
  tipo: item.tipo,
  pecas: pecasDaObra(item),
  selo: item.publicado ? 'no feed' : null,
  abrir,
});

// --------------------------------- Amigos ---------------------------------
// Amigo é mão dupla: você segue e a pessoa segue de volta (usuario.js diz
// quem retribui). Quem você segue e não retribui fica no feed, não aqui.
const meusAmigos = () => db.state.usuario.seguindo
  .filter(segueDeVolta)
  .map(perfilPublico)
  .filter(Boolean);

function renderAmigos(amigos) {
  const seguindo = db.state.usuario.seguindo.length;

  $('#perfil-amigos-sub').textContent = amigos.length
    ? `${amigos.length} de ${seguindo} ${seguindo === 1 ? 'segue' : 'seguem'} de volta`
    : seguindo
      ? `você segue ${plural(seguindo, 'pessoa', 'pessoas')}, ninguém retribuiu ainda`
      : 'quem você seguir e seguir de volta aparece aqui';

  $('#perfil-amigos').replaceChildren(
    ...amigos.map(botaoDePerfil),
    el('button', {
      class: 'pf-amigo', title: 'Procurar pessoas',
      onclick: () => abrirBuscaDePessoas(renderPerfil),
    },
      el('span', { class: 'pf-mais' }, '+'),
      el('small', {}, 'procurar'))
  );
}

// ------------------------- Complete a sua vitrine -------------------------
// O lugar das seções vazias: em vez de um buraco com "nada aqui", uma linha
// que diz o que falta e um botão que leva até lá. Some quando não falta nada.
function renderDicas({ pecas, looks, colagens, redes }) {
  const s = db.state;
  const dicas = [
    !s.inventario.length
      ? ['🛍', 'loja', 'Garimpe a sua primeira peça', 'a vitrine do dia troca todo dia',
        'Vitrine', () => irPara('vitrine')]
      : !pecas && ['★', 'inventario', 'Favorite uma roupa',
        'abra uma peça no guarda-roupa e use ☆ Favoritar', 'Guarda-roupa', () => irPara('closet')],
    !looks && ['★', 'stylist',
      s.looks.length ? 'Favorite um look' : 'Monte o seu primeiro look',
      s.looks.length ? 'marque com ★ em "Meus looks", no Stylist' : 'vista o avatar e salve no Stylist',
      'Stylist', () => irPara('stylist')],
    !colagens && ['★', 'board',
      s.boards.length ? 'Favorite uma colagem' : 'Monte uma colagem',
      s.boards.length ? 'marque com ★ na lista da Colagem' : 'junte peças num board de moda',
      'Colagem', () => irPara('board')],
    !s.usuario.bio && ['✎', 'perfil', 'Escreva uma bio', 'uma linha sobre o seu garimpo',
      'Editar', abrirEdicao],
    !redes && ['↗', 'social', 'Conecte o Instagram ou o Pinterest',
      'para publicar as colagens fora daqui', 'Conectar', () => abrirAjustes('conexoes')],
  ].filter(Boolean);

  $('#pf-dicas').hidden = !dicas.length;
  $('#pf-dicas-lista').replaceChildren(...dicas.map(([icone, cor, titulo, sub, rotulo, acao]) =>
    el('div', { class: 'pf-dica' },
      el('span', { class: 'pf-dica-icone', style: { background: `var(--${cor})` } }, icone),
      el('div', {}, el('strong', {}, titulo), el('small', {}, sub)),
      el('button', { class: 'btn-ghost', onclick: acao }, rotulo))));
}

// ----------------------------- Editar perfil ------------------------------
// Nome, @ e bio são o que os outros leem na sua página. O formulário toma o
// lugar do miolo do cartão enquanto está aberto.
function montarEdicao() {
  // Nome e @ são da conta: vão para o servidor, valem em qualquer navegador e
  // o @ é único entre todo mundo (por isso o servidor pode recusar). A bio é do
  // save, e continua local.
  $('#perfil-editar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const u = db.state.usuario;
    const nome = $('#pf-nome').value.trim();
    const handle = $('#pf-handle').value.trim().replace(/^@+/, '');

    if (!nome || !handle) return toast('Nome e @ não podem ficar vazios.', 'aviso');

    try {
      const conta = await auth.atualizarConta({ nome, handle });
      u.nome = conta.nome;
      u.handle = conta.handle;
    } catch (erro) {
      return toast(erro.message, 'aviso');
    }

    u.bio = $('#pf-bio').value.trim();
    db.salvar();
    fecharEdicao();
    renderPerfil();
    toast('Perfil atualizado.');
  });

  $('#pf-cancelar').addEventListener('click', fecharEdicao);
}

function abrirEdicao() {
  const u = db.state.usuario;
  $('#pf-nome').value = u.nome;
  $('#pf-handle').value = u.handle.replace(/^@+/, '');
  $('#pf-bio').value = u.bio;
  $('#pf-corpo').hidden = true;
  $('#perfil-editar').hidden = false;
  $('#pf-nome').focus();
}

const fecharEdicao = () => {
  $('#perfil-editar').hidden = true;
  $('#pf-corpo').hidden = false;
};

// -------------------------------- Ajustes ---------------------------------
// O menu do pé do cartão abre o modal com uma seção só: a que foi clicada.
const TITULOS_DE_AJUSTE = {
  conexoes: 'Contas conectadas',
  conta: 'Sua conta',
  testes: 'Testes',
};

function montarAjustes() {
  const modal = $('#modal-ajustes');

  document.querySelectorAll('.pf-menu [data-ajuste]').forEach(b =>
    b.addEventListener('click', () => abrirAjustes(b.dataset.ajuste)));

  $('#aj-fechar').addEventListener('click', fecharAjustes);
  // Clique no fundo escuro fecha; clique dentro da caixa, não.
  modal.addEventListener('click', (e) => { if (e.target === modal) fecharAjustes(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) fecharAjustes();
  });
}

function abrirAjustes(qual) {
  $('#aj-titulo').textContent = TITULOS_DE_AJUSTE[qual];
  document.querySelectorAll('#modal-ajustes [data-ajuste]').forEach(s => {
    s.hidden = s.dataset.ajuste !== qual;
  });
  $('#modal-ajustes').hidden = false;
  document.body.classList.add('com-modal');
}

function fecharAjustes() {
  $('#modal-ajustes').hidden = true;
  $('#form-senha').hidden = true;
  document.body.classList.remove('com-modal');
}

// --------------------------------- Conta ----------------------------------
// O que é da conta, e não da partida: e-mail, senha e sair. Apagar os dados do
// jogo (em Testes) não mexe na conta, e sair não apaga save nenhum
// — o guarda-roupa continua guardado, esperando o próximo login.
function montarConta() {
  const form = $('#form-senha');

  $('#btn-trocar-senha').addEventListener('click', () => {
    form.hidden = !form.hidden;
    $('#senha-erro').hidden = true;
    if (!form.hidden) $('#senha-atual').focus();
  });

  $('#senha-cancelar').addEventListener('click', () => { form.hidden = true; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#senha-erro').hidden = true;
    try {
      await auth.trocarSenha({
        atual: $('#senha-atual').value,
        nova: $('#senha-nova').value,
      });
    } catch (erro) {
      $('#senha-erro').textContent = erro.message;
      $('#senha-erro').hidden = false;
      return;
    }
    form.reset();
    form.hidden = true;
    toast('Senha trocada. As outras sessões foram encerradas.');
  });

  // Recarregar depois de sair não é preguiça: meia dúzia de telas já montadas
  // seguram peças, looks e feed da conta que saiu. Zerar isso à mão seria uma
  // função de desmontar por tela — e um bug novo a cada tela nova.
  $('#btn-sair').addEventListener('click', async () => {
    await auth.sair();
    db.encerrarEstado();
    location.reload();
  });
}

function renderConta() {
  const conta = auth.contaAtual();
  if (!conta) return;
  const papel = conta.papel === 'admin' ? ' · administrador' : '';
  $('#conta-resumo').textContent = `${conta.email} · ${conta.handle}${papel}`;
}

// -------------------------------- Testes ----------------------------------
function montarTestes() {
  $('#btn-reset-dia').addEventListener('click', () => {
    db.state.dia.resgates = 0;
    db.salvar();
    atualizarBadge();
    toast('Resgates de hoje liberados.');
  });

  $('#btn-dar-pecas').addEventListener('click', () => {
    darPecasAleatorias(10, shuffle(catalogo.itens));
    renderPerfil();
    montarVitrine();
  });

  // currentTarget é zerado assim que o handler devolve o controle (no await),
  // então o botão precisa ficar guardado numa variável.
  const botaoPosts = $('#btn-posts');
  botaoPosts.addEventListener('click', async () => {
    botaoPosts.disabled = true;
    await gerarPostsFicticios(3);
    botaoPosts.disabled = false;
  });

  $('#btn-xp').addEventListener('click', () => {
    db.ganharXP(50, 'teste');
    db.salvar();
    renderPerfil();
  });

  // Reset é do jogador, não do acervo: o que foi cadastrado (peças subidas,
  // marcas, cores) sobrevive, porque um dia vai migrar para a base do site.
  $('#btn-reset').addEventListener('click', () => {
    if (!confirm(
      'Apagar inventário, looks, colagens, feed e XP deste navegador? ' +
      'As peças que você adicionou e o registro de marcas e cores ficam.'
    )) return;
    db.resetar();
    location.reload();
  });

  $('#btn-apagar-acervo').addEventListener('click', () => {
    const quantas = db.state.pecasProprias.length;
    if (!quantas) return toast('Nenhuma peça guardada neste navegador — as do acervo vivem em assets/.');
    if (!confirm(
      `Apagar as ${quantas} peças guardadas neste navegador, mais marcas e cores? ` +
      'Isso não volta. O acervo em assets/acervo.json não é tocado.'
    )) return;
    db.apagarAcervoLocal();
    location.reload();
  });
}

// Ao abrir a sua página, quem seguiu você desde a última vez já conta: o amigo
// que retribuiu entra em "amigos" sem ninguém precisar recarregar.
export function aoEntrarNoPerfil() {
  renderPerfil();
  const repintar = () => { if (viewAtual() === 'perfil') renderPerfil(); };
  sincronizarSocial().then(repintar);
  garantirFeed().then(repintar);
}
