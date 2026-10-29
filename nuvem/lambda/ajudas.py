# -*- coding: utf-8 -*-
"""
Mini games de ajuda: os jogadores ajudam a cadastrar as peças do acervo.

Três jogos, um por tarefa do cadastro:

    avaliar    a peça aparece e a pessoa arrasta para um lado (gostei / não
               gostei) ou aperta "tanto faz". A média dos votos vira a raridade sugerida.
    ajustar    a pessoa encaixa a peça no corpo (posição e tamanho). A mediana
               das medidas vira o ajuste sugerido.
    preencher  a pessoa diz a cor e a marca. A resposta mais votada vence.
               Marca deixada em branco conta como "sem marca".

Cada jogo paga fichas a cada `porFicha` ajudas e tem um teto de ajudas por
janela (dia ou hora, no horário de Brasília). As fichas moram no save (o
navegador soma o que esta resposta disser); a contagem e o teto moram aqui,
senão bastava chamar a rota em loop.

Itens do DynamoDB:

    AJUDA#COTA#<uid>#<jogo>#<janela>   n (ajudas na janela), ttl
    AJUDA#FEITAS#<uid>#<jogo>[#r<rodada>] ids (peças em que a pessoa já ajudou)
    AJUDA#PECA#<id>                    "r<rodada>:sim|nao|meh", ajustes [{x,y,w}],
                                       "cor:<valor>", "marca:<valor>" (votos)

**As peças vêm da esteira.** O admin escolhe (Admin › Mini games) quais
fotos da esteira entram nos jogos: a prévia, que mora no bucket privado, é
copiada para o site (`assets/jogos/<id>.webp`) e a lista pública fica em
`assets/jogos.json`. Ao publicar a peça (ou descartar), ela sai dos jogos.
Nada mexe na ficha sozinho: o admin vê o resumo (GET /api/admin/ajudas) e
leva para a ficha da esteira o que quiser.

**Peça pronta** é a que já tem resposta firme nas cinco entradas: raridade,
ajuste, tipo, cor e marca (`pendencias`). Entrada que fechou sai do jogo: a
peça para de aparecer no Avaliar ou no Ajustar, e o Preencher só pergunta o
que falta (voto em entrada fechada nem é gravado).

**Os números ficam todos em JOGOS, VOTOS_MIN, AJUSTES_MIN, ESCOLHA_MIN,
ESCOLHA_DESEMPATE, MARCA_IGUAIS e FAIXAS logo abaixo** — são as regras do
jogo, quem decide é o João.
"""

import json
import os
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import boto3
from botocore.exceptions import ClientError

TABELA = os.environ.get('BD_TABELA') or 'brecho'
SITE = os.environ.get('BD_BUCKET_SITE') or ''
DADOS = os.environ.get('BD_BUCKET_DADOS') or ''
LISTA = 'assets/jogos.json'
_dynamo = boto3.client('dynamodb')
_s3 = boto3.client('s3')
_cache = {'ids': None, 'em': 0}
_grupo = ThreadPoolExecutor(max_workers=10)   # o pool de conexões do boto3 é de 10
BRASILIA = timezone(timedelta(hours=-3))

