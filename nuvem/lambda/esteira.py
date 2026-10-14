# -*- coding: utf-8 -*-
"""
A esteira de peças — o lado da API. Só o administrador chega aqui.

    POST   /api/esteira                 reserva ids e devolve onde subir cada foto
    GET    /api/esteira/pinterest       as pastas do Pinterest vinculadas
    POST   /api/esteira/pinterest       vincula, desvincula ou relê as pastas
    GET    /api/esteira                 o que está na esteira, com prévia e palpite
    PUT    /api/esteira/<id>            guarda a ficha/medida que o admin mexeu
    POST   /api/esteira/<id>/publicar   vira peça do acervo
    POST   /api/esteira/<id>/refazer    processa a foto de novo
    DELETE /api/esteira/<id>            descarta

**A foto não passa por aqui.** A Function URL para em 6 MB e foto de celular
passa disso; mais importante, uma Lambda esperando upload é Lambda cobrando
por espera. A API só assina um POST para o S3 (`entrada/<id>.<ext>`, com
tamanho e tipo travados na assinatura) e o navegador manda direto. Quem pega
dali é o trabalhador (`nuvem/esteira/trabalhador.py`), chamado pela fila.

Tudo o que é da esteira mora no bucket de dados, que é privado:

    entrada/<id>.<ext>            a foto crua
    esteira/<id>.json             estado + palpite da IA + ficha do admin
    esteira/<id>.webp             a prévia (vira assets/cloths/<peça>.webp)
    esteira/<id>-g.webp           a grande (vira assets/cloths/<peça>-g.webp)
    esteira/<id>.png              o recorte em alta (vira mestres/<peça>.png)
    esteira/pins/<pin>            marca de "esse pin já entrou" (ver Pinterest)
    esteira/config/pinterest.json as pastas do Pinterest vinculadas

A prévia chega à tela por URL assinada de leitura, que vence em uma hora.
"""

import json
import os
import re
import secrets
import time
from datetime import datetime, timezone

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

import acervo

DADOS = os.environ.get('BD_BUCKET_DADOS') or ''
SITE = os.environ.get('BD_BUCKET_SITE') or ''

# Assinatura SigV4 com endpoint regional: a URL que sai daqui é usada pelo
# navegador, e a global (s3.amazonaws.com) redireciona POST de bucket novo.
_s3 = boto3.client('s3', region_name='us-east-1',
                   config=Config(signature_version='s3v4',
                                 s3={'addressing_style': 'virtual'}))

# HEIC fica de fora: o Pillow da Lambda não abre. O iPhone converte para JPG
# sozinho quando a foto sai por um <input type=file> do navegador.
TIPOS = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}
MAX_FOTO = 40 * 1024 * 1024
MAX_LOTE = 60
ID_OK = re.compile(r'^e[a-z0-9]{8,24}$')
ENVIO_ABANDONADO = 3600      # "enviando" há mais de 1 h: o upload não chegou
TRAVADO = 15 * 60            # "processando" há mais disso: o trabalhador morreu


def _agora():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _novo_id():
    return 'e%x%s' % (int(time.time()), secrets.token_hex(3))


def _id(item_id):
    item_id = str(item_id or '').strip().lower()
    if not ID_OK.match(item_id):
        raise ValueError('id da esteira inválido')
    return item_id


def _ler(item_id):
    try:
        r = _s3.get_object(Bucket=DADOS, Key='esteira/%s.json' % item_id)
    except ClientError as e:
        if e.response['Error']['Code'] in ('NoSuchKey', '404'):
            raise ValueError('essa foto não está mais na esteira')
        raise
    return json.loads(r['Body'].read())


def _gravar(dados):
    _s3.put_object(Bucket=DADOS, Key='esteira/%s.json' % dados['id'],
                   Body=json.dumps(dados, ensure_ascii=False).encode('utf-8'),
                   ContentType='application/json; charset=utf-8')


def _apagar(*chaves):
    chaves = [c for c in chaves if c]
    if chaves:
        _s3.delete_objects(Bucket=DADOS, Delete={
            'Objects': [{'Key': c} for c in chaves], 'Quiet': True})


def _idade(iso):
    """Segundos desde `iso`; 0 se não houver data."""
    if not iso:
        return 0
    return (datetime.now(timezone.utc) - datetime.fromisoformat(iso)).total_seconds()


