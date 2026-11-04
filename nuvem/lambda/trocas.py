# -*- coding: utf-8 -*-
"""
Troca de peças entre amigas — decidida aqui, aplicada no save de cada uma.

O guarda-roupa mora no save, que é o navegador quem escreve: se a troca
mexesse só nele, bastava não tirar a peça do próprio guarda-roupa para
"duplicar". Por isso quem decide é o histórico das cópias (estoque.py,
`COPIA#<id>|<raridade>#<n>`): o último dono da lista é o dono da cópia. A troca
acrescenta um dono novo em cada uma das duas cópias, numa transação só, e a
tiragem não muda (a cópia só troca de mãos).

As regras (escolhidas pelo João em 04/11/2026):

- só entre amigas (uma segue a outra);
- 1 peça por 1 peça, da mesma raridade;
- quem pede oferece de 1 a 4 opções; quem recebe escolhe 1 ou recusa;
- cada pessoa recebe no máximo 2 peças por dia em trocas;
- não existe presente (sempre vai uma peça de cada lado).

As fichas (o custo da troca), o nível mínimo e tirar a peça dos looks moram no
save, como o resto do jogo (js/trocas.js): quem mexer no save pula o custo,
mas não consegue duplicar peça.

    TROCA#<id>     a oferta: de, para, quero, opcoes, estado, vence, escolhida...
    TROCAS#<uid>   a caixa de cada uma: ids (SS) das trocas em que ela está
    COTA#<uid>#<dia>  ganha o campo `trocas` (o mesmo item da cota do estoque)

Estados: aberta → feita | recusada | cancelada | vencida | invalida.
"""

import re
import secrets
from datetime import datetime, timedelta, timezone

from botocore.exceptions import ClientError

import estoque
from contas import ErroDeConta, TABELA, _dynamo, _pegar, _put, _transacao, pegar_varios

RARIDADES = tuple(estoque.LIMITES)
MAX_OPCOES = 4
POR_DIA = 2               # peças recebidas por troca, por pessoa, por dia
ABERTAS_ENVIADAS = 5
ABERTAS_RECEBIDAS = 10
VALIDADE_H = 48
CAIXA_MAX = 40            # quantas trocas a caixa devolve (as mais novas)
GUARDAR_DIAS = 14         # troca encerrada sai da caixa depois disso
ID_TROCA = re.compile(r'^t-[0-9a-f]{16}$')


def _agora():
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%SZ')


def _novo_id():
    return 't-' + secrets.token_hex(8)


# --- Leituras -----------------------------------------------------------
def _conta(uid):
    item = _pegar('USER#' + str(uid or ''))
    if not item:
        raise ErroDeConta('Perfil não encontrado.', 404)
    return item


def _amigas(a, b):
    return b['id'] in (a.get('seguindo') or ()) and b['id'] in (a.get('seguidores') or ())


def _guarda_roupa(item):
    """{id: raridade} do que a pessoa mostra no perfil (pessoas.py)."""
    perfil = item.get('perfil') or {}
    ids = perfil.get('guardaRoupa') or []
    letras = perfil.get('raridades') or ''
    por_letra = {r[0]: r for r in RARIDADES}   # c u r e l
    return {pid: por_letra.get(letras[i:i + 1]) for i, pid in enumerate(ids)}


def _copia(c, raridade):
    """Uma cópia que veio do navegador: {id, raridade, numero[, origem, desde]}."""
    c = c if isinstance(c, dict) else {}
    (pid, rar), = estoque._validar([c])
    if rar != raridade:
        raise ValueError('as duas peças têm que ser da mesma raridade')
    try:
        numero = int(c.get('numero'))
    except (TypeError, ValueError):
        raise ValueError('essa peça não tem número: abra a ficha dela e tente de novo')
    if not 0 < numero <= estoque.LIMITES[rar]:
        raise ValueError('número da cópia inválido')
    return {'id': pid, 'raridade': rar, 'numero': numero,
            'origem': str(c.get('origem') or ''), 'desde': str(c.get('desde') or '')}


