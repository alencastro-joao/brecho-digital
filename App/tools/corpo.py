"""Corpos, narizes e cabelos desenhados pela artista → js/corpo-artista.js.

    python tools/corpo.py masculino=corpo-m.png feminino=corpo-f.png \
        botao=n1.png pontudo=n2.png redondo=n3.png reto=n4.png curvo=n5.png \
        largo=n6.png curto=c1.png afro=c2.png ...

Cada execução gera o arquivo inteiro: passe todos os desenhos de novo.

A artista entrega PNG do Procreate, todos na mesma tela (fundo transparente),
com a peça já na posição dela: o nariz cai na cara do corpo sem ninguém mexer.
Cada desenho vira duas máscaras em tons de cinza, no palco de 600×1200:

- pele: a silhueta inteira (a transparência do PNG);
- linha: o traço, achado pela cor (o marrom escuro do contorno contra o
  bege do preenchimento).

O avatar pinta a pele com a cor da pele e a linha com a do traço de quem está
vestido (ver svgAvatar em js/avatar.js), então o mesmo desenho serve a qualquer
tom. Nariz só de traço não leva máscara de pele.

Cabelo é igual, mas pintado com a cor do cabelo (o traço, mais escuro) e em
duas partes: `atras`, o cabelo inteiro, vai antes do corpo e da roupa (o
volume em volta e a ponta que desce além do ombro ficam por trás do casaco);
`frente`, só o que cai em cima do corpo (franja, mecha no ombro), vai de novo
por cima da roupa. A artista já desenha o cabelo vazado onde o corpo o
cobriria, então a divisão sai da silhueta dos corpos. Com o inteiro atrás, a
emenda das duas partes não aparece.

O corpo masculino manda no enquadramento: o topo da cabeça vai para y=38 e a
sola para y=1147 (o chão do molde, mais a linha), centrado em x=300. Os outros
desenhos usam a mesma conta, para continuarem alinhados com ele.
"""
import base64
import io
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

NOMES_CORPOS = {'masculino': 'Masculino', 'feminino': 'Feminino'}
NOMES_NARIZES = {
    'botao': 'Botão', 'pontudo': 'Pontudo', 'redondo': 'Redondo',
    'reto': 'Reto', 'curvo': 'Curvo', 'largo': 'Largo',
}
NOMES_CABELOS = {
    'curto': 'Curto', 'franja': 'Franja', 'pixie': 'Desfiado',
    'espetado': 'Espetado', 'crespo': 'Crespo', 'afro': 'Afro',
    'mullet': 'Mullet', 'ondulado': 'Ondulado', 'cacheado': 'Cacheado',
    'cachos': 'Cachos', 'trancas': 'Tranças', 'coque': 'Meio preso',
}
TOPO, SOLA, MEIO = 38, 1147, 300
PESCOCO = 190                  # altura do queixo no palco
RES = 1.5                      # pixels da máscara por unidade do palco
RES_CABELO = 1.2               # menos no cabelo: são doze, e o fio crespo não comprime
R_PELE, R_LINHA = 196, 122     # canal vermelho do preenchimento e do traço
R_CABELO, R_FIO = 100, 53      # o mesmo, no cabelo
SAIDA = Path(__file__).resolve().parent.parent / 'js' / 'corpo-artista.js'


def enquadramento(alfa):
    """Escala e deslocamento (do PNG para o palco) pelo corpo masculino."""
    x0, y0, x1, y1 = alfa.getbbox()
    k = (SOLA - TOPO) / (y1 - y0)
    return k, MEIO - k * (x0 + x1) / 2, TOPO - k * y0


