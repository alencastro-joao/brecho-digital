# -*- coding: utf-8 -*-
"""
O gerador de posts: os perfis de exemplo postando no feed compartilhado.

Até aqui os perfis de exemplo (PERFIS_MOCK em App/js/config.js) só existiam no
navegador de cada um: o feed "nascia povoado" com doze posts sorteados no save,
cada conta via os seus, e uma curtida num deles não chegava a ninguém. Agora
quem posta por eles é a nuvem, no mesmo feed das contas de verdade:

* **De tempos em tempos.** A cada INTERVALO_HORAS (3) sai uma rodada: quem
  dá a hora é a leitura do feed (em_dia, no fim deste arquivo), e o EventBridge
  Scheduler, se ligado (nuvem/infra/gerador.yaml), só adianta. Cada rodada publica um post — às vezes dois —, e de madrugada
  (horário de Brasília) quase sempre nenhum: o feed respira como gente.

* **O post guarda o que ele é, não a imagem.** Quem posta escolhe as peças
  (o mesmo critério de `sortearConjunto` em App/js/sorteio.js, portado abaixo)
  e uma semente; a tela desenha o look no personagem de quem postou, ou monta
  a colagem com aquela semente (social.js, `prepararGerado`). Sem Pillow aqui,
  sem miniatura no bucket, e o look acompanha o personagem como os posts das
  contas de verdade.

* **O post não fica parado.** Cada rodada também mexe nos posts gerados dos
  últimos dias: chegam curtidas dos outros perfis, de vez em quando um
  comentário (alguns falam da peça do post pelo nome), e quem postou às vezes
  responde. Nada disso toca post de conta de verdade.

* **Teto.** Ficam no máximo MAX_GERADOS posts gerados; os mais velhos saem.
  Assim o feed não vira só exemplo e a varredura do feed continua pequena.

O administrador também pode pedir posts na hora (o botão de teste do perfil):
`POST /api/feed/gerar { quantos }`.
"""

import json
import os
import random
from datetime import datetime, timedelta

import boto3
from botocore.exceptions import ClientError

import feed
from contas import TABELA, _dynamo, agora, iso

BUCKET_SITE = os.environ.get('BD_BUCKET_SITE') or ''
_s3 = boto3.client('s3')

INTERVALO_HORAS = 3             # de quanto em quanto tempo sai uma rodada (em_dia)
ATRASO_MAX = 8                  # rodadas perdidas que ainda são repostas
MAX_GERADOS = 80                # posts dos perfis de exemplo que ficam no feed
ANIMAR_HORAS = 72               # até que idade um post ainda ganha curtida e conversa
QUANTOS_MAX = 12                # o que o admin pode pedir de uma vez

# Espelho de PERFIS_MOCK (App/js/config.js): só o id e o @, que é o que o
# servidor precisa — o resto do perfil a tela tira da semente do id.
PERFIS = [
    ('u-lia', '@liamoreno'), ('u-tom', '@tomarruda'), ('u-nina', '@ninacard'),
    ('u-rafa', '@rafapinto'), ('u-bia', '@biasalles'), ('u-duda', '@dudarocha'),
    ('u-jo', '@jovasques'), ('u-vic', '@vicandrade'), ('u-ian', '@ianprado'),
    ('u-mel', '@melfontes'), ('u-caio', '@caiobastos'), ('u-sol', '@solferraz'),
    ('u-theo', '@theolacerda'), ('u-ana', '@anaquintela'), ('u-pedro', '@pedrosanches'),
    ('u-lu', '@luteixeira'), ('u-gabi', '@gabinaka'), ('u-enzo', '@enzoribeiro'),
    ('u-clara', '@clarabit'), ('u-noah', '@noahestrela'), ('u-tata', '@tatamenezes'),
    ('u-rui', '@ruicoutinho'), ('u-isa', '@isameirelles'), ('u-bento', '@bentoalencar'),
    ('u-kika', '@kikaandrada'), ('u-davi', '@davipeixoto'), ('u-yumi', '@yumiwatanabe'),
    ('u-leo', '@leomaranhao'), ('u-fran', '@frandelgado'), ('u-zeca', '@zecaportela'),
    ('u-maya', '@mayacavalcanti'), ('u-otto', '@ottovilela'),
]
IDS = [p[0] for p in PERFIS]
HANDLE = dict(PERFIS)

