# -*- coding: utf-8 -*-
"""
Pastas do Pinterest na esteira.

O admin cola o link de uma pasta (`pinterest.com/<usuario>/<pasta>/`, ou o
curto `pin.it/...` do botão de compartilhar) e as fotos dela entram na esteira
como se tivessem sido soltas na tela.

A pasta é lida inteira pelo mesmo caminho que o site do Pinterest usa ao
rolar a página (`BoardFeedResource`, de 25 em 25): público, sem app de
desenvolvedor nem login, só para pasta pública. Não é API documentada — se o
Pinterest mudar e ela falhar, a leitura cai para o feed RSS da pasta, que é
estável mas só mostra os 25 pins mais recentes.

O nome da pasta vira a categoria sugerida ("Calças" → pants). É só ponto de
partida — a ficha continua sendo revisada no cartão.
"""

import html
import http.cookiejar
import json
import re
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

AGENTE = 'Mozilla/5.0 (compatible; brecho-esteira/1.0)'
# A listagem da pasta só responde a quem parece o site: navegador de verdade,
# com os cookies e a versão que a página entrega.
NAVEGADOR = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
             '(KHTML, like Gecko) Chrome/130.0 Safari/537.36')
MAX_PAGINAS = 20               # 500 pins: além disso, a pasta é outra coisa
TEMPO = 10                     # segundos por pedido ao Pinterest
MAX_FOTO = 15 * 1024 * 1024
HOSTS = re.compile(r'(^|\.)pinterest\.[a-z.]+$|^pin\.it$')
# Caminhos de pinterest.com que não são pasta de ninguém.
RESERVADOS = {'pin', 'search', 'ideas', 'today', 'settings', 'business',
              'url_shortener', '_', 'explore'}

# Palavra no nome da pasta → categoria do jogo (as de acervo.CATS). Casa pelo
# começo da palavra: "calças", "camisetas", "tops" pegam.
PALAVRAS = [
    ('shorts', ('bermuda', 'short')),
    ('pants', ('calca', 'pants', 'jeans', 'trouser', 'legging')),
    ('shoes', ('tenis', 'sapato', 'shoe', 'sneaker', 'bota', 'boot', 'sandalia', 'chinelo', 'calcado')),
    ('skirts', ('saia', 'skirt')),
    ('dresses', ('vestido', 'dress', 'macacao')),
    ('coats', ('jaqueta', 'casaco', 'coat', 'jacket', 'blazer', 'colete', 'corta')),
    ('cropped', ('cropped', 'top', 'regata', 'body', 'bustie')),
    ('shirts', ('camis', 'shirt', 'tee', 'polo', 'blusa', 'moletom', 'hoodie', 'sweat')),
    ('watches', ('relogio', 'watch')),
    ('bracelets', ('pulseira', 'bracelet', 'anel', 'aneis', 'ring')),
    ('necklaces', ('colar', 'necklace', 'corrente', 'chain', 'gargantilha')),
    ('glasses', ('oculos', 'glasses', 'sunglass')),
    ('hats', ('bone', 'chapeu', 'hat', 'cap', 'gorro', 'bucket', 'beanie')),
    ('bags', ('bolsa', 'bag', 'mochila', 'pochete', 'carteira')),
]


def _baixar(url, limite):
    pedido = urllib.request.Request(url, headers={'User-Agent': AGENTE})
    with urllib.request.urlopen(pedido, timeout=TEMPO) as r:
        corpo = r.read(limite + 1)
        if len(corpo) > limite:
            raise ValueError('arquivo grande demais')
        return corpo, r.geturl(), r.headers.get('Content-Type', '')


def _sem_acento(texto):
    texto = unicodedata.normalize('NFD', texto or '')
    return texto.encode('ascii', 'ignore').decode().lower()


def pasta_do_link(link):
    """(usuario, pasta) do link colado. Segue o `pin.it` até a pasta."""
    link = str(link or '').strip()
    if not re.match(r'^https?://', link):
        link = 'https://' + link
    partes = urllib.parse.urlsplit(link)
    if not HOSTS.search((partes.hostname or '').lower()):
        raise ValueError('esse link não é do Pinterest')
    if partes.hostname.lower() == 'pin.it':
        try:
            _, link, _ = _baixar(link, 2 * 1024 * 1024)
        except Exception:
            raise ValueError('não consegui abrir o link curto do Pinterest')
        partes = urllib.parse.urlsplit(link)
    trechos = [urllib.parse.unquote(t) for t in partes.path.split('/') if t]
    if len(trechos) < 2 or trechos[0] in RESERVADOS:
        raise ValueError('cole o link de uma pasta (pinterest.com/usuario/pasta), não de um pin')
    return trechos[0], re.sub(r'\.rss$', '', trechos[1])


def categoria_do_nome(nome):
    palavras = re.findall(r'[a-z]+', _sem_acento(nome))
    for cat, chaves in PALAVRAS:
        if any(p.startswith(c) for p in palavras for c in chaves):
            return cat
    return ''


def ler_pasta(usuario, pasta):
    """{titulo, pins: [{pin, titulo, imagem}], completa} — a pasta inteira,
    os mais recentes primeiro. Sem a listagem completa, os 25 do RSS
    (`completa: False`)."""
    try:
        lida = _ler_inteira(usuario, pasta)
        if lida['pins']:
            return lida
    except Exception as e:                       # noqa: BLE001 - o RSS ainda serve
        print('pinterest: listagem completa falhou (%s); usando o RSS' % e)
    return _ler_rss(usuario, pasta)


