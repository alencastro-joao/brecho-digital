# -*- coding: utf-8 -*-
"""
Contas de fora ligadas de verdade: Instagram e Pinterest, por OAuth.

O caminho é o de sempre do OAuth:

    1. o app abre  /api/redes/<servico>/entrar  (navegação, não fetch);
    2. daqui a pessoa vai para a tela de login do Instagram ou do Pinterest,
       levando um `state` que só esta conta conhece (REDESTATE#..., 15 min);
    3. lá ela autoriza e volta em  /api/redes/<servico>/volta?code=...&state=...
    4. trocamos o `code` por um token, lemos o @ de verdade e voltamos para o
       perfil (/?rede=<servico>#/perfil).

O token nunca sai do servidor. O que o navegador e os outros perfis veem é só
o @, guardado também no item da conta (`redes`), para o cartão público.

As chaves dos apps (App ID e segredo, criados pelo dono no Meta for
Developers e no Pinterest Developers) entram pela tela de Administração e
moram em REDECFG#<servico>. O segredo nunca volta para o navegador.

Itens:
    REDECFG#<servico>          app_id, segredo
    REDESTATE#<state>          uid, servico, ttl
    REDE#<uid>#<servico>       usuario, token, expira, em
"""

import base64
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import boto3

TABELA = os.environ.get('BD_TABELA') or 'brecho'
SITE = (os.environ.get('BD_SITE_URL') or 'https://dufkck3bmeh9v.cloudfront.net').rstrip('/')
_dynamo = boto3.client('dynamodb')

SERVICOS = {
    # Instagram API com login do Instagram: só conta profissional (Criador ou
    # Comercial). A antiga Basic Display, que aceitava conta pessoal, acabou.
    'instagram': {
        'autorizar': 'https://www.instagram.com/oauth/authorize',
        'escopo': 'instagram_business_basic',
        'separador': ',',
    },
    'pinterest': {
        'autorizar': 'https://www.pinterest.com/oauth/',
        'escopo': 'user_accounts:read,boards:read,pins:read',
        'separador': ',',
    },
}


def volta(servico):
    """O endereço de retorno que vai cadastrado no app de cada rede."""
    return '%s/api/redes/%s/volta' % (SITE, servico)


def _agora():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _get(pk):
    item = _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': pk}},
                            ConsistentRead=True).get('Item')
    return {k: list(v.values())[0] for k, v in item.items()} if item else None


def _config(servico):
    c = _get('REDECFG#' + servico) or {}
    return c if c.get('app_id') and c.get('segredo') else None


# --- Administração --------------------------------------------------------
def ver_config():
    saida = {}
    for s in SERVICOS:
        c = _get('REDECFG#' + s) or {}
        saida[s] = {'appId': c.get('app_id', ''), 'temSegredo': bool(c.get('segredo')),
                    'volta': volta(s)}
    return saida


def gravar_config(servico, app_id, segredo):
    if servico not in SERVICOS:
        raise ValueError('rede desconhecida')
    app_id = str(app_id or '').strip()[:100]
    segredo = str(segredo or '').strip()[:200]
    atual = _get('REDECFG#' + servico) or {}
    segredo = segredo or atual.get('segredo', '')
    if not app_id or not segredo:
        raise ValueError('preencha o App ID e o segredo')
    _dynamo.put_item(TableName=TABELA, Item={
        'pk': {'S': 'REDECFG#' + servico},
        'app_id': {'S': app_id}, 'segredo': {'S': segredo}})
    return ver_config()


# --- A conta --------------------------------------------------------------
def minhas(usuario):
    saida = {}
    for s in SERVICOS:
        r = _get('REDE#%s#%s' % (usuario['id'], s))
        saida[s] = {'pronto': _config(s) is not None, 'ligado': bool(r),
                    'usuario': (r or {}).get('usuario', ''), 'em': (r or {}).get('em')}
    return saida


def endereco_de_entrada(usuario, servico):
    if servico not in SERVICOS:
        raise ValueError('rede desconhecida')
    cfg = _config(servico)
    if not cfg:
        return None
    state = secrets.token_urlsafe(24)
    _dynamo.put_item(TableName=TABELA, Item={
        'pk': {'S': 'REDESTATE#' + state},
        'uid': {'S': usuario['id']}, 'servico': {'S': servico},
        'ttl': {'N': str(int(time.time()) + 900)}})
    s = SERVICOS[servico]
    return s['autorizar'] + '?' + urllib.parse.urlencode({
        'client_id': cfg['app_id'],
        'redirect_uri': volta(servico),
        'response_type': 'code',
        'scope': s['escopo'],
        'state': state,
    })


