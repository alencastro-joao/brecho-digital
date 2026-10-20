# -*- coding: utf-8 -*-
"""
O feed compartilhado: o que uma conta publica, as outras veem — sobre DynamoDB.

Até aqui cada conta guardava as próprias publicações no save dela (`state.feed`,
no navegador e em `estado/<uid>.json.gz`). Funcionava para quem publicou e para
mais ninguém: o amigo abria o feed e não via nada, e vice-versa. Este módulo
tira as publicações do save e põe num lugar que todo mundo lê.

    GET    /api/feed[?autor=<id>][&limite=<n>][&depois=<cursor>]
                                                os posts, mais novos primeiro, de página em
                                                página: a resposta traz `proximo`, o cursor
                                                da página seguinte (null no fim)
    POST   /api/feed                           publica { chave, tipo, nome, thumb, pecas, origem, camadas }
                                                (com `atualizar: true`, o dono troca a imagem do post que já existe)
    DELETE /api/feed/<id>                      o dono apaga
    POST   /api/feed/<id>/curtir               { curte }
    POST   /api/feed/<id>/comentarios          { texto }
    DELETE /api/feed/<id>/comentarios/<cid>    quem comentou (ou o dono do post) apaga
    POST   /api/perfil/miniatura               { thumb }: a miniatura de um favorito do perfil

O desenho, na mesma tabela das contas (nenhum índice novo do DynamoDB):

    POST#<id>   id, autor, tipo ('look' | 'board'), nome, criado_em,
                thumb        caminho da miniatura no site (assets/posts/...)
                pecas        lista dos ids de peça que aparecem no post
                origem       { lookId } ou { boardId } — o editor de onde veio
                camadas      JSON das camadas do look (vazio na colagem e nos antigos)
                curtidas     conjunto (SS) de quem curtiu
                comentarios  lista de { id, autor, texto, em }

    FEED#indice p            mapa { <id do post>: "criado_em|autor|g" } de todos
                             os posts ('g' no fim = gerado.py). É a linha do tempo.

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

* **A listagem lê a linha do tempo (`FEED#indice`), não a tabela.** Antes era
  um `Scan` da tabela inteira (contas, sessões, estoque, tudo) a cada abertura
  do feed, mais um GetItem por pessoa, um depois do outro — e o feed travava.
  Agora é um GetItem do índice, a página recortada dele em memória e um GetItem
  por post da página, em paralelo (contas.pegar_varios). O índice é um mapa:
  publicar põe uma chave (`SET p.#id`), apagar tira (`REMOVE p.#id`), as duas
  atômicas, sem disputa entre dois pedidos ao mesmo tempo.

* **O índice se refaz sozinho.** Se ele não existe (o primeiro deploy, ou
  alguém apagou o item), a primeira leitura varre a tabela uma vez e o monta
  com os posts que existem — nada nos posts muda, então nada se perde. Post que
  o índice aponta e não existe mais (apagado por fora, pela limpeza) sai do
  índice na leitura que o encontrar.

* **Cabe uns 5 mil posts** (o item para em 400 KB, cada entrada tem ~70 bytes;
  `listar` avisa no log ao passar de 300 KB). Quando chegar perto, o caminho é
  um índice por mês (`FEED#indice#2026-10`), e só as funções do índice mudam.
"""

import base64
import hashlib
import json
import os
import re
from datetime import datetime, timedelta, timezone

import boto3
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

from contas import ErroDeConta, TABELA, _dynamo, _des, _pegar, agora, iso, pegar_varios
from pessoas import ID_OK, VALOR_OK, _cartoes

BUCKET_SITE = os.environ.get('BD_BUCKET_SITE') or ''
_s3 = boto3.client('s3')
_ser = TypeSerializer()

ID_POST = re.compile(r'^p-[0-9a-f]{16}$')
ID_FICTICIO = re.compile(r'^u-[a-z]{1,12}$')     # os perfis de exemplo (gerador.py)
ID_COMENTARIO = re.compile(r'^c-[0-9a-f]{10}$')
CHAVE_OK = re.compile(r'^[\w:.\-]{1,64}$')
TIPOS = ('look', 'board')
NOME_MAX = 60
TEXTO_MAX = 140
PECAS_MAX = 40
COMENTARIOS_MAX = 300
LISTA_MAX = 120                 # posts por página: o padrão e o máximo
INDICE = 'FEED#indice'
INDICE_ALERTA = 300 * 1024      # bytes do índice; o DynamoDB para em 400 KB
CURSOR_OK = re.compile(r'^[A-Za-z0-9_\-]{8,96}$')
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


