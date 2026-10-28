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

_ddb = boto3.client('dynamodb')
ANA = {'id': 'u-ana', 'papel': 'jogador'}
BIA = {'id': 'u-bia', 'papel': 'jogador'}


class Ajudas(unittest.TestCase):
    def setUp(self):
        _ddb.create_table(TableName='brecho-ajudas', BillingMode='PAY_PER_REQUEST',
                          AttributeDefinitions=[{'AttributeName': 'pk', 'AttributeType': 'S'}],
                          KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}])
        self._ids = ajudas._ids_nos_jogos
        ajudas._ids_nos_jogos = lambda: {'epeca%04d' % i for i in range(100)}

    def tearDown(self):
        ajudas._ids_nos_jogos = self._ids
        _ddb.delete_table(TableName='brecho-ajudas')

    def test_ficha_a_cada_x_e_limite(self):
        regra = ajudas.JOGOS['avaliar']
        fichas = 0
        for i in range(regra['limite']):
            r = ajudas.ajudar(ANA, 'avaliar', {'peca': 'epeca%04d' % i, 'gostei': True})
            self.assertTrue(r['ok'])
            fichas += r['fichas']
        self.assertEqual(fichas, regra['limite'] // regra['porFicha'])
        r = ajudas.ajudar(ANA, 'avaliar', {'peca': 'epeca0099', 'gostei': True})
        # Depois do limite a ajuda vale, mas não paga ficha.
        self.assertTrue(r['ok'])
        self.assertEqual(r['fichas'], 0)
        self.assertTrue(r['semPremio'])
        self.assertEqual(r['feitas'], regra['limite'])

    def test_mesma_peca_nao_conta_duas_vezes(self):
        self.assertTrue(ajudas.ajudar(ANA, 'avaliar', {'peca': 'epeca0001', 'gostei': True})['ok'])
        r = ajudas.ajudar(ANA, 'avaliar', {'peca': 'epeca0001', 'gostei': False})
        self.assertEqual(r['motivo'], 'repetida')
        self.assertEqual(r['feitas'], 1)
        self.assertEqual(ajudas.estado(ANA)['jogos']['avaliar']['pecas'], ['epeca0001'])

    def test_peca_desconhecida(self):
        with self.assertRaises(ValueError):
            ajudas.ajudar(ANA, 'avaliar', {'peca': 'eoutra12345', 'gostei': True})

    def test_tanto_faz_e_rodada(self):
        ajudas.ajudar(ANA, 'avaliar', {'peca': 'epeca0003', 'voto': 'sim'})
        ajudas.ajudar(BIA, 'avaliar', {'peca': 'epeca0003', 'voto': 'meh'})
        p = ajudas.resumo()['pecas'][0]
        self.assertEqual(p['votos']['pct'], 75)
        # Rodada nova: os votos somem e a Ana pode votar de novo.
        ajudas.RODADA_AVALIAR += 1
        try:
            self.assertEqual(ajudas.resumo()['pecas'][0]['votos']['pct'], None)
            self.assertTrue(ajudas.ajudar(ANA, 'avaliar', {'peca': 'epeca0003', 'voto': 'nao'})['ok'])
        finally:
            ajudas.RODADA_AVALIAR -= 1

    def test_resumo(self):
        for i in range(ajudas.VOTOS_MIN):
            ajudas.ajudar({'id': 'u%d' % i}, 'avaliar', {'peca': 'epeca0002', 'gostei': i < 9})
        ajudas.ajudar(ANA, 'ajustar', {'peca': 'epeca0002', 'ancora': {'x': 300, 'y': 500, 'w': 200}})
        ajudas.ajudar(BIA, 'ajustar', {'peca': 'epeca0002', 'ancora': {'x': 310, 'y': 520, 'w': 220}})
        ajudas.ajudar(ANA, 'preencher', {'peca': 'epeca0002', 'cor': 'Preto', 'marca': 'Niké '})
        ajudas.ajudar(BIA, 'preencher', {'peca': 'epeca0002', 'cor': 'preto', 'marca': '', 'cat': 'pants'})
        p = ajudas.resumo()['pecas'][0]
        self.assertEqual(p['votos']['pct'], 90)
        self.assertEqual(p['votos']['raridade'], 'legendary')
        self.assertEqual(p['ajuste'], {'x': 305, 'y': 510, 'w': 210, 'medidas': 2})
        self.assertEqual(p['cor'], {'valor': 'preto', 'votos': 2, 'total': 2})
        self.assertEqual(p['marca']['valor'], 'nike')
        self.assertEqual(p['cat']['valor'], 'pants')

    def test_colocar_e_tirar_da_esteira(self):
        _s3 = boto3.client('s3')
        for b in ('site-teste', 'dados-teste'):
            _s3.create_bucket(Bucket=b)
        _s3.put_object(Bucket='dados-teste', Key='esteira/eabc12345.webp', Body=b'x')
        ajudas._ids_nos_jogos = self._ids
        with self.assertRaises(ValueError):
            ajudas.colocar('eabc12345', {'estado': 'processando'})
        ajudas.colocar('eabc12345', {'estado': 'pronta', 'previa': 'esteira/eabc12345.webp',
                                     'w': 10, 'h': 20, 'sugestao': {'cat': 'shirts'}})
        self.assertEqual(ajudas.ler_lista()[0]['cat'], 'shirts')
        self.assertIn('eabc12345', ajudas._ids_nos_jogos())
        self.assertTrue(ajudas.ajudar(ANA, 'avaliar', {'peca': 'eabc12345', 'gostei': True})['ok'])
        ajudas.tirar('eabc12345')
        self.assertEqual(ajudas.ler_lista(), [])

    def test_faixas(self):
        self.assertIsNone(ajudas.raridade_sugerida(3, 3))
        self.assertEqual(ajudas.raridade_sugerida(1, 9), 'common')
        self.assertEqual(ajudas.raridade_sugerida(5, 5), 'rare')
        self.assertEqual(ajudas.raridade_sugerida(7, 3), 'epic')


if __name__ == '__main__':
    unittest.main()
