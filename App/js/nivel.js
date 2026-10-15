// Nível e XP na interface.
//
// A regra mora em config.js (curva) e db.js (estado). Aqui é só o que se vê:
// o selo da sidebar, o chip reaproveitado em outras telas e o aviso de subida
// de nível. Quem ganha XP não precisa saber que esta tela existe — db avisa.

import { FERRAMENTAS, nivelDaFerramenta } from './config.js';
import * as db from './db.js';
import { el, $, toast } from './util.js';
import { ico, emo } from './icones.js';
import { festejar, flutuarTexto } from './animacoes.js';

// Chip pequeno "Nv 3" para pendurar ao lado de um nome (feed, perfil, listas).
export function chipNivel(n = db.nivel()) {
  return el('span', { class: 'nivel-chip', title: `Nível ${n}` }, `Nv ${n}`);
}

export function montarNivel() {
  db.onXP(evento => {
    renderSeloNivel();
    const selo = $('#nivel-selo');
    if (evento.xp > 0) flutuarTexto(selo, `+${evento.xp} XP`);
    if (evento.subiu) festejar(selo, 'confete');
    if (evento.subiu) {
      const p = db.progresso();
      toast(`Subiu para o nível ${p.nivel}!`, 'legendary');
      anunciarDesbloqueios(evento.de, evento.nivel);
    } else if (evento.motivo) {
      toast(`+${evento.xp} XP — ${evento.motivo}.`);
    }
  });

  // Recalcula o selo em qualquer gravação (virada do dia, reset, import).
  db.onChange(renderSeloNivel);

  renderSeloNivel();
  renderTravasDaSidebar();
}

// Selo fixo na sidebar: número do nível e o quanto falta para o próximo.
export function renderSeloNivel() {
  const selo = $('#nivel-selo');
  if (!selo) return;
  const p = db.progresso();

  // A barrinha nasce onde a anterior estava e anda até o valor novo; ao
  // subir de nível ela enche e recomeça do zero.
  const antes = selo.querySelector('.nivel-barra span')?.style.width;
  const nivelAntes = Number(selo.dataset.nivel || p.nivel);
  selo.dataset.nivel = p.nivel;
  selo.innerHTML = '';
  selo.title = p.maximo
    ? `Nível máximo (${p.nivel})`
    : `Nível ${p.nivel}: faltam ${p.xpFaltando} XP para o ${p.nivel + 1}`;
  selo.append(
    el('strong', {}, String(p.nivel)),
    el('small', {}, 'nível'),
    el('div', { class: 'nivel-barra mini' },
      el('span', { style: { width: (antes && nivelAntes === p.nivel ? antes : (nivelAntes < p.nivel ? '0%' : p.pct + '%')) } }))
  );
  const barra = selo.querySelector('.nivel-barra span');
  requestAnimationFrame(() => requestAnimationFrame(() => { barra.style.width = p.pct + '%'; }));

  renderTravasDaSidebar();
}

// Barra de XP larga, usada no topo das Tarefas.
export function barraDeNivel() {
  const p = db.progresso();
  return el('div', { class: 'nivel-box' },
    el('div', { class: 'nivel-topo' },
      el('span', { class: 'nivel-num' }, `Nível ${p.nivel}`),
      el('span', { class: 'nivel-xp' }, p.maximo
        ? `${p.xpTotal} XP · nível máximo`
        : `${p.xpNoNivel}/${p.xpDoNivel} XP`)
    ),
    el('div', { class: 'nivel-barra' },
      el('span', { style: { width: p.pct + '%' } })),
    el('small', { class: 'nivel-nota' }, p.maximo
      ? 'Você chegou ao fim da trilha — por enquanto.'
      : `Faltam ${p.xpFaltando} XP para o nível ${p.nivel + 1}.`)
  );
}

// Botão de tela travada: cadeado e o nível que falta.
function renderTravasDaSidebar() {
  for (const botao of document.querySelectorAll('.sidebar-btn')) {
    const id = botao.dataset.goto;
    const liberada = db.ferramentaLiberada(id);
    botao.classList.toggle('travada', !liberada);
    if (!liberada) botao.title = `Abre no nível ${nivelDaFerramenta(id)}`;
  }
}

// Ao subir de nível, diz o que abriu agora (nada abre enquanto tudo é nível 1).
function anunciarDesbloqueios(de, para) {
  const abriram = FERRAMENTAS.filter(f => f.nivel > de && f.nivel <= para);
  for (const f of abriram) toast(`${f.nome} desbloqueada!`, 'legendary');
}

// Lista "o que abre em cada nível", para a aba Tarefas.
export function listaDeFerramentas() {
  const atual = db.nivel();
  const lista = el('div', { class: 'ferramenta-list' });
  for (const f of [...FERRAMENTAS].sort((a, b) => a.nivel - b.nivel)) {
    const liberada = atual >= f.nivel;
    lista.append(el('div', { class: 'ferramenta' + (liberada ? ' ok' : '') },
      el('span', { class: 'ferramenta-nivel' }, liberada ? ico('ok') : `Nv ${f.nivel}`),
      el('div', { class: 'ferramenta-info' },
        el('strong', {}, f.nome),
        el('small', {}, f.desc)),
      liberada ? null : el('span', { class: 'cadeado' }, emo('🔒'))
    ));
  }
  return lista;
}
