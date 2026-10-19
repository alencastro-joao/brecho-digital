# -*- coding: utf-8 -*-
"""
Tiragem limitada — quantas cópias de cada peça existem no jogo inteiro.

A raridade decide a tiragem: uma peça comum sai em até 1000 guarda-roupas, uma
lendária em 25. O contador é global (todas as contas somadas), então ele não
pode morar no save de ninguém: mora num item só do DynamoDB,

    ESTOQUE#mapa   levadas: { "<id>|<raridade>": n, ... }

A chave leva a raridade porque a peça sem ficha fixa troca de raridade conforme
o sorteio do dia: a lendária de hoje e a comum de amanhã são tiragens
diferentes da mesma roupa.

Pegar é um `UPDATE` condicional (`n < limite`): duas pessoas brigando pela
última lendária no mesmo milissegundo, só uma leva. Um item só cabe folgado —
cada chave tem uns 30 bytes, e o teto do item é 400 KB.

**O histórico de cada cópia.** A cópia nº 12 da lendária X é uma coisa só no
jogo, e a ficha dela mostra por quem passou. Cada cópia numerada ganha um item

    COPIA#<id>|<raridade>#<n>   donos: [{ uid, handle, como, em }, ...]

e cada dono novo entra no fim da lista. Hoje a única entrada é quem levou (da
loja, de um baú, do presente...); quando existir troca e doação, quem recebe
entra do mesmo jeito, com `como` dizendo de quem veio. Se o admin devolve uma
cópia e ela sai de novo com o mesmo número, a lista continua: a peça voltou
para a loja e foi parar em outro guarda-roupa, que é o que aconteceu.
"""

import json
import os
import time
from datetime import datetime, timedelta, timezone

import boto3
from botocore.exceptions import ClientError

TABELA = os.environ.get('BD_TABELA') or 'brecho'
BUCKET_SITE = os.environ.get('BD_BUCKET_SITE') or ''
PK = 'ESTOQUE#mapa'
_dynamo = boto3.client('dynamodb')
_s3 = boto3.client('s3')

LIMITES = {'common': 1000, 'uncommon': 500, 'rare': 300, 'epic': 100, 'legendary': 25}

# Como a cópia chegou ao dono: as mesmas origens do inventário (js/dbinventario.js).
COMO = {'vitrine', 'presente', 'missao', 'semana', 'bau-especial', 'nivel',
        'collab', 'propria', 'teste'}


# Quantas cópias uma conta leva por dia (dia de Brasília), contando no
# servidor: o limite de 3 resgates da loja mora no save, que é o navegador quem
# escreve, então sem isto bastava chamar /api/estoque/levar em loop para
# esvaziar uma tiragem. As fichas acumulam sem teto e trocam por resgate
# quantas vezes quiser no dia, então a loja cobre o mural inteiro mais uma
# reposição (2 × 25 peças) e o total soma os baús abertos de uma vez. O
# administrador não tem cota (numera o acervo antigo, testa).
COTA_VITRINE = 50
COTA_TOTAL = 100
BRASILIA = timezone(timedelta(hours=-3))


def _pk_cota(usuario):
    return 'COTA#%s#%s' % (usuario['id'], datetime.now(BRASILIA).date().isoformat())


def _gastar_cota(usuario, como):
    """Conta uma cópia na cota do dia. False se a cota acabou."""
    if not usuario or usuario.get('papel') == 'admin':
        return True
    loja = como == 'vitrine'
    nomes = {'#t': 'total', '#ttl': 'ttl'}
    cond = 'attribute_not_exists(#t) OR #t < :tt'
    vals = {':um': {'N': '1'}, ':zero': {'N': '0'}, ':tt': {'N': str(COTA_TOTAL)},
            ':ttl': {'N': str(int((datetime.now(timezone.utc) + timedelta(days=3)).timestamp()))}}
    upd = 'SET #t = if_not_exists(#t, :zero) + :um, #ttl = :ttl'
    if loja:
        nomes['#l'] = 'loja'
        cond = '(%s) AND (attribute_not_exists(#l) OR #l < :tl)' % cond
        vals[':tl'] = {'N': str(COTA_VITRINE)}
        upd += ', #l = if_not_exists(#l, :zero) + :um'
    try:
        _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': _pk_cota(usuario)}},
                            UpdateExpression=upd, ConditionExpression=cond,
                            ExpressionAttributeNames=nomes,
                            ExpressionAttributeValues=vals)
        return True
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        return False


