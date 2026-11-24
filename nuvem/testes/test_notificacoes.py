# -*- coding: utf-8 -*-
"""
Testes dos avisos no celular (nuvem/lambda/notificacoes.py) contra um DynamoDB
de mentira (moto). O push de verdade não sai: `_empurrar` é trocado por uma
lista.

    pip install moto
    python -m unittest discover -s nuvem/testes -v
"""

import json
import os
import sys
import unittest
from datetime import datetime

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
import notificacoes as n  # noqa: E402

_ddb = boto3.client('dynamodb')
EP = 'https://fcm.googleapis.com/fcm/send/abc123'


def hora(h, dia=10):
    """Um instante em Brasília (dia de novembro de 2026, h horas)."""
    return int(datetime(2026, 11, dia, h, 0, tzinfo=n.BRASILIA).timestamp())


class Assinatura(unittest.TestCase):
    def test_assina_e_confere(self):
        d, pub = n.novo_par()
        self.assertEqual(len(pub), 65)
        self.assertTrue(n.na_curva((int.from_bytes(pub[1:33], 'big'), int.from_bytes(pub[33:], 'big'))))
        sig = n.assinar(d, b'mensagem')
        self.assertTrue(n.conferir(pub, b'mensagem', sig))
        self.assertFalse(n.conferir(pub, b'outra', sig))

    def test_confere_com_a_biblioteca_cryptography(self):
        try:
            from cryptography.exceptions import InvalidSignature
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.primitives.asymmetric import ec
            from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
        except ImportError:
            self.skipTest('cryptography não instalada')
        d, pub = n.novo_par()
        chave = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), pub)
        sig = n.assinar(d, b'jwt.de.teste')
        der = encode_dss_signature(int.from_bytes(sig[:32], 'big'), int.from_bytes(sig[32:], 'big'))
        chave.verify(der, b'jwt.de.teste', ec.ECDSA(hashes.SHA256()))
        with self.assertRaises(InvalidSignature):
            chave.verify(der, b'outra', ec.ECDSA(hashes.SHA256()))


class Base(unittest.TestCase):
    def setUp(self):
        _ddb.create_table(TableName=contas.TABELA, BillingMode='PAY_PER_REQUEST',
                          AttributeDefinitions=[{'AttributeName': 'pk', 'AttributeType': 'S'}],
                          KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}])
        n._chave = None
        self.mandados = []
        self._empurrar = n._empurrar
        n._empurrar = lambda ep: self.mandados.append(ep) or ep != 'morto'
        self.ana = {'id': 'u-ana'}

    def tearDown(self):
        n._empurrar = self._empurrar
        _ddb.delete_table(TableName=contas.TABELA)

    def item(self):
        return contas._pegar('PUSH#u-ana')

    def ajustar(self, **campos):
        it = self.item()
        it.update(campos)
        _ddb.put_item(**contas._put(it))


class Inscricao(Base):
    def test_chave_nasce_uma_vez(self):
        a = n.chave_publica()['chave']
        n._chave = None
        self.assertEqual(n.chave_publica()['chave'], a)

    def test_cabecalho_vapid_assina_o_jwt(self):
        cab = n._cabecalho_vapid(EP)
        t = cab.split('t=')[1].split(',')[0]
        k = cab.split('k=')[1]
        topo, corpo, sig = t.split('.')
        claims = json.loads(n._de_b64(corpo))
        self.assertEqual(claims['aud'], 'https://fcm.googleapis.com')
        self.assertTrue(n.conferir(n._de_b64(k), (topo + '.' + corpo).encode(), n._de_b64(sig)))

    def test_recusa_endereco_que_nao_e_servico_de_push(self):
        for ep in ('http://fcm.googleapis.com/x', 'https://exemplo.com/x',
                   'https://fcm.googleapis.com.exemplo.com/x', 'https://fcm.googleapis.com:8080/x', None):
            with self.assertRaises(ValueError):
                n.inscrever(self.ana, {'endpoint': ep})

    def test_inscrever_e_sair(self):
        n.inscrever(self.ana, {'endpoint': EP})
        self.assertIn('u-ana', contas._pegar('PUSHLISTA')['uids'])
        self.assertEqual(n.agenda(self.ana, {'postit': 123})['inscrito'], True)
        n.desinscrever(self.ana, {'endpoint': EP})
        self.assertIsNone(self.item())
        self.assertFalse((contas._pegar('PUSHLISTA') or {}).get('uids'))
        self.assertEqual(n.agenda(self.ana, {})['inscrito'], False)

    def test_aviso_do_aparelho(self):
        self.assertEqual(n.aviso_do_aparelho({'endpoint': EP})['titulo'], n.GENERICO['titulo'])
        n.inscrever(self.ana, {'endpoint': EP})
        n.avisar('u-ana', 'troca', {'texto': '@bia quer trocar'}, agora=hora(15))
        a = n.aviso_do_aparelho({'endpoint': EP})
        self.assertEqual(a['texto'], '@bia quer trocar')
        self.assertEqual(a['titulo'], n.TEXTOS['troca']['titulo'])