def _para_tela(dados):
    """O que a tela recebe: sem caminhos internos, com a prévia assinada."""
    saida = {k: dados.get(k) for k in (
        'id', 'estado', 'arquivo', 'erro', 'criadoEm', 'processadoEm', 'w', 'h',
        'fundoRemovido', 'segundos', 'sugestao', 'ficha', 'medida', 'corte', 'origem')}
    if dados.get('estado') == 'enviando' and _idade(dados.get('criadoEm')) > ENVIO_ABANDONADO:
        saida['estado'] = 'erro'
        saida['erro'] = 'a foto não chegou ao servidor (envio interrompido)'
    # Morte por memória ou tempo não deixa o trabalhador gravar "erro".
    if dados.get('estado') == 'processando' and _idade(dados.get('iniciadoEm')) > TRAVADO:
        saida['estado'] = 'erro'
        saida['erro'] = 'o processamento travou; tente de novo'
    if dados.get('previa'):
        saida['previa'] = _s3.generate_presigned_url(
            'get_object', Params={'Bucket': DADOS, 'Key': dados['previa']},
            ExpiresIn=3600)
    return saida


# --- Rotas ------------------------------------------------------------------
def reservar(corpo):
    """POST /api/esteira — {arquivos: [{nome, tipo, bytes}], origem}."""
    arquivos = corpo.get('arquivos') or []
    if not isinstance(arquivos, list) or not arquivos:
        raise ValueError('nenhum arquivo')
    if len(arquivos) > MAX_LOTE:
        raise ValueError('no máximo %d fotos por vez' % MAX_LOTE)
    origem = str(corpo.get('origem') or 'tela')[:20]

    envios = []
    for a in arquivos:
        tipo = str(a.get('tipo') or '').lower()
        if tipo not in TIPOS:
            raise ValueError('%s: tipo %s não aceito (JPG, PNG ou WebP)'
                             % (a.get('nome'), tipo or 'desconhecido'))
        if int(a.get('bytes') or 0) > MAX_FOTO:
            raise ValueError('%s: passa de %d MB' % (a.get('nome'), MAX_FOTO >> 20))

        item_id = _novo_id()
        chave = 'entrada/%s.%s' % (item_id, TIPOS[tipo])
        _gravar({'id': item_id, 'estado': 'enviando', 'criadoEm': _agora(),
                 'arquivo': str(a.get('nome') or '')[:120], 'origem': origem,
                 'entrada': chave})
        envio = _s3.generate_presigned_post(
            DADOS, chave,
            Fields={'Content-Type': tipo},
            Conditions=[{'Content-Type': tipo},
                        ['content-length-range', 1, MAX_FOTO]],
            ExpiresIn=900)
        envios.append({'id': item_id, 'nome': a.get('nome'),
                       'url': envio['url'], 'campos': envio['fields']})
    return {'envios': envios}


# --- Pastas do Pinterest -----------------------------------------------------
# A pasta do Pinterest é vinculada uma vez e relida toda vez que a esteira
# abre: entra só o pin que nunca passou por aqui. "Nunca" quer dizer nunca —
# cada pin que entra deixa uma marca em `esteira/pins/`, e a marca fica depois
# de a peça ser publicada ou descartada. Sem ela, o pin publicado voltava na
# leitura seguinte, e o único jeito de evitar era apagá-lo da pasta no
# Pinterest.
#
# A marca reconhece o pin, não a roupa: a peça que já está no jogo chegando
# por outro pin (importada antes de a marca existir, salva duas vezes no
# Pinterest) é reconhecida pela imagem, no trabalhador (nuvem/esteira/
# repetidas.py), e sai da esteira sozinha — ver `listar`.
#
# A foto passa pela Lambda (vem do Pinterest, não do navegador, então não
# esbarra nos 6 MB da Function URL). Pasta grande é lida aos pedaços, de uma
# chamada para a outra (ver `_trazer`); se o Pinterest recusar a visita, só os
# 25 mais recentes daquela vez (ver pinterest.py). Cada chamada importa o que
# cabe no tempo dela; o resto volta como `continua`/`faltam`/`adiada` e a
# tela chama de novo na hora.
PINS = 'esteira/pins/'
PASTAS = 'esteira/config/pinterest.json'
TEMPO_RELEITURA = 22         # s; a Lambda da API tem 30
FOLGA_FOTOS = 11             # s que um bloco de fotos pode levar (pinterest.TEMPO + upload)


