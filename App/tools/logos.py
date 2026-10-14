"""Põe os logos das marcas no mesmo molde e grava em assets/marcas/<id>.webp.

    python tools/logos.py puma=caminho/puma.png adidas=caminho/adidas.svg.png ...

O molde: quadrado de 256 px, logo em preto sobre branco (qualquer que seja a
cor original), recortado das bordas vazias e centralizado ocupando no máximo 62% do lado — assim ele cabe inteiro no
disco redondo do emblema e todas as marcas ficam do mesmo tamanho. Depois de
gravar, ponha o id em MARCAS_COM_LOGO (js/config.js).
"""
import sys
from pathlib import Path

from PIL import Image, ImageOps

LADO = 256
OCUPA = 0.62
COR = (26, 26, 26)
FUNDO = (255, 255, 255)
SAIDA = Path(__file__).resolve().parent.parent / 'assets' / 'marcas'


def mascara(origem):
    """Onde tem logo: a transparência do PNG, ou o escuro de uma imagem sem ela."""
    img = Image.open(origem).convert('RGBA')
    alfa = img.getchannel('A')
    if alfa.getextrema()[0] < 250:
        return alfa
    return ImageOps.invert(img.convert('L'))


def molde(origem):
    m = mascara(origem)
    m = m.crop(m.point(lambda v: 255 if v > 24 else 0).getbbox() or (0, 0, *m.size))
    escala = LADO * OCUPA / max(m.size)
    m = m.resize((max(1, round(m.width * escala)), max(1, round(m.height * escala))), Image.LANCZOS)
    tela = Image.new('L', (LADO, LADO), 0)
    tela.paste(m, ((LADO - m.width) // 2, (LADO - m.height) // 2))
    # Logo preto no branco, seja qual for a cor original.
    return Image.composite(Image.new('RGB', tela.size, COR), Image.new('RGB', tela.size, FUNDO), tela)


def main(pares):
    SAIDA.mkdir(parents=True, exist_ok=True)
    for par in pares:
        ident, _, origem = par.partition('=')
        destino = SAIDA / f'{ident}.webp'
        molde(origem).save(destino, 'WEBP', quality=90)
        print(destino)


if __name__ == '__main__':
    main(sys.argv[1:])
