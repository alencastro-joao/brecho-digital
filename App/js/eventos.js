// Eventos: os post-its de uma data comemorativa (EVENTOS em config.js) no
// mural de Tarefas. Quem desenha e guarda o mural é mural.js / tarefas.js;
// aqui ficam as regras do evento: quando ele está aberto, o post-it que ele
// manda, o que conta para esse post-it e o prêmio dele.
//
// Um post-it de evento é uma missão do mural com `evento` (o id do evento):
//   { uid, evento, id (de ev.missoes), meta, feito, alvo: {}, chegou, vence }
// state.eventosFeitos[id do evento]: quantos post-its dele a conta cumpriu.
// state.eventosGarantidos: eventos em que a conta já ganhou o post-it garantido.
// As roupinhas do evento vêm da coleção do tema (ESTILOS), não daqui.

import { EVENTOS, BAUS, idDoEstilo } from './config.js';
import * as db from './db.js';
import { hojeISO } from './util.js';

// O evento abre só pelas datas (João, 01/11/2026: "abrir já, sem nenhuma
// espera"). Antes ele esperava um baú cheio de peças do tema e os desenhos das
// roupinhas; agora o presente e os post-its saem na hora, e o baú completa
// com peças da loja enquanto houver poucas do tema (tarefas.sortearPecas).
export const temPecasDoEvento = () => true;
const eventoPronto = () => true;

// O evento aberto hoje e pronto (o primeiro, se houver dois).
export const eventoAberto = (hoje = hojeISO()) =>
  EVENTOS.find(e => e.missoes?.length && hoje >= e.desde && hoje <= e.ate && eventoPronto(e)) ?? null;

const eventoDe = (m) => EVENTOS.find(e => e.id === m.evento) ?? null;
export const modeloDoEvento = (m) => eventoDe(m)?.missoes.find(x => x.id === m.id) ?? null;

// Quem já completou a coleção do tema do evento não recebe mais post-its dele
// (João, 12/11/2026). Evento sem tema (ou sem coleção com peças) nunca para.
export function colecaoDoEventoCompleta(ev) {
  const tema = BAUS[ev?.bau]?.tema;
  const c = tema ? db.progressoDasColecoes()[idDoEstilo(tema)] : null;
  return !!c && c.total > 0 && c.tem >= c.total;
}

// Na chegada de um post-it: 1 chance em `postitCada` de ser do evento aberto,
// com uma missão que ainda não está no mural. null = post-it normal.
export function postitDoEvento(emUso = new Set(), forcar = false) {
  const ev = eventoAberto();
  if (!ev || colecaoDoEventoCompleta(ev) || (!forcar && Math.random() * (ev.postitCada || 3) >= 1)) return null;
  const livres = ev.missoes.filter(md => !emUso.has(`${ev.id}:${md.id}`));
  if (!livres.length) return null;
  const md = livres[Math.floor(Math.random() * livres.length)];
  return { evento: ev.id, id: md.id, meta: md.meta, feito: 0, alvo: {} };
}

// Todo mundo ganha um post-it do evento assim que ele abre (João,
// 01/11/2026: "pra entenderem como funciona pra ganhar os baús"), uma vez por
// conta e evento; depois volta a regra de 1 a cada `postitCada`. `temDoEvento`:
// o mural já tem um post-it desse evento (conta como o garantido).
export function postitGarantido(emUso = new Set(), temDoEvento = false) {
  const ev = eventoAberto();
  const dados = db.state;
  if (!ev || (dados.eventosGarantidos ?? []).includes(ev.id)) return null;
  const marcar = () => { dados.eventosGarantidos = [...(dados.eventosGarantidos ?? []), ev.id]; };
  if (temDoEvento || (dados.eventosFeitos?.[ev.id] ?? 0) > 0) { marcar(); return null; }
  const p = postitDoEvento(emUso, true);
  if (p) marcar();
  return p;
}

const corDe = (p) => (p?.cor || '').toLowerCase();
const temCor = (p, cores) => !cores || cores.some(c => c.toLowerCase() === corDe(p));

// Mesmos eventos de mural.contar: 'garimpar' com { peca, raridade }; 'look'
// ou 'colagem' com { pecas }; 'curtir'.
export function contarNoPostit(m, evento, { peca = null, raridade = null, pecas = [] } = {}) {
  const md = modeloDoEvento(m);
  if (!md || md.evento !== evento) return;
  if (evento === 'curtir') m.feito += 1;
  else if (evento === 'garimpar') {
    if (temCor(peca, md.cores) && (!md.raridades || md.raridades.includes(raridade))) m.feito += 1;
  } else {
    const ok = md.todas ? pecas.length > 0 && pecas.every(p => temCor(p, md.cores)) : pecas.some(p => temCor(p, md.cores));
    if (ok) m.feito = m.meta;
  }
}

// O prêmio do post-it cumprido: o baú do evento. Devolve { bau } com o nome.
export function premiarPostit(m) {
  const ev = eventoDe(m);
  if (!ev) return { bau: null };
  db.state.eventosFeitos = { ...(db.state.eventosFeitos ?? {}), [ev.id]: (db.state.eventosFeitos?.[ev.id] ?? 0) + 1 };
  db.guardarBau(ev.bau, 'evento', ev.nome, ev.id);   // grava e voa até Tarefas
  return { bau: BAUS[ev.bau].nome };
}

export const textoDoPostit = (m) => modeloDoEvento(m)?.nome ?? '';
export const nomeDoEvento = (m) => eventoDe(m)?.nome ?? '';
export const bauDoEvento = (m) => eventoDe(m)?.bau ?? null;

// De que evento a peça veio (João, 11/11/2026: marcar as roupas de evento no
// guarda-roupa). O baú do evento grava `evento` na peça; as de antes disso só
// têm origem 'evento', e saem pela data: o último evento aberto até aquele dia
// (o baú pode ter sido aberto depois de o evento fechar).
export function eventoDaPeca(p) {
  if (!p) return null;
  if (p.evento) return EVENTOS.find(e => e.id === p.evento) ?? null;
  if (p.origem !== 'evento' || !p.obtidoEm) return null;
  const dia = hojeISO(new Date(p.obtidoEm));
  return EVENTOS.filter(e => e.desde <= dia).sort((a, b) => a.desde.localeCompare(b.desde)).at(-1) ?? null;
}
// "Halloween 2026": o nome com o ano, para a ficha da peça.
export const nomeComAno = (ev) => `${ev.nome} ${ev.desde.slice(0, 4)}`;