def _pins_vistos():
    """As marcas. Ler também as fichas da esteira (para os pins de antes das
    marcas) custava um GET por cartão e comia o tempo da leitura; pin antigo
    que entre de novo é pego pelo trabalhador como repetido."""
    pag = _s3.get_paginator('list_objects_v2')
    return {obj['Key'][len(PINS):]
            for pagina in pag.paginate(Bucket=DADOS, Prefix=PINS)
            for obj in pagina.get('Contents', [])}


def _marcar_pin(pin, item_id=''):
    _s3.put_object(Bucket=DADOS, Key=PINS + pin, Body=item_id.encode('utf-8'))


def _pastas():
    try:
        r = _s3.get_object(Bucket=DADOS, Key=PASTAS)
    except ClientError as e:
        if e.response['Error']['Code'] in ('NoSuchKey', '404'):
            return []
        raise
    return json.loads(r['Body'].read())


def _gravar_pastas(pastas):
    _s3.put_object(Bucket=DADOS, Key=PASTAS,
                   Body=json.dumps(pastas, ensure_ascii=False).encode('utf-8'),
                   ContentType='application/json; charset=utf-8')


def _importar(pins, pasta, prazo):
    """Baixa os pins e põe na esteira, com a categoria da pasta já sugerida.

    De bloco em bloco, de olho no relógio (`prazo`, em time.time()): a Lambda
    morta no meio deixava pin sem foto. O que não coube volta em `resto` e
    fica guardado na pasta para a próxima chamada.

    A marca do pin vem por último, depois da foto: pin que não baixou, ou que
    a Lambda não terminou, volta para a fila (ver `_trazer`)."""
    import pinterest
    entraram, falharam, feitos, falhos = 0, 0, 0, []
    bloco = pinterest.PARALELO
    while feitos < len(pins) and time.time() + FOLGA_FOTOS < prazo:
        lote = pins[feitos:feitos + bloco]
        feitos += len(lote)
        for p, foto, tipo in pinterest.baixar_fotos(lote):
            if foto is None:
                falharam += 1
                falhos.append(p)
                print('pinterest: pin %s não baixou (%s)' % (p['pin'], tipo))
                continue
            item_id = _novo_id()
            chave = 'entrada/%s.%s' % (item_id, TIPOS[tipo])
            # A ficha antes da foto: o trabalhador é chamado pelo "Object Created"
            # e precisa achar a categoria da pasta já gravada.
            _gravar({'id': item_id, 'estado': 'enviando', 'criadoEm': _agora(),
                     'arquivo': p['titulo'] or 'pin %s' % p['pin'], 'origem': 'pinterest',
                     'pin': p['pin'], 'entrada': chave,
                     'ficha': {'cat': pasta['cat']} if pasta.get('cat') else {}})
            _s3.put_object(Bucket=DADOS, Key=chave, Body=foto, ContentType=tipo)
            _marcar_pin(p['pin'], item_id)
            entraram += 1
    return {'entraram': entraram, 'falharam': falharam, 'resto': pins[feitos:], 'falhos': falhos}


# Pins achados por leitura que ainda não couberam no tempo de importar. A
# leitura anda à frente (o marcador já passou deles), então eles ficam
# guardados na pasta, e a chamada seguinte importa antes de ler mais.
BASTA = 40


