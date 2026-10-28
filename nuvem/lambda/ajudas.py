# -*- coding: utf-8 -*-
"""
Mini games de ajuda: os jogadores ajudam a cadastrar as peças do acervo.

Três jogos, um por tarefa do cadastro:

    avaliar    a peça aparece e a pessoa arrasta para um lado (gostei / não
               gostei). A média dos votos vira a raridade sugerida.
    ajustar    a pessoa encaixa a peça no corpo (posição e tamanho). A mediana
               das medidas vira o ajuste sugerido.
    preencher  a pessoa diz a cor e a marca. A resposta mais votada vence.

Cada jogo paga fichas a cada `porFicha` ajudas e tem um teto de ajudas por
janela (dia ou hora, no horário de Brasília). As fichas moram no save (o
navegador soma o que esta resposta disser); a contagem e o teto moram aqui,
senão bastava chamar a rota em loop.

Itens do DynamoDB:

    AJUDA#COTA#<uid>#<jogo>#<janela>   n (ajudas na janela), ttl
    AJUDA#FEITAS#<uid>#<jogo>          ids (peças em que a pessoa já ajudou)
    AJUDA#PECA#<id>                    sim, nao, ajustes [{x,y,w}],
                                       "cor:<valor>", "marca:<valor>" (votos)

**As peças vêm da esteira.** O admin escolhe (Admin › Mini games) quais
fotos da esteira entram nos jogos: a prévia, que mora no bucket privado, é
copiada para o site (`assets/jogos/<id>.webp`) e a lista pública fica em
`assets/jogos.json`. Ao publicar a peça (ou descartar), ela sai dos jogos.
Nada mexe na ficha sozinho: o admin vê o resumo (GET /api/admin/ajudas) e
leva para a ficha da esteira o que quiser.

**Os números ficam todos em JOGOS, VOTOS_MIN e FAIXAS logo abaixo** — são as
regras do jogo, quem decide é o João.
"""

import json
import os
import re
import time
import unicodedata
from datetime import datetime, timedelta, timezone

import boto3
from botocore.exceptions import ClientError

TABELA = os.environ.get('BD_TABELA') or 'brecho'
SITE = os.environ.get('BD_BUCKET_SITE') or ''
DADOS = os.environ.get('BD_BUCKET_DADOS') or ''
LISTA = 'assets/jogos.json'
_dynamo = boto3.client('dynamodb')
_s3 = boto3.client('s3')
_cache = {'ids': None, 'em': 0}
BRASILIA = timezone(timedelta(hours=-3))

# ----------------------------- Regras (João) ------------------------------
# porFicha: quantas ajudas valem 1 ficha. limite: ajudas por janela.
# janela: 'dia' ou 'hora' (Brasília).
JOGOS = {
    'avaliar':   {'porFicha': 8, 'limite': 60, 'janela': 'dia'},
    'ajustar':   {'porFicha': 2, 'limite': 10, 'janela': 'dia'},
    'preencher': {'porFicha': 4, 'limite': 20, 'janela': 'dia'},
}
# Votos que a peça precisa antes de ganhar raridade sugerida.
VOTOS_MIN = 10
# % de "gostei" a partir da qual a peça entra em cada raridade (de cima para baixo).
FAIXAS = [(85, 'legendary'), (65, 'epic'), (50, 'rare'), (40, 'uncommon'), (0, 'common')]
# ---------------------------------------------------------------------------

ID_OK = re.compile(r'^e[a-z0-9]{8,24}$')     # o id da esteira
TEXTO_OK = re.compile(r'[^a-z0-9 &\'.-]+')
MAX_AJUSTES = 60      # medidas guardadas por peça (a mediana não precisa de mais)


# --------------------------- Peças nos jogos -------------------------------
def ler_lista():
    try:
        r = _s3.get_object(Bucket=SITE, Key=LISTA)
        return json.loads(r['Body'].read()).get('items') or []
    except ClientError as e:
        # Sem s3:ListBucket, arquivo que não existe chega como AccessDenied.
        if e.response['Error']['Code'] in ('NoSuchKey', '404', 'AccessDenied'):
            return []
        raise


