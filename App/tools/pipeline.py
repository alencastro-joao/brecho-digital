# -*- coding: utf-8 -*-
"""
Pipeline de ativos do Brecho Digital.
Versao local e executavel do processo descrito em
"Anotacoes/upload e formatacao das imagens.txt".

Para cada PNG em ../Cloths:
  1. Le o canal alpha e ignora tudo que e invisivel.
  2. Recorta a imagem na bounding box real do objeto.
  3. Converte para WebP (mantem transparencia, pesa ~40x menos).
  4. Traca o contorno do objeto (Moore neighborhood) e simplifica os pontos
     (Douglas-Peucker).
  5. Grava tudo em assets/catalog.json: caminho da imagem otimizada + a
     "identidade geometrica" (path SVG normalizado).

O frontend aplica esse path como clip-path. Com isso o proprio navegador passa a
ignorar os pixels transparentes tambem para clique e hover, sem ler pixel a pixel.

Uso:  python tools/pipeline.py [--src ../Cloths] [--max 512] [--force]
"""

import argparse
import json
import math
import os
import sys
from collections import deque
from datetime import datetime, timezone

try:
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit("Pillow nao encontrado. Instale com:  python -m pip install pillow")

# --- Mapa de categorias (identico ao do prototipo Closet) -------------------
CATEGORIES = {
    "shirts":  ["04", "14", "10", "23", "30", "40", "38"],
    "pants":   ["03", "26", "27"],
    "shoes":   ["37", "35", "32", "33", "22", "15", "17", "18", "02"],
    "dresses": ["08", "41", "42", "43", "44", "45"],
    "coats":   ["28", "46", "47", "48", "49", "50"],
    "hats":    ["09", "01", "31", "24", "29", "51", "52", "53"],
    "bags":    ["12", "25", "19", "54", "55", "56"],
    "watches": ["13", "57", "58", "59"],
    "bracelets": ["21", "05", "06", "39"],
    "glasses": ["07", "16", "11", "34", "36", "20"],
}
ID_TO_CAT = {i: c for c, ids in CATEGORIES.items() for i in ids}

ALPHA_THRESHOLD = 24      # abaixo disso o pixel e considerado invisivel
TRACE_MAX_DIM = 200       # resolucao de trabalho do tracador (nao da imagem final)
DILATE = 2                # folga do contorno, em px da mascara reduzida
RDP_EPSILON = 1.1         # agressividade da simplificacao de pontos
MIN_BLOB_RATIO = 0.004    # descarta respingos menores que isso da area total


# --- 1. Mascara binaria a partir do alpha ----------------------------------
def build_mask(img, max_dim):
    alpha = img.getchannel("A")
    scale = min(1.0, max_dim / max(alpha.size))
    w = max(8, int(round(alpha.size[0] * scale)))
    h = max(8, int(round(alpha.size[1] * scale)))
    small = alpha.resize((w, h), Image.BILINEAR)
    binary = small.point(lambda v: 255 if v >= ALPHA_THRESHOLD else 0)
    if DILATE > 0:
        binary = binary.filter(ImageFilter.MaxFilter(1 + 2 * DILATE))
    px = binary.load()
    grid = [[1 if px[x, y] else 0 for x in range(w)] for y in range(h)]
    return grid, w, h


