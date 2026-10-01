// O dono da loja: fica no canto inferior esquerdo da vitrine e comenta o que
// acontece. Hierarquia de camadas do documento técnico:
// fundo < roupas < NPC < balão < sidebar.

import { CONFIG, FALAS } from './config.js';
import { escolher } from './util.js';

const ART = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 280" width="240" height="280">
  <!-- arara de roupas atrás -->
  <g stroke="#ded5c8" stroke-width="5" fill="none" stroke-linecap="round">
    <line x1="24" y1="96" x2="24" y2="250"/>
    <line x1="24" y1="96" x2="86" y2="96"/>
  </g>
  <g fill="#e9e1d6">
    <path d="M38 104 l10 0 6 40 -22 0 z"/>
    <path d="M62 104 l10 0 8 52 -26 0 z"/>
  </g>

  <!-- corpo -->
  <g>
    <path d="M96 268 L96 176 q0-40 40-40 l24 0 q40 0 40 40 l0 92 z" fill="#2f2b28"/>
    <!-- avental -->
    <path d="M118 176 l52 0 6 92 -64 0 z" fill="#c9a227" opacity=".92"/>
    <path d="M132 150 l36 0 -4 26 -28 0 z" fill="#c9a227" opacity=".92"/>
    <!-- braços -->
    <path d="M104 186 q-22 34 -14 62" stroke="#2f2b28" stroke-width="20" fill="none" stroke-linecap="round"/>
    <path d="M188 186 q22 34 14 62" stroke="#2f2b28" stroke-width="20" fill="none" stroke-linecap="round"/>
    <circle cx="92" cy="252" r="12" fill="#e7c9a9"/>
    <circle cx="200" cy="252" r="12" fill="#e7c9a9"/>
    <!-- cabeça -->
    <ellipse cx="146" cy="108" rx="40" ry="44" fill="#e7c9a9"/>
    <path d="M106 100 q6-42 40-42 q34 0 40 42 q-14-14 -40-14 q-26 0 -40 14z" fill="#3b332c"/>
    <!-- boina -->
    <path d="M100 86 q10-34 46-34 q40 0 48 30 q2 10-12 12 l-72 0 q-12 0-10-8z" fill="#8d6b4f"/>
    <circle cx="176" cy="60" r="7" fill="#8d6b4f"/>
    <!-- rosto -->
    <circle cx="132" cy="112" r="4.5" fill="#2f2b28"/>
    <circle cx="162" cy="112" r="4.5" fill="#2f2b28"/>
    <path d="M136 132 q10 9 22 0" stroke="#2f2b28" stroke-width="4" fill="none" stroke-linecap="round"/>
    <!-- óculos na ponta do nariz -->
    <g stroke="#2f2b28" stroke-width="3" fill="none" opacity=".8">
      <circle cx="132" cy="112" r="13"/><circle cx="162" cy="112" r="13"/>
      <line x1="145" y1="112" x2="149" y2="112"/>
    </g>
  </g>
</svg>`;

let bolha, texto, timer;

export function montarNPC() {
  // Personagem desligado (CONFIG.NPC_VISIVEL): esconde o canto e sai. As falas
  // viram no-op, então nada mais no app precisa saber disso.
  if (!CONFIG.NPC_VISIVEL) {
    const canto = document.getElementById('npc');
    if (canto) canto.hidden = true;
    return;
  }
  document.getElementById('npc-art').innerHTML = ART;
  bolha = document.getElementById('npc-bubble');
  texto = document.getElementById('npc-fala');
  bolha.addEventListener('click', () => falar(escolher(FALAS.dica)));
}

export function falar(msg, { tempo = 6000 } = {}) {
  if (!texto) return;
  texto.textContent = msg;
  bolha.classList.remove('pop');
  void bolha.offsetWidth;          // reinicia a animação
  bolha.classList.add('visivel', 'pop');
  clearTimeout(timer);
  timer = setTimeout(() => bolha.classList.remove('visivel'), tempo);
}

export const falarDe = (chave, opts) => falar(escolher(FALAS[chave] || FALAS.dica), opts);
