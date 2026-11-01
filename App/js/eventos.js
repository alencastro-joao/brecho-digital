// Eventos: os post-its de uma data comemorativa (EVENTOS em config.js) no
// mural de Tarefas. Quem desenha e guarda o mural é mural.js / tarefas.js;
// aqui ficam as regras do evento: quando ele está aberto, o post-it que ele
// manda, o que conta para esse post-it e o prêmio dele.
//
// Um post-it de evento é uma missão do mural com `evento` (o id do evento):
//   { uid, evento, id (de ev.missoes), meta, feito, alvo: {}, chegou, vence }
// state.eventosFeitos[id do evento]: quantos post-its dele a conta cumpriu.
// As roupinhas do evento vêm da coleção do tema (ESTILOS), não daqui.

import { EVENTOS, BAUS } from './config.js';
import { ROUPINHA } from './roupinhas.js';
import { catalogo } from './catalog.js';
import * as db from './db.js';
import { hojeISO } from './util.js';

// O baú do evento já tem o que dar: pelo menos um baú cheio (o `max` dele) de
// peças do acervo com o tema. Com menos, o presente e os post-its esperam
// (João, 01/11/2026: "ainda não dê o baú, tem poucas roupas").
export const temPecasDoEvento = (ev) => {
  const { tema, max = 1 } = BAUS[ev.bau] || {};
  return !tema || catalogo.itens.filter(i => i.tema === tema).length >= max;
};
// Os post-its só aparecem com tudo no jogo (João, 01/11/2026): as peças
// exclusivas do baú e os desenhos de todas as roupinhas que o evento dá.
const eventoPronto = (ev) => temPecasDoEvento(ev) && (ev.roupinhas || []).every(r => ROUPINHA[r.id]);

// O evento aberto hoje e pronto (o primeiro, se houver dois).
export const eventoAberto = (hoje = hojeISO()) =>
  EVENTOS.find(e => e.missoes?.length && hoje >= e.desde && hoje <= e.ate && eventoPronto(e)) ?? null;

const eventoDe = (m) => EVENTOS.find(e => e.id === m.evento) ?? null;
export const modeloDoEvento = (m) => eventoDe(m)?.missoes.find(x => x.id === m.id) ?? null;

// Na chegada de um post-it: 1 chance em `postitCada` de ser do evento aberto,
// com uma missão que ainda não está no mural. null = post-it normal.
export function postitDoEvento(emUso = new Set()) {
  const ev = eventoAberto();
  if (!ev || Math.random() * (ev.postitCada || 3) >= 1) return null;
  const livres = ev.missoes.filter(md => !emUso.has(`${ev.id}:${md.id}`));
  if (!livres.length) return null;
  const md = livres[Math.floor(Math.random() * livres.length)];
  return { evento: ev.id, id: md.id, meta: md.meta, feito: 0, alvo: {} };
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
  db.guardarBau(ev.bau, 'evento', ev.nome);   // grava e voa até Tarefas
  return { bau: BAUS[ev.bau].nome };
}

export const textoDoPostit = (m) => modeloDoEvento(m)?.nome ?? '';
export const nomeDoEvento = (m) => eventoDe(m)?.nome ?? '';
export const bauDoEvento = (m) => eventoDe(m)?.bau ?? null;
