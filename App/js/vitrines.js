// Protótipo: o feed como vitrines, uma por pessoa, com os looks dela expostos.
//
// Só abre pelo link (#/social/vitrine-a, -b ou -c): o feed de sempre não muda.
// As três ideias usam os mesmos posts do feed, agrupados por quem postou:
//   a) em fila — uma vitrine embaixo da outra;
//   b) mural — as vitrines espalhadas, flutuando, como as peças da Loja;
//   c) uma por vez — a vitrine grande, com a fila das próximas no topo.
// A vitrine acende quando a pessoa postou nas últimas 24 h.

import { el, tempoRelativo } from './util.js';
import { irPara } from './router.js';
import { ico } from './icones.js';
import {
  imagemDoPost, retratoDe, autorDe, abrirAutor, abrirPostGrande, alternarCurtida,
} from './social.js';

const DIA = 864e5;
const POR_VITRINE = 3;
const MODOS = [['a', 'Em fila'], ['b', 'Mural'], ['c', 'Uma por vez']];
const CHAVE_VISITADAS = 'brecho-vitrines-visitadas';

let atual = 0;                              // c: a vitrine aberta
let repintar = () => {};

// As vitrines visitadas hoje (b) ficam neste navegador.
const hoje = () => new Date().toISOString().slice(0, 10);
function lerVisitadas() {
  try {
    const salvo = JSON.parse(localStorage.getItem(CHAVE_VISITADAS) || '{}');
    return new Set(salvo.dia === hoje() ? salvo.ids : []);
  } catch { return new Set(); }
}
const visitadas = lerVisitadas();
function visitar(id) {
  visitadas.add(id);
  try { localStorage.setItem(CHAVE_VISITADAS, JSON.stringify({ dia: hoje(), ids: [...visitadas] })); } catch {}
}

// Os posts já vêm do mais novo para o mais velho: a vitrine de cada pessoa
// são os últimos dela, e a ordem das vitrines é a de quem postou por último.
function vitrinesDe(posts) {
  const porAutor = new Map();
  for (const p of posts) {
    if (!porAutor.has(p.autor)) porAutor.set(p.autor, []);
    const lista = porAutor.get(p.autor);
    if (lista.length < POR_VITRINE) lista.push(p);
  }
  return [...porAutor].map(([autor, lista]) => ({
    autor, posts: lista,
    quando: lista[0].criadoEm,
    nova: Date.now() - new Date(lista[0].criadoEm) < DIA,
  }));
}

export function renderVitrines(posts, modo, aoMudar) {
  repintar = aoMudar;
  const vitrines = vitrinesDe(posts);
  const corpo = !vitrines.length
    ? el('p', { class: 'vt-vazio' }, 'Ninguém com vitrine por aqui ainda.')
    : modo === 'b' ? mural(vitrines)
    : modo === 'c' ? umaPorVez(vitrines)
    : fila(vitrines);
  return el('div', { class: `vt vt-${modo}` }, seletor(modo), corpo);
}

function seletor(modo) {
  return el('div', { class: 'vt-seletor' },
    el('span', {}, 'Protótipo'),
    ...MODOS.map(([id, rotulo]) => el('button', {
      class: 'vt-modo' + (id === modo ? ' ativo' : ''),
      onclick: () => irPara('social', 'vitrine-' + id),
    }, rotulo)),
    el('button', { class: 'vt-modo', onclick: () => irPara('social') }, 'Feed atual'));
}

// ------------------------------ Peças comuns ------------------------------
const corDe = (id) => autorDe(id).cor || '#eee';

function toldo(id) {
  return el('div', { class: 'vt-toldo', style: { '--cor': corDe(id) }, 'aria-hidden': 'true' });
}

function lookNaVitrine(post, i) {
  return el('button', {
    class: 'vt-look' + (post.tipo === 'board' ? ' colagem' : ''),
    style: { '--i': i },
    title: post.nome || 'Abrir',
    onclick: (e) => { e.stopPropagation(); abrirPostGrande(post.id); },
  }, imagemDoPost(post));
}

function plaquinha(v, { curta = false } = {}) {
  const autor = autorDe(v.autor);
  const total = v.posts.length;
  return el('div', { class: 'vt-placa' },
    el('button', { class: 'vt-retrato', style: { background: corDe(v.autor) },
      title: 'Abrir o perfil', onclick: () => entrar(v) }, retratoDe(v.autor, 38)),
    el('div', { class: 'vt-quem' },
      el('strong', {}, autor.nome),
      el('small', {},
        v.nova ? el('i', { class: 'vt-luz', 'aria-hidden': 'true' }) : null,
        curta ? tempoRelativo(v.quando)
          : `${total} ${total === 1 ? 'post' : 'posts'} · ${tempoRelativo(v.quando)}`)));
}