def _devolver_cota(usuario, como):
    """A cópia não saiu (esgotou) ou foi desfeita: a cota volta."""
    if not usuario or usuario.get('papel') == 'admin':
        return
    loja = como == 'vitrine'
    nomes = {'#t': 'total', **({'#l': 'loja'} if loja else {})}
    upd = 'SET #t = #t - :um' + (', #l = #l - :um' if loja else '')
    cond = '#t > :zero' + (' AND #l > :zero' if loja else '')
    try:
        _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': _pk_cota(usuario)}},
                            UpdateExpression=upd, ConditionExpression=cond,
                            ExpressionAttributeNames=nomes,
                            ExpressionAttributeValues={':um': {'N': '1'}, ':zero': {'N': '0'}})
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise


def chave(peca_id, raridade):
    return '%s|%s' % (peca_id, raridade)


def _validar(pecas):
    if not isinstance(pecas, list) or not 0 < len(pecas) <= 50:
        raise ValueError('lista de peças inválida')
    saida = []
    for p in pecas:
        pid, rar = str((p or {}).get('id') or ''), (p or {}).get('raridade')
        if not pid or len(pid) > 80 or rar not in LIMITES:
            raise ValueError('peça inválida')
        saida.append((pid, rar))
    return saida


# --- Só peça que existe ------------------------------------------------------
# Cada id novo vira uma chave no item único ESTOQUE#mapa, e o item para em
# 400 KB. Sem esta conferência, umas dezenas de contas mandando ids inventados
# enchiam o item, e aí ninguém mais levava peça nenhuma. A lista é a do
# acervo.json (o mesmo que o jogo lê) mais as `removidas`, que ainda moram em
# guarda-roupas antigos. Fica guardada no processo por um minuto; um id que
# não está nela força uma releitura (peça recém-publicada pela esteira), no
# máximo a cada 10 s.
CACHE_ACERVO, RELER_MIN = 60, 10
_acervo = {'ids': None, 'em': 0.0}


def _ler_ids():
    r = _s3.get_object(Bucket=BUCKET_SITE, Key='assets/acervo.json')
    dados = json.loads(r['Body'].read().decode('utf-8'))
    ids = {str(i.get('id')) for i in dados.get('items') or [] if isinstance(i, dict)}
    ids.update(str(i) for i in dados.get('removidas') or [])
    return ids


def _existe(pid):
    """A peça está no acervo? Se o acervo não puder ser lido, deixa passar:
    a vitrine parada é pior que uma chave a mais no mapa."""
    agora = time.time()
    velho = agora - _acervo['em']
    if _acervo['ids'] is None or velho > CACHE_ACERVO or (
            pid not in _acervo['ids'] and velho > RELER_MIN):
        try:
            _acervo['ids'], _acervo['em'] = _ler_ids(), agora
        except (ClientError, ValueError) as e:
            print('estoque: não li o acervo: %r' % (e,))
            return True
    return pid in _acervo['ids']


def _agora():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _como(valor):
    return valor if valor in COMO else 'vitrine'


def _quando(valor):
    """Data que o navegador mandou (peça antiga), nunca no futuro."""
    agora = _agora()
    texto = str(valor or '')[:30]
    try:
        datetime.fromisoformat(texto.replace('Z', '+00:00'))
    except ValueError:
        return agora
    return min(texto, agora)


def _pk_copia(k, numero):
    return 'COPIA#%s#%d' % (k, numero)


def _dono(usuario, como, em):
    return {'M': {'uid': {'S': usuario['id']}, 'handle': {'S': usuario['handle']},
                  'como': {'S': como}, 'em': {'S': em}}}


def _anotar_dono(k, numero, usuario, como, em):
    _dynamo.update_item(
        TableName=TABELA, Key={'pk': {'S': _pk_copia(k, numero)}},
        UpdateExpression='SET donos = list_append(if_not_exists(donos, :nada), :novo)',
        ExpressionAttributeValues={':nada': {'L': []}, ':novo': {'L': [_dono(usuario, como, em)]}})


