# -*- coding: utf-8 -*-
"""
Pessoas: achar gente de verdade, ver a página dela e seguir — sobre SQLite.

É o espelho de `nuvem/lambda/pessoas.py` (DynamoDB): mesmas funções, mesmos
erros, mesmo formato de cartão. O desenho e o porquê de cada escolha estão
naquele arquivo; aqui só muda *onde* mora:

    usuarios.perfil   JSON com { bio, avatar, equipado } — a parte pública do save
    segue(de, para)   uma linha por "fulano segue beltrano"

Seguir é uma linha (`INSERT OR IGNORE`, idempotente) e as contagens são
`COUNT(*)` — não há contador para dessincronizar.

As regras puras (normalizar, ranquear, validar o perfil) estão duplicadas de
propósito: a Lambda não enxerga esta pasta, e um módulo compartilhado pediria
um passo de empacotamento a mais só para 40 linhas. Mexeu numa, mexa na outra.
"""

import json
import re
import unicodedata

from contas import ErroDeConta, agora, banco, iso

ID_OK = re.compile(r'^u-[0-9a-f]{16}$')
VALOR_OK = re.compile(r'^[\w#.\-]{1,32}$')
BIO_MAX = 140
TERMO_MAX = 40
RESULTADOS = 20
LISTA_MAX = 60


def preparar():
    """Acrescenta o que as pessoas precisam ao esquema. Idempotente: roda no
    boot do servidor, depois de `contas.preparar()`."""
    with banco() as con:
        colunas = [c['name'] for c in con.execute('PRAGMA table_info(usuarios)')]
        if 'perfil' not in colunas:
            con.execute('ALTER TABLE usuarios ADD COLUMN perfil TEXT')
        con.execute("""
            CREATE TABLE IF NOT EXISTS segue (
              de        TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
              para      TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
              criado_em TEXT NOT NULL,
              PRIMARY KEY (de, para)
            )""")
        con.execute('CREATE INDEX IF NOT EXISTS idx_segue_para ON segue(para)')


def normalizar(texto):
    """Sem acento, sem caixa: `jo` acha "Jô", `leo` acha "Léo"."""
    decomposto = unicodedata.normalize('NFD', str(texto or ''))
    return ''.join(c for c in decomposto if not unicodedata.combining(c)).lower().strip()


# --- O cartão -------------------------------------------------------------
def _perfil(linha):
    try:
        return json.loads(linha['perfil'] or '{}')
    except ValueError:
        return {}


def _cartao(con, linha, eu_id=None):
    """O que qualquer pessoa logada pode saber de qualquer outra."""
    perfil = _perfil(linha)
    uid = linha['id']

    def conta(sql, *args):
        return con.execute(sql, args).fetchone()[0]

    cartao = {
        'id': uid,
        'nome': linha['nome'],
        'handle': '@' + linha['handle'],
        'criadoEm': linha['criado_em'],
        'bio': perfil.get('bio') or '',
        'avatar': perfil.get('avatar') or {},
        'equipado': perfil.get('equipado') or {},
        'seguidores': conta('SELECT COUNT(*) FROM segue WHERE para=?', uid),
        'seguindo': conta('SELECT COUNT(*) FROM segue WHERE de=?', uid),
    }
    if eu_id is not None:
        cartao['voceSegue'] = bool(conta(
            'SELECT COUNT(*) FROM segue WHERE de=? AND para=?', eu_id, uid))
        cartao['segueVoce'] = bool(conta(
            'SELECT COUNT(*) FROM segue WHERE de=? AND para=?', uid, eu_id))
    return cartao


def _linha(con, uid):
    if not ID_OK.match(str(uid or '')):
        return None
    return con.execute('SELECT * FROM usuarios WHERE id=?', (uid,)).fetchone()


# --- Busca ----------------------------------------------------------------
def _nota(linha, termo):
    """Onde o termo casou; quanto menor, melhor. Mesma escala de busca.js."""
    handle = linha['handle'].lower()
    nome = normalizar(linha['nome'])
    bio = normalizar(_perfil(linha).get('bio'))
    if handle.startswith(termo):
        return 0
    if nome.startswith(termo):
        return 1
    if any(parte.startswith(termo) for parte in nome.split()):
        return 2
    if termo in handle:
        return 3
    if termo in nome:
        return 4
    if termo in bio:
        return 5
    return -1


