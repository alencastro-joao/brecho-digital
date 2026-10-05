# -*- coding: utf-8 -*-
"""
bgbatch — remoção de fundo em alta resolução.

O pipeline.py parte do princípio de que o PNG que chega já tem fundo
transparente. Este script é o passo que faltava antes dele: pega a foto crua
(JPG de estúdio, print de e-commerce, foto de celular) e devolve o recorte em
PNG com alpha, no tamanho grande — o *máster*.

Do máster saem o WebP leve do acervo e o contorno vetorial. O máster fica
guardado: se um dia o app precisar da peça em 1024 em vez de 512, é só
reprocessar, sem ter que caçar a foto original de novo.

Duas portas de entrada:

    em lote     python tools/bgbatch.py --src ../Cloths/brutas --out ../Cloths
    na tela     servidor.py chama recortar() em POST /api/fundo, e o
                "+ Adicionar peça" passa a aceitar foto com fundo

Como o recorte sai em alta — é isto que separa o script de um "remove.bg de
uma passada só":

  1. Passada global. O modelo roda na foto inteira reduzida a 1024² e devolve
     uma máscara grosseira. Serve para achar *onde* está a peça, não para
     recortá-la.
  2. Passada de detalhe. A peça é recortada da foto em resolução plena pela
     caixa da passada 1 e volta ao modelo. Agora ela ocupa os 1024² inteiros:
     uma alça de 6 px na foto original chega ao modelo com 40 px. É daqui que
     sai a borda de verdade.
  3. Ladrilhos (opcional, --tiles). Para foto muito grande, a faixa de
     incerteza da máscara é refeita em pedaços, cada um em 1024². Caro — cada
     ladrilho é uma passada inteira —, então só compensa no lote.
  4. Limpeza de borda. O pixel semitransparente da silhueta carrega cor do
     fundo que acabou de ser removido: é o halo claro que aparece quando a
     peça cai na prancheta branca. Com a cor do fundo estimada na vizinhança
     dá para devolver a cor real do tecido — a imagem é I = a·F + (1-a)·B e o
     que se quer guardar é o F.

Modelo padrão: BiRefNet-general (licença MIT), ~973 MB, baixado uma vez para o
cache do usuário. `--modelo` troca por um mais leve; `--modelos` diz onde os
arquivos ficam.

Dependências:  python -m pip install onnxruntime pillow numpy
"""

import argparse
import os
import sys
import time
import urllib.request

try:
    import numpy as np
except ImportError:
    sys.exit('numpy nao encontrado. Instale com:  python -m pip install numpy')

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow nao encontrado. Instale com:  python -m pip install pillow')


# ============================== Modelos ===================================
# Cada modelo traz o próprio pré-processamento. `sigmoide` e `normalizar`
# descrevem o que fazer com a saída: a família BiRefNet devolve logits, a
# família IS-Net devolve um mapa já positivo que só precisa de min-max.
MODELOS = {
    'birefnet-general': {
        'url': 'https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model.onnx',
        'arquivo': 'birefnet-general.onnx',
        'mb': 973, 'lado': 1024,
        'media': (0.485, 0.456, 0.406), 'desvio': (0.229, 0.224, 0.225),
        'sigmoide': True, 'normalizar': False,
        'sobre': 'melhor borda, mais lento (MIT)',
    },
    'birefnet-general-fp16': {
        'url': 'https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model_fp16.onnx',
        'arquivo': 'birefnet-general-fp16.onnx',
        'mb': 490, 'lado': 1024,
        'media': (0.485, 0.456, 0.406), 'desvio': (0.229, 0.224, 0.225),
        'sigmoide': True, 'normalizar': False,
        'sobre': 'o mesmo em meia precisao: metade do disco (MIT)',
    },
    'birefnet-lite': {
        'url': 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model.onnx',
        'arquivo': 'birefnet-lite.onnx',
        'mb': 224, 'lado': 1024,
        'media': (0.485, 0.456, 0.406), 'desvio': (0.229, 0.224, 0.225),
        'sigmoide': True, 'normalizar': False,
        'sobre': 'quase tao bom, 4x mais leve (MIT)',
    },
    'isnet': {
        'url': 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
        'arquivo': 'isnet-general-use.onnx',
        'mb': 179, 'lado': 1024,
        'media': (0.5, 0.5, 0.5), 'desvio': (1.0, 1.0, 1.0),
        'sigmoide': False, 'normalizar': True,
        'sobre': 'rapido, perde alca fina e renda (Apache 2.0)',
    },
}
PADRAO = 'birefnet-general'

