// Sons do app: toques curtos feitos na hora pelo Web Audio, sem arquivo
// nenhum (nada para baixar, nada de licença de terceiro).
//
// Quem toca é quem sabe o que aconteceu: animacoes.js (clique, favoritar,
// curtir, subir de nível, dado), o baú abrindo, o tutorial (tecla e missão), a peça pega na vitrine, a
// janela e os avisos. Aqui só se desenha cada som e se guarda o volume (a
// barra no menu da engrenagem do perfil; 0 é mudo), que vale para o aparelho
// (localStorage), não para a conta.
//
// Celular: o navegador só deixa tocar depois de um toque da pessoa. O
// primeiro toque em qualquer lugar acorda o áudio (ver destravar()).

const CHAVE = 'bd-volume';
const CHAVE_ANTIGA = 'bd-sons';   // 'off' do botão de silenciar que veio antes
export const VOLUME_PADRAO = 70;  // de 0 a 100
// Ganho no volume 100. Cada som tem o seu volume, baixo; isto sobe todos
// juntos, e o compressor no fim segura quando vários tocam ao mesmo tempo.
const GANHO_MAXIMO = 2.88;   // 2,4 + 20%

let ctx = null;
let mestre = null;
let pediuEm = -1e9;           // quando se pediu para acordar o áudio

let volumeSemGravar = null;       // sem localStorage: vale só até fechar

export function volume() {
  try {
    const v = localStorage.getItem(CHAVE);
    if (v !== null && v !== '') return Math.max(0, Math.min(100, Number(v) || 0));
    if (localStorage.getItem(CHAVE_ANTIGA) === 'off') return 0;
  } catch { /* segue */ }
  return volumeSemGravar ?? VOLUME_PADRAO;
}

export const sonsLigados = () => volume() > 0;

const ganho = (v) => (v / 100) ** 1.5 * GANHO_MAXIMO;   // o ouvido não é linear

export function mudarVolume(v) {
  v = Math.max(0, Math.min(100, Math.round(v)));
  volumeSemGravar = v;
  try {
    localStorage.setItem(CHAVE, String(v));
    localStorage.removeItem(CHAVE_ANTIGA);
  } catch { /* sem localStorage */ }
  if (mestre) mestre.gain.setTargetAtTime(ganho(v), ctx.currentTime, 0.01);
}

function contexto(acordar = true) {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    mestre = ctx.createGain();
    mestre.gain.value = ganho(volume());
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.ratio.value = 6;
    mestre.connect(compressor).connect(ctx.destination);
  }
  if (acordar && ctx.state === 'suspended') {
    pediuEm = performance.now();
    ctx.resume().catch(() => {});
  }
  return ctx;
}

// O primeiro gesto acorda o áudio. touchend e click cobrem o Safari do
// iPhone, que não aceita o pointerdown como gesto para isso.
function destravar() {
  if (!sonsLigados()) return;
  const c = contexto();
  if (c?.state === 'running') {
    for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) document.removeEventListener(ev, destravar, true);
  }
}
for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) {
  document.addEventListener(ev, destravar, { capture: true, passive: true });
}