def _numero(valor, minimo, maximo, padrao=0):
    try:
        n = float(valor)
    except (TypeError, ValueError):
        return padrao
    if n != n:                      # NaN
        return padrao
    return round(min(max(n, minimo), maximo), 2)


def _camadas(bruto, tipo):
    """Como o look foi montado: cada peça com posição, escala, giro e espelho.
    É o que deixa a tela redesenhar o post com o personagem de agora de quem
    postou, em vez de ficar com a imagem do dia. Guardado como texto (JSON):
    o DynamoDB não aceita float, e ninguém consulta dentro disso."""
    if tipo != 'look' or not isinstance(bruto, list):
        return []
    limpas = []
    for c in bruto[:PECAS_MAX]:
        if not isinstance(c, dict):
            continue
        item_id = c.get('itemId')
        if not isinstance(item_id, str) or not VALOR_OK.match(item_id):
            continue
        limpas.append({
            'itemId': item_id,
            'x': _numero(c.get('x'), -2000, 3000),
            'y': _numero(c.get('y'), -2000, 3000),
            'z': int(_numero(c.get('z'), -1000, 1000)),
            'escala': _numero(c.get('escala'), 0.05, 10, 1),
            'rot': _numero(c.get('rot'), -360, 360),
            'flip': bool(c.get('flip')),
        })
    return limpas


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
    # Sempre em UTC: a linha do tempo ordena pelo texto da data, e "-03:00"
    # misturado com "+00:00" poria o post fora do lugar.
    return iso(dt.astimezone(timezone.utc))


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
        'camadas': json.loads(item.get('camadas') or '[]'),
        'curtidas': len(curtidas),
        'curtido': eu_id in curtidas,
        # Quem curtiu, para o "♥ Rafa e mais 2" do card: só os dois primeiros.
        'curtiram': sorted(c for c in curtidas if c != eu_id)[:2],
        'comentarios': [dict(c) for c in item.get('comentarios') or []],
        'real': True,
    }
    if item['autor'] == eu_id:
        post.update(item.get('origem') or {})
    if item.get('gerado'):
        # Post de perfil de exemplo (gerador.py): sem imagem, a tela desenha o
        # look ou monta a colagem a partir das peças e desta semente.
        post['gerado'] = True
        post['semente'] = int(item.get('semente') or 1)
    return post