# ----------------------------- Regras (João) ------------------------------
# porFicha: quantas ajudas valem 1 ficha. limite: ajudas por janela.
# janela: 'dia' ou 'hora' (Brasília).
JOGOS = {
    'avaliar':   {'porFicha': 5, 'limite': 25, 'janela': 'dia'},
    'ajustar':   {'porFicha': 4, 'limite': 16, 'janela': 'dia'},
    'preencher': {'porFicha': 4, 'limite': 20, 'janela': 'dia'},
}
# Teto de fichas por dia somando os três jogos (João, 29/10/2026).
TETO_FICHAS_DIA = 5
# Votos que a peça precisa antes de ganhar raridade sugerida.
VOTOS_MIN = 10
# Medidas do Ajustar para a mediana valer.
AJUSTES_MIN = 3
# Tipo e cor: com ESCOLHA_MIN respostas todas iguais, fecha. Se dividiu, espera
# chegar a ESCOLHA_DESEMPATE e a mais votada leva (empate segue esperando).
ESCOLHA_MIN = 3
ESCOLHA_DESEMPATE = 5
# Marca: basta esta quantidade de respostas iguais.
MARCA_IGUAIS = 2
# Rodada do Avaliar: subir este número zera todos os votos (os antigos ficam
# no banco, mas ninguém lê) e deixa todo mundo votar de novo em todas as peças.
RODADA_AVALIAR = 2
# "Tanto faz" conta como meio "gostei".
# % de "gostei" a partir da qual a peça entra em cada raridade (de cima para baixo).
FAIXAS = [(85, 'legendary'), (65, 'epic'), (50, 'rare'), (40, 'uncommon'), (0, 'common')]
# ---------------------------------------------------------------------------

ID_OK = re.compile(r'^e[a-z0-9]{8,24}$')     # o id da esteira
CAT_OK = re.compile(r'^[a-z][a-z-]{1,20}$')     # id da categoria (config.js)
TEXTO_OK = re.compile(r'[^a-z0-9 &\'.-]+')
MAX_AJUSTES = 60      # medidas guardadas por peça (a mediana não precisa de mais)


# --------------------------- Peças nos jogos -------------------------------
def ler_lista():
    try:
        r = _s3.get_object(Bucket=SITE, Key=LISTA)
        return json.loads(r['Body'].read()).get('items') or []
    except ClientError as e:
        # Sem s3:ListBucket, arquivo que não existe chega como AccessDenied.
        if e.response['Error']['Code'] in ('NoSuchKey', '404', 'AccessDenied'):
            return []
        raise


def _gravar_lista(itens):
    _s3.put_object(Bucket=SITE, Key=LISTA, ContentType='application/json; charset=utf-8',
                   CacheControl='no-cache',
                   Body=json.dumps({'items': itens}, ensure_ascii=False).encode('utf-8'))
    _cache['ids'] = None


def _ids_nos_jogos():
    if _cache['ids'] is None or time.time() - _cache['em'] > 60:
        _cache['ids'], _cache['em'] = {i['id'] for i in ler_lista()}, time.time()
    return _cache['ids']


def colocar(item_id, dados):
    """Põe uma foto da esteira nos jogos. `dados` é a ficha da esteira."""
    if dados.get('estado') != 'pronta' or not dados.get('previa'):
        raise ValueError('essa foto ainda não está pronta')
    ficha, palpite = dados.get('ficha') or {}, dados.get('sugestao') or {}
    # Sem categoria também vai: o Avaliar e o Preencher não precisam dela (o
    # Preencher pergunta o tipo); só o Ajustar espera a categoria aparecer.
    cat = ficha.get('cat') or palpite.get('cat') or ''
    chave = 'assets/jogos/%s.webp' % item_id
    _s3.copy_object(Bucket=SITE, Key=chave, CopySource={'Bucket': DADOS, 'Key': dados['previa']},
                    ContentType='image/webp', MetadataDirective='REPLACE',
                    CacheControl='public, max-age=31536000, immutable')
    itens = [i for i in ler_lista() if i['id'] != item_id]
    itens.append({'id': item_id, 'src': chave, 'w': dados.get('w'), 'h': dados.get('h'),
                  'cat': cat, 'nome': ficha.get('nome') or '',
                  'criadoEm': dados.get('criadoEm') or ''})
    _gravar_lista(itens)
    return {'items': itens}


def atualizar(item_id, dados):
    """A ficha mudou na esteira: a categoria e o nome dos jogos acompanham."""
    if item_id not in _ids_nos_jogos():
        return
    ficha, palpite = dados.get('ficha') or {}, dados.get('sugestao') or {}
    cat, nome = ficha.get('cat') or palpite.get('cat') or '', ficha.get('nome') or ''
    itens = ler_lista()
    mudou = False
    for i in itens:
        if i['id'] == item_id and (i.get('cat') != cat or i.get('nome') != nome):
            i.update(cat=cat, nome=nome)
            mudou = True
    if mudou:
        _gravar_lista(itens)


