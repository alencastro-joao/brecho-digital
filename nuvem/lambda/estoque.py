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

import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

TABELA = os.environ.get('BD_TABELA') or 'brecho'
PK = 'ESTOQUE#mapa'
_dynamo = boto3.client('dynamodb')

LIMITES = {'common': 1000, 'uncommon': 500, 'rare': 300, 'epic': 100, 'legendary': 25}

# Como a cópia chegou ao dono: as mesmas origens do inventário (js/db.js).
COMO = {'vitrine', 'presente', 'missao', 'semana', 'bau-especial', 'nivel',
        'collab', 'propria', 'teste'}


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

    Com `usuario`, a cópia reservada já entra no histórico com ele de dono."""
    _garantir_item()
    ok, esgotadas, numeros = [], [], {}
    comos = [_como((p or {}).get('origem')) for p in pecas or []]
    for i, (pid, rar) in enumerate(_validar(pecas)):
        k = chave(pid, rar)
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
    return {'levadas': ok, 'esgotadas': esgotadas, 'numeros': numeros, 'mapa': mapa()}


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
