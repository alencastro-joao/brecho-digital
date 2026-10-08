# -*- coding: utf-8 -*-
"""
A esteira de peças — o trabalhador.

O administrador solta as fotos na tela (ou no celular, ou numa pasta com
`tools/enviar.py`) e elas sobem direto para o S3, sem passar pela API:

    s3://brecho-dados-…/entrada/<id>.<ext>        a foto crua, como veio

O S3 avisa o EventBridge, que põe o aviso numa fila SQS, que chama esta
função. A fila é o que faz a esteira aguentar lote: cinquenta fotos de uma vez
viram cinquenta mensagens processadas duas a duas, com nova tentativa sozinha
se uma falhar no meio, e a que falhar três vezes vai para a fila de mortas em
vez de sumir.

Para cada foto:

  1. Endireita pela orientação EXIF (foto de celular deitada).
  2. Se ainda tem fundo, tira — o mesmo `bgbatch.recortar` da máquina do
     admin, com o BiRefNet. O modelo mora em `modelos/` no bucket de dados e
     desce para o /tmp na primeira chamada; as seguintes reaproveitam.
  3. Guarda o recorte em alta como rascunho de máster.
  4. Faz a imagem do jogo em dois tamanhos — a prévia (WebP, 512 px), que é
     a das miniaturas, e a grande (WebP, 1280 px), que a tela pede onde a
     peça aparece grande ou em tela de alta densidade — e o contorno vetorial,
     igual ao do pipeline.
     Antes de seguir, confere se a prévia é de uma peça que já está no jogo
     ou na esteira (repetidas.py). Se for, a foto para aqui como `repetida`
     — sem gastar o palpite da IA — e a API tira ela da esteira.
  5. Pede ao Claude (Bedrock) o palpite da ficha: categoria, cor, marca.
     O nome não: toda peça chega sem nome.
  6. Grava tudo em `esteira/<id>.json` com `estado: pronta`.

Daí para a frente é a tela de revisão (`js/esteira.js`) que conversa com a API
(`nuvem/lambda/esteira.py`): o admin confere, mede, e publica.
"""

import io
import json
import os
import time
import traceback
import urllib.parse
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError
from PIL import Image, ImageOps, UnidentifiedImageError

import bgbatch
import ficha_ia
import repetidas
from cor import cor_da_imagem
from pipeline import contour_of

DADOS = os.environ['BD_BUCKET_DADOS']
SITE = os.environ.get('BD_BUCKET_SITE', '')
MODELO = os.environ.get('BD_MODELO_FUNDO') or bgbatch.PADRAO
PASTA_MODELOS = os.environ.get('BGBATCH_MODELOS') or '/tmp/modelos'

MAX_ENTRADA = 3000      # foto de câmera desce para isto antes do modelo
MAX_MESTRE = 2048       # maior lado do máster guardado
MAX_PREVIA = 512        # maior lado da miniatura (= MAX_LADO em editar.js)
MAX_GRANDE = 1280       # maior lado da grande (= MAX_GRANDE em editar.js)
# 88 e não 75: com 75 a estampa fina (croco, letra, renda) virava mancha, e a
# mancha é o que mais aparece quando a tela amplia a peça.
QUALIDADE = 88

Image.MAX_IMAGE_PIXELS = 80_000_000   # 80 MP: acima disso é engano ou ataque

_s3 = boto3.client('s3')


def _agora():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


class FotoRuim(Exception):
    """Erro que não melhora tentando de novo: a foto em si não serve."""


# --- Ficha no S3 ------------------------------------------------------------
def ler_ficha(item_id):
    try:
        r = _s3.get_object(Bucket=DADOS, Key='esteira/%s.json' % item_id)
        return json.loads(r['Body'].read())
    except ClientError as e:
        if e.response['Error']['Code'] in ('NoSuchKey', '404'):
            return {'id': item_id}
        raise


def gravar_ficha(dados):
    _s3.put_object(Bucket=DADOS, Key='esteira/%s.json' % dados['id'],
                   Body=json.dumps(dados, ensure_ascii=False).encode('utf-8'),
                   ContentType='application/json; charset=utf-8')


