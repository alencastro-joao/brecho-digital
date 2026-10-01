# -*- coding: utf-8 -*-
"""
A API do brechó na Lambda — o `servidor.py` sem o servidor.

Mesmas rotas, mesmos códigos de erro, mesmo formato de resposta. O que some é
a parte de servir arquivo estático: isso agora é o S3 atrás do CloudFront, e
esta função só responde `/api/*`.

    GET  /api/auth/eu          quem está logado
    POST /api/auth/registrar   cria a conta e já entra
    POST /api/auth/entrar      login
    POST /api/auth/sair        encerra a sessão
    POST /api/auth/senha       troca a senha (e derruba as outras sessões)
    PUT  /api/auth/eu          muda nome e @
    GET  /api/estado           o save do jogo na nuvem
    PUT  /api/estado           grava o save
    GET  /api/usuarios?q=      procura pessoas (ver pessoas.py)
    GET  /api/usuarios/<id>    a página pública de uma pessoa
    POST /api/seguir           segue ou deixa de seguir
    GET  /api/social           quem eu sigo e quem me segue
    PUT  /api/perfil           o que os outros leem de mim: bio, rosto, roupa
    POST /api/pecas            admin: peça nova no acervo
    PUT  /api/pecas/<id>       admin: edita a peça
    GET  /api/estoque          quantas cópias de cada peça já saíram (ver estoque.py)
    POST /api/estoque/levar    reserva uma cópia (409 se esgotou)
    POST /api/estoque/devolver admin: a cópia volta para a loja
    POST /api/fundo            503 por enquanto (ver nota no fim do arquivo)

**Por que a Function URL não é pública de verdade.** Ela nasce com
`AuthType NONE` — precisa ser, porque quem chama é o CloudFront, e a assinatura
SigV4 do OAC não cobre o corpo de um POST para Function URL. No lugar disso o
CloudFront injeta um cabeçalho secreto em toda requisição de origem, e esta
função recusa qualquer pedido que chegue sem ele. Quem descobrir a URL
`...lambda-url...on.aws` não consegue fazer nada com ela.

**De onde vem o IP.** Atrás do CloudFront, `sourceIp` é o IP do CloudFront, não
o de quem está do outro lado — usá-lo no rate limit juntaria o mundo inteiro
num balde só. O IP verdadeiro é o **último** item do `X-Forwarded-For`: o
CloudFront acrescenta o do visitante ao fim do que já estava lá, então o que um
atacante tenha inventado fica antes, e nunca no lugar que a gente lê.
"""

import json
import os
import re
import secrets
from http import cookies as _cookies

import contas
import estado as save
import estoque
import pessoas

SEGREDO = os.environ.get('BD_SEGREDO_ORIGEM') or ''
CABECALHO_SEGREDO = 'x-origem-brecho'

LIMITE_LOGIN = 8 * 1024             # cadastro e login são texto curto
LIMITE_PECA = 5 * 1024 * 1024       # a Function URL para em 6 MB: fique abaixo
LIMITE_ESTADO = 5 * 1024 * 1024

ROTA_PECA = re.compile(r'^/api/pecas/([^/]+)$')
ROTA_USUARIO = re.compile(r'^/api/usuarios/([^/]+)$')
ROTAS_DE_PESSOAS = ('/api/usuarios', '/api/seguir', '/api/social', '/api/perfil')


class Pedido:
    """O event da Lambda com cara de requisição."""

    def __init__(self, evento):
        http = (evento.get('requestContext') or {}).get('http') or {}
        self.metodo = http.get('method', 'GET')
        self.rota = (evento.get('rawPath') or '/').rstrip('/') or '/'
        self.cabecalhos = {k.lower(): v for k, v in (evento.get('headers') or {}).items()}
        self.cookies = evento.get('cookies') or []
        self.consulta = evento.get('queryStringParameters') or {}
        self._corpo = evento.get('body') or ''
        self._base64 = bool(evento.get('isBase64Encoded'))

    @property
    def agente(self):
        return self.cabecalhos.get('user-agent', '')

    @property
    def origem(self):
        encadeado = self.cabecalhos.get('x-forwarded-for', '')
        if encadeado:
            return encadeado.split(',')[-1].strip()
        return self.cabecalhos.get('cloudfront-viewer-address', '').rsplit(':', 1)[0]

    def token(self):
        for bruto in self.cookies:
            try:
                biscoito = _cookies.SimpleCookie(bruto)
            except _cookies.CookieError:
                continue
            if contas.COOKIE in biscoito:
                return biscoito[contas.COOKIE].value
        return None

    def corpo(self, limite):
        bruto = self._corpo
        if self._base64:
            import base64 as b64
            bruto = b64.b64decode(bruto).decode('utf-8')
        if not bruto or len(bruto) > limite:
            raise Limite('corpo vazio ou grande demais')
        return json.loads(bruto)


