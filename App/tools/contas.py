# -*- coding: utf-8 -*-
"""
Contas e sessões — a parte do servidor que sabe quem é quem.

Fica separado de `servidor.py` de propósito: este módulo é o único lugar que
conhece *onde* o usuário está gravado. Hoje é um SQLite em
`dados/usuarios.sqlite`; quando o projeto subir para a nuvem, trocar por
DynamoDB (ou Cognito) é reescrever as funções daqui — `criar_conta`,
`autenticar`, `abrir_sessao`, `usuario_da_sessao`, `fechar_sessao` — sem tocar
no resto do servidor nem numa linha de JavaScript.

O que já é comportamento de produção, e não de protótipo:

* **Senha nunca é guardada.** O que vai para o banco é um `scrypt` com sal
  próprio por usuário (`hashlib.scrypt`, da stdlib — sem dependência nova). O
  formato carrega os parâmetros, então dá para endurecer o custo depois sem
  invalidar as senhas antigas: quem entra com um hash de parâmetro velho é
  regravado com o novo na hora (ver `autenticar`).
* **O token de sessão também não é guardado.** No banco fica o SHA-256 dele.
  Vazar o arquivo do banco não dá a ninguém uma sessão válida.
* **A sessão expira** (30 dias), é renovada a cada uso e as vencidas são varridas.
* **Erro de login é sempre o mesmo**, e-mail existindo ou não, e custa o mesmo
  tempo. Senão a tela de login vira um verificador de quem tem conta aqui.

Não implementados ainda, de propósito (dependem de e-mail transacional, que é
decisão de infraestrutura da nuvem): confirmação de e-mail e "esqueci a senha".
A coluna `email_confirmado` e a tabela de sessões já comportam os dois.
"""

import base64
import hashlib
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

PASTA = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANCO = os.environ.get('BD_BANCO') or os.path.join(PASTA, 'dados', 'usuarios.sqlite')

# Custo do scrypt. 2**14 fica em ~15 ms por senha numa máquina comum: caro o
# bastante contra força bruta, barato o bastante para não travar o login.
SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_LEN = 2 ** 14, 8, 1, 32

SESSAO_DIAS = 30
COOKIE = 'bd_sessao'

EMAIL_OK = re.compile(r'^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$')
HANDLE_OK = re.compile(r'^[a-z0-9_.]{3,20}$')
SENHA_MIN = 8

# Força bruta no login: 8 tentativas erradas por (IP + e-mail) em 15 minutos.
# Em memória porque é do processo — na nuvem isso vira o rate limit do API
# Gateway (ou um item com TTL no DynamoDB), não uma tabela do banco.
TENTATIVAS_MAX, TENTATIVAS_JANELA = 8, 15 * 60
_tentativas = {}
_trava = threading.Lock()


class ErroDeConta(Exception):
    """Erro que pode ser mostrado ao usuário. `codigo` é o status HTTP."""

    def __init__(self, mensagem, codigo=400):
        super().__init__(mensagem)
        self.codigo = codigo


def agora():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.isoformat(timespec='seconds')


