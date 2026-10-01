// Tiragem limitada: quantas cópias de cada peça ainda existem no jogo.
//
// A raridade decide a tiragem (RARIDADE[r].tiragem): 1000 comuns, 25 lendárias.
// O contador é de todas as contas somadas, então quem manda é o servidor
// (/api/estoque). Aqui fica só o retrato mais recente dele, para a vitrine
// esconder o que esgotou e a ficha dizer quantas restam.
//
// A chave leva a raridade: peça sem ficha fixa muda de raridade com o sorteio
// do dia, e cada raridade é uma tiragem à parte.
//
// Sem servidor (file://, offline) o jogo não trava: o mapa fica vazio e pegar
// continua valendo — o limite só existe onde existe quem conte.

import { RARIDADE } from './config.js';

let mapa = {};
let online = false;

const chave = (id, raridade) => `${id}|${raridade}`;
const tiragem = (raridade) => RARIDADE[raridade]?.tiragem ?? Infinity;

export const levadas = (id, raridade) => mapa[chave(id, raridade)] ?? 0;
export const restantes = (id, raridade) =>
  Math.max(0, tiragem(raridade) - levadas(id, raridade));
export const esgotada = (id, raridade) => restantes(id, raridade) <= 0;
export const temContador = () => online;

async function chamar(rota, corpo) {
  const r = await fetch(rota, {
    method: corpo ? 'POST' : 'GET',
    credentials: 'include',
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 409) throw new Error(dados.erro || 'HTTP ' + r.status);
  return dados;
}

export async function carregarEstoque() {
  try {
    mapa = (await chamar('/api/estoque')).mapa || {};
    online = true;
  } catch {
    online = false;
  }
}

/**
 * Reserva uma cópia de cada peça ({ id, raridade }). Devolve o conjunto das
 * que conseguiu; as esgotadas ficam de fora. Offline, todas passam.
 */
export async function levar(pecas) {
  const todas = new Set(pecas.map(p => chave(p.id, p.raridade)));
  if (!pecas.length) return todas;
  try {
    const feito = await chamar('/api/estoque/levar', { pecas });
    mapa = feito.mapa || mapa;
    online = true;
    return new Set(feito.levadas || []);
  } catch {
    return todas;
  }
}

export const conseguiu = (resultado, id, raridade) => resultado.has(chave(id, raridade));

// Ferramenta do admin: as cópias voltam para a loja. Falhar aqui não desfaz o
// que o guarda-roupa já devolveu — o contador só fica mais apertado.
export async function devolver(pecas) {
  if (!pecas.length) return;
  try {
    mapa = (await chamar('/api/estoque/devolver', { pecas })).mapa || mapa;
  } catch { /* sem servidor, nada a acertar */ }
}
