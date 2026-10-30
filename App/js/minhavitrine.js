// A ordem das abas do seu perfil — Colagens, Roupas e Stylists —, a mesma no
// seu perfil (perfil.js) e no que os outros veem (pessoas.js manda as listas
// já nesta ordem).
//
// De saída, as favoritas vêm na frente: as roupas com estrela e depois as que
// chegaram por último; os looks e as colagens com estrela (até três) e depois
// do mais novo para o mais velho. Segurar e arrastar no seu perfil muda a
// ordem, e o que você arrumou fica na frente do resto.

import { item as pecaDoCatalogo } from './catalog.js';
import * as db from './db.js';

// Junta as favoritas e o resto sem repetir peça.
export function previaDeRoupas(favoritas, todas) {
  const ids = new Set();
  return [...favoritas, ...todas].filter(p => p && !ids.has(p.id) && ids.add(p.id));
}

export const favoritasPrimeiro = (lista = []) =>
  [...lista.filter(o => o.favorito), ...lista.filter(o => !o.favorito)];

// O que está em `ids` primeiro, na ordem de `ids`; o resto depois, como veio.
export function naOrdem(lista, ids = []) {
  const pos = new Map(ids.map((id, i) => [id, i]));
  return [
    ...lista.filter(x => pos.has(x.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id)),
    ...lista.filter(x => !pos.has(x.id)),
  ];
}

const porData = (lista) => [...lista]
  .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm));

const porObtencao = (lista) => [...lista]
  .sort((a, b) => new Date(b.obtidoEm || 0) - new Date(a.obtidoEm || 0));

// As peças favoritas. O inventário guarda só o id, então a imagem vem do
// catálogo: favorita de acervo desligado simplesmente não entra.
export const pecasFavoritas = () => db.favoritos('peca')
  .map(p => pecaDoCatalogo(p.id))
  .filter(Boolean);

export const minhasRoupas = () => naOrdem(
  previaDeRoupas(pecasFavoritas(), porObtencao(db.state.inventario).map(x => pecaDoCatalogo(x.id))),
  db.ordemDoPerfil('roupas'));

export const meusLooks = () => naOrdem(favoritasPrimeiro(porData(db.state.looks)), db.ordemDoPerfil('looks'));

export const minhasColagens = () => naOrdem(favoritasPrimeiro(porData(db.state.boards)), db.ordemDoPerfil('colagens'));
