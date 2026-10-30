// O dia, as fichas, o inventário e o que o jogador marca nas peças (marcas,
// cores, favoritos, wishlist, conexões). É um pedaço de db.js: o estado é o
// `state` de lá, e as telas continuam importando tudo por `./db.js`.

import { hojeISO, semanaISO, mulberry32, sementeDoDia } from './util.js';
import { CONFIG, RARIDADES, FICHAS } from './config.js';
import { bonusDeEfeito, marcasAtivas, coresAtivas } from './efeitos.js';
import {
  avisarIntro, marcasFixas, missoesDaSemana, missoesDoDia, progredirMissao, roupasEquipadas,
  salvar, state,
} from './db.js';

// --- Dia ------------------------------------------------------------------
export function virarODiaSeNecessario() {
  const hoje = hojeISO();
  if (state.dia.data !== hoje) {
    state.dia = { data: hoje, resgates: 0, extras: 0, guardados: extrasQueSobraram(), posicoes: {} };
    state.missoes = missoesDoDia(hoje);   // vitrine nova, missões novas
    salvar();
    return true;
  }
  // Save aberto de ontem: o dia não mudou, mas as missões podem ser de outra data.
  if (state.missoes.data !== hoje) {
    state.missoes = missoesDoDia(hoje);
    salvar();
  }
  virarASemanaSeNecessario();
  return false;
}

// A semana vira sozinha, e o prêmio que ficou sem abrir vai junto: é o que
// faz a segunda-feira pesar.
export function virarASemanaSeNecessario() {
  const semana = semanaISO();
  if (state.semana?.data === semana) return false;
  state.semana = missoesDaSemana(semana);
  salvar();
  return true;
}

// Resgate comprado com fichas não vence: o que não foi usado passa para o dia
// seguinte. Os resgates normais do dia são gastos primeiro.
const extrasDoDia = () => (state.dia.extras ?? 0) + (state.dia.guardados ?? 0);

function extrasQueSobraram() {
  const usados = Math.max(0, state.dia.resgates - CONFIG.RESGATES_POR_DIA);
  return Math.max(0, extrasDoDia() - usados);
}

export const resgatesRestantes = (limite) =>
  Math.max(0, limite + extrasDoDia() - state.dia.resgates);

// Quantos dos resgates que sobraram vieram das fichas (os do dia saem antes).
export const resgatesDeFichas = () => extrasQueSobraram();

// --- Fichas ---------------------------------------------------------------
export const fichas = () => state.fichas ?? 0;

export const podeTrocarFichas = () => fichas() >= FICHAS.porResgate;

// Troca fichas por um resgate a mais, que fica guardado até ser usado. Devolve se deu certo.
export function trocarFichasPorResgate() {
  virarODiaSeNecessario();
  if (!podeTrocarFichas()) return false;
  state.fichas = fichas() - FICHAS.porResgate;
  state.dia.extras = (state.dia.extras ?? 0) + 1;
  salvar();
  return true;
}

// Repor a loja com fichas: vira uma ficha de repor guardada (a mesma das
// missões e da trilha), e a pessoa usa quando quiser no ↻ da vitrine.
export const podeReporComFichas = () => fichas() >= FICHAS.porRepor;
export function comprarRepor() {
  virarODiaSeNecessario();
  if (!podeReporComFichas()) return false;
  state.fichas = fichas() - FICHAS.porRepor;
  state.fichasDeRepor = (state.fichasDeRepor ?? 0) + 1;
  salvar();
  return true;
}

// Peça congelada: fica na arara hoje e amanhã, mesmo que a loja seja reposta.
// Fora de `state.dia` de propósito, senão sumia na virada. `ate` é o último
// dia em que ela ainda aparece; depois disso a lista se limpa sozinha.
function amanhaISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return hojeISO(d);
}
export const congeladas = (iso = hojeISO()) =>
  (state.congeladas ?? []).filter(c => c.ate >= iso).map(c => c.id);
