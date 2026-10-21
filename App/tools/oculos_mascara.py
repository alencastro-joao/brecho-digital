"""Óculos máscara preto da artista (lente cinza, sem haste) →
assets/roupas/oculos-mascara-preto-<VERSAO>.webp.

    python tools/oculos_mascara.py

O desenho (oculos-mascara/original.png, fundo branco) já é preto: aqui só sai
o fundo e a peça é recortada. A borda que o desenho mistura com o branco vira
transparência, para não ficar um contorno claro em volta da armação.
Troque VERSAO aqui e em OCULOS_MASCARA.versao (js/config.js) a cada arte nova.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from oculos_espinhos import fundo_branco

AQUI = Path(__file__).resolve().parent / 'oculos-mascara'
SAIDA = Path(__file__).resolve().parent.parent / 'assets' / 'roupas'
VERSAO = 'v1'
LARGURA = 480
ARMACAO = 18                   # o preto do traço, onde a borda some no fundo


def main():
    rgb = np.asarray(Image.open(AQUI / 'original.png').convert('RGB')).astype(float)
    fundo = fundo_branco(rgb)
    ys, xs = np.where(~fundo)
    corte = np.s_[ys.min() - 2:ys.max() + 3, xs.min() - 2:xs.max() + 3]
    rgb, fundo = rgb[corte], fundo[corte]
    # Os pixels da peça encostados no fundo: a opacidade vem do escuro deles.
    fundo_img = Image.fromarray((fundo * 255).astype('uint8'))
    beira = (np.asarray(fundo_img.filter(ImageFilter.MaxFilter(5))) > 0) & ~fundo
    escuro = (255 - rgb.mean(-1)) / (255 - ARMACAO)
    alfa = np.where(fundo, 0, np.where(beira, np.clip(escuro, 0, 1), 1))
    out = np.zeros((*rgb.shape[:2], 4), 'uint8')
    out[..., :3] = np.where(beira[..., None], ARMACAO, rgb).round()
    out[..., 3] = (alfa * 255).round()
    tam = (LARGURA, round(rgb.shape[0] * LARGURA / rgb.shape[1]))
    print('proporção (h/w):', round(rgb.shape[0] / rgb.shape[1], 4))
    Image.fromarray(out, 'RGBA').resize(tam, Image.LANCZOS).save(
        SAIDA / f'oculos-mascara-preto-{VERSAO}.webp', 'WEBP', quality=90, method=6)


if __name__ == '__main__':
    main()
