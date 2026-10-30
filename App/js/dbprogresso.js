// Missões (do dia, da semana e de introdução), baús, trilha de níveis, XP e os
// pontinhos vermelhos. É um pedaço de db.js: o estado é o `state` de lá, e as
// telas continuam importando tudo por `./db.js`.

import { hojeISO } from './util.js';
import {
  PREMIOS_DE_NIVEL, premioDoNivel, MISSOES, INTRO, MISSOES_SEMANA, PREMIO_SEMANA, MARCOS_DIA,
  MARCOS_SEMANA, BAU_ESPECIAL, premioDoBau, nivelPorXP, progressoDoNivel, nivelDaFerramenta,
} from './config.js';
import {
  adicionarPeca, fichas, podeTrocarFichas, progressoDasColecoes, salvar, state,
  virarASemanaSeNecessario, virarODiaSeNecessario,
} from './db.js';

// --- Missões (diárias) ----------------------------------------------------
// Progredir é sempre por aqui, pelo evento (ver MISSOES em config.js): todas as
// missões do dia e da semana que escutam o evento andam juntas. A missão que
// fecha credita o XP na hora, uma vez só; os marcos esperam o toque na tela.
// Evento sem missão (seguir) não faz nada — a tela pode avisar sempre.
// `chave` conta cada coisa uma vez só (a curtida de um post): ver progredirSemana.
export function progredirMissao(evento, delta = 1, chave = null) {
  virarODiaSeNecessario();
  // a semana conta mesmo depois que a diária fechou
  if (progredirSemana(evento, delta, chave) === false) return;
  progredirIntro(evento);
  for (const missao of MISSOES.filter(m => m.evento === evento)) {
    const antes = state.missoes.progresso[missao.id] ?? 0;
    if (antes >= missao.meta) continue;
    state.missoes.progresso[missao.id] = Math.min(missao.meta, antes + delta);
    if (!missaoCompleta(missao.id) || state.missoes.pagas.includes(missao.id)) continue;
    state.missoes.pagas.push(missao.id);
    if (missao.xp) ganharXP(missao.xp, `missão: ${missao.nome.toLowerCase()}`);
  }
}

// --- Missões de introdução -----------------------------------------------
// state.intro só existe em conta nova (ou depois de recomeçar em Testes):
// { passo, feitos: [eventos já vistos], fim }. Save sem ele não mostra nada.
const ouvintesIntro = new Set();
export const onIntro = (fn) => { ouvintesIntro.add(fn); return () => ouvintesIntro.delete(fn); };
export const avisarIntro = () => ouvintesIntro.forEach(fn => fn(state.intro));

// O passo fora da lista (um passo que saiu do tutorial) também encerra.
export const introAtiva = () => Boolean(state.intro && !state.intro.fim && state.intro.passo < INTRO.length);

export function comecarIntro() {
  state.intro = { passo: 0, feitos: [], fim: null };
  salvar();
  avisarIntro();
}

function progredirIntro(evento) {
  const i = state.intro;
  if (!introAtiva() || i.feitos.includes(evento)) return;
  i.feitos.push(evento);
  avisarIntro();
}

// A missão da vez está feita (esperando o toque para pegar o prêmio)?
export const introPronta = () =>
  introAtiva() && state.intro.feitos.includes(INTRO[state.intro.passo]?.evento);

// Brinde do passo (INTRO `brinde`): um item de recarga de graça, uma vez por
// introdução, mesmo que o passo abra de novo.
export function darBrindeDaIntro(tipo) {
  const i = state.intro;
  if (!introAtiva() || (i.brindes ?? []).includes(tipo)) return false;
  if (tipo === 'congelamento') state.congelamentos = (state.congelamentos ?? 0) + 1;
  else if (tipo === 'repor') state.fichasDeRepor = (state.fichasDeRepor ?? 0) + 1;
  else return false;
  i.brindes = [...(i.brindes ?? []), tipo];
  salvar();
  return true;
}

// Avança depois que o prêmio foi entregue; a última fecha a introdução.
export function avancarIntro() {
  if (!introAtiva()) return;
  state.intro.passo += 1;
  if (state.intro.passo >= INTRO.length) state.intro.fim = new Date().toISOString();
  salvar();
  avisarIntro();
}

