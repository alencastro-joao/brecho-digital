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
    GET  /api/auth/google          o login com Google está configurado?
    GET  /api/auth/google/entrar   vai para o login do Google (logingoogle.py)
    GET  /api/auth/google/volta    volta do Google: entra ou cria a conta
    GET  /api/estado           o save do jogo na nuvem
    PUT  /api/estado           grava o save
    GET  /api/usuarios?q=      procura pessoas (ver pessoas.py)
    GET  /api/usuarios/<id>    a página pública de uma pessoa
    POST /api/seguir           segue ou deixa de seguir
    GET  /api/social           quem eu sigo e quem me segue
    PUT  /api/perfil           o que os outros leem de mim: bio, rosto, roupa, favoritos
    POST /api/perfil/miniatura a miniatura de um look ou colagem favoritos (ver feed.py)
    /api/feed[/<id>[/...]]     o feed compartilhado: publicar, curtir, comentar (ver feed.py)
    POST /api/feed/gerar       admin: os perfis de exemplo postam agora (ver gerador.py)
    POST /api/pecas            admin: peça nova no acervo
    PUT  /api/pecas/<id>       admin: edita a peça
    DELETE /api/pecas/<id>     admin: apaga a peça de vez
    PUT  /api/roupas-avatar    admin: cria/edita roupa do avatar (ver roupasavatar.py)
    DELETE /api/roupas-avatar/<id>  admin: tira a roupa das coleções
    GET  /api/estoque          quantas cópias de cada peça já saíram (ver estoque.py)
    POST /api/estoque/levar    reserva uma cópia (409 se esgotou)
    POST /api/estoque/devolver admin: a cópia volta para a loja
    POST /api/estoque/historico por quem cada cópia já passou
    POST /api/estoque/desfazer  devolve a cópia que você acabou de levar
    GET  /api/admin/painel     admin: os números do dia (ver painel.py)
    POST /api/fundo            503: o recorte agora é da esteira (ver esteira.py)
    /api/esteira[/<id>[/...]]  admin: a esteira de peças (ver esteira.py)
    GET  /api/admin/contas     admin: todas as contas e o que cada uma tem
    POST /api/admin/contas/limpar  admin: apaga as outras contas (ver limpeza.py)

**Por que a Function URL não é pública de verdade.** Ela nasce com
`AuthType NONE` — precisa ser, porque quem chama é o CloudFront, e a assinatura
SigV4 do OAC não cobre o corpo de um POST para Function URL. No lugar disso o
CloudFront injeta um cabeçalho secreto em toda requisição de origem, e esta
função recusa qualquer pedido que chegue sem ele. Quem descobrir a URL
`...lambda-url...on.aws` não consegue fazer nada com ela.

