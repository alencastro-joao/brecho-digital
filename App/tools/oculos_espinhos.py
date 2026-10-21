"""Óculos de espinhos da artista recolorido para as coleções de cor →
assets/roupas/oculos-espinhos-<cor>-<VERSAO>.webp.

    python tools/oculos_espinhos.py

O desenho (oculos-espinhos/original.png, fundo branco) é verde. As cores de
cada região dele, e a cor nova em cada coleção, estão em
oculos-espinhos/cores.csv: troque um hex lá e rode de novo. Só as coleções de
CORES_NO_JOGO viram arquivo (as outras colunas do CSV ficam para comparar).
Cada pixel cai na região de cor original mais próxima e vira a cor nova dela,
mantendo a luz do traço (mesma ideia de tools/roupas_base.py).
Troque VERSAO aqui e em OCULOS_ESPINHOS.versao (js/config.js) a cada arte nova.
"""
import csv
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

AQUI = Path(__file__).resolve().parent / 'oculos-espinhos'
SAIDA = Path(__file__).resolve().parent.parent / 'assets' / 'roupas'
VERSAO = 'v1'
LARGURA = 480                  # pixels do arquivo (a peça ocupa ~150 no palco)
CORES_NO_JOGO = ['Preto', 'Verde', 'Azul', 'Vermelho', 'Rosa', 'Roxo']   # igual a OCULOS_ESPINHOS.cores


def hex_rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)


def fundo_branco(rgb):
    """O branco ligado à borda da imagem."""
    a = rgb.astype(int)
    claro = ((a.min(-1) > 215) & (np.ptp(a, -1) < 20)).astype('uint8') * 255
    m = Image.new('L', (rgb.shape[1], rgb.shape[0]))
    m.paste(Image.fromarray(claro))
    ImageDraw.floodfill(m, (0, 0), 128)
    return np.asarray(m) == 128


def main():
    rgb = np.asarray(Image.open(AQUI / 'original.png').convert('RGB')).astype(float)
    fundo = fundo_branco(rgb)
    ys, xs = np.where(~fundo)
    corte = np.s_[ys.min() - 2:ys.max() + 3, xs.min() - 2:xs.max() + 3]
    rgb, fundo = rgb[corte], fundo[corte]
    with open(AQUI / 'cores.csv', encoding='utf-8') as f:
        linhas = list(csv.DictReader(f))
    centros = np.array([hex_rgb(l['original']) for l in linhas])
    perto = ((rgb[..., None, :] - centros) ** 2).sum(-1).argmin(-1)
    # Só a luz do traço passa adiante, sem o tom verde do original.
    resto = (rgb - centros[perto]).mean(-1, keepdims=True) * 0.6
    tam = (LARGURA, round(rgb.shape[0] * LARGURA / rgb.shape[1]))
    print('proporção (h/w):', round(rgb.shape[0] / rgb.shape[1], 4))
    for velho in SAIDA.glob('oculos-espinhos-*.webp'):
        velho.unlink()
    for cor in CORES_NO_JOGO:
        alvo = np.array([hex_rgb(l[cor]) for l in linhas])
        out = np.zeros((*rgb.shape[:2], 4), 'uint8')
        out[..., :3] = np.clip(alvo[perto] + resto, 0, 255).round()
        out[..., 3] = np.where(fundo, 0, 255)
        Image.fromarray(out, 'RGBA').resize(tam, Image.LANCZOS).save(
            SAIDA / f'oculos-espinhos-{cor.lower()}-{VERSAO}.webp', 'WEBP', quality=90, method=6)


if __name__ == '__main__':
    main()
