// Eventos: a trilha de missões de uma data comemorativa (EVENTOS em
// config.js), num cartão no topo de Tarefas enquanto o evento está aberto.
//
// Uma missão por vez, na ordem. Cumprida, ela espera o toque em "Pegar", que
// entrega o prêmio (roupinha e/ou baú do evento) e abre a próxima. Quem conta
// é mural.contar(): todo garimpo, look, colagem e curtida já passa por lá.
//
// state.trilhas[id do evento] = { passo, feito }
//   passo: a missão da vez (índice em `missoes`); igual ao total = completa.
//   feito: quanto da missão da vez já foi feito.
// state.premiosDeEvento: ids das roupinhas ganhas (desbloqueio 'evento').

import { EVENTOS, BAUS, iconeDoBau } from './config.js';
import { ROUPINHA } from './roupinhas.js';
import { catalogo, item as pecaDoCatalogo } from './catalog.js';
import * as db from './db.js';
import { el, $, hojeISO, toast } from './util.js';
import { ico } from './icones.js';

// O baú do evento já tem o que dar: alguma peça do acervo com o tema dele.
export const temPecasDoEvento = (ev) => {
  const tema = BAUS[ev.bau]?.tema;
  return !tema || catalogo.itens.some(i => i.tema === tema);
};
// A trilha só aparece com tudo no jogo (João, 01/11/2026): as peças
// exclusivas do baú e os desenhos de todas as roupinhas que ela dá.
const trilhaPronta = (ev) => temPecasDoEvento(ev) && ev.missoes.every(m => !m.roupinha || ROUPINHA[m.roupinha]);

// O evento aberto hoje com a trilha pronta (o primeiro, se houver dois).
export const eventoAberto = (hoje = hojeISO()) =>
  EVENTOS.find(e => e.missoes?.length && hoje >= e.desde && hoje <= e.ate && trilhaPronta(e)) ?? null;

function trilha(ev) {
  const s = db.state;
  s.trilhas ??= {};
  return (s.trilhas[ev.id] ??= { passo: 0, feito: 0 });
}

const daVez = (ev) => ev.missoes[trilha(ev).passo] ?? null;
const pronta = (ev) => { const m = daVez(ev); return !!m && trilha(ev).feito >= m.meta; };
export const premioDeEventoPronto = () => { const ev = eventoAberto(); return !!ev && pronta(ev); };

const corDe = (p) => (p?.cor || '').toLowerCase();
const temCor = (p, cores) => !cores || cores.some(c => c.toLowerCase() === corDe(p));

// Mesmos eventos de mural.contar: 'garimpar' com { peca, raridade }; 'look'
// ou 'colagem' com { ids }; 'curtir'. Não grava: quem chamou já grava.
export function contarNoEvento(evento, { peca = null, raridade = null, ids = [] } = {}) {
  const ev = eventoAberto();
  if (!ev) return;
  const m = daVez(ev);
  const t = trilha(ev);
  if (!m || m.evento !== evento || t.feito >= m.meta) return;
  if (evento === 'curtir') t.feito += 1;
  else if (evento === 'garimpar') {
    if (temCor(peca, m.cores) && (!m.raridades || m.raridades.includes(raridade))) t.feito += 1;
  } else {
    const pecas = ids.map(id => pecaDoCatalogo(id)).filter(Boolean);
    const ok = m.todas ? pecas.length > 0 && pecas.every(p => temCor(p, m.cores)) : pecas.some(p => temCor(p, m.cores));
    if (ok) t.feito = m.meta;
  }
  t.feito = Math.min(t.feito, m.meta);
  if (t.feito >= m.meta) toast(`${ev.nome}: missão cumprida! Pegue o prêmio em Tarefas.`, 'rare');
}

// Entrega o prêmio da missão da vez e abre a próxima.
function pegar(ev) {
  if (!pronta(ev)) return;
  const m = daVez(ev);
  const t = trilha(ev);
  t.passo += 1;
  t.feito = 0;
  const ganhou = [];
  if (m.roupinha) {
    db.state.premiosDeEvento = [...new Set([...(db.state.premiosDeEvento ?? []), m.roupinha])];
    ganhou.push(nomeDaRoupinha(m));
  }
  if (m.bau) {
    db.guardarBau(ev.bau, 'evento', ev.nome);   // grava e voa até Tarefas
    ganhou.push(BAUS[ev.bau].nome);
  }
  db.salvar();
  if (ganhou.length) toast(`+${ganhou.join(' e ')}`, 'rare');
}

// O que a missão dá, em texto: "Chapéu de bruxa + Baú de Halloween".
const nomeDaRoupinha = (m) => ROUPINHA[m.roupinha]?.nome ?? m.nomeDaRoupinha ?? 'Roupinha';
function textoDoPremio(ev, m) {
  return [m.roupinha && nomeDaRoupinha(m), m.bau && BAUS[ev.bau].nome].filter(Boolean).join(' + ');
}

const diaEMes = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

// O cartão no topo de Tarefas: os passos da trilha e a missão da vez.
export function renderEvento() {
  const box = $('#tarefas-evento');
  if (!box) return;
  const ev = eventoAberto();
  box.hidden = !ev;
  if (!ev) return;
  const t = trilha(ev);
  const total = ev.missoes.length;
  const m = daVez(ev);
  const passos = ev.missoes.map((x, i) => el('span', {
    class: 'ev-passo' + (i < t.passo ? ' ok' : i === t.passo ? ' vez' : ''),
    title: `${x.nome} · ${textoDoPremio(ev, x)}`,
  }, i < t.passo ? ico('ok') : ico(x.roupinha ? 'camiseta' : iconeDoBau(ev.bau))));

  const corpo = m
    ? el('div', { class: 'ev-missao' + (pronta(ev) ? ' pronta' : '') },
        el('div', { class: 'ev-texto' },
          el('b', {}, m.nome),
          el('small', {}, 'Prêmio: ' + textoDoPremio(ev, m))),
        pronta(ev)
          ? el('button', { type: 'button', class: 'btn-dark ev-pegar', onclick: () => pegar(ev) }, 'Pegar')
          : el('span', { class: 'ev-conta' }, `${t.feito}/${m.meta}`))
    : el('div', { class: 'ev-missao completa' },
        el('div', { class: 'ev-texto' }, el('b', {}, 'Trilha completa!'),
          el('small', {}, 'Você pegou todos os prêmios de ' + ev.nome + '.')));

  box.className = `tf-secao tf-evento ev-${ev.bau}`;
  box.replaceChildren(
    el('div', { class: 'tf-sec-topo' },
      el('b', {}, '🎃 ', ev.nome),
      el('small', {}, `até ${diaEMes(ev.ate)} · ${Math.min(t.passo, total)}/${total}`)),
    el('div', { class: 'ev-passos' }, ...passos),
    corpo);
}