def _e_dona(usuario, c):
    """A pessoa é a última dona da cópia? Cópia antiga sem histórico ganha o
    primeiro dono aqui, como na ficha da peça (estoque.historico)."""
    pedido = {k: c[k] for k in ('id', 'raridade', 'numero')}
    if c.get('origem'):
        pedido.update(origem=c['origem'], desde=c.get('desde'))
    donos = estoque.historico([pedido], usuario)['historico'].get(
        '%s|%d' % (estoque.chave(c['id'], c['raridade']), c['numero'])) or []
    return bool(donos) and donos[-1]['voce']


def _donos(c):
    item = _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': estoque._pk_copia(
        estoque.chave(c['id'], c['raridade']), c['numero'])}}, ConsistentRead=True).get('Item') or {}
    return item.get('donos', {}).get('L', [])


def _troca(troca_id):
    if not ID_TROCA.match(str(troca_id or '')):
        raise ErroDeConta('Troca não encontrada.', 404)
    item = _pegar('TROCA#' + troca_id)
    if not item:
        raise ErroDeConta('Troca não encontrada.', 404)
    return item


def _vencida(t, agora=None):
    return t['estado'] == 'aberta' and int(t['vence']) <= int((agora or _agora()).timestamp())


def _publica(t, eu_id):
    """O que o navegador vê de uma troca. Sem uid da outra pessoa além do id."""
    estado = 'vencida' if _vencida(t) else t['estado']
    sou = 'de' if t['de'] == eu_id else 'para'
    return {
        'id': t['id'],
        'estado': estado,
        'souEu': sou,
        'de': {'id': t['de'], 'handle': t['deHandle']},
        'para': {'id': t['para'], 'handle': t['paraHandle']},
        'quero': {k: t['quero'][k] for k in ('id', 'raridade') if k in t['quero']}
                 | ({'numero': int(t['quero']['numero'])} if t['quero'].get('numero') else {}),
        'opcoes': [{'id': o['id'], 'raridade': o['raridade'], 'numero': int(o['numero'])}
                   for o in t.get('opcoes') or []],
        'escolhida': None if t.get('escolhida') is None else int(t['escolhida']),
        'motivo': t.get('motivo') or '',
        'criada': t['criada'],
        'vence': _iso(datetime.fromtimestamp(int(t['vence']), timezone.utc)),
        'resolvida': t.get('resolvida') or '',
        'aplicada': eu_id in (t.get('aplicada') or ()),
    }


def _caixa(uid):
    item = _pegar('TROCAS#' + uid) or {}
    return set(item.get('ids') or ())


def _pondo_na_caixa(uid, troca_id):
    return {'Update': {
        'TableName': TABELA, 'Key': {'pk': {'S': 'TROCAS#' + uid}},
        'UpdateExpression': 'ADD ids :i', 'ExpressionAttributeValues': {':i': {'SS': [troca_id]}}}}


def listar(usuario):
    """GET /api/trocas — as trocas em que estou, mais novas primeiro."""
    eu = usuario['id']
    ids = _caixa(eu)
    achadas = pegar_varios(['TROCA#' + i for i in ids])
    agora = _agora()
    velhas, trocas = [], []
    for pk, t in achadas.items():
        fim = t.get('resolvida') or ''
        if t['estado'] != 'aberta' and fim and fim < _iso(agora - timedelta(days=GUARDAR_DIAS)):
            velhas.append(t['id'])
            continue
        trocas.append(t)
    sumidas = ids - {t['id'] for t in trocas} - set(velhas)
    velhas += [i for i in sumidas if 'TROCA#' + i not in achadas]
    if velhas:
        _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': 'TROCAS#' + eu}},
                            UpdateExpression='DELETE ids :i',
                            ExpressionAttributeValues={':i': {'SS': velhas}})
    trocas.sort(key=lambda t: t['criada'], reverse=True)
    return {'trocas': [_publica(t, eu) for t in trocas[:CAIXA_MAX]], 'porDia': POR_DIA}