def _com_autores(itens, eu_id):
    """Os posts e os cartões de todo mundo que aparece neles — quem postou e
    quem comentou —, para a tela desenhar o retrato sem mais uma ida ao
    servidor por pessoa."""
    posts = [_publico(i, eu_id) for i in itens]
    ids = set()
    for item, post in zip(itens, posts):
        ids.add(item['autor'])
        ids.update(c['autor'] for c in item.get('comentarios') or [])
        ids.update(post['curtiram'])
    eu = _pegar('USER#' + eu_id) or {}
    return {
        'posts': posts,
        'autores': _cartoes(ids, eu),
        'proximo': None,
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


# --- A linha do tempo -----------------------------------------------------
def _em_utc(quando):
    """A data como a linha do tempo ordena: ISO em UTC. Os posts de antes de
    `_quando` normalizar podem ter outro fuso."""
    try:
        dt = datetime.fromisoformat(str(quando).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return str(quando or '')
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return iso(dt.astimezone(timezone.utc))


def _entrada(item):
    return '%s|%s|%s' % (_em_utc(item['criado_em']), item['autor'], 'g' if item.get('gerado') else '')


def _desembrulhar(post_id, valor):
    em, autor, marca = (valor.split('|') + ['', ''])[:3]
    return {'id': post_id, 'em': em, 'autor': autor, 'gerado': marca == 'g'}


def _reconstruir():
    """Monta o índice com os posts que existem: uma varredura, só dos campos
    que o índice guarda. Roda quando o índice não existe — o primeiro deploy
    deste desenho, ou depois de alguém apagar o item."""
    args = {
        'TableName': TABELA,
        'FilterExpression': 'begins_with(pk, :p)',
        'ProjectionExpression': '#id, autor, criado_em, gerado',
        'ExpressionAttributeNames': {'#id': 'id'},
        'ExpressionAttributeValues': {':p': {'S': 'POST#'}},
    }
    mapa = {}
    while True:
        r = _dynamo.scan(**args)
        for bruto in r.get('Items', []):
            item = _item(bruto)
            if ID_POST.match(str(item.get('id') or '')) and item.get('autor') and item.get('criado_em'):
                mapa[item['id']] = _entrada(item)
        if 'LastEvaluatedKey' not in r:
            break
        args['ExclusiveStartKey'] = r['LastEvaluatedKey']
    try:
        _dynamo.put_item(TableName=TABELA,
                         Item={'pk': {'S': INDICE}, 'p': {'M': {k: {'S': v} for k, v in mapa.items()}}},
                         ConditionExpression='attribute_not_exists(p)')
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        return _ler_indice(refazer=False)      # outra leitura montou primeiro
    print('feed: índice refeito com %d posts' % len(mapa))
    return mapa


def _ler_indice(refazer=True):
    """{id do post: "criado_em|autor|g"} de todos os posts."""
    item = _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': INDICE}},
                            ConsistentRead=True).get('Item') or {}
    if 'p' not in item:
        return _reconstruir() if refazer else {}
    mapa = {k: v['S'] for k, v in item['p']['M'].items()}
    if len(mapa) * 70 > INDICE_ALERTA:
        print('feed: o índice tem %d posts, perto do limite do item' % len(mapa))
    return mapa


def indexar(item):
    """Põe o post na linha do tempo. Sem índice ainda, monta (e a varredura já
    acha este post, que foi gravado antes)."""
    args = {
        'TableName': TABELA,
        'Key': {'pk': {'S': INDICE}},
        'UpdateExpression': 'SET p.#id = :v',
        'ConditionExpression': 'attribute_exists(p)',
        'ExpressionAttributeNames': {'#id': item['id']},
        'ExpressionAttributeValues': {':v': {'S': _entrada(item)}},
    }
    try:
        _dynamo.update_item(**args)
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        if item['id'] not in _reconstruir():
            _dynamo.update_item(**args)


def desindexar(post_ids):
    """Tira posts da linha do tempo. Sem índice, nada a tirar: quando ele for
    montado, já nasce sem eles."""
    post_ids = [i for i in dict.fromkeys(post_ids) if ID_POST.match(str(i))]
    for k in range(0, len(post_ids), 50):
        lote = post_ids[k:k + 50]
        nomes = {'#i%d' % n: pid for n, pid in enumerate(lote)}
        try:
            _dynamo.update_item(
                TableName=TABELA, Key={'pk': {'S': INDICE}},
                UpdateExpression='REMOVE ' + ', '.join('p.' + n for n in nomes),
                ConditionExpression='attribute_exists(p)',
                ExpressionAttributeNames=nomes)
        except ClientError as e:
            if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise


def linha_do_tempo(autor=None, so_gerados=False):
    """As entradas do índice, mais novas primeiro (empate: pelo id, para a
    ordem ser sempre a mesma e o cursor não pular nem repetir post)."""
    entradas = [_desembrulhar(k, v) for k, v in _ler_indice().items()]
    if autor:
        entradas = [e for e in entradas if e['autor'] == autor]
    if so_gerados:
        entradas = [e for e in entradas if e['gerado']]
    entradas.sort(key=lambda e: (e['em'], e['id']), reverse=True)
    return entradas


# --- O cursor -------------------------------------------------------------
# Opaco para a tela: a data e o id do último post da página, em base64 de URL.
def _cursor(entrada):
    texto = '%s|%s' % (entrada['em'], entrada['id'])
    return base64.urlsafe_b64encode(texto.encode()).decode().rstrip('=')


def _ler_cursor(bruto):
    if bruto in (None, ''):
        return None
    bruto = str(bruto)
    if not CURSOR_OK.match(bruto):
        raise ErroDeConta('Cursor inválido.')
    try:
        texto = base64.urlsafe_b64decode(bruto + '=' * (-len(bruto) % 4)).decode()
        em, post_id = texto.split('|')
    except (ValueError, UnicodeDecodeError):
        raise ErroDeConta('Cursor inválido.')
    if not ID_POST.match(post_id):
        raise ErroDeConta('Cursor inválido.')
    return (em, post_id)


def _limite(bruto):
    if bruto in (None, ''):
        return LISTA_MAX
    try:
        n = int(bruto)
    except (TypeError, ValueError):
        raise ErroDeConta('Limite inválido.')
    return max(1, min(n, LISTA_MAX))


# --- Listar ---------------------------------------------------------------
def listar(eu_id, autor=None, limite=None, depois=None):
    """Uma página do feed. `depois` é o `proximo` da página anterior."""
    limite = _limite(limite)
    cursor = _ler_cursor(depois)
    if autor and not (ID_OK.match(str(autor)) or ID_FICTICIO.match(str(autor))):
        return {'posts': [], 'autores': {}, 'proximo': None}

    entradas = linha_do_tempo(autor)
    if cursor:
        entradas = [e for e in entradas if (e['em'], e['id']) < cursor]

    # Lê de pouco em pouco além do que falta: se um post do índice sumiu da
    # tabela, o seguinte entra no lugar e a página sai cheia.
    itens, fantasmas, lidas = [], [], 0
    while len(itens) < limite and lidas < len(entradas):
        lote = entradas[lidas:lidas + limite - len(itens)]
        lidas += len(lote)
        achados = pegar_varios(['POST#' + e['id'] for e in lote])
        for e in lote:
            item = achados.get('POST#' + e['id'])
            if item:
                itens.append(item)
            else:
                fantasmas.append(e['id'])
    if fantasmas:
        desindexar(fantasmas)

    resposta = _com_autores(itens, eu_id)
    if lidas < len(entradas) and itens:
        resposta['proximo'] = _cursor(entradas[lidas - 1])
    return resposta


# --- Miniatura de favorito -----------------------------------------------
def subir_miniatura(eu_id, corpo):
    """Sobe a miniatura de um look ou colagem favoritos e devolve o caminho
    dela no site — é o que vai em `perfil.favoritos` (pessoas.py confere que o
    caminho é deste dono). Mesmo lugar e mesmo cuidado das miniaturas de post;
    o nome sai do hash do conteúdo, então subir a mesma imagem de novo cai no
    mesmo arquivo."""
    corpo = corpo if isinstance(corpo, dict) else {}
    binario, extensao, tipo_mime = _imagem(corpo.get('thumb'))
    impressao = hashlib.sha256(binario).hexdigest()[:10]
    caminho = 'assets/posts/perfil-%s-%s.%s' % (eu_id, impressao, extensao)
    _s3.put_object(Bucket=BUCKET_SITE, Key=caminho, Body=binario,
                   ContentType=tipo_mime, CacheControl=ETERNO)
    return {'thumb': caminho}


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
    if existente and corpo.get('atualizar') is True:
        return _atualizar_post(eu_id, existente, corpo, tipo, nome)
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
        'camadas': json.dumps(_camadas(corpo.get('camadas'), tipo), separators=(',', ':')),
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
    indexar(item)
    return _com_autores([item], eu_id)


def _atualizar_post(eu_id, existente, corpo, tipo, nome):
    """O dono editou o look (ou a colagem) e pediu `atualizar`: o mesmo post
    ganha a imagem, o nome, as peças e as camadas novas. Curtidas,
    comentários e a data continuam; a imagem antiga sai do bucket."""
    if existente['autor'] != eu_id:
        raise ErroDeConta('Só quem publicou pode atualizar.', 403)
    post_id = existente['id']
    binario, extensao, tipo_mime = _imagem(corpo.get('thumb'))
    impressao = hashlib.sha256(binario).hexdigest()[:10]
    caminho = 'assets/posts/%s-%s.%s' % (post_id, impressao, extensao)
    _s3.put_object(Bucket=BUCKET_SITE, Key=caminho, Body=binario,
                   ContentType=tipo_mime, CacheControl=ETERNO)
    _atualizar(post_id,
               'SET #n = :nome, thumb = :thumb, pecas = :pecas, camadas = :camadas, editado_em = :em',
               {
                   ':nome': _ser.serialize(nome),
                   ':thumb': _ser.serialize(caminho),
                   ':pecas': _ser.serialize(_pecas(corpo.get('pecas'))),
                   ':camadas': _ser.serialize(json.dumps(_camadas(corpo.get('camadas'), tipo),
                                                         separators=(',', ':'))),
                   ':em': _ser.serialize(iso(agora())),
               },
               nomes={'#n': 'nome'})
    antiga = existente.get('thumb') or ''
    if antiga != caminho and antiga.startswith('assets/posts/'):
        _s3.delete_object(Bucket=BUCKET_SITE, Key=antiga)
    return _devolver(post_id, eu_id)


def apagar(eu_id, post_id):
    item = _ler(post_id)
    if item['autor'] != eu_id:
        raise ErroDeConta('Só quem publicou pode apagar.', 403)
    _dynamo.delete_item(TableName=TABELA, Key={'pk': {'S': 'POST#' + post_id}})
    desindexar([post_id])
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