export function pularIntro() {
  if (!state.intro) return;
  state.intro.fim = new Date().toISOString();
  salvar();
  avisarIntro();
}

export const progressoMissao = (id) => state.missoes.progresso[id] ?? 0;

export const missaoCompleta = (id) =>
  progressoMissao(id) >= (MISSOES.find(m => m.id === id)?.meta ?? 1);

export const missoesFeitas = () => MISSOES.filter(m => missaoCompleta(m.id)).length;

// As fichas de uma missão feita só entram com um toque ("resgatar").
export const missaoResgatada = (id) => Boolean(state.missoes.resgatadas?.includes(id));
export const missoesResgatadas = () => MISSOES.filter(m => missaoResgatada(m.id)).length;
export const missoesParaResgatar = () => MISSOES.filter(m => missaoCompleta(m.id) && !missaoResgatada(m.id)).length;

export function resgatarMissao(id) {
  virarODiaSeNecessario();
  if (!missaoCompleta(id) || missaoResgatada(id)) return 0;
  (state.missoes.resgatadas ??= []).push(id);
  state.fichas = fichas() + MARCOS_DIA.fichasPorMissao;
  salvar();
  return MARCOS_DIA.fichasPorMissao;
}

const marcoDoDiaPego = (marco) => state.missoes.marcos?.includes(marco);
export const diaCarimbado = () => marcoDoDiaPego('carimbo');

// O carimbo do dia já dá para pegar (as 5 missões feitas)? Devolve 'carimbo' ou null.
export function marcoDoDiaPronto() {
  return !marcoDoDiaPego('carimbo') && missoesResgatadas() >= MARCOS_DIA.carimbo.missoes ? 'carimbo' : null;
}

// Carimba o dia: guarda o baú incomum. Devolve { marco, bau } ou null.
export function resgatarMarcoDoDia() {
  virarODiaSeNecessario();
  const marco = marcoDoDiaPronto();
  if (!marco) return null;
  state.missoes.marcos ??= [];
  state.missoes.marcos.push('carimbo');
  state.stats.diasCompletos = (state.stats.diasCompletos ?? 0) + 1;
  state.semana.carimbos ??= [];
  if (!state.semana.carimbos.includes(state.missoes.data)) state.semana.carimbos.push(state.missoes.data);
  const { bau, xp } = MARCOS_DIA.carimbo;
  guardarBau(bau, 'dia', 'Carimbo do dia');
  ganharXP(xp, 'dia carimbado');
  progredirMissao('carimbo');
  salvar();
  return { marco, bau };
}

export const carimbosDaSemana = () => state.semana.carimbos ?? [];

// --- Missões (semanais) ---------------------------------------------------
// Mesma regra das diárias: fechou, paga o XP na hora e uma vez só. `chave`
// serve à missão de curtir — o mesmo post não conta duas vezes na semana.
export function progredirSemana(evento, delta = 1, chave = null) {
  virarASemanaSeNecessario();
  const s = state.semana;
  const missoes = MISSOES_SEMANA.filter(m => m.evento === evento);
  if (!missoes.length) return;

  if (chave != null) {
    if (s.curtidos.includes(chave)) return false;   // já contou nesta semana
    s.curtidos.push(chave);
  }
  for (const missao of missoes) {
    const antes = s.progresso[missao.id] ?? 0;
    if (antes >= missao.meta) continue;
    s.progresso[missao.id] = Math.min(missao.meta, antes + delta);
    if (s.progresso[missao.id] < missao.meta || s.pagas.includes(missao.id)) continue;
    s.pagas.push(missao.id);
    ganharXP(missao.xp, `missão da semana: ${missao.nome.toLowerCase()}`);
  }
}

export const progressoSemanal = (id) => state.semana.progresso[id] ?? 0;

export const semanalCompleta = (id) =>
  progressoSemanal(id) >= (MISSOES_SEMANA.find(m => m.id === id)?.meta ?? 1);