# Escada de recuo por falta de memória, do melhor para o mais leve. O fp16
# fica de fora de propósito: em CPU o onnxruntime não executa meia precisão
# nativamente — expande os pesos e gasta *mais* RAM que o fp32 de origem —,
# então oferecê-lo a quem já está sem memória é mandar a pessoa para um lugar
# pior. Tamanho em disco não é consumo de RAM.
ESCADA = ['birefnet-general', 'birefnet-lite', 'isnet']

# Alpha abaixo disso conta como fundo para estimar a cor do halo.
FUNDO_LIMITE = 0.05
# A caixa da passada global ganha esta folga antes da passada de detalhe.
FOLGA_DETALHE = 0.06
# Espaço que o download nunca encosta. O disco de sistema em zero byte trava
# o Windows, e o modelo é grande o bastante para chegar lá sozinho.
FOLGA_DISCO = int(os.environ.get('BGBATCH_FOLGA_MB') or 250) * 1024 * 1024


def pasta_modelos(escolhida=None):
    """Onde os .onnx ficam. Fora do projeto de propósito: são centenas de MB."""
    if escolhida:
        return os.path.abspath(escolhida)
    if os.environ.get('BGBATCH_MODELOS'):
        return os.path.abspath(os.environ['BGBATCH_MODELOS'])
    base = (os.environ.get('LOCALAPPDATA')
            or os.environ.get('XDG_CACHE_HOME')
            or os.path.join(os.path.expanduser('~'), '.cache'))
    return os.path.join(base, 'brecho-bgbatch', 'modelos')


def _livre(pasta):
    """Bytes livres no disco onde `pasta` está."""
    import shutil
    alvo = pasta
    while alvo and not os.path.isdir(alvo):
        pai = os.path.dirname(alvo)
        if pai == alvo:
            break
        alvo = pai
    return shutil.disk_usage(alvo or os.getcwd()).free


def baixar_modelo(nome, pasta, quieto=False):
    """Baixa o .onnx se ainda não estiver no cache. Retoma download cortado.

    Vigia o espaço em disco do começo ao fim. São centenas de MB indo para o
    disco de sistema, e um C: em zero byte não é um download que falhou: é o
    Windows sem onde escrever. Ao chegar perto do limite o download para e o
    .parte fica — rodar de novo com espaço continua de onde parou.
    """
    spec = MODELOS[nome]
    destino = os.path.join(pasta, spec['arquivo'])
    if os.path.exists(destino) and os.path.getsize(destino) > 1_000_000:
        return destino

    os.makedirs(pasta, exist_ok=True)
    parcial = destino + '.parte'
    ja = os.path.getsize(parcial) if os.path.exists(parcial) else 0

    faltam = max(0, spec['mb'] * 1024 * 1024 - ja)
    livre = _livre(pasta)
    if livre < faltam + FOLGA_DISCO:
        raise RuntimeError(
            'espaco insuficiente em %s: faltam ~%d MB do modelo e o disco tem '
            '%d MB livres (preciso de %d MB, contando a folga de seguranca '
            'de %d MB)' % (pasta, faltam / 1e6, livre / 1e6,
                           (faltam + FOLGA_DISCO) / 1e6, FOLGA_DISCO / 1e6))
    pedido = urllib.request.Request(spec['url'], headers={'User-Agent': 'bgbatch'})
    if ja:
        pedido.add_header('Range', 'bytes=%d-' % ja)

    if not quieto:
        print('baixando %s (~%d MB) para %s' % (nome, spec['mb'], pasta), file=sys.stderr)
    with urllib.request.urlopen(pedido, timeout=60) as resposta:
        if ja and resposta.status != 206:       # o servidor ignorou o Range
            ja = 0
        total = int(resposta.headers.get('Content-Length') or 0) + ja
        marca = time.time()
        conferido = 0
        with open(parcial, 'ab' if ja else 'wb') as fh:
            while True:
                pedaco = resposta.read(1 << 20)
                if not pedaco:
                    break
                fh.write(pedaco)
                ja += len(pedaco)
                # O disco pode encolher por baixo do download: no Windows o
                # pagefile cresce sozinho e come gigabytes em minutos.
                conferido += len(pedaco)
                if conferido >= 16 << 20:
                    conferido = 0
                    fh.flush()
                    if _livre(pasta) < FOLGA_DISCO:
                        raise RuntimeError(
                            'o disco encheu durante o download (menos de %d MB '
                            'livres). Parei em %.0f MB; o .parte ficou, entao '
                            'rodar de novo com espaco continua daqui.'
                            % (FOLGA_DISCO / 1e6, ja / 1e6))
                if not quieto and time.time() - marca > 0.5:
                    marca = time.time()
                    pct = (' %5.1f%%' % (ja / total * 100)) if total else ''
                    print('\r  %6.1f MB%s' % (ja / 1e6, pct), end='', file=sys.stderr)
    if not quieto:
        print('\r  %6.1f MB  pronto' % (ja / 1e6), file=sys.stderr)
    os.replace(parcial, destino)
    return destino


