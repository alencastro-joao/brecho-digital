# -*- coding: utf-8 -*-
"""
Testes do "Entrar com Google" (logingoogle.py, contas.entrar_com_google e as
rotas em app.py) contra um DynamoDB de mentira (moto). O Google também é de
mentira: a troca do `code` devolve um id_token montado aqui.

    pip install moto
    python -m unittest discover -s nuvem/testes -v
"""

import base64
import json
import os
import sys
import time
import unittest
import urllib.parse
from unittest import mock

os.environ.update({
    'AWS_DEFAULT_REGION': 'us-east-1', 'AWS_ACCESS_KEY_ID': 'teste',
    'AWS_SECRET_ACCESS_KEY': 'teste', 'BD_TABELA': 'brecho-teste',
    'BD_BUCKET_SITE': 'site-teste', 'BD_SEGREDO_ORIGEM': '',
    'BD_BUCKET_DADOS': 'dados-teste',
})

from moto import mock_aws  # noqa: E402

_moto = mock_aws()
_moto.start()

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'lambda'))

import boto3  # noqa: E402

import app  # noqa: E402
import contas  # noqa: E402
import redes  # noqa: E402

_ddb = boto3.client('dynamodb')
CLIENTE = '123-abc.apps.googleusercontent.com'


def _b64(dados):
    return base64.urlsafe_b64encode(json.dumps(dados).encode()).decode().rstrip('=')


def _evento(rota, consulta=None, cookies=None):
    return {'rawPath': rota, 'requestContext': {'http': {'method': 'GET', 'sourceIp': '1.2.3.4'}},
            'headers': {'x-forwarded-for': '9.9.9.9'}, 'queryStringParameters': consulta or {},
            'cookies': cookies or []}


class Base(unittest.TestCase):
    def setUp(self):
        _ddb.create_table(TableName=contas.TABELA, BillingMode='PAY_PER_REQUEST',
                          AttributeDefinitions=[{'AttributeName': 'pk', 'AttributeType': 'S'}],
                          KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}])
        redes.gravar_config('google', CLIENTE, 'segredo')

    def tearDown(self):
        _ddb.delete_table(TableName=contas.TABELA)

    def entrar(self):
        """Ida pelo /entrar: devolve (state, nonce, cookie do state)."""
        r = app.handler(_evento('/api/auth/google/entrar'), None)
        self.assertEqual(r['statusCode'], 302)
        q = urllib.parse.parse_qs(urllib.parse.urlparse(r['headers']['Location']).query)
        self.assertEqual(q['client_id'], [CLIENTE])
        self.assertEqual(q['redirect_uri'], [redes.SITE + '/api/auth/google/volta'])
        cookie = r['cookies'][0].split(';')[0]
        return q['state'][0], q['nonce'][0], cookie

    def voltar(self, state, cookie, **token):
        dados = {'iss': 'https://accounts.google.com', 'aud': CLIENTE, 'sub': '1111',
                 'email': 'pessoa@gmail.com', 'email_verified': True, 'name': 'Pessoa',
                 'exp': time.time() + 300, **token}
        resposta = {'id_token': 'x.%s.y' % _b64(dados)}
        with mock.patch.object(redes, '_pedir', return_value=resposta):
            return app.handler(_evento('/api/auth/google/volta',
                                       {'code': 'c', 'state': state},
                                       [cookie] if cookie else []), None)

    def sessao(self, r):
        for c in r.get('cookies', []):
            if c.startswith(contas.COOKIE + '='):
                return contas.usuario_da_sessao(c.split(';')[0].split('=', 1)[1])
        return None


