// O presente de boas-vindas.
//
// Quem acaba de criar a conta cai na vitrine com o guarda-roupa vazio: o closet
// sem casa preenchida, o Stylist sem o que arrastar, o personagem pelado. A
// primeira sessão fica sendo "pegue três peças e volte amanhã". O presente
// resolve isso com o mínimo — duas camisas, duas calças e dois calçados (ver
// PRESENTE em config.js) —, o suficiente para um look fechar e ainda sobrar
// troca em cada categoria.
//
// Duas decisões que valem explicação:
//
// 1) O presente sorteia a faixa primeiro e a peça depois, e não o contrário.
//    Sortear a peça e depois carimbar nela uma raridade seria mentir na ficha:
//    peça do acervo do administrador já nasce com a raridade escrita (as
//    `raridadesFixas`), e a mesma peça não pode ser rara no mural e comum no
//    presente de quem entrou. Então a faixa é sorteada nos pesos do jogo e a
//    peça é escolhida entre as que *já são* daquela faixa hoje.
//
// 2) O presente entra antes de a vitrine ser montada (ver js/app.js). O sorteio
//    do dia exclui o que você já tem, então a loja de hoje abre sem as seis
//    peças — que é o certo: o que já é seu não está mais à venda.
//
// Ninguém ganha duas vezes: a data da entrega fica gravada no save
// (`state.boasVindas`), e é ela — não "o inventário está vazio" — que decide.
// Quem devolve tudo para a loja no modo administrador não ganha um presente
// novo, e quem herdou o save de antes das contas também não perde o dele.

import { PRESENTE, RARIDADE } from './config.js';
import { catalogo, nomeDaPeca, rotuloCategoria } from './catalog.js';
import * as db from './db.js';
import * as estoque from './estoque.js';

// Sorteia uma das faixas do presente mantendo a proporção que elas têm entre si
// no jogo. Com comum (60) e incomum (25): ~70% contra ~30%.
function sortearFaixa(rnd = Math.random) {
  const pesos = PRESENTE.faixas.map(id => RARIDADE[id]?.peso ?? 0);
  const total = pesos.reduce((a, b) => a + b, 0);
  let n = rnd() * total;
  for (let i = 0; i < PRESENTE.faixas.length; i++) {
    if (n < pesos[i]) return PRESENTE.faixas[i];
    n -= pesos[i];
  }
  return PRESENTE.faixas[0];
}

// O "modelo" da peça: mesma categoria, mesmo nome e mesma marca. O acervo tem
// famílias assim — quatro moletons Hollister (branco, verde, cinza e rosa), dois
// Gel-Nimbus, dois Wing Skull —, peças diferentes de verdade, mas que na arara
// leem como a mesma roupa repetida. Peça sem nome não tem família: ela é o
// próprio id, e nunca colide com ninguém.
export const modeloDa = (it) => {
  const nome = (it.nome || '').trim().toLowerCase();
  const marca = (it.marca || '').trim().toLowerCase();
  return nome ? `${it.cat}|${nome}|${marca}` : `id|${it.id}`;
};

// As peças de uma categoria que podem entrar no presente, separadas por faixa.
// A raridade vem de db.raridadeDoDia(): ela devolve a da ficha para o acervo
// permanente e a sorteada do dia para o resto — é a mesma que o mural mostra.
//
// `modelosFora` tira do sorteio as famílias que o presente já usou: das oito
// calças elegíveis, quatro são o mesmo moletom em quatro cores, e sem isto o
// presente entregava as duas calças praticamente iguais — um presente de duas
// peças que parece de uma.
function pecasPorFaixa(cat, modelosFora) {
  const por = Object.fromEntries(PRESENTE.faixas.map(f => [f, []]));
  for (const it of catalogo.itens) {
    if (it.cat !== cat || db.temPeca(it.id) || modelosFora.has(modeloDa(it))) continue;
    const faixa = db.raridadeDoDia(it.id);
    if (por[faixa] && !estoque.esgotada(it.id, faixa)) por[faixa].push(it);
  }
  return por;
}

/**
 * Entrega o presente a quem ainda não recebeu.
 *
 * Não mexe nos resgates do dia nem nas missões: o presente é da casa, não é
 * garimpo — gastar resgate nele seria começar o primeiro dia já sem nenhum.
 *
 * @returns {Array<{peca: object, item: object}>} o que entrou no guarda-roupa
 *          (vazio quando a pessoa já tinha recebido ou o acervo não tem peça
 *          comum ou incomum nessas categorias).
 */
export function darPresente({ rnd = Math.random } = {}) {
  if (db.state.boasVindas) return [];

  const ganhas = [];
  const modelosUsados = new Set();
  for (const { cat, quantas } of PRESENTE.itens) {
    for (let i = 0; i < quantas; i++) {
      // Refeito a cada peça: o modelo que acabou de sair tem de sumir do
      // sorteio da próxima, e é mais simples recontar do que remendar a lista.
      const por = pecasPorFaixa(cat, modelosUsados);

      // A faixa sorteada é a preferência, não uma exigência: acervo pequeno
      // pode não ter nenhuma incomum de calça, e é melhor dar a comum do que
      // entregar o presente faltando peça.
      const faixa = sortearFaixa(rnd);
      const lista = por[faixa].length
        ? por[faixa]
        : PRESENTE.faixas.map(f => por[f]).find(l => l.length);
      if (!lista) break;              // categoria sem peça elegível: sem presente aqui

      const item = lista[Math.floor(rnd() * lista.length)];
      modelosUsados.add(modeloDa(item));
      const peca = db.adicionarPeca(item, { origem: 'presente' });
      if (peca) ganhas.push({ peca, item });
    }
  }

  // Gravado mesmo com as mãos vazias: sem acervo nenhum na primeira abertura, o
  // presente não vira uma dívida que o app tenta pagar em todo boot seguinte.
  db.state.boasVindas = new Date().toISOString();
  db.salvar();
  // O presente também sai da tiragem. Não espera a resposta: o que já esgotou
  // ficou fora do sorteio acima, e a corrida pela última cópia é rara demais
  // para segurar a primeira tela por ela.
  estoque.levar(ganhas.map(({ peca }) => ({ id: peca.id, raridade: peca.raridade })));
  return ganhas;
}

// Uma linha para o toast: "2 Tops, 2 Calças e 2 Calçados". Conta o que de fato
// entrou, não o que o PRESENTE pedia — as duas listas só são iguais quando o
// acervo tinha peça para todas as casas.
export function resumoDoPresente(ganhas) {
  const porCat = new Map();
  for (const { item } of ganhas) porCat.set(item.cat, (porCat.get(item.cat) ?? 0) + 1);

  const partes = [...porCat].map(([cat, n]) => `${n} ${rotuloCategoria(cat)}`);
  if (partes.length < 2) return partes.join('');
  return partes.slice(0, -1).join(', ') + ' e ' + partes.at(-1);
}

// O que apareceu de incomum, para o presente não ser só um número no toast.
// Casado com a faixa, e não com "tudo que não é comum": quem mexer em
// PRESENTE.faixas não passa a anunciar uma rara chamando-a de incomum.
export const incomunsDoPresente = (ganhas) => ganhas
  .filter(({ peca }) => peca.raridade === 'uncommon')
  .map(({ item }) => nomeDaPeca(item));
