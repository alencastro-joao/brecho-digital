// Alças de girar e de tamanho da peça escolhida (Stylist e Colagem).
//
// Moram numa camada própria por cima de todas as peças, e não dentro da peça:
// assim uma peça mais à frente não cobre as alças da escolhida. Cada moldura
// copia a posição, o tamanho e o giro da peça; puxar uma alça chama
// `aoPegar(e, uid)` com `e.target.dataset.alca` = 'rot' ou 'esc', igual a
// quando as alças eram filhas da peça.
//
// Se a bolinha de girar não cabe em cima (peça encostada no topo do palco),
// ela desce para baixo da peça.
import { el } from './util.js';

export function camadaDeAlcas(palco, { classe = '', aoPegar }) {
  const camada = el('div', { class: 'alcas-camada ' + classe });
  palco.append(camada);
  const molduras = new Map();     // uid -> moldura

  function moldura(uid) {
    const m = el('div', { class: 'alcas-moldura', dataset: { uid } },
      el('span', { class: 'alca alca-rot', dataset: { alca: 'rot' }, title: 'Girar (Shift: de 15 em 15°)' }),
      ...['no', 'ne', 'so', 'se'].map(q =>
        el('span', { class: `alca alca-esc alca-${q}`, dataset: { alca: 'esc' }, title: 'Tamanho' })));
    m.addEventListener('pointerdown', (e) => {
      if (!e.target.dataset?.alca) return;
      e.stopPropagation();
      aoPegar(e, uid);
    });
    return m;
  }

  // `alvos`: [{ uid, no, travado }] das peças escolhidas, já posicionadas.
  function sincronizar(alvos = []) {
    const vivos = new Set();
    for (const { uid, no, travado } of alvos) {
      if (!no?.isConnected) continue;
      vivos.add(uid);
      let m = molduras.get(uid);
      if (!m) { m = moldura(uid); molduras.set(uid, m); camada.append(m); }
      const s = no.style;
      Object.assign(m.style, {
        left: s.left, top: s.top, width: s.width,
        height: s.height, aspectRatio: s.aspectRatio, transform: s.transform,
      });
      m.classList.toggle('travada', !!travado);
      // A bolinha de girar fica a ~26px acima da peça: perto do topo, desce.
      const r = no.getBoundingClientRect(), p = palco.getBoundingClientRect();
      m.classList.toggle('rot-embaixo', r.top - p.top < 34);
    }
    for (const [uid, m] of molduras) {
      if (!vivos.has(uid)) { m.remove(); molduras.delete(uid); }
    }
  }

  return { sincronizar, camada };
}