# --- 2. Componentes conexos (um par de botas = dois contornos) -------------
def connected_components(grid, w, h):
    seen = [[False] * w for _ in range(h)]
    comps = []
    for sy in range(h):
        for sx in range(w):
            if not grid[sy][sx] or seen[sy][sx]:
                continue
            q = deque([(sx, sy)])
            seen[sy][sx] = True
            cells = []
            while q:
                x, y = q.popleft()
                cells.append((x, y))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1),
                               (1, 1), (1, -1), (-1, 1), (-1, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and grid[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            comps.append(cells)
    comps.sort(key=len, reverse=True)
    return comps


# --- 3. Contorno (Moore neighborhood tracing) ------------------------------
NEIGHBORS = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]


def trace_contour(cells, w, h):
    cellset = set(cells)
    start = min(cells, key=lambda c: (c[1], c[0]))          # topo-esquerda
    contour = [start]
    cur = start
    backtrack = (start[0] - 1, start[1])
    guard = 0
    limit = 8 * len(cells) + 64

    while guard < limit:
        guard += 1
        bdir = (backtrack[0] - cur[0], backtrack[1] - cur[1])
        try:
            idx = NEIGHBORS.index(bdir)
        except ValueError:
            idx = 0
        found = None
        for step in range(1, 9):
            n = NEIGHBORS[(idx + step) % 8]
            cand = (cur[0] + n[0], cur[1] + n[1])
            if cand in cellset:
                found = cand
                break
            backtrack = cand
        if found is None:
            break
        if found == start and len(contour) > 2:
            break
        contour.append(found)
        cur = found
    return contour


# --- 4. Simplificacao Douglas-Peucker --------------------------------------
def rdp(points, eps):
    if len(points) < 3:
        return points
    ax, ay = points[0]
    bx, by = points[-1]
    dx, dy = bx - ax, by - ay
    norm = math.hypot(dx, dy) or 1.0
    worst, wi = 0.0, 0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
        if d > worst:
            worst, wi = d, i
    if worst > eps:
        left = rdp(points[:wi + 1], eps)
        right = rdp(points[wi:], eps)
        return left[:-1] + right
    return [points[0], points[-1]]


def to_svg_path(contours, w, h):
    """Normaliza para um espaco 0..1000 em cada eixo (casa com objectBoundingBox)."""
    out = []
    for pts in contours:
        if len(pts) < 3:
            continue
        d = []
        for i, (x, y) in enumerate(pts):
            nx = round(min(1000.0, max(0.0, (x + 0.5) / w * 1000)), 1)
            ny = round(min(1000.0, max(0.0, (y + 0.5) / h * 1000)), 1)
            d.append(("M" if i == 0 else "L") + str(nx) + " " + str(ny))
        out.append(" ".join(d) + " Z")
    return " ".join(out)


def contour_of(img):
    grid, w, h = build_mask(img, TRACE_MAX_DIM)
    comps = connected_components(grid, w, h)
    if not comps:
        return "", 0
    total = sum(len(c) for c in comps)
    contours = []
    for cells in comps[:6]:
        if len(cells) < total * MIN_BLOB_RATIO:
            continue
        raw = trace_contour(cells, w, h)
        contours.append(rdp(raw, RDP_EPSILON))
    pts = sum(len(c) for c in contours)
    return to_svg_path(contours, w, h), pts


# --- Main ------------------------------------------------------------------
def main():
    here = os.path.dirname(os.path.abspath(__file__))
    app = os.path.dirname(here)
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.join(os.path.dirname(app), "Cloths"))
    ap.add_argument("--max", type=int, default=512, help="maior lado do WebP gerado")
    ap.add_argument("--quality", type=int, default=82)
    ap.add_argument("--force", action="store_true", help="reprocessa mesmo se o webp ja existe")
    args = ap.parse_args()

    out_dir = os.path.join(app, "assets", "cloths")
    os.makedirs(out_dir, exist_ok=True)

    files = sorted(f for f in os.listdir(args.src) if f.lower().endswith(".png"))
    if not files:
        sys.exit("Nenhum PNG encontrado em " + args.src)

    items = []
    src_bytes = out_bytes = 0

    for n, fname in enumerate(files, 1):
        item_id = os.path.splitext(fname)[0]
        src_path = os.path.join(args.src, fname)
        dst_path = os.path.join(out_dir, item_id + ".webp")

        img = Image.open(src_path).convert("RGBA")
        bbox = img.getchannel("A").point(lambda v: 255 if v >= 8 else 0).getbbox()
        if bbox:
            img = img.crop(bbox)
        img.thumbnail((args.max, args.max), Image.LANCZOS)

        if args.force or not os.path.exists(dst_path):
            img.save(dst_path, "WEBP", quality=args.quality, method=6)

        path, pts = contour_of(img)
        src_bytes += os.path.getsize(src_path)
        out_bytes += os.path.getsize(dst_path)

        items.append({
            "id": item_id,
            "cat": ID_TO_CAT.get(item_id, "glasses"),
            "src": "assets/cloths/" + item_id + ".webp",
            "w": img.size[0],
            "h": img.size[1],
            "path": path,
        })
        print("[{:>2}/{}] {} -> {}.webp  {}x{}  contorno: {} pts".format(
            n, len(files), fname, item_id, img.size[0], img.size[1], pts))

    catalog = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": os.path.relpath(args.src, app).replace("\\", "/"),
        "count": len(items),
        "items": items,
    }
    cat_path = os.path.join(app, "assets", "catalog.json")
    with open(cat_path, "w", encoding="utf-8") as fh:
        json.dump(catalog, fh, ensure_ascii=False, indent=1)

    print("\ncatalogo: " + cat_path)
    print("peso: {:.1f} MB (PNG)  ->  {:.1f} MB (WebP)  = {:.0f}% menor".format(
        src_bytes / 1e6, out_bytes / 1e6, 100 - out_bytes / max(1, src_bytes) * 100))


if __name__ == "__main__":
    main()