class Limite(Exception):
    pass


# --- Respostas ------------------------------------------------------------
def responder(codigo, dados, cookies=None):
    r = {
        'statusCode': codigo,
        'headers': {'Content-Type': 'application/json; charset=utf-8',
                    'Cache-Control': 'no-store'},
        'body': json.dumps(dados, ensure_ascii=False),
    }
    if cookies:
        r['cookies'] = cookies
    return r


def biscoito_de_sessao(token, expira):
    """O token vai num cookie HttpOnly: JavaScript não lê, então um XSS não
    carrega a sessão embora. SameSite=Lax cobre CSRF — e aqui dá para usar Lax,
    e não None, porque o CloudFront põe site e API na mesma origem."""
    partes = [
        '%s=%s' % (contas.COOKIE, token or ''), 'Path=/', 'HttpOnly',
        'SameSite=Lax', 'Secure',
        'Max-Age=%d' % (contas.SESSAO_DIAS * 86400 if token else 0),
    ]
    if expira is not None:
        partes.insert(-1, 'Expires=' + expira.strftime('%a, %d %b %Y %H:%M:%S GMT'))
    return ['; '.join(partes)]


def entregar_sessao(usuario, pedido, codigo=200):
    token, expira = contas.abrir_sessao(usuario['id'], pedido.agente)
    return responder(codigo, {'usuario': usuario}, biscoito_de_sessao(token, expira))


# --- Rotas ----------------------------------------------------------------
def rotas_de_conta(pedido):
    rota, metodo = pedido.rota, pedido.metodo

    if rota == '/api/auth/eu':
        if metodo == 'GET':
            return responder(200, {'usuario': contas.usuario_da_sessao(pedido.token())})
        if metodo == 'PUT':
            usuario = contas.usuario_da_sessao(pedido.token())
            if not usuario:
                return responder(401, {'erro': 'entre na sua conta para continuar'})
            corpo = pedido.corpo(LIMITE_LOGIN)
            atualizado = contas.atualizar_conta(usuario['id'], corpo.get('nome'),
                                                corpo.get('handle'))
            return responder(200, {'usuario': atualizado})
        return None

    if metodo != 'POST':
        return None

    if rota == '/api/auth/registrar':
        corpo = pedido.corpo(LIMITE_LOGIN)
        usuario = contas.criar_conta(corpo.get('email'), corpo.get('senha'),
                                     corpo.get('nome'), corpo.get('handle'))
        return entregar_sessao(usuario, pedido, 201)

    if rota == '/api/auth/entrar':
        corpo = pedido.corpo(LIMITE_LOGIN)
        usuario = contas.autenticar(corpo.get('email'), corpo.get('senha'),
                                    pedido.origem)
        return entregar_sessao(usuario, pedido)

    if rota == '/api/auth/sair':
        contas.fechar_sessao(pedido.token())
        return responder(200, {'usuario': None}, biscoito_de_sessao('', None))

    if rota == '/api/auth/senha':
        usuario = contas.usuario_da_sessao(pedido.token())
        if not usuario:
            return responder(401, {'erro': 'entre na sua conta para continuar'})
        corpo = pedido.corpo(LIMITE_LOGIN)
        contas.trocar_senha(usuario['id'], corpo.get('atual'), corpo.get('nova'))
        # A sessão de quem trocou a senha é a única que continua: ele acabou de
        # provar que é ele. As outras morreram com o `versao_senha` novo.
        return entregar_sessao(usuario, pedido)

    return None


def rotas_de_estado(pedido):
    usuario = contas.usuario_da_sessao(pedido.token())
    if not usuario:
        return responder(401, {'erro': 'entre na sua conta para continuar'})

    if pedido.metodo == 'GET':
        guardado = save.ler(usuario['id'])
        if not guardado:
            return responder(200, {'estado': None, 'atualizadoEm': None})
        return responder(200, guardado)

    if pedido.metodo == 'PUT':
        corpo = pedido.corpo(LIMITE_ESTADO)
        conteudo = corpo.get('estado')
        if not isinstance(conteudo, dict):
            return responder(400, {'erro': 'estado inválido'})
        return responder(200, save.gravar(usuario['id'], conteudo))

    return None