def _gravar_lista(itens):
    _s3.put_object(Bucket=SITE, Key=LISTA, ContentType='application/json; charset=utf-8',
                   CacheControl='no-cache',
                   Body=json.dumps({'items': itens}, ensure_ascii=False).encode('utf-8'))
    _cache['ids'] = None


def _ids_nos_jogos():
    if _cache['ids'] is None or time.time() - _cache['em'] > 60:
        _cache['ids'], _cache['em'] = {i['id'] for i in ler_lista()}, time.time()
    return _cache['ids']


def colocar(item_id, dados):
    """Põe uma foto da esteira nos jogos. `dados` é a ficha da esteira."""
    if dados.get('estado') != 'pronta' or not dados.get('previa'):
        raise ValueError('essa foto ainda não está pronta')
    ficha, palpite = dados.get('ficha') or {}, dados.get('sugestao') or {}
    cat = ficha.get('cat') or palpite.get('cat') or ''
    if not cat:
        raise ValueError('escolha a categoria da peça na esteira antes')
    chave = 'assets/jogos/%s.webp' % item_id
    _s3.copy_object(Bucket=SITE, Key=chave, CopySource={'Bucket': DADOS, 'Key': dados['previa']},
                    ContentType='image/webp', MetadataDirective='REPLACE',
                    CacheControl='public, max-age=31536000, immutable')
    itens = [i for i in ler_lista() if i['id'] != item_id]
    itens.append({'id': item_id, 'src': chave, 'w': dados.get('w'), 'h': dados.get('h'),
                  'cat': cat, 'nome': ficha.get('nome') or '',
                  'criadoEm': dados.get('criadoEm') or ''})
    _gravar_lista(itens)
    return {'items': itens}


def tirar(item_id):
    """Tira dos jogos (o voto que já foi dado continua guardado)."""
    itens = ler_lista()
    resto = [i for i in itens if i['id'] != item_id]
    if len(resto) != len(itens):
        _gravar_lista(resto)
        _s3.delete_object(Bucket=SITE, Key='assets/jogos/%s.webp' % item_id)
    return {'items': resto}


