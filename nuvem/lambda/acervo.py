# -*- coding: utf-8 -*-
"""
O acervo do administrador na nuvem — `POST /api/pecas`, `PUT /api/pecas/<id>`
e `DELETE /api/pecas/<id>`.

Mesma lógica de `App/tools/servidor.py`, com o disco trocado pelo S3:

    assets/cloths/<id>.webp   bucket do site (público via CloudFront)
    assets/cloths/<id>-g.webp a mesma em tamanho grande (`srcG` no acervo),
                              para onde a peça aparece grande ou em tela de
                              alta densidade; peça antiga pode não ter
    assets/acervo.json        bucket do site — a lista que o jogo lê
    mestres/<id>.png          bucket de dados (privado: é o arquivo de trabalho
                              do admin, não é para ninguém baixar)

Duas coisas que o disco dava de graça e aqui precisam de cuidado:

* **Ler-modificar-gravar o `acervo.json`.** No disco era `os.replace`, atômico.
  No S3 a gravação vai com `IfMatch` no ETag que foi lido: se alguém gravou no
  meio, o S3 recusa com 412 e a operação recomeça da leitura. Sem isso, duas
  peças subidas ao mesmo tempo perderiam uma.

* **Cache do CloudFront.** O `acervo.json` sai com `no-cache`, então o
  CloudFront revalida sempre (barato, e a peça nova aparece na hora). As
  imagens saem imutáveis por um ano, porque o nome do arquivo é o id da peça —
  só que editar a peça regrava o mesmo nome, e aí é preciso invalidar. É a
  única invalidação que este código pede, e o admin faz poucas por mês (as mil
  primeiras de cada mês são de graça).
"""

import io
import json
import os
import re
import base64
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

BUCKET_SITE = os.environ.get('BD_BUCKET_SITE') or ''
BUCKET_DADOS = os.environ.get('BD_BUCKET_DADOS') or ''
DISTRIBUICAO = os.environ.get('BD_DISTRIBUICAO') or ''

_s3 = boto3.client('s3')

ACERVO = 'assets/acervo.json'
CATS = {'shoes', 'pants', 'shorts', 'skirts', 'dresses', 'shirts', 'coats',
        'cropped', 'watches', 'bracelets', 'necklaces', 'glasses', 'hats', 'bags'}
# Categorias de antes desta lista — espelho de CATEGORIAS_ANTIGAS em
# App/js/config.js. O acervo.json e fichas da esteira ainda trazem estas; quem
# grava passa por `categoria()` e a peça sai com a chave de agora.
CATS_ANTIGAS = {'tops': 'shirts', 'acc': 'glasses', 'rings': 'bracelets'}


def categoria(cat):
    return CATS_ANTIGAS.get(cat, cat)


RARIDADES = {'common', 'uncommon', 'rare', 'epic', 'legendary'}
# Medida padrão de cada categoria no molde 600×1200 — espelho do `anchor` de
# CATEGORIAS em App/js/config.js. Vale para peça publicada sem ser medida.
ANCORAS = {
    'shoes': {'x': 300, 'y': 1096, 'w': 248}, 'pants': {'x': 300, 'y': 796, 'w': 236},
    'shorts': {'x': 300, 'y': 652, 'w': 240}, 'skirts': {'x': 300, 'y': 676, 'w': 250},
    'dresses': {'x': 300, 'y': 486, 'w': 272}, 'shirts': {'x': 300, 'y': 358, 'w': 250},
    'coats': {'x': 300, 'y': 436, 'w': 310}, 'cropped': {'x': 300, 'y': 336, 'w': 228},
    'watches': {'x': 172, 'y': 652, 'w': 72}, 'bracelets': {'x': 428, 'y': 660, 'w': 62},
    'necklaces': {'x': 300, 'y': 300, 'w': 120}, 'glasses': {'x': 300, 'y': 116, 'w': 124},
    'hats': {'x': 300, 'y': 84, 'w': 176}, 'bags': {'x': 440, 'y': 646, 'w': 152},
}
ID_OK = re.compile(r'^[a-z0-9_-]{1,40}$')
TOKEN_OK = re.compile(r'^[a-f0-9]{16}$')


def _agora():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


