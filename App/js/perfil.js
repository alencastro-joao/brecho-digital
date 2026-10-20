// Perfil: a sua página no brechó, no jeito do Instagram.
//
// Em cima, o retrato redondo com o nível no anel em volta, o nome, o @, a bio,
// os três números e os botões. Embaixo, abas com a grade de cada uma: roupas,
// looks, colagens, coleções e amigos.
//
// A vitrine é curada: mostra só o que você marcou com a estrela — ver
// favoritos.js. Ter 60 peças não vira uma parede de 60 peças; o perfil é o que
// você escolheu mostrar. Aba sem nada mostra uma linha curta e o atalho para
// onde se resolve.
//
// O que é da conta e não da página — cores, contas conectadas, senha, sair,
// testes — mora na engrenagem ao lado dos botões e abre por cima, num modal, uma
// seção por vez.
//
// O que é progresso — missões do dia, XP, ferramentas por nível e a cápsula —
// mora na aba Tarefas (tarefas.js).

import { catalogo, item as pecaDoCatalogo } from './catalog.js';
import * as db from './db.js';
import * as auth from './auth.js';
import { cabeca, aparenciaAtual } from './avatar.js';
import { miniaturaSoltaAtual, miniaturaSoltaPronta } from './render.js';
import { el, $, shuffle, toast } from './util.js';
import { confirmar, pedirTexto } from './janela.js';
import { volume, mudarVolume, tocar, VOLUME_PADRAO } from './sons.js';
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
import { sincronizarSocial, quantosMeSeguem } from './pessoas.js';
import { PALETAS, paletaAtual, escolherPaleta } from './paleta.js';
import { GRUPOS_DE_COLECAO, capaDaColecao, abrirColecao } from './colecoes.js';
import { escalaGrade, logoDaColecao, CORES_FAVORITAS } from './config.js';
import { brilhoDoEstilo } from './efeitos.js';
import {
  perfilPublico, gradeDaPrevia, abrirListaDePecas, segueDeVolta, cartaoDeObra, botaoDePerfil, botaoProcurar, botoesDeListas,
  retratoDoPerfil, pintarFoto, numeroDoPerfil, pintarAbas,
} from './usuario.js';
import { ico } from './icones.js';
import { pecasFavoritas, minhasRoupas, meusLooks, minhasColagens } from './minhavitrine.js';

// Os seus posts moram no feed compartilhado (e, sem rede, no save até subirem).
const meusPosts = () => postsDoAutor(db.state.usuario.id);

const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;


export function montarPerfil() {
  montarEdicao();
  montarAjustes();
  montarConta();
  montarTestes();

  // O retrato leva ao Personagem, onde ele se troca.
  $('#perfil-avatar').addEventListener('click', () => irPara('personagem'));

  // Curtir ou comentar aqui é curtir no feed: quando ele repinta, esta tela
  // repinta junto (o mesmo acordo do perfil público).
  aoAtualizarFeed(() => { if (viewAtual() === 'perfil') renderPerfil(); });

  montarAtalho();
  renderPerfil();
}

// O botão de perfil do topo, ao lado do sino: só a cabeça do seu avatar,
// flutuando, sem moldura (chapéu e óculos aparecem). Só redesenha quando o
// rosto muda — o onChange dispara a cada save.
function montarAtalho() {
  const botao = $('#perfil-atalho');
  botao.addEventListener('click', () => irPara('perfil'));
  // No computador a cabeça é do tamanho do sino; no celular, maior.
  const pc = matchMedia('(min-width: 901px)');
  let ultimo = null;
  const pintar = () => {
    const u = db.state.usuario;
    const roupas = db.roupasEquipadas();
    const tamanho = pc.matches ? 68 : 80;   // o mesmo da caixa em avisos.css
    const chave = JSON.stringify([u.avatar, roupas, u.nome, tamanho]);
    if (chave === ultimo) return;
    ultimo = chave;
    try {
      botao.replaceChildren(cabeca(aparenciaAtual(), tamanho, roupas));
    } catch {
      // Sem desenho possível, fica a inicial do nome.
      botao.replaceChildren(el('span', { class: 'perfil-atalho-inicial' },
        (u.nome || '?').trim().charAt(0).toUpperCase() || '?'));
    }
  };
  db.onChange(pintar);
  pc.addEventListener('change', pintar);
  pintar();
}

