"""Cinto cinza da artista (fivela redonda prata) →
assets/roupas/cinto-cinza-cinza-<VERSAO>.webp.

    python tools/cinto_cinza.py

O desenho (cinto-cinza/original.png) vem em fundo verde: aqui o verde sai e a
peça é recortada. Troque VERSAO aqui e em CINTO_CINZA.versao (js/config.js) a
cada arte nova.
"""
from pathlib import Path

import numpy as np
from PIL import Image

AQUI = Path(__file__).resolve().parent / 'cinto-cinza'
SAIDA = Path(__file__).resolve().parent.parent / 'assets' / 'roupas'
VERSAO = 'v1'
LARGURA = 480


def main():
    rgb = np.asarray(Image.open(AQUI / 'original.png').convert('RGB')).astype(float)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # Quanto o verde passa do maior dos outros dois canais: fundo é > 90,
    # a peça (cinza e prata) fica perto de 0; no meio a borda vira transparência.
    verde = g - np.maximum(r, b)
    alfa = np.clip((90 - verde) / 60, 0, 1)
    ys, xs = np.where(alfa > 0)
    corte = np.s_[ys.min() - 2:ys.max() + 3, xs.min() - 2:xs.max() + 3]
    rgb, alfa = rgb[corte], alfa[corte]
    # Tira o verde que vaza na borda: o canal verde não passa dos outros dois.
    rgb[..., 1] = np.minimum(rgb[..., 1], np.maximum(rgb[..., 0], rgb[..., 2]))
    out = np.zeros((*rgb.shape[:2], 4), 'uint8')
    out[..., :3] = rgb.round()
    out[..., 3] = (alfa * 255).round()
    tam = (LARGURA, round(rgb.shape[0] * LARGURA / rgb.shape[1]))
    print('proporção (h/w):', round(rgb.shape[0] / rgb.shape[1], 4))
    Image.fromarray(out, 'RGBA').resize(tam, Image.LANCZOS).save(
        SAIDA / f'cinto-cinza-cinza-{VERSAO}.webp', 'WEBP', quality=90, method=6)


if __name__ == '__main__':
    main()