# --- acervo.json ----------------------------------------------------------
def ler_acervo():
    """(dados, etag). ETag None quando o arquivo ainda não existe."""
    try:
        r = _s3.get_object(Bucket=BUCKET_SITE, Key=ACERVO)
    except ClientError as e:
        if e.response['Error']['Code'] in ('NoSuchKey', '404'):
            return {'generatedAt': None, 'count': 0, 'items': []}, None
        raise
    try:
        dados = json.loads(r['Body'].read().decode('utf-8'))
    except ValueError:
        dados = None
    if not isinstance((dados or {}).get('items'), list):
        dados = {'generatedAt': None, 'count': 0, 'items': []}
    return dados, r['ETag']


def gravar_acervo(dados, etag):
    """Grava só se ninguém mexeu desde a leitura. False = tente de novo."""
    dados['generatedAt'] = _agora()
    dados['count'] = len(dados['items'])
    corpo = json.dumps(dados, ensure_ascii=False, indent=1).encode('utf-8')
    condicao = {'IfMatch': etag} if etag else {'IfNoneMatch': '*'}
    try:
        _s3.put_object(Bucket=BUCKET_SITE, Key=ACERVO, Body=corpo,
                       ContentType='application/json; charset=utf-8',
                       CacheControl='no-cache, must-revalidate', **condicao)
    except ClientError as e:
        if e.response['Error']['Code'] in ('PreconditionFailed', 'ConditionalRequestConflict'):
            return False
        raise
    return True


# --- Imagens --------------------------------------------------------------
def salvar_imagem(item_id, data_url, sufixo=''):
    cabeca, _, corpo = (data_url or '').partition(',')
    if not corpo or not cabeca.startswith('data:image/'):
        raise ValueError('imagem inválida')
    ext = 'webp' if 'webp' in cabeca else 'png'
    binario = base64.b64decode(corpo)
    chave = 'assets/cloths/%s%s.%s' % (item_id, sufixo, ext)
    _s3.put_object(Bucket=BUCKET_SITE, Key=chave, Body=binario,
                   ContentType='image/' + ext,
                   CacheControl='public, max-age=31536000, immutable')
    return chave, len(binario)


def contorno(chave):
    """O contorno vetorial, igual ao do pipeline. Sem Pillow a peça entra sem
    ele: o hit-test por canal alpha (alpha.js) cobre o caso."""
    try:
        from PIL import Image
        from pipeline import contour_of
        r = _s3.get_object(Bucket=BUCKET_SITE, Key=chave)
        with Image.open(io.BytesIO(r['Body'].read())) as img:
            path, _pontos = contour_of(img.convert('RGBA'))
        return path
    except Exception as e:                       # noqa: BLE001 - é opcional
        print('(sem contorno: %s)' % e)
        return ''


def promover_mestre(token, item_id):
    """O rascunho do recorte passa a ser o máster da peça, com o nome dela."""
    token = str(token or '').strip().lower()
    if not TOKEN_OK.match(token) or not BUCKET_DADOS:
        return ''
    origem = 'mestres/rascunhos/%s.png' % token
    destino = 'mestres/%s.png' % item_id
    try:
        _s3.copy_object(Bucket=BUCKET_DADOS, Key=destino,
                        CopySource={'Bucket': BUCKET_DADOS, 'Key': origem})
        _s3.delete_object(Bucket=BUCKET_DADOS, Key=origem)
    except ClientError:
        return ''
    return destino


def invalidar(caminhos):
    """Tira do cache do CloudFront o que foi regravado com o mesmo nome."""
    if not DISTRIBUICAO or not caminhos:
        return
    try:
        boto3.client('cloudfront').create_invalidation(
            DistributionId=DISTRIBUICAO,
            InvalidationBatch={
                'Paths': {'Quantity': len(caminhos), 'Items': list(caminhos)},
                'CallerReference': 'acervo-%s' % datetime.now(timezone.utc).timestamp(),
            })
    except ClientError as e:
        print('não consegui invalidar o cache: %s' % e)


