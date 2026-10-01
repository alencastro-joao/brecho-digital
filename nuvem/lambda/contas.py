# -*- coding: utf-8 -*-
"""
Contas e sessões sobre DynamoDB — a versão de nuvem de `App/tools/contas.py`.

A promessa daquele arquivo era esta: trocar *onde* o usuário mora é reescrever
as funções daqui — `criar_conta`, `autenticar`, `abrir_sessao`,
`usuario_da_sessao`, `fechar_sessao` — sem tocar numa linha de JavaScript. É
exatamente o que este módulo faz. A API pública, os erros e o formato do objeto
`_publico` são idênticos aos do SQLite; o que muda é a camada de baixo.

Tudo numa tabela só (`BD_TABELA`, chave de partição `pk`). Uma tabela em
on-demand não custa nada parada, mas cada índice secundário custa escrita: o
desenho abaixo não usa nenhum.

    USER#<id>              a conta: e-mail, handle, nome, hash da senha, papel
    EMAIL#<email_normal>   -> uid          unicidade do e-mail
    HANDLE#<handle_normal> -> uid          unicidade do @
    SESSAO#<sha256 token>  -> uid, versao  expira sozinha pelo TTL nativo
    TENTATIVA#<hash>       -> erros        rate limit, expira sozinho
    META#instalacao        marca que a primeira conta (o admin) já existe

Três decisões que valem a explicação:

* **Unicidade é item, não índice.** `EMAIL#...` e `HANDLE#...` entram na mesma
  transação da conta, cada um com `attribute_not_exists(pk)`. Índice secundário
  no DynamoDB é eventualmente consistente — dois cadastros simultâneos com o
  mesmo e-mail passariam os dois pela conferência e criariam as duas contas.
  Com item condicional, o segundo estoura na hora.

* **Derrubar sessão não varre tabela.** Trocar a senha incrementa
  `versao_senha` na conta; a sessão guarda a versão de quando nasceu. Na
  conferência as duas têm de bater. Sem isso seria preciso um índice por
  usuário (mais escrita, todo dia) ou um scan (mais leitura) só para o dia em
  que alguém troca a senha.

* **Sessão vencida some sozinha.** O `expira_em` vai também como `ttl` em
  epoch, e o DynamoDB apaga o item de graça. O `DELETE ... WHERE expira_em <`
  que o SQLite fazia a cada login era uma varredura a cada login.
"""

import base64
import hashlib
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone

import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from botocore.exceptions import ClientError

TABELA = os.environ.get('BD_TABELA') or 'brecho'
_dynamo = boto3.client('dynamodb')
_ser, _des = TypeSerializer(), TypeDeserializer()

# Custo do scrypt. O mesmo do SQLite: o hash carrega os parâmetros dentro dele,
# então senha criada no protótipo local continua valendo depois de importada.
SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_LEN = 2 ** 14, 8, 1, 32

SESSAO_DIAS = 30
COOKIE = 'bd_sessao'

EMAIL_OK = re.compile(r'^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$')
HANDLE_OK = re.compile(r'^[a-z0-9_.]{3,20}$')
SENHA_MIN = 8

# Força bruta no login: 8 tentativas erradas por (IP + e-mail) em 15 minutos.
# No servidor local isso era um dicionário em memória, e dava: era um processo
# só. Aqui cada pedido pode cair numa Lambda diferente, então o contador tem de
# morar fora do processo — e um item com TTL é mais barato que qualquer coisa
# que precise ficar ligada só para contar.
TENTATIVAS_MAX, TENTATIVAS_JANELA = 8, 15 * 60


class ErroDeConta(Exception):
    """Erro que pode ser mostrado a quem pediu; `codigo` é o status HTTP."""

    def __init__(self, mensagem, codigo=400):
        super().__init__(mensagem)
        self.mensagem = mensagem
        self.codigo = codigo


def agora():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.isoformat(timespec='seconds')


# --- DynamoDB -------------------------------------------------------------
def _put(item):
    return {'TableName': TABELA,
            'Item': {k: _ser.serialize(v) for k, v in item.items()}}


def _pegar(pk, consistente=True):
    r = _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': pk}},
                         ConsistentRead=consistente)
    item = r.get('Item')
    return {k: _des.deserialize(v) for k, v in item.items()} if item else None


def _transacao(itens):
    """TransactWriteItems. Devolve o índice da condição que falhou, ou None."""
    try:
        _dynamo.transact_write_items(TransactItems=itens)
        return None
    except ClientError as e:
        if e.response['Error']['Code'] != 'TransactionCanceledException':
            raise
        for i, razao in enumerate(e.response.get('CancellationReasons') or []):
            if razao.get('Code') == 'ConditionalCheckFailed':
                return i
        raise


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
def _publico(item):
    """O que o navegador pode ver. Nunca inclui a senha."""
    return {
        'id': item['id'],
        'email': item['email'],
        'emailConfirmado': bool(item.get('email_confirmado')),
        'handle': '@' + item['handle'],
        'nome': item['nome'],
        'papel': item['papel'],
        'criadoEm': item['criado_em'],
    }


