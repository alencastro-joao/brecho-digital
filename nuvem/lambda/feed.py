# -*- coding: utf-8 -*-
"""
O feed compartilhado: o que uma conta publica, as outras veem — sobre DynamoDB.

Até aqui cada conta guardava as próprias publicações no save dela (`state.feed`,
no navegador e em `estado/<uid>.json.gz`). Funcionava para quem publicou e para
mais ninguém: o amigo abria o feed e não via nada, e vice-versa. Este módulo
tira as publicações do save e põe num lugar que todo mundo lê.

    GET    /api/feed[?autor=<id>]              os posts, mais novos primeiro
    POST   /api/feed                           publica { chave, tipo, nome, thumb, pecas, origem }
    DELETE /api/feed/<id>                      o dono apaga
    POST   /api/feed/<id>/curtir               { curte }
    POST   /api/feed/<id>/comentarios          { texto }
    DELETE /api/feed/<id>/comentarios/<cid>    quem comentou (ou o dono do post) apaga

O desenho, na mesma tabela das contas (nenhum índice novo):

    POST#<id>   id, autor, tipo ('look' | 'board'), nome, criado_em,
                thumb        caminho da miniatura no site (assets/posts/...)
                pecas        lista dos ids de peça que aparecem no post
                origem       { lookId } ou { boardId } — o editor de onde veio
                curtidas     conjunto (SS) de quem curtiu
                comentarios  lista de { id, autor, texto, em }

* **A miniatura vai para o bucket do site**, em `assets/posts/`, e não para o
  item: o item do DynamoDB para em 400 KB, e servir a imagem pelo CloudFront é
  de graça e rápido. O nome leva um pedaço do hash do conteúdo, então pode ir
  imutável por um ano — republicar o mesmo look com outra cara gera outro nome.

* **Publicar é idempotente.** O id do post sai de (autor, chave), e a chave é o
  look ou a colagem de origem. Publicar duas vezes o mesmo look — clique duplo,
  rede que caiu no meio, ou a migração dos posts antigos rodando em dois
  aparelhos — devolve o post que já existe, em vez de criar outro.

* **Curtida é conjunto**, como seguir: idempotente e sem contador para
  dessincronizar. O número que a tela mostra é o tamanho do conjunto.

* **A listagem é uma varredura (`Scan`)**, como a busca de pessoas: a tabela é
  minúscula e o papel da Lambda já pode varrer. Quando o feed crescer, o
  caminho é um item de linha do tempo por conta (ou um índice por data), e só
  `listar()` muda.
"""

import base64
import hashlib
import os
import re
from datetime import datetime, timedelta, timezone

import boto3
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

from contas import ErroDeConta, TABELA, _dynamo, _des, _pegar, agora, iso
from pessoas import ID_OK, VALOR_OK, _cartoes

BUCKET_SITE = os.environ.get('BD_BUCKET_SITE') or ''
_s3 = boto3.client('s3')
_ser = TypeSerializer()

ID_POST = re.compile(r'^p-[0-9a-f]{16}$')
ID_COMENTARIO = re.compile(r'^c-[0-9a-f]{10}$')
CHAVE_OK = re.compile(r'^[\w:.\-]{1,64}$')
TIPOS = ('look', 'board')
NOME_MAX = 60
TEXTO_MAX = 140
PECAS_MAX = 40
COMENTARIOS_MAX = 300
LISTA_MAX = 120
THUMB_MAX = 900 * 1024          # bytes da imagem, já decodificada
TIPOS_IMAGEM = {
    'image/webp': ('webp', lambda b: b[:4] == b'RIFF' and b[8:12] == b'WEBP'),
    'image/jpeg': ('jpg', lambda b: b[:3] == b'\xff\xd8\xff'),
    'image/png': ('png', lambda b: b[:8] == b'\x89PNG\r\n\x1a\n'),
}
DATA_URL = re.compile(r'^data:(image/[a-z]+);base64,([A-Za-z0-9+/=]+)$')
ETERNO = 'public, max-age=31536000, immutable'


def _item(bruto):
    return {k: _des.deserialize(v) for k, v in bruto.items()}


# --- Validação ------------------------------------------------------------
def _texto(valor, maximo):
    return ' '.join(str(valor or '').split())[:maximo]


def _pecas(bruto):
    if not isinstance(bruto, list):
        return []
    vistas = []
    for p in bruto:
        if isinstance(p, str) and VALOR_OK.match(p) and p not in vistas:
            vistas.append(p)
        if len(vistas) >= PECAS_MAX:
            break
    return vistas


