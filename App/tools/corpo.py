"""Corpos e narizes desenhados pela artista → js/corpo-artista.js.

    python tools/corpo.py masculino=corpo-m.png feminino=corpo-f.png \
        botao=n1.png pontudo=n2.png redondo=n3.png reto=n4.png curvo=n5.png

A artista entrega PNG do Procreate, todos na mesma tela (fundo transparente),
com a peça já na posição dela: o nariz cai na cara do corpo sem ninguém mexer.
Cada desenho vira duas máscaras em tons de cinza, no palco de 600×1200:

- pele: a silhueta inteira (a transparência do PNG);
- linha: o traço, achado pela cor (o marrom escuro do contorno contra o
  bege do preenchimento).

O avatar pinta a pele com a cor da pele e a linha com a do traço de quem está
vestido (ver svgAvatar em js/avatar.js), então o mesmo desenho serve a qualquer
tom. Nariz só de traço não leva máscara de pele.

O corpo masculino manda no enquadramento: o topo da cabeça vai para y=38 e a
sola para y=1147 (o chão do molde, mais a linha), centrado em x=300. Os outros
desenhos usam a mesma conta, para continuarem alinhados com ele.
"""
import base64
import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image

NOMES_CORPOS = {'masculino': 'Masculino', 'feminino': 'Feminino'}
NOMES_NARIZES = {
    'botao': 'Botão', 'pontudo': 'Pontudo', 'redondo': 'Redondo',
    'reto': 'Reto', 'curvo': 'Curvo',
}
TOPO, SOLA, MEIO = 38, 1147, 300
RES = 1.5                      # pixels da máscara por unidade do palco
R_PELE, R_LINHA = 196, 122     # canal vermelho do preenchimento e do traço
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


def mascaras(caminho, k, dx, dy):
    """{caixa: [x, y, w, h] no palco, pele, linha} recortado no desenho."""
    rgba = np.asarray(Image.open(caminho).convert('RGBA')).astype(float)
    alfa = rgba[..., 3] / 255
    traco = np.clip((R_PELE - rgba[..., 0]) / (R_PELE - R_LINHA), 0, 1)
    x0, y0, x1, y1 = Image.open(caminho).getchannel('A').getbbox()
    x0, y0 = max(x0 - 4, 0), max(y0 - 4, 0)
    x1, y1 = x1 + 4, y1 + 4
    caixa = [x0 * k + dx, y0 * k + dy, (x1 - x0) * k, (y1 - y0) * k]
    tam = (round(caixa[2] * RES), round(caixa[3] * RES))

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


def js(nome, itens, nomes):
    linhas = [f'  {nome}: {{']
    for id_, m in itens.items():
        linhas.append(f"    {id_}: {{ nome: '{nomes[id_]}', caixa: {m['caixa']},")
        if 'pele' in m:
            linhas.append(f"      pele: '{m['pele']}',")
        linhas.append(f"      linha: '{m['linha']}' }},")
    linhas.append('  },')
    return '\n'.join(linhas)


def main(args):
    pedidos = dict(a.split('=', 1) for a in args)
    if 'masculino' not in pedidos:
        sys.exit('falta masculino=<png>: é ele que enquadra os outros')
    k, dx, dy = enquadramento(Image.open(pedidos['masculino']).getchannel('A'))
    corpos = {i: mascaras(pedidos[i], k, dx, dy) for i in NOMES_CORPOS if i in pedidos}
    narizes = {i: mascaras(pedidos[i], k, dx, dy) for i in NOMES_NARIZES if i in pedidos}
    SAIDA.write_text(
        '// Corpos e narizes desenhados pela artista, já no palco 600×1200.\n'
        '// Gerado por tools/corpo.py: não edite à mão. Cada desenho é uma máscara\n'
        '// de pele e uma de traço (em tons de cinza), recortadas na `caixa`\n'
        '// [x, y, w, h] do palco; o avatar pinta as duas com as cores de quem veste.\n'
        '//\n'
        '// Só é carregado com ?proporcao=artista (ver js/proporcao.js e js/app.js).\n'
        'export default {\n'
        + js('corpos', corpos, NOMES_CORPOS) + '\n'
        + js('narizes', narizes, NOMES_NARIZES) + '\n'
        '};\n', encoding='utf-8')
    print(SAIDA, f'{SAIDA.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main(sys.argv[1:])
