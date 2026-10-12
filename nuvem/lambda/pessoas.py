# -*- coding: utf-8 -*-
"""
Pessoas: achar gente de verdade, ver a página dela e seguir — sobre DynamoDB.

Até aqui o app só conhecia os perfis fictícios do feed (`PERFIS_MOCK`, no
front). Uma conta real não aparecia em lugar nenhum para os outros: o login
sabia quem ela é, mas nada expunha isso. Este módulo é o que faltava, e é o
espelho de `App/tools/pessoas.py` (SQLite) — mesmas funções, mesmos erros,
mesmo formato de resposta.

    GET  /api/usuarios?q=      procura por nome, sobrenome, @ ou bio
    GET  /api/usuarios/<id>    a página pública de uma pessoa
    POST /api/seguir           { id, segue }: segue ou deixa de seguir
    GET  /api/social           quem eu sigo e quem me segue
    PUT  /api/perfil           o que os outros leem de mim: bio, rosto, roupa, favoritos

O desenho, na mesma tabela das contas (nenhum índice novo):

    USER#<id>   ganha três atributos:
        seguindo    conjunto (SS) de ids que esta conta segue
        seguidores  conjunto (SS) de ids que seguem esta conta
        perfil      { bio, avatar, equipado, favoritos } — a parte pública do save

* **Seguir é uma transação de duas pontas.** `ADD` no `seguindo` de quem segue
  e `ADD` no `seguidores` de quem é seguido, juntos. Conjunto do DynamoDB é
  idempotente: seguir duas vezes não duplica nada, e desfazer uma ponta sem a
  outra não acontece. Não há contador para dessincronizar: o número que a tela
  mostra é o tamanho do conjunto.

* **Amigo é mão dupla**, como o app já definia: eu sigo e a pessoa me segue.
  Cada cartão volta com `voceSegue` e `segueVoce`, e é o front que junta os
  dois. Não há pedido nem aceite — seguir alguém que já segue você basta.

* **O perfil público é enviado pelo próprio dono.** O save inteiro mora no S3
  (megabytes, com miniaturas); ler o de outra pessoa para desenhar um retrato
  seria absurdo. O front manda só o pedaço público, pequeno e validado aqui.

* **Nunca sai e-mail nem papel.** O cartão é o que qualquer pessoa logada pode
  saber de qualquer outra: nome, @, desde quando, bio, rosto, roupa e contagens.

* **A página inteira mostra o mesmo que o perfil do dono.** `perfil_de` junta
  ao cartão os favoritos (peças, looks e colagens com estrela — o que o dono
  escolheu mostrar) e os amigos (quem a pessoa segue e a segue de volta). Só
  ali: a busca e /api/social devolvem listas de cartões, e favoritos e amigos
  de cada um pesariam à toa.

Custo da busca: é uma varredura (`Scan`) da tabela, filtrada aqui. A tabela é
minúscula e paga por uso, então isso é trocado por miúdos. Quando passar de
alguns milhares de itens, o caminho é um item `BUSCA#` por conta — ou um índice
—, e só esta função muda; a rota e o front continuam iguais.
"""

import re
import unicodedata

from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

from contas import ErroDeConta, TABELA, _dynamo, _des, _pegar, _transacao

_ser = TypeSerializer()

ID_OK = re.compile(r'^u-[0-9a-f]{16}$')
VALOR_OK = re.compile(r'^[\w#.\-]{1,32}$')
BIO_MAX = 140
TERMO_MAX = 40
RESULTADOS = 20
LISTA_MAX = 60          # quantos cartões /api/social devolve de cada lado
NOME_MAX = 60
PECAS_FAV_MAX = 40      # peças favoritas na página (o front não tem teto)
OBRAS_FAV_MAX = 3       # looks e colagens: as três vagas de favoritos.js
PECAS_POR_OBRA = 40

# Só o que o cartão usa. A varredura nunca traz a senha para a memória.
_CAMPOS = {'#id': 'id', '#h': 'handle', '#n': 'nome', '#c': 'criado_em',
           '#p': 'perfil', '#sg': 'seguindo', '#sd': 'seguidores'}
_PROJECAO = ', '.join(_CAMPOS)


def normalizar(texto):
    """Sem acento, sem caixa: `jo` acha "Jô", `leo` acha "Léo"."""
    decomposto = unicodedata.normalize('NFD', str(texto or ''))
    return ''.join(c for c in decomposto if not unicodedata.combining(c)).lower().strip()


def _item(bruto):
    return {k: _des.deserialize(v) for k, v in bruto.items()}