# --- Modelo de recorte ------------------------------------------------------
def garantir_modelo():
    """O .onnx no /tmp. Vem do bucket de dados (mesma região, segundos); se
    ainda não estiver lá, vem do Hugging Face uma vez e fica no bucket para as
    próximas."""
    spec = bgbatch.MODELOS[MODELO]
    local = os.path.join(PASTA_MODELOS, spec['arquivo'])
    if os.path.exists(local):
        return
    os.makedirs(PASTA_MODELOS, exist_ok=True)
    chave = 'modelos/' + spec['arquivo']
    marca = time.time()
    try:
        _s3.download_file(DADOS, chave, local + '.parte')
        os.replace(local + '.parte', local)
        print('modelo %s do S3 em %.1fs' % (MODELO, time.time() - marca))
    except ClientError as e:
        if e.response['Error']['Code'] not in ('404', 'NoSuchKey'):
            raise
        bgbatch.baixar_modelo(MODELO, PASTA_MODELOS, quieto=True)
        _s3.upload_file(local, DADOS, chave)
        print('modelo %s do Hugging Face em %.1fs (guardado no S3)'
              % (MODELO, time.time() - marca))


# --- O trabalho -------------------------------------------------------------
def abrir_foto(chave):
    """(imagem, metadados do objeto). O `tools/enviar.py` manda o nome do
    arquivo nos metadados, já que por ele a foto não passa pela API."""
    obj = _s3.get_object(Bucket=DADOS, Key=chave)
    corpo = obj['Body'].read()
    try:
        img = Image.open(io.BytesIO(corpo))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as e:
        raise FotoRuim('não consegui abrir essa imagem (%s)' % e)
    img = ImageOps.exif_transpose(img)
    if max(img.size) > MAX_ENTRADA:
        img.thumbnail((MAX_ENTRADA, MAX_ENTRADA), Image.LANCZOS)
    return img, obj.get('Metadata') or {}


def recortar(img):
    """(recorte RGBA aparado, se o fundo foi removido aqui)."""
    if bgbatch.tem_alpha(img):
        rgba = img.convert('RGBA')
        caixa = rgba.getchannel('A').point(lambda v: 255 if v >= 10 else 0).getbbox()
        if not caixa:
            raise FotoRuim('a imagem está inteira transparente')
        return rgba.crop(caixa), False
    garantir_modelo()
    try:
        return bgbatch.recortar(img, modelo=MODELO, maior_lado=MAX_MESTRE,
                                quieto=True, baixar=False), True
    except ValueError as e:                     # "não achei objeto nenhum"
        raise FotoRuim(str(e))


def webp_de(recorte, lado):
    """(imagem reduzida a `lado`, bytes do WebP). Nunca amplia."""
    p = recorte.copy()
    p.thumbnail((lado, lado), Image.LANCZOS)
    buf = io.BytesIO()
    p.save(buf, 'WEBP', quality=QUALIDADE, method=6)
    return p, buf.getvalue()