_sessoes = {}
# Modo econômico: sessão sem a arena do onnxruntime. Começa pelo ambiente e
# pode ser ligado sozinho no meio do caminho — ver _passada().
_economica = os.environ.get('BGBATCH_POUCA_MEMORIA') == '1'
# Modelo pedido → modelo que de fato coube nesta máquina. Uma foto passa pelo
# modelo duas ou três vezes e o servidor atende uma peça atrás da outra: o
# recuo precisa valer para todas elas, senão a passada de detalhe sai de um
# modelo e a global de outro, e a peça seguinte tenta os 973 MB de novo.
_recuo = {}


def sessao(nome=PADRAO, pasta=None, quieto=False, baixar=True):
    """Sessão ONNX do modelo, criada uma vez e reaproveitada: o servidor
    atende várias peças seguidas e carregar 1 GB a cada uma não faz sentido.
    Devolve (sessão, spec).

    `baixar=False` recusa de saída quando o modelo não está no cache, em vez
    de ir buscá-lo. É o que o servidor usa: quem está do outro lado é alguém
    esperando uma peça recortada, e deixá-lo pendurado enquanto 973 MB
    descem (ou não descem, num disco cheio) não é resposta.
    """
    if nome not in MODELOS:
        raise ValueError('modelo desconhecido: %s (tem: %s)'
                         % (nome, ', '.join(sorted(MODELOS))))
    chave = (nome, pasta)
    if chave in _sessoes:
        return _sessoes[chave]

    try:
        import onnxruntime as ort
    except ImportError:
        raise RuntimeError('onnxruntime nao encontrado. Instale com: '
                           'python -m pip install onnxruntime')

    if not baixar:
        caminho = os.path.join(pasta_modelos(pasta), MODELOS[nome]['arquivo'])
        if not os.path.exists(caminho):
            raise RuntimeError(
                'modelo %s nao esta baixado (~%d MB). Rode: '
                'python tools/bgbatch.py --baixar --modelo %s'
                % (nome, MODELOS[nome]['mb'], nome))
    else:
        caminho = baixar_modelo(nome, pasta_modelos(pasta), quieto)
    disponiveis = ort.get_available_providers()
    provedores = [p for p in ('CUDAExecutionProvider', 'DmlExecutionProvider',
                              'CPUExecutionProvider') if p in disponiveis]
    opcoes = ort.SessionOptions()
    opcoes.log_severity_level = 3
    # Número de threads explícito. No automático o onnxruntime prende cada
    # thread a um núcleo (afinidade), e onde isso é proibido — a Lambda — a
    # recusa vira exceção antes de o log existir e o processo morre com
    # "Attempt to use DefaultLogger". Com o número dado, ele não prende nada.
    if os.environ.get('BGBATCH_THREADS'):
        opcoes.intra_op_num_threads = int(os.environ['BGBATCH_THREADS'])
        opcoes.inter_op_num_threads = 1
    # Máquina apertada: o onnxruntime reserva uma arena e reaproveita blocos,
    # o que é rápido e caro. Sem ela cada tensor é pedido e devolvido na hora
    # — mais lento, mas o pico cai o suficiente para o BiRefNet caber.
    #
    # O otimizador de grafo entra junto porque ele é o outro pico, e num
    # momento diferente: para fundir camadas ele monta o grafo novo ao lado do
    # antigo, então a conta dobra *ao carregar*, antes de qualquer inferência.
    # É por isso que um modelo pode falhar sem ter recortado nada.
    if _economica:
        opcoes.enable_cpu_mem_arena = False
        opcoes.enable_mem_pattern = False
        opcoes.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    else:
        opcoes.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    s = ort.InferenceSession(caminho, sess_options=opcoes, providers=provedores)
    _sessoes[chave] = (s, MODELOS[nome])
    return _sessoes[chave]


