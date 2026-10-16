// Avisos: o sino no canto de cima e a lista do que aconteceu enquanto você
// não estava olhando — como o coração do Instagram.
//
// Ninguém aqui recebe aviso pronto de servidor nenhum. Cada fonte é comparada
// com a última foto que o save guardou dela, e o que mudou vira aviso:
//   * feed       curtidas e comentários de outras pessoas nos seus posts;
//   * seguidores quem passou a seguir você;
//   * missões    missão fechada, dia inteiro fechado, nível novo (db.onXP);
//   * loja       a vitrine que virou o dia, ou que o admin repôs;
//   * wishlist   peça da sua wishlist pendurada na sua loja hoje.
//
// A foto e a lista moram no save (`state.avisos`), então o que já foi visto no
// computador chega visto no celular. A primeira olhada de cada fonte só tira a
// foto, sem avisar: senão quem já jogava abriria o sino com um aviso para cada
// curtida que já tinha.

import * as db from './db.js';
import { publicacoes, aoMudarPublicacoes, carregarFeed, feedLidoEm } from './publicacoes.js';
import { aoLerSeguidores, sincronizarSocial, perfilDe } from './pessoas.js';
import { retratoDe } from './social.js';
import { irPara } from './router.js';
import { CONFIG } from './config.js';
import { item as pecaDoCatalogo, nomeDaPeca } from './catalog.js';
import { el, $, hojeISO, tempoRelativo } from './util.js';
import { ico } from './icones.js';

const MAXIMO = 40;              // a lista guarda os mais novos; o resto cai
const INTERVALO = 3 * 60e3;     // de quanto em quanto o feed e os seguidores são relidos

const avisos = () => db.state.avisos;

// Grava logo depois, não agora: quem disparou o aviso (uma missão, por exemplo)
// ainda está no meio da própria mudança, e vários avisos seguidos viram um save.
let gravacao = false;
function gravar() {
  if (gravacao) return;
  gravacao = true;
  queueMicrotask(() => { gravacao = false; db.salvar(); });
}

const naoLidos = () => {
  const visto = avisos().vistoEm || '';
  return avisos().lista.filter(a => a.em > visto);
};

// --------------------------------- Lista -----------------------------------
// `junta`: um aviso ainda não lido com a mesma chave é atualizado em vez de
// virar outro. É o que faz cinco curtidas no mesmo look serem uma linha só.
function avisar({ tipo, texto, ir, quem = null, junta = null, qtd = 1 }) {
  const a = avisos();
  const agora = new Date().toISOString();
  const visto = a.vistoEm || '';
  const antigo = junta && a.lista.find(x => x.junta === junta && x.em > visto);
  if (antigo) {
    a.lista = a.lista.filter(x => x !== antigo);
    qtd += antigo.qtd || 1;
  }
  a.lista.unshift({
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    tipo, em: agora, ir, quem, junta, qtd,
    texto: typeof texto === 'function' ? texto(qtd) : texto,
  });
  a.lista.length = Math.min(a.lista.length, MAXIMO);
  gravar();
  pintar({ chegou: true });
}

// ------------------------------- Fontes ------------------------------------
const doPost = (p) => p.tipo === 'board' ? `sua colagem “${p.nome}”` : `seu look “${p.nome}”`;
const noPost = (p) => (p.tipo === 'board' ? 'na ' : 'no ') + doPost(p);
const nomeDe = (id) => perfilDe(id)?.nome || 'Alguém';

