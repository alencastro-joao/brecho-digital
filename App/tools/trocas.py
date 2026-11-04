# -*- coding: utf-8 -*-
"""
Troca de peças no servidor local — espelho de `nuvem/lambda/trocas.py`.

Mesmas rotas, regras e respostas; as ofertas moram num JSON em `dados/`
(`trocas.json`), a amizade vem do SQLite de pessoas e o dono de cada cópia do
`copias.json` do estoque local. Um processo só: a trava faz o papel da
transação do DynamoDB. O porquê de cada regra está no arquivo da Lambda.
"""

import json
import os
import re
import secrets
import threading
from datetime import datetime, timedelta, timezone

import estoque
from contas import ErroDeConta, banco

ARQUIVO = os.path.join(os.path.dirname(estoque.ARQUIVO), 'trocas.json')
RARIDADES = tuple(estoque.LIMITES)
MAX_OPCOES = 4
POR_DIA = 2
ABERTAS_ENVIADAS = 5
ABERTAS_RECEBIDAS = 10
VALIDADE_H = 48
CAIXA_MAX = 40
BRASILIA = timezone(timedelta(hours=-3))
ID_TROCA = re.compile(r'^t-[0-9a-f]{16}$')
_trava = threading.Lock()


def _agora():
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%SZ')


def _ler():
    try:
        with open(ARQUIVO, encoding='utf-8') as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {'trocas': {}, 'cota': {}}


def _gravar(dados):
    os.makedirs(os.path.dirname(ARQUIVO), exist_ok=True)
    with open(ARQUIVO + '.tmp', 'w', encoding='utf-8') as fh:
        json.dump(dados, fh)
    os.replace(ARQUIVO + '.tmp', ARQUIVO)


def _conta(uid):
    with banco() as con:
        linha = con.execute('SELECT id, handle, perfil FROM usuarios WHERE id=?',
                            (str(uid or ''),)).fetchone()
        if not linha:
            raise ErroDeConta('Perfil não encontrado.', 404)
        segue = {r['para'] for r in con.execute('SELECT para FROM segue WHERE de=?', (linha['id'],))}
        seguida = {r['de'] for r in con.execute('SELECT de FROM segue WHERE para=?', (linha['id'],))}
    try:
        perfil = json.loads(linha['perfil'] or '{}')
    except ValueError:
        perfil = {}
    return {'id': linha['id'], 'handle': linha['handle'], 'perfil': perfil,
            'seguindo': segue, 'seguidores': seguida}


def _amigas(a, b):
    return b['id'] in a['seguindo'] and b['id'] in a['seguidores']


def _guarda_roupa(conta):
    ids = conta['perfil'].get('guardaRoupa') or []
    letras = conta['perfil'].get('raridades') or ''
    por_letra = {r[0]: r for r in RARIDADES}
    return {pid: por_letra.get(letras[i:i + 1]) or _fixas().get(pid) for i, pid in enumerate(ids)}


def _fixas():
    """A raridade gravada na ficha de cada peça do acervo local."""
    caminho = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           'assets', 'acervo.json')
    try:
        with open(caminho, encoding='utf-8') as fh:
            itens = json.load(fh).get('items') or []
    except (OSError, ValueError):
        return {}
    return {str(i.get('id')): i['raridade'] for i in itens
            if isinstance(i, dict) and i.get('raridade') in estoque.LIMITES}


def _copia(c, raridade):
    c = c if isinstance(c, dict) else {}
    (pid, rar), = estoque._validar([c])
    if rar != raridade:
        raise ValueError('as duas peças têm que ser da mesma raridade')
    try:
        numero = int(c.get('numero'))
    except (TypeError, ValueError):
        raise ValueError('essa peça não tem número: abra a ficha dela e tente de novo')
    if not 0 < numero <= estoque.LIMITES[rar]:
        raise ValueError('número da cópia inválido')
    return {'id': pid, 'raridade': rar, 'numero': numero,
            'origem': str(c.get('origem') or ''), 'desde': str(c.get('desde') or '')}


def _ck(c):
    return '%s|%d' % (estoque.chave(c['id'], c['raridade']), int(c['numero']))


def _e_dona(usuario, c):
    pedido = {k: c[k] for k in ('id', 'raridade', 'numero')}
    if c.get('origem'):
        pedido.update(origem=c['origem'], desde=c.get('desde'))
    donos = estoque.historico([pedido], usuario)['historico'].get(_ck(c)) or []
    return bool(donos) and donos[-1]['voce']


