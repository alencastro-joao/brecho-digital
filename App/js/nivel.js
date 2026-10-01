// Nível e XP na interface.
//
// A regra mora em config.js (curva) e db.js (estado). Aqui é só o que se vê:
// o selo da sidebar, o chip reaproveitado em outras telas e o aviso de subida
// de nível. Quem ganha XP não precisa saber que esta tela existe — db avisa.

import { FERRAMENTAS, nivelDaFerramenta } from './config.js';
import * as db from './db.js';
import { el, $, toast } from './util.js';

// Chip pequeno "Nv 3" para pendurar ao lado de um nome (feed, perfil, listas).
export function chipNivel(n = db.nivel(), { titulo = true } = {}) {
  return el('span', {
    class: 'nivel-chip',
    title: titulo ? `Nível ${n} · ${db.progresso().titulo}` : null,
  }, `Nv ${n}`);
}

export function montarNivel() {
  db.onXP(evento => {
    renderSeloNivel();
    if (evento.subiu) {
      const p = db.progresso();
      toast(`Nível ${p.nivel}! Agora você é ${p.titulo.toLowerCase()}.`, 'legendary');
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

  selo.innerHTML = '';
  selo.title = p.maximo
    ? `Nível máximo (${p.nivel}) · ${p.titulo}`
    : `Nível ${p.nivel} · ${p.titulo} — faltam ${p.xpFaltando} XP para o ${p.nivel + 1}`;
  selo.append(
    el('strong', {}, String(p.nivel)),
    el('small', {}, 'nível'),
    el('div', { class: 'nivel-barra mini' },
      el('span', { style: { width: p.pct + '%' } }))
  );

  renderTravasDaSidebar();
}

// Barra de XP larga, usada no topo das Tarefas.
export function barraDeNivel() {
  const p = db.progresso();
  return el('div', { class: 'nivel-box' },
    el('div', { class: 'nivel-topo' },
      el('span', { class: 'nivel-num' }, `Nível ${p.nivel}`),
      el('span', { class: 'nivel-titulo' }, p.titulo),
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
      el('span', { class: 'ferramenta-nivel' }, liberada ? '✓' : `Nv ${f.nivel}`),
      el('div', { class: 'ferramenta-info' },
        el('strong', {}, f.nome),
        el('small', {}, f.desc)),
      liberada ? null : el('span', { class: 'cadeado' }, '🔒')
    ));
  }
  return lista;
}
