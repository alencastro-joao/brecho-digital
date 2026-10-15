# -*- coding: utf-8 -*-
"""
Pastas do Pinterest na esteira.

O admin cola o link de uma pasta (`pinterest.com/<usuario>/<pasta>/`, ou o
curto `pin.it/...` do botão de compartilhar) e as fotos dela entram na esteira
como se tivessem sido soltas na tela.

A pasta é lida pelo mesmo caminho que o site do Pinterest usa ao rolar a
página (`BoardFeedResource`, de 25 em 25), aos pedaços entre chamadas (ver
`ler_pasta`): público, sem app de desenvolvedor nem login, só para pasta
pública. Não é API documentada — se o
Pinterest mudar e ela falhar, a leitura cai para o feed RSS da pasta, que é
estável mas só mostra os 25 pins mais recentes.

O nome da pasta vira a categoria sugerida ("Calças" → pants). É só ponto de
partida — a ficha continua sendo revisada no cartão.
"""

import html
import http.cookiejar
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

AGENTE = 'Mozilla/5.0 (compatible; brecho-esteira/1.0)'
# A listagem da pasta só responde a quem parece o site: navegador de verdade,
# com os cookies e a versão que a página entrega.
NAVEGADOR = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
             '(KHTML, like Gecko) Chrome/130.0 Safari/537.36')
TEMPO = 8                      # segundos por pedido ao Pinterest
PARALELO = 8                   # fotos baixadas ao mesmo tempo
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


def imagem_do_pin(p):
    """A chave da foto no i.pinimg.com (32 hex do nome do arquivo): a mesma
    foto salva por outra pessoa vira outro pin, mas a imagem é a mesma."""
    achada = re.search(r'/([0-9a-f]{32})\.[a-z]+$', p.get('imagem') or '')
    return achada.group(1) if achada else ''


def conhecido(p, conhecidos):
    """O pin (ou a foto dele, por outro pin) já passou pela esteira."""
    img = imagem_do_pin(p)
    return p['pin'] in conhecidos or bool(img and 'img:' + img in conhecidos)


def ler_pasta(usuario, pasta, prazo=None, marcador=None, conhecidos=(), basta=None,
              ate_conhecida=False):
    """Um trecho da pasta, os mais recentes primeiro:

        {titulo, pins: [{pin, titulo, imagem, reserva}], quantos,
         completa, marcador, fim, andou, tentativas, falha}

    Pasta grande não cabe numa chamada da API, então a leitura anda aos
    pedaços: começa sempre pela primeira página (os pins novos) e segue do
    `marcador` salvo na chamada anterior. Para quando o `prazo` (time.time())
    chega, quando já achou `basta` pins fora de `conhecidos`, ou — com
    `ate_conhecida`, para pasta já lida inteira uma vez — na primeira página
    sem nada novo. Devolve o `marcador` para a próxima chamada (None quando
    não sobra nada: `fim`). `quantos` é o total que o Pinterest diz ter.

    `completa: False` quer dizer que o Pinterest não deixou folhear agora e
    só vieram os 25 mais recentes; o marcador volta intacto, e `falha` diz
    por quê. `andou` conta os pins percorridos além do topo já conhecido, e
    `tentativas` as visitas abertas até uma ser liberada — os dois aparecem
    na tela, para dar para ver o que o Pinterest está fazendo."""
    try:
        lida = _ler_inteira(usuario, pasta, prazo, marcador, set(conhecidos), basta, ate_conhecida)
        if lida['pins'] or lida['fim']:
            return lida
        falha = 'o Pinterest não deixou rolar a pasta'
    except Exception as e:                       # noqa: BLE001 - o RSS ainda serve
        print('pinterest: listagem completa falhou (%s); usando o RSS' % e)
        falha = str(e)[:200]
    return {**_ler_rss(usuario, pasta), 'marcador': marcador, 'fim': False, 'quantos': None,
            'falha': falha, 'andou': 0}