# ============================ Inferência ==================================
def _rodar(ses, img_rgb):
    """Uma passada do modelo. Devolve a máscara em 0..1, no tamanho do modelo."""
    s, spec = ses
    entrada = s.get_inputs()[0]
    tipo = np.float16 if 'float16' in entrada.type else np.float32

    px = img_rgb.resize((spec['lado'], spec['lado']), Image.BICUBIC)
    x = np.asarray(px, dtype=np.float32) / 255.0
    x = (x - np.array(spec['media'], np.float32)) / np.array(spec['desvio'], np.float32)
    x = np.ascontiguousarray(x.transpose(2, 0, 1)[None], dtype=tipo)

    # Os modelos devolvem várias saídas (as auxiliares do treino vêm junto), e
    # a ordem muda: no BiRefNet a máscara final é a última, no IS-Net é a
    # primeira e a última tem 16×16. A final é sempre a de maior resolução.
    saidas = s.run(None, {entrada.name: x})
    saida = max(saidas, key=lambda a: a.shape[-1] * a.shape[-2])
    y = np.asarray(saida, dtype=np.float32)
    y = y.reshape(y.shape[-2], y.shape[-1])

    # Só aplica sigmoide se a saída for mesmo logit — alguns exports já trazem
    # a probabilidade pronta, e aplicar de novo lavaria a máscara.
    if spec['sigmoide'] and (y.min() < 0.0 or y.max() > 1.0):
        y = 1.0 / (1.0 + np.exp(-np.clip(y, -30.0, 30.0)))
    if spec['normalizar']:
        mi, ma = float(y.min()), float(y.max())
        y = (y - mi) / (ma - mi) if ma > mi else np.zeros_like(y)
    return np.clip(y, 0.0, 1.0)


def _e_falta_de_memoria(erro):
    texto = str(erro).lower()
    return any(m in texto for m in
               ('bad allocation', 'failed to allocate', 'out of memory'))


def _abaixo_na_escada(nome):
    """O próximo modelo mais leve depois de `nome`, ou None no fim da escada.

    Modelo fora da ESCADA (o fp16) não tem para onde recuar: ele já é o caso
    especial, e o degrau abaixo dele seria justamente o que ele tentou evitar.
    """
    if nome not in ESCADA:
        return None
    seguinte = ESCADA.index(nome) + 1
    return ESCADA[seguinte] if seguinte < len(ESCADA) else None


def _passada(nome, pasta, quieto, baixar, img):
    """Uma passada do modelo, com dois degraus de recuo se faltar memória.

    O recorte chama o modelo duas vezes ou mais por foto. A arena do
    onnxruntime guarda o que alocou na primeira chamada para reaproveitar —
    numa máquina folgada é o certo a fazer; numa apertada significa que a
    passada de detalhe não acha mais espaço e a foto morre no meio, depois de
    a passada global ter dado certo.

    Primeiro degrau: a sessão é refeita sem arena e a passada recomeça. Fica
    mais lento e conclui, que é o que importa — o administrador não tem como
    saber que existe uma variável de ambiente para isso.

    Segundo degrau: nem sem arena coube, então o modelo é grande demais para
    esta máquina e desce um degrau da ESCADA. Uma borda um pouco pior é
    melhor que nenhuma peça recortada, e a diferença medida entre o general e
    o lite é de 0,002 de IoU. O recuo fica registrado em `_recuo`: vale para
    as passadas seguintes da mesma foto e para as próximas peças.
    """
    global _economica
    nome = _recuo.get(nome, nome)
    try:
        return _rodar(sessao(nome, pasta, quieto, baixar), img)
    except Exception as e:                       # noqa: BLE001
        if _economica or not _e_falta_de_memoria(e):
            raise
        if not quieto:
            print('\nmemoria curta: refazendo a sessao em modo economico '
                  '(mais lento)', file=sys.stderr)
        _economica = True
        _sessoes.pop((nome, pasta), None)
        try:
            return _rodar(sessao(nome, pasta, quieto, baixar), img)
        except Exception as e2:                  # noqa: BLE001
            if not _e_falta_de_memoria(e2):
                raise
            return _recuar(nome, pasta, quieto, baixar, img, e2)