def tirar(item_id):
    """Tira dos jogos (o voto que já foi dado continua guardado)."""
    itens = ler_lista()
    resto = [i for i in itens if i['id'] != item_id]
    if len(resto) != len(itens):
        _gravar_lista(resto)
        _s3.delete_object(Bucket=SITE, Key='assets/jogos/%s.webp' % item_id)
    return {'items': resto}


def _janela(jogo, agora=None):
    agora = agora or datetime.now(BRASILIA)
    if JOGOS[jogo]['janela'] == 'hora':
        return agora.strftime('%Y-%m-%dT%H'), agora.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    return agora.date().isoformat(), (agora + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


def _pk_cota(uid, jogo):
    return 'AJUDA#COTA#%s#%s#%s' % (uid, jogo, _janela(jogo)[0])


def _pk_feitas(uid, jogo):
    if jogo == 'avaliar':
        return 'AJUDA#FEITAS#%s#avaliar#r%d' % (uid, RODADA_AVALIAR)
    return 'AJUDA#FEITAS#%s#%s' % (uid, jogo)


def _campo_voto(voto):
    return 'r%d:%s' % (RODADA_AVALIAR, voto)


def _pk_peca(pid):
    return 'AJUDA#PECA#%s' % pid


def _texto(valor, limite):
    """Cor e marca viram uma forma só ('Nike ', 'nike' e 'NIKÉ' são um voto)."""
    t = unicodedata.normalize('NFD', str(valor or '')).encode('ascii', 'ignore').decode()
    t = TEXTO_OK.sub('', t.lower()).strip()
    return re.sub(r'\s+', ' ', t)[:limite]


def _numero(valor, minimo, maximo):
    try:
        n = float(valor)
    except (TypeError, ValueError):
        raise ValueError('medida inválida')
    if n != n or n < minimo or n > maximo:
        raise ValueError('medida fora do palco')
    return round(n, 1)


def _validar(jogo, corpo):
    if jogo not in JOGOS:
        raise ValueError('jogo desconhecido')
    pid = str(corpo.get('peca') or '').strip().lower()
    if not ID_OK.match(pid) or pid not in _ids_nos_jogos():
        raise ValueError('peça desconhecida')
    if jogo == 'avaliar':
        voto = corpo.get('voto')
        if voto is None and isinstance(corpo.get('gostei'), bool):
            voto = 'sim' if corpo['gostei'] else 'nao'
        if voto not in ('sim', 'meh', 'nao'):
            raise ValueError('voto inválido')
        return pid, {'voto': voto}
    if jogo == 'ajustar':
        a = corpo.get('ancora') or {}
        return pid, {'x': _numero(a.get('x'), 0, 600), 'y': _numero(a.get('y'), 0, 1200),
                     'w': _numero(a.get('w'), 10, 700), 'rot': _numero(a.get('rot', 0), -45, 45)}
    cor, marca = _texto(corpo.get('cor'), 24), _texto(corpo.get('marca'), 40)
    cat = str(corpo.get('cat') or '').strip().lower()
    cat = cat if CAT_OK.match(cat) else ''
    if not cor and not marca and not cat:
        raise ValueError('diga o tipo, a cor ou a marca')
    return pid, {'cat': cat, 'cor': cor, 'marca': marca}


def _contar(uid, jogo):
    """Soma 1 na cota da janela. Devolve o total novo, ou None se acabou."""
    _, vira = _janela(jogo)
    try:
        r = _dynamo.update_item(
            TableName=TABELA, Key={'pk': {'S': _pk_cota(uid, jogo)}},
            UpdateExpression='SET n = if_not_exists(n, :zero) + :um, #ttl = :ttl',
            ConditionExpression='attribute_not_exists(n) OR n < :lim',
            ExpressionAttributeNames={'#ttl': 'ttl'},
            ExpressionAttributeValues={
                ':um': {'N': '1'}, ':zero': {'N': '0'},
                ':lim': {'N': str(JOGOS[jogo]['limite'])},
                ':ttl': {'N': str(int((vira + timedelta(days=2)).timestamp()))}},
            ReturnValues='UPDATED_NEW')
        return int(r['Attributes']['n']['N'])
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        return None


def _descontar(uid, jogo):
    _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': _pk_cota(uid, jogo)}},
                        UpdateExpression='SET n = n - :um',
                        ConditionExpression='n > :zero',
                        ExpressionAttributeValues={':um': {'N': '1'}, ':zero': {'N': '0'}})