def _trazer(pasta, vistos, prazo):
    """Lê o próximo trecho da pasta e importa o que for novo. Muda `pasta`
    (marcador, pendentes, inteira, varridos, ultima) e `vistos`; devolve o
    resumo para a tela.

    A pasta grande anda aos pedaços entre chamadas: o `marcador` diz onde a
    leitura parou e `inteira` que ela já chegou ao fim uma vez — dali em
    diante só o topo, até a primeira página sem nada novo. O botão "Procurar
    pins" zera os dois (ver `_reler`) e a pasta é percorrida de novo do
    começo, pegando o que tenha ficado para trás."""
    import pinterest
    pendentes = [p for p in pasta.get('pendentes') or [] if p['pin'] not in vistos]
    lida = {}
    if not pendentes:
        lida = pinterest.ler_pasta(pasta['usuario'], pasta['pasta'], prazo - FOLGA_FOTOS,
                                   marcador=pasta.get('marcador'), conhecidos=vistos,
                                   basta=BASTA, ate_conhecida=bool(pasta.get('inteira')))
        pendentes = [p for p in lida['pins'] if p['pin'] not in vistos]
        if lida.get('completa'):
            if not pasta.get('marcador'):
                pasta['varridos'] = 0
            pasta['varridos'] = pasta.get('varridos', 0) + lida.get('andou', 0)
            pasta['marcador'] = lida.get('marcador')
            if lida.get('fim'):
                pasta['inteira'] = True
        if lida.get('quantos') is not None:
            pasta['quantos'] = lida['quantos']
        if lida.get('titulo'):
            pasta['titulo'] = lida['titulo']
        pasta['ultima'] = {'em': _agora(), 'liberada': bool(lida.get('completa')),
                           'tentativas': lida.get('tentativas'), 'lidos': len(lida['pins']),
                           'novos': len(pendentes), 'falha': lida.get('falha')}
    if 'cat' not in pasta:
        pasta['cat'] = (pinterest.categoria_do_nome(pasta['titulo'])
                        or pinterest.categoria_do_nome(pasta['pasta']))
    vistos |= {p['pin'] for p in pendentes}         # o mesmo pin em duas pastas entra uma vez
    feito = _importar(pendentes, pasta, prazo)
    # A foto que não baixou volta para a fila, até 3 vezes: antes ela se
    # perdia, porque o marcador já tinha passado dela.
    de_novo = [{**p, 'falhou': p.get('falhou', 0) + 1}
               for p in feito.pop('falhos') if p.get('falhou', 0) < 2]
    pasta['pendentes'] = feito.pop('resto') + de_novo
    pasta['lidaEm'] = _agora()
    recusada = bool(lida) and not lida.get('completa')
    return {**feito, 'faltam': len(pasta['pendentes']),
            # A recusada ainda não lida até o fim vale tentar de novo já.
            'continua': bool(pasta.get('marcador')) or (recusada and not pasta.get('inteira')),
            'recusada': recusada, 'falha': lida.get('falha') if recusada else None,
            'tentativas': lida.get('tentativas'), 'varridos': pasta.get('varridos'),
            'quantos': pasta.get('quantos'), 'inteira': bool(pasta.get('inteira'))}


ESTADO_DA_LEITURA = ('marcador', 'pendentes', 'inteira', 'quantos', 'lidaEm', 'titulo', 'cat',
                     'varridos', 'ultima')


def _guardar_leitura(mudadas):
    """Grava o andamento das pastas lidas. Relê a lista antes: ela pode ter
    mudado enquanto lia (desvincular)."""
    if not mudadas:
        return _pastas()
    atuais = _pastas()
    for p in atuais:
        if p['id'] in mudadas:
            for k in ESTADO_DA_LEITURA:
                if k in mudadas[p['id']]:
                    p[k] = mudadas[p['id']][k]
    _gravar_pastas(atuais)
    return atuais


def _publica(pasta):
    """A pasta como a tela vê: sem a fila interna de pins."""
    return {k: v for k, v in pasta.items() if k not in ('pendentes', 'marcador')}


def pastas_pinterest():
    """GET /api/esteira/pinterest."""
    return {'pastas': [_publica(p) for p in _pastas()]}


