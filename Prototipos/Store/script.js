/* --- JAVASCRIPT (LÓGICA) --- */

const URL_BASE_S3 = "https://brecho-system-resources.s3.us-east-1.amazonaws.com/cloths/";

// 40 peças (01..40). Ajuste o length se subir mais imagens.
const listaRoupasS3 = Array.from({ length: 59 }, (_, i) =>
    String(i + 1).padStart(2, '0') + ".png"
);

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
}

function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function randBetween(min, max) {
    return min + Math.random() * (max - min);
}

// --- Hit-test por pixel (ignora transparência do PNG) ---
const __alphaCache = new Map(); // src -> { canvas, ctx, w, h, ready, loadingPromise }

function getImageAlphaSampler(imgEl) {
    const src = imgEl?.currentSrc || imgEl?.src;
    if (!src) return null;

    let entry = __alphaCache.get(src);
    if (!entry) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        entry = { canvas, ctx, w: 0, h: 0, ready: false, loadingPromise: null };
        __alphaCache.set(src, entry);

        const loader = new Image();
        loader.crossOrigin = 'anonymous';
        loader.decoding = 'async';
        loader.src = src;

        entry.loadingPromise = new Promise((resolve) => {
            loader.onload = () => {
                entry.w = loader.naturalWidth || loader.width;
                entry.h = loader.naturalHeight || loader.height;
                entry.canvas.width = entry.w;
                entry.canvas.height = entry.h;
                try {
                    entry.ctx.drawImage(loader, 0, 0);
                    entry.ready = true;
                } catch {
                    entry.ready = false;
                }
                resolve(entry);
            };
            loader.onerror = () => resolve(entry);
        });
    }

    return entry;
}

function isOpaqueAtPointer(itemEl, clientX, clientY, alphaThreshold = 24) {
    const img = itemEl?.querySelector?.('img');
    if (!img) return true;

    const rect = img.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
        return false;
    }

    const sampler = getImageAlphaSampler(img);
    if (!sampler) return true;

    // Se ainda não carregou o alpha, NÃO tentamos atravessar (mantém clique normal).
    // O pass-through só entra quando temos o alpha disponível com segurança.
    if (!sampler.ready || !sampler.ctx || !sampler.w || !sampler.h) {
        return true;
    }

    const u = (clientX - rect.left) / Math.max(1, rect.width);
    const v = (clientY - rect.top) / Math.max(1, rect.height);
    const px = clamp(Math.floor(u * sampler.w), 0, sampler.w - 1);
    const py = clamp(Math.floor(v * sampler.h), 0, sampler.h - 1);

    try {
        const data = sampler.ctx.getImageData(px, py, 1, 1).data;
        const a = data[3];
        return a >= alphaThreshold;
    } catch {
        // Se falhar ao ler o pixel (canvas tainted / CORS), caímos pro comportamento normal.
        return true;
    }
}

function instalarPassThroughTransparencia(mural) {
    let disabled = [];
    let lastRealTarget = null;

    const clearDisabled = () => {
        for (const el of disabled) el.style.pointerEvents = '';
        disabled = [];
    };

    const computeRealTarget = (clientX, clientY) => {
        clearDisabled();
        const stack = document.elementsFromPoint(clientX, clientY);

        for (const el of stack) {
            const item = el.closest?.('.item-roupa');
            if (!item) continue;

            const img = item.querySelector?.('img');
            const sampler = img ? getImageAlphaSampler(img) : null;

            // Só atravessa transparência quando o alpha já está pronto.
            if (!sampler || !sampler.ready) {
                return el;
            }

            if (isOpaqueAtPointer(item, clientX, clientY)) {
                return el;
            }

            // Área transparente: deixa passar pra baixo (só temporariamente até o próximo movimento).
            item.style.pointerEvents = 'none';
            disabled.push(item);
        }

        return null;
    };

    mural.addEventListener('pointermove', (e) => {
        lastRealTarget = computeRealTarget(e.clientX, e.clientY);
    }, { passive: true, capture: true });

    mural.addEventListener('pointerdown', (e) => {
        lastRealTarget = computeRealTarget(e.clientX, e.clientY);
    }, { passive: true, capture: true });

    // Redireciona clique quando o target original caiu em transparência.
    mural.addEventListener('click', (e) => {
        if (!lastRealTarget) return;
        if (lastRealTarget === e.target) return;

        e.preventDefault();
        e.stopPropagation();

        const evt = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: e.clientX,
            clientY: e.clientY,
            screenX: e.screenX,
            screenY: e.screenY,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
            button: e.button,
            buttons: e.buttons,
        });
        lastRealTarget.dispatchEvent(evt);
    }, { capture: true });
}

