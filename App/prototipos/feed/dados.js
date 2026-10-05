// Dados dos protótipos do feed: posts montados na hora com o mesmo sorteio e o
// mesmo render do app (peças do acervo de verdade, avatares dos perfis de
// exemplo). Semente fixa: recarregar mostra sempre a mesma tela, então as
// capturas das três opções são comparáveis.
//
// Só lê. Não abre save nenhum nem grava no localStorage.

import { PERFIS_MOCK, NOMES_LOOK_MOCK, COMENTARIOS_MOCK, RARIDADE, MISSOES, COLLAB } from '../../js/config.js';
import { carregarCatalogo, catalogo, nomeDaPeca } from '../../js/catalog.js';
import { renderizarLook, renderizarBoard, FORMATOS } from '../../js/render.js';
import { sortearConjunto, camadasParaAvatar, colagemAleatoria } from '../../js/sorteio.js';
import { aparenciaDoPerfil, retrato } from '../../js/avatar.js';
import { roupasDoPerfil } from '../../js/pessoas.js';
import { el, mulberry32, shuffle, escolher } from '../../js/util.js';

export { el, PERFIS_MOCK, RARIDADE, MISSOES, nomeDaPeca };

// O look do feed em 2:3, maior que a miniatura (360×600) para não borrar no
// card grande.
FORMATOS.proto = { w: 720, h: 1080, nome: 'proto' };

const ORDEM_RARIDADE = ['legendary', 'epic', 'rare', 'uncommon', 'common'];

export const perfil = (id) => PERFIS_MOCK.find(p => p.id === id);

export const rosto = (id, tamanho = 36) => {
  const p = perfil(id);
  return retrato(aparenciaDoPerfil(p), tamanho, p.cor, roupasDoPerfil(p));
};

// Peça com ficha: a raridade vem do acervo; quem não tem é comum.
export const raridadeDe = (peca) => RARIDADE[peca.raridade] || RARIDADE.common;

// As cores da raridade como variáveis, para .selo-rar e .peca-tile.
const TINTA_RAR = { common: '#6b6560', uncommon: '#23864a', rare: '#2563c4', epic: '#7a35c9', legendary: '#8a6a00' };
export const corRar = (peca) => {
  const r = raridadeDe(peca);
  return {
    '--rar-bg': r.bg, '--rar-cor': r.cor, '--rar-tinta': TINTA_RAR[r.id],
    '--rar-aura': r.aura === 'arco-iris' ? '#e0a800' : (r.aura || '#b3aaa0'),
  };
};

// A peça mais rara do post — é ela que vira selo no card.
export const maisRara = (pecas) => [...pecas].sort((a, b) =>
  ORDEM_RARIDADE.indexOf(a.raridade || 'common') - ORDEM_RARIDADE.indexOf(b.raridade || 'common'))[0];

export async function prepararAcervo() {
  await carregarCatalogo();
  // O único "vestido" do acervo hoje é uma saia (no sorteio ele entra no lugar
  // de blusa + calça e o avatar sai sem nada em cima) e o único casaco aparece
  // em quase todo look. Os dois ficam fora dos protótipos.
  return catalogo.itens.filter(i => !COLLAB.itens.includes(i.id) && !['dresses', 'coats'].includes(i.cat));
}

// Estado de cada peça para quem está vendo o post: tem, está na loja de hoje,
// ou nenhum dos dois. No protótipo é um sorteio fixo sobre o acervo.
export function estadoDasPecas(acervo, semente = 7) {
  const rnd = mulberry32(semente);
  const embaralhado = shuffle(acervo, rnd);
  const tenho = new Set(embaralhado.slice(0, Math.round(acervo.length * 0.3)).map(i => i.id));
  const naLoja = new Set(embaralhado.slice(-Math.round(acervo.length * 0.18)).map(i => i.id));
  return (peca) => tenho.has(peca.id) ? 'tenho' : naLoja.has(peca.id) ? 'loja' : 'falta';
}

// `tipos` é a sequência de look/board; repete quando acaba.
export async function gerarPosts(acervo, quantos, { semente = 20261005, tipos = ['look', 'board'], autores = null } = {}) {
  const rnd = mulberry32(semente);
  const gente = autores ? autores.map(perfil) : shuffle(PERFIS_MOCK, rnd);
  const posts = [];
  for (let i = 0; i < quantos; i++) {
    const autor = gente[i % gente.length];
    const tipo = tipos[i % tipos.length];
    const pecas = sortearConjunto(acervo, rnd, { minimo: 5 }).filter(Boolean);
    let canvas;
    if (tipo === 'board') {
      const colagem = colagemAleatoria(pecas, rnd, { assinatura: { texto: autor.handle, visivel: true } });
      canvas = await renderizarBoard(colagem, { escala: 0.62 });
    } else {
      canvas = await renderizarLook(camadasParaAvatar(pecas, rnd), {
        formato: 'proto', fundo: true, aparencia: aparenciaDoPerfil(autor),
      });
    }
    const outros = shuffle(PERFIS_MOCK.filter(p => p.id !== autor.id), rnd);
    const nComentarios = Math.floor(rnd() * 9);
    posts.push({
      id: 'p' + i,
      autor: autor.id,
      tipo,
      nome: escolher(NOMES_LOOK_MOCK, rnd),
      img: canvas.toDataURL('image/webp', 0.86),
      proporcao: canvas.width / canvas.height,
      pecas,
      curtidas: 6 + Math.floor(rnd() * 140),
      horas: 0.4 + i * 1.7 + rnd() * 2,
      comentarios: outros.slice(0, Math.min(nComentarios, 3)).map(p => ({
        autor: p.id, texto: escolher(COMENTARIOS_MOCK, rnd),
      })),
      totalComentarios: nComentarios,
    });
  }
  return posts;
}

export const tempo = (horas) => horas < 1 ? `há ${Math.max(1, Math.round(horas * 60))} min`
  : horas < 24 ? `há ${Math.floor(horas)} h` : `há ${Math.floor(horas / 24)} d`;

export const selo = (peca) => el('span', { class: 'selo-rar', style: corRar(peca) }, raridadeDe(peca).nome);

export const tile = (peca, tamanho = 44) => el('span', {
  class: 'peca-tile', style: { ...corRar(peca), width: tamanho + 'px', height: tamanho + 'px' },
}, el('img', { src: peca.src, alt: nomeDaPeca(peca) }));

// Avisa a captura que a tela terminou de montar.
export const pronto = () => { document.body.dataset.pronto = '1'; };

// A barra lateral do app, igual à de index.html, com o Feed aceso.
export function sidebar() {
  const botoes = [
    ['loja', 'Loja'], ['inventario', 'Closet'], ['stylist', 'Stylist'], ['board', 'Colagem'],
    ['social', 'Feed'], ['tarefas', 'Tarefas'], ['vestiario', 'Roupas'], ['perfil', 'Perfil'],
  ];
  return el('aside', { class: 'sidebar' },
    el('div', { class: 'sidebar-icons' }, ...botoes.map(([c, r]) =>
      el('button', { class: `sidebar-btn ${c}${c === 'social' ? ' ativa' : ''}` }, el('span', {}, r)))),
    el('div', { class: 'sidebar-rodape' },
      el('div', { class: 'nivel-selo' }, el('strong', {}, '4'), el('small', {}, 'nível'),
        el('div', { class: 'nivel-barra mini' }, el('span', { style: { width: '62%' } }))),
      el('div', { class: 'logo-mini' }, 'BD')));
}