# --- O cartão -------------------------------------------------------------
def _cartao(item, eu=None):
    """O que qualquer pessoa logada pode saber de qualquer outra."""
    perfil = item.get('perfil') or {}
    cartao = {
        'id': item['id'],
        'nome': item['nome'],
        'handle': '@' + item['handle'],
        'criadoEm': item['criado_em'],
        'bio': perfil.get('bio') or '',
        'avatar': dict(perfil.get('avatar') or {}),
        'equipado': dict(perfil.get('equipado') or {}),
        'seguidores': len(item.get('seguidores') or ()),
        'seguindo': len(item.get('seguindo') or ()),
    }
    if eu is not None:
        cartao['voceSegue'] = item['id'] in (eu.get('seguindo') or ())
        cartao['segueVoce'] = item['id'] in (eu.get('seguidores') or ())
    return cartao


def _cartoes(ids, eu):
    """Cartões de uma lista de ids. GetItem um a um, e não BatchGetItem: a
    lista é curta (LISTA_MAX) e assim o papel da Lambda não ganha permissão
    nenhuma além da que já tinha."""
    achados = {}
    for uid in ids:
        if not ID_OK.match(uid):
            continue
        item = _pegar('USER#' + uid)
        if item:
            achados[uid] = _cartao(item, eu)
    return achados


def _varrer():
    args = {
        'TableName': TABELA,
        'FilterExpression': 'begins_with(pk, :u)',
        'ProjectionExpression': _PROJECAO,
        'ExpressionAttributeNames': _CAMPOS,
        'ExpressionAttributeValues': {':u': {'S': 'USER#'}},
    }
    while True:
        r = _dynamo.scan(**args)
        for bruto in r.get('Items', []):
            yield _item(bruto)
        if 'LastEvaluatedKey' not in r:
            return
        args['ExclusiveStartKey'] = r['LastEvaluatedKey']


# --- Busca ----------------------------------------------------------------
def _nota(item, termo):
    """Onde o termo casou; quanto menor, melhor. É a mesma escala de busca.js:
    o @ e o nome que *começam* com o termo vêm antes de quem só o contém."""
    handle = item['handle'].lower()
    nome = normalizar(item['nome'])
    bio = normalizar((item.get('perfil') or {}).get('bio'))
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
    """Até RESULTADOS pessoas, nunca a própria. Sem termo, as mais novas — é o
    que a tela mostra antes de alguém digitar."""
    termo = normalizar(texto).lstrip('@')
    if len(termo) > TERMO_MAX:
        raise ErroDeConta('Termo grande demais.')
    if termo and len(termo) < 2:
        return []

    eu = _pegar('USER#' + str(eu_id or '')) or {}
    outros = [i for i in _varrer() if i['id'] != eu_id]

    if not termo:
        outros.sort(key=lambda i: i['criado_em'], reverse=True)
        achados = outros
    else:
        notas = [(_nota(i, termo), i) for i in outros]
        notas = [(n, i) for n, i in notas if n >= 0]
        notas.sort(key=lambda x: (x[0], normalizar(x[1]['nome'])))
        achados = [i for _, i in notas]

    return [_cartao(i, eu) for i in achados[:RESULTADOS]]


def perfil_de(eu_id, alvo_id, completo=True):
    """O cartão e, na página da pessoa (`completo`), o que o perfil dela mostra:
    os favoritos e os amigos. Seguir devolve só o cartão."""
    if not ID_OK.match(str(alvo_id or '')):
        raise ErroDeConta('Perfil não encontrado.', 404)
    item = _pegar('USER#' + alvo_id)
    if not item:
        raise ErroDeConta('Perfil não encontrado.', 404)
    eu = _pegar('USER#' + eu_id) or {}
    cartao = _cartao(item, eu)
    if not completo:
        return cartao

    # Quem nunca enviou os favoritos (versão antiga do app) volta sem a chave,
    # e a tela cai nas publicações, como antes.
    favoritos = (item.get('perfil') or {}).get('favoritos')
    if favoritos is not None:
        cartao['favoritos'] = favoritos
    # Amigo é mão dupla: ela segue e é seguida de volta.
    mutuos = set(item.get('seguindo') or ()) & set(item.get('seguidores') or ())
    ids = sorted(mutuos)[:LISTA_MAX]
    donos = _cartoes(ids, eu)
    cartao['amigos'] = [donos[i] for i in ids if i in donos]
    return cartao


