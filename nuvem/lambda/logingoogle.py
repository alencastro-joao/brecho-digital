# -*- coding: utf-8 -*-
"""
Entrar com Google: OpenID Connect, fluxo de código, sem biblioteca nenhuma.

É o mesmo caminho do OAuth das redes (redes.py), com uma diferença: aqui
ninguém está logado ainda, então o `state` não pode ser preso a uma conta. Ele
fica preso ao navegador, num cookie HttpOnly que só vai para /api/auth/google:

    1. a tela de entrada navega para  /api/auth/google/entrar;
    2. daqui vamos para o Google com `state` e `nonce` (GSTATE#..., 10 min),
       e o mesmo `state` sai no cookie `bd_google`;
    3. a pessoa escolhe a conta e volta em  /api/auth/google/volta?code&state;
    4. o `state` da volta tem de ser o do cookie: sem isso, alguém começava o
       login na conta Google dele, mandava o link da volta para outra pessoa,
       e ela entrava (e jogava) na conta de quem mandou;
    5. trocamos o `code` pelo id_token direto com o Google, por HTTPS, e
       conferimos emissor, público, validade, nonce e e-mail confirmado.

Não conferimos a assinatura do id_token: ele não passou pelo navegador, veio
na resposta do próprio Google à nossa chamada com o segredo, e o OpenID Connect
(Core 3.1.3.7) dispensa a assinatura nesse caso. É o que deixa este arquivo
sem dependência de criptografia.

As chaves (Client ID e segredo do Google Cloud) entram pela Administração,
como as das redes, e moram em REDECFG#google. O segredo nunca volta ao
navegador.
"""

import base64
import json
import secrets
import time
import urllib.parse

import redes

AUTORIZAR = 'https://accounts.google.com/o/oauth2/v2/auth'
TOKEN = 'https://oauth2.googleapis.com/token'
EMISSORES = ('accounts.google.com', 'https://accounts.google.com')
COOKIE = 'bd_google'
VALIDADE = 600


def _config():
    return redes._config('google')


def endereco_de_entrada():
    """(endereço do Google, state) ou (None, None) sem as chaves."""
    cfg = _config()
    if not cfg:
        return None, None
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    redes._dynamo.put_item(TableName=redes.TABELA, Item={
        'pk': {'S': 'GSTATE#' + state}, 'nonce': {'S': nonce},
        'ttl': {'N': str(int(time.time()) + VALIDADE)}})
    return AUTORIZAR + '?' + urllib.parse.urlencode({
        'client_id': cfg['app_id'],
        'redirect_uri': redes.volta('google'),
        'response_type': 'code',
        'scope': 'openid email profile',
        'state': state,
        'nonce': nonce,
        'prompt': 'select_account',
    }), state


def _ler_id_token(id_token, client_id, nonce):
    partes = str(id_token or '').split('.')
    if len(partes) != 3:
        raise ValueError('o Google mandou um token estranho')
    meio = partes[1] + '=' * (-len(partes[1]) % 4)
    dados = json.loads(base64.urlsafe_b64decode(meio.encode('ascii')))
    if dados.get('iss') not in EMISSORES:
        raise ValueError('o token não é do Google')
    publico = dados.get('aud')
    if publico != client_id and not (isinstance(publico, list) and client_id in publico):
        raise ValueError('o token é de outro app')
    if float(dados.get('exp') or 0) < time.time():
        raise ValueError('o token venceu')
    if not secrets.compare_digest(str(dados.get('nonce') or ''), nonce):
        raise ValueError('o token é de outro login')
    if dados.get('email_verified') not in (True, 'true'):
        raise ValueError('o e-mail do Google não está confirmado')
    return dados


def concluir(code, state, state_do_navegador):
    """Volta do Google. Devolve (sub, email, nome) ou levanta ValueError."""
    if not code or not state:
        raise ValueError('login incompleto')
    pedido = redes._get('GSTATE#' + state)
    redes._dynamo.delete_item(TableName=redes.TABELA, Key={'pk': {'S': 'GSTATE#' + state}})
    if not pedido or int(pedido.get('ttl', 0)) < time.time():
        raise ValueError('o login expirou, tente de novo')
    if not state_do_navegador or not secrets.compare_digest(state, state_do_navegador):
        raise ValueError('o login começou em outro navegador')
    cfg = _config()
    if not cfg:
        raise ValueError('Google ainda não configurado')
    r = redes._pedir(TOKEN, {
        'code': code, 'client_id': cfg['app_id'], 'client_secret': cfg['segredo'],
        'redirect_uri': redes.volta('google'), 'grant_type': 'authorization_code'},
        {'Content-Type': 'application/x-www-form-urlencoded'})
    dados = _ler_id_token(r.get('id_token'), cfg['app_id'], pedido['nonce'])
    return dados.get('sub'), dados.get('email'), dados.get('name') or dados.get('given_name')