class Agenda(Base):
    def setUp(self):
        super().setUp()
        n.inscrever(self.ana, {'endpoint': EP})
        self.ajustar(visto=hora(8, dia=9), ultimo=0)

    def test_troca_sai_na_hora(self):
        self.assertTrue(n.avisar('u-ana', 'troca', {'texto': 'oi'}, agora=hora(15)))
        self.assertEqual(self.mandados, [EP])

    def test_troca_no_silencio_espera_a_manha(self):
        self.assertFalse(n.avisar('u-ana', 'troca', {'texto': 'oi'}, agora=hora(23)))
        self.assertEqual(self.mandados, [])
        self.assertEqual(n.rodar_agendado(hora(3, dia=11))['silencio'], True)
        n.rodar_agendado(hora(8, dia=11))
        self.assertEqual(self.mandados, [EP])
        self.assertEqual(self.item()['aviso']['texto'], 'oi')
        self.assertNotIn('pendente', self.item())

    def test_um_aviso_a_cada_tres_horas(self):
        n.avisar('u-ana', 'troca', {}, agora=hora(10))
        self.assertFalse(n.avisar('u-ana', 'troca', {}, agora=hora(11)))
        n.rodar_agendado(hora(12))
        self.assertEqual(len(self.mandados), 1)
        n.rodar_agendado(hora(13))
        self.assertEqual(len(self.mandados), 2)

    def test_postit_quando_chega(self):
        self.ajustar(postit=hora(14), vitrineDia='2026-11-10')
        n.rodar_agendado(hora(13))
        self.assertEqual(self.mandados, [])
        n.rodar_agendado(hora(14))
        self.assertEqual(self.item()['aviso']['url'], '#/tarefas')
        self.assertEqual(self.item()['postit'], 0)

    def test_postit_nao_chama_quem_abriu_o_jogo(self):
        self.ajustar(postit=hora(14), visto=hora(14) + 60, vitrineDia='2026-11-10')
        n.rodar_agendado(hora(14) + 600)
        self.assertEqual(self.mandados, [])

    def test_vitrine_uma_vez_por_dia_para_quem_nao_abriu(self):
        n.rodar_agendado(hora(8))
        self.assertEqual(self.mandados, [])
        n.rodar_agendado(hora(9))
        self.assertEqual(self.item()['aviso']['url'], '#/vitrine')
        n.rodar_agendado(hora(16))
        self.assertEqual(len(self.mandados), 1)

    def test_vitrine_nao_chama_quem_ja_abriu_hoje(self):
        self.ajustar(visto=hora(8))
        n.rodar_agendado(hora(10))
        self.assertEqual(self.mandados, [])

    def test_aparelho_morto_sai(self):
        self.ajustar(aparelhos={'x': {'endpoint': 'morto', 'criado': 1}})
        n.rodar_agendado(hora(10))
        self.assertIsNone(self.item())


if __name__ == '__main__':
    unittest.main()