# Por que repetir a sessão: sem login, o Pinterest decide na hora de abrir a
# página se aquela visita pode rolar a pasta. Em mais ou menos metade das
# visitas a página já vem com a lista "no fim" (`-end-`) depois dos 25
# primeiros, e nenhum pedido daquela sessão traz mais nada — era isso que
# deixava a esteira vendo só 25 pins por pasta. Abrir de novo, com cookies
# novos, costuma vir liberada; e o marcador de uma sessão liberada vale em
# outra liberada (medido em out/2026), o que deixa continuar de onde parou.
TENTATIVAS = 6


class _Recusada(Exception):
    pass


def _sessao(caminho):
    """Abre a página da pasta como um navegador novo. Devolve (board, pagina)
    — `pagina(marcador)` pede um trecho de 25 com os cookies desta visita."""
    biscoitos = http.cookiejar.CookieJar()
    abrir = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(biscoitos))

    def pedir(url, cabecalhos=None):
        h = {'User-Agent': NAVEGADOR, 'Accept-Language': 'pt-BR,pt;q=0.9'}
        h.update(cabecalhos or {})
        with abrir.open(urllib.request.Request(url, headers=h), timeout=TEMPO) as r:
            return r.read().decode('utf-8', 'replace')

    # A página da pasta dá o id dela, o nome, os cookies e a versão do site.
    html_pagina = pedir('https://www.pinterest.com' + caminho)
    estado = re.search(r'<script[^>]+id="__PWS_INITIAL_PROPS__"[^>]*>(.*?)</script>', html_pagina, re.S)
    if not estado:
        raise ValueError('a página da pasta mudou')
    boards = (json.loads(estado.group(1)).get('initialReduxState') or {}).get('boards') or {}
    board = next((b for b in boards.values()
                  if (b.get('url') or '').lower() == caminho.lower()), None)
    if not board:
        raise ValueError('pasta não encontrada na página — ela é pública?')
    versao = (re.findall(r'"appVersion"\s*:\s*"([0-9a-f]+)"', html_pagina) or [''])[0]
    csrf = next((c.value for c in biscoitos if c.name == 'csrftoken'), '')

    def pagina(marcador=None):
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
        pins = []
        for p in resposta.get('data') or []:
            if not isinstance(p, dict) or p.get('type') != 'pin':
                continue
            imagens = p.get('images') or {}
            # A original primeiro: a de 736 px já chega comprimida e, depois
            # do recorte, a peça fica com uns 500 px — pouco para a tela.
            img = imagens.get('orig') or imagens.get('736x') or {}
            reserva = (imagens.get('736x') or {}).get('url')
            if img.get('url'):
                pins.append({'pin': str(p['id']), 'imagem': img['url'],
                             'reserva': reserva if reserva != img['url'] else None,
                             'titulo': (p.get('grid_title') or p.get('title') or '').strip()[:120]})
        seguinte = resposta.get('bookmark')
        return pins, (seguinte if seguinte and seguinte != '-end-' else None)

    return board, pagina


