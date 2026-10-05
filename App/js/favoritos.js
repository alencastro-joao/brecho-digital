// Favoritar: a estrela que escolhe o que aparece no seu perfil.
//
// O perfil não mostra tudo o que você tem — mostra o que você marcou. A regra
// de guardar está em db.js (o campo `favorito` mora na própria peça, no próprio
// look, na própria colagem); aqui está só o botão, que é o mesmo nas três
// telas para a estrela querer dizer sempre a mesma coisa.

import * as db from './db.js';
import { el, toast } from './util.js';

// Nome e concordância de cada coisa favoritável, para o aviso sair em português.
const ROTULO = {
  peca: ['Peça', 'favoritada'],
  look: ['Look', 'favoritado'],
  colagem: ['Colagem', 'favoritada'],
};

// Quantos de cada um o perfil mostra. Peça não tem teto; look e colagem têm
// três vagas cada, para o perfil ser uma vitrine escolhida e não um arquivo.
export const LIMITE_FAVORITOS = { look: 3, colagem: 3 };

// `aoMudar` repinta a lista de onde a estrela saiu — ela mesma não sabe
// desenhar a tela que a contém.
export function estrelaFavorito(tipo, id, aoMudar) {
  const [nome, participio] = ROTULO[tipo];
  const ligada = db.ehFavorito(tipo, id);

  return el('button', {
    class: 'fav-estrela mini' + (ligada ? ' on' : ''),
    title: ligada
      ? `No seu perfil — clique para tirar`
      : `Mostrar ${nome.toLowerCase()} no seu perfil`,
    onclick: (e) => {
      // A estrela fica dentro de uma linha clicável: o clique dela para aqui,
      // senão favoritar também abriria o item.
      e.stopPropagation();
      const limite = LIMITE_FAVORITOS[tipo];
      if (!ligada && limite && db.favoritos(tipo).length >= limite) {
        toast(`Seu perfil já tem ${limite} ${tipo === 'look' ? 'looks' : 'colagens'} ` +
          'favoritos. Tire a estrela de um para colocar este.', 'aviso');
        return;
      }
      const agora = db.alternarFavorito(tipo, id);
      toast(agora
        ? `${nome} ${participio} — está no seu perfil.`
        : `${nome} fora do perfil.`);
      aoMudar?.();
    },
  }, ligada ? '★' : '☆');
}
