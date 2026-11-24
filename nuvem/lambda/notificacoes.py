# -*- coding: utf-8 -*-
"""
Avisos fora do jogo: a notificação do celular (Web Push), com o app fechado.

O sino (js/avisos.js) só mostra o que mudou quando a pessoa abre o jogo. Este
módulo manda um aviso para o aparelho dela quando vale a pena voltar:

- troca:  alguém propôs uma troca de peça (trocas.propor chama `avisar`);
- postit: chegou post-it novo no mural (o jogo informa quando o próximo chega,
          em POST /api/push/agenda, porque o mural é calculado no save);
- vitrine: a vitrine do dia virou e a pessoa ainda não abriu o jogo hoje.

Regras escolhidas para não irritar: no máximo 1 aviso a cada 3 horas, nada
entre 22h e 8h (horário de Brasília), e nada de post-it/vitrine para quem abriu
o jogo há pouco. A troca que cair no silêncio espera a próxima janela.

Como funciona, sem serviço pago e sem pilha nova na AWS:

- Web Push padrão (Chrome, Edge, Firefox, Safari; no iPhone só com o app na
  tela inicial). O push vai SEM conteúdo: cifrar o conteúdo pede AES-GCM, que o
  Python da Lambda não tem sem biblioteca. Ao receber, o service worker
  (App/sw.js) pede o texto em POST /api/push/aviso e mostra a notificação.
- A assinatura VAPID (ES256) é feita aqui mesmo, em Python puro (curva P-256).
  O par de chaves nasce no primeiro uso e fica no DynamoDB (PUSHCHAVE).
- Os avisos de hora marcada saem pela agenda de 15 minutos que já chama a API
  (infra/pinterest.yaml, `reler-pinterest`): app.handler chama
  `rodar_agendado` antes da leitura do Pinterest.

    PUSHCHAVE         {privada: int em hex, publica: base64url}
    PUSHLISTA         {uids: SS} quem tem algum aparelho inscrito
    PUSH#<uid>        {aparelhos: {h: {endpoint, criado}}, postit, visto,
                       ultimo, vitrineDia, pendente, aviso}
    PUSHEP#<h>        {uid} o aparelho -> a conta (o sw só sabe o endpoint)
"""

import base64
import hashlib
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from botocore.exceptions import ClientError

from contas import TABELA, _dynamo, _pegar, _put, pegar_varios

# O `sub` do VAPID: um contato do remetente (mailto: ou https:). O endereço do
# site basta, e não expõe e-mail de ninguém.
CONTATO = (os.environ.get('BD_SITE_URL') or 'https://dufkck3bmeh9v.cloudfront.net').rstrip('/')
BRASILIA = timezone(timedelta(hours=-3))      # sem horário de verão desde 2019
INTERVALO = 3 * 3600          # no máximo 1 aviso a cada 3 horas
SILENCIO = (22, 8)            # das 22h às 8h não manda nada
HORA_VITRINE = 9              # o aviso da vitrine nova sai a partir das 9h
VISTO_HA_POUCO = 45 * 60      # abriu o jogo há menos que isso: não chama
APARELHOS_MAX = 5
ENDPOINT_MAX = 1000
# Só os serviços de push dos navegadores: o servidor faz POST no endpoint que o
# jogador mandou, e sem esta lista ele viraria um proxy para qualquer endereço.
SERVICOS = ('fcm.googleapis.com', 'updates.push.services.mozilla.com',
            'push.services.mozilla.com', 'web.push.apple.com', 'api.push.apple.com',
            'notify.windows.com')

TEXTOS = {
    'postit': {'titulo': 'Chegou post-it novo', 'texto': 'Tem missão nova no seu mural. Vem cumprir!',
               'url': '#/tarefas'},
    'vitrine': {'titulo': 'A vitrine virou', 'texto': 'Peças novas na vitrine de hoje. Corre antes que acabem!',
                'url': '#/vitrine'},
    'troca': {'titulo': 'Proposta de troca', 'texto': 'Alguém quer trocar uma peça com você.',
              'url': '?sino=1#/vitrine'},
}
GENERICO = {'titulo': 'Brechó Digital', 'texto': 'Tem novidade esperando por você.', 'url': '#/vitrine'}


# --- ES256 em Python puro (curva P-256) -----------------------------------
P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff
N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551
B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b
G = (0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296,
     0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5)


def _somar(p, q):
    if p is None:
        return q
    if q is None:
        return p
    (x1, y1), (x2, y2) = p, q
    if x1 == x2:
        if (y1 + y2) % P == 0:
            return None
        m = (3 * x1 * x1 - 3) * pow(2 * y1, -1, P) % P
    else:
        m = (y2 - y1) * pow(x2 - x1, -1, P) % P
    x3 = (m * m - x1 - x2) % P
    return x3, (m * (x1 - x3) - y1) % P


