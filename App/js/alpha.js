// Hit-test por canal alpha — plano B do protótipo original.
//
// Só entra em ação quando a peça não tem contorno vetorial no catálogo
// (por exemplo, rodando direto dos PNGs do S3). Quando o contorno existe, o
// clip-path resolve o clique nativamente e nada aqui é necessário.
//
// Diferença para o script original: a amostra do alpha é feita numa cópia
// reduzida da imagem (256px), o que economiza memória sem perder precisão útil.

const AMOSTRA_MAX = 256;
const cache = new Map(); // src -> { ctx, w, h, pronto, promessa }

export function amostradorDe(img) {
  const src = img?.currentSrc || img?.src;
  if (!src) return null;

  let entry = cache.get(src);
  if (entry) return entry;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  entry = { canvas, ctx, w: 0, h: 0, pronto: false, promessa: null };
  cache.set(src, entry);

  const loader = new Image();
  loader.crossOrigin = 'anonymous';
  loader.decoding = 'async';
  loader.src = src;

  entry.promessa = new Promise((resolve) => {
    loader.onload = () => {
      const nw = loader.naturalWidth || 1, nh = loader.naturalHeight || 1;
      const escala = Math.min(1, AMOSTRA_MAX / Math.max(nw, nh));
      entry.w = Math.max(1, Math.round(nw * escala));
      entry.h = Math.max(1, Math.round(nh * escala));
      canvas.width = entry.w; canvas.height = entry.h;
      try {
        ctx.drawImage(loader, 0, 0, entry.w, entry.h);
        entry.pronto = true;
      } catch {
        entry.pronto = false; // canvas "tainted" (CORS) — mantém clique normal
      }
      resolve(entry);
    };
    loader.onerror = () => resolve(entry);
  });

  return entry;
}

export function precarregarAlpha(img) {
  amostradorDe(img)?.promessa?.catch?.(() => {});
}

export function opacoNoPonteiro(itemEl, clientX, clientY, limiar = 24) {
  const img = itemEl?.querySelector?.('img');
  if (!img) return true;

  const r = img.getBoundingClientRect();
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;

  const s = amostradorDe(img);
  if (!s?.pronto || !s.w || !s.h) return true; // sem alpha disponível: clique normal

  const px = Math.min(s.w - 1, Math.max(0, Math.floor((clientX - r.left) / r.width * s.w)));
  const py = Math.min(s.h - 1, Math.max(0, Math.floor((clientY - r.top) / r.height * s.h)));
  try {
    return s.ctx.getImageData(px, py, 1, 1).data[3] >= limiar;
  } catch {
    return true;
  }
}

// Deixa o clique "atravessar" áreas transparentes até a peça de baixo.
export function instalarPassThrough(raiz, seletorItem = '.item-roupa') {
  let desligados = [];
  let alvoReal = null;

  const religar = () => { for (const e of desligados) e.style.pointerEvents = ''; desligados = []; };

  const calcularAlvo = (x, y) => {
    religar();
    for (const e of document.elementsFromPoint(x, y)) {
      const item = e.closest?.(seletorItem);
      if (!item) continue;
      const s = amostradorDe(item.querySelector('img'));
      if (!s?.pronto) return e;
      if (opacoNoPonteiro(item, x, y)) return e;
      item.style.pointerEvents = 'none';
      desligados.push(item);
    }
    return null;
  };

  raiz.addEventListener('pointermove', (e) => { alvoReal = calcularAlvo(e.clientX, e.clientY); },
    { passive: true, capture: true });
  raiz.addEventListener('pointerdown', (e) => { alvoReal = calcularAlvo(e.clientX, e.clientY); },
    { passive: true, capture: true });

  raiz.addEventListener('click', (e) => {
    if (!alvoReal || alvoReal === e.target) return;
    e.preventDefault();
    e.stopPropagation();
    alvoReal.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, view: window,
      clientX: e.clientX, clientY: e.clientY, button: e.button,
    }));
  }, { capture: true });
}
