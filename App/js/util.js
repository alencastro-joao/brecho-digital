// Utilitários gerais: aleatoriedade com semente, distribuição no mural, DOM.

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
export const randBetween = (min, max) => min + Math.random() * (max - min);

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Object.assign no style ignora propriedades customizadas (--algo) sem avisar;
// elas precisam de setProperty.
function aplicarEstilo(node, estilo) {
  for (const [prop, valor] of Object.entries(estilo)) {
    if (prop.startsWith('--')) node.style.setProperty(prop, valor);
    else node.style[prop] = valor;
  }
}

export function el(tag, props = {}, ...filhos) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') aplicarEstilo(node, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    node.append(f.nodeType ? f : document.createTextNode(f));
  }
  return node;
}

// --- Aleatoriedade determinística -----------------------------------------
// A vitrine do dia precisa ser a mesma durante todo o dia: o sorteio usa a data
// como semente, então recarregar a página não troca as peças.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Semente a partir de um texto (FNV-1a). Mesmo texto, mesma sequência: é assim
// que o avatar e os números de um perfil não mudam a cada render nem a cada
// sessão, sem ninguém cadastrar nada.
export function sementeDoTexto(texto) {
  let h = 2166136261;
  for (let i = 0; i < String(texto).length; i++) {
    h ^= String(texto).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const hojeISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const sementeDoDia = (iso = hojeISO()) => Number(iso.replaceAll('-', ''));

export function shuffle(arr, rnd = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const escolher = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length)];

export function msAteMeiaNoite() {
  const agora = new Date();
  const amanha = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1, 0, 0, 5);
  return amanha - agora;
}

export function formatarContagem(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  return `${h}h${m}`;
}

// "há 5 min", "há 3 h", "há 2 d" — o suficiente para uma thread de comentários.
export function tempoRelativo(iso) {
  const seg = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seg < 60) return 'agora';
  const min = seg / 60;
  if (min < 60) return `há ${Math.floor(min)} min`;
  const h = min / 60;
  if (h < 24) return `há ${Math.floor(h)} h`;
  const d = h / 24;
  if (d < 7) return `há ${Math.floor(d)} d`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
}

export const dataExtenso = (iso) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR',
    { weekday: 'long', day: 'numeric', month: 'long' });

// --- Distribuição das peças no mural (Poisson-disc, Bridson) ---------------
// Mantém as roupas "soltas" como um moodboard, sem aglomerados nem buracos.
export function pontosPoisson(count, width, height, opts = {}) {
  const { padding = 24, paddingTop = null, itemW = 170, itemH = 200, minDist = 115, k = 24,
          fallbackJitter = 0.35, rnd = Math.random, excluir = [], tamanhos = [] } = opts;
  const entre = (a, b) => a + rnd() * (b - a);

  // `tamanhos[i]` é o tamanho da peça que vai ocupar o ponto i (mesma ordem da
  // lista de peças). O ponto é a âncora superior-esquerda, então quem é maior
  // precisa parar antes da borda: com uma medida só para todo mundo, o vestido
  // comprido era colocado como se fosse uma camisa e vazava pelo rodapé.
  const padraoT = { w: itemW, h: itemH };
  const tam = (i) => tamanhos[i] || padraoT;

  // Zonas proibidas (cabeçalho, NPC).
  const proibido = (p, t) => excluir.some(r =>
    p.x + t.w > r.x0 && p.x < r.x1 && p.y + t.h > r.y0 && p.y < r.y1);

  const minX = padding, minY = paddingTop ?? padding;
  const maxXde = (t) => Math.max(minX, width - t.w - padding);
  const maxYde = (t) => Math.max(minY, height - t.h - padding);
  const usableW = Math.max(1, maxXde(padraoT) - minX);
  const usableH = Math.max(1, maxYde(padraoT) - minY);

  const cellSize = minDist / Math.SQRT2;
  const cols = Math.max(1, Math.ceil(usableW / cellSize));
  const rows = Math.max(1, Math.ceil(usableH / cellSize));
  const grid = new Array(cols * rows).fill(null);

  const gx = p => clamp(Math.floor((p.x - minX) / cellSize), 0, cols - 1);
  const gy = p => clamp(Math.floor((p.y - minY) / cellSize), 0, rows - 1);
  const dentro = (p, t) =>
    p.x >= minX && p.x <= maxXde(t) && p.y >= minY && p.y <= maxYde(t) && !proibido(p, t);

  const longeOBastante = (p) => {
    const cx = gx(p), cy = gy(p), r2 = minDist * minDist;
    for (let y = Math.max(0, cy - 2); y <= Math.min(rows - 1, cy + 2); y++) {
      for (let x = Math.max(0, cx - 2); x <= Math.min(cols - 1, cx + 2); x++) {
        const viz = grid[y * cols + x];
        if (!viz) continue;
        const dx = viz.x - p.x, dy = viz.y - p.y;
        if (dx * dx + dy * dy < r2) return false;
      }
    }
    return true;
  };

  const pontos = [], ativos = [];
  const t0 = tam(0);
  let primeiro = { x: entre(minX, maxXde(t0)), y: entre(minY, maxYde(t0)) };
  for (let tent = 0; tent < 40 && proibido(primeiro, t0); tent++) {
    primeiro = { x: entre(minX, maxXde(t0)), y: entre(minY, maxYde(t0)) };
  }
  pontos.push(primeiro); ativos.push(primeiro);
  grid[gy(primeiro) * cols + gx(primeiro)] = primeiro;

  while (ativos.length && pontos.length < count) {
    const t = tam(pontos.length);
    const idx = Math.floor(rnd() * ativos.length);
    const origem = ativos[idx];
    let achou = false;
    for (let i = 0; i < k; i++) {
      const ang = rnd() * Math.PI * 2;
      const raio = entre(minDist, 2 * minDist);
      const cand = { x: origem.x + Math.cos(ang) * raio, y: origem.y + Math.sin(ang) * raio };
      if (!dentro(cand, t) || !longeOBastante(cand)) continue;
      pontos.push(cand); ativos.push(cand);
      grid[gy(cand) * cols + gx(cand)] = cand;
      achou = true;
      break;
    }
    if (!achou) ativos.splice(idx, 1);
  }

  // Não coube tudo: completa com grid + jitter para não deixar áreas vazias.
  if (pontos.length < count) {
    const faltam = count - pontos.length;
    const aspect = usableW / usableH;
    const c = Math.max(1, Math.ceil(Math.sqrt(count * aspect)));
    const r = Math.max(1, Math.ceil(count / c));
    const cellW = usableW / c, cellH = usableH / r;
    const celulas = shuffle([...Array(c * r).keys()], rnd);
    for (let i = 0; i < faltam; i++) {
      const t = tam(pontos.length);
      const cel = celulas[i % celulas.length];
      const cx = minX + (cel % c) * cellW;
      const cy = minY + Math.floor(cel / c) * cellH;
      const p = {
        x: clamp(cx + cellW / 2 + (rnd() - 0.5) * cellW * fallbackJitter, minX, maxXde(t)),
        y: clamp(cy + cellH / 2 + (rnd() - 0.5) * cellH * fallbackJitter, minY, maxYde(t)),
      };
      if (proibido(p, t)) p.y = clamp(p.y - (t.h + 40), minY, maxYde(t));
      pontos.push(p);
    }
  }
  return pontos.slice(0, count);
}

// --- Toasts ----------------------------------------------------------------
export function toast(msg, tipo = '') {
  const stack = document.getElementById('toasts');
  if (!stack) return;
  const t = el('div', { class: `toast ${tipo}` }, msg);
  stack.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2800);
}