// Distribuição tipo "blue-noise" (Poisson-disc via Bridson).
// Ajuda a evitar "buracos" e aglomerações, sem deixar as peças 100% sobrepostas.
function gerarPontosPoisson(count, width, height, opts) {
    const {
        padding = 20,
        itemW = 170,
        itemH = 200,
        minDist = 110, // em px entre âncoras (top/left). < tamanho da imagem => ainda sobrepõe parcialmente
        k = 24, // tentativas por ponto ativo
        fallbackJitter = 0.35, // usado se não couberem pontos com minDist
    } = opts || {};

    const minX = padding;
    const minY = padding;
    const maxX = Math.max(minX, width - itemW - padding);
    const maxY = Math.max(minY, height - itemH - padding);

    const usableW = Math.max(1, maxX - minX);
    const usableH = Math.max(1, maxY - minY);

    // Grid auxiliar (células de tamanho r/√2 garantem no máximo 1 ponto por célula).
    const cellSize = minDist / Math.SQRT2;
    const gridCols = Math.ceil(usableW / cellSize);
    const gridRows = Math.ceil(usableH / cellSize);
    const grid = new Array(gridCols * gridRows).fill(null);

    const toGrid = (p) => ({
        gx: Math.floor((p.x - minX) / cellSize),
        gy: Math.floor((p.y - minY) / cellSize),
    });
    const gridIndex = (gx, gy) => gy * gridCols + gx;

    const inBounds = (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;

    const isFarEnough = (p) => {
        const { gx, gy } = toGrid(p);
        const r2 = minDist * minDist;

        for (let y = Math.max(0, gy - 2); y <= Math.min(gridRows - 1, gy + 2); y++) {
            for (let x = Math.max(0, gx - 2); x <= Math.min(gridCols - 1, gx + 2); x++) {
                const neighbor = grid[gridIndex(x, y)];
                if (!neighbor) continue;
                const dx = neighbor.x - p.x;
                const dy = neighbor.y - p.y;
                if (dx * dx + dy * dy < r2) return false;
            }
        }
        return true;
    };

    const points = [];
    const active = [];

    // Começa com um ponto aleatório.
    const first = { x: randBetween(minX, maxX), y: randBetween(minY, maxY) };
    points.push(first);
    active.push(first);
    {
        const { gx, gy } = toGrid(first);
        grid[gridIndex(gx, gy)] = first;
    }

    while (active.length && points.length < count) {
        const idx = Math.floor(Math.random() * active.length);
        const origin = active[idx];
        let found = false;

        for (let i = 0; i < k; i++) {
            // Amostra no anel [r, 2r].
            const angle = Math.random() * Math.PI * 2;
            const radius = randBetween(minDist, 2 * minDist);
            const cand = {
                x: origin.x + Math.cos(angle) * radius,
                y: origin.y + Math.sin(angle) * radius,
            };

            if (!inBounds(cand)) continue;
            if (!isFarEnough(cand)) continue;

            points.push(cand);
            active.push(cand);
            const { gx, gy } = toGrid(cand);
            grid[gridIndex(gx, gy)] = cand;
            found = true;
            break;
        }

        if (!found) {
            active.splice(idx, 1);
        }
    }

    // Se não couberam todos (mural pequeno / minDist alto), completa com grid+jitter leve
    // para manter uma cobertura razoável sem "ilhas" vazias.
    if (points.length < count) {
        const missing = count - points.length;
        const aspect = usableW / usableH;
        const cols = Math.max(1, Math.ceil(Math.sqrt(count * aspect)));
        const rows = Math.max(1, Math.ceil(count / cols));
        const cellW = usableW / cols;
        const cellH = usableH / rows;

        const cells = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) cells.push({ c, r });
        }
        shuffleInPlace(cells);

        for (let i = 0; i < missing; i++) {
            const cell = cells[(points.length + i) % cells.length];
            const cx = minX + cell.c * cellW;
            const cy = minY + cell.r * cellH;
            const jx = (Math.random() - 0.5) * cellW * fallbackJitter;
            const jy = (Math.random() - 0.5) * cellH * fallbackJitter;
            points.push({
                x: clamp(cx + cellW / 2 + jx, minX, maxX),
                y: clamp(cy + cellH / 2 + jy, minY, maxY),
            });
        }
    }

    return points.slice(0, count);
}

