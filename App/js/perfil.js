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
import { retrato, aparenciaAtual } from './avatar.js';
import { miniaturaSoltaAtual, miniaturaSoltaPronta } from './render.js';
import { el, $, shuffle, toast } from './util.js';
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
import { sincronizarSocial } from './pessoas.js';
import { PALETAS, paletaAtual, escolherPaleta } from './paleta.js';
import { GRUPOS_DE_COLECAO, capaDaColecao, abrirColecao } from './colecoes.js';
import { escalaGrade, logoDaColecao } from './config.js';
import { brilhoDoEstilo } from './efeitos.js';
import {
  gradeDePecas, perfilPublico, segueDeVolta, cartaoDeObra, botaoDePerfil, botaoProcurar, botoesDeListas,
  retratoDoPerfil, pintarFoto, numeroDoPerfil, pintarAbas,
} from './usuario.js';
import { ico } from './icones.js';

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

  // O retrato leva ao Personagem, onde ele se troca.
  $('#perfil-avatar').addEventListener('click', () => irPara('personagem'));

  // Curtir ou comentar aqui é curtir no feed: quando ele repinta, esta tela
  // repinta junto (o mesmo acordo do perfil público).
  aoAtualizarFeed(() => { if (viewAtual() === 'perfil') renderPerfil(); });

  montarAtalho();
  renderPerfil();
}

// O botão de perfil do topo, ao lado do sino: o rosto do seu avatar, com a roupinha
// (chapéu e óculos aparecem no recorte). Só redesenha quando o rosto muda —
// o onChange dispara a cada save.
function montarAtalho() {
  const botao = $('#perfil-atalho');
  botao.addEventListener('click', () => irPara('perfil'));
  // No computador o botão é do tamanho do sino; no celular, maior e em busto.
  const pc = matchMedia('(min-width: 901px)');
  let ultimo = null;
  const pintar = () => {
    const u = db.state.usuario;
    const roupas = db.roupasEquipadas();
    const tamanho = pc.matches ? 42 : 54;
    const quadro = pc.matches ? 1 : 1.75;
    const chave = JSON.stringify([u.avatar, roupas, u.nome, tamanho]);
    if (chave === ultimo) return;
    ultimo = chave;
    try {
      botao.replaceChildren(retrato(aparenciaAtual(), tamanho, COR_PROPRIA, roupas, quadro));
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

  // O busto com as roupinhas do vestiário, no fundo da cor que assina os seus
  // posts no feed. No Stylist o avatar segue pelado, para a roupa fotografada
  // cair no corpo sem duas roupas sobrepostas.
  // O nível mora em volta do retrato: o anel enche com o XP do nível.
  const foto = retratoDoPerfil(aparenciaAtual(), COR_PROPRIA, db.roupasEquipadas());
  foto.style.filter = brilhoDoEstilo(db.roupasEquipadas());
  const xp = db.progresso();
  pintarFoto($('#perfil-avatar'), {
    foto, nivel: xp.nivel, pct: xp.maximo ? 1 : xp.xpNoNivel / xp.xpDoNivel,
    dica: xp.maximo ? `Nível máximo (${xp.nivel})` : `Nível ${xp.nivel}: faltam ${xp.xpFaltando} XP para o ${xp.nivel + 1}`,
  });

  $('#perfil-handle').textContent = u.handle;
  $('#perfil-nome').textContent = u.nome;
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
    numeroDoPerfil(u.seguidores, 'seguidores', `você segue ${plural(u.seguindo.length, 'pessoa', 'pessoas')}`),
    numeroDoPerfil(amigos.length, 'amigos', `${plural(curtidas, 'curtida', 'curtidas')} nos seus posts`,
      () => { abaAtual = 'amigos'; renderPerfil(); }));

  $('#perfil-acoes').replaceChildren(
    el('button', { class: 'btn-ghost', onclick: abrirEdicao }, 'Editar perfil'),
    el('button', { class: 'btn-ghost', onclick: () => irPara('personagem') }, 'Personagem'),
    el('button', { class: 'btn-ghost', onclick: () => irPara('vestiario') }, 'Inventário'));

  // O seu guarda-roupa inteiro e a sua wishlist, como os outros os veem.
  const roupas = db.state.inventario.map(x => pecaDoCatalogo(x.id)).filter(Boolean);
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
// As três de vitrine seguem a mesma regra: aparece o que tem estrela. Vazia,
// diz em poucas palavras o que falta e leva até lá.
function abaDeRoupas() {
  const temPecas = db.state.inventario.length > 0;
  return {
    id: 'roupas', icone: 'cabide', rotulo: 'Roupas', grade: 'pf-grade-pecas',
    itens: gradeDePecas(pecasFavoritas()),
    vazio: temPecas ? 'Favorite roupas com ★ no Closet' : 'Garimpe a sua primeira peça',
    botao: temPecas ? ['Abrir o Closet', () => irPara('closet')] : ['Ir à Loja', () => irPara('vitrine')],
  };
}

// Todos os looks do Stylist e todas as colagens, do mais novo para o mais
// velho; a estrela vira o selo no canto. O clique devolve ao editor de origem.
function abasDeObras() {
  const obras = (lista, tipo, abrir) => porData(lista)
    .map(item => cartaoDaObra({ ...item, tipo }, () => abrir(item.id)));
  return [{
    id: 'looks', icone: 'varinha', rotulo: 'Stylists', grade: 'pf-grade-obras',
    itens: obras(db.state.looks, 'look', (id) => { abrirLook(id); irPara('stylist'); }),
    vazio: 'Monte o seu primeiro look',
    botao: ['Abrir o Stylist', () => irPara('stylist')],
  }, {
    id: 'colagens', icone: 'quadro', rotulo: 'Colagens', grade: 'pf-grade-obras',
    itens: obras(db.state.boards, 'colagem', (id) => { irPara('board'); abrirBoard(id); }),
    vazio: 'Monte a sua primeira colagem',
    botao: ['Abrir a Colagem', () => irPara('board')],
  }];
}

// O look sai solto, sem moldura: o boneco inteiro, desenhado com o personagem
// de agora (o cabelo e o corpo do save podem ser de quando ele foi salvo).
function cartaoDaObra(item, abrir) {
  const look = item.tipo === 'look' && item.camadas?.length;
  return cartaoDeObra({
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
const TITULOS_DE_AJUSTE = {
  cores: 'Cores do site',
  conexoes: 'Contas conectadas',
  conta: 'Sua conta',
  testes: 'Testes',
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
  $('#btn-sair').addEventListener('click', async () => {
    await db.descarregar();   // antes de sair: sem sessão a nuvem recusa o save
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
  $('#limpeza-contas').hidden = conta.papel !== 'admin';
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
    const escrito = prompt(
      `Apagar de vez ${saem.length} conta(s), com posts, comentários, curtidas e saves?\n\n` +
      `${nomes}\n\nAntes é feito um backup. Escreva APAGAR para confirmar.`);
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