# --- Peças ----------------------------------------------------------------
def nova_peca(corpo):
    validar(corpo)
    cat = corpo['cat']

    item_id = str(corpo.get('id') or '').strip().lower()
    if not ID_OK.match(item_id):
        raise ValueError('id inválido')

    if any(i['id'] == item_id for i in ler_acervo()[0]['items']):
        raise ValueError('já existe peça com esse id')

    src, peso = salvar_imagem(item_id, corpo.get('src', ''))
    item = ficha_da_peca(item_id, corpo, src, contorno(src))
    mestre = promover_mestre(corpo.get('mestre'), item_id)
    if mestre:
        item['mestre'] = mestre
    anexar(item)
    print('peça gravada: %s (%s) %.0f KB' % (item_id, cat, peso / 1024))
    return item


def ficha_da_peca(item_id, corpo, src, path):
    """O item do acervo.json, a partir da ficha que veio da tela."""
    ancora = corpo.get('ancora') or {}
    return {
        'id': item_id,
        'cat': corpo['cat'],
        'src': src,
        'w': int(corpo.get('w') or 1),
        'h': int(corpo.get('h') or 1),
        'path': path,
        'nome': str(corpo.get('nome') or '').strip()[:60],
        'marca': str(corpo.get('marca') or '').strip()[:40],
        'cor': str(corpo.get('cor') or '').strip()[:24],
        'raridade': corpo.get('raridade', 'common'),
        'ancora': {k: round(float(ancora.get(k, 0)), 1) for k in ('x', 'y', 'w')},
        'criadoEm': _agora(),
    }


def validar(corpo):
    if 'cat' in corpo:
        corpo['cat'] = categoria(corpo['cat'])
    if corpo.get('cat') not in CATS:
        raise ValueError('categoria desconhecida')
    if corpo.get('raridade', 'common') not in RARIDADES:
        raise ValueError('raridade desconhecida')


def anexar(item):
    """Põe a peça no acervo.json. Só a lista pode precisar de nova tentativa:
    a imagem já subiu antes de chegar aqui."""
    for _ in range(5):
        acervo, etag = ler_acervo()
        if any(i['id'] == item['id'] for i in acervo['items']):
            raise ValueError('já existe peça com esse id')
        acervo['items'].append(item)
        if gravar_acervo(acervo, etag):
            return item
    raise RuntimeError('o acervo está sendo escrito por outra aba; tente de novo')


def gerar_id(ficha):
    """Id estável e legível: 'jaqueta-corta-vento-mg2k9x1a'. O sufixo é o
    relógio em base 36 mais sorte, para um lote publicado no mesmo segundo."""
    import secrets as _sorte
    import unicodedata
    base = ficha.get('nome') or ficha.get('marca') or ficha.get('cat') or 'peca'
    base = unicodedata.normalize('NFD', base).encode('ascii', 'ignore').decode()
    base = re.sub(r'[^a-z0-9]+', '-', base.lower()).strip('-')[:24] or 'peca'
    agora = int(datetime.now(timezone.utc).timestamp() * 1000)
    sufixo = ''
    while agora:
        agora, r = divmod(agora, 36)
        sufixo = '0123456789abcdefghijklmnopqrstuvwxyz'[r] + sufixo
    return '%s-%s%s' % (base, sufixo, _sorte.token_hex(1))


