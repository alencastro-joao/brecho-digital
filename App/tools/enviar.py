# -*- coding: utf-8 -*-
"""
Manda fotos de uma pasta para a esteira de peças.

É a mesma esteira do esteira.html, entrando por outra porta: a foto vai
direto para `entrada/` no bucket de dados, a fila chama o trabalhador, e a
peça aparece na tela de revisão com a ficha já palpitada. Serve para o lote
grande (a pasta da sessão de fotos) e para quem fotografa com a câmera e
descarrega no computador.

Usa as credenciais da AWS desta máquina (as do `aws configure`), não a conta
do jogo: quem tem acesso ao bucket já é o administrador.

    python tools/enviar.py ../Cloths/brutas           manda e sai
    python tools/enviar.py ../Cloths/brutas --vigiar  fica de olho na pasta

O que foi enviado vai para a subpasta `enviadas/`, então rodar de novo (ou
deixar vigiando) nunca manda a mesma foto duas vezes.

Dependência: python -m pip install boto3
"""

import argparse
import os
import secrets
import shutil
import sys
import time

try:
    import boto3
except ImportError:
    sys.exit('boto3 nao encontrado. Instale com:  python -m pip install boto3')

DADOS = os.environ.get('BD_BUCKET_DADOS') or 'brecho-dados-108826053014'
TIPOS = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'}
EXT = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}
MAX_FOTO = 40 * 1024 * 1024


def novo_id():
    """O mesmo formato de id da API (nuvem/lambda/esteira.py)."""
    return 'e%x%s' % (int(time.time()), secrets.token_hex(3))


def enviar_pasta(s3, pasta):
    feitas = 0
    enviadas = os.path.join(pasta, 'enviadas')
    for nome in sorted(os.listdir(pasta)):
        caminho = os.path.join(pasta, nome)
        tipo = TIPOS.get(os.path.splitext(nome)[1].lower())
        if not tipo or not os.path.isfile(caminho):
            continue
        if os.path.getsize(caminho) > MAX_FOTO:
            print('  pulada (passa de 40 MB): ' + nome)
            continue
        # Arquivo ainda sendo copiado para a pasta: espera a próxima volta.
        if time.time() - os.path.getmtime(caminho) < 2:
            continue

        item_id = novo_id()
        s3.upload_file(caminho, DADOS, 'entrada/%s.%s' % (item_id, EXT[tipo]),
                       ExtraArgs={'ContentType': tipo, 'Metadata': {'arquivo': nome[:120]}})
        os.makedirs(enviadas, exist_ok=True)
        shutil.move(caminho, os.path.join(enviadas, nome))
        feitas += 1
        print('  -> %s  (%s)' % (nome, item_id))
    return feitas


def main():
    ap = argparse.ArgumentParser(description='Manda as fotos de uma pasta para a esteira.')
    ap.add_argument('pasta')
    ap.add_argument('--vigiar', action='store_true', help='fica de olho na pasta')
    args = ap.parse_args()
    if not os.path.isdir(args.pasta):
        sys.exit('pasta nao encontrada: ' + args.pasta)

    s3 = boto3.client('s3')
    total = enviar_pasta(s3, args.pasta)
    if not args.vigiar:
        print('%d foto(s) na esteira. Revise em esteira.html.' % total)
        return
    print('vigiando %s (Ctrl+C para parar)' % os.path.abspath(args.pasta))
    try:
        while True:
            time.sleep(3)
            enviar_pasta(s3, args.pasta)
    except KeyboardInterrupt:
        print()


if __name__ == '__main__':
    main()
