# -*- coding: utf-8 -*-
"""
Testes das roupas que os jogadores mandam pela engrenagem (esteira.py,
"Roupas dos jogadores") contra um S3 de mentira (moto):

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
JOAO = {'id': 'u123', 'handle': '@joao', 'nome': 'João'}
FICHA = {'nome': 'Jaqueta jeans', 'cat': 'coats', 'cor': 'Azul', 'marca': 'Levi', 'raridade': 'rare'}
FOTO = {'nome': 'foto.jpg', 'tipo': 'image/jpeg', 'bytes': 1000}


class EnviosDosJogadores(unittest.TestCase):
    def setUp(self):
        _s3.create_bucket(Bucket=esteira.DADOS)

    def tearDown(self):
        for obj in _s3.list_objects_v2(Bucket=esteira.DADOS).get('Contents', []):
            _s3.delete_object(Bucket=esteira.DADOS, Key=obj['Key'])
        _s3.delete_bucket(Bucket=esteira.DADOS)

    def test_envio_entra_na_esteira_com_a_ficha(self):
        feito = esteira.enviar_do_jogador(JOAO, {'arquivo': FOTO, 'ficha': FICHA})
        self.assertIn('url', feito['envio'])
        dados = esteira._ler(feito['envio']['id'])
        self.assertEqual(dados['origem'], 'jogador')
        self.assertEqual(dados['enviadoPor']['handle'], '@joao')
        self.assertEqual(dados['ficha']['raridade'], 'rare')
        self.assertIn('raridade', dados['ficha']['manual'])
        lista = esteira.envios_do_jogador(JOAO)
        self.assertEqual(lista['envios'][0]['estado'], 'analise')
        self.assertEqual(lista['restam'], esteira.MAX_ENVIOS_DIA - 1)

    def test_ficha_incompleta_recusa(self):
        for falta in ('nome', 'cat', 'cor', 'raridade'):
            with self.assertRaises(ValueError):
                esteira.enviar_do_jogador(JOAO, {'arquivo': FOTO, 'ficha': {**FICHA, falta: ''}})

    def test_limite_do_dia(self):
        for _ in range(esteira.MAX_ENVIOS_DIA):
            esteira.enviar_do_jogador(JOAO, {'arquivo': FOTO, 'ficha': FICHA})
        with self.assertRaises(ValueError):
            esteira.enviar_do_jogador(JOAO, {'arquivo': FOTO, 'ficha': FICHA})

    def test_descartar_avisa_o_jogador(self):
        item_id = esteira.enviar_do_jogador(JOAO, {'arquivo': FOTO, 'ficha': FICHA})['envio']['id']
        esteira.descartar(item_id)
        self.assertEqual(esteira.envios_do_jogador(JOAO)['envios'][0]['estado'], 'recusada')


if __name__ == '__main__':
    unittest.main()