def _vencida(t, agora=None):
    return t['estado'] == 'aberta' and t['vence'] <= int((agora or _agora()).timestamp())


def _publica(t, eu_id):
    return {
        'id': t['id'], 'estado': 'vencida' if _vencida(t) else t['estado'],
        'souEu': 'de' if t['de'] == eu_id else 'para',
        'de': {'id': t['de'], 'handle': t['deHandle']},
        'para': {'id': t['para'], 'handle': t['paraHandle']},
        'quero': dict(t['quero']), 'opcoes': [dict(o) for o in t['opcoes']],
        'escolhida': t.get('escolhida'), 'motivo': t.get('motivo') or '',
        'criada': t['criada'],
        'vence': _iso(datetime.fromtimestamp(t['vence'], timezone.utc)),
        'resolvida': t.get('resolvida') or '',
        'aplicada': eu_id in (t.get('aplicada') or []),
    }


def _troca(dados, troca_id):
    t = dados['trocas'].get(str(troca_id or '')) if ID_TROCA.match(str(troca_id or '')) else None
    if not t:
        raise ErroDeConta('Troca não encontrada.', 404)
    return t


def listar(usuario):
    with _trava:
        dados = _ler()
    minhas = [t for t in dados['trocas'].values() if usuario['id'] in (t['de'], t['para'])]
    minhas.sort(key=lambda t: t['criada'], reverse=True)
    return {'trocas': [_publica(t, usuario['id']) for t in minhas[:CAIXA_MAX]], 'porDia': POR_DIA}


def propor(usuario, corpo):
    corpo = corpo if isinstance(corpo, dict) else {}
    eu, outra = _conta(usuario['id']), _conta(corpo.get('para'))
    if outra['id'] == eu['id']:
        raise ValueError('não dá para trocar com você mesma')
    if not _amigas(eu, outra):
        raise ErroDeConta('Só dá para trocar com amigos: vocês dois precisam se seguir.', 403)
    quero = corpo.get('quero') if isinstance(corpo.get('quero'), dict) else {}
    (qid, rar), = estoque._validar([quero])
    dela, minhas = _guarda_roupa(outra), _guarda_roupa(eu)
    if dela.get(qid) != rar:
        raise ValueError('essa peça não está mais no guarda-roupa dela')
    if qid in minhas:
        raise ValueError('você já tem essa peça')
    brutas = corpo.get('opcoes')
    if not isinstance(brutas, list) or not 0 < len(brutas) <= MAX_OPCOES:
        raise ValueError('escolha de 1 a %d peças para oferecer' % MAX_OPCOES)
    opcoes, vistas = [], set()
    for b in brutas:
        c = _copia(b, rar)
        if c['id'] in vistas or c['id'] == qid:
            raise ValueError('peça repetida na oferta')
        if c['id'] in dela:
            raise ValueError('ela já tem uma das peças que você ofereceu')
        if not _e_dona(usuario, c):
            raise ValueError('uma das peças oferecidas não é mais sua')
        vistas.add(c['id'])
        opcoes.append({k: c[k] for k in ('id', 'raridade', 'numero')})
    agora = _agora()
    with _trava:
        dados = _ler()
        abertas = [t for t in dados['trocas'].values()
                   if t['estado'] == 'aberta' and not _vencida(t, agora)]
        if sum(1 for t in abertas if t['de'] == eu['id']) >= ABERTAS_ENVIADAS:
            raise ValueError('você já tem %d ofertas esperando resposta' % ABERTAS_ENVIADAS)
        if any(t['de'] == eu['id'] and t['para'] == outra['id'] and t['quero']['id'] == qid
               for t in abertas):
            raise ValueError('você já ofereceu uma troca por essa peça')
        if sum(1 for t in abertas if t['para'] == outra['id']) >= ABERTAS_RECEBIDAS:
            raise ValueError('ela já tem muitas ofertas para responder; tente mais tarde')
        troca_id = 't-' + secrets.token_hex(8)
        t = {'id': troca_id, 'de': eu['id'], 'deHandle': '@' + eu['handle'],
             'para': outra['id'], 'paraHandle': '@' + outra['handle'],
             'quero': {'id': qid, 'raridade': rar}, 'opcoes': opcoes,
             'estado': 'aberta', 'criada': _iso(agora),
             'vence': int((agora + timedelta(hours=VALIDADE_H)).timestamp())}
        dados['trocas'][troca_id] = t
        _gravar(dados)
    return {'troca': _publica(t, eu['id'])}