export const semanalResgatada = (id) => Boolean(state.semana.resgatadas?.includes(id));
export const semanaisParaResgatar = () =>
  MISSOES_SEMANA.filter(m => semanalCompleta(m.id) && !semanalResgatada(m.id)).length;

export function resgatarSemanal(id) {
  virarASemanaSeNecessario();
  if (!semanalCompleta(id) || semanalResgatada(id)) return 0;
  (state.semana.resgatadas ??= []).push(id);
  state.fichas = fichas() + MARCOS_SEMANA.fichasPorMissao;
  salvar();
  return MARCOS_SEMANA.fichasPorMissao;
}

export const semanaCompleta = () => MISSOES_SEMANA.every(m => semanalResgatada(m.id));

export const semanaisFeitas = () => MISSOES_SEMANA.filter(m => semanalCompleta(m.id)).length;

// Carimbo da semana: as 5 missões feitas, um toque carimba, guarda o baú épico
// e conta para o baú mensal.
export const semanaCarimbada = () => Boolean(state.semana.marcos?.includes('carimbo'));
export const carimboDaSemanaPronto = () => semanaCompleta() && !semanaCarimbada();

export function carimbarSemana() {
  virarASemanaSeNecessario();
  if (!carimboDaSemanaPronto()) return null;
  state.semana.marcos ??= [];
  state.semana.marcos.push('carimbo');
  guardarBau(MARCOS_SEMANA.carimbo.bau, 'semana-carimbo', 'Carimbo da semana');
  state.stats.semanasCompletas = (state.stats.semanasCompletas ?? 0) + 1;
  state.semanasFechadas = semanasFechadas() + 1;
  salvar();
  return { bau: MARCOS_SEMANA.carimbo.bau };
}

// --- Baús -----------------------------------------------------------------
// Pegar um baú paga o XP do degrau do nível (lido antes de o próprio XP subir
// o nível) e guarda o baú fechado. Abrir chega com as peças já sorteadas pela
// tela, que conhece o catálogo: uma lista de { item, raridade }.
function guardarSorteadas(sorteadas, origem) {
  return sorteadas
    .map(({ item, raridade }) => item && adicionarPeca(item, { origem, raridade }))
    .filter(Boolean)
    .map(p => ({ id: p.id, raridade: p.raridade }));
}

// Baú dos dias: 5 dias carimbados na semana. Pegar paga o XP e manda o baú
// para a tela de Baús, onde ele é aberto.
export const bauDosDiasAberto = () => Boolean(state.semana.premio);
export const bauDosDiasPronto = () =>
  !bauDosDiasAberto() && carimbosDaSemana().length >= PREMIO_SEMANA.carimbos;

export function abrirPremioDaSemana() {
  virarASemanaSeNecessario();
  if (!bauDosDiasPronto()) return null;
  const { xp, bau } = premioDoBau(PREMIO_SEMANA, nivel()).atual;
  guardarBau(bau, 'semana', 'Baú dos dias');
  state.semana.premio = { pecas: [], xp, bau, em: new Date().toISOString() };
  ganharXP(xp, 'baú dos dias');
  salvar();
  return { xp, bau };
}

// As peças do baú dos dias desta semana (aceita o formato antigo, de uma peça).
export function pecasDoBauDosDias() {
  const p = state.semana.premio;
  if (!p) return [];
  return p.pecas ?? (p.id ? [{ id: p.id, raridade: p.raridade }] : []);
}

// --- Baú semanal ----------------------------------------------------------
export const semanasFechadas = () => state.semanasFechadas ?? 0;
export const bauEspecialPronto = () => semanasFechadas() >= BAU_ESPECIAL.semanas;

export function abrirBauEspecial() {
  if (!bauEspecialPronto()) return null;
  const { xp, bau } = premioDoBau(BAU_ESPECIAL, nivel()).atual;
  guardarBau(bau, 'bau-especial', 'Baú mensal');
  state.semanasFechadas = semanasFechadas() - BAU_ESPECIAL.semanas;
  ganharXP(xp, 'baú mensal');
  salvar();
  return { xp, bau };
}