def mapa():
    r = _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': PK}}, ConsistentRead=True)
    levadas = (r.get('Item') or {}).get('levadas', {}).get('M', {})
    return {k: int(v['N']) for k, v in levadas.items()}


def _garantir_item():
    # O SET num caminho aninhado exige que o mapa já exista.
    try:
        _dynamo.put_item(TableName=TABELA, Item={'pk': {'S': PK}, 'levadas': {'M': {}}},
                         ConditionExpression='attribute_not_exists(pk)')
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise


def levar(pecas, usuario=None):
    """Reserva uma cópia de cada peça. Devolve as que conseguiu e as esgotadas.

    Com `usuario`, a cópia reservada já entra no histórico com ele de dono e
    conta na cota do dia dele; passada a cota, a peça volta em `limite`."""
    _garantir_item()
    ok, esgotadas, limite, numeros, desconhecidas = [], [], [], {}, []
    comos = [_como((p or {}).get('origem')) for p in pecas or []]
    admin = bool(usuario) and usuario.get('papel') == 'admin'
    for i, (pid, rar) in enumerate(_validar(pecas)):
        k = chave(pid, rar)
        if not admin and not _existe(pid):
            desconhecidas.append(k)
            continue
        if not _gastar_cota(usuario, comos[i]):
            limite.append(k)
            continue
        try:
            # O valor novo do contador é o número da cópia: "nº 12 de 1000".
            feito = _dynamo.update_item(
                TableName=TABELA, Key={'pk': {'S': PK}},
                UpdateExpression='SET levadas.#k = if_not_exists(levadas.#k, :zero) + :um',
                ConditionExpression='attribute_not_exists(levadas.#k) OR levadas.#k < :lim',
                ExpressionAttributeNames={'#k': k},
                ExpressionAttributeValues={':zero': {'N': '0'}, ':um': {'N': '1'},
                                           ':lim': {'N': str(LIMITES[rar])}},
                ReturnValues='UPDATED_NEW')
            ok.append(k)
            n = feito.get('Attributes', {}).get('levadas', {}).get('M', {}).get(k, {}).get('N')
            if n:
                numeros[k] = int(n)
                if usuario:
                    _anotar_dono(k, int(n), usuario, comos[i], _agora())
        except ClientError as e:
            if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            esgotadas.append(k)
            _devolver_cota(usuario, comos[i])
    return {'levadas': ok, 'esgotadas': esgotadas, 'limite': limite, 'numeros': numeros,
            'desconhecidas': desconhecidas, 'mapa': mapa()}


def devolver(pecas):
    """A cópia volta para a loja. Nunca desce de zero."""
    _garantir_item()
    for pid, rar in _validar(pecas):
        try:
            _dynamo.update_item(
                TableName=TABELA, Key={'pk': {'S': PK}},
                UpdateExpression='SET levadas.#k = levadas.#k - :um',
                ConditionExpression='levadas.#k > :zero',
                ExpressionAttributeNames={'#k': chave(pid, rar)},
                ExpressionAttributeValues={':zero': {'N': '0'}, ':um': {'N': '1'}})
        except ClientError as e:
            if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
    return {'mapa': mapa()}