def _recuar(nome, pasta, quieto, baixar, img, causa):
    """Desce a ESCADA até um modelo que caiba, e refaz a passada nele."""
    _sessoes.pop((nome, pasta), None)
    original, alvo = nome, _abaixo_na_escada(nome)

    while alvo:
        if not quieto:
            print('\nmemoria curta para %s (%d MB): recuando para %s (%d MB)'
                  % (nome, MODELOS[nome]['mb'], alvo, MODELOS[alvo]['mb']),
                  file=sys.stderr)
        try:
            mascara = _rodar(sessao(alvo, pasta, quieto, baixar), img)
        except Exception as e:                   # noqa: BLE001
            # Modelo que não está no cache também não serve de degrau: o
            # servidor roda com baixar=False justamente para não deixar
            # ninguém pendurado esperando um download.
            _sessoes.pop((alvo, pasta), None)
            causa = e
            nome, alvo = alvo, _abaixo_na_escada(alvo)
            continue
        # Deu certo: as próximas passadas e as próximas peças já nascem aqui.
        _recuo[original] = alvo
        return mascara

    # Fim da escada. "bad allocation" não diz nada a quem só queria subir uma
    # peça; dizer que nem o modelo mais leve coube, sim. O que fazer a
    # respeito é a tela de adicionar que diz — aqui a mensagem também vai
    # para o terminal de quem roda o lote, e repetir a receita nos dois
    # lugares só faz o balão da tela dizer a mesma coisa duas vezes.
    raise RuntimeError(
        'sem memoria para recortar nesta maquina, nem no modelo mais leve '
        '(%s, %d MB)' % (ESCADA[-1], MODELOS[ESCADA[-1]]['mb'])
    ) from causa


def _redimensionar(mascara, tamanho):
    """Máscara para outro tamanho, em float — sem passar por uint8, que
    deixaria degrau visível na borda depois do esticão de contraste.

    O bicúbico toca a sineta numa transição dura de 0 para 1: devolve valores
    um pouco abaixo de 0 e acima de 1 em volta da silhueta. Alpha fora da
    faixa não quer dizer nada e ainda estragaria a conta do halo (com a > 1 o
    termo (1-a) fica negativo), então corta aqui mesmo."""
    im = Image.fromarray(np.ascontiguousarray(mascara, dtype=np.float32), 'F')
    esticada = np.asarray(im.resize(tamanho, Image.BICUBIC), dtype=np.float32)
    return np.clip(esticada, 0.0, 1.0)


def _para_rgb(img):
    """Foto de entrada em RGB. PNG que já vem com alpha é achatado sobre
    branco: é o fundo de estúdio que o modelo espera ver."""
    if img.mode in ('RGBA', 'LA', 'P'):
        rgba = img.convert('RGBA')
        branco = Image.new('RGBA', rgba.size, (255, 255, 255, 255))
        img = Image.alpha_composite(branco, rgba)
    return img.convert('RGB')


def _caixa(mascara, limite=0.5, folga=FOLGA_DETALHE):
    """Caixa do que a máscara marcou, com folga proporcional."""
    ys, xs = np.nonzero(mascara > limite)
    if not len(xs):
        return None
    h, w = mascara.shape
    mx = int(round(max(w, h) * folga))
    return (max(0, int(xs.min()) - mx), max(0, int(ys.min()) - mx),
            min(w, int(xs.max()) + 1 + mx), min(h, int(ys.max()) + 1 + mx))