def buscar(eu_id, texto):
    """Até RESULTADOS pessoas, nunca a própria. Sem termo, as mais novas."""
    termo = normalizar(texto).lstrip('@')
    if len(termo) > TERMO_MAX:
        raise ErroDeConta('Termo grande demais.')
    if termo and len(termo) < 2:
        return []

    with banco() as con:
        outros = con.execute('SELECT * FROM usuarios WHERE id != ?', (eu_id,)).fetchall()
        if not termo:
            achados = sorted(outros, key=lambda l: l['criado_em'], reverse=True)
        else:
            notas = [(_nota(l, termo), l) for l in outros]
            notas = [(n, l) for n, l in notas if n >= 0]
            notas.sort(key=lambda x: (x[0], normalizar(x[1]['nome'])))
            achados = [l for _, l in notas]
        return [_cartao(con, l, eu_id) for l in achados[:RESULTADOS]]


def perfil_de(eu_id, alvo_id):
    with banco() as con:
        linha = _linha(con, alvo_id)
        if not linha:
            raise ErroDeConta('Perfil não encontrado.', 404)
        return _cartao(con, linha, eu_id)


# --- Seguir ---------------------------------------------------------------
def seguir(eu_id, alvo_id, segue):
    """Segue (ou deixa de seguir) e devolve o cartão já atualizado."""
    alvo_id = str(alvo_id or '')
    if alvo_id == eu_id:
        raise ErroDeConta('Você não pode seguir a si mesmo.')
    with banco() as con:
        if not _linha(con, alvo_id):
            raise ErroDeConta('Perfil não encontrado.', 404)
        if segue:
            con.execute('INSERT OR IGNORE INTO segue (de, para, criado_em) VALUES (?,?,?)',
                        (eu_id, alvo_id, iso(agora())))
        else:
            con.execute('DELETE FROM segue WHERE de=? AND para=?', (eu_id, alvo_id))
    return perfil_de(eu_id, alvo_id)


def social(eu_id):
    """Quem eu sigo e quem me segue, já com os cartões."""
    with banco() as con:
        def lado(sql):
            linhas = con.execute(sql, (eu_id, LISTA_MAX)).fetchall()
            return [_cartao(con, l, eu_id) for l in linhas]
        return {
            'seguindo': lado('SELECT u.* FROM segue s JOIN usuarios u ON u.id = s.para'
                             ' WHERE s.de=? ORDER BY u.id LIMIT ?'),
            'seguidores': lado('SELECT u.* FROM segue s JOIN usuarios u ON u.id = s.de'
                               ' WHERE s.para=? ORDER BY u.id LIMIT ?'),
        }


# --- O que os outros leem de mim ------------------------------------------
def _mapa(bruto, maximo):
    """Um dicionário de texto curto para texto curto — e nada além disso."""
    if not isinstance(bruto, dict):
        return {}
    saida = {}
    for chave, valor in list(bruto.items())[:maximo]:
        if isinstance(chave, str) and isinstance(valor, str) \
                and VALOR_OK.match(chave) and VALOR_OK.match(valor):
            saida[chave] = valor
    return saida


def limpar_perfil(corpo):
    corpo = corpo if isinstance(corpo, dict) else {}
    return {
        'bio': str(corpo.get('bio') or '').strip()[:BIO_MAX],
        'avatar': _mapa(corpo.get('avatar'), 8),
        'equipado': _mapa(corpo.get('equipado'), 12),
    }


def atualizar_perfil(eu_id, corpo):
    perfil = limpar_perfil(corpo)
    with banco() as con:
        feito = con.execute('UPDATE usuarios SET perfil=? WHERE id=?',
                            (json.dumps(perfil, ensure_ascii=False), eu_id)).rowcount
    if not feito:
        raise ErroDeConta('Conta não encontrada.', 404)
    return perfil