function conferirFeed() {
  // Antes da primeira leitura a lista está vazia — e vazia ela apagaria a foto
  // de todos os posts, que voltariam como novos.
  if (!feedLidoEm()) return;
  const eu = db.state.usuario.id;
  const fotos = avisos().posts;
  const meus = publicacoes().filter(p => p.autor === eu);
  let mudou = false;

  for (const p of meus) {
    // A sua própria curtida não é novidade para você.
    const curtidas = Math.max(0, p.curtidas - (p.curtido ? 1 : 0));
    const comentarios = (p.comentarios || []).filter(c => c.autor !== eu);
    const antes = fotos[p.id];
    const agora = { c: curtidas, k: comentarios.map(c => c.id) };
    if (antes && antes.c === agora.c && antes.k.join() === agora.k.join()) continue;
    fotos[p.id] = agora;
    mudou = true;
    if (!antes) continue;

    if (curtidas > antes.c) {
      avisar({
        tipo: 'curtida', ir: ['social'], junta: 'curtida:' + p.id, qtd: curtidas - antes.c,
        texto: (n) => `${doPost(p)[0].toUpperCase()}${doPost(p).slice(1)} ganhou ` +
          (n === 1 ? '1 curtida nova.' : `${n} curtidas novas.`),
      });
    }
    for (const c of comentarios.filter(c => !antes.k.includes(c.id))) {
      avisar({
        tipo: 'comentario', ir: ['social'], quem: c.autor,
        texto: `${nomeDe(c.autor)} comentou ${noPost(p)}: “${c.texto}”`,
      });
    }
  }

  // Post apagado não precisa mais de foto.
  for (const id of Object.keys(fotos)) {
    if (!meus.some(p => p.id === id)) { delete fotos[id]; mudou = true; }
  }
  if (mudou) gravar();
}

function conferirSeguidores(ids) {
  const a = avisos();
  const antes = a.seguidores;
  a.seguidores = ids;
  if (antes && antes.join() === ids.join()) return;
  gravar();
  if (!antes) return;
  for (const id of ids.filter(id => !antes.includes(id))) {
    avisar({ tipo: 'seguidor', ir: ['usuario', id], quem: id,
             texto: `${nomeDe(id)} começou a seguir você.` });
  }
}

function aoGanharXP(evento) {
  if (evento.motivo.startsWith('missão: ')) {
    avisar({ tipo: 'missao', ir: ['tarefas'],
             texto: `Missão concluída: ${evento.motivo.slice(8)} (+${evento.xp} XP).` });
  } else if (evento.motivo === 'dia carimbado') {
    avisar({ tipo: 'missao', ir: ['tarefas'],
             texto: `Você carimbou o dia (+${evento.xp} XP).` });
  } else if (evento.motivo.startsWith('missão da semana: ')) {
    avisar({ tipo: 'missao', ir: ['tarefas'],
             texto: `Missão da semana concluída: ${evento.motivo.slice(18)} (+${evento.xp} XP).` });
  } else if (evento.motivo === 'baú dos dias') {
    avisar({ tipo: 'missao', ir: ['tarefas'],
             texto: `Você abriu o baú dos dias (+${evento.xp} XP).` });
  } else if (evento.motivo === 'baú semanal') {
    avisar({ tipo: 'missao', ir: ['tarefas'],
             texto: `Você abriu o baú semanal (+${evento.xp} XP).` });
  }
  if (evento.subiu) {
    avisar({ tipo: 'nivel', ir: ['tarefas'],
             texto: `Você chegou ao nível ${evento.nivel}. Tem prêmio esperando na trilha.` });
  }
}

// A vitrine e as missões viram juntas, à meia-noite: um aviso só para as duas.
function conferirDia() {
  const a = avisos();
  const hoje = hojeISO();
  if (a.dia === hoje) return;
  const primeira = !a.dia;
  a.dia = hoje;
  if (primeira) return gravar();
  avisar({ tipo: 'loja', ir: ['vitrine'],
           texto: 'Dia novo: a vitrine foi reposta e as missões recomeçaram.' });
}

// O botão de repor do admin: a loja trocou sem o dia virar.
export function avisarLojaReposta() {
  avisar({ tipo: 'loja', ir: ['vitrine'], texto: 'A loja foi reposta: estoque novo na vitrine.' });
}

// Peça da wishlist na loja: só o sino, sem toast nem balão. Cada peça avisa
// uma vez por dia; a arara de hoje (`dia.vitrine`) é a mesma que a loja
// pendura, então quem chama é a própria loja ao montar (e a reposição do admin).
export function conferirWishlist() {
  const dia = db.state.dia;
  const hoje = hojeISO();
  const ids = dia.data === hoje ? (dia.vitrine?.ids || []).slice(0, CONFIG.PECAS_NA_VITRINE) : [];
  if (!ids.length) return;
  const a = avisos();
  if (a.wishlist?.dia !== hoje) a.wishlist = { dia: hoje, ids: [] };
  const novas = ids.filter(id => db.naWishlist(id) && !db.temPeca(id) && !a.wishlist.ids.includes(id));
  if (!novas.length) return;
  a.wishlist.ids.push(...novas);
  for (const id of novas) {
    const peca = pecaDoCatalogo(id);
    if (!peca) continue;
    avisar({ tipo: 'wishlist', ir: ['vitrine'],
             texto: `${nomeDaPeca(peca)}, da sua wishlist, está na sua loja hoje.` });
  }
}