# ============================ Borda =======================================
def _media_movel(arr, raio):
    """Borrão de caixa por soma acumulada — uma passada por eixo. Feito à mão
    para o script não precisar de scipy nem de opencv."""
    saida = np.asarray(arr, dtype=np.float32)
    if raio <= 0:
        return saida
    janela = 2 * raio + 1
    # A soma acumulada de uma imagem 2048² chega a milhares; em float32 isso
    # come os dígitos do fim. Tirar a média antes mantém os números perto de
    # zero, e ela volta no fim — o borrão de um campo constante é ele mesmo.
    base = float(saida.mean())
    saida = saida - base
    for eixo in (0, 1):
        a = np.swapaxes(saida, 0, eixo)
        pad = np.pad(a, [(raio, raio)] + [(0, 0)] * (a.ndim - 1), mode='edge')
        acum = np.concatenate([np.zeros((1,) + pad.shape[1:], np.float32),
                               np.cumsum(pad, axis=0, dtype=np.float32)])
        a = (acum[janela:] - acum[:-janela]) / janela
        saida = np.swapaxes(a, 0, eixo)
    return saida + base


def _cor_por_perto(rgb, peso, raio):
    """Média da cor da vizinhança contando só os pixels marcados por `peso`.
    Onde não houver nenhum marcado por perto, devolve a própria imagem."""
    num = _media_movel(rgb * peso[..., None], raio)
    den = _media_movel(peso, raio)[..., None]
    return np.where(den > 1e-3, num / np.maximum(den, 1e-6), rgb)


def _limpar_borda(rgb, alpha, raio):
    """Tira a cor do fundo que ficou presa no pixel semitransparente.

    A imagem observada é I = a·F + (1-a)·B, e o que se quer guardar é o F. O B
    sai da média da vizinhança onde o alpha é ~0 — o próprio fundo em volta da
    peça —, e daí o F se isola por conta. Sem isso a peça leva para a
    prancheta uma franja da cor do estúdio: o halo claro.

    Só que isolar o F assim supõe que o pixel de fato *misturou* peça e fundo.
    A máscara do modelo sai de 1024² e é esticada; ela erra a silhueta por um
    ou dois pixels com frequência, e aí a faixa semitransparente cai em cima
    de fundo puro. A conta então acerta e entrega o que viu — fundo —, que
    recomposto vira de novo o halo.

    Daí as duas estimativas. Onde a observação ainda se distingue do fundo,
    ela manda: tem informação de peça ali. Onde ela é o próprio fundo, a cor
    vem do tecido logo ao lado, e o pixel vira uma borda serrilhada de
    verdade em vez de uma franja clara.
    """
    peso_fundo = (alpha < FUNDO_LIMITE).astype(np.float32)
    if float(peso_fundo.sum()) < 64:
        return rgb                                   # foto sem fundo visível

    fundo = _cor_por_perto(rgb, peso_fundo, raio)

    a = alpha[..., None]
    observada = np.clip((rgb - (1.0 - a) * fundo) / np.clip(a, 0.15, 1.0), 0.0, 1.0)

    peso_peca = (alpha > 0.9).astype(np.float32)
    if float(peso_peca.sum()) >= 64:
        vizinha = _cor_por_perto(rgb, peso_peca, raio)
        forca = np.clip(np.abs(observada - fundo).max(axis=2) / 0.12, 0.0, 1.0)
        frente = observada * forca[..., None] + vizinha * (1.0 - forca[..., None])
    else:
        frente = observada

    # Correção só onde há mistura: no miolo opaco a imagem já é o tecido.
    t = np.clip((0.99 - alpha) / 0.35, 0.0, 1.0)[..., None]
    return rgb * (1.0 - t) + frente * t


