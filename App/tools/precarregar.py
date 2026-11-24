"""Lista os módulos que o index.html vai pedir, para o publicar.sh pôr um
<link rel="modulepreload"> de cada um no <head>.

Sem build, o navegador só descobre os imports de um módulo depois de baixá-lo:
são 8 níveis de app.js até o último, e cada nível custa uma ida à AWS (uns
0,5 s do Brasil). Com a lista no HTML, ele pede todos de uma vez.

Uso: python App/tools/precarregar.py App   -> imprime as tags, uma por linha.
"""
import os
import re
import sys

# import ... from './x.js'  |  export ... from './x.js'  |  import './x.js'
IMPORT = re.compile(r"""(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*['"](\.[^'"]+)['"]"""
                    r"""|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]""")
# Os <script type="module" src="js/..."> do index.html.
SCRIPT = re.compile(r"""<script\s+type="module"\s+src="([^"]+)\"""")
# Carregados com import() no boot de todo mundo (js/proporcao.js: NA_TELA).
EXTRAS = ['js/corpo-artista.js']


def modulos(app):
    with open(os.path.join(app, 'index.html'), encoding='utf-8') as f:
        raizes = SCRIPT.findall(f.read())
    vistos, fila = [], list(raizes) + EXTRAS
    while fila:
        rel = os.path.normpath(fila.pop(0)).replace(os.sep, '/')
        caminho = os.path.join(app, rel)
        if rel in vistos or not os.path.isfile(caminho):
            continue
        vistos.append(rel)
        with open(caminho, encoding='utf-8') as f:
            codigo = f.read()
        for a, b in IMPORT.findall(codigo):
            fila.append(os.path.join(os.path.dirname(rel), a or b))
    return vistos


if __name__ == '__main__':
    for m in modulos(sys.argv[1] if len(sys.argv) > 1 else 'App'):
        print('<link rel="modulepreload" href="%s">' % m)