export const estaCongelada = (id) => congeladas().includes(id);
// Congelamentos guardados: comprados em Tarefas por FICHAS.porCongelar, e cada
// um segura uma peça na loja (ver congelarPeca).
export const congelamentos = () => state.congelamentos ?? 0;
export const podeComprarCongelamento = () => fichas() >= FICHAS.porCongelar;
export function comprarCongelamento() {
  virarODiaSeNecessario();
  if (!podeComprarCongelamento()) return false;
  state.fichas = fichas() - FICHAS.porCongelar;
  state.congelamentos = congelamentos() + 1;
  salvar();
  return true;
}
export const podeCongelar = () => congelamentos() >= 1;
export function congelarPeca(id) {
  virarODiaSeNecessario();
  if (!podeCongelar() || estaCongelada(id)) return false;
  const hoje = hojeISO();
  state.congelamentos = congelamentos() - 1;
  state.congeladas = [...(state.congeladas ?? []).filter(c => c.ate >= hoje && c.id !== id),
    { id, ate: amanhaISO() }];
  salvar();
  return true;
}

// Onde a peça ficou depois de arrastada. Vale enquanto a página está aberta:
// trocar de tela e voltar mantém a arara como você deixou.
export function guardarPosicao(id, x, y) {
  state.dia.posicoes ??= {};
  state.dia.posicoes[id] = { x: Math.round(x), y: Math.round(y) };
  salvar();
}
export const posicaoGuardada = (id) => state.dia.posicoes?.[id] ?? null;

// A vitrine chama uma vez por carregamento: a posição arrastada é em pixels da
// tela daquela sessão, e em outra tela (o celular) ela cairia fora do lugar.
export function limparPosicoes() {
  if (!state.dia.posicoes || !Object.keys(state.dia.posicoes).length) return;
  state.dia.posicoes = {};
  salvar();
}

// --- Inventário -----------------------------------------------------------
export const temPeca = (id) => state.inventario.some(p => p.id === id);
export const pecaDoInventario = (id) => state.inventario.find(p => p.id === id);

// Peça que o admin apagou do acervo sai do guarda-roupa de quem a tinha. A
// lista vem explícita no acervo.json — e não "o que não está no catálogo" —
// porque catálogo que falhou ao carregar esvaziaria o guarda-roupa de todo mundo.
export function esquecerPecas(ids) {
  const fora = new Set(ids || []);
  if (!fora.size) return 0;
  const antes = state.inventario.length;
  state.inventario = state.inventario.filter(p => !fora.has(p.id));
  const tiradas = antes - state.inventario.length;
  if (tiradas) salvar();
  return tiradas;
}

// Raridade é sorteada uma única vez, no resgate, e gravada com a peça.
// `ajuste` multiplica o peso de cada raridade (ver modificadoresDaLoja).
export function sortearRaridade(rnd = Math.random, ajuste = {}) {
  const pesoDe = (r) => r.peso * (ajuste[r.id] ?? 1);
  const total = RARIDADES.reduce((acc, r) => acc + pesoDe(r), 0);
  let n = rnd() * total;
  for (const r of RARIDADES) {
    if (n < pesoDe(r)) return r.id;
    n -= pesoDe(r);
  }
  return 'common';
}

// Texto vira número estável (o mesmo id dá sempre a mesma semente).
const numeroDe = (id) => {
  const n = Number(id);
  return Number.isFinite(n) ? n : String(id).split('')
    .reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
};

// A loja é de cada pessoa: a semente do dia mistura a data com o id da conta.
// Cada um encontra uma arara diferente, e a sua continua a mesma do primeiro
// ao último acesso do dia. Sem conta (antes do login) fica só a data.
export function sementeDaLoja(iso = hojeISO()) {
  const id = state.usuario.id;
  return id ? (sementeDoDia(iso) ^ Math.imul(numeroDe(id), 0x9E3779B1)) >>> 0 : sementeDoDia(iso);
}

// O que muda a sorte desta pessoa na loja.
//   peso[raridade]:   multiplica o peso dela no sorteio da raridade do dia
//   naLoja[raridade]: troca a tabela de quantas vêm na arara (ver config.js)
//   marcas:           [{ marcas, pct }] — efeito "mais peças da marca na arara"
//   cores:            [{ cor, pct }] — efeito "mais peças da cor na arara"
//   maisRaras:        pct do efeito "mais chance de peças raras na arara"
//
// Os efeitos de marca e de cor valem pelo que estava vestido na primeira olhada do
// dia e ficam gravados em `state.dia.loja`: trocar de roupa não embaralha a
// arara de hoje, vale para a de amanhã. Antes do acervo carregar ninguém tem
// coleção liberada, então a foto só é tirada depois dele.
export function modificadoresDaLoja() {
  const d = state.dia;
  if (!d.loja && state.usuario.id && marcasFixas.size) {
    const eq = roupasEquipadas();
    d.loja = {
      marcas: marcasAtivas(eq)
        .filter(m => m.colecao.efeito.tipo === 'mais-da-marca')
        .map(m => ({ marcas: m.colecao.efeito.marcas || [m.colecao.marca], pct: m.pct })),
      cores: coresAtivas(eq),
      maisRaras: bonusDeEfeito(eq, 'mais-raras'),
    };
  }
  return { peso: {}, naLoja: {}, marcas: [], cores: [], maisRaras: 0, ...(d.loja || {}) };
}

