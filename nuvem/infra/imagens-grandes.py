# -*- coding: utf-8 -*-
"""
Dá a imagem grande (`srcG`) às peças que já estavam no acervo.

    python nuvem/infra/imagens-grandes.py            faz
    python nuvem/infra/imagens-grandes.py --ver      só diz o que faria

A esteira passou a gravar cada peça em dois tamanhos: a miniatura de 512 px
(`src`) e a grande de 1280 px (`srcG`). As peças de antes só têm a de 460 px,
que a tela esticava até borrar. Quem tem máster (`mestres/<id>.png`, o recorte
em alta guardado na publicação) ganha a grande a partir dele — sem subir foto
nenhuma de novo. Quem não tem fica como está, e a lista sai no fim.

A miniatura não é refeita: ela é imutável no cache por um ano, e trocar o
conteúdo debaixo do mesmo nome deixaria cada navegador com uma versão.

Pode rodar quantas vezes quiser: peça que já tem a grande é pulada.
"""

import argparse
import io
import os
import sys

os.environ.setdefault('BD_BUCKET_SITE', 'brecho-site-108826053014')
os.environ.setdefault('BD_BUCKET_DADOS', 'brecho-dados-108826053014')

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, '..', 'lambda'))

from PIL import Image  # noqa: E402

import acervo  # noqa: E402

# Os mesmos de nuvem/esteira/trabalhador.py (importá-lo traria o modelo de
# recorte junto).
MAX_PREVIA = 512
MAX_GRANDE = 1280
QUALIDADE = 88

SITE = os.environ['BD_BUCKET_SITE']
DADOS = os.environ['BD_BUCKET_DADOS']
s3 = acervo._s3


def chaves_do_mestre(item, existentes):
    """Onde o máster dessa peça está de fato. As peças mais antigas guardam o
    caminho do disco (`assets/mestres/<id>.png`), mas o `publicar.sh` sobe a
    pasta para `mestres/`; e algumas nem anotaram o máster que existe."""
    candidatas = []
    if item.get('mestre'):
        candidatas += [item['mestre'], item['mestre'].replace('assets/', '', 1)]
    candidatas.append('mestres/%s.png' % item['id'])
    return next((c for c in candidatas if c in existentes), None)


def no_branco(img, lado=48):
    rgba = img.convert('RGBA').resize((lado, lado), Image.LANCZOS)
    fundo = Image.new('RGBA', rgba.size, (255, 255, 255, 255))
    fundo.alpha_composite(rgba)
    return list(fundo.convert('L').getdata())


def grande_de(item, chave):
    """(bytes do WebP, largura) a partir do máster, ou o motivo de não fazer.

    O máster é o recorte da publicação. Se a peça foi girada ou cortada no
    editor depois disso, ele mostra outra coisa que a miniatura de agora — e a
    grande tem de ser a mesma peça, só com mais pixel. Daí a conferência.
    """
    corpo = s3.get_object(Bucket=DADOS, Key=chave)['Body'].read()
    atual = s3.get_object(Bucket=SITE, Key=item['src'].split('?')[0])['Body'].read()
    with Image.open(io.BytesIO(corpo)) as img, Image.open(io.BytesIO(atual)) as mini:
        img = img.convert('RGBA')
        if max(img.size) <= max(mini.size):
            return 'máster não é maior que a miniatura'
        prop_m, prop_a = img.size[0] / img.size[1], mini.size[0] / mini.size[1]
        if abs(prop_m / prop_a - 1) > 0.03:
            return 'máster com outra proporção (peça editada depois?)'
        a, b = no_branco(img), no_branco(mini)
        diferenca = sum(abs(x - y) for x, y in zip(a, b)) / len(a)
        if diferenca > 12:
            return 'máster diferente da miniatura (%.0f)' % diferenca
        img.thumbnail((MAX_GRANDE, MAX_GRANDE), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, 'WEBP', quality=QUALIDADE, method=6)
        return buf.getvalue(), img.size[0]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[1])
    ap.add_argument('--ver', action='store_true', help='só confere, não grava nada')
    args = ap.parse_args()

    existentes = set()
    for pagina in s3.get_paginator('list_objects_v2').paginate(Bucket=DADOS, Prefix='mestres/'):
        existentes.update(o['Key'] for o in pagina.get('Contents', []))

    dados, _ = acervo.ler_acervo()
    itens = dados['items']
    faltam = [i for i in itens if not i.get('srcG')]
    alvos = [(i, chaves_do_mestre(i, existentes)) for i in faltam]
    com_mestre = [(i, c) for i, c in alvos if c]
    sem_mestre = [i for i, c in alvos if not c]
    print('%d peças · %d já têm a grande · %d com máster · %d sem máster'
          % (len(itens), len(itens) - len(faltam), len(com_mestre), len(sem_mestre)))

    feitas, puladas = {}, []
    for n, (item, chave) in enumerate(com_mestre, 1):
        rotulo = '  [%d/%d] %s' % (n, len(com_mestre), item['id'])
        try:
            pronta = grande_de(item, chave)
        except Exception as e:                   # noqa: BLE001
            puladas.append(item['id'])
            print('%s  ERRO: %s' % (rotulo, e))
            continue
        if isinstance(pronta, str):
            puladas.append(item['id'])
            print('%s  pulada: %s' % (rotulo, pronta))
            continue
        webp, largura = pronta
        chave_g = 'assets/cloths/%s-g.webp' % item['id']
        if not args.ver:
            s3.put_object(Bucket=SITE, Key=chave_g, Body=webp, ContentType='image/webp',
                          CacheControl='public, max-age=31536000, immutable')
        feitas[item['id']] = {'srcG': chave_g, 'wG': largura}
        print('%s  %d px  %.0f KB' % (rotulo, largura, len(webp) / 1024))

    print('%d com a grande, %d puladas, %d sem máster'
          % (len(feitas), len(puladas), len(sem_mestre)))
    for i in sem_mestre:
        print('  sem máster, continua só com a miniatura: %s' % i['id'])
    if args.ver:
        return
    if not feitas:
        print('nada para gravar no acervo')
        return

    # As imagens já subiram; só a lista pode precisar de nova tentativa, se a
    # esteira publicar uma peça bem no meio.
    for _ in range(5):
        dados, etag = acervo.ler_acervo()
        for item in dados['items']:
            item.update(feitas.get(item['id'], {}))
        if acervo.gravar_acervo(dados, etag):
            break
    else:
        sys.exit('o acervo mudou cinco vezes seguidas; rode de novo')
    print('acervo gravado: %d peças com a grande' % len(feitas))


if __name__ == '__main__':
    main()
