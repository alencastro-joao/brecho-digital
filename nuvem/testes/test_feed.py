# -*- coding: utf-8 -*-
"""
Testes do feed (nuvem/lambda/feed.py) contra um DynamoDB e um S3 de mentira
(moto). Rodam no CI e em qualquer máquina, sem AWS:

    pip install moto
    python -m unittest discover -s nuvem/testes -v
"""

import base64
import gzip
import json
import os
import sys
import unittest
from datetime import timedelta

os.environ.update({
    'AWS_DEFAULT_REGION': 'us-east-1', 'AWS_ACCESS_KEY_ID': 'teste',
    'AWS_SECRET_ACCESS_KEY': 'teste', 'BD_TABELA': 'brecho-teste',
    'BD_BUCKET_SITE': 'site-teste', 'BD_SEGREDO_ORIGEM': '',
})

from moto import mock_aws  # noqa: E402

_moto = mock_aws()
_moto.start()               # antes dos imports: os módulos criam os clientes ao carregar

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'lambda'))

import boto3  # noqa: E402

import app  # noqa: E402
import contas  # noqa: E402
import feed  # noqa: E402
import gerador  # noqa: E402

_ddb = boto3.client('dynamodb')
_s3 = boto3.client('s3')
WEBP = 'data:image/webp;base64,' + base64.b64encode(b'RIFF\x00\x00\x00\x00WEBPVP8 ').decode()


def _post_antigo(post_id, autor, criado_em, **extra):
    """Um post gravado como o feed de antes gravava: sem linha do tempo."""
    item = {'pk': 'POST#' + post_id, 'id': post_id, 'autor': autor, 'tipo': 'look',
            'nome': 'Look', 'criado_em': criado_em, 'thumb': '', 'pecas': [],
            'origem': {}, 'camadas': '[]', 'comentarios': [], **extra}
    _ddb.put_item(TableName=contas.TABELA, Item={k: feed._ser.serialize(v) for k, v in item.items()})


def _pid(n):
    return 'p-%016x' % n


class Base(unittest.TestCase):
    def setUp(self):
        _ddb.create_table(TableName=contas.TABELA, BillingMode='PAY_PER_REQUEST',
                          AttributeDefinitions=[{'AttributeName': 'pk', 'AttributeType': 'S'}],
                          KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}])
        _s3.create_bucket(Bucket='site-teste')
        self.eu = contas.criar_conta('eu@exemplo.com', 'senha-boa-123', 'Eu', 'eu_mesma')['id']

    def tearDown(self):
        _ddb.delete_table(TableName=contas.TABELA)
        for o in _s3.list_objects_v2(Bucket='site-teste').get('Contents', []):
            _s3.delete_object(Bucket='site-teste', Key=o['Key'])
        _s3.delete_bucket(Bucket='site-teste')

    def indice(self):
        item = _ddb.get_item(TableName=contas.TABELA, Key={'pk': {'S': feed.INDICE}}).get('Item')
        return set(item['p']['M']) if item else None

    def todas_as_paginas(self, **kw):
        vistos, cursor, paginas = [], None, 0
        while True:
            r = feed.listar(self.eu, depois=cursor, **kw)
            vistos += [p['id'] for p in r['posts']]
            paginas += 1
            cursor = r['proximo']
            if not cursor:
                return vistos, paginas


class Migracao(Base):
    def test_posts_de_antes_aparecem_e_o_indice_nasce(self):
        base = contas.agora()
        for n in range(7):
            _post_antigo(_pid(n), self.eu, contas.iso(base - timedelta(hours=n)))
        self.assertIsNone(self.indice())
        r = feed.listar(self.eu)
        self.assertEqual([p['id'] for p in r['posts']], [_pid(n) for n in range(7)])
        self.assertEqual(self.indice(), {_pid(n) for n in range(7)})
        self.assertIsNone(r['proximo'])
        # Nada nos posts mudou.
        self.assertIn('Item', _ddb.get_item(TableName=contas.TABELA, Key={'pk': {'S': 'POST#' + _pid(3)}}))

    def test_fuso_diferente_ordena_pela_hora_de_verdade(self):
        _post_antigo(_pid(1), self.eu, '2026-10-10T10:00:00-03:00')     # 13:00 UTC
        _post_antigo(_pid(2), self.eu, '2026-10-10T12:00:00+00:00')
        self.assertEqual([p['id'] for p in feed.listar(self.eu)['posts']], [_pid(1), _pid(2)])