def criar_conta(email, senha, nome=None, handle=None):
    email = limpar_email(email)
    senha = limpar_senha(senha)
    digitado = bool(str(handle or '').strip())
    handle = limpar_handle(handle, email)
    nome = limpar_nome(nome, handle)
    usuario_id = 'u-' + secrets.token_hex(8)
    email_normal = email.lower()

    # O primeiro a se cadastrar é o administrador: é a máquina de quem está
    # montando a loja. A marca entra na mesma transação da conta — se entrasse
    # antes, um cadastro que falhasse depois (e-mail repetido) gastaria a vaga
    # de admin e ninguém mais poderia ser.
    primeiro = _pegar('META#instalacao') is None
    senha_picada = picar_senha(senha)
    base, n = handle, 2

    for _ in range(12):
        itens = [
            {'Put': dict(_put({
                'pk': 'USER#' + usuario_id,
                'id': usuario_id,
                'email': email,
                'email_normal': email_normal,
                'email_confirmado': False,
                'handle': handle,
                'handle_normal': handle,
                'nome': nome,
                'senha': senha_picada,
                'papel': 'admin' if primeiro else 'usuario',
                'criado_em': iso(agora()),
                'versao_senha': 1,
            }), ConditionExpression='attribute_not_exists(pk)')},
            {'Put': dict(_put({'pk': 'EMAIL#' + email_normal, 'uid': usuario_id}),
                         ConditionExpression='attribute_not_exists(pk)')},
            {'Put': dict(_put({'pk': 'HANDLE#' + handle, 'uid': usuario_id}),
                         ConditionExpression='attribute_not_exists(pk)')},
        ]
        if primeiro:
            itens.append({'Put': dict(_put({'pk': 'META#instalacao',
                                            'criado_em': iso(agora())}),
                                      ConditionExpression='attribute_not_exists(pk)')})

        falhou = _transacao(itens)
        if falhou is None:
            break
        if falhou == 1:
            raise ErroDeConta('Já existe uma conta com esse e-mail.', 409)
        if falhou == 2:
            # @ digitado é escolha de alguém, e a resposta é o erro. @ deduzido
            # do e-mail não é escolha de ninguém: numera e tenta de novo.
            if digitado:
                raise ErroDeConta('Esse @ já está em uso.', 409)
            sufixo = str(n)
            handle, n = base[:20 - len(sufixo)] + sufixo, n + 1
            continue
        if falhou == 3:
            # Alguém criou a primeira conta entre a leitura e a transação.
            primeiro = False
            continue
        raise ErroDeConta('Não consegui criar a conta. Tente de novo.', 500)
    else:
        raise ErroDeConta('Esse @ já está em uso.', 409)

    return _publico(_pegar('USER#' + usuario_id))


def _bloqueado(chave):
    item = _pegar('TENTATIVA#' + chave)
    if not item:
        return 0
    erros, desde = int(item.get('erros') or 0), float(item.get('desde') or 0)
    if time.time() - desde > TENTATIVAS_JANELA:
        return 0
    return int(TENTATIVAS_JANELA - (time.time() - desde)) if erros >= TENTATIVAS_MAX else 0


def _errou(chave):
    marca = int(time.time())
    _dynamo.update_item(
        TableName=TABELA, Key={'pk': {'S': 'TENTATIVA#' + chave}},
        UpdateExpression='ADD erros :um SET desde = if_not_exists(desde, :agora),'
                         ' #ttl = if_not_exists(#ttl, :ttl)',
        ExpressionAttributeNames={'#ttl': 'ttl'},
        ExpressionAttributeValues={
            ':um': {'N': '1'},
            ':agora': {'N': str(marca)},
            ':ttl': {'N': str(marca + TENTATIVAS_JANELA)},
        })


def _esqueceu(chave):
    _dynamo.delete_item(TableName=TABELA, Key={'pk': {'S': 'TENTATIVA#' + chave}})