// Os efeitos de marca que agem na hora do garimpo, em pontos percentuais.
export function efeitosDoGarimpo() {
  const eq = roupasEquipadas();
  return {
    gratis: bonusDeEfeito(eq, 'resgate-gratis'),
    acima: bonusDeEfeito(eq, 'raridade-acima'),
    fichas: bonusDeEfeito(eq, 'fichas'),
  };
}

export function ganharFicha(n = 1) {
  state.fichas = fichas() + n;
}

// Raridade do dia de uma peça: mesma semente da vitrine (a da sua loja), então
// o que brilha no mural é exatamente o que entra no guarda-roupa.
export function raridadeDoDia(id, iso = hojeISO()) {
  // Peça do acervo do administrador já nasce com a raridade da ficha; o
  // catálogo preenche esse mapa ao carregar (evita db importar catalog.js).
  if (raridadesFixas.has(id)) return raridadesFixas.get(id);

  return sortearRaridade(mulberry32(sementeDaLoja(iso) + numeroDe(id) * 7919),
    modificadoresDaLoja().peso);
}

// Raridades gravadas na própria peça (acervo permanente), por id.
export const raridadesFixas = new Map();

export function adicionarPeca(item, { origem = 'vitrine', raridade = null } = {}) {
  if (temPeca(item.id)) return null;
  const peca = {
    id: item.id,
    cat: item.cat,
    raridade: raridade || raridadeDoDia(item.id),
    obtidoEm: new Date().toISOString(),
    origem,
    ordem: state.inventario.length,
  };
  state.inventario.push(peca);
  return peca;
}

// Desfazer o resgate (a loja dá 10 segundos): a foto é tirada antes de pegar,
// com tudo que pegar mexe — o resgate do dia, as fichas, as estatísticas, as
// missões (do dia, da semana e da introdução), o XP que elas pagaram e o aviso
// de missão que caiu no sino. Voltar a foto e tirar a peça deixa o save como se
// o toque não tivesse acontecido; sem isso, pegar e desfazer em sequência
// fechava a missão de resgates.
const FOTO_DO_RESGATE = ['fichas', 'stats', 'missoes', 'semana', 'progresso', 'intro', 'avisos', 'baus', 'mural'];

export function fotografarResgate() {
  const foto = { resgates: state.dia.resgates };
  for (const k of FOTO_DO_RESGATE) foto[k] = structuredClone(state[k]);
  return foto;
}

export function desfazerResgate(id, foto) {
  const peca = pecaDoInventario(id);
  if (!peca) return null;
  state.inventario = state.inventario.filter(p => p !== peca);
  state.dia.resgates = foto.resgates;
  for (const k of FOTO_DO_RESGATE) state[k] = foto[k];
  salvar();
  avisarIntro();
  return peca;
}

export function reordenarInventario(idA, idB) {
  const a = pecaDoInventario(idA), b = pecaDoInventario(idB);
  if (!a || !b) return;
  [a.ordem, b.ordem] = [b.ordem, a.ordem];
  salvar();
}

// Devolver à loja: o contrário do resgate. A peça sai do guarda-roupa e volta a
// ser estoque da vitrine — e só isso. Nada é apagado do jogo: a roupa continua
// no acervo com a mesma ficha, os looks e as colagens já montados continuam de
// pé (eles guardam o id da peça, que não deixou de existir) e o nível, o XP e as
// estatísticas ficam como estavam. O que se desfaz é a posse.
//
// Os resgates do dia voltam junto: se a peça não foi levada, o resgate também
// não foi gasto.
export function devolverTudoParaALoja() {
  const devolvidas = state.inventario.length;
  state.inventario = [];
  state.dia.resgates = 0;
  salvar();
  return devolvidas;
}

