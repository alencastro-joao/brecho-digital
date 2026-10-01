// Player da trilha do mês.
//
// A ideia do projeto é trocar a "skin sonora": o tema base da casa e, uma vez
// por mês, a versão de um produtor convidado. Os arquivos ficam em
// assets/audio/. Se não existirem, o player aparece desativado com o aviso —
// é só soltar os .mp3 na pasta que ele passa a funcionar.

import { TRILHAS } from './config.js';
import { el, $ } from './util.js';

let audio;
let atual = TRILHAS[0];
let disponivel = new Set();

export async function montarPlayer() {
  audio = new Audio();
  audio.loop = true;
  audio.volume = 0.6;

  await Promise.all(TRILHAS.map(async (t) => {
    try {
      const r = await fetch(t.src, { method: 'HEAD' });
      if (r.ok) disponivel.add(t.id);
    } catch { /* arquivo ausente */ }
  }));

  renderSkins();
  atualizarInfo();

  $('#play-btn').addEventListener('click', () => {
    if (!disponivel.has(atual.id)) return;
    if (audio.paused) { audio.play(); $('#play-btn').textContent = '❚❚'; }
    else { audio.pause(); $('#play-btn').textContent = '▶'; }
  });
}

function renderSkins() {
  const box = $('#player-skins');
  box.innerHTML = '';
  for (const t of TRILHAS) {
    const ok = disponivel.has(t.id);
    box.append(el('button', {
      class: 'skin' + (t.id === atual.id ? ' ativa' : '') + (ok ? '' : ' off'),
      disabled: !ok || null,
      title: ok ? t.sub : `Coloque ${t.src} na pasta para ativar`,
      onclick: () => trocar(t),
    }, t.nome));
  }
  if (!disponivel.size) {
    box.append(el('p', { class: 'tool-hint' },
      'Nenhuma faixa em assets/audio/. O player liga sozinho quando os arquivos existirem.'));
  }
}

function trocar(t) {
  const tocando = !audio.paused;
  const pos = audio.currentTime;
  atual = t;
  audio.src = t.src;
  audio.currentTime = pos || 0;   // troca a "skin" mantendo o ponto da música
  if (tocando) audio.play();
  renderSkins();
  atualizarInfo();
}

function atualizarInfo() {
  $('#track-nome').textContent = atual.nome;
  $('#track-sub').textContent = disponivel.has(atual.id) ? atual.sub : 'faixa não encontrada';
  $('#play-btn').disabled = !disponivel.has(atual.id);
}