def historico(copias, usuario):
    """POST /api/estoque/historico — {copias: [{id, raridade, numero, origem?, desde?}]}.

    Devolve { "<id>|<raridade>|<n>": [{handle, como, em, voce}, ...] }.

    Cópia numerada antes de o histórico existir não tem item: quem a manda com
    `origem` (as do próprio guarda-roupa) vira o primeiro dono, na data em que
    a pegou. Só cria onde não há nada e só até o número que já saiu da
    tiragem, então ninguém reescreve o passado de uma cópia."""
    if not isinstance(copias, list) or not 0 < len(copias) <= 50:
        raise ValueError('lista de cópias inválida')
    pedidas = {}
    for c in copias:
        c = c or {}
        (pid, rar), = _validar([c])
        try:
            numero = int(c.get('numero'))
        except (TypeError, ValueError):
            raise ValueError('número da cópia inválido')
        if not 0 < numero <= LIMITES[rar]:
            raise ValueError('número da cópia inválido')
        pedidas[_pk_copia(chave(pid, rar), numero)] = (chave(pid, rar), numero, c)

    # Um get por cópia, e não batch_get_item: a ficha pede uma de cada vez, e o
    # papel da Lambda só tem as ações que o resto do app já usa.
    achadas = {}
    for pk in pedidas:
        item = _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': pk}},
                                ConsistentRead=True).get('Item')
        if item:
            achadas[pk] = item.get('donos', {}).get('L', [])

    saidas = None
    resposta = {}
    for pk, (k, numero, c) in pedidas.items():
        donos = achadas.get(pk)
        if donos is None and c.get('origem') and usuario:
            saidas = mapa() if saidas is None else saidas
            if numero <= saidas.get(k, 0):
                dono = _dono(usuario, _como(c.get('origem')), _quando(c.get('desde')))
                try:
                    _dynamo.put_item(TableName=TABELA,
                                     Item={'pk': {'S': pk}, 'donos': {'L': [dono]}},
                                     ConditionExpression='attribute_not_exists(pk)')
                    donos = [dono]
                except ClientError as e:
                    if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
                        raise
                    donos = _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': pk}},
                                             ConsistentRead=True).get('Item', {}) \
                        .get('donos', {}).get('L', [])
        # O uid não sai daqui; a ficha só precisa saber qual dos donos é você.
        resposta['%s|%d' % (k, numero)] = [
            {'handle': d['M']['handle']['S'], 'como': d['M']['como']['S'], 'em': d['M']['em']['S'],
             'voce': bool(usuario) and d['M']['uid']['S'] == usuario['id']}
            for d in donos or []]
    return {'historico': resposta}


# Quanto tempo depois de levar ainda dá para desfazer (a tela dá 10 s; a folga
# cobre a ida e a volta da rede).
DESFAZER_SEG = 60


def desfazer(peca, usuario):
    """POST /api/estoque/desfazer — {id, raridade, numero}: devolve uma cópia
    que você acabou de levar da loja.

    Só vale se o último dono da cópia é você, foi pela loja e faz menos de um
    minuto. Você sai do histórico (o resgate não aconteceu). O contador só
    desce se ninguém levou outra cópia depois: senão o próximo a levar
    receberia um número que já tem dono, e a cópia fica sem ninguém."""
    peca = peca or {}
    (pid, rar), = _validar([peca])
    try:
        numero = int(peca.get('numero'))
    except (TypeError, ValueError):
        raise ValueError('número da cópia inválido')
    k = chave(pid, rar)
    pk = _pk_copia(k, numero)
    item = _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': pk}},
                            ConsistentRead=True).get('Item') or {}
    donos = item.get('donos', {}).get('L', [])
    ultimo = donos[-1]['M'] if donos else {}
    if (ultimo.get('uid', {}).get('S') != usuario['id']
            or ultimo.get('como', {}).get('S') != 'vitrine'):
        raise ValueError('essa cópia não é sua para desfazer')
    try:
        levou = datetime.strptime(ultimo['em']['S'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    except (KeyError, ValueError):
        raise ValueError('essa cópia não é sua para desfazer')
    if (datetime.now(timezone.utc) - levou).total_seconds() > DESFAZER_SEG:
        raise ValueError('passou o tempo de desfazer')

    try:
        _dynamo.update_item(
            TableName=TABELA, Key={'pk': {'S': pk}},
            UpdateExpression='REMOVE donos[%d]' % (len(donos) - 1),
            ConditionExpression='size(donos) = :n',
            ExpressionAttributeValues={':n': {'N': str(len(donos))}})
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        raise ValueError('essa cópia mudou de dono')
    _devolver_cota(usuario, 'vitrine')
    try:
        _dynamo.update_item(
            TableName=TABELA, Key={'pk': {'S': PK}},
            UpdateExpression='SET levadas.#k = levadas.#k - :um',
            ConditionExpression='levadas.#k = :n',
            ExpressionAttributeNames={'#k': k},
            ExpressionAttributeValues={':um': {'N': '1'}, ':n': {'N': str(numero)}})
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
    return {'mapa': mapa()}