def autenticar(email, senha, origem=''):
    """Devolve o usuário, ou levanta ErroDeConta. A mensagem de erro é a mesma
    para e-mail inexistente e para senha errada — de propósito."""
    email = str(email or '').strip().lower()
    chave = hashlib.sha256(('%s|%s' % (origem, email)).encode('utf-8')).hexdigest()[:32]
    espera = _bloqueado(chave)
    if espera:
        raise ErroDeConta('Tentativas demais. Espere %d minutos.'
                          % max(1, espera // 60), 429)

    aponta = _pegar('EMAIL#' + email)
    item = _pegar('USER#' + aponta['uid']) if aponta else None
    # Sem conta, gasta o mesmo tempo de um scrypt: quem cronometra a resposta
    # não descobre quais e-mails existem aqui.
    ok, regravar = conferir_senha(str(senha or ''),
                                  item['senha'] if item else picar_senha('x'))
    if not item or not ok:
        _errou(chave)
        raise ErroDeConta('E-mail ou senha incorretos.', 401)

    mudanca = 'SET ultimo_acesso = :quando'
    valores = {':quando': {'S': iso(agora())}}
    if regravar:
        mudanca += ', senha = :senha'
        valores[':senha'] = {'S': picar_senha(senha)}
    _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': 'USER#' + item['id']}},
                        UpdateExpression=mudanca, ExpressionAttributeValues=valores)

    _esqueceu(chave)
    return _publico(item)


def atualizar_conta(usuario_id, nome=None, handle=None):
    """Nome e @ vêm da tela de perfil. E-mail e senha não mudam por aqui:
    trocar e-mail sem confirmar por e-mail é furo de segurança."""
    item = _pegar('USER#' + str(usuario_id or ''))
    if not item:
        raise ErroDeConta('Conta não encontrada.', 404)

    novo_nome = limpar_nome(nome if nome is not None else item['nome'], item['handle'])
    novo_handle = limpar_handle(handle if handle is not None else item['handle'],
                                item['email'])

    if novo_handle == item['handle']:
        _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': 'USER#' + usuario_id}},
                            UpdateExpression='SET nome = :nome',
                            ExpressionAttributeValues={':nome': {'S': novo_nome}})
    else:
        # A troca do @ reserva o novo e devolve o antigo na mesma transação:
        # nunca existe um instante com os dois ocupados nem com nenhum.
        falhou = _transacao([
            {'Put': dict(_put({'pk': 'HANDLE#' + novo_handle, 'uid': usuario_id}),
                         ConditionExpression='attribute_not_exists(pk)')},
            {'Delete': {'TableName': TABELA,
                        'Key': {'pk': {'S': 'HANDLE#' + item['handle']}}}},
            {'Update': {'TableName': TABELA,
                        'Key': {'pk': {'S': 'USER#' + usuario_id}},
                        'UpdateExpression': 'SET nome = :nome, handle = :h,'
                                            ' handle_normal = :h',
                        'ExpressionAttributeValues': {':nome': {'S': novo_nome},
                                                      ':h': {'S': novo_handle}}}},
        ])
        if falhou is not None:
            raise ErroDeConta('Esse @ já está em uso.', 409)

    return _publico(_pegar('USER#' + usuario_id))


def trocar_senha(usuario_id, senha_atual, senha_nova):
    senha_nova = limpar_senha(senha_nova)
    item = _pegar('USER#' + str(usuario_id or ''))
    if not item:
        raise ErroDeConta('Conta não encontrada.', 404)
    ok, _ = conferir_senha(str(senha_atual or ''), item['senha'])
    if not ok:
        raise ErroDeConta('A senha atual não confere.', 401)

    # Trocar a senha derruba as outras sessões: é o que se espera de quem troca
    # a senha justamente porque desconfia de alguém. Aqui isso é somar 1 na
    # versão — as sessões vivas guardam a versão antiga e param de conferir.
    _dynamo.update_item(
        TableName=TABELA, Key={'pk': {'S': 'USER#' + usuario_id}},
        UpdateExpression='SET senha = :senha ADD versao_senha :um',
        ExpressionAttributeValues={':senha': {'S': picar_senha(senha_nova)},
                                   ':um': {'N': '1'}})
    return True


# --- Sessões --------------------------------------------------------------
def _picar_token(token):
    return hashlib.sha256(token.encode('ascii')).hexdigest()


def abrir_sessao(usuario_id, agente=''):
    item = _pegar('USER#' + str(usuario_id or ''))
    versao = int(item.get('versao_senha') or 1) if item else 1
    token = secrets.token_urlsafe(32)
    expira = agora() + timedelta(days=SESSAO_DIAS)
    _dynamo.put_item(**_put({
        'pk': 'SESSAO#' + _picar_token(token),
        'uid': usuario_id,
        'versao': versao,
        'criado_em': iso(agora()),
        'expira_em': iso(expira),
        'ttl': int(expira.timestamp()),
        'agente': str(agente or '')[:200],
    }))
    return token, expira


def usuario_da_sessao(token):
    """Usuário dono do token, ou None. Renova a validade a cada uso."""
    if not token:
        return None
    picado = _picar_token(token)
    sessao = _pegar('SESSAO#' + picado)
    if not sessao:
        return None
    # O TTL do DynamoDB apaga em até 48h, não no segundo exato. A conferência
    # da validade continua sendo nossa; o TTL só faz a faxina do disco.
    if sessao['expira_em'] < iso(agora()):
        fechar_sessao(token)
        return None

    item = _pegar('USER#' + sessao['uid'])
    if not item or int(sessao.get('versao') or 1) != int(item.get('versao_senha') or 1):
        return None

    novo = agora() + timedelta(days=SESSAO_DIAS)
    _dynamo.update_item(
        TableName=TABELA, Key={'pk': {'S': 'SESSAO#' + picado}},
        UpdateExpression='SET expira_em = :iso, #ttl = :ttl',
        ExpressionAttributeNames={'#ttl': 'ttl'},
        ExpressionAttributeValues={':iso': {'S': iso(novo)},
                                   ':ttl': {'N': str(int(novo.timestamp()))}})
    return _publico(item)


def fechar_sessao(token):
    if not token:
        return
    _dynamo.delete_item(TableName=TABELA,
                        Key={'pk': {'S': 'SESSAO#' + _picar_token(token)}})
