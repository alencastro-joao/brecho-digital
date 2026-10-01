// Busca de pessoas: achar quem seguir sem depender do sorteio do feed.
//
// Enquanto o diretório tinha dez nomes, a coluna "quem seguir" era o diretório
// inteiro e procurar alguém era ler a lista. Com gente de verdade no app isso
// deixou de valer: quem já segue metade da coluna não tem como chegar no resto,
// e ninguém acha uma pessoa específica.
//
// A busca junta duas fontes, e as duas aparecem na mesma lista:
//
//   * as contas reais, que só o servidor conhece (pessoas.js → /api/usuarios);
//     elas vêm primeiro, porque é a elas que se quer chegar;
//   * os perfis de exemplo do feed (PERFIS_MOCK), filtrados aqui mesmo.
//
// Duas entradas para a mesma busca, porque são dois momentos diferentes:
//
//   * o campo na coluna do feed, para quando você já está ali olhando gente;
//   * o modal "Procurar pessoas", chamado da seção Amigos do perfil, para
//     quando o que você quer é justamente adicionar alguém.
//
// As duas mostram a mesma linha (`linhaDePessoa`) e mexem no mesmo lugar —
// `db.state.usuario.seguindo`, por `alternarSeguir` —, então seguir de um lado
// aparece do outro sem ninguém sincronizar nada.
//
// Amizade aqui é mão dupla, como no perfil: seguir alguém que retribui
// (`segueDeVolta`) vira amigo. A linha só mostra o selo depois que você segue.
// Para um perfil de exemplo isso é essencial: `segueDeVolta` é um sorteio que
// diz quem retribui *quando você segue*, e mostrar antes entregaria a resposta.
//
// Ciclo de propósito, como o de social.js e usuario.js: o feed pinta a coluna
// por aqui, e daqui se segue e se abre perfil pelo que eles exportam. Nada é
// chamado no carregamento dos módulos, só em tempo de execução.

import { PERFIS_MOCK } from './config.js';
import * as db from './db.js';
import { aparenciaDoPerfil, retrato } from './avatar.js';
import { buscarReais, roupasDoPerfil } from './pessoas.js';
import { el, $, toast } from './util.js';
import { abrirPerfilDe, segueDeVolta } from './usuario.js';
import { alternarSeguir } from './social.js';

// Quantos nomes a coluna do feed mostra quando ninguém procurou nada. A lista
// inteira viraria uma rolagem sem fim ao lado do feed — quem quer o resto tem
// o campo de busca logo acima.
const SUGESTOES = 8;
// Dessas, até quantas podem ser contas reais recém-chegadas.
const SUGESTOES_REAIS = 4;
// Quanto esperar depois da última tecla antes de perguntar ao servidor: cada
// letra digitada seria uma varredura da tabela.
const ESPERA_DIGITACAO = 250;

const plural = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;

