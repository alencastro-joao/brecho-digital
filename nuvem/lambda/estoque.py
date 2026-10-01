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
"""

import os

import boto3
from botocore.exceptions import ClientError

TABELA = os.environ.get('BD_TABELA') or 'brecho'
PK = 'ESTOQUE#mapa'
_dynamo = boto3.client('dynamodb')

LIMITES = {'common': 1000, 'uncommon': 500, 'rare': 300, 'epic': 100, 'legendary': 25}


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


def levar(pecas):
    """Reserva uma cópia de cada peça. Devolve as que conseguiu e as esgotadas."""
    _garantir_item()
    ok, esgotadas = [], []
    for pid, rar in _validar(pecas):
        k = chave(pid, rar)
        try:
            _dynamo.update_item(
                TableName=TABELA, Key={'pk': {'S': PK}},
                UpdateExpression='SET levadas.#k = if_not_exists(levadas.#k, :zero) + :um',
                ConditionExpression='attribute_not_exists(levadas.#k) OR levadas.#k < :lim',
                ExpressionAttributeNames={'#k': k},
                ExpressionAttributeValues={':zero': {'N': '0'}, ':um': {'N': '1'},
                                           ':lim': {'N': str(LIMITES[rar])}})
            ok.append(k)
        except ClientError as e:
            if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
            esgotadas.append(k)
    return {'levadas': ok, 'esgotadas': esgotadas, 'mapa': mapa()}


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
