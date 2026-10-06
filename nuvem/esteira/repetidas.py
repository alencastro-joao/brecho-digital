# -*- coding: utf-8 -*-
"""
Peça repetida: a foto que já virou peça do jogo, ou que já está na esteira.

A marca de pin (nuvem/lambda/esteira.py) impede o mesmo pin de entrar duas
vezes, mas não reconhece a mesma roupa chegando por outro caminho: o pin
importado antes de a marca existir, a mesma foto salva duas vezes no
Pinterest (dois pins, uma imagem), a pasta nova que repete peças da antiga.
Aqui quem decide é a imagem.

O recorte é determinístico — mesma foto, mesmo modelo, mesma prévia —, então
a comparação é pela assinatura da prévia: a forma (dHash de 256 bits, com o
recorte pousado no branco) e a cor média. A cor está ali porque o acervo tem a
mesma foto recolorida (a calça Hollister em quatro cores): pela forma elas
ficam a 12 bits uma da outra, e são peças diferentes. Medido no acervo:
repetida dá forma a 0 e cor igual; a peça nova mais parecida com alguma do
jogo ficou acima de 80.

Peça editada no jogo (girada, cortada) muda de imagem e não é reconhecida
pela prévia publicada. A peça publicada pela esteira daqui em diante guarda a
assinatura da prévia original (`assinatura` no acervo), e essa continua
valendo depois da edição.
"""

import io
import json
import time
from concurrent.futures import ThreadPoolExecutor

from botocore.exceptions import ClientError
from PIL import Image

LIMIAR = 4                   # bits de forma diferentes, de 256
LIMIAR_COR = 12              # diferença máxima num canal da cor média (0–255)
LADO = 16
CACHE = 'esteira/config/assinaturas.json'   # das peças antigas, sem assinatura no acervo
VALIDADE = 300               # s: o acervo é relido no máximo a cada 5 min

_memoria = {'quando': 0, 'acervo': []}


def assinatura(img):
    """'<dHash em 64 hex>-<cor média rrggbb>' da imagem pousada no branco."""
    rgba = img.convert('RGBA')
    fundo = Image.new('RGBA', rgba.size, (255, 255, 255, 255))
    fundo.alpha_composite(rgba)
    cinza = fundo.convert('L').resize((LADO + 1, LADO), Image.LANCZOS)
    px = list(cinza.getdata())
    bits = 0
    for y in range(LADO):
        linha = y * (LADO + 1)
        for x in range(LADO):
            bits = (bits << 1) | (px[linha + x] > px[linha + x + 1])
    # A cor média só do que é peça: o branco do fundo puxaria tudo para o claro.
    opaca = rgba.getchannel('A').point(lambda v: 255 if v >= 128 else 0)
    cor = rgba.convert('RGB').resize((64, 64)), opaca.resize((64, 64))
    pixels = [p for p, a in zip(cor[0].getdata(), cor[1].getdata()) if a] or [(255, 255, 255)]
    media = [round(sum(c[i] for c in pixels) / len(pixels)) for i in range(3)]
    return '%064x-%02x%02x%02x' % (bits, *media)


def distancia(a, b):
    """Bits de forma diferentes."""
    return bin(int(a[:64], 16) ^ int(b[:64], 16)).count('1')


def iguais(a, b):
    if not a or not b or distancia(a, b) > LIMIAR:
        return False
    ca, cb = a[65:71], b[65:71]
    if len(ca) < 6 or len(cb) < 6:
        return False
    return all(abs(int(ca[i:i + 2], 16) - int(cb[i:i + 2], 16)) <= LIMIAR_COR for i in (0, 2, 4))


def _json(s3, bucket, chave, padrao):
    try:
        return json.loads(s3.get_object(Bucket=bucket, Key=chave)['Body'].read())
    except ClientError as e:
        if e.response['Error']['Code'] in ('NoSuchKey', '404'):
            return padrao
        raise


def _do_acervo(s3, dados, site):
    """[(assinatura, peça)] do jogo. Peça sem assinatura no acervo (as de
    antes dela) é calculada da imagem publicada uma vez e fica no cache."""
    if time.time() - _memoria['quando'] < VALIDADE:
        return _memoria['acervo']
    itens = _json(s3, site, 'assets/acervo.json', {}).get('items', [])
    cache = _json(s3, dados, CACHE, {})
    faltam = [i for i in itens if not i.get('assinatura') and i['id'] not in cache and i.get('src')]

    def calcular(peca):
        try:
            corpo = s3.get_object(Bucket=site, Key=peca['src'])['Body'].read()
            return peca['id'], assinatura(Image.open(io.BytesIO(corpo)))
        except Exception as e:                   # noqa: BLE001 - uma imagem ruim não para as outras
            print('(sem assinatura para %s: %s)' % (peca['id'], e))
            return peca['id'], ''

    if faltam:
        with ThreadPoolExecutor(max_workers=8) as grupo:
            cache.update(dict(grupo.map(calcular, faltam)))
        s3.put_object(Bucket=dados, Key=CACHE, Body=json.dumps(cache).encode('utf-8'),
                      ContentType='application/json')
        print('assinaturas calculadas para %d peça(s) do acervo' % len(faltam))
    _memoria['acervo'] = [(i.get('assinatura') or cache.get(i['id']), i) for i in itens]
    _memoria['quando'] = time.time()
    return _memoria['acervo']


def _da_esteira(s3, dados, item_id):
    """[(assinatura, ficha)] das outras fotos que estão na esteira agora."""
    pag = s3.get_paginator('list_objects_v2')
    saida = []
    for pagina in pag.paginate(Bucket=dados, Prefix='esteira/', Delimiter='/'):
        for obj in pagina.get('Contents', []):
            chave = obj['Key']
            if not chave.endswith('.json') or chave == 'esteira/%s.json' % item_id:
                continue
            ficha = _json(s3, dados, chave, {})
            if isinstance(ficha, dict) and ficha.get('assinatura') and ficha.get('estado') != 'repetida':
                saida.append((ficha['assinatura'], ficha))
    return saida


def procurar(s3, dados, site, assin, item_id):
    """A peça do jogo (ou a foto da esteira) igual a esta, ou None."""
    for a, peca in _do_acervo(s3, dados, site):
        if iguais(a, assin):
            return {'onde': 'acervo', 'id': peca['id'], 'src': peca.get('src', ''),
                    'nome': peca.get('nome') or peca.get('marca') or peca['id']}
    for a, ficha in _da_esteira(s3, dados, item_id):
        if iguais(a, assin):
            return {'onde': 'esteira', 'id': ficha['id'], 'nome': ficha.get('arquivo') or ficha['id']}
    return None