def processar(chave):
    item_id = os.path.splitext(os.path.basename(chave))[0]
    ficha = ler_ficha(item_id)
    # iniciadoEm: se o processo morrer (memória, tempo), ninguém grava "erro";
    # é por esta hora que a API percebe que travou.
    ficha.update(estado='processando', entrada=chave, erro='', iniciadoEm=_agora(),
                 tentativas=int(ficha.get('tentativas') or 0) + 1)
    ficha.setdefault('criadoEm', _agora())
    gravar_ficha(ficha)

    marca = time.time()
    try:
        img, meta = abrir_foto(chave)
        if not ficha.get('arquivo') and meta.get('arquivo'):
            ficha.update(arquivo=meta['arquivo'], origem='pasta')
        recorte, sem_fundo = recortar(img)

        previa, webp = webp_de(recorte, MAX_PREVIA)
        assinatura = repetidas.assinatura(previa)
        try:
            igual = repetidas.procurar(_s3, DADOS, SITE, assinatura, item_id) if SITE else None
        except Exception as e:                   # noqa: BLE001 - na dúvida, a foto segue
            print('(não conferi repetida em %s: %s)' % (item_id, e))
            igual = None
        if igual:
            ficha.update(estado='repetida', repetidaDe=igual, assinatura=assinatura,
                         processadoEm=_agora())
            gravar_ficha(ficha)
            print('repetida %s: igual a %s %s' % (item_id, igual['onde'], igual['id']))
            return

        # O máster: o recorte em alta, para reprocessar um dia sem caçar a foto.
        # Fica em esteira/ e não em mestres/rascunhos/: lá ele morre em um dia
        # (regra do bucket, feita para o recorte da tela antiga), e uma foto
        # pode esperar a revisão por mais tempo que isso.
        buf = io.BytesIO()
        recorte.save(buf, 'PNG', optimize=True)
        mestre = 'esteira/%s.png' % item_id
        _s3.put_object(Bucket=DADOS, Key=mestre, Body=buf.getvalue(),
                       ContentType='image/png')

        chave_previa = 'esteira/%s.webp' % item_id
        _s3.put_object(Bucket=DADOS, Key=chave_previa, Body=webp,
                       ContentType='image/webp')
        # A grande só existe se o recorte for maior que a prévia: ampliar não
        # traz detalhe nenhum, só peso.
        chave_grande, wg, hg = '', 0, 0
        if max(recorte.size) > MAX_PREVIA:
            grande, webp_g = webp_de(recorte, MAX_GRANDE)
            chave_grande = 'esteira/%s-g.webp' % item_id
            _s3.put_object(Bucket=DADOS, Key=chave_grande, Body=webp_g,
                           ContentType='image/webp')
            wg, hg = grande.size
        caminho, _ = contour_of(previa.convert('RGBA'))
        segundos_recorte = time.time() - marca

        sugestao = ficha_ia.sugerir(webp, marcas_conhecidas())
        # A cor medida nos pixels: chão para quando a IA falha ou não diz.
        cor_medida = cor_da_imagem(previa)
    except FotoRuim as e:
        ficha.update(estado='erro', erro=str(e))
        gravar_ficha(ficha)
        print('foto recusada %s: %s' % (item_id, e))
        return

    ficha.update(
        estado='pronta',
        previa=chave_previa,
        previaG=chave_grande,
        mestre=mestre,
        w=previa.size[0], h=previa.size[1],
        wG=wg, hG=hg,
        mw=recorte.size[0], mh=recorte.size[1],
        path=caminho,
        fundoRemovido=sem_fundo,
        assinatura=assinatura,
        modelo=MODELO if sem_fundo else '',
        segundos=round(time.time() - marca, 1),
        sugestao=sugestao,
        processadoEm=_agora(),
    )
    # A ficha que o admin edita nasce do palpite. O que ele já tiver mexido
    # (pelo celular, enquanto a foto ainda processava) não é atropelado.
    proposta = {k: sugestao.get(k, '') for k in ('cat', 'cor', 'marca')}
    proposta['cor'] = proposta['cor'] or cor_medida
    ficha['ficha'] = {**proposta, **{k: v for k, v in (ficha.get('ficha') or {}).items() if v}}
    gravar_ficha(ficha)
    print('pronta %s: %dx%d, fundo %s, recorte %.1fs, total %.1fs, ia=%s'
          % (item_id, recorte.size[0], recorte.size[1],
             'removido' if sem_fundo else 'já vinha', segundos_recorte,
             ficha['segundos'], json.dumps(sugestao, ensure_ascii=False)))


_marcas = {'quando': 0, 'lista': []}


def marcas_conhecidas():
    """As marcas que já estão no acervo, para a IA escrever do mesmo jeito
    ("Nike", não "NIKE" numa peça e "nike" na outra)."""
    if time.time() - _marcas['quando'] < 300 or not SITE:
        return _marcas['lista']
    try:
        r = _s3.get_object(Bucket=SITE, Key='assets/acervo.json')
        itens = json.loads(r['Body'].read()).get('items', [])
        contagem = {}
        for i in itens:
            m = (i.get('marca') or '').strip()
            if m:
                contagem[m] = contagem.get(m, 0) + 1
        _marcas['lista'] = sorted(contagem, key=lambda m: -contagem[m])[:60]
    except Exception as e:                       # noqa: BLE001 - só melhora o palpite
        print('(sem lista de marcas: %s)' % e)
    _marcas['quando'] = time.time()
    return _marcas['lista']


# --- Entrada da Lambda ------------------------------------------------------
def chaves_do_evento(registro):
    """A mensagem da fila carrega o evento do EventBridge ("Object Created")."""
    corpo = json.loads(registro['body'])
    detalhe = corpo.get('detail') or {}
    chave = (detalhe.get('object') or {}).get('key')
    if chave:
        yield urllib.parse.unquote_plus(chave)


def handler(evento, _contexto):
    falhas = []
    for registro in evento.get('Records', []):
        try:
            for chave in chaves_do_evento(registro):
                if chave.startswith('entrada/'):
                    processar(chave)
        except Exception as e:                   # noqa: BLE001
            # Erro passageiro (Bedrock ocupado, S3 piscou): a mensagem volta
            # para a fila e é tentada de novo. Na terceira vai para a de mortas.
            traceback.print_exc()
            try:
                for chave in chaves_do_evento(registro):
                    item_id = os.path.splitext(os.path.basename(chave))[0]
                    ficha = ler_ficha(item_id)
                    ficha.update(estado='erro', erro='falha no processamento: %s' % e)
                    gravar_ficha(ficha)
            except Exception:                    # noqa: BLE001
                pass
            falhas.append({'itemIdentifier': registro['messageId']})
    return {'batchItemFailures': falhas}
