// O vestiário (roupinhas abertas e vestidas) e o progresso das coleções. É um
// pedaço de db.js: o estado é o `state` de lá, e as telas continuam importando
// tudo por `./db.js`.

import {
  COLECOES, normalizarMarca, COLECOES_DE_COR, ESTILOS, idDaCor, idDoEstilo,
} from './config.js';
import {
  ROUPINHAS, ROUPINHA, ORDEM_SLOTS, estadoDoDesbloqueio, escolhasDaColecao,
} from './roupinhas.js';
import { nivel, progredirMissao, salvar, state } from './db.js';

// --- Vestiário (roupinhas) ------------------------------------------------
// O catálogo e as regras de desbloqueio ficam em js/roupinhas.js; aqui mora o
// que é do jogador: o que ele já abriu e o que está vestindo.
//
// Nada fica gravado como "desbloqueado". A condição é lida do progresso na
// hora, igual ao nível sendo lido do XP: mexer numa meta lá revale para todo
// mundo sem migração de save, e nada que abriu fecha de novo — tudo que
// alimenta isso (nível, resgates, looks, publicações, dias fechados) só sobe.

// O que as condições das roupinhas leem. Um lugar só, para a grade, o toast e
// a barra de progresso dizerem sempre a mesma coisa.
export const progressoDoJogador = () => ({
  nivel: nivel(),
  resgates: state.stats.resgates ?? 0,
  looks: state.stats.looks ?? 0,
  publicacoes: state.stats.publicacoes ?? 0,
  dias: state.stats.diasCompletos ?? 0,
  colecoes: progressoDasColecoes(),
});

// --- Coleções -------------------------------------------------------------
// A marca de cada peça do acervo, por id. O catálogo preenche ao carregar
// (como raridadesFixas): db não importa catalog.js.
export const marcasFixas = new Map();
// A cor de cada peça do acervo, por id ('' quando não tem). Toda peça do
// acervo entra aqui, então as chaves também são a lista do acervo.
export const coresFixas = new Map();
// O tema de cada peça do acervo que ganhou um na esteira (id de config.ESTILOS).
export const temasFixos = new Map();

const pecasDaMarca = (marca) => {
  const alvo = normalizarMarca(marca);
  const ids = [];
  for (const [id, m] of marcasFixas) if (normalizarMarca(m) === alvo) ids.push(id);
  return ids;
};

// { [id da coleção]: { tem, total, ids } }: as peças da marca no acervo e
// quantas delas estão no seu guarda-roupa.
// Os itens que cada coleção libera, por id da coleção.
const ITENS_DA_COLECAO = new Map();
for (const r of ROUPINHAS) {
  const d = r.desbloqueio;
  if (d?.tipo !== 'colecao') continue;
  if (!ITENS_DA_COLECAO.has(d.colecao)) ITENS_DA_COLECAO.set(d.colecao, []);
  ITENS_DA_COLECAO.get(d.colecao).push(r.id);
}

// Abre um item da coleção, se ela tem escolha sobrando.
export function escolherItem(colecao, id) {
  const pc = progressoDasColecoes()[colecao];
  if (!pc || pc.livres < 1 || !(ITENS_DA_COLECAO.get(colecao) || []).includes(id)) return false;
  if (pc.escolhidas.includes(id)) return false;
  const v = state.vestiario;
  v.escolhas = { ...(v.escolhas || {}), [colecao]: [...pc.escolhidas, id] };
  progredirMissao('colecao');
  salvar();
  return true;
}

// Quantas escolhas estão esperando, somando todas as coleções.
export const escolhasLivres = () =>
  Object.values(progressoDasColecoes()).reduce((n, c) => n + c.livres, 0);

export function progressoDasColecoes() {
  const minhas = new Set(state.inventario.map(p => p.id));
  const out = {};
  const escolhas = state.vestiario.escolhas || {};
  const herdadas = new Set(state.vestiario.herdadas || []);
  const guardar = (id, ids) => {
    const tem = ids.filter(i => minhas.has(i)).length;
    const itens = ITENS_DA_COLECAO.get(id) || [];
    // Item que saiu da coleção não conta como escolha feita.
    const escolhidas = (escolhas[id] || []).filter(i => itens.includes(i));
    const ganhas = escolhasDaColecao(tem, ids.length, itens.length);
    // Item que você já tinha antes das coleções (herdado) não precisa ser
    // escolhido: a escolha só vale enquanto sobrar item trancado.
    const trancados = itens.filter(i => !escolhidas.includes(i) && !herdadas.has(i)).length;
    out[id] = { ids, total: ids.length, tem, escolhidas, ganhas,
                livres: Math.max(0, Math.min(ganhas - escolhidas.length, trancados)) };
  };
  for (const c of COLECOES) guardar(c.id, pecasDaMarca(c.marca));

  // Cor: as peças daquela cor. Tema: as escolhidas para ele (config.ESTILOS)
  // mais as que receberam o tema na esteira (campo `tema` do acervo).
  const acervo = [...coresFixas.keys()];
  for (const cor of Object.keys(COLECOES_DE_COR)) {
    const alvo = normalizarMarca(cor);
    guardar(idDaCor(cor), acervo.filter(id => normalizarMarca(coresFixas.get(id)) === alvo));
  }
  for (const [id, e] of Object.entries(ESTILOS)) {
    const pecas = new Set(e.pecas || []);
    // O tema gravado na peça manda; a lista de config vale para quem não tem.
    guardar(idDoEstilo(id), acervo.filter(p => (temasFixos.has(p) ? temasFixos.get(p) === id : pecas.has(p))));
  }
  return out;
}