// Uma nota: frequência (que pode deslizar até `ate`), envelope curto.
function nota(c, freq, { em = 0, dur = 0.1, tipo = 'sine', vol = 0.1, ate = null } = {}) {
  const t = c.currentTime + em;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = tipo;
  o.frequency.setValueAtTime(freq, t);
  if (ate) o.frequency.exponentialRampToValueAtTime(ate, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(mestre);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// Escalinha subindo, para as coisas boas.
const arpejo = (c, freqs, passo, opcoes) =>
  freqs.forEach((f, i) => nota(c, f, { em: i * passo, ...opcoes }));

const SONS = {
  // Clique de botão: um "tic" macio, quase só sentido.
  toque: (c) => nota(c, 640, { ate: 480, dur: 0.05, tipo: 'triangle', vol: 0.07 }),   // 0,05 + 40%
  // Favoritar: brilhinho.
  estrela: (c) => arpejo(c, [1318, 1760], 0.06, { dur: 0.16, vol: 0.06 }),
  // Curtir: "pop" que sobe.
  coracao: (c) => nota(c, 520, { ate: 1040, dur: 0.12, vol: 0.09 }),
  // Subir de nível: fanfarra curta.
  confete: (c) => {
    arpejo(c, [523, 659, 784, 1047], 0.09, { dur: 0.22, tipo: 'triangle', vol: 0.09 });
    nota(c, 1568, { em: 0.36, dur: 0.4, vol: 0.05 });
  },
  // "+XP" e "+1" subindo.
  xp: (c) => arpejo(c, [988, 1480], 0.07, { dur: 0.14, vol: 0.05 }),
  // Dado do "Gerar" rolando: tiques que vão rareando.
  dado: (c) => [0, 0.07, 0.15, 0.25, 0.38, 0.54].forEach((em, i) =>
    nota(c, 300 + Math.random() * 500, { em, dur: 0.035, tipo: 'square', vol: 0.025 + i * 0.002 })),
  // Baú: treme (graves) e abre com brilho quando as peças pulam.
  bau: (c) => {
    [0, 0.12, 0.24, 0.36].forEach(em => nota(c, 140, { em, ate: 110, dur: 0.08, tipo: 'triangle', vol: 0.08 }));
    nota(c, 300, { em: 0.55, ate: 900, dur: 0.25, vol: 0.06 });
    arpejo(c, [784, 988, 1175, 1568], 0.08, { em: 0.8, dur: 0.3, vol: 0.06 });
  },
  // Peça pega na vitrine: quanto mais rara, mais alta e mais longa a escala.
  pegou: (c, raridade) => {
    const notas = {
      legendary: [659, 784, 988, 1318, 1568],
      epic: [659, 784, 988, 1318],
      rare: [659, 880, 1175],
    }[raridade] ?? [784, 1175];
    arpejo(c, notas, 0.07, { dur: 0.18, tipo: 'triangle', vol: 0.07 });
  },
  // Devolveu, desfez: desce.
  desfazer: (c) => nota(c, 700, { ate: 350, dur: 0.16, tipo: 'triangle', vol: 0.06 }),
  // Janela abrindo: sopro leve.
  janela: (c) => nota(c, 330, { ate: 620, dur: 0.12, vol: 0.04 }),
  // Aviso (não deu, falta algo): dois tons descendo, sem susto.
  aviso: (c) => arpejo(c, [523, 415], 0.09, { dur: 0.14, tipo: 'triangle', vol: 0.05 }),
  // Deu certo.
  ok: (c) => arpejo(c, [784, 1047], 0.07, { dur: 0.14, vol: 0.06 }),
  // Tecla: o texto do tutorial sendo digitado. Um tique curtinho, cada um
  // num tom, para não soar como máquina.
  tecla: (c) => nota(c, 1500 + Math.random() * 600, { ate: 900, dur: 0.025, tipo: 'square', vol: 0.012 }),
  // Missão do tutorial concluída: fanfarra com brilho no fim.
  missao: (c) => {
    arpejo(c, [523, 659, 784], 0.08, { dur: 0.18, tipo: 'triangle', vol: 0.08 });
    arpejo(c, [1047, 1319], 0.07, { em: 0.26, dur: 0.3, tipo: 'triangle', vol: 0.07 });
    arpejo(c, [2093, 2637, 3136], 0.05, { em: 0.42, dur: 0.22, vol: 0.03 });
  },
};

// Um mesmo som não se repete mais rápido que isso (clique duplo, toasts em
// sequência): vira ruído.
const INTERVALO = 45;
const ultimo = {};

export function tocar(nome, ...args) {
  const som = SONS[nome];
  if (!som || !sonsLigados() || document.hidden) return;
  const agora = performance.now();
  if (agora - (ultimo[nome] ?? -1e9) < INTERVALO) return;
  ultimo[nome] = agora;
  try {
    const c = contexto(false);
    // Acordando agora (no próprio toque): a nota espera o áudio acordar. Sem
    // toque nenhum ainda, não: os sons se acumulariam para o primeiro toque.
    if (!c || (c.state !== 'running' && agora - pediuEm > 500)) return;
    som(c, ...args);
  } catch { /* som é enfeite: nunca atrapalha o app */ }
}
