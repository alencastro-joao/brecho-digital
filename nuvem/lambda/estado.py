# -*- coding: utf-8 -*-
"""
O save do jogo na nuvem — `GET`/`PUT /api/estado`.

É o buraco que o README do protótipo aponta: o inventário, os looks, as
colagens e o XP moram no `localStorage`, então a mesma conta em outro
computador abre um guarda-roupa vazio. `js/db.js` já foi escrito para isto —
nenhuma tela chama `localStorage`, todas passam por `carregar()`/`salvar()`.

**Por que S3 e não DynamoDB.** O registro do save parece um item de DynamoDB, e
o comentário no topo de `db.js` diz isso. Mas um save de partida inteira carrega
as miniaturas dos looks e das colagens como data URL, e chega perto da cota do
navegador — megabytes. O item do DynamoDB para em **400 KB**. Então o save vai
para o S3 (um objeto por conta) e o DynamoDB fica com o que é pequeno e
precisa de condição atômica: conta, sessão, unicidade. De quebra sai mais
barato: 500 MB de save no S3 custam US$ 0,01 por mês.

**O teto de 6 MB.** A resposta e o corpo de uma Lambda com Function URL param
em 6 MB. Um save com todas as miniaturas pode passar disso. Quando passa, as
miniaturas são descartadas antes de subir (`_enxugar`): elas são cache — o
`render.js` desenha de novo a partir da lista de peças —, e o próprio
`salvar()` do `db.js` já as descarta quando a cota do navegador estoura. O que
é dado de verdade nunca é jogado fora.
"""

import gzip
import io
import json
import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

BUCKET = os.environ.get('BD_BUCKET_DADOS') or ''
_s3 = boto3.client('s3')

# Folga confortável abaixo do teto de 6 MB da Lambda: o JSON ainda vai ganhar o
# envelope da resposta, e o limite conta o payload inteiro.
TETO = 4 * 1024 * 1024


def _chave(uid):
    return 'estado/%s.json.gz' % uid


def _enxugar(estado):
    """Tira as miniaturas. Só é chamado quando o save não cabe do jeito que é."""
    for look in estado.get('looks') or []:
        look.pop('thumb', None)
    for board in estado.get('boards') or []:
        board.pop('thumb', None)
    for post in estado.get('feed') or []:
        post.pop('thumb', None)
    return estado


def ler(uid):
    """O save da conta, ou None se ela nunca gravou na nuvem."""
    try:
        r = _s3.get_object(Bucket=BUCKET, Key=_chave(uid))
    except ClientError as e:
        if e.response['Error']['Code'] in ('NoSuchKey', '404'):
            return None
        raise
    bruto = gzip.decompress(r['Body'].read()).decode('utf-8')
    return {
        'estado': json.loads(bruto),
        'atualizadoEm': (r.get('Metadata') or {}).get('atualizado-em')
                        or r['LastModified'].isoformat(timespec='seconds'),
    }


def gravar(uid, estado):
    """Grava o save e devolve quando foi. Último a escrever ganha: duas abas da
    mesma pessoa não merecem uma máquina de resolver conflito."""
    quando = datetime.now(timezone.utc).isoformat(timespec='seconds')

    corpo = json.dumps(estado, ensure_ascii=False, separators=(',', ':'))
    enxuto = False
    if len(corpo.encode('utf-8')) > TETO:
        corpo = json.dumps(_enxugar(estado), ensure_ascii=False,
                           separators=(',', ':'))
        enxuto = True

    buffer = io.BytesIO()
    # mtime=0: o mesmo save gera o mesmo objeto byte a byte, e o ETag do S3
    # passa a servir para saber se algo mudou de verdade.
    with gzip.GzipFile(fileobj=buffer, mode='wb', compresslevel=6, mtime=0) as gz:
        gz.write(corpo.encode('utf-8'))

    _s3.put_object(Bucket=BUCKET, Key=_chave(uid), Body=buffer.getvalue(),
                   ContentType='application/json', ContentEncoding='gzip',
                   Metadata={'atualizado-em': quando})
    return {'atualizadoEm': quando, 'enxuto': enxuto,
            'bytes': buffer.getbuffer().nbytes}


def apagar(uid):
    _s3.delete_object(Bucket=BUCKET, Key=_chave(uid))