def pinterest(corpo):
    """POST /api/esteira/pinterest:

        {link}                  vincula a pasta e traz o que a esteira nunca viu
        {desvincular: id}       para de ler a pasta
        {reler: true}           traz o novo de todas as vinculadas
        {reler: true, varrer: true}
                                percorre as pastas de novo do começo (botão
                                "Procurar pins"), atrás do que ficou para trás
    """
    if corpo.get('reler'):
        feitas = corpo.get('feitas') if isinstance(corpo.get('feitas'), list) else []
        return _reler([str(f) for f in feitas][:200], varrer=bool(corpo.get('varrer')))
    if corpo.get('desvincular'):
        alvo = str(corpo['desvincular'])
        pastas = [p for p in _pastas() if p['id'] != alvo]
        _gravar_pastas(pastas)
        return {'pastas': [_publica(p) for p in pastas]}

    import pinterest
    prazo = time.time() + TEMPO_RELEITURA
    usuario, nome = pinterest.pasta_do_link(corpo.get('link'))
    pasta_id = ('%s/%s' % (usuario, nome)).lower()
    # Vincular de novo a mesma pasta continua de onde a leitura estava.
    antiga = next((p for p in _pastas() if p['id'] == pasta_id), {})
    pasta = {**antiga, 'id': pasta_id, 'usuario': usuario, 'pasta': nome,
             'titulo': antiga.get('titulo') or nome}
    vistos = _pins_vistos()
    r = _trazer(pasta, vistos, prazo)
    pastas = [p for p in _pastas() if p['id'] != pasta['id']]
    pastas.append({'vinculadaEm': _agora(), **pasta})
    _gravar_pastas(pastas)
    return {'pasta': _publica(pasta), 'pastas': [_publica(p) for p in pastas], **r}


def _reler(feitas=(), varrer=False):
    """Uma pasta por vez, de olho no relógio. A que não coube volta `adiada`;
    a que ainda tem o que ler volta com `continua` ou `faltam`: a tela chama
    de novo com `feitas` (as que já terminaram nesta rodada), até não sobrar
    nada.

    A que foi lida há mais tempo vai primeiro: antes era sempre a mesma ordem,
    e com pastas grandes as últimas ficavam adiadas para sempre."""
    prazo = time.time() + TEMPO_RELEITURA
    vistos = _pins_vistos()
    feitas = set(feitas or ())
    resultado, mudadas = [], {}
    todas = _pastas()
    if varrer:
        # Todas de uma vez, mesmo as que ficarem adiadas nesta chamada: as
        # seguintes já vêm sem `varrer`.
        for pasta in todas:
            pasta.update(marcador=None, inteira=False, varridos=0)
            mudadas[pasta['id']] = pasta
    for pasta in sorted(todas, key=lambda p: p.get('lidaEm') or ''):
        r = {'id': pasta['id'], 'titulo': pasta['titulo']}
        if pasta['id'] in feitas:
            continue
        if time.time() + FOLGA_FOTOS > prazo:
            resultado.append({**r, 'adiada': True})
            continue
        try:
            feito = _trazer(pasta, vistos, prazo)
        except ValueError as e:
            resultado.append({**r, 'erro': str(e)})
            continue
        mudadas[pasta['id']] = pasta
        resultado.append({**r, 'titulo': pasta['titulo'], **feito})
    _guardar_leitura(mudadas)
    return {'pastas': resultado}


def _fichas():
    # O Delimiter deixa as subpastas (`pins/`, `config/`) de fora: são
    # milhares de marcas que não são ficha, e a tela relê a lista a cada 3 s
    # enquanto processa.
    pag = _s3.get_paginator('list_objects_v2')
    for pagina in pag.paginate(Bucket=DADOS, Prefix='esteira/', Delimiter='/'):
        for obj in pagina.get('Contents', []):
            if not obj['Key'].endswith('.json'):
                continue
            try:
                r = _s3.get_object(Bucket=DADOS, Key=obj['Key'])
                dados = json.loads(r['Body'].read())
            except (ClientError, ValueError):
                continue
            if isinstance(dados, dict) and dados.get('id'):
                yield dados


def _pin_perdido(f):
    """Ficha de pin parada em "enviando" cuja foto nunca chegou ao S3."""
    if f.get('origem') != 'pinterest' or not f.get('pin') or f.get('estado') != 'enviando':
        return False
    if _idade(f.get('criadoEm')) < 600 or not f.get('entrada'):
        return False
    try:
        _s3.head_object(Bucket=DADOS, Key=f['entrada'])
        return False
    except ClientError as e:
        return e.response['Error']['Code'] in ('404', 'NoSuchKey', 'NotFound')