def editar_peca(item_id, corpo):
    """O id não muda — é ele que amarra a peça ao inventário de quem já a tem."""
    item_id = str(item_id or '').strip().lower()
    if not ID_OK.match(item_id):
        raise ValueError('id inválido')

    trocada = None
    for _ in range(5):
        acervo, etag = ler_acervo()
        item = next((i for i in acervo['items'] if i['id'] == item_id), None)
        if item is None:
            raise ValueError('essa peça não está no acervo do administrador '
                             '(só dá para editar o que foi subido por aqui)')

        if 'cat' in corpo:
            if categoria(corpo['cat']) not in CATS:
                raise ValueError('categoria desconhecida')
            item['cat'] = categoria(corpo['cat'])
        if 'raridade' in corpo:
            if corpo['raridade'] not in RARIDADES:
                raise ValueError('raridade desconhecida')
            item['raridade'] = corpo['raridade']

        for campo, limite in (('nome', 60), ('marca', 40), ('cor', 24)):
            if campo in corpo:
                item[campo] = str(corpo.get(campo) or '').strip()[:limite]

        if corpo.get('ancora'):
            ancora = corpo['ancora']
            item['ancora'] = {k: round(float(ancora.get(k, 0)), 1) for k in ('x', 'y', 'w')}

        # A imagem sobe uma vez só; o que ela muda na ficha vale em toda
        # tentativa, porque cada tentativa relê o acervo do zero.
        src = corpo.get('src') or ''
        if src.startswith('data:image/') and trocada is None:
            antigo, antigo_g = item.get('src', ''), item.get('srcG', '')
            novo, peso = salvar_imagem(item_id, src)
            imagem = {
                'src': novo,
                'w': int(corpo.get('w') or item.get('w') or 1),
                'h': int(corpo.get('h') or item.get('h') or 1),
                'path': contorno(novo),
            }
            mestre = promover_mestre(corpo.get('mestre'), item_id)
            if mestre:
                imagem['mestre'] = mestre
            # A grande acompanha a pequena. Se a tela não mandou a grande
            # (aba aberta antes dela existir), a antiga sai: ela mostraria a
            # peça de antes de girar ou cortar.
            novo_g = ''
            if str(corpo.get('srcG') or '').startswith('data:image/'):
                novo_g, _ = salvar_imagem(item_id, corpo['srcG'], '-g')
                imagem.update(srcG=novo_g, wG=int(corpo.get('wG') or 0))
            # Troca de formato (png <-> webp) deixa o arquivo antigo órfão.
            for velho, atual in ((antigo, novo), (antigo_g, novo_g)):
                if velho and velho != atual:
                    try:
                        _s3.delete_object(Bucket=BUCKET_SITE, Key=velho)
                    except ClientError:
                        pass
            trocada = [c for c in (novo, novo_g, antigo_g) if c]
            print('imagem trocada: %s %.0f KB%s' % (item_id, peso / 1024,
                                                   ' (com a grande)' if novo_g else ''))
        if trocada:
            item.pop('srcG', None)
            item.pop('wG', None)
            item.update(imagem)

        item['editadoEm'] = _agora()
        if gravar_acervo(acervo, etag):
            # A imagem foi regravada com o mesmo nome: o cache tem a antiga.
            if trocada:
                invalidar(['/' + c for c in dict.fromkeys(trocada)])
            print('peça editada: %s (%s)' % (item_id, item['cat']))
            return item
    raise RuntimeError('o acervo está sendo escrito por outra aba; tente de novo')


# Quantos ids apagados o acervo.json lembra. É por essa lista que cada conta
# tira a peça do próprio guarda-roupa ao abrir o jogo; uma conta que ficar mais
# que isso sem entrar só mantém a peça como órfã, que as telas já ignoram.
MAX_REMOVIDAS = 500


def apagar_peca(item_id):
    """Some do acervo, da vitrine e do guarda-roupa de quem a tinha; a imagem e
    o máster vão junto. Não tem volta."""
    item_id = str(item_id or '').strip().lower()
    if not ID_OK.match(item_id):
        raise ValueError('id inválido')

    for _ in range(5):
        acervo, etag = ler_acervo()
        item = next((i for i in acervo['items'] if i['id'] == item_id), None)
        if item is None:
            raise ValueError('essa peça não está no acervo do administrador '
                             '(só dá para apagar o que foi subido por aqui)')
        acervo['items'] = [i for i in acervo['items'] if i['id'] != item_id]
        removidas = [r for r in acervo.get('removidas') or [] if r != item_id]
        acervo['removidas'] = (removidas + [item_id])[-MAX_REMOVIDAS:]
        if gravar_acervo(acervo, etag):
            break
    else:
        raise RuntimeError('o acervo está sendo escrito por outra aba; tente de novo')

    # Os arquivos só depois da lista: se algo falhar aqui, a peça já saiu do
    # jogo e sobra no máximo um arquivo órfão no bucket.
    imagens = [c for c in (item.get('src'), item.get('srcG'))
               if (c or '').startswith('assets/cloths/')]
    for chave in imagens:
        try:
            _s3.delete_object(Bucket=BUCKET_SITE, Key=chave)
        except ClientError as e:
            print('imagem não apagada: %s' % e)
    invalidar(['/' + c for c in imagens])
    mestre = item.get('mestre') or ''
    if mestre.startswith('mestres/') and BUCKET_DADOS:
        try:
            _s3.delete_object(Bucket=BUCKET_DADOS, Key=mestre)
        except ClientError as e:
            print('máster não apagado: %s' % e)
    print('peça apagada: %s (%s)' % (item_id, item.get('cat')))
    return {'id': item_id}