let abaAtual = null;   // a aba de baixo escolhida; null é a primeira

export function renderPerfil() {
  const u = db.state.usuario;
  const curtidas = meusPosts().reduce((soma, post) => soma + (post.curtidas || 0), 0);

  // O busto sem roupa (do vestiário, só chapéu e óculos), no fundo da cor que
  // assina os seus posts no feed.
  // O nível mora em volta do retrato: o anel enche com o XP do nível.
  const foto = retratoDoPerfil(aparenciaAtual(), COR_PROPRIA, db.roupasEquipadas());
  foto.style.filter = brilhoDoEstilo(db.roupasEquipadas());
  const xp = db.progresso();
  pintarFoto($('#perfil-avatar'), {
    foto, nivel: xp.nivel, pct: xp.maximo ? 1 : xp.xpNoNivel / xp.xpDoNivel,
    dica: xp.maximo ? `Nível máximo (${xp.nivel})` : `Nível ${xp.nivel}: faltam ${xp.xpFaltando} XP para o ${xp.nivel + 1}`,
  });

  $('#perfil-handle').textContent = u.handle;
  // A cor favorita, discreta: uma bolinha ao lado do nome.
  const fav = CORES_FAVORITAS.find(c => c.nome === u.corFavorita);
  $('#perfil-nome').replaceChildren(u.nome, fav
    ? el('span', { class: 'pf-cor-fav', style: { background: fav.hex }, title: `Cor favorita: ${fav.nome}` })
    : '');
  $('#perfil-bio').textContent = u.bio;
  $('#perfil-bio').hidden = !u.bio;
  renderConta();
  $('#perfil-redes').replaceChildren(...chipsDeRedes(minhasRedes()));

  // Três números; o resto vai no título, para quem passar o mouse. Amigos
  // abre a aba deles.
  const amigos = meusAmigos();
  $('#perfil-stats').replaceChildren(
    numeroDoPerfil(db.state.inventario.length, 'peças',
      `${plural(db.state.looks.length, 'look', 'looks')} · ${plural(db.state.boards.length, 'colagem', 'colagens')}`),
    numeroDoPerfil(quantosMeSeguem(), 'seguidores', `você segue ${plural(u.seguindo.length, 'pessoa', 'pessoas')}`),
    numeroDoPerfil(amigos.length, 'amigos', `${plural(curtidas, 'curtida', 'curtidas')} nos seus posts`,
      () => { abaAtual = 'amigos'; renderPerfil(); }));

  // Vestir-se é a casa das roupinhas (o vestiário): saiu da barra de baixo e
  // mora aqui, em destaque, ao lado de quem você é.
  $('#perfil-acoes').replaceChildren(
    el('button', { class: 'btn-ghost', onclick: abrirEdicao }, 'Editar perfil'),
    el('button', { class: 'btn-ghost', onclick: () => irPara('personagem') }, 'Personagem'),
    el('button', { class: 'btn-dark pf-vestir', id: 'perfil-vestir', onclick: () => irPara('vestiario') },
      ico('camiseta'), ' Vestir-se'));

  // O seu guarda-roupa inteiro e a sua wishlist, como os outros os veem.
  const roupas = minhasRoupas();
  const desejos = (db.state.wishlist || []).map(pecaDoCatalogo).filter(Boolean);
  $('#perfil-listas').replaceChildren(...botoesDeListas('', roupas, desejos, { minha: true, aoFechar: renderPerfil }));

  pintarAbas($('#perfil-abas'), $('#perfil-conteudo'), [
    abaDeRoupas(), ...abasDeObras(), abaDeColecoes(), abaDeAmigos(amigos),
  ], abaAtual, (id) => { abaAtual = id; renderPerfil(); });
  renderConexoes(renderPerfil);
}

