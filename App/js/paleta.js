// A paleta do site: o tom perolado dos botões, painéis e abas.
//
// O CSS de cada paleta mora em css/icones.css (`html[data-paleta="…"]`); aqui
// só se escolhe qual vale. A escolha é do save (usuario.preferencias.paleta),
// então sobe para a nuvem junto com o resto e vale em qualquer aparelho. Uma
// cópia fica no navegador só para a tela de entrada já abrir na cor certa,
// antes de saber quem entrou.

import * as db from './db.js';

export const PALETAS = [
  { id: 'azul',    nome: 'Azul',    cor: '#34bEED' },
  { id: 'rosa',    nome: 'Rosa',    cor: '#f06ba8' },
  { id: 'menta',   nome: 'Menta',   cor: '#34c08a' },
  { id: 'lilas',   nome: 'Lilás',   cor: '#9a7cea' },
  { id: 'dourado', nome: 'Dourado', cor: '#eea52c' },
];
export const PALETA_PADRAO = 'azul';

const CHAVE = 'bd:paleta';
const valida = (id) => PALETAS.some(p => p.id === id) ? id : PALETA_PADRAO;

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
