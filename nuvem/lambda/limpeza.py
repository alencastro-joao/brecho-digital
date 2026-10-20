# -*- coding: utf-8 -*-
"""
Limpeza de contas: o administrador apaga todas as contas menos a dele.

    GET  /api/admin/contas          a lista: quem é, desde quando, quantos posts
    POST /api/admin/contas/limpar   { ids, confirmar: "APAGAR" }

Fica de fora da limpeza só quem chama (o admin logado). Nada é apagado sem
backup antes: a tabela inteira (em JSON do DynamoDB) e o save de cada conta
que sai vão para `backups/contas-<quando>/` no bucket de dados. Se o backup
falhar, a limpeza para antes de apagar qualquer coisa.

O que sai com cada conta:

    USER#, EMAIL#, HANDLE#     a conta e as marcas de unicidade
    SESSAO#                    as sessões abertas dela
    POST# dela                 e a miniatura do post no site
    estado/<uid>.json.gz       o save
    nos posts que ficam        as curtidas e os comentários dela
    na conta que fica          quem ela seguia / quem a seguia

Os perfis de exemplo (o gerador de posts) não são contas: não têm USER#, e os
posts deles ficam. A tiragem (ESTOQUE#mapa) não volta: contar o que cada save
levou seria abrir megabytes de save por conta, e a diferença some sozinha.

Só apaga os ids que o admin viu na lista (`ids`), e nunca o dele: uma conta
criada entre a lista e o clique fica.
"""

import gzip
import json
import os
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.types import TypeSerializer

from contas import ErroDeConta, TABELA, _dynamo, _des
import feed

BUCKET_DADOS = os.environ.get('BD_BUCKET_DADOS') or ''
BUCKET_SITE = os.environ.get('BD_BUCKET_SITE') or ''
_s3 = boto3.client('s3')
_ser = TypeSerializer().serialize


def _varrer():
    args = {'TableName': TABELA}
    while True:
        r = _dynamo.scan(**args)
        yield from r.get('Items', [])
        if 'LastEvaluatedKey' not in r:
            break
        args['ExclusiveStartKey'] = r['LastEvaluatedKey']


def _ler_tudo():
    brutos = list(_varrer())
    return brutos, [{k: _des.deserialize(v) for k, v in b.items()} for b in brutos]


def _tem_save(uid):
    if not BUCKET_DADOS:
        return False
    try:
        _s3.head_object(Bucket=BUCKET_DADOS, Key='estado/%s.json.gz' % uid)
        return True
    except Exception:                       # noqa: BLE001 — 404 ou sem permissão: "não sei"
        return False


def inventario(eu):
    _, itens = _ler_tudo()
    contas = [i for i in itens if i['pk'].startswith('USER#')]
    posts = [i for i in itens if i['pk'].startswith('POST#')]
    sessoes = [i for i in itens if i['pk'].startswith('SESSAO#')]
    ids_reais = {c['id'] for c in contas}

    saida = []
    for c in sorted(contas, key=lambda c: c.get('criado_em') or ''):
        uid = c['id']
        saida.append({
            'id': uid,
            'email': c.get('email'),
            'handle': c.get('handle'),
            'nome': c.get('nome'),
            'papel': c.get('papel') or 'usuario',
            'criadoEm': c.get('criado_em'),
            'ultimoAcesso': c.get('ultimo_acesso'),
            'posts': sum(1 for p in posts if p.get('autor') == uid),
            'comentarios': sum(1 for p in posts for m in (p.get('comentarios') or [])
                               if m.get('autor') == uid),
            'curtidas': sum(1 for p in posts if uid in (p.get('curtidas') or ())),
            'sessoes': sum(1 for s in sessoes if s.get('uid') == uid),
            'seguindo': len(c.get('seguindo') or ()),
            'seguidores': len(c.get('seguidores') or ()),
            'save': _tem_save(uid),
            'fica': uid == eu['id'],
        })
    return {
        'contas': saida,
        'postsDeExemplo': sum(1 for p in posts if p.get('autor') not in ids_reais),
    }


def painel():
    """GET /api/admin/painel — uma varredura da tabela vira os números do dia
    (a conta mora em painel.py, que o servidor local também usa)."""
    import estoque
    import painel as conta
    _, itens = _ler_tudo()
    contas = [i for i in itens if i['pk'].startswith('USER#')]
    ids = {c['id'] for c in contas}
    uso = {}
    for s in itens:
        if s['pk'].startswith('SESSAO#'):
            u = conta.ultimo_uso_da_sessao(s.get('expira_em'))
            if u and u > uso.get(s.get('uid'), ''):
                uso[s.get('uid')] = u
    lista = [{'id': c['id'], 'criado_em': c.get('criado_em'),
              'ultimo_uso': max(filter(None, [c.get('ultimo_acesso'), uso.get(c['id'])]), default=None)}
             for c in contas]
    posts = [p for p in itens if p['pk'].startswith('POST#') and p.get('autor') in ids]
    levadas = next((i.get('levadas') or {} for i in itens if i['pk'] == estoque.PK), {})
    copias = {i['pk'][len('COPIA#'):].replace('#', '|'): i.get('donos') or []
              for i in itens if i['pk'].startswith('COPIA#')}
    return conta.resumir(lista, posts, {k: int(v) for k, v in levadas.items()},
                         estoque.LIMITES, copias)


