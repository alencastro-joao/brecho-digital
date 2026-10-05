# -*- coding: utf-8 -*-
"""
O feed compartilhado — sobre SQLite.

É o espelho de `nuvem/lambda/feed.py` (DynamoDB + S3): mesmas funções, mesmos
erros, mesmo formato de resposta. O desenho e o porquê estão naquele arquivo;
aqui só muda *onde* mora:

    posts(id, autor, tipo, nome, criado_em, thumb, pecas, origem)
    curtidas(post, usuario)               uma linha por curtida
    comentarios(id, post, autor, texto, em)

e a miniatura vai para `assets/posts/`, dentro da pasta servida — como no
bucket do site. As regras puras (validar, montar o id) estão duplicadas de
propósito, como em pessoas.py: mexeu numa, mexa na outra.
"""

import base64
import hashlib
import json
import os
import re
from datetime import datetime, timedelta, timezone

from contas import ErroDeConta, agora, banco, iso
from pessoas import ID_OK, VALOR_OK, _cartao, _linha

PASTA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASTA_THUMBS = os.path.join(PASTA, 'assets', 'posts')

ID_POST = re.compile(r'^p-[0-9a-f]{16}$')
ID_COMENTARIO = re.compile(r'^c-[0-9a-f]{10}$')
CHAVE_OK = re.compile(r'^[\w:.\-]{1,64}$')
TIPOS = ('look', 'board')
NOME_MAX = 60
TEXTO_MAX = 140
PECAS_MAX = 40
COMENTARIOS_MAX = 300
LISTA_MAX = 120
THUMB_MAX = 900 * 1024
TIPOS_IMAGEM = {
    'image/webp': ('webp', lambda b: b[:4] == b'RIFF' and b[8:12] == b'WEBP'),
    'image/jpeg': ('jpg', lambda b: b[:3] == b'\xff\xd8\xff'),
    'image/png': ('png', lambda b: b[:8] == b'\x89PNG\r\n\x1a\n'),
}
DATA_URL = re.compile(r'^data:(image/[a-z]+);base64,([A-Za-z0-9+/=]+)$')