def rotas_de_pessoas(pedido):
    usuario = contas.usuario_da_sessao(pedido.token())
    if not usuario:
        return responder(401, {'erro': 'entre na sua conta para continuar'})
    eu, rota, metodo = usuario['id'], pedido.rota, pedido.metodo

    if rota == '/api/usuarios' and metodo == 'GET':
        return responder(200, {'usuarios': pessoas.buscar(eu, pedido.consulta.get('q'))})

    m = ROTA_USUARIO.match(rota)
    if m and metodo == 'GET':
        return responder(200, {'usuario': pessoas.perfil_de(eu, m.group(1))})

    if rota == '/api/social' and metodo == 'GET':
        return responder(200, pessoas.social(eu))

    if rota == '/api/seguir' and metodo == 'POST':
        corpo = pedido.corpo(LIMITE_LOGIN)
        return responder(200, {'usuario': pessoas.seguir(eu, corpo.get('id'),
                                                         bool(corpo.get('segue')))})

    if rota == '/api/perfil' and metodo == 'PUT':
        return responder(200, {'perfil': pessoas.atualizar_perfil(
            eu, pedido.corpo(LIMITE_LOGIN))})
    return None


def rotas_de_acervo(pedido):
    usuario = contas.usuario_da_sessao(pedido.token())
    if not usuario:
        return responder(401, {'erro': 'entre na sua conta para continuar'})
    if usuario['papel'] != 'admin':
        return responder(403, {'erro': 'só o administrador mexe no acervo'})

    import acervo                   # Pillow é pesado: só carrega quando é preciso

    if pedido.rota == '/api/pecas' and pedido.metodo == 'POST':
        return responder(201, {'item': acervo.nova_peca(pedido.corpo(LIMITE_PECA))})

    m = ROTA_PECA.match(pedido.rota)
    if m and pedido.metodo == 'PUT':
        return responder(200, {'item': acervo.editar_peca(m.group(1),
                                                          pedido.corpo(LIMITE_PECA))})
    return None


def rotas_de_estoque(pedido):
    usuario = contas.usuario_da_sessao(pedido.token())
    if not usuario:
        return responder(401, {'erro': 'entre na sua conta para continuar'})
    rota, metodo = pedido.rota, pedido.metodo

    if rota == '/api/estoque' and metodo == 'GET':
        return responder(200, {'limites': estoque.LIMITES, 'mapa': estoque.mapa()})
    if rota == '/api/estoque/levar' and metodo == 'POST':
        feito = estoque.levar(pedido.corpo(LIMITE_LOGIN).get('pecas'))
        return responder(409 if feito['esgotadas'] and not feito['levadas'] else 200, feito)
    if rota == '/api/estoque/devolver' and metodo == 'POST':
        # Devolver solta cópia para todo mundo: só a ferramenta do admin faz isso.
        if usuario['papel'] != 'admin':
            return responder(403, {'erro': 'só o administrador devolve peças'})
        return responder(200, estoque.devolver(pedido.corpo(LIMITE_LOGIN).get('pecas')))
    return None


def despachar(pedido):
    rota = pedido.rota

    if rota.startswith('/api/auth/'):
        return rotas_de_conta(pedido)
    if rota == '/api/estado':
        return rotas_de_estado(pedido)
    if rota in ROTAS_DE_PESSOAS or ROTA_USUARIO.match(rota):
        return rotas_de_pessoas(pedido)
    if rota.startswith('/api/estoque'):
        return rotas_de_estoque(pedido)
    if rota == '/api/pecas' or ROTA_PECA.match(rota):
        return rotas_de_acervo(pedido)

    # O recorte automático de fundo ainda não subiu: o modelo tem centenas de
    # MB e pede uma Lambda de container só para ele. 503 é de propósito — é o
    # que o `adicionar.js` já trata como "siga sem recorte", em vez de travar a
    # tela. Enquanto isso o recorte continua saindo do `tools/bgbatch.py` na
    # máquina do admin, que é onde ele sempre rodou.
    if rota == '/api/fundo':
        return responder(503, {'erro': 'o recorte automático não está ligado na '
                                       'nuvem: suba a foto já recortada, ou use '
                                       'tools/bgbatch.py na sua máquina'})
    return None


def handler(evento, _contexto):
    # O CloudFront injeta o segredo em toda requisição de origem. Sem ele, o
    # pedido veio direto na Function URL — e aí não veio do nosso site.
    if SEGREDO:
        veio = (evento.get('headers') or {}).get(CABECALHO_SEGREDO, '')
        if not secrets.compare_digest(veio, SEGREDO):
            return responder(403, {'erro': 'rota desconhecida'})

    pedido = Pedido(evento)
    try:
        resposta = despachar(pedido)
    except contas.ErroDeConta as e:
        return responder(e.codigo, {'erro': e.mensagem})
    except Limite as e:
        return responder(413, {'erro': str(e)})
    except (ValueError, TypeError) as e:
        return responder(400, {'erro': str(e)})
    except Exception as e:                       # noqa: BLE001
        print('falha em %s %s: %r' % (pedido.metodo, pedido.rota, e))
        return responder(500, {'erro': 'falha no servidor'})

    return resposta or responder(404, {'erro': 'rota desconhecida'})
