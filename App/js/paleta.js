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

export function aplicarPaleta(id) {
  id = valida(id);
  if (id === PALETA_PADRAO) delete document.documentElement.dataset.paleta;
  else document.documentElement.dataset.paleta = id;
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