# A cápsula do mês é conquistada, não sorteada (COLLAB.itens em config.js).
COLLAB = {'41', '46', '51', '54', '57'}
# Categorias de antes (CATEGORIAS_ANTIGAS em config.js, CATS_ANTIGAS em acervo.py).
CATS_ANTIGAS = {'tops': 'shirts', 'acc': 'glasses', 'rings': 'bracelets'}

CHANCE_COLAGEM = 0.4

NOMES_LOOK = [
    'tarde de sábado', 'camadas', 'saída rápida', 'cápsula pessoal',
    'preto no preto', 'garimpo da semana', 'segunda difícil', 'sem esforço',
    'prova de rua', 'arquivo 02', 'clima seco', 'volta pra casa',
    'feira de domingo', 'chuva fina', 'reunião às 9', 'show à noite',
    'bota primeiro, resto depois', 'look de aeroporto', 'sessão das 22h',
    'herdado e ajustado', 'quinta sem pressa', 'frio de mentira',
    'tudo do mesmo brechó', 'teste de cor', 'o de sempre, só que não',
    'saída pro bar', 'uniforme da semana', 'arquivo 07', 'primeiro sol',
]
NOMES_COLAGEM = [
    'moodboard de domingo', 'paleta da semana', 'colagem 03', 'referências',
    'mala pra viagem', 'o que eu levaria', 'garimpo em pedaços',
    'estudo de silhueta', 'tons de terra', 'arquivo de inverno',
    'tudo que achei hoje', 'quadro de ideias', 'só peças pesadas',
]

COMENTARIOS = [
    'essa bota mudou tudo', 'preciso saber de onde é a saia', 'combinação absurda',
    'roubei a ideia, avisando', 'a cor do casaco 👏', 'isso é muito você',
    'tô usando isso amanhã', 'onde garimpou essa peça?', 'o acessório fez o look',
    'nunca teria pensado nessa mistura', 'clean e pesado ao mesmo tempo, gostei',
    'salvando pra referência', 'perfeito pro inverno', 'esse é o melhor que você postou',
    'que proporção boa', 'eu usaria exatamente assim', 'me empresta?',
    'as cores conversando demais', 'look de quem sabe o que tá fazendo',
    'isso aqui é arquivo', 'tá pronto pra sair', 'quero o guarda-roupa inteiro',
    'simples e certeiro', 'sem defeito', '🔥🔥', '👀', 'ícone',
]
# Comentário que cita uma peça do post pelo nome — é o que faz parecer que
# alguém olhou de verdade.
COMENTARIOS_PECA = [
    '{peca} 👏', 'onde você achou {peca}?', '{peca} roubou a cena',
    'preciso de {peca} na minha vida', '{peca} com o resto ficou muito bom',
    'não imaginava {peca} assim', 'tô de olho em {peca} desde ontem',
]
RESPOSTAS = [
    'valeu!! 🖤', 'valeu demais', 'garimpo de sorte', 'pode roubar haha',
    'achei na vitrine do brechó', 'tmj!', 'demorei pra montar esse',
    'é tudo do acervo daqui', '🫶',
]


# --- O acervo -------------------------------------------------------------
def ler_acervo():
    """As peças que dá para vestir: o acervo.json do site, sem a cápsula."""
    corpo = _s3.get_object(Bucket=BUCKET_SITE, Key='assets/acervo.json')['Body'].read()
    dados = json.loads(corpo)
    removidas = set(dados.get('removidas') or [])
    pecas = []
    for item in dados.get('items') or []:
        pid = str(item.get('id') or '')
        if not pid or pid in COLLAB or pid in removidas:
            continue
        cat = CATS_ANTIGAS.get(item.get('cat'), item.get('cat'))
        pecas.append({'id': pid, 'cat': cat, 'nome': item.get('nome') or ''})
    return pecas


