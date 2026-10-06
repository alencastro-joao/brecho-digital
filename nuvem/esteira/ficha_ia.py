# -*- coding: utf-8 -*-
"""
O palpite da ficha, pelo Claude no Bedrock.

O nome fica de fora de propósito: toda peça chega sem nome e o admin dá um se
quiser.

A prévia já recortada vai como imagem, e a resposta volta por uma ferramenta
com esquema fechado: categoria e cor só podem ser das listas do jogo, então
o que chega aqui já entra na tela sem tradução. É palpite — a tela de revisão
mostra de onde veio e o admin corrige o que precisar.

As listas espelham `App/js/config.js` (CATEGORIAS e CORES). Mudou lá, muda
aqui.

Custo: Haiku 4.5, uma imagem de 460 px (~600 tokens) mais o texto. Na casa de
um décimo de centavo de dólar por peça.
"""

import json
import os

import boto3

MODELO = os.environ.get('BD_MODELO_IA') or 'us.anthropic.claude-haiku-4-5-20251001-v1:0'

CATEGORIAS = {
    'shoes': 'tênis, bota, sapato, sandália, chinelo',
    'pants': 'calça comprida, jeans, calça de moletom, legging',
    'shorts': 'bermuda, short',
    'skirts': 'saia',
    'dresses': 'vestido, macacão',
    'shirts': 'camiseta, camisa, polo, blusa de manga, moletom sem zíper',
    'coats': 'jaqueta, casaco, blazer, colete, moletom com zíper, corta-vento',
    'cropped': 'top, cropped, regata, top de alça, body, bustiê',
    'watches': 'relógio',
    'bracelets': 'pulseira, bracelete, anel',
    'necklaces': 'colar, corrente, gargantilha, pingente',
    'glasses': 'óculos de sol, óculos de grau',
    'hats': 'boné, chapéu, gorro, bucket, tiara',
    'bags': 'bolsa, mochila, pochete, carteira',
}
CORES = ['Preto', 'Branco', 'Cinza', 'Bege', 'Marrom', 'Vermelho', 'Rosa',
         'Laranja', 'Amarelo', 'Verde', 'Azul', 'Roxo', 'Dourado', 'Prateado',
         'Estampado']

FERRAMENTA = {
    'toolSpec': {
        'name': 'registrar_ficha',
        'description': 'Registra a ficha da peça de roupa da imagem.',
        'inputSchema': {'json': {
            'type': 'object',
            'properties': {
                'cat': {'type': 'string', 'enum': list(CATEGORIAS)},
                'cor': {'type': 'string', 'enum': CORES},
                'marca': {'type': 'string', 'description':
                          'Marca, só se houver logo ou escrita legível na peça. '
                          'Senão, string vazia.'},
                'confianca': {'type': 'number', 'description':
                              'De 0 a 1: quão seguro está da categoria.'},
            },
            'required': ['cat', 'cor', 'marca', 'confianca'],
        }},
    }
}

_cliente = None


def _bedrock():
    global _cliente
    if _cliente is None:
        _cliente = boto3.client('bedrock-runtime')
    return _cliente


def _instrucao(marcas):
    linhas = ['Você cataloga peças de um brechó digital. A imagem é uma peça '
              'já recortada, sobre fundo transparente.',
              '', 'Categorias:']
    linhas += ['- %s: %s' % (c, d) for c, d in CATEGORIAS.items()]
    linhas += ['', 'Cor: a cor dominante, entre as da lista. "Estampado" só '
               'quando nenhuma cor domina (xadrez, floral, listras de duas '
               'cores). Dourado e Prateado só para metal.']
    if marcas:
        linhas += ['', 'Marcas que já existem no acervo (se for uma delas, '
                   'escreva igual): ' + ', '.join(marcas)]
    linhas += ['', 'Responda chamando a ferramenta registrar_ficha.']
    return '\n'.join(linhas)


def sugerir(webp, marcas=()):
    """{cat, cor, marca, confianca, modelo} — ou {} se a IA falhar.

    Falha da IA não derruba a peça: ela entra sem palpite e o admin preenche.
    """
    try:
        r = _bedrock().converse(
            modelId=MODELO,
            messages=[{'role': 'user', 'content': [
                {'image': {'format': 'webp', 'source': {'bytes': webp}}},
                {'text': _instrucao(list(marcas))},
            ]}],
            toolConfig={'tools': [FERRAMENTA],
                        'toolChoice': {'tool': {'name': 'registrar_ficha'}}},
            inferenceConfig={'maxTokens': 300, 'temperature': 0},
        )
        for bloco in r['output']['message']['content']:
            if 'toolUse' in bloco:
                dados = bloco['toolUse']['input']
                break
        else:
            return {}
    except Exception as e:                       # noqa: BLE001
        print('(ia sem palpite: %s)' % e)
        return {}

    saida = {
        'cat': dados.get('cat') if dados.get('cat') in CATEGORIAS else '',
        'cor': dados.get('cor') if dados.get('cor') in CORES else '',
        'marca': str(dados.get('marca') or '').strip()[:40],
        'confianca': round(float(dados.get('confianca') or 0), 2),
        'modelo': MODELO,
    }
    return saida


if __name__ == '__main__':                       # teste à mão: python ficha_ia.py foto.webp
    import sys
    with open(sys.argv[1], 'rb') as fh:
        print(json.dumps(sugerir(fh.read(), sys.argv[2:]), ensure_ascii=False, indent=1))