// ------------------------------- Coleções ---------------------------------
// Uma aba: os emblemas das coleções começadas — as completas primeiro, depois
// as mais adiantadas — e, no fim, o atalho para a tela de Coleções, onde mora
// a lista inteira.
function abaDeColecoes() {
  const todas = GRUPOS_DE_COLECAO.flatMap(([, , lista]) => lista());
  const comecadas = todas.filter(c => c.tem > 0)
    .sort((a, b) => Number(b.completa) - Number(a.completa) || b.pct - a.pct);
  const completas = todas.filter(c => c.completa).length;
  return {
    id: 'colecoes', icone: 'trofeu', rotulo: 'Coleções', grade: 'pf-grade-colecoes',
    itens: comecadas.length ? [...comecadas.map(emblema), el('button', {
      class: 'pf-emblema pf-emblema-todas', title: `${completas} de ${todas.length} coleções completas`,
      onclick: () => irPara('colecoes'),
    }, el('span', { class: 'pf-emblema-disco' }, ico('seta-dir')), el('small', {}, 'Ver todas'))] : [],
    vazio: 'Nenhuma coleção começada',
    botao: ['Ver coleções', () => irPara('colecoes')],
  };
}

// Cor mostra a própria cor; marca, o logo. Sem logo (ou se ele não carregar),
// o emblema mostra uma peça da coleção.
const fotoDaCapa = (capa) => capa ? [el('div', { class: 'peca-caixa', style: { '--esc': String(escalaGrade(capa)) } },
  el('img', { src: capa.src, alt: '', loading: 'lazy' }))] : [];

function emblema(c) {
  const capa = capaDaColecao(c);
  const logo = logoDaColecao(c);
  return el('button', {
    class: 'pf-emblema' + (c.completa ? ' completa' : ''),
    title: c.completa ? `Coleção ${c.marca} completa` : `${c.marca}: ${c.tem} de ${c.total} peças`,
    onclick: () => abrirColecao(c.id),
  },
    el('span', { class: 'pf-emblema-disco', style: c.completa ? {} : { '--pct': (c.pct * 100) + '%' } },
      c.tipo === 'cor' ? el('span', { class: 'pf-emblema-amostra', style: { background: c.hex } })
        : logo ? el('img', { class: 'pf-emblema-logo', src: logo, alt: '', loading: 'lazy',
          onerror: (e) => e.target.replaceWith(...fotoDaCapa(capa)) })
          : fotoDaCapa(capa)),
    el('small', {},
      c.hex && c.tipo !== 'cor' && !logo ? el('span', { class: 'col-bolinha', style: { background: c.hex } }) : null,
      c.marca));
}

// ------------------------------- As abas -----------------------------------
// Segurar e arrastar grava a ordem nova e repinta, para a ficha que abre ao
// tocar seguir a ordem que ficou na tela.
const arrumar = (aba, ids) => { db.guardarOrdemDoPerfil(aba, ids); renderPerfil(); };

// As três de vitrine seguem a mesma regra: aparece o que tem estrela. Vazia,
// diz em poucas palavras o que falta e leva até lá.
// A prévia do guarda-roupa: as favoritas primeiro e, para completar, as que
// chegaram por último — ou a ordem que você arrumou (minhavitrine.js).
// Segurar e arrastar uma peça muda a ordem; o "ver todas" fica no fim.
function abaDeRoupas() {
  const favoritas = pecasFavoritas();
  const todas = minhasRoupas();
  return {
    id: 'roupas', icone: 'cabide', rotulo: 'Roupas', grade: 'pf-grade-pecas',
    itens: gradeDaPrevia(todas, favoritas,
      () => abrirListaDePecas('Seu guarda-roupa', todas, { aoFechar: renderPerfil, minha: true }),
      { minha: true }),
    reordenar: (ids) => arrumar('roupas', ids),
    vazio: 'Garimpe a sua primeira peça',
    botao: ['Ir à Loja', () => irPara('vitrine')],
  };
}

