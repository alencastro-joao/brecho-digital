# -*- coding: utf-8 -*-
"""
Servidor local do protótipo.

É o `python -m http.server` com duas diferenças que importam em desenvolvimento:

1. manda `Cache-Control: no-store`. Sem isso o navegador guarda os módulos JS e
   você fica editando um arquivo e vendo a versão antiga na tela.
2. atende a ferramenta de administração (POST /api/pecas, PUT /api/pecas/<id>):
   a peça subida pelo "+ Adicionar peça" é gravada no disco — imagem em assets/cloths/ e ficha em
   assets/acervo.json — e passa a fazer parte do jogo para todo mundo. Nada de
   localStorage: quem sobe peça é o administrador, e o que ele sobe é permanente.
3. tira o fundo da foto (POST /api/fundo, via tools/bgbatch.py): o
   "+ Adicionar peça" deixou de exigir PNG já recortado. Sobe a foto de
   estúdio, o servidor devolve a peça recortada e guarda o recorte em alta —
   o máster — em assets/mestres/<id>.png. Sem modelo baixado a rota responde
   503 e a tela segue como antes, pedindo PNG transparente.

O acervo do administrador mora num arquivo separado do catalog.json justamente
para sobreviver a um `python tools/pipeline.py`, que regenera o catálogo inteiro
a partir dos PNGs de ../Cloths.

Uso:  python tools/servidor.py [porta]

A porta sai do argumento, da variável PORT do ambiente ou de 5173, nessa
ordem. O PORT existe para quem sobe o servidor por fora (o preview do
editor, por exemplo) e precisa escolher uma porta livre sem editar nada.
"""

import base64
import http.server
import io
import json
import os
import re
import secrets
import socketserver
import sys
import threading
import time
from datetime import datetime, timezone
from http import cookies as _cookies
from urllib.parse import parse_qs

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import contas          # noqa: E402  (precisa da linha de cima)
import pessoas         # noqa: E402
import estoque         # noqa: E402

PASTA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ACERVO = os.path.join(PASTA, 'assets', 'acervo.json')
CLOTHS = os.path.join(PASTA, 'assets', 'cloths')
MESTRES = os.path.join(PASTA, 'assets', 'mestres')
RASCUNHOS = os.path.join(MESTRES, 'rascunhos')
PORTA = int(sys.argv[1] if len(sys.argv) > 1 else os.environ.get('PORT') or 5173)

LIMITE_LOGIN = 8 * 1024            # cadastro e login são texto curto
LIMITE = 12 * 1024 * 1024          # corpo máximo aceito no POST
LIMITE_FOTO = 48 * 1024 * 1024     # foto crua do /api/fundo: vem grande
CATS = {'tops', 'pants', 'shoes', 'dresses', 'coats',
        'hats', 'bags', 'watches', 'rings', 'acc'}
RARIDADES = {'common', 'uncommon', 'rare', 'epic', 'legendary'}
ID_OK = re.compile(r'^[a-z0-9_-]{1,40}$')
TOKEN_OK = re.compile(r'^[a-f0-9]{16}$')
ROTA_USUARIO = re.compile(r'^/api/usuarios/([^/]+)$')
ROTAS_DE_PESSOAS = ('/api/usuarios', '/api/seguir', '/api/social', '/api/perfil')

# Recorte automático de fundo (tools/bgbatch.py). O modelo é grande e a
# inferência é pesada: uma sessão só, e uma peça de cada vez.
BG_MODELO = os.environ.get('BGBATCH_MODELO') or 'birefnet-general'
BG_MAX_MESTRE = int(os.environ.get('BGBATCH_MAX') or 2048)
RASCUNHO_VALIDADE = 6 * 3600       # rascunho não reclamado morre depois disso
_trava_recorte = threading.Lock()


# --- Acervo do administrador ----------------------------------------------
def ler_acervo():
    try:
        with open(ACERVO, encoding='utf-8') as fh:
            dados = json.load(fh)
        if isinstance(dados.get('items'), list):
            return dados
    except (OSError, ValueError):
        pass
    return {'generatedAt': None, 'count': 0, 'items': []}


