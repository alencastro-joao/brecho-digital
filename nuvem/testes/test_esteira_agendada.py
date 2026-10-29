# -*- coding: utf-8 -*-
"""
Testes da leitura agendada do Pinterest (esteira.rodar_agendado), sem
Pinterest nem Lambda de verdade: a rodada (`_reler`) e a chamada da rodada
seguinte são trocadas por dublês.

    python -m unittest discover -s nuvem/testes -v
"""

import json
import os
import sys
import unittest
from unittest import mock

os.environ.update({
    'AWS_DEFAULT_REGION': 'us-east-1', 'AWS_ACCESS_KEY_ID': 'teste',
    'AWS_SECRET_ACCESS_KEY': 'teste', 'BD_BUCKET_SITE': 'site-teste',
    'BD_BUCKET_DADOS': 'dados-teste', 'AWS_LAMBDA_FUNCTION_NAME': 'brecho-api',
})

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'lambda'))

import esteira  # noqa: E402


class LeituraAgendada(unittest.TestCase):
    def rodar(self, pastas, rodada=0, ocupado=False, feitas=()):
        lam = mock.Mock()
        volta = {'pastas': [], 'ocupado': True} if ocupado else {'pastas': pastas}
        with mock.patch.object(esteira, '_pastas', return_value=[{'id': 'p1'}]), \
                mock.patch.object(esteira, '_reler', return_value=volta), \
                mock.patch.object(esteira, '_lambda', lam):
            feito = esteira.rodar_agendado(feitas, rodada)
        chamada = json.loads(lam.invoke.call_args.kwargs['Payload']) if lam.invoke.called else None
        return feito, chamada

    def test_sem_pastas_nao_le(self):
        with mock.patch.object(esteira, '_pastas', return_value=[]), \
                mock.patch.object(esteira, '_reler') as reler:
            self.assertEqual(esteira.rodar_agendado(), {'pastas': 0})
            reler.assert_not_called()

    def test_pasta_grande_encadeia(self):
        feito, chamada = self.rodar([{'id': 'p1', 'entraram': 40, 'faltam': 3},
                                     {'id': 'p2', 'entraram': 2, 'faltam': 0}])
        self.assertTrue(feito['segue'])
        self.assertEqual(chamada, {'agendado': 'reler-pinterest', 'feitas': ['p2'], 'rodada': 1})

    def test_acabou_nao_encadeia(self):
        feito, chamada = self.rodar([{'id': 'p1', 'entraram': 5, 'faltam': 0}])
        self.assertFalse(feito['segue'])
        self.assertIsNone(chamada)

    def test_recusada_espera_a_agenda(self):
        _, chamada = self.rodar([{'id': 'p1', 'continua': True, 'recusada': True}])
        self.assertIsNone(chamada)

    def test_teto_de_rodadas(self):
        _, chamada = self.rodar([{'id': 'p1', 'faltam': 3}], rodada=esteira.MAX_ENCADEADAS - 1)
        self.assertIsNone(chamada)

    def test_tela_lendo_nao_encadeia(self):
        feito, chamada = self.rodar([], ocupado=True)
        self.assertTrue(feito['ocupado'])
        self.assertIsNone(chamada)

    def test_so_adiadas_sem_andar_para(self):
        _, chamada = self.rodar([{'id': 'p1', 'adiada': True}])
        self.assertIsNone(chamada)


if __name__ == '__main__':
    unittest.main()