// Todos os looks do Stylist e todas as colagens: as (até três) favoritas na
// frente, depois do mais novo para o mais velho, ou a ordem que você arrumou
// segurando e arrastando; a estrela vira o selo no canto. O clique devolve ao
// editor de origem.
function abasDeObras() {
  const obras = (lista, tipo, abrir) => lista
    .map(item => cartaoDaObra({ ...item, tipo }, () => abrir(item.id)));
  return [{
    id: 'looks', icone: 'varinha', rotulo: 'Stylists', grade: 'pf-grade-obras',
    itens: obras(meusLooks(), 'look', (id) => { abrirLook(id); irPara('stylist'); }),
    reordenar: (ids) => arrumar('looks', ids),
    vazio: 'Monte o seu primeiro look',
    botao: ['Abrir o Stylist', () => irPara('stylist')],
  }, {
    id: 'colagens', icone: 'quadro', rotulo: 'Colagens', grade: 'pf-grade-obras',
    itens: obras(minhasColagens(), 'colagem', (id) => { irPara('board'); abrirBoard(id); }),
    reordenar: (ids) => arrumar('colagens', ids),
    vazio: 'Monte a sua primeira colagem',
    botao: ['Abrir a Colagem', () => irPara('board')],
  }];
}

// O look sai solto, sem moldura: o boneco inteiro, desenhado com o personagem
// de agora (o cabelo e o corpo do save podem ser de quando ele foi salvo).
function cartaoDaObra(item, abrir) {
  const look = item.tipo === 'look' && item.camadas?.length;
  return cartaoDeObra({
    id: item.id,
    nome: item.nome,
    thumb: look ? miniaturaSoltaPronta(item.camadas) || miniaturaSoltaAtual(item.camadas) : item.thumb,
    solto: Boolean(look),
    tipo: item.tipo,
    selo: item.favorito ? ico('estrela-cheia') : item.publicado ? ico('publicar') : null,
    abrir,
  });
}

// Amigo é mão dupla: você segue e a pessoa segue de volta (usuario.js diz
// quem retribui). Quem você segue e não retribui fica no feed, não aqui. A
// busca abre por cima e, ao fechar, refaz a página.
const meusAmigos = () => db.state.usuario.seguindo
  .filter(segueDeVolta)
  .map(perfilPublico)
  .filter(Boolean);

const abaDeAmigos = (amigos) => ({
  id: 'amigos', icone: 'usuario', rotulo: 'Amigos', grade: 'pf-grade-pessoas',
  itens: [...amigos.map(botaoDePerfil), botaoProcurar(() => abrirBuscaDePessoas(renderPerfil))],
});

// ----------------------------- Editar perfil ------------------------------
// Nome, @ e bio são o que os outros leem na sua página. O formulário toma o
// lugar do nome, da bio e dos botões enquanto está aberto.
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
  $('#pf-topo').classList.add('editando');
  $('#perfil-editar').hidden = false;
  $('#pf-nome').focus();
}

const fecharEdicao = () => {
  $('#perfil-editar').hidden = true;
  $('#pf-topo').classList.remove('editando');
};

// -------------------------------- Ajustes ---------------------------------
// A engrenagem abre o menu; cada linha abre o modal com uma seção só.
// Quanto o botão Sair espera o save subir antes de sair mesmo assim.
const PRAZO_PARA_SALVAR_AO_SAIR = 4000;

const TITULOS_DE_AJUSTE = {
  cores: 'Cores do site',
  conexoes: 'Contas conectadas',
  conta: 'Sua conta',
};