function gerarPontosDistribuidos(count, width, height, opts) {
    const {
        padding = 20,
        itemW = 170,
        itemH = 200,
        jitter = 0.65, // 0..1 (quanto maior, mais "solto" dentro da célula)
    } = opts || {};

    const minX = padding;
    const minY = padding;
    const maxX = Math.max(minX, width - itemW - padding);
    const maxY = Math.max(minY, height - itemH - padding);

    const usableW = Math.max(1, maxX - minX);
    const usableH = Math.max(1, maxY - minY);

    // Escolhe cols/rows baseado no aspecto do mural pra distribuir melhor.
    const aspect = usableW / usableH;
    const cols = Math.max(1, Math.ceil(Math.sqrt(count * aspect)));
    const rows = Math.max(1, Math.ceil(count / cols));

    const cellW = usableW / cols;
    const cellH = usableH / rows;

    const cells = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            cells.push({ c, r });
        }
    }
    shuffleInPlace(cells);

    const pts = [];
    for (let i = 0; i < count; i++) {
        const cell = cells[i % cells.length];
        const cx = minX + cell.c * cellW;
        const cy = minY + cell.r * cellH;

        const jx = (Math.random() - 0.5) * cellW * jitter;
        const jy = (Math.random() - 0.5) * cellH * jitter;

        const x = clamp(cx + cellW / 2 + jx, minX, maxX);
        const y = clamp(cy + cellH / 2 + jy, minY, maxY);
        pts.push({ x, y });
    }

    return pts;
}

function inicializarVitrine(qtd = 25) {
    const mural = document.getElementById('vitrine-mural');

    // Limpa o mural
    mural.innerHTML = "";

    // Sorteia os itens
    const selecionadas = [...listaRoupasS3]
        .sort(() => 0.5 - Math.random())
        .slice(0, qtd);

    const muralW = mural.clientWidth || window.innerWidth;
    const muralH = mural.clientHeight || window.innerHeight;

    // Aproximações com base no CSS (max 160px) + botão.
    // Objetivo: não ficar "grudado", mas ainda permitir alguma sobreposição.
    const ITEM_W = 170;
    const ITEM_H = 200;
    const PADDING = 20;

    // Pontos "bem distribuídos" pela tela (Poisson-disc: menos buracos/aglomerados).
    // Ajuste `minDist` para controlar o quanto espalha (menor => mais chance de sobrepor).
    const pontos = gerarPontosPoisson(selecionadas.length, muralW, muralH, {
        padding: PADDING,
        itemW: ITEM_W,
        itemH: ITEM_H,
        minDist: 115,
    });

    selecionadas.forEach((arquivo, idx) => {
        try {
            const urlFinal = new URL(arquivo, URL_BASE_S3).href;

            const container = document.createElement('div');
            container.className = 'item-roupa';

            const { x, y } = pontos[idx];
            
            container.style.left = `${Math.round(x)}px`;
            container.style.top = `${Math.round(y)}px`;

            const img = document.createElement('img');
            // Não definimos crossOrigin no <img> visível para não arriscar bloquear renderização.
            // O hit-test por alpha usa um loader separado (Image()) com crossOrigin.
            img.decoding = 'async';
            img.loading = 'eager';
            img.alt = "Roupa";
            img.src = urlFinal;
            img.onerror = () => {
                console.error("Falha ao carregar imagem:", urlFinal);
                // Mantém o item visível (você pode estilizar um fallback depois se quiser).
            };

            const btn = document.createElement('button');
            btn.className = 'btn-pegar';
            btn.textContent = 'Pegar';
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                acaoPegar(arquivo);
            });

            container.appendChild(img);
            container.appendChild(btn);

            mural.appendChild(container);

            // Pré-carrega o mapa de alpha pra melhorar o pass-through da transparência.
            // (Sem isso, os primeiros movimentos podem ainda "pegar" o item de cima.)
            const sampler = getImageAlphaSampler(img);
            sampler?.loadingPromise?.catch?.(() => {});

        } catch (err) {
            console.error("Erro ao processar URL:", err);
        }
    });
}

function acaoPegar(nome) {
    alert("Boa escolha! " + nome + " foi para o seu guarda-roupa.");
}

// Inicia com 10 roupas conforme solicitado
document.addEventListener('DOMContentLoaded', () => {
    inicializarVitrine(25);
    const mural = document.getElementById('vitrine-mural');
    instalarPassThroughTransparencia(mural);
});