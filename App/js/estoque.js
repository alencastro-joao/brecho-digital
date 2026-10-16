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
let numeros = {};              // o número da cópia de cada peça levada agora

// Que cópia da tiragem a pessoa levou (a 12ª de 1000...). Só existe logo
// depois do levar() que a reservou; quem chama grava na peça.
export const numeroLevado = (id, raridade) => numeros[chave(id, raridade)] ?? null;

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
 * Reserva uma cópia de cada peça ({ id, raridade, origem }). Devolve o conjunto
 * das que conseguiu; as esgotadas ficam de fora. Offline, todas passam.
 * A origem (vitrine, presente, semana...) vai para o histórico da cópia.
 */
export async function levar(pecas) {
  const todas = new Set(pecas.map(p => chave(p.id, p.raridade)));
  if (!pecas.length) return todas;
  try {
    const feito = await chamar('/api/estoque/levar',
      { pecas: pecas.map(({ id, raridade, origem }) => ({ id, raridade, origem })) });
    mapa = feito.mapa || mapa;
    numeros = { ...numeros, ...(feito.numeros || {}) };
    online = true;
    return new Set(feito.levadas || []);
  } catch {
    return todas;
  }
}

// Grava o número da cópia nas peças do inventário que acabaram de ser levadas.
export function numerar(pecas) {
  for (const p of pecas) {
    const n = numeroLevado(p.id, p.raridade);
    if (n) p.numero = n;
  }
}

export const conseguiu = (resultado, id, raridade) => resultado.has(chave(id, raridade));

// Peças pegas antes de o servidor numerar as cópias ficaram sem o "nº 127 de
// 1000". Aqui cada uma reserva a próxima cópia da tiragem dela (é dela, então
// ocupar a cópia é o certo) e grava o número. Esgotada, não há número a dar:
// fica marcada para não tentar de novo. Sem servidor, nada muda e tenta na
// próxima abertura. Devolve quantas mudaram.
export async function numerarAntigas(inventario) {
  const faltam = inventario.filter(p => !p.numero && !p.semNumero && RARIDADE[p.raridade]);
  let mudou = 0;
  for (let i = 0; i < faltam.length; i += 50) {
    const lote = faltam.slice(i, i + 50);
    let feito;
    try {
      feito = await chamar('/api/estoque/levar',
        { pecas: lote.map(p => ({ id: p.id, raridade: p.raridade, origem: p.origem })) });
    } catch { return mudou; }
    mapa = feito.mapa || mapa;
    const levou = new Set(feito.levadas || []);
    for (const p of lote) {
      const k = chave(p.id, p.raridade);
      const n = feito.numeros?.[k];
      if (n) { p.numero = n; mudou++; }
      else if (!levou.has(k)) { p.semNumero = true; mudou++; }
    }
  }
  return mudou;
}

// Ferramenta do admin: as cópias voltam para a loja. Falhar aqui não desfaz o
// que o guarda-roupa já devolveu — o contador só fica mais apertado.
export async function devolver(pecas) {
  if (!pecas.length) return;
  try {
    mapa = (await chamar('/api/estoque/devolver', { pecas })).mapa || mapa;
  } catch { /* sem servidor, nada a acertar */ }
}

// Por quem a cópia já passou: [{ handle, como, em, voce }], do primeiro dono ao
// atual. Só cópia numerada tem histórico no servidor; sem número ou sem
// servidor, devolve null e a ficha mostra só o que o save sabe.
//
// A peça vai com a origem e a data dela: cópia numerada antes de o histórico
// existir ainda não tem registro, e o servidor anota você como primeiro dono.
const historicos = new Map();

export async function historico(peca) {
  if (!peca?.numero || !RARIDADE[peca.raridade]) return null;
  const k = `${chave(peca.id, peca.raridade)}|${peca.numero}`;
  if (historicos.has(k)) return historicos.get(k);
  try {
    const feito = await chamar('/api/estoque/historico', { copias: [{
      id: peca.id, raridade: peca.raridade, numero: peca.numero,
      origem: peca.origem || 'vitrine', desde: peca.obtidoEm,
    }] });
    const donos = feito.historico?.[k];
    if (!donos?.length) return null;
    historicos.set(k, donos);
    return donos;
  } catch {
    return null;
  }
}

// Desfazer o resgate: a cópia volta para a loja e você sai do histórico dela.
// Devolve false só quando o servidor recusa (passou do tempo, outra pessoa já
// é dona); sem número ou sem servidor, não há o que acertar e vale desfazer.
export async function desfazer(peca) {
  if (!peca?.numero || !RARIDADE[peca.raridade]) return true;
  let r;
  try {
    r = await fetch('/api/estoque/desfazer', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peca: { id: peca.id, raridade: peca.raridade, numero: peca.numero } }),
    });
  } catch {
    return true;
  }
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) return false;
  mapa = dados.mapa || mapa;
  historicos.delete(`${chave(peca.id, peca.raridade)}|${peca.numero}`);
  return true;
}