function curtir(v) {
  const post = v.posts[0];
  return el('button', {
    class: 'vt-curtir' + (post.curtido ? ' on' : ''),
    title: post.curtido ? 'Descurtir o mais novo' : 'Curtir o mais novo',
    onclick: (e) => { e.stopPropagation(); alternarCurtida(post, e.currentTarget).then(() => repintar()); },
  }, ico(post.curtido ? 'coracao-cheio' : 'coracao'), post.curtidas ? el('span', {}, String(post.curtidas)) : null);
}

function entrar(v) {
  visitar(v.autor);
  abrirAutor(v.autor);
}

function vidro(v, extra = null) {
  return el('div', { class: 'vt-vidro' + (v.nova ? ' acesa' : '') },
    el('div', { class: 'vt-looks' }, ...v.posts.map(lookNaVitrine)),
    extra);
}

// --------------------------------- a) fila --------------------------------
function fila(vitrines) {
  return el('div', { class: 'vt-fila' }, ...vitrines.map(v =>
    el('section', { class: 'vt-vitrine' },
      toldo(v.autor),
      vidro(v, el('div', { class: 'vt-rodape' }, plaquinha(v), curtir(v),
        el('button', { class: 'vt-entrar', onclick: () => entrar(v) }, 'Entrar'))))));
}

// -------------------------------- b) mural --------------------------------
// Espalhadas sem sorteio: o ângulo e o desvio saem da posição, então repintar
// (uma curtida) não embaralha o mural.
function mural(vitrines) {
  const novas = vitrines.filter(v => v.nova);
  const vistas = vitrines.filter(v => visitadas.has(v.autor)).length;
  const ultima = vitrines[0];
  return el('div', { class: 'vt-mural' },
    el('div', { class: 'vt-mural-topo' },
      el('div', { class: 'vt-contador' },
        el('strong', {}, `${vistas} / ${vitrines.length}`), el('small', {}, 'visitadas hoje')),
      balao(ultima) || el('p', {}, novas.length
        ? `${novas.length} ${novas.length === 1 ? 'vitrine trocou' : 'vitrines trocaram'} desde ontem.`
        : 'Nenhuma vitrine nova desde ontem.')),
    el('div', { class: 'vt-mural-area' }, ...vitrines.map((v, i) =>
      el('div', {
        class: 'vt-mini' + (visitadas.has(v.autor) ? ' vista' : ''),
        style: { '--rot': `${[-4, 3, -2, 5, -5, 2][i % 6]}deg`, '--desce': `${[0, 28, 10, 40, 4, 22][i % 6]}px`, '--atraso': `${(i % 5) * -1.1}s` },
        onclick: () => entrar(v),
      },
        toldo(v.autor),
        el('div', { class: 'vt-vidro' + (v.nova ? ' acesa' : '') },
          el('div', { class: 'vt-looks' }, lookNaVitrine(v.posts[0], 0))),
        el('div', { class: 'vt-etiqueta' }, el('b', {}, autorDe(v.autor).nome), ' · ', tempoRelativo(v.quando)),
        visitadas.has(v.autor) ? el('span', { class: 'vt-visto', 'aria-label': 'visitada' }, ico('ok')) : null))));
}

// O dono da vitrine mais nova avisa que trocou.
function balao(v) {
  if (!v?.nova) return null;
  return el('button', { class: 'vt-balao', onclick: () => entrar(v) },
    el('span', { class: 'vt-balao-quem', style: { background: corDe(v.autor) } }, retratoDe(v.autor, 44)),
    el('span', { class: 'vt-balao-fala' },
      el('b', {}, autorDe(v.autor).nome), ': troquei a minha vitrine. Vem ver!'));
}

// ----------------------------- c) uma por vez -----------------------------
function umaPorVez(vitrines) {
  atual = Math.min(atual, vitrines.length - 1);
  const v = vitrines[atual];
  const ir = (i) => { atual = (i + vitrines.length) % vitrines.length; visitar(vitrines[atual].autor); repintar(); };
  visitar(v.autor);
  return el('div', { class: 'vt-passeio' },
    el('div', { class: 'vt-proximas' }, ...vitrines.map((x, i) => el('button', {
      class: 'vt-prox' + (i === atual ? ' atual' : '') + (x.nova ? ' acesa' : ''),
      onclick: () => ir(i),
    }, toldo(x.autor), el('span', {}, autorDe(x.autor).nome)))),
    el('div', { class: 'vt-palco' },
      el('div', { class: 'vt-vitrine grande' },
        toldo(v.autor),
        vidro(v, plaquinha(v)))),
    el('div', { class: 'vt-controles' },
      el('button', { class: 'vt-perola', onclick: () => ir(atual - 1) }, 'Anterior'),
      curtir(v),
      el('button', { class: 'vt-perola', onclick: () => ir(atual + 1) }, 'Próxima')),
    el('button', { class: 'vt-entrar largo', onclick: () => entrar(v) }, 'Entrar na vitrine'));
}