def _pedir(url, dados=None, cabecalhos=None):
    corpo = urllib.parse.urlencode(dados).encode() if dados is not None else None
    req = urllib.request.Request(url, data=corpo, headers=cabecalhos or {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        print('redes: %s respondeu %s %s' % (url.split('?')[0], e.code, e.read()[:300]))
        raise ValueError('a rede recusou a ligação')


def _trocar_instagram(cfg, code):
    curto = _pedir('https://api.instagram.com/oauth/access_token', {
        'client_id': cfg['app_id'], 'client_secret': cfg['segredo'],
        'grant_type': 'authorization_code', 'redirect_uri': volta('instagram'),
        'code': code})
    token, expira = curto['access_token'], None
    # O token curto vale 1 hora; o longo, 60 dias.
    try:
        longo = _pedir('https://graph.instagram.com/access_token?' + urllib.parse.urlencode({
            'grant_type': 'ig_exchange_token', 'client_secret': cfg['segredo'],
            'access_token': token}))
        token = longo['access_token']
        expira = int(time.time()) + int(longo.get('expires_in') or 0)
    except (ValueError, KeyError):
        pass
    eu = _pedir('https://graph.instagram.com/me?' + urllib.parse.urlencode({
        'fields': 'user_id,username', 'access_token': token}))
    return eu['username'], token, expira


def _trocar_pinterest(cfg, code):
    chave = base64.b64encode(('%s:%s' % (cfg['app_id'], cfg['segredo'])).encode()).decode()
    r = _pedir('https://api.pinterest.com/v5/oauth/token', {
        'grant_type': 'authorization_code', 'code': code,
        'redirect_uri': volta('pinterest')},
        {'Authorization': 'Basic ' + chave,
         'Content-Type': 'application/x-www-form-urlencoded'})
    token = r['access_token']
    expira = int(time.time()) + int(r.get('expires_in') or 0) if r.get('expires_in') else None
    eu = _pedir('https://api.pinterest.com/v5/user_account',
                cabecalhos={'Authorization': 'Bearer ' + token})
    return eu['username'], token, expira


def concluir(servico, code, state, uid_sessao):
    """Volta da rede. Devolve (uid, usuario) ou levanta ValueError.

    `uid_sessao` é quem está logado no navegador que voltou. O `state` tem de
    ser dessa mesma conta: sem isso, alguém abria o /entrar na conta dele,
    mandava o link da rede para outra pessoa, e o Instagram dela ia parar
    ligado na conta de quem mandou."""
    if servico not in SERVICOS or not code or not state:
        raise ValueError('ligação incompleta')
    pedido = _get('REDESTATE#' + state)
    _dynamo.delete_item(TableName=TABELA, Key={'pk': {'S': 'REDESTATE#' + state}})
    if not pedido or pedido.get('servico') != servico or int(pedido.get('ttl', 0)) < time.time():
        raise ValueError('a ligação expirou, tente de novo')
    if not uid_sessao or pedido.get('uid') != uid_sessao:
        raise ValueError('a ligação começou em outra conta')
    cfg = _config(servico)
    if not cfg:
        raise ValueError('rede ainda não configurada')
    trocar = _trocar_instagram if servico == 'instagram' else _trocar_pinterest
    usuario, token, expira = trocar(cfg, code)
    uid = pedido['uid']
    item = {'pk': {'S': 'REDE#%s#%s' % (uid, servico)}, 'usuario': {'S': usuario},
            'token': {'S': token}, 'em': {'S': _agora()}}
    if expira:
        item['expira'] = {'N': str(expira)}
    _dynamo.put_item(TableName=TABELA, Item=item)
    _no_cartao(uid, servico, usuario)
    return uid, usuario


def desligar(usuario, servico):
    if servico not in SERVICOS:
        raise ValueError('rede desconhecida')
    _dynamo.delete_item(TableName=TABELA,
                        Key={'pk': {'S': 'REDE#%s#%s' % (usuario['id'], servico)}})
    _no_cartao(usuario['id'], servico, None)
    return minhas(usuario)


def _no_cartao(uid, servico, usuario):
    """O @ (só ele) no item da conta, para o perfil público mostrar."""
    chave = {'pk': {'S': 'USER#' + uid}}
    if usuario is None:
        if _tem_redes(uid):
            _dynamo.update_item(TableName=TABELA, Key=chave, UpdateExpression='REMOVE redes.#s',
                                ExpressionAttributeNames={'#s': servico})
        return
    _dynamo.update_item(TableName=TABELA, Key=chave,
                        UpdateExpression='SET redes = if_not_exists(redes, :vazio)',
                        ExpressionAttributeValues={':vazio': {'M': {}}})
    _dynamo.update_item(TableName=TABELA, Key=chave, UpdateExpression='SET redes.#s = :u',
                        ExpressionAttributeNames={'#s': servico},
                        ExpressionAttributeValues={':u': {'S': usuario}})


def _tem_redes(uid):
    item = _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': 'USER#' + uid}},
                            ProjectionExpression='redes').get('Item') or {}
    return 'redes' in item