def preparar():
    """Cria as tabelas do feed. Idempotente: roda no boot do servidor."""
    with banco() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS posts (
              id        TEXT PRIMARY KEY,
              autor     TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
              tipo      TEXT NOT NULL,
              nome      TEXT NOT NULL,
              criado_em TEXT NOT NULL,
              thumb     TEXT NOT NULL,
              pecas     TEXT NOT NULL DEFAULT '[]',
              origem    TEXT NOT NULL DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_posts_criado ON posts(criado_em);
            CREATE TABLE IF NOT EXISTS curtidas (
              post    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
              usuario TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
              PRIMARY KEY (post, usuario)
            );
            CREATE TABLE IF NOT EXISTS comentarios (
              id    TEXT PRIMARY KEY,
              post  TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
              autor TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
              texto TEXT NOT NULL,
              em    TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_comentarios_post ON comentarios(post, em);
        """)


# --- Validação ------------------------------------------------------------
def _texto(valor, maximo):
    return ' '.join(str(valor or '').split())[:maximo]


def _pecas(bruto):
    if not isinstance(bruto, list):
        return []
    vistas = []
    for p in bruto:
        if isinstance(p, str) and VALOR_OK.match(p) and p not in vistas:
            vistas.append(p)
        if len(vistas) >= PECAS_MAX:
            break
    return vistas


def _origem(bruto, tipo):
    if not isinstance(bruto, dict):
        return {}
    campo = 'boardId' if tipo == 'board' else 'lookId'
    valor = bruto.get(campo)
    return {campo: valor} if isinstance(valor, str) and VALOR_OK.match(valor) else {}


def _imagem(data_url):
    m = DATA_URL.match(str(data_url or ''))
    if not m or m.group(1) not in TIPOS_IMAGEM:
        raise ErroDeConta('Miniatura inválida.')
    try:
        binario = base64.b64decode(m.group(2), validate=True)
    except ValueError:
        raise ErroDeConta('Miniatura inválida.')
    extensao, confere = TIPOS_IMAGEM[m.group(1)]
    if not binario or len(binario) > THUMB_MAX or not confere(binario):
        raise ErroDeConta('Miniatura inválida ou grande demais.')
    return binario, extensao


def _quando(bruto):
    agora_ = agora()
    try:
        dt = datetime.fromisoformat(str(bruto).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return iso(agora_)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    if dt > agora_ or dt < agora_ - timedelta(days=365):
        return iso(agora_)
    return iso(dt)


# --- O post como a tela vê ------------------------------------------------
def _publico(con, linha, eu_id):
    pid = linha['id']
    curtidas = [r[0] for r in con.execute('SELECT usuario FROM curtidas WHERE post=?', (pid,))]
    comentarios = [dict(r) for r in con.execute(
        'SELECT id, autor, texto, em FROM comentarios WHERE post=? ORDER BY em, rowid', (pid,))]
    post = {
        'id': pid,
        'autor': linha['autor'],
        'tipo': linha['tipo'],
        'nome': linha['nome'],
        'thumb': linha['thumb'],
        'criadoEm': linha['criado_em'],
        'pecas': json.loads(linha['pecas'] or '[]'),
        'curtidas': len(curtidas),
        'curtido': eu_id in curtidas,
        'comentarios': comentarios,
        'real': True,
    }
    if linha['autor'] == eu_id:
        post.update(json.loads(linha['origem'] or '{}'))
    return post


def _com_autores(con, linhas, eu_id):
    posts = [_publico(con, l, eu_id) for l in linhas]
    ids = set()
    for p in posts:
        ids.add(p['autor'])
        ids.update(c['autor'] for c in p['comentarios'])
    autores = {}
    for uid in ids:
        linha = _linha(con, uid)
        if linha:
            autores[uid] = _cartao(con, linha, eu_id)
    return {'posts': posts, 'autores': autores}


def _ler(con, post_id):
    if not ID_POST.match(str(post_id or '')):
        raise ErroDeConta('Post não encontrado.', 404)
    linha = con.execute('SELECT * FROM posts WHERE id=?', (post_id,)).fetchone()
    if not linha:
        raise ErroDeConta('Post não encontrado.', 404)
    return linha


def _devolver(post_id, eu_id):
    with banco() as con:
        return _com_autores(con, [_ler(con, post_id)], eu_id)


# --- Listar ---------------------------------------------------------------
def listar(eu_id, autor=None):
    with banco() as con:
        if autor:
            if not ID_OK.match(str(autor)):
                return {'posts': [], 'autores': {}}
            linhas = con.execute('SELECT * FROM posts WHERE autor=? ORDER BY criado_em DESC'
                                 ' LIMIT ?', (autor, LISTA_MAX)).fetchall()
        else:
            linhas = con.execute('SELECT * FROM posts ORDER BY criado_em DESC LIMIT ?',
                                 (LISTA_MAX,)).fetchall()
        return _com_autores(con, linhas, eu_id)


# --- Publicar e apagar ----------------------------------------------------
def publicar(eu_id, corpo):
    corpo = corpo if isinstance(corpo, dict) else {}
    chave = str(corpo.get('chave') or '')
    if not CHAVE_OK.match(chave):
        raise ErroDeConta('Publicação sem origem.')
    tipo = corpo.get('tipo') if corpo.get('tipo') in TIPOS else 'look'
    nome = _texto(corpo.get('nome'), NOME_MAX) or ('Colagem' if tipo == 'board' else 'Look')
    post_id = 'p-' + hashlib.sha256(('%s|%s' % (eu_id, chave)).encode()).hexdigest()[:16]

    with banco() as con:
        existente = con.execute('SELECT * FROM posts WHERE id=?', (post_id,)).fetchone()
        if existente:
            return _com_autores(con, [existente], eu_id)

    binario, extensao = _imagem(corpo.get('thumb'))
    impressao = hashlib.sha256(binario).hexdigest()[:10]
    nome_arquivo = '%s-%s.%s' % (post_id, impressao, extensao)
    os.makedirs(PASTA_THUMBS, exist_ok=True)
    with open(os.path.join(PASTA_THUMBS, nome_arquivo), 'wb') as f:
        f.write(binario)

    with banco() as con:
        con.execute(
            'INSERT OR IGNORE INTO posts (id, autor, tipo, nome, criado_em, thumb, pecas, origem)'
            ' VALUES (?,?,?,?,?,?,?,?)',
            (post_id, eu_id, tipo, nome, _quando(corpo.get('criadoEm')),
             'assets/posts/' + nome_arquivo,
             json.dumps(_pecas(corpo.get('pecas'))),
             json.dumps(_origem(corpo.get('origem'), tipo))))
        return _com_autores(con, [_ler(con, post_id)], eu_id)


def apagar(eu_id, post_id):
    with banco() as con:
        linha = _ler(con, post_id)
        if linha['autor'] != eu_id:
            raise ErroDeConta('Só quem publicou pode apagar.', 403)
        con.execute('DELETE FROM posts WHERE id=?', (post_id,))
    caminho = os.path.join(PASTA, *linha['thumb'].split('/'))
    if linha['thumb'].startswith('assets/posts/') and os.path.exists(caminho):
        os.remove(caminho)
    return {'apagado': post_id}


# --- Curtir e comentar ----------------------------------------------------
def curtir(eu_id, post_id, curte):
    with banco() as con:
        _ler(con, post_id)
        if curte:
            con.execute('INSERT OR IGNORE INTO curtidas (post, usuario) VALUES (?,?)',
                        (post_id, eu_id))
        else:
            con.execute('DELETE FROM curtidas WHERE post=? AND usuario=?', (post_id, eu_id))
    return _devolver(post_id, eu_id)


def comentar(eu_id, post_id, texto):
    texto = _texto(texto, TEXTO_MAX)
    if not texto:
        raise ErroDeConta('Comentário vazio.')
    with banco() as con:
        _ler(con, post_id)
        n = con.execute('SELECT COUNT(*) FROM comentarios WHERE post=?', (post_id,)).fetchone()[0]
        if n >= COMENTARIOS_MAX:
            raise ErroDeConta('Esse post já tem comentários demais.')
        con.execute('INSERT INTO comentarios (id, post, autor, texto, em) VALUES (?,?,?,?,?)',
                    ('c-' + os.urandom(5).hex(), post_id, eu_id, texto, iso(agora())))
    return _devolver(post_id, eu_id)


def apagar_comentario(eu_id, post_id, comentario_id):
    if not ID_COMENTARIO.match(str(comentario_id or '')):
        raise ErroDeConta('Comentário não encontrado.', 404)
    with banco() as con:
        post = _ler(con, post_id)
        c = con.execute('SELECT autor FROM comentarios WHERE id=? AND post=?',
                        (comentario_id, post_id)).fetchone()
        if not c:
            raise ErroDeConta('Comentário não encontrado.', 404)
        if eu_id not in (c['autor'], post['autor']):
            raise ErroDeConta('Só quem comentou pode apagar.', 403)
        con.execute('DELETE FROM comentarios WHERE id=?', (comentario_id,))
    return _devolver(post_id, eu_id)