# Espelho de sortearConjunto (App/js/sorteio.js): vestido OU parte de cima +
# parte de baixo, um sapato e alguns acessórios por chance. Mexeu num, mexa no
# outro.
CHANCES = [('hats', 0.55), ('bags', 0.5), ('coats', 0.35), ('glasses', 0.4),
           ('necklaces', 0.3), ('watches', 0.25), ('bracelets', 0.2)]
CIMA = ('shirts', 'cropped', 'coats')
BAIXO = ('pants', 'shorts', 'skirts')
TRONCO = CIMA + ('dresses',)


def sortear_conjunto(acervo, rnd, minimo=5):
    def por(cats):
        cats = (cats,) if isinstance(cats, str) else cats
        return [p for p in acervo if p['cat'] in cats]

    def um(cats):
        lista = por(cats)
        return rnd.choice(lista) if lista else None

    escolhidas = []
    tem_vestido = bool(por('dresses'))
    tem_conjunto = bool(por(CIMA)) and bool(por(BAIXO))
    if tem_vestido and (not tem_conjunto or rnd.random() < 0.4):
        escolhidas.append(um('dresses'))
    else:
        sem_casaco = por(('shirts', 'cropped'))
        com_casaco = bool(por('coats')) and (not sem_casaco or rnd.random() < 0.35)
        escolhidas.append(um('coats' if com_casaco else ('shirts', 'cropped')))
        escolhidas.append(um(BAIXO))
    escolhidas.append(um('shoes'))
    for cat, chance in CHANCES:
        if cat != 'coats' and rnd.random() < chance:
            escolhidas.append(um(cat))

    lista = [p for p in escolhidas if p]
    if len(lista) < minimo:
        sobra = acervo[:]
        rnd.shuffle(sobra)
        for p in sobra:
            if len(lista) >= minimo:
                break
            usadas = {q['cat'] for q in lista}
            cobre_tronco = any(c in usadas for c in TRONCO)
            cobre_perna = any(c in usadas for c in BAIXO) or 'dresses' in usadas
            if any(q['id'] == p['id'] for q in lista) or p['cat'] in usadas:
                continue
            if cobre_tronco and p['cat'] in TRONCO:
                continue
            if cobre_perna and (p['cat'] in BAIXO or p['cat'] == 'dresses'):
                continue
            lista.append(p)
    return lista


# --- Conversa -------------------------------------------------------------
def _comentario(autor, texto, quando):
    return {'id': 'c-' + os.urandom(5).hex(), 'autor': autor, 'texto': texto, 'em': iso(quando)}


def _texto_de_comentario(rnd, pecas):
    com_nome = [p for p in pecas if p.get('nome')]
    if com_nome and rnd.random() < 0.35:
        peca = rnd.choice(com_nome)['nome'].lower()
        return rnd.choice(COMENTARIOS_PECA).format(peca=peca)
    return rnd.choice(COMENTARIOS)


# --- Os posts gerados que já existem ---------------------------------------
def _gerados():
    args = {
        'TableName': TABELA,
        'FilterExpression': 'begins_with(pk, :p) AND gerado = :sim',
        'ExpressionAttributeValues': {':p': {'S': 'POST#'}, ':sim': {'BOOL': True}},
    }
    itens = []
    while True:
        r = _dynamo.scan(**args)
        itens.extend(feed._item(b) for b in r.get('Items', []))
        if 'LastEvaluatedKey' not in r:
            break
        args['ExclusiveStartKey'] = r['LastEvaluatedKey']
    itens.sort(key=lambda i: i['criado_em'], reverse=True)
    return itens


def _quem_posta(rnd, recentes):
    """Alguém que não postou nas últimas rodadas: o feed não vira monólogo."""
    descansados = [i for i in IDS if i not in recentes] or IDS
    return rnd.choice(descansados)


