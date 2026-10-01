// Perfil: a sua página no brechó.
//
// É a mesma página que os outros veem quando você aparece no feed (usuario.js)
// — avatar, bio, desde quando, números e as vitrines —, só que vista de dentro:
// aqui dá para editar a identidade e o personagem, ligar contas e usar os
// botões de teste. As duas telas dividem o esqueleto de marcação; o que muda é
// de onde vêm os dados.
//
// A diferença de fundo é que a sua página é curada: as três vitrines (looks do
// Stylist, colagens e roupas) mostram só o que você marcou com a
// estrela — ver favoritos.js. Ter 60 peças não vira uma parede de 60 peças; o
// perfil é o que você escolheu mostrar.
//
// O que é progresso — missões do dia, XP, ferramentas por nível e a cápsula —
// mora na aba Tarefas (tarefas.js).

import { catalogo, item as pecaDoCatalogo, nomeDaPeca } from './catalog.js';
import * as db from './db.js';
import * as auth from './auth.js';
import { svgAvatar } from './avatar.js';
import { el, $, shuffle, toast, tempoRelativo } from './util.js';
import { chipNivel } from './nivel.js';
import { irPara, viewAtual } from './router.js';
import { darPecasAleatorias } from './closet.js';
import { renderConexoes, chipsDeRedes, minhasRedes } from './conexoes.js';
import { gerarPostsFicticios, aoAtualizarFeed, COR_PROPRIA } from './social.js';
import { atualizarBadge, montarVitrine } from './vitrine.js';
import { abrirLook } from './stylist.js';
import { abrirBoard } from './board.js';
import { abrirBuscaDePessoas } from './busca.js';
import { sincronizarSocial } from './pessoas.js';
import {
  gradeDePecas, botaoDePerfil, perfilPublico, segueDeVolta, mesAno,
} from './usuario.js';

const meusPosts = () => db.state.feed
  .filter(p => p.autor === db.state.usuario.id)
  .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

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
  montarConta();
  montarTestes();

  // A busca abre por cima do perfil e, ao fechar, refaz a página: quem foi
  // seguido lá dentro entra em "seguindo" e, se retribui, em "amigos".
  $('#btn-buscar-pessoas').addEventListener('click', () => abrirBuscaDePessoas(renderPerfil));

  // Curtir ou comentar aqui é curtir no feed: quando ele repinta, esta tela
  // repinta junto (o mesmo acordo do perfil público).
  aoAtualizarFeed(() => { if (viewAtual() === 'perfil') renderPerfil(); });

  renderPerfil();
}

export function renderPerfil() {
  const u = db.state.usuario;
  const posts = meusPosts();
  const curtidas = posts.reduce((soma, post) => soma + (post.curtidas || 0), 0);

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
  $('#perfil-handle').textContent =
    `${u.handle} · no brechó desde ${mesAno(new Date(u.criadoEm))}`;
  $('#perfil-bio').textContent = u.bio;
  renderConta();
  // As suas são as que estão ligadas de verdade — a seção "Contas conectadas",
  // mais abaixo, é onde se liga e desliga.
  $('#perfil-redes').replaceChildren(...chipsDeRedes(minhasRedes()));

  const stats = [
    ['peças', db.state.inventario.length],
    ['looks', db.state.looks.length],
    ['colagens', db.state.boards.length],
    ['curtidas', curtidas],
    ['seguidores', u.seguidores],
    ['seguindo', u.seguindo.length],
    ['amigos', meusAmigos().length],
  ];
  $('#perfil-stats').replaceChildren(...stats.map(([rotulo, valor]) =>
    el('div', { class: 'stat' },
      el('strong', {}, String(valor)), el('small', {}, rotulo))));

  $('#perfil-acoes').replaceChildren(
    el('button', { class: 'btn-dark', onclick: () => irPara('vestiario') },
      'Abrir inventário'),
    el('button', { class: 'btn-ghost', onclick: () => irPara('personagem') },
      'Editar personagem'),
    el('button', { class: 'btn-ghost', onclick: abrirEdicao }, 'Editar perfil'),
    el('button', { class: 'btn-ghost', onclick: () => irPara('tarefas') },
      'Ver as tarefas')
  );

  renderLooks();
  renderColagens();
  renderPecas();
  renderAmigos();
  renderConexoes(renderPerfil);
}

// ------------------------------- Vitrines ---------------------------------
// As três seguem a mesma regra: aparece o que tem estrela. Quando não há nada
// marcado, o texto diz onde fica a estrela em vez de deixar um buraco.
function renderLooks() {
  const favoritos = porData(db.favoritos('look'));
  const total = db.state.looks.length;

  $('#perfil-looks-sub').textContent = favoritos.length
    ? `${favoritos.length} de ${total} ${total === 1 ? 'look' : 'looks'} do Stylist · ` +
      `o último ${tempoRelativo(favoritos[0].criadoEm)}`
    : total
      ? `Você tem ${total} ${total === 1 ? 'look salvo' : 'looks salvos'}. ` +
        'Marque com ★ em "Meus looks", no Stylist, para mostrar aqui.'
      : 'Monte um look no Stylist e favorite com ★ para ele aparecer aqui.';

  $('#perfil-looks').replaceChildren(...favoritos.map(l => cartaoFavorito(l, () => {
    abrirLook(l.id);
    irPara('stylist');
  })));
}

