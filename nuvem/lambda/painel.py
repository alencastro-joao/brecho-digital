# -*- coding: utf-8 -*-
"""
Painel do administrador — `GET /api/admin/painel`: os números do dia.

Só a conta: recebe o que já foi lido (contas, sessões, posts, a tiragem e o
histórico das cópias) e devolve o resumo. Sem boto3 aqui, para o servidor
local (App/tools/servidor.py) montar o mesmo painel com o SQLite dele.

"Hoje" é o dia em Brasília (UTC−3), que é o dia de quem joga: a loja e as
missões viram à meia-noite de lá, não à de Greenwich.
"""

from collections import Counter
from datetime import datetime, timedelta, timezone

BRASILIA = timezone(timedelta(hours=-3))
SESSAO_DIAS = 30        # a sessão vale 30 dias a partir do último uso (contas.py)


def _dia(iso):
    """Data em Brasília ('2026-10-16') de um ISO qualquer, ou None."""
    try:
        dt = datetime.fromisoformat(str(iso).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(BRASILIA).date().isoformat()


def ultimo_uso_da_sessao(expira_em):
    """A sessão é renovada a cada uso para durar mais 30 dias: o último uso é a
    validade menos 30 dias."""
    try:
        dt = datetime.fromisoformat(str(expira_em).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    return (dt - timedelta(days=SESSAO_DIAS)).isoformat()


def resumir(contas, posts, levadas, limites, copias, agora=None):
    """
    contas   [{id, criado_em, ultimo_uso}]   ultimo_uso: login ou sessão, o mais novo
    posts    [{criado_em}]                   só os de contas de verdade
    levadas  {"<id>|<raridade>": n}          a tiragem (ESTOQUE#mapa)
    limites  {raridade: tiragem}
    copias   {"<id>|<raridade>|<n>": [{uid, como, em}, ...]}
    """
    agora = agora or datetime.now(timezone.utc)
    hoje = agora.astimezone(BRASILIA).date()
    dias7 = {(hoje - timedelta(days=i)).isoformat() for i in range(7)}
    hoje = hoje.isoformat()

    ativos = {c['id'] for c in contas if _dia(c.get('ultimo_uso')) == hoje}
    ativos7 = {c['id'] for c in contas if _dia(c.get('ultimo_uso')) in dias7}

    # O que saiu hoje vem do histórico das cópias: cada dono anotado hoje.
    hoje_por_peca, por_origem, quem_levou = Counter(), Counter(), set()
    for chave, donos in copias.items():
        pid = chave.split('|')[0]
        for d in donos:
            if _dia(d.get('em')) == hoje:
                hoje_por_peca[pid] += 1
                por_origem[d.get('como') or 'vitrine'] += 1
                quem_levou.add(d.get('uid'))

    por_peca = Counter()
    esgotadas = []
    for chave, n in levadas.items():
        pid, rar = (chave.split('|') + [''])[:2]
        por_peca[pid] += n
        if rar in limites and n >= limites[rar]:
            esgotadas.append({'id': pid, 'raridade': rar})

    return {
        'hoje': hoje,
        'contas': {
            'total': len(contas),
            'novasHoje': sum(1 for c in contas if _dia(c.get('criado_em')) == hoje),
            'novas7': sum(1 for c in contas if _dia(c.get('criado_em')) in dias7),
            'ativasHoje': len(ativos),
            'ativas7': len(ativos7),
        },
        'posts': {
            'total': len(posts),
            'hoje': sum(1 for p in posts if _dia(p.get('criado_em')) == hoje),
        },
        'pecas': {
            'levadasHoje': sum(hoje_por_peca.values()),
            'quemLevouHoje': len(quem_levou),
            'porOrigemHoje': dict(por_origem),
            'maisLevadasHoje': [{'id': i, 'n': n} for i, n in hoje_por_peca.most_common(8)],
            'copiasNoJogo': sum(levadas.values()),
            'maisLevadas': [{'id': i, 'n': n} for i, n in por_peca.most_common(8)],
            'esgotadas': esgotadas,
        },
    }