def _refinar_ladrilhos(rodar, rgb_plena, alpha, tiles):
    """Refaz a faixa de incerteza da máscara em pedaços, cada um em 1024².

    Só mexe onde a máscara está indecisa (0.02 < a < 0.98). Ladrilho que cai
    inteiro dentro da peça ou inteiro no fundo é pulado, e o resultado entra
    com uma janela suave, para não deixar costura entre pedaços.
    """
    h, w = alpha.shape
    banda = (alpha > 0.02) & (alpha < 0.98)
    if not banda.any():
        return alpha

    passo_x, passo_y = w / tiles, h / tiles
    lado_x, lado_y = passo_x * 1.25, passo_y * 1.25      # 25% de sobreposição
    soma = np.zeros_like(alpha)
    peso = np.zeros_like(alpha)

    for ty in range(tiles):
        for tx in range(tiles):
            x0 = int(max(0, round(tx * passo_x - (lado_x - passo_x) / 2)))
            y0 = int(max(0, round(ty * passo_y - (lado_y - passo_y) / 2)))
            x1 = int(min(w, round(x0 + lado_x)))
            y1 = int(min(h, round(y0 + lado_y)))
            if x1 - x0 < 16 or y1 - y0 < 16 or not banda[y0:y1, x0:x1].any():
                continue
            m = _redimensionar(rodar(rgb_plena.crop((x0, y0, x1, y1))),
                               (x1 - x0, y1 - y0))
            jan = np.outer(np.hanning(y1 - y0 + 2)[1:-1],
                           np.hanning(x1 - x0 + 2)[1:-1]).astype(np.float32) + 1e-3
            soma[y0:y1, x0:x1] += m * jan
            peso[y0:y1, x0:x1] += jan

    feito = peso > 1e-3
    refinada = np.where(feito, soma / np.maximum(peso, 1e-6), alpha)
    # Fora da faixa de incerteza a máscara de detalhe manda: um ladrilho que
    # só enxerga tecido chega a "descobrir" uma peça numa dobra de manga.
    mistura = np.clip(_media_movel(banda.astype(np.float32), 3) * 3.0, 0.0, 1.0)
    return alpha * (1.0 - mistura) + refinada * mistura


# ============================ Recorte =====================================
def recortar(img, modelo=PADRAO, pasta_modelo=None, tiles=0, nitidez=1.8,
             limpar=True, maior_lado=2048, quieto=False, baixar=True):
    """A foto crua entra, o recorte RGBA sai — já aparado na peça.

    `nitidez` desfaz o amolecimento que o esticão da máscara de 1024 para a
    resolução plena deixa na borda (1.0 desliga). `tiles` liga a passada 3.
    `baixar=False` falha na hora se o modelo ainda não estiver no cache.
    """
    def rodar(quadro):
        return _passada(modelo, pasta_modelo, quieto, baixar, quadro)

    rgb = _para_rgb(img)
    w, h = rgb.size

    # 1. onde está a peça
    global_ = _redimensionar(rodar(rgb), (w, h))
    caixa = _caixa(global_)
    if caixa is None:
        raise ValueError('nao achei objeto nenhum nessa foto')

    # 2. a peça sozinha, em resolução plena, ocupando o quadro inteiro
    x0, y0, x1, y1 = caixa
    recorte = rgb.crop(caixa)
    if min(recorte.size) >= 16 and max(recorte.size) < max(w, h) * 0.995:
        alpha = np.zeros((h, w), np.float32)
        alpha[y0:y1, x0:x1] = _redimensionar(rodar(recorte), recorte.size)
    else:
        alpha = global_                  # a peça já ocupava a foto inteira

    # 3. faixa de incerteza em pedaços (opcional)
    if tiles and int(tiles) > 1:
        alpha = _refinar_ladrilhos(rodar, rgb, alpha, int(tiles))

    # 4. borda: contraste e descontaminação de cor
    if nitidez and abs(float(nitidez) - 1.0) > 1e-6:
        alpha = np.clip((alpha - 0.5) * float(nitidez) + 0.5, 0.0, 1.0)

    arr = np.asarray(rgb, np.float32) / 255.0
    if limpar:
        arr = _limpar_borda(arr, alpha, max(3, int(round(max(w, h) * 0.004))))

    saida = Image.fromarray(np.concatenate([
        np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8),
        np.clip(alpha[..., None] * 255.0 + 0.5, 0, 255).astype(np.uint8),
    ], axis=2), 'RGBA')

    # 5. apara no que sobrou visível e ajusta ao tamanho do máster
    corte = saida.getchannel('A').point(lambda v: 255 if v >= 8 else 0).getbbox()
    if corte:
        saida = saida.crop(corte)
    if maior_lado and max(saida.size) > maior_lado:
        saida.thumbnail((maior_lado, maior_lado), Image.LANCZOS)
    return saida