function montarAjustes() {
  const modal = $('#modal-ajustes');

  const engrenagem = $('#pf-config');
  const menu = $('#pf-menu');
  const mostrarMenu = (sim) => {
    menu.hidden = !sim;
    engrenagem.setAttribute('aria-expanded', String(sim));
  };
  engrenagem.addEventListener('click', () => mostrarMenu(menu.hidden));
  // Tocar fora fecha o menu.
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('.pf-config')) mostrarMenu(false);
  });
  menu.querySelectorAll('[data-ajuste]').forEach(b =>
    b.addEventListener('click', () => { mostrarMenu(false); abrirAjustes(b.dataset.ajuste); }));
  // Administração é uma tela, não um ajuste: só aparece para o dono da loja.
  $('#pf-menu-admin').addEventListener('click', () => { mostrarMenu(false); irPara('admin'); });
  // Volume: muda ali mesmo, sem fechar o menu, tocando um "tic" para ouvir a
  // altura. O alto-falante silencia e, mudo, volta ao volume de antes.
  const barra = $('#pf-volume');
  const mudo = $('#pf-volume-mudo');
  let antesDoMudo = volume() || VOLUME_PADRAO;
  const pintarVolume = () => {
    const v = volume();
    barra.value = String(v);
    barra.style.setProperty('--cheio', v + '%');
    barra.setAttribute('aria-valuetext', v ? `${v}%` : 'Sem som');
    // Troca o ícone escondendo, não substituindo: o svg tocado precisa
    // continuar dentro do menu, senão o "tocar fora fecha" acha que saiu.
    if (!mudo.children.length) mudo.append(ico('som'), ico('mudo'));
    mudo.children[0].style.display = v ? '' : 'none';
    mudo.children[1].style.display = v ? 'none' : '';
    mudo.setAttribute('aria-label', v ? 'Silenciar' : 'Ligar o som');
  };
  barra.addEventListener('input', () => {
    mudarVolume(Number(barra.value));
    if (volume()) antesDoMudo = volume();
    pintarVolume();
  });
  barra.addEventListener('change', () => tocar('ok'));
  mudo.addEventListener('click', () => {
    mudarVolume(volume() ? 0 : antesDoMudo);
    pintarVolume();
    tocar('ok');
  });
  pintarVolume();

  $('#aj-fechar').addEventListener('click', fecharAjustes);
  // Clique no fundo escuro fecha; clique dentro da caixa, não.
  modal.addEventListener('click', (e) => { if (e.target === modal) fecharAjustes(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) fecharAjustes();
  });
}

