# -*- coding: utf-8 -*-
"""
Servidor local do protótipo.

É o `python -m http.server` com o que importa em desenvolvimento:

1. manda `Cache-Control: no-store`. Sem isso o navegador guarda os módulos JS e
   você fica editando um arquivo e vendo a versão antiga na tela.
2. atende contas, pessoas e estoque com o mesmo formato da Lambda, num SQLite
   local (dados/usuarios.sqlite) — para mexer no jogo sem tocar em ninguém de
   verdade.

**O acervo não é escrito aqui.** Peça nova entra só pela esteira, na nuvem
(esteira.html → S3 → fila → nuvem/esteira/trabalhador.py), e quem grava o
`acervo.json` é a Lambda. Um escritor só: antes havia dois (este arquivo e a
Lambda), com a mesma lógica copiada, e o `publicar.sh` subia o acervo do disco
por cima do da nuvem. Para trazer as peças novas para o disco:

    python tools/sincronizar.py

Modo nuvem — a página é servida daqui (você edita o JS e vê na hora) e toda a
`/api/*` vai para a API de produção, com a sua conta de verdade. É o modo de
usar a esteira, ou de testar o front contra os dados reais:

    python tools/servidor.py --nuvem

Uso:  python tools/servidor.py [porta] [--nuvem]

A porta sai do argumento, da variável PORT do ambiente ou de 5173, nessa
ordem. O PORT existe para quem sobe o servidor por fora (o preview do
editor, por exemplo) e precisa escolher uma porta livre sem editar nada.
"""

import http.server
import json
import os
import re
import socketserver
import sys
import urllib.error
import urllib.request
from datetime import datetime
from http import cookies as _cookies
from urllib.parse import parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contas          # noqa: E402  (precisa da linha de cima)
import pessoas         # noqa: E402
import estoque         # noqa: E402

PASTA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
PORTA = int(_ARGS[0] if _ARGS else os.environ.get('PORT') or 5173)
NUVEM = (os.environ.get('BRECHO_NUVEM') or 'https://dufkck3bmeh9v.cloudfront.net').rstrip('/')
MODO_NUVEM = '--nuvem' in sys.argv[1:]

LIMITE_LOGIN = 8 * 1024            # cadastro e login são texto curto
ROTA_USUARIO = re.compile(r'^/api/usuarios/([^/]+)$')
ROTAS_DE_PESSOAS = ('/api/usuarios', '/api/seguir', '/api/social', '/api/perfil')


# --- Modo nuvem -------------------------------------------------------------
# Repassa o pedido para a API de produção e devolve a resposta como veio. O
# cookie de sessão volta sem `Secure` (a página aqui é http) e preso a
# localhost: é uma sessão de verdade, mas só deste navegador nesta porta.
def repassar(handler, metodo):
    corpo = None
    tamanho = int(handler.headers.get('Content-Length') or 0)
    if tamanho:
        corpo = handler.rfile.read(tamanho)
    cabecalhos = {k: v for k, v in handler.headers.items()
                  if k.lower() in ('cookie', 'content-type', 'user-agent', 'accept')}
    pedido = urllib.request.Request(NUVEM + handler.path, data=corpo,
                                    method=metodo, headers=cabecalhos)
    try:
        resposta = urllib.request.urlopen(pedido, timeout=60)
    except urllib.error.HTTPError as e:
        resposta = e
    except urllib.error.URLError as e:
        return handler.responder(502, {'erro': 'nuvem fora do alcance: %s' % e.reason})

    dados = resposta.read()
    handler.send_response(resposta.status)
    for chave, valor in resposta.headers.items():
        baixa = chave.lower()
        if baixa == 'set-cookie':
            valor = '; '.join(p for p in valor.split('; ')
                              if p.strip().lower() != 'secure'
                              and not p.strip().lower().startswith('domain='))
            handler.send_header(chave, valor)
        elif baixa == 'content-type':
            handler.send_header(chave, valor)
    handler.send_header('Content-Length', str(len(dados)))
    handler.end_headers()
    handler.wfile.write(dados)
    return None