def _fechar(troca_id, eu_id, quem, estado):
    with _trava:
        dados = _ler()
        t = _troca(dados, troca_id)
        if t[quem] != eu_id:
            raise ErroDeConta('Essa oferta não é sua para responder.', 403)
        if t['estado'] == 'aberta':
            t.update(estado='vencida' if _vencida(t) else estado, resolvida=_iso(_agora()))
            _gravar(dados)
        return {'troca': _publica(t, eu_id)}


def recusar(usuario, troca_id):
    return _fechar(troca_id, usuario['id'], 'para', 'recusada')


def cancelar(usuario, troca_id):
    return _fechar(troca_id, usuario['id'], 'de', 'cancelada')


def aceitar(usuario, troca_id, corpo):
    corpo = corpo if isinstance(corpo, dict) else {}
    with _trava:
        t = _troca(_ler(), troca_id)
    if t['para'] != usuario['id']:
        raise ErroDeConta('Só quem recebeu a oferta pode aceitar.', 403)
    try:
        escolhida = int(corpo.get('escolhida'))
    except (TypeError, ValueError):
        raise ValueError('escolha uma das peças oferecidas')
    if not 0 <= escolhida < len(t['opcoes']):
        raise ValueError('escolha uma das peças oferecidas')
    minha = dict(corpo.get('minha') if isinstance(corpo.get('minha'), dict) else {})
    minha.update(id=t['quero']['id'], raridade=t['quero']['raridade'])
    minha = _copia(minha, t['quero']['raridade'])
    eu_dona = t['estado'] == 'aberta' and _e_dona(usuario, minha)
    eu, outra = _conta(usuario['id']), _conta(t['de'])
    agora = _agora()
    dia = agora.astimezone(BRASILIA).date().isoformat()
    with _trava:
        dados = _ler()
        t = _troca(dados, troca_id)
        registro = estoque.copias()
        fechar = lambda estado, motivo='': t.update(estado=estado, motivo=motivo,
                                                    resolvida=_iso(agora))
        if t['estado'] != 'aberta':
            pass
        elif _vencida(t, agora):
            fechar('vencida')
        elif not eu_dona:
            fechar('invalida', 'a peça pedida não está mais com você')
        elif not _amigas(eu, outra):
            fechar('invalida', 'vocês não são mais amigos')
        else:
            dela = t['opcoes'][escolhida]
            donos_dela = registro.get(_ck(dela)) or []
            if not donos_dela or donos_dela[-1]['uid'] != outra['id']:
                fechar('invalida', 'a peça oferecida já foi para outra pessoa')
            else:
                cota = dados.setdefault('cota', {})
                for uid, nome in ((outra['id'], t['deHandle']), (eu['id'], 'você')):
                    if cota.get('%s#%s' % (uid, dia), 0) >= POR_DIA:
                        raise ValueError('%s já fez as %d trocas de hoje; aceite amanhã'
                                         % (nome, POR_DIA))
                for uid in (outra['id'], eu['id']):
                    cota['%s#%s' % (uid, dia)] = cota.get('%s#%s' % (uid, dia), 0) + 1
                registro.setdefault(_ck(minha), []).append(
                    {'uid': outra['id'], 'handle': '@' + outra['handle'], 'como': 'troca', 'em': _iso(agora)})
                registro[_ck(dela)].append(
                    {'uid': eu['id'], 'handle': '@' + eu['handle'], 'como': 'troca', 'em': _iso(agora)})
                estoque._gravar(registro, estoque.COPIAS)
                t['quero']['numero'] = minha['numero']
                t['escolhida'] = escolhida
                fechar('feita')
        _gravar(dados)
        return {'troca': _publica(t, usuario['id'])}


def aplicada(usuario, troca_id):
    with _trava:
        dados = _ler()
        t = _troca(dados, troca_id)
        if usuario['id'] not in (t['de'], t['para']):
            raise ErroDeConta('Troca não encontrada.', 404)
        t['aplicada'] = sorted(set(t.get('aplicada') or []) | {usuario['id']})
        _gravar(dados)
    return {'ok': True}
