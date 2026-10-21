# -*- coding: utf-8 -*-
"""
As roupas do avatar cadastradas pelo admin (Admin › Roupas do avatar) —
`PUT /api/roupas-avatar` e `DELETE /api/roupas-avatar/<id>`.

São as peças desenhadas que entram nas coleções (e por elas dão o efeito da
coleção), como os óculos de `OCULOS_DESENHADOS` em App/js/config.js, só que
sem mexer no código. Ficam numa chave a mais do próprio acervo.json:

    "roupasAvatar": [
      {"id": "oculos-x", "nome": "Óculos X", "slot": "acessorio", "z": 62,
       "src": "assets/cloths/avatar-oculos-x-mg2k9x.webp",
       "caixa": [212, 110, 172, 82], "colecoes": ["cor-preto", "puma"]}
    ]

O acervo.json já é o arquivo que só a Lambda escreve e que o jogo lê na
abertura; a imagem vai para `assets/cloths/`, com o relógio no nome (trocar a
imagem gera outro nome, e o cache de um ano do CloudFront nunca serve a
antiga). O jogo monta uma peça por coleção marcada (roupinhas.js).

As roupas que já estão no código (ROUPAS_BASE e OCULOS_DESENHADOS) não são
regravadas: o admin só ajusta tamanho, posição e, nos óculos, em quais cores
eles entram. Isso vai em outra chave, por id da roupa do código:

    "ajustesRoupas": {"oculos-espinhos": {"caixa": [212, 110, 172, 82],
                                          "cores": ["Preto", "Azul"]}}
"""

import re
import time

from acervo import ID_OK, gravar_acervo, ler_acervo, salvar_imagem, _agora

SLOTS = {'cabeca', 'torso', 'pernas', 'acessorio', 'cintura', 'pes'}
COLECAO_OK = re.compile(r'^[a-z0-9-]{1,40}$')
SRC_OK = re.compile(r'^assets/[a-z0-9_./-]{1,120}\.(webp|png)$')
MAX_COLECOES = 20


def _caixa(valor):
    if not isinstance(valor, list) or len(valor) != 4:
        raise ValueError('caixa inválida')
    try:
        x, y, w, h = (round(float(v), 1) for v in valor)
    except (TypeError, ValueError):
        raise ValueError('caixa inválida')
    if not (-600 <= x <= 1200 and -600 <= y <= 1800 and 4 <= w <= 1200 and 4 <= h <= 2400):
        raise ValueError('caixa fora do palco')
    return [x, y, w, h]


def _colecoes(valor):
    if not isinstance(valor, list) or not valor:
        raise ValueError('marque pelo menos uma coleção')
    ids = []
    for c in valor:
        c = str(c or '').strip().lower()
        if not COLECAO_OK.match(c):
            raise ValueError('coleção inválida: %r' % c)
        if c not in ids:
            ids.append(c)
    return ids[:MAX_COLECOES]


def ficha(corpo, anterior=None):
    """Valida o que veio do admin. A imagem nova é gravada à parte."""
    item_id = str(corpo.get('id') or '').strip().lower()
    if not ID_OK.match(item_id):
        raise ValueError('id inválido (letras minúsculas, números e hífen)')
    nome = str(corpo.get('nome') or '').strip()[:60]
    if not nome:
        raise ValueError('dê um nome à roupa')
    slot = corpo.get('slot')
    if slot not in SLOTS:
        raise ValueError('lugar do corpo inválido')
    z = corpo.get('z')
    item = {'id': item_id, 'nome': nome, 'slot': slot,
            'caixa': _caixa(corpo.get('caixa')), 'colecoes': _colecoes(corpo.get('colecoes'))}
    if z not in (None, ''):
        z = int(z)
        if not 0 <= z <= 100:
            raise ValueError('camada inválida')
        item['z'] = z
    src = str(corpo.get('src') or (anterior or {}).get('src') or '').strip()
    if src and (not SRC_OK.match(src) or '..' in src):
        raise ValueError('caminho de imagem inválido')
    item['src'] = src
    return item


COR_OK = re.compile(r'^[A-Za-zÀ-ú]{1,20}$')


def ajustar(corpo):
    """Ajuste de uma roupa do código; `restaurar` volta ao que o código diz."""
    item_id = str(corpo.get('id') or '').strip().lower()
    if not ID_OK.match(item_id):
        raise ValueError('id inválido')
    ajuste = None
    if not corpo.get('restaurar'):
        ajuste = {'caixa': _caixa(corpo.get('caixa'))}
        cores = corpo.get('cores')
        if cores is not None:
            if not isinstance(cores, list) or not cores or not all(COR_OK.match(str(c)) for c in cores):
                raise ValueError('marque pelo menos uma cor')
            ajuste['cores'] = list(dict.fromkeys(str(c) for c in cores))[:MAX_COLECOES]
        ajuste['editadoEm'] = _agora()
    for _ in range(5):
        acervo, etag = ler_acervo()
        ajustes = acervo.get('ajustesRoupas')
        ajustes = dict(ajustes) if isinstance(ajustes, dict) else {}
        if ajuste:
            ajustes[item_id] = ajuste
        else:
            ajustes.pop(item_id, None)
        acervo['ajustesRoupas'] = ajustes
        if gravar_acervo(acervo, etag):
            print('roupa do código ajustada: %s %r' % (item_id, ajuste))
            return {'id': item_id, 'ajuste': ajuste}
    raise RuntimeError('o acervo está sendo escrito por outra aba; tente de novo')


def gravar(corpo):
    """Cria ou substitui a roupa com esse id."""
    if corpo.get('tipo') == 'ajuste':
        return ajustar(corpo)
    item_id = str(corpo.get('id') or '').strip().lower()
    anterior = next((r for r in ler_acervo()[0].get('roupasAvatar') or []
                     if r.get('id') == item_id), None)
    item = ficha(corpo, anterior)
    if corpo.get('imagem'):
        selo = format(int(time.time()), 'x')
        item['src'], _peso = salvar_imagem('avatar-' + item_id, corpo['imagem'], '-' + selo)
    if not item['src']:
        raise ValueError('escolha a imagem da roupa')

    for _ in range(5):
        acervo, etag = ler_acervo()
        lista = [r for r in acervo.get('roupasAvatar') or [] if isinstance(r, dict)]
        velha = next((r for r in lista if r.get('id') == item['id']), None)
        item['criadoEm'] = (velha or {}).get('criadoEm') or _agora()
        if velha:
            item['editadoEm'] = _agora()
            lista = [item if r is velha else r for r in lista]
        else:
            lista.append(item)
        acervo['roupasAvatar'] = lista
        if gravar_acervo(acervo, etag):
            print('roupa do avatar gravada: %s %s' % (item['id'], item['colecoes']))
            return item
    raise RuntimeError('o acervo está sendo escrito por outra aba; tente de novo')


def apagar(item_id):
    """Sai da lista. A imagem fica no bucket: quem já vestiu não fica com um
    buraco até recarregar, e o arquivo é pequeno."""
    item_id = str(item_id or '').strip().lower()
    if not ID_OK.match(item_id):
        raise ValueError('id inválido')
    for _ in range(5):
        acervo, etag = ler_acervo()
        lista = acervo.get('roupasAvatar') or []
        if not any(r.get('id') == item_id for r in lista):
            raise ValueError('essa roupa não está cadastrada')
        acervo['roupasAvatar'] = [r for r in lista if r.get('id') != item_id]
        if gravar_acervo(acervo, etag):
            return {'id': item_id}
    raise RuntimeError('o acervo está sendo escrito por outra aba; tente de novo')