def _janela(jogo, agora=None):
    agora = agora or datetime.now(BRASILIA)
    if JOGOS[jogo]['janela'] == 'hora':
        return agora.strftime('%Y-%m-%dT%H'), agora.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    return agora.date().isoformat(), (agora + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


def _pk_cota(uid, jogo):
    return 'AJUDA#COTA#%s#%s#%s' % (uid, jogo, _janela(jogo)[0])


def _pk_feitas(uid, jogo):
    return 'AJUDA#FEITAS#%s#%s' % (uid, jogo)


def _pk_peca(pid):
    return 'AJUDA#PECA#%s' % pid


def _texto(valor, limite):
    """Cor e marca viram uma forma só ('Nike ', 'nike' e 'NIKÉ' são um voto)."""
    t = unicodedata.normalize('NFD', str(valor or '')).encode('ascii', 'ignore').decode()
    t = TEXTO_OK.sub('', t.lower()).strip()
    return re.sub(r'\s+', ' ', t)[:limite]


def _numero(valor, minimo, maximo):
    try:
        n = float(valor)
    except (TypeError, ValueError):
        raise ValueError('medida inválida')
    if n != n or n < minimo or n > maximo:
        raise ValueError('medida fora do palco')
    return round(n, 1)


def _validar(jogo, corpo):
    if jogo not in JOGOS:
        raise ValueError('jogo desconhecido')
    pid = str(corpo.get('peca') or '').strip().lower()
    if not ID_OK.match(pid) or pid not in _ids_nos_jogos():
        raise ValueError('peça desconhecida')
    if jogo == 'avaliar':
        if not isinstance(corpo.get('gostei'), bool):
            raise ValueError('voto inválido')
        return pid, {'gostei': corpo['gostei']}
    if jogo == 'ajustar':
        a = corpo.get('ancora') or {}
        return pid, {'x': _numero(a.get('x'), 0, 600), 'y': _numero(a.get('y'), 0, 1200),
                     'w': _numero(a.get('w'), 10, 700)}
    cor, marca = _texto(corpo.get('cor'), 24), _texto(corpo.get('marca'), 40)
    if not cor and not marca:
        raise ValueError('diga a cor ou a marca')
    return pid, {'cor': cor, 'marca': marca}


def _contar(uid, jogo):
    """Soma 1 na cota da janela. Devolve o total novo, ou None se acabou."""
    _, vira = _janela(jogo)
    try:
        r = _dynamo.update_item(
            TableName=TABELA, Key={'pk': {'S': _pk_cota(uid, jogo)}},
            UpdateExpression='SET n = if_not_exists(n, :zero) + :um, #ttl = :ttl',
            ConditionExpression='attribute_not_exists(n) OR n < :lim',
            ExpressionAttributeNames={'#ttl': 'ttl'},
            ExpressionAttributeValues={
                ':um': {'N': '1'}, ':zero': {'N': '0'},
                ':lim': {'N': str(JOGOS[jogo]['limite'])},
                ':ttl': {'N': str(int((vira + timedelta(days=2)).timestamp()))}},
            ReturnValues='UPDATED_NEW')
        return int(r['Attributes']['n']['N'])
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        return None


def _descontar(uid, jogo):
    _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': _pk_cota(uid, jogo)}},
                        UpdateExpression='SET n = n - :um',
                        ConditionExpression='n > :zero',
                        ExpressionAttributeValues={':um': {'N': '1'}, ':zero': {'N': '0'}})


def _marcar_feita(uid, jogo, pid):
    """False se a pessoa já ajudou nesta peça neste jogo."""
    try:
        _dynamo.update_item(
            TableName=TABELA, Key={'pk': {'S': _pk_feitas(uid, jogo)}},
            UpdateExpression='ADD ids :id',
            ConditionExpression='attribute_not_exists(ids) OR NOT contains(ids, :um)',
            ExpressionAttributeValues={':id': {'SS': [pid]}, ':um': {'S': pid}})
        return True
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        return False


def _anotar(jogo, pid, dados):
    chave = {'pk': {'S': _pk_peca(pid)}}
    um = {':um': {'N': '1'}}
    if jogo == 'avaliar':
        _dynamo.update_item(TableName=TABELA, Key=chave,
                            UpdateExpression='ADD #v :um',
                            ExpressionAttributeNames={'#v': 'sim' if dados['gostei'] else 'nao'},
                            ExpressionAttributeValues=um)
    elif jogo == 'ajustar':
        medida = {'M': {k: {'N': str(v)} for k, v in dados.items()}}
        _dynamo.update_item(TableName=TABELA, Key=chave,
                            UpdateExpression='SET ajustes = list_append(if_not_exists(ajustes, :nada), :nova)',
                            ConditionExpression='attribute_not_exists(ajustes) OR size(ajustes) < :max',
                            ExpressionAttributeValues={':nada': {'L': []}, ':nova': {'L': [medida]},
                                                       ':max': {'N': str(MAX_AJUSTES)}})
    else:
        nomes = {}
        partes = []
        for i, campo in enumerate(('cor', 'marca')):
            if dados[campo]:
                nomes['#c%d' % i] = '%s:%s' % (campo, dados[campo])
                partes.append('#c%d :um' % i)
        _dynamo.update_item(TableName=TABELA, Key=chave,
                            UpdateExpression='ADD ' + ', '.join(partes),
                            ExpressionAttributeNames=nomes, ExpressionAttributeValues=um)