function abrirAjustes(qual) {
  if (qual === 'cores') renderPaletas();
  $('#modal-ajustes').classList.toggle('so-cores', qual === 'cores');
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

// ------------------------------ Cores do site -----------------------------
// Uma amostra perolada por paleta; tocar já troca o site inteiro.
function renderPaletas() {
  const atual = paletaAtual();
  $('#paletas').replaceChildren(...PALETAS.map(p => el('button', {
    type: 'button',
    class: 'paleta-opcao' + (p.id === atual ? ' ativa' : ''),
    'data-paleta': p.id,
    'aria-pressed': String(p.id === atual),
    title: p.nome, 'aria-label': p.nome,
    onclick: () => { escolherPaleta(p.id); renderPaletas(); },
  },
  el('span', { class: 'paleta-amostra' }))));
}

// --------------------------------- Conta ----------------------------------
// O que é da conta, e não da partida: e-mail, senha e sair. Apagar os dados do
// jogo (em Testes) não mexe na conta, e sair não apaga save nenhum
// — o guarda-roupa continua guardado, esperando o próximo login.
function montarConta() {
  const form = $('#form-senha');
  montarLimpeza();

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
  //
  // O save sobe antes de sair (sem sessão a nuvem recusa), mas com prazo: no
  // celular o envio pode ficar preso (rede lenta, save grande, o app voltando
  // do segundo plano com o envio congelado) e o botão parecia não fazer nada.
  // Se o prazo vence, o save continua pendente no aparelho e sobe no próximo
  // login desta conta.
  const botao = $('#btn-sair');
  botao.addEventListener('click', async () => {
    if (botao.disabled) return;
    botao.disabled = true;
    botao.textContent = 'Saindo…';
    await Promise.race([
      db.descarregar().catch(() => {}),
      new Promise(r => setTimeout(r, PRAZO_PARA_SALVAR_AO_SAIR)),
    ]);
    try {
      await auth.sair();
    } catch (erro) {
      botao.disabled = false;
      botao.textContent = 'Sair da conta';
      toast(`Não consegui sair: ${erro.message}`, 'aviso');
      return;
    }
    db.encerrarEstado();
    location.reload();
  });
}

function renderConta() {
  const conta = auth.contaAtual();
  if (!conta) return;
  const papel = conta.papel === 'admin' ? ' · administrador' : '';
  $('#conta-resumo').textContent = `${conta.email} · ${conta.handle}${papel}`;
  $('#pf-menu-admin').hidden = conta.papel !== 'admin';
}

// ------------------------- Limpeza de contas (admin) -----------------------
// Lista todas as contas do app e apaga as que não são a sua. O servidor faz
// backup de tudo antes (lambda/limpeza.py) e só apaga os ids desta lista.
async function pedirAdmin(rota, corpo) {
  const r = await fetch(rota, {
    method: corpo ? 'POST' : 'GET',
    credentials: 'include',
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || 'HTTP ' + r.status);
  return dados;
}

function montarLimpeza() {
  const lista = $('#limpeza-lista');
  const resumo = $('#limpeza-resumo');
  const botaoVer = $('#btn-ver-contas');
  const botaoLimpar = $('#btn-limpar-contas');
  let saem = [];

  const data = iso => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

  async function ver() {
    botaoVer.disabled = true;
    resumo.textContent = 'Lendo as contas…';
    try {
      const { contas, postsDeExemplo } = await pedirAdmin('/api/admin/contas');
      saem = contas.filter(c => !c.fica);
      lista.replaceChildren(...contas.map(c => el('li', { class: c.fica ? 'fica' : '' },
        el('b', {}, c.fica ? 'FICA · ' : 'SAI · '),
        `${c.email} · ${c.handle}${c.papel === 'admin' ? ' · admin' : ''}`,
        el('br'),
        el('small', {}, `criada ${data(c.criadoEm)} · último acesso ${data(c.ultimoAcesso)} · ` +
          `${c.posts} posts · ${c.comentarios} coment. · ${c.curtidas} curtidas · ` +
          `${c.seguidores} seguidores · save ${c.save ? 'sim' : 'não'}`))));
      resumo.textContent = `${contas.length} contas; ${saem.length} sairiam. ` +
        `Os ${postsDeExemplo} posts dos perfis de exemplo não são de conta e ficam.`;
      botaoLimpar.hidden = !saem.length;
    } catch (e) {
      resumo.textContent = 'Não consegui ler as contas: ' + e.message;
    } finally {
      botaoVer.disabled = false;
    }
  }

  async function limpar() {
    if (!saem.length) return;
    const nomes = saem.map(c => c.email).join('\n');
    const escrito = await pedirTexto(
      `${nomes}\n\nAntes é feito um backup. Escreva APAGAR para confirmar.`,
      { titulo: `Apagar de vez ${saem.length} conta(s), com posts, comentários, curtidas e saves?`,
        sim: 'Apagar', perigo: true });
    if (escrito !== 'APAGAR') return;
    botaoLimpar.disabled = true;
    resumo.textContent = 'Fazendo o backup e apagando…';
    try {
      const f = await pedirAdmin('/api/admin/contas/limpar',
        { ids: saem.map(c => c.id), confirmar: 'APAGAR' });
      toast(`${f.contas} conta(s) apagada(s).`);
      await ver();
      resumo.textContent = `Apagadas ${f.contas} contas, ${f.posts} posts, ${f.sessoes} sessões ` +
        `e ${f.saves} saves; ${f.postsLimpos} posts perderam curtidas ou comentários. ` +
        `Backup em ${f.backup}`;
    } catch (e) {
      resumo.textContent = 'A limpeza parou: ' + e.message;
    } finally {
      botaoLimpar.disabled = false;
    }
  }

  botaoVer.addEventListener('click', ver);
  botaoLimpar.addEventListener('click', limpar);
}

// ------------------------- Testes (tela de admin) --------------------------
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

  // Zera a partida da conta (o save da nuvem junto); as marcas e cores que o
  // admin registrou na esteira ficam.
  $('#btn-reset').addEventListener('click', async () => {
    if (!await confirmar('Isso não volta.',
      { titulo: 'Apagar peças, looks, colagens, posts e XP da sua conta?', sim: 'Apagar', perigo: true }
    )) return;
    db.resetar();
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
