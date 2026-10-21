# -*- coding: utf-8 -*-
"""
Testes das roupas do avatar cadastradas pelo admin (nuvem/lambda/roupasavatar.py)
contra um S3 de mentira (moto):

    python -m unittest discover -s nuvem/testes -v
"""

import base64
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

import acervo  # noqa: E402
import roupasavatar  # noqa: E402

_s3 = boto3.client('s3')
WEBP = 'data:image/webp;base64,' + base64.b64encode(b'RIFF\x00\x00\x00\x00WEBPVP8 ').decode()


class RoupasDoAvatar(unittest.TestCase):
    def setUp(self):
        _s3.create_bucket(Bucket='site-teste')
        acervo._s3 = _s3
        _s3.put_object(Bucket='site-teste', Key=acervo.ACERVO, Body=json.dumps(
            {'items': [{'id': 'peca-1'}], 'removidas': ['velha']}).encode())

    def tearDown(self):
        for o in _s3.list_objects_v2(Bucket='site-teste').get('Contents', []):
            _s3.delete_object(Bucket='site-teste', Key=o['Key'])
        _s3.delete_bucket(Bucket='site-teste')

    def corpo(self, **extra):
        return {'id': 'oculos-estrela', 'nome': 'Óculos estrela', 'slot': 'acessorio',
                'caixa': [212, 110, 172, 82], 'colecoes': ['cor-preto', 'puma'], 'imagem': WEBP, **extra}

    def test_grava_sem_mexer_no_resto_do_acervo(self):
        item = roupasavatar.gravar(self.corpo())
        self.assertTrue(item['src'].startswith('assets/cloths/avatar-oculos-estrela-'))
        dados = acervo.ler_acervo()[0]
        self.assertEqual(dados['items'], [{'id': 'peca-1'}])
        self.assertEqual(dados['removidas'], ['velha'])
        self.assertEqual([r['id'] for r in dados['roupasAvatar']], ['oculos-estrela'])
        _s3.head_object(Bucket='site-teste', Key=item['src'])

    def test_editar_mantem_imagem_e_troca_caixa(self):
        primeiro = roupasavatar.gravar(self.corpo())
        corpo = self.corpo(caixa=[200, 100, 200, 95], colecoes=['cor-azul'])
        del corpo['imagem']
        item = roupasavatar.gravar(corpo)
        self.assertEqual(item['src'], primeiro['src'])
        self.assertIn('editadoEm', item)
        lista = acervo.ler_acervo()[0]['roupasAvatar']
        self.assertEqual(len(lista), 1)
        self.assertEqual(lista[0]['caixa'], [200, 100, 200, 95])
        self.assertEqual(lista[0]['colecoes'], ['cor-azul'])

    def test_recusa_o_que_nao_presta(self):
        for ruim in ({'id': 'Com Espaço'}, {'slot': 'nariz'}, {'colecoes': []},
                     {'caixa': [0, 0, 0]}, {'imagem': '', 'src': '../segredo.png'}):
            with self.assertRaises(ValueError):
                roupasavatar.gravar(self.corpo(**ruim))

    def test_ajuste_de_roupa_do_codigo(self):
        roupasavatar.gravar({'tipo': 'ajuste', 'id': 'oculos-espinhos',
                             'caixa': [210, 108, 180, 86], 'cores': ['Preto', 'Azul']})
        ajustes = acervo.ler_acervo()[0]['ajustesRoupas']
        self.assertEqual(ajustes['oculos-espinhos']['cores'], ['Preto', 'Azul'])
        self.assertEqual(ajustes['oculos-espinhos']['caixa'], [210, 108, 180, 86])
        roupasavatar.gravar({'tipo': 'ajuste', 'id': 'oculos-espinhos', 'restaurar': True})
        self.assertEqual(acervo.ler_acervo()[0]['ajustesRoupas'], {})
        with self.assertRaises(ValueError):
            roupasavatar.gravar({'tipo': 'ajuste', 'id': 'tenis', 'caixa': [0, 0, 10, 10], 'cores': []})

    def test_apagar(self):
        roupasavatar.gravar(self.corpo())
        roupasavatar.apagar('oculos-estrela')
        self.assertEqual(acervo.ler_acervo()[0]['roupasAvatar'], [])
        with self.assertRaises(ValueError):
            roupasavatar.apagar('oculos-estrela')


if __name__ == '__main__':
    unittest.main()