def _situacao(uid, jogo, n=None):
    regra = JOGOS[jogo]
    if n is None:
        r = _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': _pk_cota(uid, jogo)}})
        n = int((r.get('Item') or {}).get('n', {}).get('N', 0))
    return {'feitas': n, 'limite': regra['limite'], 'porFicha': regra['porFicha'],
            'janela': regra['janela'], 'vira': _janela(jogo)[1].isoformat()}


def estado(usuario):
    """O que a tela precisa: a cota de cada jogo e as peças já ajudadas."""
    uid = usuario['id']
    saida = {}
    for jogo in JOGOS:
        r = _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': _pk_feitas(uid, jogo)}})
        saida[jogo] = {**_situacao(uid, jogo),
                       'pecas': sorted((r.get('Item') or {}).get('ids', {}).get('SS', []))}
    return {'jogos': saida, 'itens': ler_lista()}


def ajudar(usuario, jogo, corpo):
    """Grava uma ajuda. Devolve a cota nova e quantas fichas ela pagou."""
    pid, dados = _validar(jogo, corpo or {})
    uid = usuario['id']
    n = _contar(uid, jogo)
    if n is None:
        return {'ok': False, 'motivo': 'limite', **_situacao(uid, jogo)}
    if not _marcar_feita(uid, jogo, pid):
        _descontar(uid, jogo)
        return {'ok': False, 'motivo': 'repetida', **_situacao(uid, jogo)}
    try:
        _anotar(jogo, pid, dados)
    except ClientError as e:
        # Peça com medidas de sobra: a ajuda conta, a medida não entra.
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
    fichas = 1 if n % JOGOS[jogo]['porFicha'] == 0 else 0
    return {'ok': True, 'fichas': fichas, **_situacao(uid, jogo, n)}


# ------------------------------- Resumo -----------------------------------
def raridade_sugerida(sim, nao):
    total = sim + nao
    if total < VOTOS_MIN:
        return None
    pct = sim * 100 / total
    return next(r for corte, r in FAIXAS if pct >= corte)


def _mediana(valores):
    v = sorted(valores)
    m = len(v) // 2
    return v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2


def _mais_votado(item, campo):
    votos = [(int(v['N']), k.split(':', 1)[1]) for k, v in item.items()
             if k.startswith(campo + ':')]
    if not votos:
        return None
    n, valor = max(votos)
    return {'valor': valor, 'votos': n, 'total': sum(x for x, _ in votos)}


def resumo_da_peca(item):
    sim, nao = int(item.get('sim', {}).get('N', 0)), int(item.get('nao', {}).get('N', 0))
    ajustes = [{k: float(v['N']) for k, v in a['M'].items()}
               for a in item.get('ajustes', {}).get('L', [])]
    return {
        'peca': item['pk']['S'][len('AJUDA#PECA#'):],
        'votos': {'sim': sim, 'nao': nao,
                  'pct': round(sim * 100 / (sim + nao)) if sim + nao else None,
                  'raridade': raridade_sugerida(sim, nao)},
        'ajuste': ({k: round(_mediana([a[k] for a in ajustes]), 1) for k in ('x', 'y', 'w')}
                   | {'medidas': len(ajustes)}) if ajustes else None,
        'cor': _mais_votado(item, 'cor'),
        'marca': _mais_votado(item, 'marca'),
    }


def resumo():
    """Tudo o que os jogadores disseram, peça a peça (só o admin vê)."""
    pecas, inicio = [], None
    while True:
        args = {'TableName': TABELA, 'FilterExpression': 'begins_with(pk, :p)',
                'ExpressionAttributeValues': {':p': {'S': 'AJUDA#PECA#'}}}
        if inicio:
            args['ExclusiveStartKey'] = inicio
        r = _dynamo.scan(**args)
        pecas += [resumo_da_peca(i) for i in r.get('Items', [])]
        inicio = r.get('LastEvaluatedKey')
        if not inicio:
            break
    return {'pecas': pecas, 'nosJogos': sorted(_ids_nos_jogos()), 'regras': {'jogos': JOGOS, 'votosMin': VOTOS_MIN,
                                       'faixas': FAIXAS}}
