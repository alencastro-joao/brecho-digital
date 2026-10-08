# -*- coding: utf-8 -*-
"""
Traz o acervo da nuvem para o disco.

O acervo tem um escritor só: a Lambda, quando uma peça é publicada pela
esteira. Este script é o caminho de volta, para o jogo local (servidor.py
sem --nuvem) enxergar as peças novas:

    assets/acervo.json        substituído pelo da nuvem
    assets/cloths/<id>.webp   baixa só o que falta (o nome é o id: não muda)
    assets/cloths/<id>-g.webp a grande, idem

Lê pelo CloudFront, que é público — não precisa de credencial da AWS.

Uso:  python tools/sincronizar.py
"""

import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

SITE = (os.environ.get('BRECHO_NUVEM') or 'https://dufkck3bmeh9v.cloudfront.net').rstrip('/')
APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACERVO = os.path.join(APP, 'assets', 'acervo.json')


def baixar(caminho):
    with urllib.request.urlopen(SITE + '/' + caminho, timeout=60) as r:
        return r.read()


def main():
    try:
        bruto = baixar('assets/acervo.json')
        nuvem = json.loads(bruto)
    except Exception as e:                       # noqa: BLE001
        sys.exit('não consegui ler o acervo da nuvem: %s' % e)

    try:
        with open(ACERVO, encoding='utf-8') as fh:
            local = {i['id'] for i in json.load(fh).get('items', [])}
    except (OSError, ValueError):
        local = set()

    # As duas imagens de cada peça: a miniatura e a grande (peça antiga pode
    # não ter a grande).
    faltam = [c for i in nuvem['items'] for c in (i.get('src'), i.get('srcG'))
              if c and not os.path.exists(os.path.join(APP, c))]

    def pegar(src):
        destino = os.path.join(APP, src)
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        with open(destino + '.parte', 'wb') as fh:
            fh.write(baixar(src))
        os.replace(destino + '.parte', destino)
        return src

    with ThreadPoolExecutor(8) as pool:
        for src in pool.map(pegar, faltam):
            print('  + ' + src)

    tmp = ACERVO + '.tmp'
    with open(tmp, 'wb') as fh:
        fh.write(bruto)
    os.replace(tmp, ACERVO)

    ids = {i['id'] for i in nuvem['items']}
    print('acervo: %d peças (%d novas, %d saíram) · %d imagens baixadas'
          % (len(ids), len(ids - local), len(local - ids), len(faltam)))


if __name__ == '__main__':
    main()