// ============================== O casamento ===============================
// Acento e caixa não podem atrapalhar: quem procura "jo" tem que achar "Jô
// Vasques", e quem procura "leo" tem que achar "Léo Maranhão". O @ digitado
// também sai do termo — procurar "@lia" é procurar "lia".
export const normalizar = (texto) => String(texto ?? '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .trim();

const limparTermo = (texto) => normalizar(texto).replace(/^@+/, '');

// A nota diz *onde* casou, e é ela que ordena: quem começa com o que você
// digitou vem antes de quem só contém aquilo no meio, e o nome vem antes da
// bio. Sem isso, procurar "lia" devolveria primeiro quem tem "família" na bio.
// (O servidor usa a mesma escala para as contas reais.)
function nota(p, termo) {
  const nome = normalizar(p.nome);
  const handle = normalizar(p.handle).replace(/^@+/, '');
  const bio = normalizar(p.bio);

  if (handle.startsWith(termo)) return 0;
  if (nome.startsWith(termo)) return 1;
  // Sobrenome: "cardoso" tem que achar "Nina Cardoso".
  if (nome.split(/\s+/).some(parte => parte.startsWith(termo))) return 2;
  if (handle.includes(termo)) return 3;
  if (nome.includes(termo)) return 4;
  if (bio.includes(termo)) return 5;
  return -1;
}

// Os perfis de exemplo que casam, já ordenados. Termo vazio devolve lista
// vazia: é quem chama que decide o que mostrar no lugar.
export function buscarPerfis(termo) {
  const t = limparTermo(termo);
  if (!t) return [];

  return PERFIS_MOCK
    .map(p => ({ p, n: nota(p, t) }))
    .filter(x => x.n >= 0)
    .sort((a, b) => a.n - b.n || a.p.nome.localeCompare(b.p.nome, 'pt-BR'))
    .map(x => x.p);
}

// Perfis de exemplo para sugerir sem termo: primeiro quem você ainda não segue,
// e dentro disso a ordem do cadastro (o sort é estável).
const sugeridosDeExemplo = (limite) => {
  const seguindo = db.state.usuario.seguindo;
  return [...PERFIS_MOCK]
    .sort((a, b) => Number(seguindo.includes(a.id)) - Number(seguindo.includes(b.id)))
    .slice(0, limite);
};

// ============================ As contas reais =============================
// O que o servidor já respondeu nesta sessão. A tela nunca espera por ele: pinta
// o que tem (os exemplos e o que já veio) e repinta quando a resposta chega.
const reaisPorTermo = new Map();   // termo → contas reais que casam
const emVoo = new Set();           // termos perguntados e ainda sem resposta
const emEspera = new Set();        // termos digitados, esperando a pausa para sair
let reaisNovas = [];               // as contas mais novas (o que se mostra sem termo)

const reaisDoTermo = (termo) => reaisPorTermo.get(limparTermo(termo)) || [];

// "Procurando" vale desde a tecla, e não só depois que a pergunta sai: nos
// primeiros milissegundos a lista ainda não tem resposta, e dizer "ninguém com
// esse nome" nesse intervalo seria dizer uma coisa que ainda não se sabe.
const buscando = (termo) => {
  const chave = limparTermo(termo);
  return emVoo.has(chave) || emEspera.has(chave);
};

// Todo mundo que casa com o termo: contas reais primeiro, depois os exemplos.
const casando = (termo) => [...reaisDoTermo(termo), ...buscarPerfis(termo)];

// Pergunta ao servidor e avisa quando a resposta chega. Só é chamada a partir
// de um gesto (digitar, abrir) e nunca de dentro de um render: um render que
// perguntasse de novo a cada falha viraria um laço.
function pedirReais(termo, aoChegar) {
  const chave = limparTermo(termo);
  if (chave.length < 2 || reaisPorTermo.has(chave) || emVoo.has(chave)) return;

  emVoo.add(chave);
  buscarReais(chave)
    .then(lista => reaisPorTermo.set(chave, lista))
    // Sem servidor (ou sem a rota) a busca segue só com os exemplos.
    .catch(e => console.warn('não consegui procurar pessoas no servidor.', e.message))
    .finally(() => { emVoo.delete(chave); aoChegar(); });
}

// Cada campo tem o seu relógio: digitar no modal não atrasa a coluna do feed.
function comEspera() {
  let relogio = null;
  let marcado = null;             // o termo deste campo que está em `emEspera`
  return (termo, aoChegar) => {
    clearTimeout(relogio);
    if (marcado) emEspera.delete(marcado);

    const chave = limparTermo(termo);
    marcado = chave.length >= 2 && !reaisPorTermo.has(chave) ? chave : null;
    if (marcado) emEspera.add(marcado);

    relogio = setTimeout(() => {
      if (marcado) emEspera.delete(marcado);
      marcado = null;
      pedirReais(termo, aoChegar);
    }, ESPERA_DIGITACAO);
  };
}

async function carregarNovas() {
  try {
    reaisNovas = await buscarReais('');
  } catch (e) {
    console.warn('não consegui ver quem entrou no brechó.', e.message);
    reaisNovas = [];
  }
}

// ================================ A linha =================================
// Retrato, nome, @, bio e o botão de seguir. É a mesma linha nos dois lugares:
// o que muda é o que a lista em volta decidiu mostrar e o que fazer depois.
//   aoMudar — repinta a lista que a contém depois de seguir/deixar de seguir
//   aoAbrir — roda antes de ir para o perfil (o modal precisa fechar antes)
function linhaDePessoa(p, { aoMudar, aoAbrir } = {}) {
  const segue = db.state.usuario.seguindo.includes(p.id);
  const amigo = segue && segueDeVolta(p.id);
  const abrir = () => { aoAbrir?.(); abrirPerfilDe(p.id); };

  return el('div', { class: 'sugestao' },
    el('button', {
      class: 'autor-link', title: `Ver o perfil de ${p.nome}`,
      onclick: abrir,
    }, retrato(aparenciaDoPerfil(p), 38, p.cor, roupasDoPerfil(p))),

    el('div', { class: 'sug-info' },
      el('strong', {},
        el('button', { class: 'autor-link nome', onclick: abrir }, p.nome),
        amigo ? el('span', { class: 'chip-amigo', title: 'Vocês se seguem' }, 'amigos') : null),
      el('small', {}, [p.handle, p.bio].filter(Boolean).join(' · '))
    ),

    el('button', {
      class: 'btn-seguir' + (segue ? ' seguindo' : ''),
      title: segue ? `Deixar de seguir ${p.nome}` : `Seguir ${p.nome}`,
      onclick: () => { alternarSeguir(p.id); aoMudar?.(); },
    }, segue ? 'seguindo' : 'seguir')
  );
}

// Uma lista de pessoas dentro de uma caixa, com a frase certa quando dá vazio.
function encherLista(caixa, pessoas, opcoes, vazio) {
  caixa.replaceChildren(...(pessoas.length
    ? pessoas.map(p => linhaDePessoa(p, opcoes))
    : [el('p', { class: 'busca-vazio' }, vazio)]));
}

const semResultado = (termo) => buscando(termo)
  ? 'Procurando…'
  : 'Ninguém com esse nome. Tente o @ ou parte do sobrenome.';

// ========================= O campo na coluna do feed ======================
// O termo mora aqui, e não no social.js, porque quem repinta a coluna é o feed
// inteiro (seguir alguém repinta tudo) — e o que a pessoa digitou tem que
// sobreviver a esse repinte.
let termoDoFeed = '';
const esperarNoFeed = comEspera();

function limparBuscaDoFeed() {
  const campo = $('#busca-pessoas');
  campo.value = '';
  termoDoFeed = '';
  renderPessoas();
  return campo;
}

export function montarBuscaNoFeed() {
  const campo = $('#busca-pessoas');
  if (!campo) return;

  campo.addEventListener('input', () => {
    termoDoFeed = campo.value;
    // Primeiro marca a espera, depois pinta: senão a primeira pintura diria
    // "ninguém" antes de a busca ter sido sequer agendada.
    esperarNoFeed(termoDoFeed, renderPessoas);
    renderPessoas();
  });

  // Esc limpa em vez de fechar nada: aqui não há o que fechar, e voltar às
  // sugestões é o que se quer depois de uma busca que não deu em nada.
  campo.addEventListener('keydown', (e) => { if (e.key === 'Escape') limparBuscaDoFeed(); });
  $('#busca-limpar').addEventListener('click', () => limparBuscaDoFeed().focus());
}

// Sem termo: contas novas que você ainda não segue, depois os exemplos até
// completar. Quem acabou de entrar no brechó é quem a coluna quer mostrar.
function sugestoesDoFeed() {
  const seguindo = db.state.usuario.seguindo;
  const novas = reaisNovas.filter(p => !seguindo.includes(p.id)).slice(0, SUGESTOES_REAIS);
  return [...novas, ...sugeridosDeExemplo(SUGESTOES - novas.length)];
}

// Chamado pelo feed a cada repinte: resultado da busca quando há termo, e as
// sugestões quando não há. Seguir alguém já repinta o feed inteiro, então a
// linha não precisa avisar ninguém (`aoMudar`).
export function renderPessoas() {
  const caixa = $('#sugestoes');
  if (!caixa) return;

  const termo = termoDoFeed.trim();
  const achados = termo ? casando(termo) : sugestoesDoFeed();

  $('#busca-limpar').hidden = !termo;
  $('#busca-resumo').textContent = termo
    ? `${plural(achados.length, 'perfil', 'perfis')} para "${termo}"` +
      (buscando(termo) ? ' · procurando…' : '')
    : 'Sugestões — ou procure alguém pelo nome ou @.';

  encherLista(caixa, achados, {}, semResultado(termo));
}

// Chamado ao entrar no feed: esquece o que o servidor disse antes (a lista de
// quem entrou envelhece) e pergunta de novo, sem atrapalhar o que já está na
// tela.
export async function atualizarPessoas() {
  reaisPorTermo.clear();
  await carregarNovas();
  renderPessoas();
  if (termoDoFeed.trim()) pedirReais(termoDoFeed, renderPessoas);
}

// ================================= O modal ================================
// Chamado da seção Amigos do perfil. Aqui a lista sem termo não é "sugestões":
// é quem você ainda não segue, que é exatamente o que se procura quando o que
// se quer é adicionar gente.
let aoFechar = null;
const esperarNoModal = comEspera();

// Quem você ainda não seguia quando abriu. A lista é fixada na abertura: se ela
// se refizesse a cada clique, quem você acabou de seguir sairia dela na hora, e
// o selo de amigos — o retorno de ter procurado a pessoa — nunca daria para ver.
let candidatos = [];

const candidatosAgora = () => {
  const seguindo = db.state.usuario.seguindo;
  return [...reaisNovas, ...PERFIS_MOCK].filter(p => !seguindo.includes(p.id));
};

export function montarBusca() {
  const modal = $('#modal-busca');
  if (!modal) return;

  $('#bp-fechar').addEventListener('click', () => fechar());
  $('#bp-campo').addEventListener('input', () => {
    esperarNoModal($('#bp-campo').value, renderModal);
    renderModal();
  });
  modal.addEventListener('pointerdown', (e) => { if (e.target === modal) fechar(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) fechar();
  });
}

export function abrirBuscaDePessoas(callback = null) {
  const modal = $('#modal-busca');
  if (!modal) return toast('A busca de pessoas não está disponível aqui.', 'aviso');

  aoFechar = callback;
  reaisPorTermo.clear();
  candidatos = candidatosAgora();
  $('#bp-campo').value = '';
  renderModal();

  modal.hidden = false;
  document.body.classList.add('com-modal');
  setTimeout(() => $('#bp-campo').focus(), 60);

  // As contas mais novas chegam depois e entram no topo da lista. Se a pessoa
  // já seguiu alguém nesse meio-tempo, essa pessoa continua onde está.
  carregarNovas().then(() => {
    if (modal.hidden) return;
    const jaNaLista = new Set(candidatos.map(p => p.id));
    candidatos = [...reaisNovas.filter(p => !jaNaLista.has(p.id)), ...candidatos]
      .filter(p => !db.state.usuario.seguindo.includes(p.id) || jaNaLista.has(p.id));
    renderModal();
  });
}

// O perfil repinta ao fechar, e não a cada clique em seguir: a página está
// atrás do modal, e refazê-la a cada botão só gasta render. Indo para o perfil
// de alguém não há o que repintar — o perfil próprio se refaz quando a pessoa
// voltar a ele (aoEntrarNoPerfil).
function fechar(repintar = true) {
  $('#modal-busca').hidden = true;
  document.body.classList.remove('com-modal');
  if (repintar) aoFechar?.();
  aoFechar = null;
}

function renderModal() {
  const termo = $('#bp-campo').value.trim();
  const seguindo = db.state.usuario.seguindo;

  const achados = termo ? casando(termo) : candidatos;
  const faltam = candidatos.filter(p => !seguindo.includes(p.id)).length;

  $('#bp-resumo').textContent = termo
    ? `${plural(achados.length, 'perfil encontrado', 'perfis encontrados')} para "${termo}"` +
      (buscando(termo) ? ' · procurando…' : '')
    : !candidatos.length
      ? `Você já segue todo mundo daqui — ${plural(seguindo.length, 'perfil', 'perfis')}.`
      : faltam
        ? `${plural(faltam, 'pessoa que você ainda não segue', 'pessoas que você ainda não segue')}. ` +
          'Quem seguir de volta vira amigo.'
        : 'Pronto, você segue todo mundo daqui. Quem seguir de volta já aparece como amigo.';

  encherLista($('#bp-lista'), achados,
    { aoMudar: renderModal, aoAbrir: () => fechar(false) },
    termo ? semResultado(termo) : 'Nada por aqui.');
}
