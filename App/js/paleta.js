// A paleta do site: o tom perolado dos botões, painéis e abas.
//
// O CSS de cada paleta mora em css/icones.css (`html[data-paleta="…"]`); aqui
// só se escolhe qual vale. A escolha é do save (usuario.preferencias.paleta),
// então sobe para a nuvem junto com o resto e vale em qualquer aparelho. Uma
// cópia fica no navegador só para a tela de entrada já abrir na cor certa,
// antes de saber quem entrou.

import * as db from './db.js';

// As cores do iMac G3 (1999) e dos plásticos translúcidos da época.
export const PALETAS = [
  { id: 'bondi',      nome: 'Bondi',      cor: '#0095b6' },
  { id: 'blueberry',  nome: 'Blueberry',  cor: '#2e7bd6' },
  { id: 'indigo',     nome: 'Índigo',     cor: '#4b4fc4' },
  { id: 'grape',      nome: 'Grape',      cor: '#8a5cc9' },
  { id: 'strawberry', nome: 'Strawberry', cor: '#e8457a' },
  { id: 'ruby',       nome: 'Ruby',       cor: '#c8243c' },
  { id: 'tangerine',  nome: 'Tangerine',  cor: '#ff8c1a' },
  { id: 'lime',       nome: 'Lime',       cor: '#7ac143' },
  { id: 'sage',       nome: 'Sage',       cor: '#7f9a72' },
  { id: 'graphite',   nome: 'Graphite',   cor: '#5f6670' },
];
export const PALETA_PADRAO = 'bondi';

// A cor favorita (a do personagem) puxa a paleta mais parecida: escolher a
// cor já pinta o site. Branco não tem tom, fica no padrão.
const DA_COR_FAVORITA = {
  Preto: 'graphite', Branco: 'bondi', Cinza: 'graphite', Bege: 'sage', Marrom: 'tangerine',
  Vermelho: 'ruby', Rosa: 'strawberry', Laranja: 'tangerine', Amarelo: 'tangerine',
  Verde: 'lime', Azul: 'blueberry', Roxo: 'grape',
};
export const paletaDaCor = (nome) => DA_COR_FAVORITA[nome] || PALETA_PADRAO;

// Quem escolheu uma cor da paleta antiga fica com a nova mais parecida.
const ANTIGAS = {
  azul: 'bondi', turquesa: 'bondi', anil: 'indigo', lilas: 'grape', rosa: 'strawberry',
  coral: 'tangerine', dourado: 'tangerine', lima: 'lime', menta: 'sage', grafite: 'graphite',
};

const CHAVE = 'bd:paleta';
const valida = (id) => {
  id = ANTIGAS[id] || id;
  return PALETAS.some(p => p.id === id) ? id : PALETA_PADRAO;
};

// Mistura a cor com branco (`t` de 0 a 1), para o topo claro do ícone.
function clarear(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(v + (255 - v) * t));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

// O ícone da aba na cor da paleta: o mesmo cabide branco do ícone do app
// (Phosphor, o 'cabide' de icones.js) sobre o quadrado no tom escolhido.
// O ícone de quem instalou o app na tela inicial é o PNG fixo (Bondi).
function iconeDaPaleta(cor) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="${clarear(cor, .3)}"/><stop offset="1" stop-color="${cor}"/></linearGradient></defs>`
    + `<rect width="256" height="256" rx="58" fill="url(#g)"/>`
    + `<g transform="translate(40 46) scale(.6875)" fill="#fff">`
    + `<path d="M232,192H24a8,8,0,0,1-4.8-14.4L128,96l108.79,81.6A8,8,0,0,1,232,192Z" opacity=".35"/>`
    + `<path d="M241.57,171.2,141.33,96l23.46-17.6A8,8,0,0,0,168,72a40,40,0,1,0-80,0,8,8,0,0,0,16,0,24,24,0,0,1,47.69-3.78L123.34,89.49l-.28.22L14.43,171.2A16,16,0,0,0,24,200H232a16,16,0,0,0,9.6-28.8ZM232,184H24l104-78,104,78Z"/>`
    + `</g></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function trocarIcone(id) {
  const cor = PALETAS.find(p => p.id === id).cor;
  let link = document.querySelector('link[rel="icon"]');
  if (!link) link = document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }));
  link.type = 'image/svg+xml';
  link.removeAttribute('sizes');
  link.href = iconeDaPaleta(cor);
  // A barra do navegador no celular acompanha o fundo da paleta.
  const papel = getComputedStyle(document.documentElement).getPropertyValue('--papel').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', papel || cor);
}

export function aplicarPaleta(id) {
  id = valida(id);
  if (id === PALETA_PADRAO) delete document.documentElement.dataset.paleta;
  else document.documentElement.dataset.paleta = id;
  try { trocarIcone(id); } catch {}
  try { localStorage.setItem(CHAVE, id); } catch {}
  return id;
}

export const paletaAtual = () => valida(db.state.usuario.preferencias?.paleta);

export function escolherPaleta(id) {
  db.state.usuario.preferencias.paleta = aplicarPaleta(id);
  db.salvar();
}

// Antes do login: a última paleta usada neste navegador.
try { aplicarPaleta(localStorage.getItem(CHAVE)); } catch {}

// Depois do login, e quando o save muda (inclusive vindo da nuvem): a do save.
export function montarPaleta() {
  let ultima = null;
  const seguir = () => {
    const id = paletaAtual();
    if (id !== ultima) aplicarPaleta(ultima = id);
  };
  db.onChange(seguir);
  seguir();
}