def listar():
    """GET /api/esteira — mais novas primeiro. A foto que o trabalhador achou
    repetida (já é peça do jogo, ou já está na esteira) sai daqui mesmo: a
    tela só fica sabendo, para avisar. A marca do pin fica, então ela também
    não volta pelo Pinterest."""
    itens, repetidas = [], []
    for f in _fichas():
        if f.get('estado') == 'repetida':
            _apagar('esteira/%s.json' % f['id'], f.get('entrada'), f.get('previa'),
                    f.get('previaG'), f.get('mestre'))
            repetidas.append({'arquivo': f.get('arquivo') or '', 'de': f.get('repetidaDe') or {}})
            print('esteira %s repetida de %s: descartada' % (f['id'], (f.get('repetidaDe') or {}).get('id')))
            continue
        if _pin_perdido(f):
            # A Lambda que importava morreu entre a ficha e a foto (antes a
            # marca vinha primeiro). Sem a ficha e sem a marca, o pin entra de
            # novo na próxima leitura do Pinterest.
            _apagar('esteira/%s.json' % f['id'], PINS + str(f['pin']))
            print('esteira %s: pin %s sem foto, volta pelo Pinterest' % (f['id'], f['pin']))
            continue
        itens.append(_para_tela(f))
    itens.sort(key=lambda i: i.get('criadoEm') or '', reverse=True)
    return {'itens': itens, 'repetidas': repetidas}


def guardar(item_id, corpo):
    """PUT /api/esteira/<id> — a ficha em andamento, para não se perder ao
    trocar de aparelho (fotografou no celular, revisa no computador)."""
    dados = _ler(_id(item_id))
    if isinstance(corpo.get('ficha'), dict):
        f = corpo['ficha']
        dados['ficha'] = {
            'cat': acervo.categoria(f.get('cat')) if acervo.categoria(f.get('cat')) in acervo.CATS else '',
            'cor': str(f.get('cor') or '').strip()[:24],
            'nome': str(f.get('nome') or '').strip()[:60],
            'marca': str(f.get('marca') or '').strip()[:40],
            'raridade': f.get('raridade') if f.get('raridade') in acervo.RARIDADES else 'common',
            'tema': acervo.tema(f.get('tema')),
        }
    if isinstance(corpo.get('medida'), dict):
        m = corpo['medida']
        dados['medida'] = {k: round(float(m.get(k, 0)), 1) for k in ('x', 'y', 'w')}
    elif corpo.get('medida') is False:
        # Trocou a categoria: a medida da antiga não serve para a nova. É False
        # e não None de propósito: None é só "ainda não medi", e não pode
        # apagar o que foi medido em outro aparelho.
        dados.pop('medida', None)
    if isinstance(corpo.get('corte'), dict):
        dados['corte'] = _corte(corpo['corte'])
        if not dados['corte']:
            dados.pop('corte')
    elif corpo.get('corte') is False:
        dados.pop('corte', None)
    _gravar(dados)
    return {'item': _para_tela(dados)}


def _corte(c):
    """A caixa do corte em 0–1 sobre a prévia; None se for a imagem inteira
    ou não fizer sentido."""
    try:
        x, y, w, h = (min(1.0, max(0.0, float(c.get(k, 0)))) for k in ('x', 'y', 'w', 'h'))
    except (TypeError, ValueError):
        return None
    w, h = min(w, 1 - x), min(h, 1 - y)
    if w < 0.02 or h < 0.02 or (w > 0.995 and h > 0.995):
        return None
    return {'x': round(x, 4), 'y': round(y, 4), 'w': round(w, 4), 'h': round(h, 4)}


def _cortar(chave, corte, formato):
    """Os bytes da imagem `chave` (bucket de dados) cortada pela caixa, e o
    tamanho que ficou."""
    import io
    from PIL import Image
    r = _s3.get_object(Bucket=DADOS, Key=chave)
    with Image.open(io.BytesIO(r['Body'].read())) as img:
        img.load()
        W, H = img.size
        x0, y0 = round(corte['x'] * W), round(corte['y'] * H)
        x1 = max(x0 + 1, min(W, round((corte['x'] + corte['w']) * W)))
        y1 = max(y0 + 1, min(H, round((corte['y'] + corte['h']) * H)))
        parte = img.crop((x0, y0, x1, y1))
        saida = io.BytesIO()
        if formato == 'WEBP':
            parte.save(saida, 'WEBP', quality=88, method=6)
        else:
            parte.save(saida, formato)
        return saida.getvalue(), parte.size