def _marcar_feita(uid, jogo, pid):
    """False se a pessoa já ajudou nesta peça neste jogo."""
    try:
        _dynamo.update_item(
            TableName=TABELA, Key={'pk': {'S': _pk_feitas(uid, jogo)}},
            UpdateExpression='ADD ids :id',
            ConditionExpression='attribute_not_exists(ids) OR NOT contains(ids, :um)',
            ExpressionAttributeValues={':id': {'SS': [pid]}, ':um': {'S': pid}})
        return True
    except ClientError as e:
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
        return False


def _anotar(jogo, pid, dados):
    chave = {'pk': {'S': _pk_peca(pid)}}
    um = {':um': {'N': '1'}}
    if jogo == 'avaliar':
        _dynamo.update_item(TableName=TABELA, Key=chave,
                            UpdateExpression='ADD #v :um',
                            ExpressionAttributeNames={'#v': _campo_voto(dados['voto'])},
                            ExpressionAttributeValues=um)
    elif jogo == 'ajustar':
        medida = {'M': {k: {'N': str(v)} for k, v in dados.items()}}
        _dynamo.update_item(TableName=TABELA, Key=chave,
                            UpdateExpression='SET ajustes = list_append(if_not_exists(ajustes, :nada), :nova)',
                            ConditionExpression='attribute_not_exists(ajustes) OR size(ajustes) < :max',
                            ExpressionAttributeValues={':nada': {'L': []}, ':nova': {'L': [medida]},
                                                       ':max': {'N': str(MAX_AJUSTES)}})
    else:
        # Entrada que já fechou não recebe voto: a resposta não muda depois de pronta.
        atual = _dynamo.get_item(TableName=TABELA, Key=chave).get('Item')
        fechadas = set(ENTRADAS) - set(pendencias(atual))
        nomes = {}
        partes = []
        for i, campo in enumerate(('cat', 'cor', 'marca')):
            # Marca em branco é resposta também: "sem marca" (o voto 'marca:').
            if (dados[campo] or campo == 'marca') and campo not in fechadas:
                nomes['#c%d' % i] = '%s:%s' % (campo, dados[campo])
                partes.append('#c%d :um' % i)
        if not partes:
            return
        _dynamo.update_item(TableName=TABELA, Key=chave,
                            UpdateExpression='ADD ' + ', '.join(partes),
                            ExpressionAttributeNames=nomes, ExpressionAttributeValues=um)


def _situacao(uid, jogo, n=None):
    regra = JOGOS[jogo]
    if n is None:
        r = _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': _pk_cota(uid, jogo)}})
        n = int((r.get('Item') or {}).get('n', {}).get('N', 0))
    return {'feitas': n, 'limite': regra['limite'], 'porFicha': regra['porFicha'],
            'janela': regra['janela'], 'vira': _janela(jogo)[1].isoformat()}


def _fichas_hoje(uid):
    """Fichas que as cotas de hoje já valem, somando os jogos."""
    total = 0
    for jogo, regra in JOGOS.items():
        r = _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': _pk_cota(uid, jogo)}})
        total += int((r.get('Item') or {}).get('n', {}).get('N', 0)) // regra['porFicha']
    return total