def _backup(pasta, brutos, saem):
    corpo = gzip.compress(json.dumps({'tabela': TABELA, 'itens': brutos},
                                     ensure_ascii=False).encode('utf-8'))
    _s3.put_object(Bucket=BUCKET_DADOS, Key=pasta + 'tabela.json.gz', Body=corpo,
                   ContentType='application/json', ContentEncoding='gzip')
    com_save = set()
    for uid in saem:
        if not _tem_save(uid):
            continue
        _s3.copy_object(Bucket=BUCKET_DADOS, Key='%sestado/%s.json.gz' % (pasta, uid),
                        CopySource={'Bucket': BUCKET_DADOS, 'Key': 'estado/%s.json.gz' % uid})
        com_save.add(uid)
    return com_save


def _apagar_item(pk):
    _dynamo.delete_item(TableName=TABELA, Key={'pk': {'S': pk}})


def _apagar_no_s3(bucket, chave):
    try:
        _s3.delete_object(Bucket=bucket, Key=chave)
        return True
    except Exception as e:                  # noqa: BLE001 — sobra um arquivo órfão, sem estrago
        print('limpeza: não apaguei s3://%s/%s: %r' % (bucket, chave, e))
        return False


def limpar(eu, corpo):
    corpo = corpo if isinstance(corpo, dict) else {}
    if corpo.get('confirmar') != 'APAGAR':
        raise ErroDeConta('Falta confirmar: escreva APAGAR.')
    if not BUCKET_DADOS:
        raise ErroDeConta('Sem bucket de dados para o backup: nada foi apagado.', 500)
    pedidos = {str(i) for i in (corpo.get('ids') or []) if isinstance(i, str)}

    brutos, itens = _ler_tudo()
    contas = {i['id']: i for i in itens if i['pk'].startswith('USER#')}
    saem = sorted(uid for uid in pedidos if uid in contas and uid != eu['id'])
    if not saem:
        raise ErroDeConta('Nenhuma conta para apagar.')

    quando = datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')
    pasta = 'backups/contas-%s/' % quando
    com_save = _backup(pasta, brutos, saem)

    sai = set(saem)
    sairam = []                     # posts apagados: saem da linha do tempo
    feito = {'contas': 0, 'posts': 0, 'sessoes': 0, 'saves': 0,
             'postsLimpos': 0, 'backup': 's3://%s/%s' % (BUCKET_DADOS, pasta),
             'savesNoBackup': len(com_save)}

    for item in itens:
        pk = item['pk']
        if pk.startswith('SESSAO#') and item.get('uid') in sai:
            _apagar_item(pk)
            feito['sessoes'] += 1
        elif pk.startswith('POST#') and item.get('autor') in sai:
            _apagar_item(pk)
            thumb = item.get('thumb') or ''
            if thumb.startswith('assets/posts/') and BUCKET_SITE:
                _apagar_no_s3(BUCKET_SITE, thumb)
            feito['posts'] += 1
            sairam.append(item.get('id'))
        elif pk.startswith('POST#'):
            curtidas = set(item.get('curtidas') or ()) & sai
            comentarios = item.get('comentarios') or []
            ficam = [c for c in comentarios if c.get('autor') not in sai]
            if not curtidas and len(ficam) == len(comentarios):
                continue
            partes, valores = [], {}
            if curtidas:
                partes.append('DELETE curtidas :saem')
                valores[':saem'] = {'SS': sorted(curtidas)}
            if len(ficam) != len(comentarios):
                partes.append('SET comentarios = :ficam')
                valores[':ficam'] = {'L': [{'M': {k: _ser(v) for k, v in c.items()}}
                                           for c in ficam]}
            _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': pk}},
                                UpdateExpression=' '.join(partes),
                                ExpressionAttributeValues=valores)
            feito['postsLimpos'] += 1

    feed.desindexar(sairam)

    for uid in saem:
        c = contas[uid]
        _apagar_item('USER#' + uid)
        for pk in ('EMAIL#' + str(c.get('email_normal') or ''),
                   'HANDLE#' + str(c.get('handle_normal') or '')):
            marca = next((i for i in itens if i['pk'] == pk), None)
            if marca and marca.get('uid') == uid:
                _apagar_item(pk)
        for fav in ((c.get('perfil') or {}).get('favoritos') or []):
            thumb = fav.get('thumb') if isinstance(fav, dict) else None
            if isinstance(thumb, str) and thumb.startswith('assets/posts/perfil-%s-' % uid):
                _apagar_no_s3(BUCKET_SITE, thumb)
        if uid in com_save and _apagar_no_s3(BUCKET_DADOS, 'estado/%s.json.gz' % uid):
            feito['saves'] += 1
        feito['contas'] += 1

    # Quem fica não segue mais nem é seguido por quem saiu.
    for uid, c in contas.items():
        if uid in sai:
            continue
        partes, valores = [], {}
        seguindo = set(c.get('seguindo') or ()) & sai
        seguidores = set(c.get('seguidores') or ()) & sai
        if seguindo:
            partes.append('seguindo :a')
            valores[':a'] = {'SS': sorted(seguindo)}
        if seguidores:
            partes.append('seguidores :b')
            valores[':b'] = {'SS': sorted(seguidores)}
        if partes:
            _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': 'USER#' + uid}},
                                UpdateExpression='DELETE ' + ', '.join(partes),
                                ExpressionAttributeValues=valores)

    print('limpeza: %r' % (feito,))
    return feito