def _vezes(k, ponto=G):
    r = None
    while k:
        if k & 1:
            r = _somar(r, ponto)
        ponto = _somar(ponto, ponto)
        k >>= 1
    return r


def na_curva(ponto):
    x, y = ponto
    return (y * y - (x * x * x - 3 * x + B)) % P == 0


def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode('ascii')


def _de_b64(s):
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def _ponto_em_bytes(ponto):
    return b'\x04' + ponto[0].to_bytes(32, 'big') + ponto[1].to_bytes(32, 'big')


def novo_par():
    d = secrets.randbelow(N - 1) + 1
    return d, _ponto_em_bytes(_vezes(d))


def assinar(d, mensagem):
    """ECDSA P-256 com SHA-256; devolve r||s (64 bytes), o formato do JWS."""
    z = int.from_bytes(hashlib.sha256(mensagem).digest(), 'big')
    while True:
        k = secrets.randbelow(N - 1) + 1
        r = _vezes(k)[0] % N
        if not r:
            continue
        s = pow(k, -1, N) * (z + r * d) % N
        if s:
            return r.to_bytes(32, 'big') + s.to_bytes(32, 'big')


def conferir(publica, mensagem, assinatura):
    """Verificação ECDSA (só os testes usam)."""
    x, y = int.from_bytes(publica[1:33], 'big'), int.from_bytes(publica[33:], 'big')
    r, s = int.from_bytes(assinatura[:32], 'big'), int.from_bytes(assinatura[32:], 'big')
    if not (0 < r < N and 0 < s < N):
        return False
    z = int.from_bytes(hashlib.sha256(mensagem).digest(), 'big')
    w = pow(s, -1, N)
    ponto = _somar(_vezes(z * w % N), _vezes(r * w % N, (x, y)))
    return ponto is not None and ponto[0] % N == r


# --- Chave VAPID ------------------------------------------------------------
_chave = None


def _par_vapid():
    global _chave
    if _chave:
        return _chave
    item = _pegar('PUSHCHAVE')
    if not item:
        d, pub = novo_par()
        put = _put({'pk': 'PUSHCHAVE', 'privada': '%064x' % d, 'publica': _b64(pub)})
        put['ConditionExpression'] = 'attribute_not_exists(pk)'
        try:
            _dynamo.put_item(**put)
        except ClientError as e:
            if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
        item = _pegar('PUSHCHAVE')         # outra Lambda pode ter criado antes
    _chave = (int(item['privada'], 16), item['publica'])
    return _chave


def chave_publica():
    """GET /api/push/chave — a applicationServerKey do pushManager.subscribe."""
    return {'chave': _par_vapid()[1]}


def _cabecalho_vapid(endpoint):
    d, publica = _par_vapid()
    u = urllib.parse.urlsplit(endpoint)
    topo = _b64(json.dumps({'typ': 'JWT', 'alg': 'ES256'}, separators=(',', ':')).encode())
    corpo = _b64(json.dumps({'aud': '%s://%s' % (u.scheme, u.netloc), 'exp': int(time.time()) + 12 * 3600,
                             'sub': CONTATO}, separators=(',', ':')).encode())
    assinado = (topo + '.' + corpo).encode('ascii')
    jwt = topo + '.' + corpo + '.' + _b64(assinar(d, assinado))
    return 'vapid t=%s, k=%s' % (jwt, publica)


# --- Aparelhos --------------------------------------------------------------
def _hash(endpoint):
    return hashlib.sha256(endpoint.encode('utf-8')).hexdigest()[:32]


def _endpoint_valido(endpoint):
    if not isinstance(endpoint, str) or not 0 < len(endpoint) <= ENDPOINT_MAX:
        raise ValueError('aparelho inválido')
    u = urllib.parse.urlsplit(endpoint)
    host = (u.hostname or '').lower()
    if u.scheme != 'https' or u.port not in (None, 443) or u.username or u.password:
        raise ValueError('aparelho inválido')
    if not any(host == s or host.endswith('.' + s) for s in SERVICOS):
        raise ValueError('esse navegador não tem um serviço de avisos conhecido')
    return endpoint


def _agora():
    return int(time.time())


def _num(v):
    return int(v) if v is not None else 0


def _mudar_lista(acao, uid):
    _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': 'PUSHLISTA'}},
                        UpdateExpression='%s uids :u' % acao,
                        ExpressionAttributeValues={':u': {'SS': [uid]}})