# --- Banco ----------------------------------------------------------------
def conectar():
    os.makedirs(os.path.dirname(BANCO), exist_ok=True)
    con = sqlite3.connect(BANCO, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute('PRAGMA journal_mode=WAL')       # leitura não trava escrita
    con.execute('PRAGMA foreign_keys=ON')
    return con


@contextmanager
def banco():
    """Conexao por chamada: commita no fim e fecha sempre. O `with con` do
    sqlite3 sozinho commita mas nao fecha — e o servidor e multi-thread."""
    con = conectar()
    try:
        with con:
            yield con
    finally:
        con.close()


def preparar():
    """Cria o esquema. Roda no boot do servidor; é idempotente."""
    with banco() as con:
        con.executescript("""
        CREATE TABLE IF NOT EXISTS usuarios (
          id               TEXT PRIMARY KEY,
          email            TEXT NOT NULL,
          email_normal     TEXT NOT NULL UNIQUE,   -- minúsculo: é por ele que se procura
          email_confirmado INTEGER NOT NULL DEFAULT 0,
          handle           TEXT NOT NULL,
          handle_normal    TEXT NOT NULL UNIQUE,
          nome             TEXT NOT NULL,
          senha            TEXT NOT NULL,          -- scrypt$n$r$p$sal$hash
          papel            TEXT NOT NULL DEFAULT 'usuario',
          criado_em        TEXT NOT NULL,
          ultimo_acesso    TEXT
        );
        CREATE TABLE IF NOT EXISTS sessoes (
          token_hash  TEXT PRIMARY KEY,            -- sha256 do token; o token só o dono tem
          usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          criado_em   TEXT NOT NULL,
          expira_em   TEXT NOT NULL,
          agente      TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id);
        """)


# --- Senha ----------------------------------------------------------------
def _b64(b):
    return base64.b64encode(b).decode('ascii')


def picar_senha(senha, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P):
    sal = secrets.token_bytes(16)
    bruto = hashlib.scrypt(senha.encode('utf-8'), salt=sal, n=n, r=r, p=p,
                           dklen=SCRYPT_LEN, maxmem=n * r * 256 * 2)
    return 'scrypt$%d$%d$%d$%s$%s' % (n, r, p, _b64(sal), _b64(bruto))


def conferir_senha(senha, guardado):
    """(confere?, vale regravar com o custo novo?)"""
    try:
        algo, n, r, p, sal, esperado = guardado.split('$')
        if algo != 'scrypt':
            return False, False
        n, r, p = int(n), int(r), int(p)
        bruto = hashlib.scrypt(senha.encode('utf-8'), salt=base64.b64decode(sal),
                               n=n, r=r, p=p, dklen=len(base64.b64decode(esperado)),
                               maxmem=n * r * 256 * 2)
    except (ValueError, TypeError):
        return False, False
    ok = secrets.compare_digest(_b64(bruto), esperado)
    return ok, ok and (n, r, p) != (SCRYPT_N, SCRYPT_R, SCRYPT_P)


# --- Validação ------------------------------------------------------------
def limpar_email(email):
    email = str(email or '').strip()
    if not EMAIL_OK.match(email) or len(email) > 120:
        raise ErroDeConta('E-mail inválido.')
    return email


def limpar_senha(senha):
    senha = str(senha or '')
    if len(senha) < SENHA_MIN:
        raise ErroDeConta('A senha precisa de pelo menos %d caracteres.' % SENHA_MIN)
    if len(senha) > 200:
        raise ErroDeConta('Senha grande demais.')
    return senha


def limpar_handle(handle, email):
    """Sem @ digitado, o handle nasce do que vem antes do @ do e-mail."""
    handle = str(handle or '').strip().lstrip('@').lower()
    if not handle:
        handle = re.sub(r'[^a-z0-9_.]', '', email.split('@')[0].lower())[:20]
    if not HANDLE_OK.match(handle):
        raise ErroDeConta('O @ pode ter de 3 a 20 caracteres, entre letras, '
                          'números, ponto e _.')
    return handle


def limpar_nome(nome, handle):
    nome = str(nome or '').strip()[:40]
    return nome or handle


# --- Contas ---------------------------------------------------------------
def _publico(linha):
    """O que o navegador pode ver. Nunca inclui a senha."""
    return {
        'id': linha['id'],
        'email': linha['email'],
        'emailConfirmado': bool(linha['email_confirmado']),
        'handle': '@' + linha['handle'],
        'nome': linha['nome'],
        'papel': linha['papel'],
        'criadoEm': linha['criado_em'],
    }


def criar_conta(email, senha, nome=None, handle=None):
    email = limpar_email(email)
    senha = limpar_senha(senha)
    digitado = bool(str(handle or '').strip())
    handle = limpar_handle(handle, email)
    nome = limpar_nome(nome, handle)
    usuario_id = 'u-' + secrets.token_hex(8)

    with banco() as con:
        # O primeiro a se cadastrar é o administrador: é a máquina de quem está
        # montando a loja. Do segundo em diante, todo mundo entra como usuário.
        vazio = con.execute('SELECT COUNT(*) FROM usuarios').fetchone()[0] == 0
        # Conferido antes do INSERT para o erro dizer o que de fato colidiu: o
        # handle nasce do e-mail, então cadastrar o mesmo e-mail duas vezes bate
        # nas duas restrições, e a do banco que estoura primeiro é a errada.
        if con.execute('SELECT 1 FROM usuarios WHERE email_normal=?',
                       (email.lower(),)).fetchone():
            raise ErroDeConta('Já existe uma conta com esse e-mail.', 409)
        # @ deduzido do e-mail não é escolha de ninguém: se estiver tomado,
        # numera. Só o @ digitado na tela devolve erro para quem o digitou.
        if not digitado:
            base, n = handle, 2
            while con.execute('SELECT 1 FROM usuarios WHERE handle_normal=?',
                              (handle,)).fetchone():
                sufixo = str(n)
                handle, n = base[:20 - len(sufixo)] + sufixo, n + 1
        try:
            con.execute(
                'INSERT INTO usuarios (id, email, email_normal, handle, handle_normal,'
                ' nome, senha, papel, criado_em) VALUES (?,?,?,?,?,?,?,?,?)',
                (usuario_id, email, email.lower(), handle, handle,
                 nome, picar_senha(senha), 'admin' if vazio else 'usuario', iso(agora())))
        except sqlite3.IntegrityError as e:
            if 'handle' in str(e):
                raise ErroDeConta('Esse @ já está em uso.', 409)
            raise ErroDeConta('Já existe uma conta com esse e-mail.', 409)
        linha = con.execute('SELECT * FROM usuarios WHERE id=?', (usuario_id,)).fetchone()
    return _publico(linha)


def _bloqueado(chave):
    with _trava:
        registro = _tentativas.get(chave)
        if not registro:
            return 0
        erros, desde = registro
        if time.time() - desde > TENTATIVAS_JANELA:
            _tentativas.pop(chave, None)
            return 0
        return int(TENTATIVAS_JANELA - (time.time() - desde)) if erros >= TENTATIVAS_MAX else 0


def _errou(chave):
    with _trava:
        erros, desde = _tentativas.get(chave, (0, time.time()))
        if time.time() - desde > TENTATIVAS_JANELA:
            erros, desde = 0, time.time()
        _tentativas[chave] = (erros + 1, desde)


def autenticar(email, senha, origem=''):
    """Devolve o usuário, ou levanta ErroDeConta. A mensagem de erro é a mesma
    para e-mail inexistente e para senha errada — de propósito."""
    email = str(email or '').strip().lower()
    chave = (origem, email)
    espera = _bloqueado(chave)
    if espera:
        raise ErroDeConta('Tentativas demais. Espere %d minutos.'
                          % max(1, espera // 60), 429)

    with banco() as con:
        linha = con.execute('SELECT * FROM usuarios WHERE email_normal=?',
                            (email,)).fetchone()
        # Sem conta, gasta o mesmo tempo de um scrypt: quem cronometra a
        # resposta não descobre quais e-mails existem aqui.
        ok, regravar = conferir_senha(str(senha or ''),
                                      linha['senha'] if linha else picar_senha('x'))
        if not linha or not ok:
            _errou(chave)
            raise ErroDeConta('E-mail ou senha incorretos.', 401)

        if regravar:
            con.execute('UPDATE usuarios SET senha=? WHERE id=?',
                        (picar_senha(senha), linha['id']))
        con.execute('UPDATE usuarios SET ultimo_acesso=? WHERE id=?',
                    (iso(agora()), linha['id']))

    with _trava:
        _tentativas.pop(chave, None)
    return _publico(linha)


def atualizar_conta(usuario_id, nome=None, handle=None):
    """Nome e @ vêm da tela de perfil. E-mail e senha não mudam por aqui:
    trocar e-mail sem confirmar por e-mail é furo de segurança."""
    with banco() as con:
        linha = con.execute('SELECT * FROM usuarios WHERE id=?', (usuario_id,)).fetchone()
        if not linha:
            raise ErroDeConta('Conta não encontrada.', 404)
        novo_nome = limpar_nome(nome if nome is not None else linha['nome'], linha['handle'])
        novo_handle = limpar_handle(handle if handle is not None else linha['handle'],
                                    linha['email'])
        try:
            con.execute('UPDATE usuarios SET nome=?, handle=?, handle_normal=? WHERE id=?',
                        (novo_nome, novo_handle, novo_handle, usuario_id))
        except sqlite3.IntegrityError:
            raise ErroDeConta('Esse @ já está em uso.', 409)
        linha = con.execute('SELECT * FROM usuarios WHERE id=?', (usuario_id,)).fetchone()
    return _publico(linha)


def trocar_senha(usuario_id, senha_atual, senha_nova):
    senha_nova = limpar_senha(senha_nova)
    with banco() as con:
        linha = con.execute('SELECT * FROM usuarios WHERE id=?', (usuario_id,)).fetchone()
        if not linha:
            raise ErroDeConta('Conta não encontrada.', 404)
        ok, _ = conferir_senha(str(senha_atual or ''), linha['senha'])
        if not ok:
            raise ErroDeConta('A senha atual não confere.', 401)
        con.execute('UPDATE usuarios SET senha=? WHERE id=?',
                    (picar_senha(senha_nova), usuario_id))
        # Trocar a senha derruba as outras sessões: é o que se espera de quem
        # troca a senha justamente porque desconfia de alguém.
        con.execute('DELETE FROM sessoes WHERE usuario_id=?', (usuario_id,))
    return True


# --- Sessões --------------------------------------------------------------
def _picar_token(token):
    return hashlib.sha256(token.encode('ascii')).hexdigest()


def abrir_sessao(usuario_id, agente=''):
    token = secrets.token_urlsafe(32)
    expira = agora() + timedelta(days=SESSAO_DIAS)
    with banco() as con:
        con.execute('DELETE FROM sessoes WHERE expira_em < ?', (iso(agora()),))
        con.execute('INSERT INTO sessoes (token_hash, usuario_id, criado_em, expira_em,'
                    ' agente) VALUES (?,?,?,?,?)',
                    (_picar_token(token), usuario_id, iso(agora()), iso(expira),
                     str(agente or '')[:200]))
    return token, expira


def usuario_da_sessao(token):
    """Usuário dono do token, ou None. Renova a validade a cada uso."""
    if not token:
        return None
    picado = _picar_token(token)
    with banco() as con:
        linha = con.execute(
            'SELECT u.*, s.expira_em FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id'
            ' WHERE s.token_hash = ?', (picado,)).fetchone()
        if not linha:
            return None
        if linha['expira_em'] < iso(agora()):
            con.execute('DELETE FROM sessoes WHERE token_hash=?', (picado,))
            return None
        con.execute('UPDATE sessoes SET expira_em=? WHERE token_hash=?',
                    (iso(agora() + timedelta(days=SESSAO_DIAS)), picado))
    return _publico(linha)


def fechar_sessao(token):
    if not token:
        return
    with banco() as con:
        con.execute('DELETE FROM sessoes WHERE token_hash=?', (_picar_token(token),))