# --- Propor -------------------------------------------------------------
def propor(usuario, corpo):
    """POST /api/trocas — {para, quero: {id, raridade}, opcoes: [cópias]}."""
    corpo = corpo if isinstance(corpo, dict) else {}
    eu = _conta(usuario['id'])
    outra = _conta(corpo.get('para'))
    if outra['id'] == eu['id']:
        raise ValueError('não dá para trocar com você mesma')
    if not _amigas(eu, outra):
        raise ErroDeConta('Só dá para trocar com amigos: vocês dois precisam se seguir.', 403)

    quero = corpo.get('quero') if isinstance(corpo.get('quero'), dict) else {}
    (qid, rar), = estoque._validar([quero])
    dela, minhas = _guarda_roupa(outra), _guarda_roupa(eu)
    if dela.get(qid) != rar:
        raise ValueError('essa peça não está mais no guarda-roupa dela')
    if qid in minhas:
        raise ValueError('você já tem essa peça')

    brutas = corpo.get('opcoes')
    if not isinstance(brutas, list) or not 0 < len(brutas) <= MAX_OPCOES:
        raise ValueError('escolha de 1 a %d peças para oferecer' % MAX_OPCOES)
    opcoes, vistas = [], set()
    for b in brutas:
        c = _copia(b, rar)
        if c['id'] in vistas or c['id'] == qid:
            raise ValueError('peça repetida na oferta')
        if c['id'] in dela:
            raise ValueError('ela já tem uma das peças que você ofereceu')
        if not _e_dona(usuario, c):
            raise ValueError('uma das peças oferecidas não é mais sua')
        vistas.add(c['id'])
        opcoes.append(c)

    # Ofertas abertas: as minhas enviadas e as que ela já recebeu.
    agora = _agora()
    abertas_minhas = [t for t in pegar_varios(['TROCA#' + i for i in _caixa(eu['id'])]).values()
                      if t['estado'] == 'aberta' and not _vencida(t, agora)]
    if sum(1 for t in abertas_minhas if t['de'] == eu['id']) >= ABERTAS_ENVIADAS:
        raise ValueError('você já tem %d ofertas esperando resposta' % ABERTAS_ENVIADAS)
    if any(t['de'] == eu['id'] and t['para'] == outra['id'] and t['quero']['id'] == qid
           for t in abertas_minhas):
        raise ValueError('você já ofereceu uma troca por essa peça')
    abertas_dela = [t for t in pegar_varios(['TROCA#' + i for i in _caixa(outra['id'])]).values()
                    if t['estado'] == 'aberta' and not _vencida(t, agora) and t['para'] == outra['id']]
    if len(abertas_dela) >= ABERTAS_RECEBIDAS:
        raise ValueError('ela já tem muitas ofertas para responder; tente mais tarde')

    troca_id = _novo_id()
    t = {
        'pk': 'TROCA#' + troca_id, 'id': troca_id,
        'de': eu['id'], 'deHandle': '@' + eu['handle'],
        'para': outra['id'], 'paraHandle': '@' + outra['handle'],
        'quero': {'id': qid, 'raridade': rar},
        'opcoes': [{k: c[k] for k in ('id', 'raridade', 'numero')} for c in opcoes],
        'estado': 'aberta', 'criada': _iso(agora),
        'vence': int((agora + timedelta(hours=VALIDADE_H)).timestamp()),
        # O TTL só faz a faxina, bem depois de a troca sair da caixa.
        'ttl': int((agora + timedelta(days=GUARDAR_DIAS + 30)).timestamp()),
    }
    put = _put(t)
    put['ConditionExpression'] = 'attribute_not_exists(pk)'
    _transacao([{'Put': put}, _pondo_na_caixa(eu['id'], troca_id),
                _pondo_na_caixa(outra['id'], troca_id)])
    return {'troca': _publica(t, eu['id'])}


