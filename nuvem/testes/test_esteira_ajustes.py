# -*- coding: utf-8 -*-
"""
Testes do botão "Auto preencher" da esteira (nuvem/lambda/esteira.py) contra
um S3 de mentira (moto):

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

import esteira  # noqa: E402

_s3 = boto3.client('s3')


class AjustesDaEsteira(unittest.TestCase):
    def setUp(self):
        _s3.create_bucket(Bucket=esteira.DADOS)

    def tearDown(self):
        for obj in _s3.list_objects_v2(Bucket=esteira.DADOS).get('Contents', []):
            _s3.delete_object(Bucket=esteira.DADOS, Key=obj['Key'])
        _s3.delete_bucket(Bucket=esteira.DADOS)

    def test_padrao_e_ligado(self):
        self.assertEqual(esteira.ajustes(), {'autoPreencher': True, 'fundo': 'verde'})

    def test_desligar_e_religar(self):
        self.assertIs(esteira.mudar_ajustes({'autoPreencher': False})['autoPreencher'], False)
        self.assertIs(esteira.ajustes()['autoPreencher'], False)
        esteira.mudar_ajustes({'autoPreencher': 1})
        self.assertIs(esteira.ajustes()['autoPreencher'], True)

    def test_ignora_chave_desconhecida(self):
        self.assertEqual(esteira.mudar_ajustes({'outra': 'x'}), {'autoPreencher': True, 'fundo': 'verde'})

    def test_trocar_fundo(self):
        self.assertEqual(esteira.mudar_ajustes({'fundo': 'xadrez'})['fundo'], 'xadrez')
        self.assertEqual(esteira.ajustes()['fundo'], 'xadrez')
        esteira.mudar_ajustes({'fundo': 'roxo'})
        self.assertEqual(esteira.ajustes()['fundo'], 'xadrez')


if __name__ == '__main__':
    unittest.main()
