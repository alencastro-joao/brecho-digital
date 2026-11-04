# -*- coding: utf-8 -*-
"""Trocar de conta sem senha: /api/auth/contas e /api/auth/trocar."""

import json
import os
import sys
import unittest

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

_ddb = boto3.client('dynamodb')


def chamar(metodo, rota, cookies=(), corpo=None):
    r = app.handler({
        'rawPath': rota, 'queryStringParameters': {}, 'headers': {},
        'requestContext': {'http': {'method': metodo, 'sourceIp': '1.2.3.4'}},
        'cookies': list(cookies), 'body': json.dumps(corpo) if corpo else None,
    }, None)
    return r, json.loads(r['body'])


def jar(r, antigo):
    """Aplica os Set-Cookie da resposta sobre o jar {nome: valor}."""
    novo = dict(antigo)
    for c in r.get('cookies', []):
        nome, resto = c.split('=', 1)
        valor = resto.split(';')[0]
        if 'Max-Age=0' in c:
            novo.pop(nome, None)
        else:
            novo[nome] = valor
    return novo


def enviar(jarro):
    return ['%s=%s' % kv for kv in jarro.items()]


class TestTrocar(unittest.TestCase):
    def setUp(self):
        _ddb.create_table(TableName='brecho-teste', BillingMode='PAY_PER_REQUEST',
                          AttributeDefinitions=[{'AttributeName': 'pk', 'AttributeType': 'S'}],
                          KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}])

    def tearDown(self):
        _ddb.delete_table(TableName='brecho-teste')

    def test_troca_sem_senha(self):
        jarro = {}
        for email in ('a@x.com', 'b@x.com'):
            r, d = chamar('POST', '/api/auth/registrar', enviar(jarro),
                          {'email': email, 'senha': 'senha-forte-123', 'nome': 'Pessoa ' + email[0], 'handle': 'pessoa_' + email[0]})
            self.assertEqual(r['statusCode'], 201, d)
            jarro = jar(r, jarro)
        id_b = d['usuario']['id']
        r, d = chamar('GET', '/api/auth/contas', enviar(jarro))
        self.assertEqual(len(d['contas']), 1)
        id_a = d['contas'][0]['id']
        self.assertNotEqual(id_a, id_b)

        r, d = chamar('POST', '/api/auth/trocar', enviar(jarro), {'id': id_a})
        self.assertEqual(d['usuario']['id'], id_a)
        jarro = jar(r, jarro)
        r, d = chamar('GET', '/api/auth/eu', enviar(jarro))
        self.assertEqual(d['usuario']['id'], id_a)
        r, d = chamar('GET', '/api/auth/contas', enviar(jarro))
        self.assertEqual([c['id'] for c in d['contas']], [id_b])

        r, d = chamar('POST', '/api/auth/trocar', enviar(jarro), {'id': 'U-inexistente'})
        self.assertEqual(r['statusCode'], 404)

        # adicionar outra conta: guarda a atual e sai para o login
        r, d = chamar('POST', '/api/auth/trocar', enviar(jarro), {'id': None})
        jarro = jar(r, jarro)
        r, d = chamar('GET', '/api/auth/eu', enviar(jarro))
        self.assertIsNone(d['usuario'])
        r, d = chamar('GET', '/api/auth/contas', enviar(jarro))
        self.assertEqual(len(d['contas']), 2)


if __name__ == '__main__':
    unittest.main()
