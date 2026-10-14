"""Põe os logos das marcas no mesmo molde e grava em assets/marcas/<id>.webp.

    python tools/logos.py puma=caminho/puma.png adidas=caminho/adidas.svg.png ...

O molde: quadrado de 256 px com o fundo do próprio logo (branco se for
transparente), o logo recortado das bordas vazias e centralizado ocupando no máximo 62% do lado — assim ele cabe inteiro no
disco redondo do emblema e todas as marcas ficam do mesmo tamanho. Depois de
gravar, ponha o id em MARCAS_COM_LOGO (js/config.js).
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops

LADO = 256
OCUPA = 0.62
SAIDA = Path(__file__).resolve().parent.parent / 'assets' / 'marcas'


def no_branco(img):
    img = img.convert('RGBA')
    fundo = Image.new('RGBA', img.size, (255, 255, 255, 255))
    return Image.alpha_composite(fundo, img).convert('RGB')


def recortar(img):
    # Corta o que for (quase) igual ao canto: fundo branco, preto ou de cor.
    canto = Image.new('RGB', img.size, img.getpixel((0, 0)))
    dif = ImageChops.difference(img, canto).convert('L').point(lambda v: 255 if v > 24 else 0)
    caixa = dif.getbbox()
    return img.crop(caixa) if caixa else img


def molde(origem):
    img = no_branco(Image.open(origem))
    fundo = img.getpixel((0, 0))
    img = recortar(img)
    escala = LADO * OCUPA / max(img.size)
    img = img.resize((max(1, round(img.width * escala)), max(1, round(img.height * escala))), Image.LANCZOS)
    tela = Image.new('RGB', (LADO, LADO), fundo)
    tela.paste(img, ((LADO - img.width) // 2, (LADO - img.height) // 2))
    return tela


def main(pares):
    SAIDA.mkdir(parents=True, exist_ok=True)
    for par in pares:
        ident, _, origem = par.partition('=')
        destino = SAIDA / f'{ident}.webp'
        molde(origem).save(destino, 'WEBP', quality=90)
        print(destino)


if __name__ == '__main__':
    main(sys.argv[1:])