def estado(usuario):
    """O que a tela precisa: a cota de cada jogo e as peças já ajudadas."""
    uid = usuario['id']
    saida = {}
    teto = {'fichasHoje': min(_fichas_hoje(uid), TETO_FICHAS_DIA), 'tetoDia': TETO_FICHAS_DIA}
    for jogo in JOGOS:
        r = _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': _pk_feitas(uid, jogo)}})
        saida[jogo] = {**_situacao(uid, jogo), **teto,
                       'pecas': sorted((r.get('Item') or {}).get('ids', {}).get('SS', []))}
    itens = ler_lista()
    # O que falta em cada peça: o jogo pula a peça (ou a pergunta) que já fechou.
    lidas = _ler_pecas({i['id'] for i in itens})
    return {'jogos': saida, 'itens': itens,
            'faltam': {i['id']: pendencias(lidas.get(i['id'])) for i in itens}}


def ajudar(usuario, jogo, corpo):
    """Grava uma ajuda. Devolve a cota nova e quantas fichas ela pagou."""
    pid, dados = _validar(jogo, corpo or {})
    uid = usuario['id']
    # Passou do limite a pessoa continua ajudando; só não ganha mais ficha.
    n = _contar(uid, jogo)
    if not _marcar_feita(uid, jogo, pid):
        if n is not None:
            _descontar(uid, jogo)
        return {'ok': False, 'motivo': 'repetida', **_situacao(uid, jogo)}
    try:
        _anotar(jogo, pid, dados)
    except ClientError as e:
        # Peça com medidas de sobra: a ajuda conta, a medida não entra.
        if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
            raise
    if n is None:
        return {'ok': True, 'fichas': 0, 'semPremio': True, **_situacao(uid, jogo)}
    fichas = 1 if n % JOGOS[jogo]['porFicha'] == 0 else 0
    hoje = _fichas_hoje(uid)
    teto = {'fichasHoje': min(hoje, TETO_FICHAS_DIA), 'tetoDia': TETO_FICHAS_DIA}
    # Bateu o teto do dia somando os jogos: a ajuda conta, a ficha não vem.
    if fichas and hoje > TETO_FICHAS_DIA:
        return {'ok': True, 'fichas': 0, 'semPremio': True, **_situacao(uid, jogo, n), **teto}
    return {'ok': True, 'fichas': fichas, **_situacao(uid, jogo, n), **teto}


# ------------------------------- Resumo -----------------------------------
def _pct(sim, nao, meh=0):
    total = sim + nao + meh
    return (sim + meh / 2) * 100 / total if total else None


def raridade_sugerida(sim, nao, meh=0):
    if sim + nao + meh < VOTOS_MIN:
        return None
    pct = _pct(sim, nao, meh)
    return next(r for corte, r in FAIXAS if pct >= corte)


def _mediana(valores):
    v = sorted(valores)
    m = len(v) // 2
    return v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2


def _mais_votado(item, campo):
    votos = [(int(v['N']), k.split(':', 1)[1]) for k, v in item.items()
             if k.startswith(campo + ':')]
    if not votos:
        return None
    n, valor = max(votos)
    total = sum(x for x, _ in votos)
    return {'valor': valor, 'votos': n, 'total': total,
            'pronto': _decidido(campo, [x for x, _ in votos], total)}


def _decidido(campo, contagens, total):
    """A resposta mais votada já vale? `contagens` é quantos votos tem cada valor."""
    maior = max(contagens, default=0)
    if campo == 'marca':
        return maior >= MARCA_IGUAIS
    if total >= ESCOLHA_MIN and len(contagens) == 1:
        return True
    return total >= ESCOLHA_DESEMPATE and contagens.count(maior) == 1


