"""Camisas e croppeds das seleções (temas de config.ESTILOS): a camiseta da
artista (tools/roupas_base.py, a branca) repintada por regiões — manga, gola,
faixa, o X da bandeira —, mantendo a textura de lápis e o contorno dela.
Sai em assets/roupas/<id>-<VERSAO>.webp, com a mesma caixa da camiseta de base.

    python tools/camisas_selecoes.py

`base` é a camiseta longa (camisa) ou a camiseta curta (cropped); ver
CAMISAS_SELECOES em js/config.js. Opções que o João não escolheu ficaram na
pasta do projeto (selecoes/).
"""
import colorsys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageDraw

ROUPAS = Path(__file__).resolve().parent.parent / 'assets' / 'roupas'
VERSAO = 'v1'                 # igual a CAMISAS_SELECOES[].versao (js/config.js)
CORPO_BRANCO = np.array((240, 236, 229), float)

def hexrgb(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)
def luz(rgb, d):
    h, l, s = colorsys.rgb_to_hls(*(rgb / 255)); l = min(max(l + d, 0), 1)
    return np.array(colorsys.hls_to_rgb(h, l, s)) * 255
def sombra(rgb):
    escura = colorsys.rgb_to_hls(*(rgb / 255))[1] < .5
    return luz(rgb, .10 if escura else -.16)

# Tons de poeira, como as cores das coleções (tools/roupas_base.py).
AM, VD, AZ, VM, VP, PT, BR = (hexrgb(h) for h in
    ('#e2c565', '#6f9a72', '#6f8db8', '#b75a54', '#5e8062', '#2f2c2a', '#f0ece5'))

rng = np.random.default_rng(7)   # trocado por peça em main(), para sair sempre igual
def ruido(h, w, s=2.2):
    r = np.array(Image.fromarray((rng.random((h, w)) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(s))).astype(float)
    return (r - r.mean()) / (r.std() + 1e-6)

def carregar(base):
    im = np.array(Image.open(ROUPAS / f'{base}-branco-v3.webp').convert('RGBA')).astype(float)
    h, w = im.shape[:2]
    rgb, alfa = im[..., :3], im[..., 3]
    dentro = np.array(Image.fromarray((alfa > 10).astype(np.uint8) * 255).filter(ImageFilter.MinFilter(13))) > 0
    contorno = (alfa > 10) & ~dentro
    dist = np.sqrt(((rgb - CORPO_BRANCO) ** 2).sum(-1))
    estrela = (dist > 40) & dentro
    estrela = np.array(Image.fromarray(estrela.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(3))) > 0
    corpo = (alfa > 10) & ~contorno & ~estrela
    lapis = (rgb - rgb[corpo].mean(0)).mean(-1)
    lapis[estrela] = 0
    ys, xs = np.nonzero(alfa > 10)
    # Tronco: a largura nas linhas de baixo; o que passa dela é manga.
    larg = [(alfa[y] > 10).sum() for y in range(h)]
    ref = larg[int(h * .85)]
    axila = max(y for y in range(int(h * .8)) if larg[y] > ref * 1.25)
    tx0, tx1 = np.nonzero(alfa[axila + 12] > 10)[0][[0, -1]]
    topo = np.array([np.nonzero(alfa[:, x] > 10)[0][0] if (alfa[:, x] > 10).any() else h for x in range(w)])
    return dict(im=im, h=h, w=w, alfa=alfa, contorno=contorno, estrela=estrela,
                lapis=lapis, tx0=tx0 + 4, tx1=tx1 - 4, axila=axila, topo=topo, cx=w / 2)

def centro_estrela(b):
    ys, xs = np.nonzero(b['estrela'])
    return xs.mean(), ys.mean()

def simbolo_mascaras(b, tipo):
    """Símbolos simplificados no lugar da estrela: lista de máscaras, de baixo pra cima."""
    w, h = b['w'], b['h']; cx, cy = centro_estrela(b)
    S = 4
    E = 1.45   # tamanho
    def nova(): im = Image.new('L', (w * S, h * S), 0); return im, ImageDraw.Draw(im)
    def pronta(im): return np.array(im) > 128
    P = lambda pts: [((cx + (x - cx) * E) * S, (cy + (y - cy) * E) * S) for x, y in pts]
    out = []
    if tipo == 'losango':
        im, d = nova(); d.polygon(P([(cx - 26, cy), (cx, cy - 17), (cx + 26, cy), (cx, cy + 17)]), fill=255); out.append(pronta(im))
        im, d = nova(); r = 9 * E; d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], fill=255); out.append(pronta(im))
    elif tipo == 'escudo':
        pts = [(cx - 14, cy - 17), (cx + 14, cy - 17), (cx + 14, cy + 2), (cx + 9, cy + 12), (cx, cy + 18), (cx - 9, cy + 12), (cx - 14, cy + 2)]
        im, d = nova(); d.polygon(P(pts), fill=255); out.append(pronta(im))
        k = .55; pin = [(cx + (x - cx) * k, cy - 1 + (y - cy) * k) for x, y in pts]
        im, d = nova(); d.polygon(P(pin), fill=255); out.append(pronta(im))
    elif tipo == 'esfera':
        im, d = nova(); r = 17 * E
        d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], outline=255, width=round(5 * E * S))
        d.line([((cx - r) * S, (cy + 4) * S), ((cx + r) * S, (cy - 4) * S)], fill=255, width=round(5 * E * S))
        out.append(pronta(im))
    return out

