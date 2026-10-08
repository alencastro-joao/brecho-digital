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
        'fundoRemovido', 'segundos', 'sugestao', 'ficha', 'medida', 'origem')}
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
# esbarra nos 6 MB da Function URL). A pasta é lida inteira; se o Pinterest
# recusar, só os 25 pins mais recentes (ver pinterest.py), e a tela diz qual
# das duas foi (`completa`). Cada leitura traz no máximo MAX_LOTE: pasta com
# mais pins novos que isso termina de entrar nas aberturas seguintes.
PINS = 'esteira/pins/'
PASTAS = 'esteira/config/pinterest.json'
TEMPO_RELEITURA = 20         # s; a Lambda da API tem 30


def _pins_vistos():
    """As marcas e, para os pins de antes delas, os que ainda estão na esteira."""
    pag = _s3.get_paginator('list_objects_v2')
    vistos = {obj['Key'][len(PINS):]
              for pagina in pag.paginate(Bucket=DADOS, Prefix=PINS)
              for obj in pagina.get('Contents', [])}
    return vistos | {str(f['pin']) for f in _fichas() if f.get('pin')}


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


def _importar(pins, pasta):
    """Baixa os pins e põe na esteira, com a categoria da pasta já sugerida.
    Pin que não baixou fica sem marca: a próxima leitura tenta de novo."""
    import pinterest
    entraram, falharam = 0, 0
    for p, foto, tipo in pinterest.baixar_fotos(pins[:MAX_LOTE]):
        if foto is None:
            falharam += 1
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
        _marcar_pin(p['pin'], item_id)
        _s3.put_object(Bucket=DADOS, Key=chave, Body=foto, ContentType=tipo)
        entraram += 1
    return {'entraram': entraram, 'falharam': falharam}


def pastas_pinterest():
    """GET /api/esteira/pinterest."""
    return {'pastas': _pastas()}


def pinterest(corpo):
    """POST /api/esteira/pinterest:

        {link}                  vincula a pasta e traz o que a esteira nunca viu
        {desvincular: id}       para de ler a pasta
        {reler: true}           traz o novo de todas as vinculadas
    """
    if corpo.get('reler'):
        return _reler()
    if corpo.get('desvincular'):
        alvo = str(corpo['desvincular'])
        pastas = [p for p in _pastas() if p['id'] != alvo]
        _gravar_pastas(pastas)
        return {'pastas': pastas}

    import pinterest
    usuario, nome = pinterest.pasta_do_link(corpo.get('link'))
    lida = pinterest.ler_pasta(usuario, nome)
    pasta = {'id': ('%s/%s' % (usuario, nome)).lower(), 'usuario': usuario, 'pasta': nome,
             'titulo': lida['titulo'],
             'cat': pinterest.categoria_do_nome(lida['titulo']) or pinterest.categoria_do_nome(nome)}
    vistos = _pins_vistos()
    novos = [p for p in lida['pins'] if p['pin'] not in vistos]
    pastas = [p for p in _pastas() if p['id'] != pasta['id']]
    pastas.append({**pasta, 'vinculadaEm': _agora()})
    _gravar_pastas(pastas)
    return {'pasta': pasta, 'pastas': pastas, 'jaVistos': len(lida['pins']) - len(novos),
            'total': len(lida['pins']), 'completa': lida.get('completa', False),
            'faltam': max(0, len(novos) - MAX_LOTE), **_importar(novos, pasta)}


def _reler():
    """Uma pasta por vez, de olho no relógio: a que não coube nos 20 s fica
    para a próxima abertura da esteira."""
    import pinterest
    inicio = time.time()
    vistos = _pins_vistos()
    resultado = []
    for pasta in _pastas():
        r = {'id': pasta['id'], 'titulo': pasta['titulo']}
        if time.time() - inicio > TEMPO_RELEITURA:
            resultado.append({**r, 'adiada': True})
            continue
        try:
            lida = pinterest.ler_pasta(pasta['usuario'], pasta['pasta'])
        except ValueError as e:
            resultado.append({**r, 'erro': str(e)})
            continue
        novos = [p for p in lida['pins'] if p['pin'] not in vistos]
        vistos |= {p['pin'] for p in novos}         # o mesmo pin em duas pastas entra uma vez
        resultado.append({**r, 'total': len(lida['pins']), 'completa': lida.get('completa', False),
                          'faltam': max(0, len(novos) - MAX_LOTE), **_importar(novos, pasta)})
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
        }
    if isinstance(corpo.get('medida'), dict):
        m = corpo['medida']
        dados['medida'] = {k: round(float(m.get(k, 0)), 1) for k in ('x', 'y', 'w')}
    elif corpo.get('medida') is False:
        # Trocou a categoria: a medida da antiga não serve para a nova. É False
        # e não None de propósito: None é só "ainda não medi", e não pode
        # apagar o que foi medido em outro aparelho.
        dados.pop('medida', None)
    _gravar(dados)
    return {'item': _para_tela(dados)}


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
    _s3.copy_object(Bucket=SITE, Key=src,
                    CopySource={'Bucket': DADOS, 'Key': dados['previa']},
                    ContentType='image/webp', MetadataDirective='REPLACE',
                    CacheControl='public, max-age=31536000, immutable')
    item = acervo.ficha_da_peca(peca_id, pedido, src, dados.get('path') or '')

    # A assinatura da prévia original e o pin de onde veio: é por eles que a
    # mesma roupa não entra de novo, mesmo depois de a peça ser editada.
    for campo in ('assinatura', 'pin'):
        if dados.get(campo):
            item[campo] = dados[campo]

    if dados.get('previaG'):
        src_g = 'assets/cloths/%s-g.webp' % peca_id
        _s3.copy_object(Bucket=SITE, Key=src_g,
                        CopySource={'Bucket': DADOS, 'Key': dados['previaG']},
                        ContentType='image/webp', MetadataDirective='REPLACE',
                        CacheControl='public, max-age=31536000, immutable')
        item.update(srcG=src_g, wG=int(dados.get('wG') or 0))

    if dados.get('mestre'):
        destino = 'mestres/%s.png' % peca_id
        _s3.copy_object(Bucket=DADOS, Key=destino,
                        CopySource={'Bucket': DADOS, 'Key': dados['mestre']})
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