# --- Responder ----------------------------------------------------------
def _fechar(t, estado, motivo=''):
    _dynamo.update_item(
        TableName=TABELA, Key={'pk': {'S': 'TROCA#' + t['id']}},
        UpdateExpression='SET estado = :e, motivo = :m, resolvida = :r',
        ConditionExpression='estado = :aberta',
        ExpressionAttributeValues={':e': {'S': estado}, ':m': {'S': motivo},
                                   ':r': {'S': _iso(_agora())}, ':aberta': {'S': 'aberta'}})


def _encerrar(t, estado, motivo=''):
    """Fecha a oferta e devolve como ela ficou (outra pessoa pode ter fechado antes)."""
    try:
        _fechar(t, estado, motivo)
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
    return _pegar('TROCA#' + t['id'])


def recusar(usuario, troca_id):
    t = _troca(troca_id)
    if t['para'] != usuario['id']:
        raise ErroDeConta('Só quem recebeu a oferta pode recusar.', 403)
    if t['estado'] == 'aberta':
        t = _encerrar(t, 'vencida' if _vencida(t) else 'recusada')
    return {'troca': _publica(t, usuario['id'])}


def cancelar(usuario, troca_id):
    t = _troca(troca_id)
    if t['de'] != usuario['id']:
        raise ErroDeConta('Só quem fez a oferta pode cancelar.', 403)
    if t['estado'] == 'aberta':
        t = _encerrar(t, 'vencida' if _vencida(t) else 'cancelada')
    return {'troca': _publica(t, usuario['id'])}


def _cota(uid, agora):
    ttl = int((agora + timedelta(days=3)).timestamp())
    return {'Update': {
        'TableName': TABELA, 'Key': {'pk': {'S': 'COTA#%s#%s' % (
            uid, agora.astimezone(estoque.BRASILIA).date().isoformat())}},
        'UpdateExpression': 'SET #tr = if_not_exists(#tr, :zero) + :um, #ttl = :ttl',
        'ConditionExpression': 'attribute_not_exists(#tr) OR #tr < :max',
        'ExpressionAttributeNames': {'#tr': 'trocas', '#ttl': 'ttl'},
        'ExpressionAttributeValues': {':zero': {'N': '0'}, ':um': {'N': '1'},
                                      ':max': {'N': str(POR_DIA)}, ':ttl': {'N': str(ttl)}}}}


def _passar(c, donos, para, agora):
    """Acrescenta a dona nova na cópia, se ninguém mexeu nela desde a leitura."""
    return {'Update': {
        'TableName': TABELA, 'Key': {'pk': {'S': estoque._pk_copia(
            estoque.chave(c['id'], c['raridade']), int(c['numero']))}},
        'UpdateExpression': 'SET donos = list_append(donos, :novo)',
        'ConditionExpression': 'size(donos) = :n',
        'ExpressionAttributeValues': {':novo': {'L': [estoque._dono(para, 'troca', _iso(agora))]},
                                      ':n': {'N': str(len(donos))}}}}