# --- Seguir ---------------------------------------------------------------
def seguir(eu_id, alvo_id, segue):
    """Segue (ou deixa de seguir) e devolve o cartão já atualizado."""
    alvo_id = str(alvo_id or '')
    if not ID_OK.match(alvo_id):
        raise ErroDeConta('Perfil não encontrado.', 404)
    if alvo_id == eu_id:
        raise ErroDeConta('Você não pode seguir a si mesmo.')

    verbo = 'ADD' if segue else 'DELETE'

    def ponta(uid, atributo, outro):
        return {'Update': {
            'TableName': TABELA,
            'Key': {'pk': {'S': 'USER#' + uid}},
            'UpdateExpression': '%s %s :o' % (verbo, atributo),
            'ExpressionAttributeValues': {':o': {'SS': [outro]}},
            'ConditionExpression': 'attribute_exists(pk)',
        }}

    falhou = _transacao([ponta(eu_id, 'seguindo', alvo_id),
                         ponta(alvo_id, 'seguidores', eu_id)])
    if falhou is not None:
        raise ErroDeConta('Perfil não encontrado.', 404)
    return perfil_de(eu_id, alvo_id, completo=False)


def social(eu_id):
    """Quem eu sigo e quem me segue, já com os cartões."""
    eu = _pegar('USER#' + eu_id) or {}
    seguindo = sorted(eu.get('seguindo') or ())[:LISTA_MAX]
    seguidores = sorted(eu.get('seguidores') or ())[:LISTA_MAX]
    donos = _cartoes(set(seguindo) | set(seguidores), eu)
    return {
        'seguindo': [donos[i] for i in seguindo if i in donos],
        'seguidores': [donos[i] for i in seguidores if i in donos],
    }


# --- O que os outros leem de mim ------------------------------------------
def _mapa(bruto, maximo):
    """Um dicionário de texto curto para texto curto — e nada além disso.
    Vem do navegador, então nada é confiado: chave e valor passam por regex."""
    if not isinstance(bruto, dict):
        return {}
    saida = {}
    for chave, valor in list(bruto.items())[:maximo]:
        if isinstance(chave, str) and isinstance(valor, str) \
                and VALOR_OK.match(chave) and VALOR_OK.match(valor):
            saida[chave] = valor
    return saida


def _ids(bruto, maximo):
    """Lista de ids de peça, sem repetir, validados como qualquer valor curto."""
    if not isinstance(bruto, list):
        return []
    vistos = []
    for p in bruto:
        if isinstance(p, str) and VALOR_OK.match(p) and p not in vistos:
            vistos.append(p)
        if len(vistos) >= maximo:
            break
    return vistos


def miniatura_ok(eu_id):
    """A miniatura de um favorito só pode ser uma que o próprio dono subiu
    (feed.subir_miniatura): nada de apontar para arquivo de outra pessoa ou
    para fora do site."""
    return re.compile(r'^assets/posts/perfil-%s-[0-9a-f]{10}\.(webp|jpg|png)$'
                      % re.escape(str(eu_id or '')))


def _obras(bruto, eu_id):
    if not isinstance(bruto, list):
        return []
    thumb_ok = miniatura_ok(eu_id)
    saida = []
    for obra in bruto[:OBRAS_FAV_MAX]:
        if not isinstance(obra, dict):
            continue
        thumb = str(obra.get('thumb') or '')
        saida.append({
            'nome': ' '.join(str(obra.get('nome') or '').split())[:NOME_MAX],
            'thumb': thumb if thumb_ok.match(thumb) else '',
            'pecas': _ids(obra.get('pecas'), PECAS_POR_OBRA),
        })
    return saida


def limpar_favoritos(bruto, eu_id):
    bruto = bruto if isinstance(bruto, dict) else {}
    return {
        'pecas': _ids(bruto.get('pecas'), PECAS_FAV_MAX),
        'looks': _obras(bruto.get('looks'), eu_id),
        'colagens': _obras(bruto.get('colagens'), eu_id),
    }


def limpar_perfil(corpo, eu_id=None):
    corpo = corpo if isinstance(corpo, dict) else {}
    perfil = {
        'bio': str(corpo.get('bio') or '').strip()[:BIO_MAX],
        'avatar': _mapa(corpo.get('avatar'), 8),
        'equipado': _mapa(corpo.get('equipado'), 12),
    }
    if 'favoritos' in corpo:
        perfil['favoritos'] = limpar_favoritos(corpo.get('favoritos'), eu_id)
    return perfil


def atualizar_perfil(eu_id, corpo):
    perfil = limpar_perfil(corpo, eu_id)
    try:
        _dynamo.update_item(
            TableName=TABELA, Key={'pk': {'S': 'USER#' + str(eu_id or '')}},
            UpdateExpression='SET perfil = :p',
            ConditionExpression='attribute_exists(pk)',
            ExpressionAttributeValues={':p': _ser.serialize(perfil)})
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            raise ErroDeConta('Conta não encontrada.', 404)
        raise
    return perfil