// --- Baús guardados --------------------------------------------------------
// Todo baú ganho (dias, semanal, trilha de níveis, missões do tutorial) vem
// para cá fechado: { id, tipo (de BAUS), origem (a das peças), de, em }. As
// peças só são sorteadas na hora de abrir, pela tela, que conhece o catálogo.
export const bausGuardados = () => state.baus ?? [];
// Quem quiser mostrar o baú chegando (a animação dele voando até Tarefas)
// escuta aqui.
const ouvintesBau = new Set();
export const onBauGuardado = (fn) => { ouvintesBau.add(fn); return () => ouvintesBau.delete(fn); };

export function guardarBau(tipo, origem, de) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  state.baus = [...bausGuardados(), { id, tipo, origem, de, em: new Date().toISOString() }];
  salvar();
  ouvintesBau.forEach(fn => fn(tipo));
}

export function abrirBauGuardado(id, sorteadas = []) {
  const bau = bausGuardados().find(b => b.id === id);
  if (!bau) return null;
  state.baus = bausGuardados().filter(b => b !== bau);
  const pecas = guardarSorteadas(sorteadas, bau.origem);
  progredirMissao('abrir-bau');
  salvar();
  return { ...bau, pecas };
}

// --- Trilha de níveis ------------------------------------------------------
// Os níveis cujo prêmio já foi pego ficam em `progresso.premios`. Quem já
// estava num nível alto quando a trilha chegou pega todos os de baixo.
const premiosPegos = () => state.progresso.premios ?? [];
export const premioDoNivelPego = (n) => premiosPegos().includes(n);
export const premioDoNivelPronto = (n) => n >= 2 && n <= nivel() && !premioDoNivelPego(n);
export const premiosDoNivelProntos = () => PREMIOS_DE_NIVEL.filter(p => premioDoNivelPronto(p.nivel));

// Entrega o prêmio do nível n. Baú vai fechado para a tela de Baús.
export function pegarPremioDoNivel(n) {
  if (!premioDoNivelPronto(n)) return null;
  const premio = premioDoNivel(n);
  state.progresso.premios = [...premiosPegos(), n];
  if (premio.tipo === 'fichas') state.fichas = fichas() + premio.qtd;
  else if (premio.tipo === 'repor') state.fichasDeRepor = fichasDeRepor() + premio.qtd;
  else guardarBau(premio.bau, 'nivel', `Nível ${n}`);
  salvar();
  return premio;
}

// A primeira versão da trilha foi toda pega em teste, e o João pediu para
// zerar (2026-10-16): os níveis voltam a esperar o toque, e o que saiu deles
// (fichas, fichas de repor e as peças dos baús) volta. Roda uma vez por save,
// e devolve as peças tiradas para a loja recontar o estoque.
export function zerarTrilhaDeNiveis() {
  if (state.progresso.trilhaZerada) return [];
  state.progresso.trilhaZerada = true;
  const dadas = premiosPegos().map(premioDoNivel)
    .filter(p => p.tipo === 'fichas').reduce((t, p) => t + p.qtd, 0);
  state.fichas = Math.max(0, fichas() - dadas);
  state.fichasDeRepor = 0;
  state.progresso.premios = [];
  const tiradas = state.inventario.filter(p => p.origem === 'nivel');
  state.inventario = state.inventario.filter(p => p.origem !== 'nivel');
  salvar();
  return tiradas.map(p => ({ id: p.id, raridade: p.raridade }));
}

// Ficha de repor a loja: gastar uma troca a arara do dia por outra (a troca
// em si é da vitrine, que conhece o sorteio).
export const fichasDeRepor = () => state.fichasDeRepor ?? 0;
export function gastarFichaDeRepor() {
  if (!fichasDeRepor()) return false;
  state.fichasDeRepor = fichasDeRepor() - 1;
  salvar();
  return true;
}

// --- Pontinhos vermelhos ----------------------------------------------------
// Eles só mostram o caminho até uma coisa nova. Cada coisa nova tem uma chave;
// quando a pessoa chega nela (abre a aba, a trilha, a tela de Baús, a coleção),
// a chave entra em `state.vistos` e o caminho apaga, mesmo que a coisa continue
// lá esperando (um baú fechado, um prêmio não pego).
const vistos = () => state.vistos ?? [];
export const naoVistas = (chaves) => chaves.filter(c => !vistos().includes(c));
export function marcarVistas(chaves) {
  const novas = naoVistas(chaves);
  if (!novas.length) return;
  state.vistos = [...vistos(), ...novas].slice(-400);
  salvar();
}