class TestGoogle(Base):
    def test_pronto_so_com_chaves(self):
        r = app.handler(_evento('/api/auth/google'), None)
        self.assertTrue(json.loads(r['body'])['pronto'])
        _ddb.delete_item(TableName=contas.TABELA, Key={'pk': {'S': 'REDECFG#google'}})
        r = app.handler(_evento('/api/auth/google'), None)
        self.assertFalse(json.loads(r['body'])['pronto'])
        r = app.handler(_evento('/api/auth/google/entrar'), None)
        self.assertTrue(r['headers']['Location'].endswith('?google=config'))

    def test_conta_nova_nasce_sem_senha_e_com_email_confirmado(self):
        state, nonce, cookie = self.entrar()
        r = self.voltar(state, cookie, nonce=nonce)
        self.assertTrue(r['headers']['Location'].endswith('?google=nova'))
        eu = self.sessao(r)
        self.assertEqual(eu['email'], 'pessoa@gmail.com')
        self.assertEqual(eu['handle'], '@pessoa')
        self.assertTrue(eu['emailConfirmado'])
        with self.assertRaises(contas.ErroDeConta):
            contas.autenticar('pessoa@gmail.com', '', '1.1.1.1')

        # Na segunda vez é a mesma conta, e não é nova.
        state, nonce, cookie = self.entrar()
        r = self.voltar(state, cookie, nonce=nonce)
        self.assertTrue(r['headers']['Location'].endswith('?google=ok'))
        self.assertEqual(self.sessao(r)['id'], eu['id'])

    def test_liga_na_conta_que_ja_tinha_o_email(self):
        antes = contas.criar_conta('Pessoa@gmail.com', 'senha-boa-123', 'P', 'ppp')
        velha, _ = contas.abrir_sessao(antes['id'])
        state, nonce, cookie = self.entrar()
        r = self.voltar(state, cookie, nonce=nonce)
        self.assertTrue(r['headers']['Location'].endswith('?google=ok'))
        eu = self.sessao(r)
        self.assertEqual(eu['id'], antes['id'])
        self.assertTrue(eu['emailConfirmado'])
        # E-mail não confirmado antes: a sessão aberta antes do Google cai.
        self.assertIsNone(contas.usuario_da_sessao(velha))
        # A senha continua valendo.
        self.assertEqual(contas.autenticar('pessoa@gmail.com', 'senha-boa-123', '1.1.1.1')['id'],
                         antes['id'])

    def test_state_de_outro_navegador_nao_entra(self):
        state, nonce, _ = self.entrar()
        _, _, outro = self.entrar()
        r = self.voltar(state, outro, nonce=nonce)
        self.assertTrue(r['headers']['Location'].endswith('?google=falhou'))
        self.assertIsNone(self.sessao(r))
        r = self.voltar(state, None, nonce=nonce)
        self.assertIsNone(self.sessao(r))

    def test_state_so_vale_uma_vez(self):
        state, nonce, cookie = self.entrar()
        self.assertIsNotNone(self.sessao(self.voltar(state, cookie, nonce=nonce)))
        self.assertIsNone(self.sessao(self.voltar(state, cookie, nonce=nonce)))

    def test_token_ruim_nao_entra(self):
        casos = [{'aud': 'outro-app'}, {'iss': 'https://evil.example'},
                 {'exp': time.time() - 10}, {'email_verified': False}, {'nonce': 'outro'}]
        for extra in casos:
            state, nonce, cookie = self.entrar()
            r = self.voltar(state, cookie, **{'nonce': nonce, **extra})
            self.assertIsNone(self.sessao(r), extra)
            self.assertTrue(r['headers']['Location'].endswith('?google=falhou'), extra)

    def test_cancelou_no_google(self):
        r = app.handler(_evento('/api/auth/google/volta', {'error': 'access_denied'}), None)
        self.assertTrue(r['headers']['Location'].endswith('?google=recusou'))

    def test_admin_ve_a_chave_do_google(self):
        cfg = redes.ver_config()
        self.assertEqual(cfg['google']['appId'], CLIENTE)
        self.assertTrue(cfg['google']['temSegredo'])
        self.assertNotIn('google', redes.minhas({'id': 'u-x'}))

    def test_handle_curto_vira_um_inventado(self):
        usuario, nova = contas.entrar_com_google('2222', 'jo@gmail.com', '')
        self.assertTrue(nova)
        self.assertTrue(usuario['handle'].startswith('@pessoa'))


if __name__ == '__main__':
    unittest.main()
