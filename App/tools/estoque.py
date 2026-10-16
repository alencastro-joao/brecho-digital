# -*- coding: utf-8 -*-
"""
Tiragem limitada no servidor local — espelho de `nuvem/lambda/estoque.py`.

Mesma API (`mapa`, `levar`, `devolver`, `historico`) e mesmas chaves
`<id>|<raridade>`; o contador mora num JSON em `dados/` em vez do DynamoDB, e o
histórico de cada cópia em outro (`copias.json`). Um processo só, então uma
trava basta para a última cópia não sair duas vezes.
"""

import json
import os
import threading
from datetime import datetime, timezone

ARQUIVO = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       'dados', 'estoque.json')
COPIAS = os.path.join(os.path.dirname(ARQUIVO), 'copias.json')
LIMITES = {'common': 1000, 'uncommon': 500, 'rare': 300, 'epic': 100, 'legendary': 25}
COMO = {'vitrine', 'presente', 'missao', 'semana', 'bau-especial', 'nivel',
        'collab', 'propria', 'teste'}
_trava = threading.Lock()


def _agora():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _como(valor):
    return valor if valor in COMO else 'vitrine'


def _quando(valor):
    agora = _agora()
    texto = str(valor or '')[:30]
    try:
        datetime.fromisoformat(texto.replace('Z', '+00:00'))
    except ValueError:
        return agora
    return min(texto, agora)


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


def _ler(arquivo=ARQUIVO):
    try:
        with open(arquivo, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _gravar(dados, arquivo=ARQUIVO):
    os.makedirs(os.path.dirname(arquivo), exist_ok=True)
    with open(arquivo + '.tmp', 'w', encoding='utf-8') as fh:
        json.dump(dados, fh)
    os.replace(arquivo + '.tmp', arquivo)


def mapa():
    with _trava:
        return _ler()


def levar(pecas, usuario=None):
    lista = _validar(pecas)
    comos = [_como((p or {}).get('origem')) for p in pecas]
    with _trava:
        dados = _ler()
        copias = _ler(COPIAS)
        ok, esgotadas, numeros = [], [], {}
        for i, (pid, rar) in enumerate(lista):
            k = chave(pid, rar)
            if dados.get(k, 0) < LIMITES[rar]:
                dados[k] = dados.get(k, 0) + 1
                ok.append(k)
                numeros[k] = dados[k]
                if usuario:
                    copias.setdefault('%s|%d' % (k, dados[k]), []).append(
                        {'uid': usuario['id'], 'handle': usuario['handle'],
                         'como': comos[i], 'em': _agora()})
            else:
                esgotadas.append(k)
        _gravar(dados)
        _gravar(copias, COPIAS)
        return {'levadas': ok, 'esgotadas': esgotadas, 'numeros': numeros, 'mapa': dados}


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


def historico(copias, usuario):
    """Mesmo contrato de nuvem/lambda/estoque.py: cria o primeiro dono das
    cópias antigas que vêm com `origem`, e devolve por quem cada uma passou."""
    if not isinstance(copias, list) or not 0 < len(copias) <= 50:
        raise ValueError('lista de cópias inválida')
    with _trava:
        dados = _ler()
        registro = _ler(COPIAS)
        resposta, mudou = {}, False
        for c in copias:
            c = c or {}
            (pid, rar), = _validar([c])
            try:
                numero = int(c.get('numero'))
            except (TypeError, ValueError):
                raise ValueError('número da cópia inválido')
            if not 0 < numero <= LIMITES[rar]:
                raise ValueError('número da cópia inválido')
            k = chave(pid, rar)
            ck = '%s|%d' % (k, numero)
            if ck not in registro and c.get('origem') and usuario and numero <= dados.get(k, 0):
                registro[ck] = [{'uid': usuario['id'], 'handle': usuario['handle'],
                                 'como': _como(c.get('origem')), 'em': _quando(c.get('desde'))}]
                mudou = True
            resposta[ck] = [{'handle': d['handle'], 'como': d['como'], 'em': d['em'],
                             'voce': bool(usuario) and d['uid'] == usuario['id']}
                            for d in registro.get(ck, [])]
        if mudou:
            _gravar(registro, COPIAS)
        return {'historico': resposta}


DESFAZER_SEG = 60


def desfazer(peca, usuario):
    """Mesmo contrato de nuvem/lambda/estoque.py: devolve a cópia que você
    acabou de levar da loja (último dono, pela loja, há menos de um minuto)."""
    peca = peca or {}
    (pid, rar), = _validar([peca])
    try:
        numero = int(peca.get('numero'))
    except (TypeError, ValueError):
        raise ValueError('número da cópia inválido')
    k = chave(pid, rar)
    ck = '%s|%d' % (k, numero)
    with _trava:
        dados = _ler()
        registro = _ler(COPIAS)
        donos = registro.get(ck) or []
        ultimo = donos[-1] if donos else {}
        if ultimo.get('uid') != usuario['id'] or ultimo.get('como') != 'vitrine':
            raise ValueError('essa cópia não é sua para desfazer')
        levou = datetime.strptime(ultimo['em'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        if (datetime.now(timezone.utc) - levou).total_seconds() > DESFAZER_SEG:
            raise ValueError('passou o tempo de desfazer')
        donos.pop()
        registro[ck] = donos
        if dados.get(k) == numero:
            dados[k] = numero - 1
        _gravar(dados)
        _gravar(registro, COPIAS)
        return {'mapa': dados}


def copias():
    with _trava:
        return _ler(COPIAS)