def gravar_acervo(dados):
    dados['generatedAt'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    dados['count'] = len(dados['items'])
    os.makedirs(os.path.dirname(ACERVO), exist_ok=True)
    tmp = ACERVO + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(dados, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, ACERVO)


# O contorno vetorial é o mesmo do pipeline. Sem Pillow a peça entra sem ele: o
# hit-test por canal alpha (alpha.js) cobre o caso.
def contorno(caminho):
    try:
        from PIL import Image
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from pipeline import contour_of
        with Image.open(caminho) as img:
            path, _ = contour_of(img.convert('RGBA'))
        return path
    except Exception as e:                       # noqa: BLE001 - contorno é opcional
        print('  (sem contorno: %s)' % e)
        return ''


def salvar_imagem(item_id, data_url):
    cabeca, _, corpo = data_url.partition(',')
    if not corpo or not cabeca.startswith('data:image/'):
        raise ValueError('imagem inválida')
    ext = 'webp' if 'webp' in cabeca else 'png'
    binario = base64.b64decode(corpo)
    os.makedirs(CLOTHS, exist_ok=True)
    nome = item_id + '.' + ext
    with open(os.path.join(CLOTHS, nome), 'wb') as fh:
        fh.write(binario)
    return 'assets/cloths/' + nome, len(binario)


# ---------------------- Recorte automático de fundo ------------------------
# A foto crua sobe inteira e volta para a tela como uma prévia leve. O recorte
# em alta — o máster — fica no disco na mesma hora, como rascunho: quando a
# peça for salva, o rascunho vira assets/mestres/<id>.png. Dois motivos para
# não devolver o máster pelo fio: ele tem alguns MB, e o que o modelo levou
# meio minuto para calcular não deve depender de o administrador terminar a
# ficha (ou não fechar a aba).
def _bgbatch():
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import bgbatch
    return bgbatch


def limpar_rascunhos():
    """Rascunho que ninguém reclamou é lixo em disco. Some sozinho."""
    try:
        agora = time.time()
        for nome in os.listdir(RASCUNHOS):
            caminho = os.path.join(RASCUNHOS, nome)
            if agora - os.path.getmtime(caminho) > RASCUNHO_VALIDADE:
                os.remove(caminho)
    except OSError:
        pass


def _abrir_data_url(data_url):
    cabeca, _, corpo = (data_url or '').partition(',')
    if not corpo or not cabeca.startswith('data:image/'):
        raise ValueError('imagem inválida')
    from PIL import Image
    img = Image.open(io.BytesIO(base64.b64decode(corpo)))
    img.load()
    return img


def recortar_foto(corpo):
    """POST /api/fundo — tira o fundo da foto e devolve prévia + rascunho."""
    from PIL import Image
    previa_max = max(64, min(2048, int(corpo.get('max') or 1024)))
    img = _abrir_data_url(corpo.get('src', ''))
    entrada = img.size

    marca = time.time()
    with _trava_recorte:          # o modelo come a CPU inteira: um por vez
        # baixar=False de propósito: tem gente esperando do outro lado, e o
        # download do modelo é coisa de `bgbatch.py --baixar`, não de pedido.
        recorte = _bgbatch().recortar(img, modelo=BG_MODELO,
                                      maior_lado=BG_MAX_MESTRE, quieto=True,
                                      baixar=False)
    segundos = time.time() - marca

    token = secrets.token_hex(8)
    os.makedirs(RASCUNHOS, exist_ok=True)
    limpar_rascunhos()
    recorte.save(os.path.join(RASCUNHOS, token + '.png'), 'PNG', optimize=True)

    previa = recorte.copy()
    previa.thumbnail((previa_max, previa_max), Image.LANCZOS)
    buffer = io.BytesIO()
    previa.save(buffer, 'PNG', optimize=True)

    print('fundo removido: %dx%d -> master %dx%d em %.1fs (%s)' % (
        entrada[0], entrada[1], recorte.size[0], recorte.size[1],
        segundos, BG_MODELO))
    return {
        'src': 'data:image/png;base64,'
               + base64.b64encode(buffer.getvalue()).decode('ascii'),
        'w': previa.size[0], 'h': previa.size[1],
        'mestre': token,
        'mw': recorte.size[0], 'mh': recorte.size[1],
        'segundos': round(segundos, 1),
        'modelo': BG_MODELO,
    }


def promover_mestre(token, item_id):
    """O rascunho do recorte passa a ser o máster da peça, com o nome dela."""
    token = str(token or '').strip().lower()
    if not TOKEN_OK.match(token):
        return ''
    origem = os.path.join(RASCUNHOS, token + '.png')
    if not os.path.exists(origem):
        return ''
    os.makedirs(MESTRES, exist_ok=True)
    os.replace(origem, os.path.join(MESTRES, item_id + '.png'))
    return 'assets/mestres/' + item_id + '.png'


def preaquecer():
    """Carrega o modelo em segundo plano quando ele já está no cache. Sem
    isso, a primeira peça do dia espera ~1 GB sair do disco."""
    if os.environ.get('BGBATCH_PREAQUECER') == '0':
        return

    def tarefa():
        try:
            bg = _bgbatch()
            arquivo = bg.MODELOS[BG_MODELO]['arquivo']
            if not os.path.exists(os.path.join(bg.pasta_modelos(), arquivo)):
                print('recorte de fundo: modelo %s ainda nao baixado '
                      '(python tools/bgbatch.py --baixar)' % BG_MODELO)
                return
            bg.sessao(BG_MODELO, quieto=True, baixar=False)
            print('recorte de fundo: %s pronto' % BG_MODELO)
        except Exception as e:                   # noqa: BLE001
            print('recorte de fundo indisponivel: %s' % e)

    threading.Thread(target=tarefa, daemon=True).start()


def nova_peca(corpo):
    cat = corpo.get('cat')
    if cat not in CATS:
        raise ValueError('categoria desconhecida')
    raridade = corpo.get('raridade', 'common')
    if raridade not in RARIDADES:
        raise ValueError('raridade desconhecida')

    item_id = str(corpo.get('id') or '').strip().lower()
    if not ID_OK.match(item_id):
        raise ValueError('id inválido')
    acervo = ler_acervo()
    if any(i['id'] == item_id for i in acervo['items']):
        raise ValueError('já existe peça com esse id')

    src, peso = salvar_imagem(item_id, corpo.get('src', ''))
    ancora = corpo.get('ancora') or {}
    # Veio do recorte automático: o rascunho em alta ganha o nome da peça.
    mestre = promover_mestre(corpo.get('mestre'), item_id)

    item = {
        'id': item_id,
        'cat': cat,
        'src': src,
        'w': int(corpo.get('w') or 1),
        'h': int(corpo.get('h') or 1),
        'path': contorno(os.path.join(PASTA, src)),
        'nome': str(corpo.get('nome') or '').strip()[:60],
        'marca': str(corpo.get('marca') or '').strip()[:40],
        'cor': str(corpo.get('cor') or '').strip()[:24],
        'raridade': raridade,
        'ancora': {k: round(float(ancora.get(k, 0)), 1) for k in ('x', 'y', 'w')},
        'criadoEm': datetime.now(timezone.utc).isoformat(timespec='seconds'),
    }
    if mestre:
        item['mestre'] = mestre
    acervo['items'].append(item)
    gravar_acervo(acervo)
    print('peça gravada: %s (%s) %.0f KB%s'
          % (item_id, cat, peso / 1024, ' + master' if mestre else ''))
    return item


# Editar uma peça que já existe. O id não muda — é ele que amarra a peça ao
# inventário de quem já a tem. A imagem só é regravada quando vem uma nova
# (`src` como data: URL); sem ela, a ficha é atualizada e o arquivo em
# assets/cloths/ fica como está.
def editar_peca(item_id, corpo):
    item_id = str(item_id or '').strip().lower()
    if not ID_OK.match(item_id):
        raise ValueError('id inválido')

    acervo = ler_acervo()
    item = next((i for i in acervo['items'] if i['id'] == item_id), None)
    if item is None:
        raise ValueError('essa peça não está no acervo do administrador '
                         '(só dá para editar o que foi subido por aqui)')

    if 'cat' in corpo:
        if corpo['cat'] not in CATS:
            raise ValueError('categoria desconhecida')
        item['cat'] = corpo['cat']
    if 'raridade' in corpo:
        if corpo['raridade'] not in RARIDADES:
            raise ValueError('raridade desconhecida')
        item['raridade'] = corpo['raridade']

    for campo, limite in (('nome', 60), ('marca', 40), ('cor', 24)):
        if campo in corpo:
            item[campo] = str(corpo.get(campo) or '').strip()[:limite]

    if corpo.get('ancora'):
        ancora = corpo['ancora']
        item['ancora'] = {k: round(float(ancora.get(k, 0)), 1) for k in ('x', 'y', 'w')}

    src = corpo.get('src') or ''
    if src.startswith('data:image/'):
        antigo = item.get('src', '')
        novo, peso = salvar_imagem(item_id, src)
        item['src'] = novo
        item['w'] = int(corpo.get('w') or item.get('w') or 1)
        item['h'] = int(corpo.get('h') or item.get('h') or 1)
        item['path'] = contorno(os.path.join(PASTA, novo))
        mestre = promover_mestre(corpo.get('mestre'), item_id)
        if mestre:
            item['mestre'] = mestre
        # Troca de formato (png ↔ webp) deixa o arquivo antigo órfão.
        if antigo and antigo != novo:
            try:
                os.remove(os.path.join(PASTA, antigo))
            except OSError:
                pass
        print('imagem trocada: %s %.0f KB' % (item_id, peso / 1024))

    item['editadoEm'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    gravar_acervo(acervo)
    print('peça editada: %s (%s)' % (item_id, item['cat']))
    return item


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

    def exigir_admin(self):
        usuario = self.exigir_sessao()
        if usuario and usuario['papel'] != 'admin':
            self.responder(403, {'erro': 'so o administrador mexe no acervo'})
            return None
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

    def do_GET(self):
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
        rota = self.path.rstrip('/')
        if rota.startswith('/api/auth/') and self.rota_de_conta(rota):
            return None
        if self.rota_de_pessoas('POST'):
            return None
        if self.rota_de_estoque('POST'):
            return None
        if rota == '/api/fundo':
            if not self.exigir_admin():
                return None
            return self.recorte_de_fundo()
        if rota != '/api/pecas':
            return self.responder(404, {'erro': 'rota desconhecida'})
        if not self.exigir_admin():
            return None
        try:
            corpo = self.ler_corpo(LIMITE)
            if corpo is None:
                return
            item = nova_peca(corpo)
        except ValueError as e:
            return self.responder(400, {'erro': str(e)})
        except Exception as e:                   # noqa: BLE001
            return self.responder(500, {'erro': str(e)})
        return self.responder(201, {'item': item})

    # O recorte é a parte lenta da tela de adicionar: dezenas de segundos por
    # foto no modelo grande. Falta de modelo, de onnxruntime ou de disco não é
    # erro do pedido — é 503, e o adicionar.js trata como "siga sem recorte".
    def recorte_de_fundo(self):
        try:
            corpo = self.ler_corpo(LIMITE_FOTO)
            if corpo is None:
                return
            return self.responder(200, recortar_foto(corpo))
        except ValueError as e:
            return self.responder(400, {'erro': str(e)})
        except Exception as e:                   # noqa: BLE001
            print('falha no recorte de fundo: %s' % e)
            return self.responder(503, {'erro': str(e)})

    def do_PUT(self):
        if self.path.rstrip('/') == '/api/auth/eu':
            return self.editar_conta()
        if self.rota_de_pessoas('PUT'):
            return None
        m = re.match(r'^/api/pecas/([^/]+)/?$', self.path)
        if not m:
            return self.responder(404, {'erro': 'rota desconhecida'})
        if not self.exigir_admin():
            return None
        try:
            corpo = self.ler_corpo(LIMITE)
            if corpo is None:
                return
            item = editar_peca(m.group(1), corpo)
        except ValueError as e:
            return self.responder(400, {'erro': str(e)})
        except Exception as e:                   # noqa: BLE001
            return self.responder(500, {'erro': str(e)})
        return self.responder(200, {'item': item})


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
    contas.preparar()
    pessoas.preparar()
    with Servidor(('', PORTA), Handler) as servidor:
        print('Brecho Digital: http://localhost:%d' % PORTA)
        print('contas: %s (a primeira que se cadastrar e a do administrador)'
              % contas.BANCO)
        preaquecer()
        print('(Ctrl+C para desligar)')
        try:
            servidor.serve_forever()
        except KeyboardInterrupt:
            print('\nservidor desligado')
