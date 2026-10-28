# -*- coding: utf-8 -*-
"""
Testes dos mini games de ajuda (nuvem/lambda/ajudas.py) contra um DynamoDB de
mentira (moto):

    python -m unittest discover -s nuvem/testes -v
"""

import os
import sys
import unittest

os.environ.update({
    'AWS_DEFAULT_REGION': 'us-east-1', 'AWS_ACCESS_KEY_ID': 'teste',
    'AWS_SECRET_ACCESS_KEY': 'teste', 'BD_TABELA': 'brecho-ajudas',
    'BD_BUCKET_SITE': 'site-teste', 'BD_SEGREDO_ORIGEM': '',
    'BD_BUCKET_DADOS': 'dados-teste',
})

from moto import mock_aws  # noqa: E402

_moto = mock_aws()
_moto.start()

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'lambda'))

import boto3  # noqa: E402

import ajudas  # noqa: E402
import estoque  # noqa: E402

_ddb = boto3.client('dynamodb')
ANA = {'id': 'u-ana', 'papel': 'jogador'}
BIA = {'id': 'u-bia', 'papel': 'jogador'}


class Ajudas(unittest.TestCase):
    def setUp(self):
        _ddb.create_table(TableName='brecho-ajudas', BillingMode='PAY_PER_REQUEST',
                          AttributeDefinitions=[{'AttributeName': 'pk', 'AttributeType': 'S'}],
                          KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}])
        self._existe = estoque._existe
        estoque._existe = lambda pid: pid.startswith('peca')

    def tearDown(self):
        estoque._existe = self._existe
        _ddb.delete_table(TableName='brecho-ajudas')

    def test_ficha_a_cada_x_e_limite(self):
        regra = ajudas.JOGOS['avaliar']
        fichas = 0
        for i in range(regra['limite']):
            r = ajudas.ajudar(ANA, 'avaliar', {'peca': 'peca-%d' % i, 'gostei': True})
            self.assertTrue(r['ok'])
            fichas += r['fichas']
        self.assertEqual(fichas, regra['limite'] // regra['porFicha'])
        r = ajudas.ajudar(ANA, 'avaliar', {'peca': 'peca-extra', 'gostei': True})
        self.assertEqual(r['motivo'], 'limite')

    def test_mesma_peca_nao_conta_duas_vezes(self):
        self.assertTrue(ajudas.ajudar(ANA, 'avaliar', {'peca': 'peca-a', 'gostei': True})['ok'])
        r = ajudas.ajudar(ANA, 'avaliar', {'peca': 'peca-a', 'gostei': False})
        self.assertEqual(r['motivo'], 'repetida')
        self.assertEqual(r['feitas'], 1)
        self.assertEqual(ajudas.estado(ANA)['jogos']['avaliar']['pecas'], ['peca-a'])

    def test_peca_desconhecida(self):
        with self.assertRaises(ValueError):
            ajudas.ajudar(ANA, 'avaliar', {'peca': 'outra', 'gostei': True})

    def test_resumo(self):
        for i in range(ajudas.VOTOS_MIN):
            ajudas.ajudar({'id': 'u%d' % i}, 'avaliar', {'peca': 'peca-z', 'gostei': i < 9})
        ajudas.ajudar(ANA, 'ajustar', {'peca': 'peca-z', 'ancora': {'x': 300, 'y': 500, 'w': 200}})
        ajudas.ajudar(BIA, 'ajustar', {'peca': 'peca-z', 'ancora': {'x': 310, 'y': 520, 'w': 220}})
        ajudas.ajudar(ANA, 'preencher', {'peca': 'peca-z', 'cor': 'Preto', 'marca': 'Niké '})
        ajudas.ajudar(BIA, 'preencher', {'peca': 'peca-z', 'cor': 'preto', 'marca': ''})
        p = ajudas.resumo()['pecas'][0]
        self.assertEqual(p['votos']['pct'], 90)
        self.assertEqual(p['votos']['raridade'], 'legendary')
        self.assertEqual(p['ajuste'], {'x': 305, 'y': 510, 'w': 210, 'medidas': 2})
        self.assertEqual(p['cor'], {'valor': 'preto', 'votos': 2, 'total': 2})
        self.assertEqual(p['marca']['valor'], 'nike')

    def test_faixas(self):
        self.assertIsNone(ajudas.raridade_sugerida(3, 3))
        self.assertEqual(ajudas.raridade_sugerida(1, 9), 'common')
        self.assertEqual(ajudas.raridade_sugerida(5, 5), 'rare')
        self.assertEqual(ajudas.raridade_sugerida(7, 3), 'epic')


if __name__ == '__main__':
    unittest.main()