def _ler_inteira(usuario, pasta, prazo=None, marcador=None, conhecidos=frozenset(),
                 basta=None, ate_conhecida=False):
    caminho = '/%s/%s/' % (urllib.parse.quote(usuario), urllib.parse.quote(pasta))

    def sobra(s):
        return not prazo or time.time() + s < prazo

    # Uma visita liberada: a primeira página com marcador para a segunda, ou
    # a pasta pequena que cabe inteira nela.
    primeira, liberada = None, False
    for tentativa in range(TENTATIVAS):
        if tentativa:
            if not sobra(TEMPO / 2):
                break
            time.sleep(1)
        try:
            board, pagina = _sessao(caminho)
            pins, seguinte = pagina()
        except urllib.error.HTTPError as e:
            if e.code != 429 or not sobra(4):
                raise
            time.sleep(3)                        # devagar: muitas visitas seguidas
            continue
        quantos = board.get('pin_count')
        primeira = (board, pagina, pins, seguinte, quantos)
        liberada = bool(seguinte) or (isinstance(quantos, int) and quantos <= len(pins) + 2)
        if liberada:
            break
        print('pinterest: %s veio sem paginação (tentativa %d)' % (caminho, tentativa + 1))
    if primeira is None:
        raise ValueError('o Pinterest não respondeu')
    board, pagina, pins, seguinte, quantos = primeira
    titulo = (board.get('name') or pasta).strip()
    if not liberada:
        # Nenhuma visita liberada: só a primeira página, e o marcador fica
        # como estava para a próxima tentativa.
        return {'titulo': titulo, 'pins': pins, 'quantos': quantos, 'completa': False,
                'marcador': marcador, 'fim': False, 'tentativas': tentativa + 1, 'andou': 0,
                'falha': 'o Pinterest recusou %d visitas seguidas' % (tentativa + 1)}

    def novos():
        return sum(1 for p in pins if not conhecido(p, conhecidos))

    andou = 0 if marcador else len(pins)        # pins além do topo já relido
    if ate_conhecida and not marcador and pins and not novos():
        seguinte = None                          # nada novo no topo: em dia
    elif marcador:
        seguinte = marcador                      # o topo já veio; segue de onde parou
    while seguinte:
        if not sobra(TEMPO) or (basta and novos() >= basta):
            break
        try:
            trecho, proximo = pagina(seguinte)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503) or not sobra(TEMPO + 3):
                print('pinterest: página falhou (%s); continua na próxima chamada' % e)
                break
            time.sleep(2)
            continue
        if ate_conhecida and trecho and all(conhecido(p, conhecidos) for p in trecho):
            proximo = None                       # chegou ao que já tinha lido
        pins += trecho
        andou += len(trecho)
        seguinte = proximo
    vistos = set()
    pins = [p for p in pins if not (p['pin'] in vistos or vistos.add(p['pin']))]
    return {'titulo': titulo, 'pins': pins, 'quantos': quantos, 'completa': True,
            'marcador': seguinte, 'fim': not seguinte, 'tentativas': tentativa + 1, 'andou': andou}


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
        # O feed manda a miniatura de 236 px; a original e a de 736 px têm a
        # mesma chave. A original pode ser PNG enquanto a miniatura é sempre
        # JPG — aí o palpite erra, e a de 736 px fica de reserva.
        def tamanho(pasta):
            return re.sub(r'(i\.pinimg\.com/)[^/]+/', r'\g<1>%s/' % pasta, img.group(1))
        pins.append({'pin': num.group(1), 'imagem': tamanho('originals'),
                     'reserva': tamanho('736x'),
                     'titulo': (item.findtext('title') or '').strip()[:120]})
    return {'titulo': (canal.findtext('title') or pasta).strip(), 'pins': pins, 'completa': False}


def baixar_fotos(pins):
    """[(pin, bytes, tipo) | (pin, None, erro)] na ordem dos pins, em paralelo:
    a Lambda da API tem 30 s, e 25 fotos uma a uma não cabem."""
    def baixar(url):
        corpo, _, tipo = _baixar(url, MAX_FOTO)
        tipo = tipo.split(';')[0].strip().lower()
        if tipo not in ('image/jpeg', 'image/png', 'image/webp'):
            raise ValueError('tipo %s' % (tipo or 'desconhecido'))
        return corpo, tipo

    def uma(p):
        try:
            return (p, *baixar(p['imagem']))
        except Exception as e:                   # noqa: BLE001
            if not p.get('reserva'):
                return p, None, str(e)
        try:
            return (p, *baixar(p['reserva']))
        except Exception as e:                   # noqa: BLE001
            return p, None, str(e)
    with ThreadPoolExecutor(max_workers=PARALELO) as grupo:
        return list(grupo.map(uma, pins))