**De onde vem o IP.** Atrás do CloudFront, `sourceIp` é o IP do CloudFront, não
o de quem está do outro lado — usá-lo no rate limit juntaria o mundo inteiro
num balde só. O IP verdadeiro é o último item do `X-Forwarded-For` que não é o
próprio CloudFront: ele acrescenta o do visitante ao fim do que já estava lá, e
a Function URL pode pôr o do CloudFront depois. O que um atacante tenha
inventado fica antes, e nunca no lugar que a gente lê.
"""

import json
import os
import re
import secrets
from http import cookies as _cookies

import contas
import estado as save
import estoque
import feed
import logingoogle
import pessoas
import redes

SEGREDO = os.environ.get('BD_SEGREDO_ORIGEM') or ''
CABECALHO_SEGREDO = 'x-origem-brecho'

LIMITE_LOGIN = 8 * 1024             # cadastro e login são texto curto
LIMITE_PECA = 5 * 1024 * 1024       # a Function URL para em 6 MB: fique abaixo
LIMITE_ESTADO = 5 * 1024 * 1024
LIMITE_POST = 1536 * 1024           # a miniatura em base64 e um pouco de texto
LIMITE_PERFIL = 32 * 1024           # bio, rosto, roupa e os ids dos favoritos

ROTA_PECA = re.compile(r'^/api/pecas/([^/]+)$')
ROTA_ROUPA = re.compile(r'^/api/roupas-avatar(?:/([^/]+))?$')
ROTA_USUARIO = re.compile(r'^/api/usuarios/([^/]+)$')
ROTA_ESTEIRA = re.compile(r'^/api/esteira(?:/([^/]+)(?:/(publicar|refazer))?)?$')
ROTAS_DE_PESSOAS = ('/api/usuarios', '/api/seguir', '/api/social', '/api/perfil',
                    '/api/perfil/miniatura')
ROTA_REDE = re.compile(r'^/api/redes/(instagram|pinterest)/(entrar|volta|sair)$')
ROTA_AJUDA = re.compile(r'^/api/ajudas(?:/(avaliar|ajustar|preencher))?$')
ROTA_FEED = re.compile(r'^/api/feed(?:/([^/]+)(?:/(curtir|comentarios)(?:/([^/]+))?)?)?$')


class Pedido:
    """O event da Lambda com cara de requisição."""

    def __init__(self, evento):
        http = (evento.get('requestContext') or {}).get('http') or {}
        self.metodo = http.get('method', 'GET')
        self._conexao = http.get('sourceIp', '')
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
        # Quem abriu a conexão com a Function URL foi o CloudFront, e a Function
        # URL pode acrescentar o IP dele ao fim do X-Forwarded-For. Quando o
        # último item é esse IP (`sourceIp`), o visitante é o anterior: foi o
        # CloudFront que o escreveu ali.
        itens = [i.strip() for i in self.cabecalhos.get('x-forwarded-for', '').split(',') if i.strip()]
        if len(itens) > 1 and itens[-1] == self._conexao:
            itens.pop()
        if itens:
            return itens[-1]
        return self.cabecalhos.get('cloudfront-viewer-address', '').rsplit(':', 1)[0]

    def token(self):
        return self.biscoito(contas.COOKIE)

    def biscoito(self, nome):
        for bruto in self.cookies:
            try:
                biscoito = _cookies.SimpleCookie(bruto)
            except _cookies.CookieError:
                continue
            if nome in biscoito:
                return biscoito[nome].value
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


COMPRIMIR_DE = 1400         # bytes: abaixo disso o gzip não paga o cabeçalho


def comprimir(resposta, pedido):
    """gzip no JSON grande quando o navegador aceita. A página do feed (posts,
    camadas, comentários e cartões) passa fácil de 100 KB e encolhe uns 85%;
    as respostas da API não são guardadas pelo CloudFront, então quem
    comprime é a Lambda."""
    corpo = resposta.get('body')
    if (not isinstance(corpo, str) or len(corpo) < COMPRIMIR_DE or resposta.get('isBase64Encoded')
            or 'gzip' not in pedido.cabecalhos.get('accept-encoding', '')):
        return resposta
    import base64 as b64
    import gzip
    resposta['body'] = b64.b64encode(gzip.compress(corpo.encode('utf-8'), 6, mtime=0)).decode('ascii')
    resposta['isBase64Encoded'] = True
    resposta['headers'] = {**resposta.get('headers', {}), 'Content-Encoding': 'gzip',
                           'Vary': 'Accept-Encoding'}
    return resposta


def mandar_para(endereco, cookies=None):
    """302: a navegação segue para outro endereço (o login de uma rede, ou
    a volta para o app)."""
    r = {'statusCode': 302, 'headers': {'Location': endereco, 'Cache-Control': 'no-store'},
         'body': ''}
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


def biscoito_do_google(state):
    """O `state` do login com Google preso a este navegador (logingoogle.py).
    Só viaja para /api/auth/google, e some na volta."""
    return ['%s=%s; Path=/api/auth/google; HttpOnly; SameSite=Lax; Secure; Max-Age=%d'
            % (logingoogle.COOKIE, state or '', logingoogle.VALIDADE if state else 0)]


def rotas_do_google(pedido):
    """Entrar com Google. Tudo é navegação (302), e a volta para o app diz
    como foi em ?google=: ok, nova (a conta nasceu agora) ou o erro."""
    app = redes.SITE + '/?google='
    if pedido.metodo != 'GET':
        return None
    if pedido.rota == '/api/auth/google/entrar':
        destino, state = logingoogle.endereco_de_entrada()
        if not destino:
            return mandar_para(app + 'config')
        return mandar_para(destino, biscoito_do_google(state))
    q = pedido.consulta
    apagar = biscoito_do_google('')
    if q.get('error') or not q.get('code'):
        return mandar_para(app + 'recusou', apagar)
    try:
        sub, email, nome = logingoogle.concluir(q.get('code'), q.get('state'),
                                                pedido.biscoito(logingoogle.COOKIE))
        usuario, nova = contas.entrar_com_google(sub, email, nome, pedido.origem)
    except contas.ErroDeConta as e:
        print('google: conta recusada: %s' % e.mensagem)
        return mandar_para(app + ('limite' if e.codigo == 429 else 'falhou'), apagar)
    except (ValueError, KeyError) as e:
        print('google: volta falhou: %r' % e)
        return mandar_para(app + 'falhou', apagar)
    token, expira = contas.abrir_sessao(usuario['id'], pedido.agente)
    return mandar_para(app + ('nova' if nova else 'ok'),
                       apagar + biscoito_de_sessao(token, expira))


# --- Rotas ----------------------------------------------------------------
def rotas_de_conta(pedido):
    rota, metodo = pedido.rota, pedido.metodo

    if rota == '/api/auth/google' and metodo == 'GET':
        # A tela de entrada só mostra o botão com as chaves já guardadas.
        return responder(200, {'pronto': logingoogle._config() is not None})
    if rota in ('/api/auth/google/entrar', '/api/auth/google/volta'):
        return rotas_do_google(pedido)

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
                                     corpo.get('nome'), corpo.get('handle'),
                                     origem=pedido.origem)
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
        if pedido.consulta.get('so') == 'versao':
            return responder(200, save.versao(usuario['id']))
        guardado = save.ler(usuario['id'])
        if not guardado:
            return responder(200, {'estado': None, 'atualizadoEm': None, 'versao': None})
        return responder(200, guardado)

    if pedido.metodo == 'PUT':
        corpo = pedido.corpo(LIMITE_ESTADO)
        conteudo = corpo.get('estado')
        if not isinstance(conteudo, dict):
            return responder(400, {'erro': 'estado inválido'})
        # `versao` ausente é aba antiga, de antes da gravação condicional.
        base = corpo['versao'] if 'versao' in corpo else save.SEM_VERSAO
        if base is not None and base is not save.SEM_VERSAO and not isinstance(base, str):
            return responder(400, {'erro': 'versão inválida'})
        try:
            return responder(200, save.gravar(usuario['id'], conteudo, base))
        except save.Conflito:
            return responder(409, {'erro': 'o save mudou em outro aparelho',
                                   **save.versao(usuario['id'])})

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
            eu, pedido.corpo(LIMITE_PERFIL))})

    if rota == '/api/perfil/miniatura' and metodo == 'POST':
        return responder(200, feed.subir_miniatura(eu, pedido.corpo(LIMITE_POST)))
    return None


def rotas_de_feed(pedido):
    usuario = contas.usuario_da_sessao(pedido.token())
    if not usuario:
        return responder(401, {'erro': 'entre na sua conta para continuar'})
    eu, metodo = usuario['id'], pedido.metodo
    post_id, acao, comentario_id = ROTA_FEED.match(pedido.rota).groups()

    if post_id == 'gerar' and not acao and metodo == 'POST':
        if usuario['papel'] != 'admin':
            return responder(403, {'erro': 'só o administrador gera posts'})
        import gerador
        quantos = pedido.corpo(LIMITE_LOGIN).get('quantos') or 3
        return responder(200, {**gerador.rodar(quantos), **feed.listar(eu)})
    if not post_id:
        if metodo == 'GET':
            consulta = pedido.consulta
            # A leitura do feed é o relógio do gerador (ver gerador.em_dia):
            # se já passou a hora, os perfis de exemplo postam antes da lista.
            # Só na primeira página: rolar o mural não precisa conferir a hora.
            if not consulta.get('depois'):
                try:
                    import gerador
                    gerador.em_dia()
                except Exception as e:          # noqa: BLE001 — o feed abre mesmo assim
                    print('gerador falhou: %r' % (e,))
            return responder(200, feed.listar(eu, consulta.get('autor'),
                                              consulta.get('limite'), consulta.get('depois')))
        if metodo == 'POST':
            return responder(201, feed.publicar(eu, pedido.corpo(LIMITE_POST)))
        return None
    if not acao and metodo == 'DELETE':
        return responder(200, feed.apagar(eu, post_id))
    if acao == 'curtir' and metodo == 'POST':
        corpo = pedido.corpo(LIMITE_LOGIN)
        return responder(200, feed.curtir(eu, post_id, bool(corpo.get('curte'))))
    if acao == 'comentarios' and not comentario_id and metodo == 'POST':
        corpo = pedido.corpo(LIMITE_LOGIN)
        return responder(200, feed.comentar(eu, post_id, corpo.get('texto')))
    if acao == 'comentarios' and comentario_id and metodo == 'DELETE':
        return responder(200, feed.apagar_comentario(eu, post_id, comentario_id))
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
    if m and pedido.metodo == 'DELETE':
        return responder(200, acervo.apagar_peca(m.group(1)))
    return None


def rotas_de_roupas(pedido):
    usuario = contas.usuario_da_sessao(pedido.token())
    if not usuario:
        return responder(401, {'erro': 'entre na sua conta para continuar'})
    if usuario['papel'] != 'admin':
        return responder(403, {'erro': 'só o administrador mexe nas roupas do avatar'})

    import roupasavatar
    item_id = ROTA_ROUPA.match(pedido.rota).group(1)
    if not item_id and pedido.metodo == 'PUT':
        return responder(200, {'item': roupasavatar.gravar(pedido.corpo(LIMITE_PECA))})
    if item_id and pedido.metodo == 'DELETE':
        return responder(200, roupasavatar.apagar(item_id))
    return None


def rotas_de_esteira(pedido):
    usuario = contas.usuario_da_sessao(pedido.token())
    if not usuario:
        return responder(401, {'erro': 'entre na sua conta para continuar'})
    if not usuario.get('esteira'):
        return responder(403, {'erro': 'só quem tem a esteira mexe nela'})

    import esteira
    item_id, acao = ROTA_ESTEIRA.match(pedido.rota).groups()
    metodo = pedido.metodo

    if not item_id:
        if metodo == 'GET':
            return responder(200, esteira.listar())
        if metodo == 'POST':
            return responder(200, esteira.reservar(pedido.corpo(LIMITE_LOGIN * 8)))
        return None
    if item_id == 'pinterest' and not acao:
        if metodo == 'GET':
            return responder(200, esteira.pastas_pinterest())
        if metodo == 'POST':
            return responder(200, esteira.pinterest(pedido.corpo(LIMITE_LOGIN)))
        return None
    if item_id == 'ajustes' and not acao:
        if metodo == 'GET':
            return responder(200, esteira.ajustes())
        if metodo == 'PUT':
            return responder(200, esteira.mudar_ajustes(pedido.corpo(LIMITE_LOGIN)))
        return None
    if acao == 'publicar' and metodo == 'POST':
        return responder(201, esteira.publicar(item_id, pedido.corpo(LIMITE_LOGIN)))
    if acao == 'refazer' and metodo == 'POST':
        return responder(200, esteira.refazer(item_id))
    if not acao and metodo == 'PUT':
        feito = esteira.guardar(item_id, pedido.corpo(LIMITE_LOGIN))
        import ajudas
        try:   # a peça que está nos jogos leva a categoria nova junto
            ajudas.atualizar(item_id, feito['item'])
        except Exception as e:                   # noqa: BLE001 - a ficha já foi guardada
            print('jogos não acompanharam %s: %s' % (item_id, e))
        return responder(200, feito)
    if not acao and metodo == 'DELETE':
        return responder(200, esteira.descartar(item_id))
    return None


def rotas_de_estoque(pedido):
    usuario = contas.usuario_da_sessao(pedido.token())
    if not usuario:
        return responder(401, {'erro': 'entre na sua conta para continuar'})
    rota, metodo = pedido.rota, pedido.metodo

    if rota == '/api/estoque' and metodo == 'GET':
        return responder(200, {'limites': estoque.LIMITES, 'mapa': estoque.mapa()})
    if rota == '/api/estoque/levar' and metodo == 'POST':
        feito = estoque.levar(pedido.corpo(LIMITE_LOGIN).get('pecas'), usuario)
        return responder(409 if feito['esgotadas'] and not feito['levadas'] else 200, feito)
    if rota == '/api/estoque/devolver' and metodo == 'POST':
        # Devolver solta cópia para todo mundo: só a ferramenta do admin faz isso.
        if usuario['papel'] != 'admin':
            return responder(403, {'erro': 'só o administrador devolve peças'})
        return responder(200, estoque.devolver(pedido.corpo(LIMITE_LOGIN).get('pecas')))
    if rota == '/api/estoque/historico' and metodo == 'POST':
        return responder(200, estoque.historico(pedido.corpo(LIMITE_LOGIN).get('copias'), usuario))
    if rota == '/api/estoque/desfazer' and metodo == 'POST':
        return responder(200, estoque.desfazer(pedido.corpo(LIMITE_LOGIN).get('peca'), usuario))
    return None


def rotas_de_ajudas(pedido):
    usuario = contas.usuario_da_sessao(pedido.token())
    if not usuario:
        return responder(401, {'erro': 'entre na sua conta para continuar'})
    import ajudas
    if pedido.rota == '/api/admin/ajudas':
        if not usuario.get('esteira'):     # a esteira manda peças para os jogos
            return responder(403, {'erro': 'só quem tem a esteira vê o resumo das ajudas'})
        if pedido.metodo == 'GET':
            return responder(200, ajudas.resumo())
        if pedido.metodo == 'POST':
            import esteira
            corpo = pedido.corpo(LIMITE_LOGIN)
            item_id = esteira._id(corpo.get('id'))
            if corpo.get('nos'):
                return responder(200, ajudas.colocar(item_id, esteira._ler(item_id)))
            return responder(200, ajudas.tirar(item_id))
        return None
    jogo = ROTA_AJUDA.match(pedido.rota).group(1)
    if not jogo and pedido.metodo == 'GET':
        return responder(200, ajudas.estado(usuario))
    if jogo and pedido.metodo == 'POST':
        feito = ajudas.ajudar(usuario, jogo, pedido.corpo(LIMITE_LOGIN))
        return responder(200 if feito['ok'] else 409, feito)
    return None


def rotas_de_limpeza(pedido):
    usuario = contas.usuario_da_sessao(pedido.token())
    if not usuario:
        return responder(401, {'erro': 'entre na sua conta para continuar'})
    if usuario['papel'] != 'admin':
        return responder(403, {'erro': 'só o administrador mexe nas contas'})
    import limpeza
    if pedido.rota == '/api/admin/painel' and pedido.metodo == 'GET':
        return responder(200, limpeza.painel())
    if pedido.rota == '/api/admin/contas' and pedido.metodo == 'GET':
        return responder(200, limpeza.inventario(usuario))
    if pedido.rota == '/api/admin/contas/limpar' and pedido.metodo == 'POST':
        return responder(200, limpeza.limpar(usuario, pedido.corpo(LIMITE_PERFIL)))
    return None


def rotas_de_redes(pedido):
    """Instagram e Pinterest ligados de verdade (ver redes.py)."""
    rota, metodo = pedido.rota, pedido.metodo
    usuario = contas.usuario_da_sessao(pedido.token())
    if rota == '/api/admin/redes':
        if not usuario or usuario['papel'] != 'admin':
            return responder(403, {'erro': 'só o administrador configura as redes'})
        if metodo == 'GET':
            return responder(200, redes.ver_config())
        if metodo == 'PUT':
            c = pedido.corpo(LIMITE_LOGIN)
            return responder(200, redes.gravar_config(c.get('servico'), c.get('appId'), c.get('segredo')))
        return None
    if rota == '/api/redes' and metodo == 'GET':
        if not usuario:
            return responder(401, {'erro': 'entre na sua conta para continuar'})
        return responder(200, redes.minhas(usuario))

    m = ROTA_REDE.match(rota)
    servico, acao = m.group(1), m.group(2)
    app = redes.SITE + '/?rede=' + servico
    if acao == 'entrar' and metodo == 'GET':
        if not usuario:
            return mandar_para(app + '&erro=sessao#/perfil')
        destino = redes.endereco_de_entrada(usuario, servico)
        return mandar_para(destino or app + '&erro=config#/perfil')
    if acao == 'volta' and metodo == 'GET':
        q = pedido.consulta
        if q.get('error') or not q.get('code'):
            return mandar_para(app + '&erro=recusou#/perfil')
        if not usuario:
            return mandar_para(app + '&erro=sessao#/perfil')
        try:
            redes.concluir(servico, q.get('code'), q.get('state'), usuario['id'])
        except (ValueError, KeyError) as e:
            print('redes: volta de %s falhou: %r' % (servico, e))
            return mandar_para(app + '&erro=falhou#/perfil')
        return mandar_para(app + '&ok=1#/perfil')
    if acao == 'sair' and metodo == 'POST':
        if not usuario:
            return responder(401, {'erro': 'entre na sua conta para continuar'})
        return responder(200, redes.desligar(usuario, servico))
    return None


def despachar(pedido):
    rota = pedido.rota
    if rota == '/api/redes' or rota == '/api/admin/redes' or ROTA_REDE.match(rota):
        return rotas_de_redes(pedido)
    if rota.startswith('/api/admin/contas') or rota == '/api/admin/painel':
        return rotas_de_limpeza(pedido)

    if rota.startswith('/api/auth/'):
        return rotas_de_conta(pedido)
    if rota == '/api/estado':
        return rotas_de_estado(pedido)
    if rota in ROTAS_DE_PESSOAS or ROTA_USUARIO.match(rota):
        return rotas_de_pessoas(pedido)
    if rota.startswith('/api/estoque'):
        return rotas_de_estoque(pedido)
    if ROTA_AJUDA.match(rota) or rota == '/api/admin/ajudas':
        return rotas_de_ajudas(pedido)
    if ROTA_FEED.match(rota):
        return rotas_de_feed(pedido)
    if rota == '/api/pecas' or ROTA_PECA.match(rota):
        return rotas_de_acervo(pedido)
    if ROTA_ROUPA.match(rota):
        return rotas_de_roupas(pedido)
    if ROTA_ESTEIRA.match(rota):
        return rotas_de_esteira(pedido)

    # O recorte de fundo saiu do pedido-resposta: foto nova entra pela esteira
    # (fila + trabalhador). 503 é o que o modal de edição trata como "siga sem
    # recorte" quando se troca a imagem de uma peça por uma foto com fundo.
    if rota == '/api/fundo':
        return responder(503, {'erro': 'o recorte automático agora é feito na '
                                       'esteira: use "+ Adicionar peça"'})
    return None


def handler(evento, _contexto):
    # O EventBridge Scheduler (nuvem/infra/gerador.yaml) chama a função direto,
    # sem passar pela Function URL. Pedido HTTP nunca tem esta chave no topo do
    # evento — o corpo vem em `body` —, então ninguém de fora cai aqui.
    if 'requestContext' not in evento and evento.get('agendado') == 'gerar-posts':
        import gerador
        feito = gerador.rodar_agendado(evento.get('quantos'), evento.get('espalhar_horas') or 0)
        print('gerador: %r' % (feito,))
        return feito
    # Mesma porta: a leitura das pastas do Pinterest com o site fechado
    # (infra/esteira.yaml), e a rodada que ela mesma encadeia.
    if 'requestContext' not in evento and evento.get('agendado') == 'reler-pinterest':
        import esteira
        feito = esteira.rodar_agendado([str(f) for f in evento.get('feitas') or []][:200],
                                       int(evento.get('rodada') or 0))
        print('pinterest: %r' % (feito,))
        return feito

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

    return comprimir(resposta or responder(404, {'erro': 'rota desconhecida'}), pedido)