# --- Publicar -------------------------------------------------------------
def criar_post(rnd, acervo, autor, quando):
    pecas = sortear_conjunto(acervo, rnd)
    tipo = 'board' if rnd.random() < CHANCE_COLAGEM else 'look'
    nome = rnd.choice(NOMES_COLAGEM if tipo == 'board' else NOMES_LOOK)

    # Quem chega primeiro já curte; os outros vêm nas rodadas seguintes.
    outros = [i for i in IDS if i != autor]
    curtidas = set(rnd.sample(outros, rnd.randint(0, 6)))
    comentarios = []
    if rnd.random() < 0.4:
        comentarios.append(_comentario(rnd.choice(outros), _texto_de_comentario(rnd, pecas),
                                       quando + timedelta(minutes=rnd.randint(3, 50))))

    post_id = 'p-' + os.urandom(8).hex()
    item = {
        'pk': 'POST#' + post_id,
        'id': post_id,
        'autor': autor,
        'tipo': tipo,
        'nome': nome,
        'criado_em': iso(quando),
        'thumb': '',
        'pecas': [p['id'] for p in pecas],
        'camadas': '[]',
        'comentarios': comentarios,
        'gerado': True,
        'semente': rnd.randrange(1, 2 ** 31),
    }
    if curtidas:
        item['curtidas'] = curtidas
    _dynamo.put_item(TableName=TABELA,
                     Item={k: feed._ser.serialize(v) for k, v in item.items()},
                     ConditionExpression='attribute_not_exists(pk)')
    return item


def _animar(rnd, item, acervo_por_id, agora_):
    """Curtidas novas e, às vezes, conversa num post gerado ainda recente."""
    curtiram = set(item.get('curtidas') or ())
    candidatos = [i for i in IDS if i != item['autor'] and i not in curtiram]
    novas = rnd.sample(candidatos, min(len(candidatos), rnd.randint(0, 4)))

    comentario = None
    lista = item.get('comentarios') or []
    if rnd.random() < 0.3:
        pecas = [acervo_por_id[p] for p in item.get('pecas') or [] if p in acervo_por_id]
        outro = rnd.choice([i for i in IDS if i != item['autor']])
        comentario = _comentario(outro, _texto_de_comentario(rnd, pecas), agora_)
    elif lista and lista[-1]['autor'] != item['autor'] and rnd.random() < 0.35:
        resposta = '%s %s' % (HANDLE.get(lista[-1]['autor'], ''), rnd.choice(RESPOSTAS))
        comentario = _comentario(item['autor'], resposta.strip(), agora_)

    partes, valores = [], {}
    if novas:
        partes.append('ADD curtidas :novas')
        valores[':novas'] = {'SS': novas}
    if comentario:
        partes.append('SET comentarios = list_append(if_not_exists(comentarios, :vazio), :c)')
        valores[':c'] = feed._ser.serialize([comentario])
        valores[':vazio'] = {'L': []}
    if not partes:
        return False
    # ADD e SET na mesma expressão vão separados por espaço, não vírgula.
    return feed._atualizar(item['id'], ' '.join(partes), valores)


def _madrugada(agora_):
    hora = (agora_ - timedelta(hours=3)).hour        # Brasília, sem horário de verão
    return 1 <= hora < 7


def rodar(quantos=None, espalhar_horas=0, rnd=None, em=None):
    """Uma rodada: publica (quantos=None decide sozinho) e anima o que já existe.

    `espalhar_horas` data os posts novos entre agora e tantas horas atrás — é
    o que o semeio inicial usa para o feed não nascer com tudo do mesmo minuto.
    `em` é o horário da rodada, quando ela é uma que ficou para trás (em_dia).
    """
    rnd = rnd or random.Random()
    agora_ = em or agora()
    acervo = ler_acervo()
    if len(acervo) < 4:
        return {'publicados': [], 'animados': 0, 'apagados': 0, 'aviso': 'acervo vazio'}

    if quantos is None:
        if _madrugada(agora_):
            quantos = 1 if rnd.random() < 0.25 else 0
        else:
            quantos = 2 if rnd.random() < 0.3 else 1
    quantos = max(0, min(int(quantos), QUANTOS_MAX))

    existentes = _gerados()
    recentes = [i['autor'] for i in existentes[:6]]

    publicados = []
    for _ in range(quantos):
        autor = _quem_posta(rnd, recentes)
        recentes.insert(0, autor)
        quando = agora_ - timedelta(minutes=rnd.uniform(0, espalhar_horas * 60)) \
            if espalhar_horas else agora_
        publicados.append(criar_post(rnd, acervo, autor, quando)['id'])

    # Os que já estavam ganham vida; os novos acabaram de nascer.
    acervo_por_id = {p['id']: p for p in acervo}
    limite = iso(agora_ - timedelta(hours=ANIMAR_HORAS))
    animados = 0
    for item in existentes:
        if item['criado_em'] < limite:
            break
        try:
            animados += bool(_animar(rnd, item, acervo_por_id, agora_))
        except ClientError as e:                 # post apagado no meio do caminho
            print('não animei %s: %r' % (item['id'], e))

    # Teto: os mais velhos saem (a lista está do mais novo para o mais velho).
    sobrando = existentes[max(0, MAX_GERADOS - len(publicados)):]
    for item in sobrando:
        _dynamo.delete_item(TableName=TABELA, Key={'pk': {'S': item['pk']}})

    return {'publicados': publicados, 'animados': animados, 'apagados': len(sobrando)}