def publicar(item_id, corpo):
    """POST /api/esteira/<id>/publicar — {ficha, medida}. Vira peça do jogo."""
    item_id = _id(item_id)
    dados = _ler(item_id)
    if dados.get('estado') != 'pronta':
        raise ValueError('essa foto ainda não está pronta para publicar')

    ficha = {**(dados.get('ficha') or {}), **(corpo.get('ficha') or {})}
    medida = corpo.get('medida') or dados.get('medida')
    if not medida:
        medida = dict(acervo.ANCORAS.get(acervo.categoria(ficha.get('cat'))) or {})
    pedido = {**ficha, 'ancora': medida or {}, 'w': dados['w'], 'h': dados['h']}
    acervo.validar(pedido)

    peca_id = acervo.gerar_id(ficha)
    src = 'assets/cloths/%s.webp' % peca_id
    eterno = 'public, max-age=31536000, immutable'
    corte = _corte(dados.get('corte') or {})

    def copiar(origem, destino, bucket=SITE, tipo='image/webp', formato='WEBP'):
        """Leva a imagem da esteira ao destino, cortada se houver corte."""
        if not corte:
            extra = {'ContentType': tipo, 'MetadataDirective': 'REPLACE', 'CacheControl': eterno} \
                if bucket == SITE else {}
            _s3.copy_object(Bucket=bucket, Key=destino,
                            CopySource={'Bucket': DADOS, 'Key': origem}, **extra)
            return None
        corpo_img, tamanho = _cortar(origem, corte, formato)
        extra = {'CacheControl': eterno} if bucket == SITE else {}
        _s3.put_object(Bucket=bucket, Key=destino, Body=corpo_img, ContentType=tipo, **extra)
        return tamanho

    tamanho = copiar(dados['previa'], src)
    if tamanho:
        pedido['w'], pedido['h'] = tamanho
    caminho = acervo.contorno(src) if corte else (dados.get('path') or '')
    item = acervo.ficha_da_peca(peca_id, pedido, src, caminho)

    # A assinatura da prévia original e o pin de onde veio: é por eles que a
    # mesma roupa não entra de novo, mesmo depois de a peça ser editada.
    for campo in ('assinatura', 'pin'):
        if dados.get(campo):
            item[campo] = dados[campo]

    if dados.get('previaG'):
        src_g = 'assets/cloths/%s-g.webp' % peca_id
        tamanho_g = copiar(dados['previaG'], src_g)
        item.update(srcG=src_g, wG=int(tamanho_g[0] if tamanho_g else dados.get('wG') or 0))

    if dados.get('mestre'):
        destino = 'mestres/%s.png' % peca_id
        copiar(dados['mestre'], destino, bucket=DADOS, tipo='image/png', formato='PNG')
        item['mestre'] = destino

    try:
        acervo.anexar(item)
    except Exception:
        # Sem peça no acervo, as imagens são órfãs.
        for chave in (src, item.get('srcG')):
            if chave:
                _s3.delete_object(Bucket=SITE, Key=chave)
        raise

    _apagar('esteira/%s.json' % item_id, dados.get('previa'), dados.get('previaG'),
            dados.get('mestre'), dados.get('entrada'))
    print('esteira %s publicada como %s (%s)' % (item_id, peca_id, item['cat']))
    return {'item': item}


def refazer(item_id):
    """POST /api/esteira/<id>/refazer — copia a foto sobre ela mesma: o S3
    solta um "Object Created" novo e a fila manda de volta ao trabalhador."""
    dados = _ler(_id(item_id))
    chave = dados.get('entrada')
    if not chave:
        raise ValueError('a foto original dessa peça não está mais guardada')
    _s3.copy_object(Bucket=DADOS, Key=chave,
                    CopySource={'Bucket': DADOS, 'Key': chave},
                    MetadataDirective='REPLACE',
                    Metadata={'refeito': _agora()})
    dados.update(estado='processando', erro='')
    _gravar(dados)
    return {'item': _para_tela(dados)}


def descartar(item_id):
    dados = _ler(_id(item_id))
    _apagar('esteira/%s.json' % dados['id'], dados.get('previa'),
            dados.get('previaG'), dados.get('mestre'), dados.get('entrada'))
    return {'ok': True}
