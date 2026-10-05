// Catálogo de peças.
//
// Lê assets/acervo.json (o acervo do administrador, publicado pela esteira).
// Cada item traz a imagem otimizada + o contorno vetorial. O contorno vira um
// <clipPath> SVG aplicado na imagem: com ele o navegador passa a ignorar os
// pixels transparentes também no clique e no hover — é a versão "geométrica" do
// problema, como no documento de upload/formatação. Peça sem contorno cai no
// hit-test por canal alpha de alpha.js.

import { CONFIG, CATEGORIAS, migrarCategoria } from './config.js';
import * as db from './db.js';

const SINGULAR = {
  shoes: 'Sapato', pants: 'Calça', shorts: 'Bermuda', skirts: 'Saia', dresses: 'Vestido',
  shirts: 'Camisa', coats: 'Casaco', cropped: 'Top', watches: 'Relógio', bracelets: 'Pulseira',
  necklaces: 'Colar', glasses: 'Óculos', hats: 'Chapéu', bags: 'Bolsa',
};

export const catalogo = {
  itens: [],
  porId: new Map(),
  temContorno: false,
  removidas: [],             // ids que o admin apagou do acervo (ver db.esquecerPecas)
};

export async function carregarCatalogo() {
  // O acervo do administrador: peças publicadas pela esteira, com ficha (nome,
  // marca, raridade) e a âncora medida no molde.
  catalogo.itens = await carregarAcervo();

  // As peças subidas pelo navegador (legado) entram no mesmo catálogo: a partir
  // daqui todo o resto do app (closet, Stylist, prancheta, render) as trata
  // como qualquer outra peça.
  catalogo.itens.push(...db.state.pecasProprias.map(p => ({ ...p, propria: true })));

  // O acervo.json ainda traz peça com categoria antiga.
  for (const it of catalogo.itens) it.cat = migrarCategoria(it.cat);

  catalogo.itens.sort((a, b) => a.id.localeCompare(b.id));
  catalogo.porId = new Map(catalogo.itens.map(i => [i.id, i]));
  montarClipPaths();
  return catalogo;
}

async function carregarAcervo() {
  try {
    const resp = await fetch(CONFIG.ACERVO, { cache: 'no-cache' });
    if (!resp.ok) return [];
    const data = await resp.json();
    catalogo.removidas = Array.isArray(data.removidas) ? data.removidas : [];
    const itens = (data.items || []).map(i => ({ ...i, permanente: true }));
    for (const it of itens) {
      if (it.raridade) db.raridadesFixas.set(it.id, it.raridade);
    }
    if (itens.some(i => i.path)) catalogo.temContorno = true;
    return itens;
  } catch {
    return [];                 // sem acervo ainda: catálogo vazio
  }
}

// Registra (ou atualiza) uma peça no catálogo em memória, sem recarregar tudo.
export function registrarPeca(peca, { permanente = false } = {}) {
  const item = permanente ? { ...peca, permanente: true } : { ...peca, propria: true };
  item.cat = migrarCategoria(item.cat);
  if (permanente && peca.raridade) db.raridadesFixas.set(peca.id, peca.raridade);
  const i = catalogo.itens.findIndex(x => x.id === item.id);
  if (i >= 0) catalogo.itens[i] = item;
  else catalogo.itens.push(item);
  catalogo.porId.set(item.id, item);
  return item;
}

// A peça apagada do acervo sai do catálogo em memória, sem recarregar tudo.
export function esquecerPeca(id) {
  catalogo.itens = catalogo.itens.filter(x => x.id !== id);
  catalogo.porId.delete(id);
}

export const item = (id) => catalogo.porId.get(id);
export const itensDaCategoria = (cat) => catalogo.itens.filter(i => i.cat === cat);
export function nomeDaPeca(it) {
  if (!it) return 'Peça';
  const tipo = SINGULAR[it.cat] || 'Peça';
  if (it.nome?.trim()) return it.nome.trim();
  if (it.marca?.trim()) return `${tipo} ${it.marca.trim()}`;
  // Sem nome e sem marca, a cor é o que sobra para distinguir uma da outra —
  // e ela quase sempre existe, porque vem reconhecida da imagem. O id só
  // aparece quando nem isso tem: é identificação, não nome.
  if (it.cor?.trim()) return `${tipo} ${it.cor.trim().toLowerCase()}`;
  return `${tipo} nº ${it.id}`;
}
export const proporcao = (it) => (it.w && it.h ? it.w / it.h : 1);

// Uma <defs> global com um clipPath por peça, em coordenadas objectBoundingBox.
function montarClipPaths() {
  document.getElementById('bd-clips')?.remove();
  const comPath = catalogo.itens.filter(i => i.path);
  if (!comPath.length) return;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.id = 'bd-clips';
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';

  const defs = document.createElementNS(ns, 'defs');
  for (const it of comPath) {
    const clip = document.createElementNS(ns, 'clipPath');
    clip.id = 'clip-' + it.id;
    clip.setAttribute('clipPathUnits', 'objectBoundingBox');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', it.path);
    p.setAttribute('transform', 'scale(0.001)'); // o path vive num espaço 0..1000
    clip.append(p);
    defs.append(clip);
  }
  svg.append(defs);
  document.body.append(svg);
}

// Aplica o recorte na <img> quando existe contorno para a peça.
export function aplicarContorno(img, it) {
  if (!it?.path) return false;
  img.style.clipPath = `url(#clip-${it.id})`;
  return true;
}

export const rotuloCategoria = (cat) => CATEGORIAS[cat]?.nome ?? cat;
