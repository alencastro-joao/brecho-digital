# -*- coding: utf-8 -*-
"""
Testes da troca de peças (nuvem/lambda/trocas.py) contra um DynamoDB e um S3
de mentira (moto):

    pip install moto
    python -m unittest discover -s nuvem/testes -v
"""

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

import contas  # noqa: E402
import estoque  # noqa: E402
import pessoas  # noqa: E402
import trocas  # noqa: E402

_ddb = boto3.client('dynamodb')
_s3 = boto3.client('s3')
PECAS = ['jaqueta', 'bone', 'saia', 'tenis', 'colete', 'meia']


class Base(unittest.TestCase):
    def setUp(self):
        _ddb.create_table(TableName=contas.TABELA, BillingMode='PAY_PER_REQUEST',
                          AttributeDefinitions=[{'AttributeName': 'pk', 'AttributeType': 'S'}],
                          KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}])
        _s3.create_bucket(Bucket='site-teste')
        _s3.put_object(Bucket='site-teste', Key='assets/acervo.json',
                       Body=json.dumps({'items': [{'id': p} for p in PECAS]}).encode())
        estoque._acervo.update(ids=None, em=0.0)
        self.ana = self.conta('ana')
        self.bia = self.conta('bia')
        self.amigas(self.ana, self.bia)

    def tearDown(self):
        _ddb.delete_table(TableName=contas.TABELA)
        for o in _s3.list_objects_v2(Bucket='site-teste').get('Contents', []):
            _s3.delete_object(Bucket='site-teste', Key=o['Key'])
        _s3.delete_bucket(Bucket='site-teste')

    def conta(self, nome):
        c = contas.criar_conta('%s@exemplo.com' % nome, 'senha-boa-123', nome.title(), nome)
        u = {'id': c['id'], 'handle': '@' + nome, 'papel': 'usuario'}
        u['pecas'] = {}
        return u

    def amigas(self, a, b):
        pessoas.seguir(a['id'], b['id'], True)
        pessoas.seguir(b['id'], a['id'], True)

    def dar(self, u, pid, rar='rare'):
        """A pessoa leva uma cópia da loja e mostra no perfil."""
        feito = estoque.levar([{'id': pid, 'raridade': rar, 'origem': 'vitrine'}], u)
        u['pecas'][pid] = {'id': pid, 'raridade': rar, 'numero': feito['numeros'][estoque.chave(pid, rar)]}
        ids = list(u['pecas'])
        pessoas.atualizar_perfil(u['id'], {'guardaRoupa': ids,
                                           'raridades': ''.join(u['pecas'][i]['raridade'][0] for i in ids)})
        return u['pecas'][pid]

    def dono(self, copia, quem):
        hist = estoque.historico([copia], quem)['historico']
        return hist['%s|%d' % (estoque.chave(copia['id'], copia['raridade']), copia['numero'])][-1]

    def propor(self, de, para, quero, opcoes):
        return trocas.propor(de, {'para': para['id'], 'quero': {'id': quero, 'raridade': 'rare'},
                                  'opcoes': opcoes})['troca']