export const novidadesDoTopo = () => (podeTrocarFichas() ? [`troca:${hojeISO()}`] : []);
// Missão feita e ainda não resgatada também é caminho: cada uma acende o
// pontinho uma vez, na hora em que fecha.
export const novidadesDoDia = () => [
  ...MISSOES.filter(m => missaoCompleta(m.id) && !missaoResgatada(m.id)).map(m => `missao:${hojeISO()}:${m.id}`),
  marcoDoDiaPronto() && `dia:${hojeISO()}:${marcoDoDiaPronto()}`,
  bauDosDiasPronto() && `bau-dias:${state.semana.data}`,
].filter(Boolean);
export const novidadesDaSemana = () => [
  ...MISSOES_SEMANA.filter(m => semanalCompleta(m.id) && !semanalResgatada(m.id)).map(m => `semanal:${state.semana.data}:${m.id}`),
  carimboDaSemanaPronto() && `carimbo-semana:${state.semana.data}`,
  bauEspecialPronto() && `bau-semanal:${state.stats.semanasCompletas ?? 0}`,
].filter(Boolean);
export const novidadesDosNiveis = () => premiosDoNivelProntos().map(p => `nivel:${p.nivel}`);
export const novidadesDosBaus = () => bausGuardados().map(b => `bau:${b.id}`);
// Coleção: a chave muda a cada item novo ganho para escolher.
export function novidadeDaColecao(id, c = progressoDasColecoes()[id]) {
  return c?.livres > 0 ? `col:${id}:${c.ganhas}` : null;
}
export const novidadesDasColecoes = () =>
  Object.entries(progressoDasColecoes()).map(([id, c]) => novidadeDaColecao(id, c)).filter(Boolean);

// Ainda há caminho a mostrar? Acende o pontinho do botão de Tarefas.
export const temNovidade = () => naoVistas([
  ...novidadesDoTopo(), ...novidadesDoDia(), ...novidadesDaSemana(),
  ...novidadesDosNiveis(), ...novidadesDosBaus(), ...novidadesDasColecoes(),
]).length > 0;

// Tem prêmio esperando o toque? Acende o pontinho do botão de Tarefas.
export const temPremioParaResgatar = () =>
  missoesParaResgatar() > 0 || semanaisParaResgatar() > 0 || Boolean(marcoDoDiaPronto()) || carimboDaSemanaPronto() ||
  bauDosDiasPronto() || bauEspecialPronto() || podeTrocarFichas() ||
  premiosDoNivelProntos().length > 0 || bausGuardados().length > 0;

// --- Nível e XP -----------------------------------------------------------
// Quem quiser reagir ao XP (badge da sidebar, toast de nível novo) escuta aqui:
// db não conhece a interface, só avisa o que aconteceu.
const ouvintesXP = new Set();
export const onXP = (fn) => { ouvintesXP.add(fn); return () => ouvintesXP.delete(fn); };

export const xpTotal = () => state.progresso.xp;
export const nivel = () => nivelPorXP(state.progresso.xp);
export const progresso = () => progressoDoNivel(state.progresso.xp);

export function ganharXP(quantidade, motivo = '') {
  const qtd = Math.max(0, Math.round(quantidade));
  if (!qtd) return null;

  const antes = nivel();
  state.progresso.xp += qtd;
  const depois = nivel();
  state.progresso.nivelVisto = depois;

  const evento = { xp: qtd, motivo, nivel: depois, subiu: depois > antes, de: antes };
  ouvintesXP.forEach(fn => fn(evento));
  return evento;
}

// --- Ferramentas ----------------------------------------------------------
// O gate por nível mora aqui para a sidebar, o roteador e a aba Tarefas darem
// sempre a mesma resposta.
export const ferramentaLiberada = (id) => nivel() >= nivelDaFerramenta(id);