def _origem(bruto, tipo):
    """O look ou a colagem de onde o post saiu — só serve ao dono (o botão
    "editar"), então é guardado curto e validado como qualquer id."""
    if not isinstance(bruto, dict):
        return {}
    campo = 'boardId' if tipo == 'board' else 'lookId'
    valor = bruto.get(campo)
    return {campo: valor} if isinstance(valor, str) and VALOR_OK.match(valor) else {}


def _imagem(data_url):
    """Data URL → (bytes, extensão, content-type). Confere os bytes mágicos:
    o cabeçalho do data URL é só o que o navegador diz que é."""
    m = DATA_URL.match(str(data_url or ''))
    if not m or m.group(1) not in TIPOS_IMAGEM:
        raise ErroDeConta('Miniatura inválida.')
    try:
        binario = base64.b64decode(m.group(2), validate=True)
    except ValueError:
        raise ErroDeConta('Miniatura inválida.')
    extensao, confere = TIPOS_IMAGEM[m.group(1)]
    if not binario or len(binario) > THUMB_MAX or not confere(binario):
        raise ErroDeConta('Miniatura inválida ou grande demais.')
    return binario, extensao, m.group(1)


def _quando(bruto):
    """A data de um post antigo que está sendo migrado do save. Só vale se for
    passado (até um ano): ninguém fura a fila do feed datando o post no futuro."""
    agora_ = agora()
    try:
        dt = datetime.fromisoformat(str(bruto).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return iso(agora_)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if dt > agora_ or dt < agora_ - timedelta(days=365):
        return iso(agora_)
    return iso(dt)


# --- O post como a tela vê ------------------------------------------------
def _publico(item, eu_id):
    curtidas = item.get('curtidas') or set()
    post = {
        'id': item['id'],
        'autor': item['autor'],
        'tipo': item['tipo'],
        'nome': item['nome'],
        'thumb': item.get('thumb') or '',
        'criadoEm': item['criado_em'],
        'pecas': list(item.get('pecas') or []),
        'curtidas': len(curtidas),
        'curtido': eu_id in curtidas,
        'comentarios': [dict(c) for c in item.get('comentarios') or []],
        'real': True,
    }
    if item['autor'] == eu_id:
        post.update(item.get('origem') or {})
    return post


def _com_autores(itens, eu_id):
    """Os posts e os cartões de todo mundo que aparece neles — quem postou e
    quem comentou —, para a tela desenhar o retrato sem mais uma ida ao
    servidor por pessoa."""
    ids = set()
    for item in itens:
        ids.add(item['autor'])
        ids.update(c['autor'] for c in item.get('comentarios') or [])
    eu = _pegar('USER#' + eu_id) or {}
    return {
        'posts': [_publico(i, eu_id) for i in itens],
        'autores': _cartoes(ids, eu),
    }


def _ler(post_id):
    if not ID_POST.match(str(post_id or '')):
        raise ErroDeConta('Post não encontrado.', 404)
    item = _pegar('POST#' + post_id)
    if not item:
        raise ErroDeConta('Post não encontrado.', 404)
    return item


def _devolver(post_id, eu_id):
    return _com_autores([_ler(post_id)], eu_id)


# --- Listar ---------------------------------------------------------------
def listar(eu_id, autor=None):
    args = {
        'TableName': TABELA,
        'FilterExpression': 'begins_with(pk, :p)',
        'ExpressionAttributeValues': {':p': {'S': 'POST#'}},
    }
    if autor:
        if not ID_OK.match(str(autor)):
            return {'posts': [], 'autores': {}}
        args['FilterExpression'] += ' AND autor = :a'
        args['ExpressionAttributeValues'][':a'] = {'S': autor}

    itens = []
    while True:
        r = _dynamo.scan(**args)
        itens.extend(_item(b) for b in r.get('Items', []))
        if 'LastEvaluatedKey' not in r:
            break
        args['ExclusiveStartKey'] = r['LastEvaluatedKey']

    itens.sort(key=lambda i: i['criado_em'], reverse=True)
    return _com_autores(itens[:LISTA_MAX], eu_id)


# --- Publicar e apagar ----------------------------------------------------
def publicar(eu_id, corpo):
    corpo = corpo if isinstance(corpo, dict) else {}
    chave = str(corpo.get('chave') or '')
    if not CHAVE_OK.match(chave):
        raise ErroDeConta('Publicação sem origem.')
    tipo = corpo.get('tipo') if corpo.get('tipo') in TIPOS else 'look'
    nome = _texto(corpo.get('nome'), NOME_MAX) or ('Colagem' if tipo == 'board' else 'Look')

    post_id = 'p-' + hashlib.sha256(('%s|%s' % (eu_id, chave)).encode()).hexdigest()[:16]
    existente = _pegar('POST#' + post_id)
    if existente:
        return _com_autores([existente], eu_id)

    binario, extensao, tipo_mime = _imagem(corpo.get('thumb'))
    impressao = hashlib.sha256(binario).hexdigest()[:10]
    caminho = 'assets/posts/%s-%s.%s' % (post_id, impressao, extensao)
    _s3.put_object(Bucket=BUCKET_SITE, Key=caminho, Body=binario,
                   ContentType=tipo_mime, CacheControl=ETERNO)

    item = {
        'pk': 'POST#' + post_id,
        'id': post_id,
        'autor': eu_id,
        'tipo': tipo,
        'nome': nome,
        'criado_em': _quando(corpo.get('criadoEm')),
        'thumb': caminho,
        'pecas': _pecas(corpo.get('pecas')),
        'origem': _origem(corpo.get('origem'), tipo),
        'comentarios': [],
    }
    try:
        _dynamo.put_item(TableName=TABELA,
                         Item={k: _ser.serialize(v) for k, v in item.items()},
                         ConditionExpression='attribute_not_exists(pk)')
    except ClientError as e:
        # Dois pedidos iguais ao mesmo tempo: o outro chegou primeiro. A imagem
        # que este subiu é a mesma (mesmo hash) ou fica órfã, sem estrago.
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        item = _ler(post_id)
    return _com_autores([item], eu_id)


def apagar(eu_id, post_id):
    item = _ler(post_id)
    if item['autor'] != eu_id:
        raise ErroDeConta('Só quem publicou pode apagar.', 403)
    _dynamo.delete_item(TableName=TABELA, Key={'pk': {'S': 'POST#' + post_id}})
    if item.get('thumb', '').startswith('assets/posts/'):
        _s3.delete_object(Bucket=BUCKET_SITE, Key=item['thumb'])
    return {'apagado': post_id}


# --- Curtir e comentar ----------------------------------------------------
def _atualizar(post_id, expressao, valores, condicao='attribute_exists(pk)', nomes=None):
    if not ID_POST.match(str(post_id or '')):
        raise ErroDeConta('Post não encontrado.', 404)
    args = {
        'TableName': TABELA,
        'Key': {'pk': {'S': 'POST#' + post_id}},
        'UpdateExpression': expressao,
        'ConditionExpression': condicao,
        'ExpressionAttributeValues': valores,
    }
    if nomes:
        args['ExpressionAttributeNames'] = nomes
    try:
        _dynamo.update_item(**args)
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise


def curtir(eu_id, post_id, curte):
    feito = _atualizar(post_id, '%s curtidas :eu' % ('ADD' if curte else 'DELETE'),
                       {':eu': {'SS': [eu_id]}})
    if not feito:
        raise ErroDeConta('Post não encontrado.', 404)
    return _devolver(post_id, eu_id)


def comentar(eu_id, post_id, texto):
    texto = _texto(texto, TEXTO_MAX)
    if not texto:
        raise ErroDeConta('Comentário vazio.')
    comentario = {
        'id': 'c-' + os.urandom(5).hex(),
        'autor': eu_id,
        'texto': texto,
        'em': iso(agora()),
    }
    feito = _atualizar(
        post_id,
        'SET comentarios = list_append(if_not_exists(comentarios, :vazio), :c)',
        {':c': _ser.serialize([comentario]), ':vazio': {'L': []},
         ':max': {'N': str(COMENTARIOS_MAX)}},
        condicao='attribute_exists(pk) AND (attribute_not_exists(comentarios) '
                 'OR size(comentarios) < :max)')
    if not feito:
        _ler(post_id)       # 404 se sumiu; senão é a lista cheia
        raise ErroDeConta('Esse post já tem comentários demais.')
    return _devolver(post_id, eu_id)


def apagar_comentario(eu_id, post_id, comentario_id):
    if not ID_COMENTARIO.match(str(comentario_id or '')):
        raise ErroDeConta('Comentário não encontrado.', 404)
    item = _ler(post_id)
    lista = item.get('comentarios') or []
    pos = next((i for i, c in enumerate(lista) if c['id'] == comentario_id), None)
    if pos is None:
        raise ErroDeConta('Comentário não encontrado.', 404)
    if eu_id not in (lista[pos]['autor'], item['autor']):
        raise ErroDeConta('Só quem comentou pode apagar.', 403)
    # A condição prende o índice ao id: se alguém apagou outro comentário antes
    # deste no meio do caminho, o índice mudou e a remoção não acerta o errado.
    feito = _atualizar(post_id, 'REMOVE comentarios[%d]' % pos,
                       {':cid': {'S': comentario_id}},
                       condicao='comentarios[%d].#id = :cid' % pos,
                       nomes={'#id': 'id'})
    if not feito:
        raise ErroDeConta('O post mudou enquanto isso. Tente de novo.', 409)
    return _devolver(post_id, eu_id)