def _ler_inteira(usuario, pasta):
    caminho = '/%s/%s/' % (urllib.parse.quote(usuario), urllib.parse.quote(pasta))
    biscoitos = http.cookiejar.CookieJar()
    abrir = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(biscoitos))

    def pedir(url, cabecalhos=None):
        h = {'User-Agent': NAVEGADOR, 'Accept-Language': 'pt-BR,pt;q=0.9'}
        h.update(cabecalhos or {})
        with abrir.open(urllib.request.Request(url, headers=h), timeout=TEMPO) as r:
            return r.read().decode('utf-8', 'replace')

    # A página da pasta dá o id dela, o nome, os cookies e a versão do site.
    pagina = pedir('https://www.pinterest.com' + caminho)
    estado = re.search(r'<script[^>]+id="__PWS_INITIAL_PROPS__"[^>]*>(.*?)</script>', pagina, re.S)
    if not estado:
        raise ValueError('a página da pasta mudou')
    boards = (json.loads(estado.group(1)).get('initialReduxState') or {}).get('boards') or {}
    board = next((b for b in boards.values()
                  if (b.get('url') or '').lower() == caminho.lower()), None)
    if not board:
        raise ValueError('pasta não encontrada na página — ela é pública?')
    versao = (re.findall(r'"appVersion"\s*:\s*"([0-9a-f]+)"', pagina) or [''])[0]
    csrf = next((c.value for c in biscoitos if c.name == 'csrftoken'), '')

    pins, marcador = [], None
    for _ in range(MAX_PAGINAS):
        opcoes = {'board_id': board['id'], 'board_url': caminho, 'page_size': 25,
                  'field_set_key': 'react_grid_pin', 'filter_section_pins': False,
                  'sort': 'default', 'layout': 'default', 'redux_normalize_feed': True}
        if marcador:
            opcoes['bookmarks'] = [marcador]
        q = urllib.parse.urlencode({'source_url': caminho, 'data': json.dumps(
            {'options': opcoes, 'context': {}}, separators=(',', ':'))})
        resposta = json.loads(pedir('https://www.pinterest.com/resource/BoardFeedResource/get/?' + q, {
            'Accept': 'application/json, text/javascript, */*, q=0.01',
            'X-Requested-With': 'XMLHttpRequest', 'X-APP-VERSION': versao,
            'X-Pinterest-AppState': 'active', 'X-CSRFToken': csrf,
            # Sem este, a listagem responde 403.
            'X-Pinterest-PWS-Handler': 'www/[username]/[slug].js',
            'Referer': 'https://www.pinterest.com/', 'Origin': 'https://www.pinterest.com',
        }))['resource_response']
        dados = resposta.get('data') or []
        for p in dados:
            if not isinstance(p, dict) or p.get('type') != 'pin':
                continue
            imagens = p.get('images') or {}
            img = imagens.get('736x') or imagens.get('orig') or {}
            if img.get('url'):
                pins.append({'pin': str(p['id']), 'imagem': img['url'],
                             'titulo': (p.get('grid_title') or p.get('title') or '').strip()[:120]})
        marcador = resposta.get('bookmark')
        if not dados or not marcador or marcador == '-end-':
            break
    vistos = set()
    pins = [p for p in pins if not (p['pin'] in vistos or vistos.add(p['pin']))]
    return {'titulo': (board.get('name') or pasta).strip(), 'pins': pins, 'completa': True}


def _ler_rss(usuario, pasta):
    """O feed RSS: estável, mas só os 25 pins mais recentes."""
    url = 'https://www.pinterest.com/%s/%s.rss' % (
        urllib.parse.quote(usuario), urllib.parse.quote(pasta))
    try:
        corpo, _, _ = _baixar(url, 5 * 1024 * 1024)
        canal = ET.fromstring(corpo).find('channel')
    except Exception:
        raise ValueError('não consegui ler essa pasta — ela é pública?')
    if canal is None:
        raise ValueError('não consegui ler essa pasta — ela é pública?')

    pins = []
    for item in canal.findall('item'):
        descricao = html.unescape(item.findtext('description') or '')
        img = re.search(r'<img[^>]+src="([^"]+)"', descricao)
        link = item.findtext('link') or item.findtext('guid') or ''
        num = re.search(r'/pin/(\d+)', link)
        if not img or not num:
            continue
        # O feed manda a miniatura de 236 px; a de 736 px tem a mesma chave.
        imagem = re.sub(r'(i\.pinimg\.com/)[^/]+/', r'\g<1>736x/', img.group(1))
        pins.append({'pin': num.group(1), 'imagem': imagem,
                     'titulo': (item.findtext('title') or '').strip()[:120]})
    return {'titulo': (canal.findtext('title') or pasta).strip(), 'pins': pins, 'completa': False}


def baixar_fotos(pins):
    """[(pin, bytes, tipo) | (pin, None, erro)] na ordem dos pins, em paralelo:
    a Lambda da API tem 30 s, e 25 fotos uma a uma não cabem."""
    def uma(p):
        try:
            corpo, _, tipo = _baixar(p['imagem'], MAX_FOTO)
            tipo = tipo.split(';')[0].strip().lower()
            if tipo not in ('image/jpeg', 'image/png', 'image/webp'):
                raise ValueError('tipo %s' % (tipo or 'desconhecido'))
            return p, corpo, tipo
        except Exception as e:                   # noqa: BLE001
            return p, None, str(e)
    with ThreadPoolExecutor(max_workers=8) as grupo:
        return list(grupo.map(uma, pins))