def png64(mascara):
    buf = io.BytesIO()
    mascara.save(buf, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


def mascaras(caminho, k, dx, dy, cores=(R_PELE, R_LINHA), parte=None, res=RES):
    """{caixa: [x, y, w, h] no palco, pele, linha} recortado no desenho.

    `parte` (0 a 1, do tamanho do PNG) fica só com aquele pedaço do desenho;
    sem nada nele, devolve None.
    """
    rgba = np.asarray(Image.open(caminho).convert('RGBA')).astype(float)
    alfa = rgba[..., 3] / 255
    if parte is not None:
        alfa = alfa * parte
    fundo, linha = cores
    traco = np.clip((fundo - rgba[..., 0]) / (fundo - linha), 0, 1)
    if alfa.max() < 0.5:
        return None
    x0, y0, x1, y1 = Image.fromarray((alfa * 255).astype('uint8')).getbbox()
    x0, y0 = max(x0 - 4, 0), max(y0 - 4, 0)
    x1, y1 = x1 + 4, y1 + 4
    caixa = [x0 * k + dx, y0 * k + dy, (x1 - x0) * k, (y1 - y0) * k]
    tam = (round(caixa[2] * res), round(caixa[3] * res))

    def cinza(m):
        img = Image.fromarray((m[y0:y1, x0:x1] * 255).round().astype('uint8'), 'L')
        # 16 tons bastam para a borda sair lisa e deixam o arquivo um terço
        # do tamanho (o traço tremido de lápis não comprime).
        return img.resize(tam, Image.LANCZOS).point(lambda v: round(v / 17) * 17)

    pele = alfa * (traco < 0.5)       # só preenchimento: nariz de traço não tem
    out = {'caixa': [round(v, 2) for v in caixa], 'linha': png64(cinza(alfa * traco))}
    if pele.sum() > 50:
        out['pele'] = png64(cinza(alfa))
    return out


def bloco_desenho(id_, nome, m):
    linhas = [f"    {id_}: {{ nome: '{nome}', caixa: {m['caixa']},"]
    if 'pele' in m:
        linhas.append(f"      pele: '{m['pele']}',")
    linhas.append(f"      linha: '{m['linha']}' }},")
    return '\n'.join(linhas)


def bloco_cabelo(id_, nome, partes):
    linhas = [f"    {id_}: {{ nome: '{nome}',"]
    for parte, m in partes.items():
        if m:
            linhas.append(f"      {parte}: {{ caixa: {m['caixa']},")
            if 'pele' in m:
                linhas.append(f"        pele: '{m['pele']}',")
            linhas.append(f"        linha: '{m['linha']}' }},")
    linhas.append('    },')
    return '\n'.join(linhas)


def ja_gerados():
    """{seção: {id: bloco}} do arquivo de agora, para o que não veio de novo
    continuar como está (a artista pode mandar só o que mudou)."""
    if not SAIDA.exists():
        return {}
    secoes, secao, id_ = {}, None, None
    for linha in SAIDA.read_text(encoding='utf-8').splitlines():
        m = re.match(r'  (\w+): \{$', linha)
        if m:
            secao, id_ = m.group(1), None
            secoes[secao] = {}
            continue
        m = re.match(r'    (\w+): \{', linha)
        if secao and m:
            id_ = m.group(1)
            secoes[secao][id_] = []
        if secao and id_ and linha.startswith('    '):
            secoes[secao][id_].append(linha)
    return {s: {i: '\n'.join(b) for i, b in ids.items()} for s, ids in secoes.items()}


def js(secao, novos, nomes, antigos):
    """A seção na ordem de `nomes`: o desenho novo, senão o que já existia."""
    blocos = [novos.get(i) or antigos.get(secao, {}).get(i) for i in nomes]
    return f'  {secao}: {{\n' + '\n'.join(b for b in blocos if b) + '\n  },'


def presos_na_cabeca(mascara, ate_y):
    """Só os pedaços de `mascara` (0/1) ligados ao que ela tem acima de `ate_y`:
    a ponta que aparece sozinha no vão entre o braço e o tronco fica de fora."""
    x0, y0, x1, y1 = Image.fromarray((mascara * 255).astype('uint8')).getbbox()
    dentro = mascara[y0:y1, x0:x1] > 0
    pedaco = dentro.copy()
    pedaco[max(ate_y - y0, 0):] = False
    while True:
        maior = (np.asarray(Image.fromarray(pedaco.astype('uint8') * 255)
                            .filter(ImageFilter.MaxFilter(9))) > 0) & dentro
        if (maior == pedaco).all():
            break
        pedaco = maior
    saida = np.zeros_like(mascara)
    saida[y0:y1, x0:x1] = pedaco
    return saida


def cabelo(caminho, sobre_corpo, k, dx, dy):
    """As duas partes do cabelo: o inteiro, de trás, e o que cai em cima do
    corpo saindo da cabeça (franja, mecha no ombro), na frente."""
    cores = (R_CABELO, R_FIO)
    alfa = np.asarray(Image.open(caminho).getchannel('A')) / 255
    na_frente = presos_na_cabeca(((alfa > 0) * sobre_corpo).astype(float),
                                 round((PESCOCO - dy) / k))
    return {
        'atras': mascaras(caminho, k, dx, dy, cores, res=RES_CABELO),
        'frente': mascaras(caminho, k, dx, dy, cores, na_frente, RES_CABELO),
    }


def main(args):
    pedidos = dict(a.split('=', 1) for a in args)
    if 'masculino' not in pedidos:
        sys.exit('falta masculino=<png>: é ele que enquadra os outros')
    k, dx, dy = enquadramento(Image.open(pedidos['masculino']).getchannel('A'))
    corpos = {i: mascaras(pedidos[i], k, dx, dy) for i in NOMES_CORPOS if i in pedidos}
    narizes = {i: mascaras(pedidos[i], k, dx, dy) for i in NOMES_NARIZES if i in pedidos}
    # Onde qualquer um dos corpos tem pele, com uns pixels a mais em volta: o
    # cabelo que cai ali vai na frente e cobre também o contorno do corpo.
    sobre_corpo = np.zeros((1, 1))
    for i in NOMES_CORPOS:
        if i in pedidos:
            a = (Image.open(pedidos[i]).getchannel('A')
                 .point(lambda v: 255 if v > 8 else 0).filter(ImageFilter.MaxFilter(9)))
            sobre_corpo = np.maximum(sobre_corpo, np.asarray(a) / 255)
    cabelos = {i: cabelo(pedidos[i], sobre_corpo, k, dx, dy)
               for i in NOMES_CABELOS if i in pedidos}
    antigos = ja_gerados()
    corpos = {i: bloco_desenho(i, NOMES_CORPOS[i], m) for i, m in corpos.items()}
    narizes = {i: bloco_desenho(i, NOMES_NARIZES[i], m) for i, m in narizes.items()}
    cabelos = {i: bloco_cabelo(i, NOMES_CABELOS[i], m) for i, m in cabelos.items()}
    SAIDA.write_text(
        '// Corpos, narizes e cabelos desenhados pela artista, já no palco 600×1200.\n'
        '// Gerado por tools/corpo.py: não edite à mão. Cada desenho é uma máscara\n'
        '// de pele e uma de traço (em tons de cinza), recortadas na `caixa`\n'
        '// [x, y, w, h] do palco; o avatar pinta as duas com as cores de quem veste.\n'
        '//\n'
        '// É o corpo de todo mundo (NA_TELA em js/proporcao.js; carregado em js/app.js).\n'
        'export default {\n'
        + js('corpos', corpos, NOMES_CORPOS, antigos) + '\n'
        + js('narizes', narizes, NOMES_NARIZES, antigos) + '\n'
        + js('cabelos', cabelos, NOMES_CABELOS, antigos) + '\n'
        '};\n', encoding='utf-8')
    print(SAIDA, f'{SAIDA.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main(sys.argv[1:])