SO_NA_NUVEM = re.compile(r'^/api/(pecas|esteira|fundo)(/|$)')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PASTA, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def responder(self, codigo, dados, cabecalhos=()):
        corpo = json.dumps(dados, ensure_ascii=False).encode('utf-8')
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(corpo)))
        for chave, valor in cabecalhos:
            self.send_header(chave, valor)
        self.end_headers()
        self.wfile.write(corpo)

    # --- Sessao ------------------------------------------------------------
    # O token vai num cookie HttpOnly: JavaScript não lê, então um XSS não
    # carrega a sessão embora. SameSite=Lax cobre CSRF nas rotas que importam
    # (POST vindo de outro site não leva o cookie). Secure entra sozinho quando
    # a página está em HTTPS — em localhost ele impediria o login.
    def token_da_sessao(self):
        bruto = self.headers.get('Cookie')
        if not bruto:
            return None
        try:
            return _cookies.SimpleCookie(bruto)[contas.COOKIE].value
        except (KeyError, _cookies.CookieError):
            return None

    def usuario_da_sessao(self):
        return contas.usuario_da_sessao(self.token_da_sessao())

    def _cookie(self, token, expira):
        partes = [
            '%s=%s' % (contas.COOKIE, token), 'Path=/', 'HttpOnly', 'SameSite=Lax',
            'Expires=' + expira.strftime('%a, %d %b %Y %H:%M:%S GMT'),
            'Max-Age=%d' % (contas.SESSAO_DIAS * 86400 if token else 0),
        ]
        if self.headers.get('X-Forwarded-Proto') == 'https':
            partes.append('Secure')
        return [('Set-Cookie', '; '.join(partes))]

    def entregar_sessao(self, usuario, codigo=200):
        token, expira = contas.abrir_sessao(usuario['id'], self.headers.get('User-Agent'))
        return self.responder(codigo, {'usuario': usuario}, self._cookie(token, expira))

    def exigir_sessao(self):
        """Usuario da sessao, ou None — e nesse caso a resposta 401 ja foi
        enviada, entao quem chama so precisa voltar."""
        usuario = self.usuario_da_sessao()
        if not usuario:
            self.responder(401, {'erro': 'entre na sua conta para continuar'})
        return usuario

    # --- Rotas de conta ----------------------------------------------------
    def rota_de_conta(self, rota):
        """Devolve True quando a rota era de conta (e ja foi respondida)."""
        try:
            if rota == '/api/auth/registrar':
                corpo = self.ler_corpo(LIMITE_LOGIN)
                if corpo is None:
                    return True
                usuario = contas.criar_conta(corpo.get('email'), corpo.get('senha'),
                                             corpo.get('nome'), corpo.get('handle'))
                print('conta criada: %s (%s)' % (usuario['handle'], usuario['papel']))
                self.entregar_sessao(usuario, 201)
                return True

            if rota == '/api/auth/entrar':
                corpo = self.ler_corpo(LIMITE_LOGIN)
                if corpo is None:
                    return True
                usuario = contas.autenticar(corpo.get('email'), corpo.get('senha'),
                                            origem=self.client_address[0])
                self.entregar_sessao(usuario)
                return True

            if rota == '/api/auth/sair':
                contas.fechar_sessao(self.token_da_sessao())
                self.responder(200, {'ok': True}, self._cookie('', datetime(1970, 1, 1)))
                return True

            if rota == '/api/auth/senha':
                usuario = self.exigir_sessao()
                if not usuario:
                    return True
                corpo = self.ler_corpo(LIMITE_LOGIN)
                if corpo is None:
                    return True
                contas.trocar_senha(usuario['id'], corpo.get('atual'), corpo.get('nova'))
                # A troca derrubou todas as sessoes, inclusive esta: devolve uma
                # nova para quem trocou nao ser deslogado da propria aba.
                self.entregar_sessao(usuario)
                return True
        except contas.ErroDeConta as e:
            self.responder(e.codigo, {'erro': str(e)})
            return True
        except ValueError as e:
            self.responder(400, {'erro': str(e)})
            return True
        except Exception as e:                   # noqa: BLE001
            print('falha na rota de conta %s: %s' % (rota, e))
            self.responder(500, {'erro': 'falha no servidor'})
            return True
        return False

    # --- Rotas de pessoas --------------------------------------------------
    # Achar gente, ver a página dela e seguir. Mesmas rotas e mesmo formato da
    # Lambda (nuvem/lambda/app.py); a lógica mora em tools/pessoas.py.
    def rota_de_pessoas(self, metodo):
        """Devolve True quando a rota era de pessoas (e ja foi respondida)."""
        caminho, _, consulta = self.path.partition('?')
        rota = caminho.rstrip('/')
        m = ROTA_USUARIO.match(rota)
        if rota not in ROTAS_DE_PESSOAS and not m:
            return False

        usuario = self.exigir_sessao()
        if not usuario:
            return True
        eu = usuario['id']

        try:
            if rota == '/api/usuarios' and metodo == 'GET':
                q = parse_qs(consulta).get('q', [''])[0]
                self.responder(200, {'usuarios': pessoas.buscar(eu, q)})
            elif m and metodo == 'GET':
                self.responder(200, {'usuario': pessoas.perfil_de(eu, m.group(1))})
            elif rota == '/api/social' and metodo == 'GET':
                self.responder(200, pessoas.social(eu))
            elif rota == '/api/seguir' and metodo == 'POST':
                corpo = self.ler_corpo(LIMITE_LOGIN)
                if corpo is not None:
                    self.responder(200, {'usuario': pessoas.seguir(
                        eu, corpo.get('id'), bool(corpo.get('segue')))})
            elif rota == '/api/perfil' and metodo == 'PUT':
                corpo = self.ler_corpo(LIMITE_LOGIN)
                if corpo is not None:
                    self.responder(200, {'perfil': pessoas.atualizar_perfil(eu, corpo)})
            else:
                self.responder(404, {'erro': 'rota desconhecida'})
        except contas.ErroDeConta as e:
            self.responder(e.codigo, {'erro': str(e)})
        except ValueError as e:
            self.responder(400, {'erro': str(e)})
        return True

    # Tiragem limitada (ver estoque.py): mesmas rotas e respostas da Lambda.
    def rota_de_estoque(self, metodo):
        rota = self.path.rstrip('/')
        if not rota.startswith('/api/estoque'):
            return False
        usuario = self.exigir_sessao()
        if not usuario:
            return True
        try:
            if rota == '/api/estoque' and metodo == 'GET':
                self.responder(200, {'limites': estoque.LIMITES, 'mapa': estoque.mapa()})
            elif rota == '/api/estoque/levar' and metodo == 'POST':
                corpo = self.ler_corpo(LIMITE_LOGIN)
                if corpo is None:
                    return True
                feito = estoque.levar(corpo.get('pecas'))
                self.responder(409 if feito['esgotadas'] and not feito['levadas'] else 200, feito)
            elif rota == '/api/estoque/devolver' and metodo == 'POST':
                if usuario['papel'] != 'admin':
                    self.responder(403, {'erro': 'so o administrador devolve pecas'})
                    return True
                corpo = self.ler_corpo(LIMITE_LOGIN)
                if corpo is None:
                    return True
                self.responder(200, estoque.devolver(corpo.get('pecas')))
            else:
                self.responder(404, {'erro': 'rota desconhecida'})
        except ValueError as e:
            self.responder(400, {'erro': str(e)})
        return True

    # --- Despacho ----------------------------------------------------------
    # No modo nuvem toda /api/* vai para produção. No local, o que é só da
    # nuvem (acervo e esteira) responde 503 dizendo como chegar lá.
    def api_remota(self, metodo):
        if not self.path.startswith('/api/'):
            return False
        if MODO_NUVEM:
            repassar(self, metodo)
            return True
        if SO_NA_NUVEM.match(self.path):
            self.responder(503, {'erro': 'o acervo e a esteira moram na nuvem: rode '
                                         'python tools/servidor.py --nuvem'})
            return True
        return False

    def do_GET(self):
        if self.api_remota('GET'):
            return None
        if self.rota_de_estoque('GET'):
            return None
        if self.path.rstrip('/') == '/api/auth/eu':
            return self.responder(200, {'usuario': self.usuario_da_sessao()})
        if self.rota_de_pessoas('GET'):
            return None
        # O banco de contas mora dentro da pasta servida: nao e arquivo estatico.
        if re.match(r'^/dados(/|$)', self.path):
            return self.responder(404, {'erro': 'rota desconhecida'})
        return super().do_GET()

    def ler_corpo(self, limite):
        tamanho = int(self.headers.get('Content-Length') or 0)
        if tamanho <= 0 or tamanho > limite:
            self.responder(413, {'erro': 'corpo vazio ou grande demais'})
            return None
        return json.loads(self.rfile.read(tamanho).decode('utf-8'))

    def do_POST(self):
        if self.api_remota('POST'):
            return None
        rota = self.path.rstrip('/')
        if rota.startswith('/api/auth/') and self.rota_de_conta(rota):
            return None
        if self.rota_de_pessoas('POST'):
            return None
        if self.rota_de_estoque('POST'):
            return None
        return self.responder(404, {'erro': 'rota desconhecida'})

    def do_PUT(self):
        if self.api_remota('PUT'):
            return None
        if self.path.rstrip('/') == '/api/auth/eu':
            return self.editar_conta()
        if self.rota_de_pessoas('PUT'):
            return None
        return self.responder(404, {'erro': 'rota desconhecida'})

    def do_DELETE(self):
        if self.api_remota('DELETE'):
            return None
        return self.responder(404, {'erro': 'rota desconhecida'})

    # Nome e @ da conta. O perfil do jogo (bio, avatar, favoritos) continua no
    # estado do navegador; o que identifica a pessoa e que mora no banco.
    def editar_conta(self):
        usuario = self.exigir_sessao()
        if not usuario:
            return None
        try:
            corpo = self.ler_corpo(LIMITE_LOGIN)
            if corpo is None:
                return None
            atualizado = contas.atualizar_conta(usuario['id'], corpo.get('nome'),
                                                corpo.get('handle'))
        except contas.ErroDeConta as e:
            return self.responder(e.codigo, {'erro': str(e)})
        except ValueError as e:
            return self.responder(400, {'erro': str(e)})
        return self.responder(200, {'usuario': atualizado})


class Servidor(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    if not MODO_NUVEM:
        contas.preparar()
        pessoas.preparar()
    with Servidor(('', PORTA), Handler) as servidor:
        print('Brecho Digital: http://localhost:%d' % PORTA)
        if MODO_NUVEM:
            print('modo nuvem: /api/* vai para %s (contas e acervo de verdade)' % NUVEM)
            print('esteira de pecas: http://localhost:%d/esteira.html' % PORTA)
        else:
            print('contas: %s (a primeira que se cadastrar e a do administrador)'
                  % contas.BANCO)
        print('(Ctrl+C para desligar)')
        try:
            servidor.serve_forever()
        except KeyboardInterrupt:
            print('\nservidor desligado')