def inscrever(usuario, corpo):
    """POST /api/push/inscrever — {endpoint, postit?}: liga os avisos neste aparelho."""
    corpo = corpo if isinstance(corpo, dict) else {}
    endpoint = _endpoint_valido(corpo.get('endpoint'))
    uid, h = usuario['id'], _hash(endpoint)
    item = _pegar('PUSH#' + uid) or {'pk': 'PUSH#' + uid, 'aparelhos': {}}
    aparelhos = dict(item.get('aparelhos') or {})
    aparelhos[h] = {'endpoint': endpoint, 'criado': _agora()}
    # Aparelho demais: sai o mais velho (e o vínculo dele).
    while len(aparelhos) > APARELHOS_MAX:
        velho = min(aparelhos, key=lambda k: _num(aparelhos[k].get('criado')))
        aparelhos.pop(velho)
        _dynamo.delete_item(TableName=TABELA, Key={'pk': {'S': 'PUSHEP#' + velho}})
    item['aparelhos'] = aparelhos
    item['visto'] = _agora()
    item.update(_postit_do_corpo(corpo))
    _dynamo.put_item(**_put(item))
    _dynamo.put_item(**_put({'pk': 'PUSHEP#' + h, 'uid': uid}))
    _mudar_lista('ADD', uid)
    return {'ok': True, 'aparelhos': len(aparelhos)}


def _tirar_aparelho(uid, h):
    item = _pegar('PUSH#' + uid)
    _dynamo.delete_item(TableName=TABELA, Key={'pk': {'S': 'PUSHEP#' + h}})
    if not item:
        return 0
    aparelhos = dict(item.get('aparelhos') or {})
    aparelhos.pop(h, None)
    if aparelhos:
        _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': 'PUSH#' + uid}},
                            UpdateExpression='SET aparelhos = :a',
                            ExpressionAttributeValues={':a': _put({'a': aparelhos})['Item']['a']})
    else:
        _dynamo.delete_item(TableName=TABELA, Key={'pk': {'S': 'PUSH#' + uid}})
        _mudar_lista('DELETE', uid)
    return len(aparelhos)


def desinscrever(usuario, corpo):
    """POST /api/push/sair — {endpoint}: desliga os avisos neste aparelho."""
    corpo = corpo if isinstance(corpo, dict) else {}
    endpoint = corpo.get('endpoint')
    if not isinstance(endpoint, str) or len(endpoint) > ENDPOINT_MAX:
        raise ValueError('aparelho inválido')
    return {'ok': True, 'aparelhos': _tirar_aparelho(usuario['id'], _hash(endpoint))}


def _postit_do_corpo(corpo):
    p = corpo.get('postit')
    if isinstance(p, (int, float)) and not isinstance(p, bool) and 0 < p < 1e13:
        return {'postit': int(p // 1000)}           # o jogo manda em ms
    return {'postit': 0}


def agenda(usuario, corpo):
    """POST /api/push/agenda — {postit: ms do próximo post-it | null}. O jogo
    chama ao abrir e quando o mural muda: também marca que a pessoa está aqui."""
    corpo = corpo if isinstance(corpo, dict) else {}
    valores = {':v': {'N': str(_agora())}, ':p': {'N': str(_postit_do_corpo(corpo)['postit'])}}
    try:
        _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': 'PUSH#' + usuario['id']}},
                            UpdateExpression='SET visto = :v, postit = :p',
                            ConditionExpression='attribute_exists(pk)',
                            ExpressionAttributeValues=valores)
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        return {'ok': True, 'inscrito': False}
    return {'ok': True, 'inscrito': True}


def aviso_do_aparelho(corpo):
    """POST /api/push/aviso — {endpoint}: o texto do último aviso deste aparelho.
    O sw chama ao receber o push (que vem vazio). O endpoint é o segredo: só o
    navegador inscrito o conhece."""
    corpo = corpo if isinstance(corpo, dict) else {}
    endpoint = corpo.get('endpoint')
    if not isinstance(endpoint, str) or len(endpoint) > ENDPOINT_MAX:
        return dict(GENERICO)
    vinculo = _pegar('PUSHEP#' + _hash(endpoint), consistente=False)
    item = vinculo and _pegar('PUSH#' + vinculo['uid'])
    if not item or not (item.get('aparelhos') or {}).get(_hash(endpoint)):
        return dict(GENERICO)
    return {k: (item.get('aviso') or GENERICO).get(k, GENERICO[k]) for k in GENERICO}


# --- Mandar -----------------------------------------------------------------
def _silencio(agora):
    hora = datetime.fromtimestamp(agora, BRASILIA).hour
    comeca, termina = SILENCIO
    return hora >= comeca or hora < termina


def _pode_mandar(item, agora):
    return not _silencio(agora) and agora - _num(item.get('ultimo')) >= INTERVALO


def _empurrar(endpoint):
    """Manda o push vazio. Devolve False se o aparelho não existe mais."""
    pedido = urllib.request.Request(endpoint, data=b'', method='POST', headers={
        'Authorization': _cabecalho_vapid(endpoint), 'TTL': str(12 * 3600),
        'Urgency': 'normal'})
    try:
        with urllib.request.urlopen(pedido, timeout=8):
            return True
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            return False
        print('push: %s respondeu %s' % (urllib.parse.urlsplit(endpoint).hostname, e.code))
        return True
    except (urllib.error.URLError, OSError) as e:
        print('push: falha ao mandar: %r' % (e,))
        return True


def _mandar(item, tipo, agora, extra=None):
    uid = item['pk'].split('#', 1)[1]
    aviso = dict(TEXTOS[tipo], **(extra or {}))
    aviso['em'] = agora
    sets = {'ultimo': agora, 'aviso': aviso}
    if tipo == 'postit':
        sets['postit'] = 0
    if tipo == 'vitrine':
        sets['vitrineDia'] = datetime.fromtimestamp(agora, BRASILIA).date().isoformat()
    expr = 'SET ' + ', '.join('%s = :%s' % (k, k) for k in sets)
    if tipo == 'troca':
        expr += ' REMOVE pendente'
    _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': item['pk']}}, UpdateExpression=expr,
                        ExpressionAttributeValues={':' + k: v for k, v in _put(sets)['Item'].items()})
    mortos = [h for h, a in (item.get('aparelhos') or {}).items() if not _empurrar(a['endpoint'])]
    for h in mortos:
        _tirar_aparelho(uid, h)
    return True