# --- O relógio -------------------------------------------------------------
# Quem faz a rodada acontecer de INTERVALO_HORAS em INTERVALO_HORAS é a
# própria leitura do feed: `GET /api/feed` chama em_dia(), que confere a hora
# da última rodada e faz as que faltam, cada uma datada no horário dela. Assim
# o gerador funciona sem nenhuma peça a mais na AWS; a agenda do EventBridge
# (gerador.yaml), quando ligada, só adianta o que a leitura faria.
#
#     GERADOR#relogio   ultima   ISO da última rodada
#
# A troca do `ultima` é condicional: com duas leituras ao mesmo tempo, só uma
# ganha a vez, e a outra segue sem gerar nada.
CHAVE_RELOGIO = 'GERADOR#relogio'


def _marcar(ultima, antes):
    """Grava `ultima` se o relógio ainda estiver em `antes` (None: nunca rodou)."""
    args = {
        'TableName': TABELA,
        'Key': {'pk': {'S': CHAVE_RELOGIO}},
        'UpdateExpression': 'SET ultima = :nova',
        'ExpressionAttributeValues': {':nova': {'S': ultima}},
    }
    if antes is None:
        args['ConditionExpression'] = 'attribute_not_exists(ultima)'
    else:
        args['ConditionExpression'] = 'ultima = :antes'
        args['ExpressionAttributeValues'][':antes'] = {'S': antes}
    try:
        _dynamo.update_item(**args)
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise


def em_dia():
    """Faz as rodadas que faltam desde a última. A primeira vez semeia o feed."""
    agora_ = agora()
    item = _dynamo.get_item(TableName=TABELA, Key={'pk': {'S': CHAVE_RELOGIO}},
                            ConsistentRead=True).get('Item') or {}
    antes = (item.get('ultima') or {}).get('S')
    passo = timedelta(hours=INTERVALO_HORAS)

    if antes is None:
        if not _marcar(iso(agora_), None):
            return None
        return rodar(12, espalhar_horas=72)

    try:
        ultima = datetime.fromisoformat(antes.replace('Z', '+00:00'))
    except ValueError:
        ultima = agora_ - passo
    if agora_ - ultima < passo:
        return None

    faltam = int((agora_ - ultima) / passo)
    if faltam > ATRASO_MAX:                 # muito tempo parado: só as últimas
        ultima = agora_ - passo * ATRASO_MAX
        faltam = ATRASO_MAX
    rodadas = [ultima + passo * (k + 1) for k in range(faltam)]
    if not _marcar(iso(rodadas[-1]), antes):
        return None                         # outra leitura chegou primeiro
    feito = {'publicados': [], 'animados': 0, 'apagados': 0}
    for quando in rodadas:
        r = rodar(em=quando)
        feito['publicados'] += r['publicados']
        feito['animados'] += r['animados']
        feito['apagados'] += r['apagados']
    return feito


def rodar_agendado(quantos=None, espalhar_horas=0):
    """A chamada do EventBridge: roda agora e acerta o relógio."""
    feito = rodar(quantos, espalhar_horas)
    _dynamo.update_item(TableName=TABELA, Key={'pk': {'S': CHAVE_RELOGIO}},
                        UpdateExpression='SET ultima = :nova',
                        ExpressionAttributeValues={':nova': {'S': iso(agora())}})
    return feito