function renderColagens() {
  const favoritos = porData(db.favoritos('colagem'));
  const total = db.state.boards.length;

  $('#perfil-colagens-sub').textContent = favoritos.length
    ? `${favoritos.length} de ${total} ${total === 1 ? 'colagem' : 'colagens'} · ` +
      `a última ${tempoRelativo(favoritos[0].criadoEm)}`
    : total
      ? `Você tem ${total} ${total === 1 ? 'colagem salva' : 'colagens salvas'}. ` +
        'Marque com ★ na lista da Colagem para mostrar aqui.'
      : 'Monte uma colagem na aba Colagem e favorite com ★ para ela aparecer aqui.';

  $('#perfil-colagens').replaceChildren(...favoritos.map(b => cartaoFavorito(b, () => {
    irPara('board');
    abrirBoard(b.id);
  })));
}

// Miniatura do que foi salvo, com o nome e o atalho de volta para o editor.
function cartaoFavorito(item, abrir) {
  return el('button', {
    class: 'fav-card',
    title: `Abrir "${item.nome}"`,
    onclick: abrir,
  },
    el('div', { class: 'fav-thumb' },
      item.thumb
        ? el('img', { src: item.thumb, alt: item.nome, loading: 'lazy' })
        : el('span', { class: 'sem-thumb' }, 'sem prévia')),
    el('strong', {}, item.nome),
    el('small', {}, item.publicado ? 'no feed' : 'só no perfil')
  );
}

function renderPecas() {
  const pecas = pecasFavoritas();
  const total = db.state.inventario.length;

  $('#perfil-pecas-sub').textContent = pecas.length
    ? `${pecas.length} de ${total} ${total === 1 ? 'peça' : 'peças'} do guarda-roupa · ` +
      pecas.map(nomeDaPeca).slice(0, 3).join(', ') + (pecas.length > 3 ? '…' : '')
    : total
      ? `Você tem ${total} ${total === 1 ? 'peça' : 'peças'}. Abra uma no guarda-roupa ` +
        'e use "☆ Favoritar" para ela aparecer aqui.'
      : 'Garimpe na vitrine do dia para começar o guarda-roupa.';

  $('#perfil-pecas').replaceChildren(...gradeDePecas(pecas));
}

// --------------------------------- Amigos ---------------------------------
// Amigo é mão dupla: você segue e a pessoa segue de volta (usuario.js diz
// quem retribui). Quem você segue e não retribui fica no feed, não aqui.
const meusAmigos = () => db.state.usuario.seguindo
  .filter(segueDeVolta)
  .map(perfilPublico)
  .filter(Boolean);

function renderAmigos() {
  const amigos = meusAmigos();
  const seguindo = db.state.usuario.seguindo.length;

  $('#perfil-amigos-sub').textContent = amigos.length
    ? `${amigos.length} de ${seguindo} ${seguindo === 1 ? 'pessoa que você segue' : 'pessoas que você segue'} ` +
      `${amigos.length === 1 ? 'segue' : 'seguem'} você de volta.`
    : seguindo
      ? `Você segue ${seguindo} ${seguindo === 1 ? 'pessoa' : 'pessoas'}, mas ninguém retribuiu ainda.`
      : 'Siga gente no feed — quem seguir de volta vira amigo e aparece aqui.';

  $('#perfil-amigos').replaceChildren(...amigos.map(botaoDePerfil));
}

// ----------------------------- Editar perfil ------------------------------
// Nome, @ e bio são o que os outros leem na sua página. Sem backend não há
// cadastro: o formulário grava direto no usuário de db.state.
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
  $('#perfil-editar').hidden = false;
  $('#pf-nome').focus();
}

const fecharEdicao = () => { $('#perfil-editar').hidden = true; };

// --------------------------------- Conta ----------------------------------
// O que é da conta, e não da partida: e-mail, senha e sair. Apagar os dados do
// jogo (mais abaixo, em Testes) não mexe na conta, e sair não apaga save nenhum
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

  // A fonte das peças muda o que o catálogo carrega, então a troca recarrega.
  const botaoFonte = $('#btn-fonte');
  const rotuloFonte = () => {
    const so = db.state.usuario.preferencias.soPecasProprias;
    botaoFonte.textContent = so ? 'Usar também o acervo da pasta' : 'Usar só as minhas peças';
    botaoFonte.title = so
      ? 'Hoje só as peças que você adicionou aparecem no app.'
      : 'Hoje as 59 peças de assets/ entram junto com as suas.';
  };
  rotuloFonte();
  botaoFonte.addEventListener('click', () => {
    const p = db.state.usuario.preferencias;
    p.soPecasProprias = !p.soPecasProprias;
    db.salvar();
    location.reload();
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
  sincronizarSocial().then(() => { if (viewAtual() === 'perfil') renderPerfil(); });
}