def pintar(b, fundo, regioes=(), gola=None, estrela=None, extra=None, simbolo=None):
    """regioes: lista de (máscara(yy, xx, b) -> bool, cor)."""
    h, w = b['h'], b['w']
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    # Borda de lápis: desloca a coordenada com ruído antes de testar a região.
    yy2, xx2 = yy + ruido(h, w, 3) * .7, xx + ruido(h, w, 3) * .7
    rid = np.zeros((h, w), int)
    cores = [fundo]
    for i, (f, cor) in enumerate(regioes, 1):
        rid[f(yy2, xx2, b)] = i; cores.append(cor)
    if gola is not None:
        g = (yy2 - b['topo'][np.clip(xx2.round().astype(int), 0, w - 1)] < 22) & (np.abs(xx2 - b['cx']) < 64) \
            & (b['topo'][np.clip(xx2.round().astype(int), 0, w - 1)] > b['topo'].min() + 4)
        rid[g] = len(cores); cores.append(gola)
    if extra is not None:
        m = extra[0](b); rid[m] = len(cores); cores.append(extra[1])
    if estrela is not None:
        rid[b['estrela']] = len(cores); cores.append(estrela)
    if simbolo is not None:
        tipo, cs = simbolo
        S = 4
        iy = np.clip((yy2 * S).round().astype(int), 0, h * S - 1)
        ix = np.clip((xx2 * S).round().astype(int), 0, w * S - 1)
        for m, c in zip(simbolo_mascaras(b, tipo), cs):
            rid[m[iy, ix] & (b['alfa'] > 10)] = len(cores); cores.append(c)
    cores = np.array(cores)
    cor = cores[rid]
    # Costura: onde a região muda, a sombra da cor de cima.
    borda = np.zeros((h, w), bool)
    borda[1:] |= rid[1:] != rid[:-1]; borda[:, 1:] |= rid[:, 1:] != rid[:, :-1]
    borda = np.array(Image.fromarray(borda.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(3))) > 0
    borda &= ~b['estrela']
    sombras = np.array([sombra(c) for c in cores])
    out = cor + b['lapis'][..., None] * .9
    out[borda] = sombras[rid][borda] * .5 + out[borda] * .5
    out[b['contorno']] = sombras[rid][b['contorno']] + b['lapis'][b['contorno']][:, None] * .3
    res = np.zeros_like(b['im']); res[..., :3] = out; res[..., 3] = b['alfa']
    return Image.fromarray(np.clip(res, 0, 255).astype(np.uint8))

# Regiões
manga = lambda yy, xx, b: ((xx < b['tx0']) | (xx > b['tx1'])) & (yy < b['axila'] + 20)
faixa = lambda y0, y1: (lambda yy, xx, b: (yy >= y0) & (yy < y1))
direita = lambda yy, xx, b: xx > b['cx']
diag1 = lambda d: (lambda yy, xx, b: np.abs((xx - b['cx']) - (yy - b['h'] * .5) * b['w'] / b['h']) < d)
diag2 = lambda d: (lambda yy, xx, b: np.abs((xx - b['cx']) + (yy - b['h'] * .5) * b['w'] / b['h']) < d)
lados = lambda yy, xx, b: np.abs(xx - b['cx']) * b['h'] > np.abs(yy - b['h'] * .5) * b['w']


# Os escolhidos pelo João (28/10/2026). id -> (camiseta de base, pintura).
PECAS = {
    'camisa-jamaica-bandeira': ('camiseta-longa', dict(fundo=VD, regioes=[(lados, PT), (diag1(16), AM), (diag2(16), AM)])),
    'camisa-jamaica-preta': ('camiseta-longa', dict(fundo=PT, regioes=[(faixa(178, 192), VD), (faixa(192, 206), AM), (faixa(206, 220), VD)], gola=AM)),
    'cropped-jamaica-bandeira': ('camiseta', dict(fundo=VD, regioes=[(lados, PT), (diag1(16), AM), (diag2(16), AM)])),
}


def main():
    global rng
    bases = {}
    for i, (id_, (base, pintura)) in enumerate(PECAS.items()):
        rng = np.random.default_rng(7 + i)
        b = bases.setdefault(base, carregar(base))
        pintar(b, **pintura).save(ROUPAS / f'{id_}-{VERSAO}.webp', 'WEBP', quality=88, method=6)
        print(id_)


if __name__ == '__main__':
    main()