class Paginas(Base):
    def setUp(self):
        super().setUp()
        base = contas.agora()
        for n in range(25):
            # Pares de posts no mesmo segundo: o desempate pelo id não pode
            # pular nem repetir ninguém entre uma página e outra.
            _post_antigo(_pid(n), self.eu if n % 3 else 'u-lia',
                         contas.iso(base - timedelta(minutes=n // 2)))

    def test_cursor_percorre_tudo_sem_repetir(self):
        vistos, paginas = self.todas_as_paginas(limite=4)
        self.assertEqual(len(vistos), 25)
        self.assertEqual(len(set(vistos)), 25)
        self.assertEqual(paginas, 7)
        self.assertEqual(vistos, [p['id'] for p in feed.listar(self.eu)['posts']])

    def test_filtro_por_autor(self):
        vistos, _ = self.todas_as_paginas(autor='u-lia', limite=3)
        self.assertEqual(sorted(vistos), sorted(_pid(n) for n in range(25) if n % 3 == 0))

    def test_post_sumido_sai_do_indice_e_a_pagina_fica_cheia(self):
        feed.listar(self.eu)
        primeiro = feed.listar(self.eu, limite=1)['posts'][0]['id']
        _ddb.delete_item(TableName=contas.TABELA, Key={'pk': {'S': 'POST#' + primeiro}})
        r = feed.listar(self.eu, limite=5)
        self.assertEqual(len(r['posts']), 5)
        self.assertNotIn(primeiro, self.indice())

    def test_cursor_e_limite_invalidos(self):
        with self.assertRaises(contas.ErroDeConta):
            feed.listar(self.eu, depois='nao-e-cursor!')
        with self.assertRaises(contas.ErroDeConta):
            feed.listar(self.eu, depois=base64.urlsafe_b64encode(b'x|y' * 4).decode())
        with self.assertRaises(contas.ErroDeConta):
            feed.listar(self.eu, limite='muitos')
        self.assertEqual(len(feed.listar(self.eu, limite=999)['posts']), 25)


class Escrever(Base):
    def test_publicar_editar_apagar(self):
        r = feed.publicar(self.eu, {'chave': 'look:a1', 'tipo': 'look', 'nome': 'Primeiro',
                                    'thumb': WEBP, 'pecas': ['1', '2']})
        pid = r['posts'][0]['id']
        self.assertEqual(self.indice(), {pid})
        # Publicar de novo o mesmo look devolve o mesmo post.
        self.assertEqual(feed.publicar(self.eu, {'chave': 'look:a1', 'thumb': WEBP})['posts'][0]['id'], pid)
        feed.publicar(self.eu, {'chave': 'look:a1', 'nome': 'Editado', 'thumb': WEBP, 'atualizar': True})
        self.assertEqual(feed.listar(self.eu)['posts'][0]['nome'], 'Editado')
        feed.curtir(self.eu, pid, True)
        feed.comentar(self.eu, pid, 'oi')
        p = feed.listar(self.eu)['posts'][0]
        self.assertEqual((p['curtidas'], p['curtido'], len(p['comentarios'])), (1, True, 1))
        feed.apagar(self.eu, pid)
        self.assertEqual(self.indice(), set())
        self.assertEqual(feed.listar(self.eu)['posts'], [])

    def test_publicar_sem_indice_monta_com_os_antigos(self):
        _post_antigo(_pid(9), self.eu, contas.iso(contas.agora() - timedelta(days=1)))
        pid = feed.publicar(self.eu, {'chave': 'board:b1', 'tipo': 'board', 'thumb': WEBP})['posts'][0]['id']
        self.assertEqual(self.indice(), {pid, _pid(9)})


class Gerador(Base):
    def test_rodadas_indexam_e_respeitam_o_teto(self):
        cats = ['shirts', 'pants', 'shoes', 'hats', 'bags', 'dresses']
        itens = [{'id': str(100 + n), 'cat': cats[n % len(cats)], 'nome': 'Peça %d' % n} for n in range(30)]
        _s3.put_object(Bucket='site-teste', Key='assets/acervo.json', Body=json.dumps({'items': itens}))
        for _ in range(4):
            gerador.rodar(quantos=gerador.QUANTOS_MAX)
        gerados = feed.linha_do_tempo(so_gerados=True)
        self.assertTrue(gerados)
        self.assertLessEqual(len(gerados), gerador.MAX_GERADOS)
        self.assertEqual({e['id'] for e in gerados}, self.indice())


class Api(Base):
    def pedir(self, rota, consulta=None, gzip_ok=True):
        token, _ = contas.abrir_sessao(self.eu)
        evento = {
            'requestContext': {'http': {'method': 'GET', 'sourceIp': '1.2.3.4'}},
            'rawPath': rota, 'queryStringParameters': consulta or {},
            'headers': {'accept-encoding': 'gzip, br'} if gzip_ok else {},
            'cookies': ['%s=%s' % (contas.COOKIE, token)],
        }
        r = app.handler(evento, None)
        corpo = r['body']
        if r.get('isBase64Encoded'):
            corpo = gzip.decompress(base64.b64decode(corpo)).decode()
        return r, json.loads(corpo)

    def test_pagina_pela_api_comprimida(self):
        base = contas.agora()
        for n in range(30):
            _post_antigo(_pid(n), self.eu, contas.iso(base - timedelta(minutes=n)),
                         comentarios=[{'id': 'c-%010x' % n, 'autor': self.eu, 'texto': 'x' * 100, 'em': '2026'}])
        r, dados = self.pedir('/api/feed', {'limite': '20'})
        self.assertEqual(r['statusCode'], 200)
        self.assertEqual(r['headers'].get('Content-Encoding'), 'gzip')
        self.assertEqual(len(dados['posts']), 20)
        self.assertIn(self.eu, dados['autores'])
        r, dados = self.pedir('/api/feed', {'depois': dados['proximo']})
        self.assertEqual(len(dados['posts']), 10)
        self.assertIsNone(dados['proximo'])
        r, dados = self.pedir('/api/feed', {'limite': '2'}, gzip_ok=False)
        self.assertNotIn('Content-Encoding', r['headers'])

    def test_cursor_ruim_e_400(self):
        r, dados = self.pedir('/api/feed', {'depois': '%%%'})
        self.assertEqual(r['statusCode'], 400)


if __name__ == '__main__':
    unittest.main()