class Troca(Base):
    def test_aceitar_troca_os_donos_e_mantem_a_tiragem(self):
        jaqueta = self.dar(self.bia, 'jaqueta')
        bone = self.dar(self.ana, 'bone')
        saia = self.dar(self.ana, 'saia')
        antes = estoque.mapa()
        t = self.propor(self.ana, self.bia, 'jaqueta', [bone, saia])
        self.assertEqual(t['estado'], 'aberta')
        self.assertEqual([x['estado'] for x in trocas.listar(self.bia)['trocas']], ['aberta'])

        feita = trocas.aceitar(self.bia, t['id'], {'escolhida': 1, 'minha': {'numero': jaqueta['numero']}})
        self.assertEqual(feita['troca']['estado'], 'feita')
        self.assertEqual(feita['troca']['escolhida'], 1)
        self.assertEqual(feita['troca']['quero']['numero'], jaqueta['numero'])
        self.assertTrue(self.dono(jaqueta, self.ana)['voce'])
        self.assertEqual(self.dono(jaqueta, self.ana)['como'], 'troca')
        self.assertTrue(self.dono(saia, self.bia)['voce'])
        self.assertTrue(self.dono(bone, self.ana)['voce'])       # a não escolhida fica
        self.assertEqual(estoque.mapa(), antes)

        trocas.aplicada(self.ana, t['id'])
        ana = trocas.listar(self.ana)['trocas'][0]
        self.assertTrue(ana['aplicada'])
        self.assertFalse(trocas.listar(self.bia)['trocas'][0]['aplicada'])

    def test_so_entre_amigas(self):
        cris = self.conta('cris')
        pessoas.seguir(cris['id'], self.bia['id'], True)      # só um lado segue
        self.dar(self.bia, 'jaqueta')
        bone = self.dar(cris, 'bone')
        with self.assertRaises(contas.ErroDeConta):
            self.propor(cris, self.bia, 'jaqueta', [bone])

    def test_mesma_raridade_e_peca_dela(self):
        self.dar(self.bia, 'jaqueta')
        comum = self.dar(self.ana, 'bone', 'common')
        with self.assertRaises(ValueError):
            self.propor(self.ana, self.bia, 'jaqueta', [comum])
        rara = self.dar(self.ana, 'saia')
        with self.assertRaises(ValueError):               # ela não tem tênis
            self.propor(self.ana, self.bia, 'tenis', [rara])
        with self.assertRaises(ValueError):               # mais de 4 opções
            self.propor(self.ana, self.bia, 'jaqueta', [rara] * 5)

    def test_nao_oferece_copia_de_outra_pessoa(self):
        self.dar(self.bia, 'jaqueta')
        bone_da_bia = self.dar(self.bia, 'bone')
        with self.assertRaises(ValueError):
            self.propor(self.ana, self.bia, 'jaqueta', [bone_da_bia])

    def test_peca_que_ja_saiu_invalida_a_outra_oferta(self):
        cris = self.conta('cris')
        self.amigas(self.ana, cris)
        jaqueta = self.dar(self.bia, 'jaqueta')
        tenis = self.dar(cris, 'tenis')
        bone = self.dar(self.ana, 'bone')
        t1 = self.propor(self.ana, self.bia, 'jaqueta', [bone])
        t2 = self.propor(self.ana, cris, 'tenis', [bone])
        trocas.aceitar(self.bia, t1['id'], {'escolhida': 0, 'minha': {'numero': jaqueta['numero']}})
        r = trocas.aceitar(cris, t2['id'], {'escolhida': 0, 'minha': {'numero': tenis['numero']}})
        self.assertEqual(r['troca']['estado'], 'invalida')
        self.assertTrue(self.dono(tenis, cris)['voce'])

    def test_recusar_e_cancelar(self):
        self.dar(self.bia, 'jaqueta')
        bone = self.dar(self.ana, 'bone')
        t = self.propor(self.ana, self.bia, 'jaqueta', [bone])
        with self.assertRaises(contas.ErroDeConta):
            trocas.recusar(self.ana, t['id'])
        self.assertEqual(trocas.recusar(self.bia, t['id'])['troca']['estado'], 'recusada')
        t = self.propor(self.ana, self.bia, 'jaqueta', [bone])
        self.assertEqual(trocas.cancelar(self.ana, t['id'])['troca']['estado'], 'cancelada')
        self.assertEqual(trocas.recusar(self.bia, t['id'])['troca']['estado'], 'cancelada')

    def test_vencida_nao_aceita(self):
        jaqueta = self.dar(self.bia, 'jaqueta')
        bone = self.dar(self.ana, 'bone')
        t = self.propor(self.ana, self.bia, 'jaqueta', [bone])
        _ddb.update_item(TableName=contas.TABELA, Key={'pk': {'S': 'TROCA#' + t['id']}},
                         UpdateExpression='SET vence = :v', ExpressionAttributeValues={':v': {'N': '1'}})
        self.assertEqual(trocas.listar(self.bia)['trocas'][0]['estado'], 'vencida')
        r = trocas.aceitar(self.bia, t['id'], {'escolhida': 0, 'minha': {'numero': jaqueta['numero']}})
        self.assertEqual(r['troca']['estado'], 'vencida')
        self.assertTrue(self.dono(jaqueta, self.bia)['voce'])

    def test_duas_trocas_por_dia(self):
        bone = self.dar(self.ana, 'bone')
        saia = self.dar(self.ana, 'saia')
        colete = self.dar(self.ana, 'colete')
        minhas = [self.dar(self.bia, p) for p in ('jaqueta', 'tenis', 'meia')]
        ofertas = [self.propor(self.ana, self.bia, m['id'], [o])
                   for m, o in zip(minhas, (bone, saia, colete))]
        for t, m in zip(ofertas[:2], minhas):
            r = trocas.aceitar(self.bia, t['id'], {'escolhida': 0, 'minha': {'numero': m['numero']}})
            self.assertEqual(r['troca']['estado'], 'feita')
        with self.assertRaises(ValueError):
            trocas.aceitar(self.bia, ofertas[2]['id'], {'escolhida': 0, 'minha': {'numero': minhas[2]['numero']}})
        estados = {t['id']: t['estado'] for t in trocas.listar(self.bia)['trocas']}
        self.assertEqual(estados[ofertas[2]['id']], 'aberta')
        self.assertTrue(self.dono(minhas[2], self.bia)['voce'])


if __name__ == '__main__':
    unittest.main()