// O feed e os seguidores só chegam relendo o servidor. Com a aba escondida não
// há quem veja o sino, e não se gasta requisição.
function reler() {
  if (document.hidden) return;
  carregarFeed();
  sincronizarSocial();
}

// -------------------------------- Tela -------------------------------------
const ICONE = {
  curtida: 'coracao-cheio', comentario: '“', seguidor: '+', missao: 'ok', nivel: 'estrela-cheia', loja: 'atualizar',
  wishlist: 'coracao',
};

let botao, painel, contador, listaEl;

function linha(a, visto) {
  const novo = a.em > visto;
  const marca = a.quem
    ? retratoDe(a.quem, 34)
    : el('span', { class: `aviso-icone ${a.tipo}` }, ICONE[a.tipo]?.length > 1 ? ico(ICONE[a.tipo]) : ICONE[a.tipo] || '•');
  return el('li', {},
    el('button', {
      class: 'aviso' + (novo ? ' novo' : ''),
      onclick: () => { fechar(); irPara(...a.ir); },
    },
      marca,
      el('span', { class: 'aviso-texto' },
        a.texto,
        el('small', {}, tempoRelativo(a.em))),
    ));
}

function pintar({ chegou = false } = {}) {
  if (!botao) return;
  const n = naoLidos().length;
  contador.hidden = !n;
  contador.textContent = n > 9 ? '9+' : String(n);
  botao.title = n ? `${n} ${n === 1 ? 'aviso novo' : 'avisos novos'}` : 'Avisos';
  if (chegou && n) {
    botao.classList.remove('chegou');
    void botao.offsetWidth;          // reinicia a animação
    botao.classList.add('chegou');
  }
  if (!painel.hidden) pintarLista();
}

// O que estava não lido quando o painel abriu continua destacado até ele
// fechar — senão abrir o sino apagaria na hora justamente o que ele mostra.
let vistoAoAbrir = '';

function pintarLista() {
  const lista = avisos().lista;
  listaEl.replaceChildren(...lista.map(a => linha(a, vistoAoAbrir)));
  $('#avisos-vazio').hidden = lista.length > 0;
  $('#avisos-limpar').hidden = !lista.length;
}

function abrir() {
  vistoAoAbrir = avisos().vistoEm || '';
  painel.hidden = false;
  botao.setAttribute('aria-expanded', 'true');
  pintarLista();
  if (naoLidos().length) {
    avisos().vistoEm = new Date().toISOString();
    gravar();
  }
  pintar();
}

function fechar() {
  if (painel.hidden) return;
  painel.hidden = true;
  botao.setAttribute('aria-expanded', 'false');
}

export function montarAvisos() {
  botao = $('#avisos-btn');
  painel = $('#avisos-painel');
  contador = $('#avisos-contador');
  listaEl = $('#avisos-lista');

  botao.addEventListener('click', (e) => {
    e.stopPropagation();
    painel.hidden ? abrir() : fechar();
  });
  $('#avisos-limpar').addEventListener('click', () => {
    avisos().lista = [];
    gravar();
    pintarLista();
    pintar();
  });
  // Clique fora ou Esc fecha, como qualquer menu.
  document.addEventListener('click', (e) => {
    if (!painel.contains(e.target) && !botao.contains(e.target)) fechar();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });

  aoMudarPublicacoes(conferirFeed);
  aoLerSeguidores(conferirSeguidores);
  db.onXP(aoGanharXP);
  // O save pode trocar inteiro (veio da nuvem, reset): o número acompanha.
  db.onChange(() => pintar());

  // Os seguidores o boot acabou de ler (sincronizarSocial); o feed, não.
  conferirDia();
  conferirWishlist();
  conferirFeed();
  carregarFeed();
  setInterval(() => { conferirDia(); conferirWishlist(); reler(); }, INTERVALO);
  // A virada da meia-noite com a aba parada: não espera os três minutos.
  setInterval(conferirDia, 60e3);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { conferirDia(); reler(); }
  });
  pintar();
}
