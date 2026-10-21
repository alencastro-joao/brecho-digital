"""Três roupas base desenhadas (tênis, camiseta, calça) recoloridas para cada
coleção de cor → assets/roupas/<base>-<cor>.webp.

    python tools/roupas_base.py tenis=tenis.png camiseta=camiseta.png calca=calca.png

Os PNG são da artista: tela 2048×2048, transparente, com a peça já na posição
dela no corpo. Cada um vira recorte na caixa da peça; as cores do desenho
(corpo, contorno, detalhe) são achadas pelas mais comuns e trocadas pela cor da
coleção, mantendo a textura de lápis (a diferença para a cor-base fica).
A caixa no palco 600×1200 sai impressa para colar em ROUPAS_BASE (js/config.js).
"""
import colorsys
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SAIDA = Path(__file__).resolve().parent.parent / 'assets' / 'roupas'
# Mesma conta do corpo (tools/corpo.py): escala, e o chão (sola) em y=1147 e o
# meio em x=300, medidos no desenho de 2048 (sola em 1866, meio em 1004,5).
K, DX, DY = 0.65125, 300 - 0.65125 * 1004.5, 1147 - 0.65125 * 1866
ESCALA = 0.75                  # pixels do arquivo por pixel do desenho

# Tons suaves (poeira) das cores das coleções: o hex vivo da paleta do jogo
# ficava berrante em cima do desenho, então a peça usa uma versão mais calma.
CORES = {
    'preto': '#2f2c2a', 'branco': '#f0ece5', 'cinza': '#a9a49b', 'bege': '#d8c8ab',
    'marrom': '#7b5d45', 'vermelho': '#b9645c', 'rosa': '#dba7b5', 'laranja': '#d9a073',
    'amarelo': '#dfc983', 'verde': '#7f9c80', 'azul': '#7592b6', 'roxo': '#917fa9',
}

# Papéis de cada desenho: cor de origem (RGB), e como ela vira na coleção.
# 'corpo' é a cor da coleção; os outros são ela mais clara/escura.
PAPEIS = {
    'tenis': [((40, 56, 56), 'corpo'), ((24, 24, 40), 'sombra'), ((88, 88, 88), 'sola'),
              ((216, 216, 232), 'cadarco')],
    'camiseta': [((248, 248, 232), 'corpo'), ((232, 200, 184), 'sombra'),
                 ((56, 120, 184), 'detalhe')],
    'calca': [((104, 136, 152), 'corpo'), ((56, 120, 184), 'detalhe'),
              ((168, 200, 216), 'luz')],
}


def hex_rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)


def luz(rgb, d):
    """Clareia (d > 0) ou escurece (d < 0) mantendo o tom."""
    h, l, s = colorsys.rgb_to_hls(*(rgb / 255))
    l = min(max(l + d, 0), 1)
    return np.array(colorsys.hls_to_rgb(h, l, s)) * 255


def alvo(papel, cor):
    escura = colorsys.rgb_to_hls(*(cor / 255))[1] < 0.5
    return {
        'corpo': cor,
        'sombra': luz(cor, 0.08 if escura else -0.14),
        'sola': luz(cor, 0.14 if escura else -0.10),
        'cadarco': luz(cor, 0.38 if escura else -0.34),
        'detalhe': luz(cor, 0.26 if escura else -0.22),
        'luz': luz(cor, 0.10 if escura else 0.08),
    }[papel]


def recolorir(rgba, base, cor):
    rgb = rgba[..., :3].astype(float)
    centros = np.array([c for c, _ in PAPEIS[base]], float)
    dist = ((rgb[:, :, None, :] - centros[None, None]) ** 2).sum(-1)
    perto = dist.argmin(-1)
    saida = rgb.copy()
    for i, (centro, papel) in enumerate(PAPEIS[base]):
        m = perto == i
        saida[m] = alvo(papel, cor) + (rgb[m] - centro) * 0.6
    # Contorno padrão: a borda do desenho (6 px) sempre na sombra da cor, senão
    # o branco do desenho (calça) aparece como halo em volta da peça.
    dentro = np.asarray(Image.fromarray(rgba[..., 3]).filter(ImageFilter.MinFilter(13))) > 0
    borda = (rgba[..., 3] > 0) & ~dentro
    sombra = alvo('sombra', cor)
    saida[borda] = sombra + (rgb[borda].mean(-1, keepdims=True) - rgb[borda].mean()) * 0.15
    out = rgba.copy()
    out[..., :3] = np.clip(saida, 0, 255).round().astype('uint8')
    return out


def main(args):
    SAIDA.mkdir(parents=True, exist_ok=True)
    for arg in args:
        base, caminho = arg.split('=')
        rgba = np.asarray(Image.open(caminho).convert('RGBA'))
        x0, y0, x1, y1 = Image.fromarray(rgba[..., 3]).getbbox()
        x0, y0, x1, y1 = x0 - 3, y0 - 3, x1 + 3, y1 + 3
        corte = rgba[y0:y1, x0:x1]
        tam = (round((x1 - x0) * ESCALA), round((y1 - y0) * ESCALA))
        caixa = [round(x0 * K + DX, 1), round(y0 * K + DY, 1),
                 round((x1 - x0) * K, 1), round((y1 - y0) * K, 1)]
        print(base, caixa)
        for nome, hx in CORES.items():
            img = Image.fromarray(recolorir(corte, base, hex_rgb(hx)), 'RGBA')
            img.resize(tam, Image.LANCZOS).save(
                SAIDA / f'{base}-{nome}.webp', 'WEBP', quality=88, method=6)


if __name__ == '__main__':
    main(sys.argv[1:])