// Os itens que trocaram de regra quando as coleções chegaram. Quem já tinha
// um deles pela regra antiga continua com ele: a lista é tirada uma vez, do
// progresso daquele momento, e gravada no save.
//
// Cada item é conferido uma vez só (`herdadasChecadas`): item que entrar numa
// coleção depois também é conferido, com o progresso do dia em que entrou.
export function roupinhasHerdadas() {
  const v = state.vestiario;
  const checadas = new Set(v.herdadasChecadas || []);
  const novas = ROUPINHAS.filter(r => r.antes && !checadas.has(r.id));
  if (novas.length) {
    const p = progressoDoJogador();
    const herdadas = new Set(v.herdadas || []);
    for (const r of novas) {
      if (estadoDoDesbloqueio({ desbloqueio: r.antes }, p).liberada) herdadas.add(r.id);
      checadas.add(r.id);
    }
    v.herdadas = [...herdadas];
    v.herdadasChecadas = [...checadas];
    salvar();
  }
  return v.herdadas;
}

export function estadoDaRoupinha(r) {
  const p = progressoDoJogador();
  const e = estadoDoDesbloqueio(r, p);
  if (e.liberada || !r.antes || !roupinhasHerdadas().includes(r.id)) return e;
  // Já era sua antes da coleção: a procedência é a regra antiga.
  return { ...estadoDoDesbloqueio({ desbloqueio: r.antes }, p), liberada: true, pct: 100 };
}

export const roupinhaLiberada = (id) => {
  const r = ROUPINHA[id];
  return Boolean(r) && estadoDaRoupinha(r).liberada;
};

export const roupinhasLiberadas = () =>
  ROUPINHAS.filter(r => estadoDaRoupinha(r).liberada);

// O que o avatar veste: lugar do corpo → id da peça. Peça que saiu do catálogo
// — ou que não está mais liberada, se uma meta mudar — some daqui sozinha, em
// vez de quebrar o desenho: o que se veste é derivado do que existe hoje.
export function roupasEquipadas() {
  const vestido = {};
  for (const slot of ORDEM_SLOTS) {
    const id = state.vestiario?.equipado?.[slot];
    if (!id || !roupinhaLiberada(id) || ROUPINHA[id].slot !== slot) continue;
    vestido[slot] = id;
  }
  return vestido;
}

// A ordem do saco e sua: arrastar uma peca sobre outra muda onde ela fica, e
// isso fica gravado. Quem nao esta na lista entra no fim, na ordem dos lugares
// do corpo — peca que abriu hoje nao embaralha o que voce ja arrumou ontem.
export function ordenarRoupinhas(lista) {
  const ordem = state.vestiario?.ordem || [];
  const pos = (r) => {
    const i = ordem.indexOf(r.id);
    return i === -1 ? Infinity : i;
  };
  return [...lista].sort((a, b) =>
    pos(a) - pos(b) || ORDEM_SLOTS.indexOf(a.slot) - ORDEM_SLOTS.indexOf(b.slot));
}

// Poe `id` na frente de `antesDe` — ou no fim do saco, quando o alvo e uma
// casa vazia. A lista gravada e a ordem inteira, nao so o que mudou: assim ela
// continua valendo quando o filtro de categoria esconde metade das pecas.
export function moverRoupinha(id, antesDe = null) {
  const todas = ordenarRoupinhas(roupinhasLiberadas()).map(r => r.id);
  const de = todas.indexOf(id);
  if (de === -1) return false;
  todas.splice(de, 1);
  const alvo = antesDe ? todas.indexOf(antesDe) : -1;
  todas.splice(alvo === -1 ? todas.length : alvo, 0, id);
  state.vestiario.ordem = todas;
  salvar();
  return true;
}

export function equiparRoupinha(id) {
  const r = ROUPINHA[id];
  if (!r || !roupinhaLiberada(id)) return false;
  state.vestiario.equipado[r.slot] = id;
  progredirMissao('vestir');
  salvar();
  return true;
}

export function tirarRoupinha(slot) {
  if (!state.vestiario.equipado[slot]) return false;
  delete state.vestiario.equipado[slot];
  salvar();
  return true;
}

export function tirarTudo() {
  state.vestiario.equipado = {};
  salvar();
}

// O que abriu desde a última olhada. Quem chama decide o que fazer com a
// lista (toast, pontinho na grade) — db não conhece a interface.
export function roupinhasNovas() {
  const v = state.vestiario;
  const liberadas = roupinhasLiberadas().map(r => r.id);
  const inedito = liberadas.filter(id => !v.conhecidas.includes(id));
  if (!inedito.length) return [];

  // A primeira vez não é novidade: o save nasce conhecendo o que já estava
  // aberto, senão o jogador leva 6 toasts na primeira tela que abrir.
  const estreia = !v.conhecidas.length;
  v.conhecidas = liberadas;
  if (!estreia) v.novas = [...new Set([...v.novas, ...inedito])];
  salvar();
  return estreia ? [] : inedito;
}

export const ehNova = (id) => state.vestiario.novas.includes(id);

export function marcarVista(id) {
  if (!ehNova(id)) return;
  state.vestiario.novas = state.vestiario.novas.filter(x => x !== id);
  salvar();
}
