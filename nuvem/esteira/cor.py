# -*- coding: utf-8 -*-
"""
A cor da peça medida nos pixels, sem IA.

É a mesma conta de `corDaImagem` (App/js/editar.js) e `corDoPixel`
(App/js/config.js): cada pixel opaco vota na cor da paleta mais próxima, os
coloridos ganham mesmo em minoria, e duas cores fortes e distantes viram
"Estampado". Mudou lá, muda aqui.

Serve de chão para o palpite da ficha: se o Bedrock recusar ou não disser a
cor, a peça ainda chega na tela de revisão com a cor preenchida.
"""

import numpy as np

PALETA = {
    'Preto': '#1c1a18', 'Branco': '#f7f5f1', 'Cinza': '#9b958c',
    'Bege': '#ddcbab', 'Marrom': '#6b4a2f', 'Vermelho': '#c8342f',
    'Rosa': '#e78fae', 'Laranja': '#e2813a', 'Amarelo': '#e8c24a',
    'Verde': '#4f8f5c', 'Azul': '#3c6fb4', 'Roxo': '#7d5bb0',
}
CROMATICAS = ['Bege', 'Marrom', 'Vermelho', 'Rosa', 'Laranja', 'Amarelo',
              'Verde', 'Azul', 'Roxo']
PESO_L, PESO_C = 3, 4


def _lab(rgb):
    """sRGB (…, 3) em 0–255 → Lab D65 (…, 3)."""
    v = rgb.astype(np.float64) / 255
    v = np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)
    R, G, B = v[..., 0], v[..., 1], v[..., 2]
    x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
    y = R * 0.2126 + G * 0.7152 + B * 0.0722
    z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
    f = lambda t: np.where(t > 0.008856, np.cbrt(t), t * 7.787 + 16 / 116)  # noqa: E731
    fx, fy, fz = f(x), f(y), f(z)
    return np.stack([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)], axis=-1)


def _hex_lab(h):
    n = int(h[1:], 16)
    return _lab(np.array([(n >> 16) & 255, (n >> 8) & 255, n & 255]))


LAB = {nome: _hex_lab(h) for nome, h in PALETA.items()}


def _distancia(a, b):
    """Mesma distância de `distanciaLab`: o tom vale inteiro, a saturação um
    quarto e a claridade um terço. `a` pode ser (N, 3); `b` é um Lab só."""
    dL = (a[..., 0] - b[0]) / PESO_L
    ca = np.hypot(a[..., 1], a[..., 2])
    cb = np.hypot(b[1], b[2])
    dC = (ca - cb) / PESO_C
    da, db = a[..., 1] - b[1], a[..., 2] - b[2]
    dT = np.maximum(0, da * da + db * db - (ca - cb) ** 2)
    return np.sqrt(dL * dL + dC * dC + dT)


def cor_da_imagem(img):
    """Nome da cor (da paleta do jogo) de uma imagem RGBA do PIL, ou ''."""
    w, h = img.size
    passo = max(1, round(((w * h) / 24000) ** 0.5))
    px = np.asarray(img.convert('RGBA'))[::passo, ::passo].reshape(-1, 4)
    px = px[px[:, 3] >= 200]
    if len(px) < 40:
        return ''

    lab = _lab(px[:, :3])
    croma = np.hypot(lab[:, 1], lab[:, 2])
    colorida = croma >= 7 + lab[:, 0] * 0.05

    if colorida.sum() >= len(px) * 0.25:
        dist = np.stack([_distancia(lab[colorida], LAB[c]) for c in CROMATICAS])
        nomes = [CROMATICAS[i] for i in dist.argmin(axis=0)]
    else:
        L = lab[~colorida, 0]
        nomes = np.where(L < 30, 'Preto', np.where(L < 75, 'Cinza', 'Branco')).tolist()
    if not nomes:
        return ''

    votos = {}
    for n in nomes:
        votos[n] = votos.get(n, 0) + 1
    ranque = sorted(votos.items(), key=lambda kv: -kv[1])
    total = len(nomes)
    nome, contagem = ranque[0]
    if (colorida.sum() >= len(px) * 0.25 and len(ranque) > 1
            and contagem / total < 0.5 and ranque[1][1] / total > 0.25
            and float(_distancia(LAB[nome], LAB[ranque[1][0]])) > 25):
        return 'Estampado'
    return nome