def tem_alpha(img, limite=0.985):
    """A imagem já vem recortada? (mesmo critério do adicionar.js)"""
    if img.mode not in ('RGBA', 'LA', 'P'):
        return False
    a = np.asarray(img.convert('RGBA').getchannel('A'))
    return bool((a >= 10).sum() < a.size * limite)


# ============================== Lote ======================================
EXTENSOES = ('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff')


def main():
    aqui = os.path.dirname(os.path.abspath(__file__))
    app = os.path.dirname(aqui)
    cloths = os.path.join(os.path.dirname(app), 'Cloths')

    ap = argparse.ArgumentParser(
        description='Remove o fundo das fotos em lote, em alta resolucao.')
    ap.add_argument('--src', default=os.path.join(cloths, 'brutas'),
                    help='pasta com as fotos cruas')
    ap.add_argument('--out', default=cloths,
                    help='pasta onde os masters PNG sao gravados')
    ap.add_argument('--modelo', default=PADRAO, choices=sorted(MODELOS),
                    help='qual modelo usar')
    ap.add_argument('--modelos', default=None, help='pasta de cache dos .onnx')
    ap.add_argument('--max', type=int, default=2048,
                    help='maior lado do master (0 = resolucao original)')
    ap.add_argument('--tiles', type=int, default=0,
                    help='refina a borda em NxN pedacos em alta (0 = desligado)')
    ap.add_argument('--nitidez', type=float, default=1.8,
                    help='contraste da borda; 1.0 desliga')
    ap.add_argument('--sem-limpeza', action='store_true',
                    help='nao descontamina a cor da borda')
    ap.add_argument('--refazer-transparentes', action='store_true',
                    help='processa tambem quem ja tem alpha')
    ap.add_argument('--force', action='store_true',
                    help='reprocessa mesmo se o master ja existe')
    ap.add_argument('--baixar', action='store_true',
                    help='so baixa o modelo e sai')
    args = ap.parse_args()

    if args.baixar:
        print('modelo em ' + baixar_modelo(args.modelo, pasta_modelos(args.modelos)))
        return

    if not os.path.isdir(args.src):
        sys.exit('pasta nao encontrada: %s\n(crie ela e jogue as fotos cruas ali)'
                 % args.src)
    arquivos = sorted(f for f in os.listdir(args.src)
                      if f.lower().endswith(EXTENSOES))
    if not arquivos:
        sys.exit('nenhuma imagem em ' + args.src)
    os.makedirs(args.out, exist_ok=True)

    feitos = pulados = falhas = 0
    largura = len(str(len(arquivos)))
    for n, nome in enumerate(arquivos, 1):
        base = os.path.splitext(nome)[0]
        destino = os.path.join(args.out, base + '.png')
        rotulo = '[%*d/%d] %s' % (largura, n, len(arquivos), nome)

        if os.path.exists(destino) and not args.force:
            print(rotulo + '  (master ja existe, pulando)')
            pulados += 1
            continue

        marca = time.time()
        try:
            with Image.open(os.path.join(args.src, nome)) as img:
                img.load()
                if tem_alpha(img) and not args.refazer_transparentes:
                    print(rotulo + '  (ja tem alpha, pulando)')
                    pulados += 1
                    continue
                pronta = recortar(
                    img, modelo=args.modelo, pasta_modelo=args.modelos,
                    tiles=args.tiles, nitidez=args.nitidez,
                    limpar=not args.sem_limpeza, maior_lado=args.max)
        except Exception as e:                       # noqa: BLE001
            print(rotulo + '  ERRO: %s' % e)
            falhas += 1
            continue

        tmp = destino + '.tmp'
        pronta.save(tmp, 'PNG', optimize=True)
        os.replace(tmp, destino)
        feitos += 1
        print('%s  -> %s  %dx%d  %.0f KB  %.1fs' % (
            rotulo, os.path.basename(destino), pronta.size[0], pronta.size[1],
            os.path.getsize(destino) / 1024, time.time() - marca))

    print('\n%d recortadas, %d puladas, %d com erro' % (feitos, pulados, falhas))


if __name__ == '__main__':
    main()
