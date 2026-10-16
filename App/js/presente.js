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
// 3) Três das peças são da mesma cor: é o primeiro marco da coleção daquela
//    cor, e a pessoa escolhe logo de cara o item do avatar que ela libera (a
//    missão de introdução das coleções conta com isso). Na conta nova a cor é a
//    favorita, escolhida no Personagem: o trio só entra quando ela é salva
//    (darTrioDaCor). A cor fica em `state.presenteCor`.
//
// Ninguém ganha duas vezes: a data da entrega fica gravada no save
// (`state.boasVindas`), e é ela — não "o inventário está vazio" — que decide.
// Quem devolve tudo para a loja no modo administrador não ganha um presente
// novo, e quem herdou o save de antes das contas também não perde o dele.

import { PRESENTE, RARIDADE, COLECOES_DE_COR, normalizarMarca } from './config.js';
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
function pecasPorFaixa(cat, modelosFora, corFora = null) {
  const por = Object.fromEntries(PRESENTE.faixas.map(f => [f, []]));
  for (const it of catalogo.itens) {
    if (it.cat !== cat || db.temPeca(it.id) || modelosFora.has(modeloDa(it))) continue;
    if (corFora && normalizarMarca(it.cor) === corFora) continue;
    const faixa = db.raridadeDoDia(it.id);
    if (por[faixa] && !estoque.esgotada(it.id, faixa)) por[faixa].push(it);
  }
  return por;
}

// As peças do presente de uma cor: comuns ou incomuns, sem esgotar, de
// qualquer categoria.
function pecasDaCor(cor, modelosFora) {
  const alvo = normalizarMarca(cor);
  return catalogo.itens.filter(it => {
    if (normalizarMarca(it.cor) !== alvo || db.temPeca(it.id) || modelosFora.has(modeloDa(it))) return false;
    const faixa = db.raridadeDoDia(it.id);
    return PRESENTE.faixas.includes(faixa) && !estoque.esgotada(it.id, faixa);
  });
}

// As três peças da cor sorteada: uma de cada categoria do presente quando dá
// (camisa, calça, calçado fecham um look da cor), completando com o que houver
// da cor. Cor sem três peças elegíveis não entra no sorteio.
// Com `forcada` (a cor favorita) a cor não é sorteada: vale ela, e se faltar
// peça comum ou incomum dela entra qualquer outra peça dela que não esgotou.
function trioDaCor(modelosUsados, rnd, forcada = null) {
  const n = PRESENTE.daCor;
  if (forcada) return trioForcado(forcada, modelosUsados, rnd);
  const cores = Object.keys(COLECOES_DE_COR).filter(c => pecasDaCor(c, modelosUsados).length >= n);
  if (!cores.length) return { cor: null, itens: [] };
  const cor = cores[Math.floor(rnd() * cores.length)];
  const preferidas = PRESENTE.itens.map(i => i.cat);
  const itens = [];
  const pegar = (lista) => {
    const it = lista[Math.floor(rnd() * lista.length)];
    itens.push(it);
    modelosUsados.add(modeloDa(it));
  };
  for (const cat of preferidas) {
    const lista = pecasDaCor(cor, modelosUsados).filter(it => it.cat === cat);
    if (lista.length && itens.length < n) pegar(lista);
  }
  while (itens.length < n) {
    const usadas = new Set(itens.map(it => it.cat));
    const todas = pecasDaCor(cor, modelosUsados);
    if (!todas.length) break;
    const outras = todas.filter(it => !usadas.has(it.cat));
    pegar(outras.length ? outras : todas);
  }
  return { cor, itens };
}

function trioForcado(cor, modelosUsados, rnd) {
  const alvo = normalizarMarca(cor);
  const deQualquerFaixa = () => catalogo.itens.filter(it => normalizarMarca(it.cor) === alvo &&
    !db.temPeca(it.id) && !modelosUsados.has(modeloDa(it)) &&
    !estoque.esgotada(it.id, db.raridadeDoDia(it.id)));
  const itens = [];
  const pegar = (lista) => {
    const it = lista[Math.floor(rnd() * lista.length)];
    itens.push(it);
    modelosUsados.add(modeloDa(it));
  };
  // Primeiro as comuns e incomuns (uma por categoria do presente quando dá),
  // depois qualquer uma da cor.
  for (const cat of PRESENTE.itens.map(i => i.cat)) {
    const lista = pecasDaCor(cor, modelosUsados).filter(it => it.cat === cat);
    if (lista.length && itens.length < PRESENTE.daCor) pegar(lista);
  }
  while (itens.length < PRESENTE.daCor) {
    const lista = pecasDaCor(cor, modelosUsados);
    const resto = lista.length ? lista : deQualquerFaixa();
    if (!resto.length) break;
    pegar(resto);
  }
  return { cor, itens };
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
export function darPresente({ rnd = Math.random, semTrio = false } = {}) {
  if (db.state.boasVindas) return [];

  const ganhas = [];
  const modelosUsados = new Set();

  // Primeiro as três da cor; elas contam na cota da categoria delas. Conta
  // nova não leva o trio aqui: ele vem na cor favorita, escolhida no
  // Personagem (darTrioDaCor), e já guarda o lugar dele na cota (uma de cada).
  const trio = semTrio ? { cor: null, itens: [] } : trioDaCor(modelosUsados, rnd);
  const cota = Object.fromEntries(PRESENTE.itens.map(({ cat, quantas }) => [cat, quantas - (semTrio ? 1 : 0)]));
  for (const item of trio.itens) {
    const peca = db.adicionarPeca(item, { origem: 'presente' });
    if (peca) ganhas.push({ peca, item });
    if (cota[item.cat]) cota[item.cat] -= 1;
  }
  if (!semTrio) db.state.presenteCor = trio.cor;
  const corFora = trio.cor && normalizarMarca(trio.cor);

  for (const { cat } of PRESENTE.itens) {
    for (let i = 0; i < cota[cat]; i++) {
      // Refeito a cada peça: o modelo que acabou de sair tem de sumir do
      // sorteio da próxima, e é mais simples recontar do que remendar a lista.
      // O resto não repete a cor do trio: são três peças dela, não quatro.
      const por = pecasPorFaixa(cat, modelosUsados, corFora);

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
  estoque.levar(ganhas.map(({ peca }) => peca))
    .then(() => { estoque.numerar(ganhas.map(({ peca }) => peca)); db.salvar(); });
  return ganhas;
}

// Só o trio da cor, para quem recomeça as missões de introdução (Perfil ›
// Testes) numa conta de antes dele: sem as três peças, a missão das coleções
// não teria como ser cumprida.
export function darTrioDaCor({ rnd = Math.random, cor = null } = {}) {
  const modelos = new Set(db.state.inventario.map(p => {
    const it = catalogo.itens.find(i => i.id === p.id);
    return it ? modeloDa(it) : `id|${p.id}`;
  }));
  const trio = trioDaCor(modelos, rnd, cor);
  const ganhas = [];
  for (const item of trio.itens) {
    const peca = db.adicionarPeca(item, { origem: 'presente' });
    if (peca) ganhas.push({ peca, item });
  }
  db.state.presenteCor = trio.cor;
  db.salvar();
  estoque.levar(ganhas.map(({ peca }) => peca))
    .then(() => { estoque.numerar(ganhas.map(({ peca }) => peca)); db.salvar(); });
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