def aceitar(usuario, troca_id, corpo):
    """POST /api/trocas/<id>/aceitar — {escolhida: índice da opção,
    minha: {numero, origem?, desde?} (a cópia que eu dou)}."""
    corpo = corpo if isinstance(corpo, dict) else {}
    t = _troca(troca_id)
    if t['para'] != usuario['id']:
        raise ErroDeConta('Só quem recebeu a oferta pode aceitar.', 403)
    if t['estado'] != 'aberta':
        return {'troca': _publica(t, usuario['id'])}
    if _vencida(t):
        return {'troca': _publica(_encerrar(t, 'vencida'), usuario['id'])}
    try:
        escolhida = int(corpo.get('escolhida'))
    except (TypeError, ValueError):
        raise ValueError('escolha uma das peças oferecidas')
    opcoes = t.get('opcoes') or []
    if not 0 <= escolhida < len(opcoes):
        raise ValueError('escolha uma das peças oferecidas')

    minha = dict(corpo.get('minha') if isinstance(corpo.get('minha'), dict) else {})
    minha.update(id=t['quero']['id'], raridade=t['quero']['raridade'])
    minha = _copia(minha, t['quero']['raridade'])
    if not _e_dona(usuario, minha):
        t = _encerrar(t, 'invalida', 'a peça pedida não está mais com você')
        return {'troca': _publica(t, usuario['id'])}

    outra = _conta(t['de'])
    eu = _conta(usuario['id'])
    if not _amigas(eu, outra):
        t = _encerrar(t, 'invalida', 'vocês não são mais amigos')
        return {'troca': _publica(t, usuario['id'])}

    dela = {k: opcoes[escolhida][k] for k in ('id', 'raridade', 'numero')}
    donos_dela, donos_meus = _donos(dela), _donos(minha)
    ultimo = lambda donos: donos[-1]['M']['uid']['S'] if donos else ''
    if ultimo(donos_dela) != outra['id']:
        t = _encerrar(t, 'invalida', 'a peça oferecida já foi para outra pessoa')
        return {'troca': _publica(t, usuario['id'])}
    if ultimo(donos_meus) != eu['id']:
        t = _encerrar(t, 'invalida', 'a peça pedida não está mais com você')
        return {'troca': _publica(t, usuario['id'])}

    agora = _agora()
    a_dela = {'id': outra['id'], 'handle': '@' + outra['handle']}
    a_minha = {'id': eu['id'], 'handle': '@' + eu['handle']}
    falhou = _transacao([
        {'Update': {
            'TableName': TABELA, 'Key': {'pk': {'S': 'TROCA#' + t['id']}},
            'UpdateExpression': 'SET estado = :feita, escolhida = :i, quero.numero = :n, '
                                'resolvida = :r',
            'ConditionExpression': 'estado = :aberta AND vence > :agora',
            'ExpressionAttributeValues': {
                ':feita': {'S': 'feita'}, ':aberta': {'S': 'aberta'},
                ':i': {'N': str(escolhida)}, ':n': {'N': str(minha['numero'])},
                ':r': {'S': _iso(agora)}, ':agora': {'N': str(int(agora.timestamp()))}}}},
        _passar(minha, donos_meus, a_dela, agora),     # a minha vai para ela
        _passar(dela, donos_dela, a_minha, agora),     # a dela vem para mim
        _cota(outra['id'], agora),
        _cota(eu['id'], agora),
    ])
    if falhou is None:
        return {'troca': _publica(_pegar('TROCA#' + t['id']), usuario['id'])}
    if falhou == 0:
        return {'troca': _publica(_pegar('TROCA#' + t['id']), usuario['id'])}
    if falhou in (1, 2):
        t = _encerrar(t, 'invalida', 'uma das peças mudou de dono')
        return {'troca': _publica(t, usuario['id'])}
    if falhou == 3:
        raise ValueError('%s já fez as %d trocas de hoje; aceite amanhã' % (t['deHandle'], POR_DIA))
    raise ValueError('você já fez as %d trocas de hoje; aceite amanhã' % POR_DIA)


def aplicada(usuario, troca_id):
    """POST /api/trocas/<id>/aplicada — o meu save já pôs e tirou as peças
    (ou devolveu as fichas): a troca não volta como pendente."""
    t = _troca(troca_id)
    if usuario['id'] not in (t['de'], t['para']):
        raise ErroDeConta('Troca não encontrada.', 404)
    _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': 'TROCA#' + t['id']}},
                        UpdateExpression='ADD aplicada :u',
                        ExpressionAttributeValues={':u': {'SS': [usuario['id']]}})
    return {'ok': True}