def avisar(uid, tipo, extra=None, agora=None):
    """Aviso que nasce de uma ação de outra pessoa (a troca). Sai na hora se
    puder; senão fica pendente e a agenda manda na próxima janela."""
    try:
        agora = agora or _agora()
        item = _pegar('PUSH#' + uid)
        if not item or not item.get('aparelhos'):
            return False
        if _pode_mandar(item, agora):
            return _mandar(item, tipo, agora, extra)
        pendente = dict(extra or {}, tipo=tipo)
        _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': item['pk']}},
                            UpdateExpression='SET pendente = :p',
                            ExpressionAttributeValues={':p': _put({'p': pendente})['Item']['p']})
        return False
    except Exception as e:                    # noqa: BLE001 — aviso nunca derruba a troca
        print('push: avisar %s falhou: %r' % (tipo, e))
        return False


def _o_que_mandar(item, agora):
    """(tipo, extra) do aviso que vale agora para esta pessoa, ou None."""
    if not item.get('aparelhos') or not _pode_mandar(item, agora):
        return None
    pendente = item.get('pendente')
    if isinstance(pendente, dict) and pendente.get('tipo') in TEXTOS:
        extra = {k: v for k, v in pendente.items() if k in ('titulo', 'texto', 'url')}
        return pendente['tipo'], extra
    visto = _num(item.get('visto'))
    if agora - visto < VISTO_HA_POUCO:
        return None
    postit = _num(item.get('postit'))
    if postit and postit <= agora and visto < postit:
        return 'postit', None
    hoje = datetime.fromtimestamp(agora, BRASILIA)
    inicio_do_dia = int(hoje.replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
    if (hoje.hour >= HORA_VITRINE and item.get('vitrineDia') != hoje.date().isoformat()
            and visto < inicio_do_dia):
        return 'vitrine', None
    return None


def rodar_agendado(agora=None):
    """Chamado a cada 15 minutos pela agenda (app.handler)."""
    agora = agora or _agora()
    if _silencio(agora):
        return {'mandados': 0, 'silencio': True}
    lista = _pegar('PUSHLISTA', consistente=False) or {}
    uids = sorted(lista.get('uids') or [])
    itens = pegar_varios(['PUSH#' + u for u in uids], consistente=False)
    mandados = 0
    for item in itens.values():
        escolha = _o_que_mandar(item, agora)
        if escolha:
            try:
                _mandar(item, escolha[0], agora, escolha[1])
                mandados += 1
            except Exception as e:            # noqa: BLE001 — um aparelho ruim não para os outros
                print('push: %s falhou: %r' % (item['pk'], e))
    return {'mandados': mandados, 'inscritos': len(uids)}
