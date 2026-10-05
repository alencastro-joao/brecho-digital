# -*- coding: utf-8 -*-
"""
Contorno vetorial das pecas do Brecho Digital.
Versao local do processo descrito em
"Anotacoes/upload e formatacao das imagens.txt", usada pela esteira e pela
Lambda do acervo (contour_of):
  1. Le o canal alpha e ignora tudo que e invisivel.
  2. Traca o contorno do objeto (Moore neighborhood) e simplifica os pontos
     (Douglas-Peucker).
  3. Devolve o path SVG normalizado — a "identidade geometrica" da peca.

O frontend aplica esse path como clip-path. Com isso o proprio navegador passa a
ignorar os pixels transparentes tambem para clique e hover, sem ler pixel a pixel.
"""

import math
import sys
from collections import deque

try:
    from PIL import Image, ImageFilter
except ImportError:
    sys.exit("Pillow nao encontrado. Instale com:  python -m pip install pillow")

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