// --- Marcas ---------------------------------------------------------------
// Toda marca digitada ao subir uma peça fica registrada. Hoje serve para
// completar o campo na próxima vez; o registro já é uma lista de objetos para
// receber depois o que mais a marca precisar carregar (logo, descrição, país).
export function registrarMarca(nome) {
  const limpo = (nome || '').trim();
  if (!limpo) return null;

  const igual = state.marcas.find(m => m.nome.toLowerCase() === limpo.toLowerCase());
  if (igual) {
    igual.usos += 1;
    return igual;
  }
  const nova = { nome: limpo, usos: 1, em: new Date().toISOString() };
  state.marcas.push(nova);
  return nova;
}

// Mais usadas primeiro; em empate, a mais recente.
export const marcasOrdenadas = () =>
  [...state.marcas].sort((a, b) => b.usos - a.usos || new Date(b.em) - new Date(a.em));

export function esquecerMarca(nome) {
  state.marcas = state.marcas.filter(m => m.nome !== nome);
  salvar();
}

// --- Cores ----------------------------------------------------------------
// Mesmo registro das marcas: a cor é campo livre, e o que já foi digitado vira
// atalho na próxima peça. A paleta de CONFIG entra junto, como sugestão.
export function registrarCor(nome) {
  const limpo = (nome || '').trim();
  if (!limpo) return null;

  const igual = state.cores.find(c => c.nome.toLowerCase() === limpo.toLowerCase());
  if (igual) {
    igual.usos += 1;
    return igual;
  }
  const nova = { nome: limpo, usos: 1, em: new Date().toISOString() };
  state.cores.push(nova);
  return nova;
}

export const coresOrdenadas = () =>
  [...state.cores].sort((a, b) => b.usos - a.usos || new Date(b.em) - new Date(a.em));

export function esquecerCor(nome) {
  state.cores = state.cores.filter(c => c.nome !== nome);
  salvar();
}

// --- Favoritos ------------------------------------------------------------
// O que você escolheu mostrar no perfil: peça do guarda-roupa, look do Stylist
// e colagem. A marca mora na própria coisa (campo `favorito`), não numa lista
// à parte — assim apagar um look leva o favorito junto, e save antigo entra
// sem migração: o que não tem o campo simplesmente não é favorito.
const COLECAO = { peca: 'inventario', look: 'looks', colagem: 'boards' };

const colecao = (tipo) => state[COLECAO[tipo]] ?? [];

export const ehFavorito = (tipo, id) =>
  Boolean(colecao(tipo).find(x => x.id === id)?.favorito);

// Devolve como ficou, para quem chamou já saber o que dizer no toast.
export function alternarFavorito(tipo, id) {
  const alvo = colecao(tipo).find(x => x.id === id);
  if (!alvo) return false;
  alvo.favorito = !alvo.favorito;
  if (alvo.favorito) progredirMissao('favoritar');
  salvar();
  return alvo.favorito;
}

export const favoritos = (tipo) => colecao(tipo).filter(x => x.favorito);

// --- Wishlist -------------------------------------------------------------
// Peças que você viu e quer. Quem chama é só quem mostra uma peça de verdade
// (a ficha da loja, o perfil de alguém): é o que obriga a garimpar para
// encher a lista. A mais nova vem primeiro.
export const naWishlist = (id) => (state.wishlist ?? []).includes(id);

export function alternarWishlist(id) {
  const lista = state.wishlist ?? [];
  const entra = !lista.includes(id);
  state.wishlist = entra ? [id, ...lista] : lista.filter(x => x !== id);
  salvar();
  return entra;
}

// --- Ordem do perfil -------------------------------------------------------
export const ordemDoPerfil = (aba) => state.ordemDoPerfil?.[aba] ?? [];

export function guardarOrdemDoPerfil(aba, ids) {
  state.ordemDoPerfil = { ...(state.ordemDoPerfil ?? {}), [aba]: ids };
  salvar();
}

// --- Conexões -------------------------------------------------------------
// A ligação de verdade (OAuth) e o token moram no servidor (lambda/redes.py);
// aqui fica só o espelho do @ que ele confirmou, para o perfil desenhar.
export function conectar(servico, usuario) {
  state.conexoes[servico] = {
    ligado: true,
    usuario: (usuario || '').replace(/^@/, '').trim(),
    em: new Date().toISOString(),
  };
  salvar();
}
export function desconectar(servico) {
  state.conexoes[servico] = { ligado: false, usuario: '', em: null };
  salvar();
}
export const estaLigado = (servico) => Boolean(state.conexoes?.[servico]?.ligado);
