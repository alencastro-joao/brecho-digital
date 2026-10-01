# -*- coding: utf-8 -*-
"""
Tiragem limitada no servidor local — espelho de `nuvem/lambda/estoque.py`.

Mesma API (`mapa`, `levar`, `devolver`) e mesmas chaves `<id>|<raridade>`; o
contador mora num JSON em `dados/` em vez do DynamoDB. Um processo só, então
uma trava basta para a última cópia não sair duas vezes.
"""

import json
import os
import threading

ARQUIVO = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       'dados', 'estoque.json')
LIMITES = {'common': 1000, 'uncommon': 500, 'rare': 300, 'epic': 100, 'legendary': 25}
_trava = threading.Lock()


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


def _ler():
    try:
        with open(ARQUIVO, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _gravar(dados):
    os.makedirs(os.path.dirname(ARQUIVO), exist_ok=True)
    with open(ARQUIVO + '.tmp', 'w', encoding='utf-8') as fh:
        json.dump(dados, fh)
    os.replace(ARQUIVO + '.tmp', ARQUIVO)


def mapa():
    with _trava:
        return _ler()


def levar(pecas):
    lista = _validar(pecas)
    with _trava:
        dados = _ler()
        ok, esgotadas = [], []
        for pid, rar in lista:
            k = chave(pid, rar)
            if dados.get(k, 0) < LIMITES[rar]:
                dados[k] = dados.get(k, 0) + 1
                ok.append(k)
            else:
                esgotadas.append(k)
        _gravar(dados)
        return {'levadas': ok, 'esgotadas': esgotadas, 'mapa': dados}


def devolver(pecas):
    lista = _validar(pecas)
    with _trava:
        dados = _ler()
        for pid, rar in lista:
            k = chave(pid, rar)
            if dados.get(k, 0) > 0:
                dados[k] -= 1
        _gravar(dados)
        return {'mapa': dados}