def resumo_da_peca(item):
    sim, nao, meh = (int(item.get(_campo_voto(v), {}).get('N', 0)) for v in ('sim', 'nao', 'meh'))
    ajustes = [{k: float(v['N']) for k, v in a['M'].items()}
               for a in item.get('ajustes', {}).get('L', [])]
    return {
        'peca': item['pk']['S'][len('AJUDA#PECA#'):],
        'votos': {'sim': sim, 'nao': nao, 'meh': meh,
                  'pct': round(_pct(sim, nao, meh)) if sim + nao + meh else None,
                  'raridade': raridade_sugerida(sim, nao, meh)},
        # Medida antiga não tem 'rot': conta como sem giro.
        'ajuste': ({k: round(_mediana([a.get(k, 0) for a in ajustes]), 1) for k in ('x', 'y', 'w', 'rot')}
                   | {'medidas': len(ajustes)}) if ajustes else None,
        'cor': _mais_votado(item, 'cor'),
        'marca': _mais_votado(item, 'marca'),
        'cat': _mais_votado(item, 'cat'),
        'faltam': pendencias(item),
    }


ENTRADAS = ('raridade', 'ajuste', 'cat', 'cor', 'marca')


def pendencias(item):
    """As entradas que ainda não fecharam. Vazio quer dizer peça pronta."""
    item = item or {}
    votos = sum(int(item.get(_campo_voto(v), {}).get('N', 0)) for v in ('sim', 'nao', 'meh'))
    feito = {
        'raridade': votos >= VOTOS_MIN,
        'ajuste': len(item.get('ajustes', {}).get('L', [])) >= AJUSTES_MIN,
    }
    for campo in ('cat', 'cor', 'marca'):
        feito[campo] = bool((_mais_votado(item, campo) or {}).get('pronto'))
    return [e for e in ENTRADAS if not feito[e]]


def _ler_pecas(ids):
    """{id: item AJUDA#PECA#} das peças que já receberam ajuda. GetItem em
    paralelo, como contas.pegar_varios: o papel da Lambda não tem BatchGetItem."""
    def ler(pid):
        return pid, _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': _pk_peca(pid)}}).get('Item')
    return {pid: item for pid, item in _grupo.map(ler, sorted(ids)) if item}


def _somar_cota(cotas, item):
    """AJUDA#COTA#<uid>#<jogo>#<janela>: a contagem de uma pessoa num dia."""
    _, jogo, janela = item['pk']['S'].rsplit('#', 2)
    if jogo not in JOGOS:
        return
    n = int(item.get('n', {}).get('N', 0))
    regra = JOGOS[jogo]
    dia = cotas.setdefault(jogo, {}).setdefault(janela, {'pessoas': 0, 'ajudas': 0,
                                                         'fichas': 0, 'noLimite': 0})
    dia['pessoas'] += 1
    dia['ajudas'] += n
    dia['fichas'] += n // regra['porFicha']
    dia['noLimite'] += 1 if n >= regra['limite'] else 0


def resumo():
    """Tudo o que os jogadores disseram, peça a peça (só o admin vê), e as
    cotas dos últimos dias (o ttl apaga as cotas dois dias depois)."""
    pecas, cotas, inicio = [], {}, None
    while True:
        args = {'TableName': TABELA, 'FilterExpression': 'begins_with(pk, :p) OR begins_with(pk, :c)',
                'ExpressionAttributeValues': {':p': {'S': 'AJUDA#PECA#'}, ':c': {'S': 'AJUDA#COTA#'}}}
        if inicio:
            args['ExclusiveStartKey'] = inicio
        r = _dynamo.scan(**args)
        for i in r.get('Items', []):
            if i['pk']['S'].startswith('AJUDA#PECA#'):
                pecas.append(resumo_da_peca(i))
            else:
                _somar_cota(cotas, i)
        inicio = r.get('LastEvaluatedKey')
        if not inicio:
            break
    return {'pecas': pecas, 'cotas': cotas, 'nosJogos': sorted(_ids_nos_jogos()),
            'regras': {'jogos': JOGOS, 'votosMin': VOTOS_MIN, 'faixas': FAIXAS,
                       'ajustesMin': AJUSTES_MIN, 'escolhaMin': ESCOLHA_MIN,
                       'escolhaDesempate': ESCOLHA_DESEMPATE, 'marcaIguais': MARCA_IGUAIS}}
