#!/usr/bin/env bash
# Publica a Lambda da API. Rode do Git Bash:
#
#     bash nuvem/infra/publicar-api.sh
#
# Reempacota os módulos de `nuvem/lambda/` e manda para a função. Não mexe na
# camada do Pillow (`brecho-pillow`) — ela só precisa ser refeita se a versão do
# Pillow mudar, e aí é `publicar-camada.sh`.
set -euo pipefail

export PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"
export MSYS_NO_PATHCONV=1

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Caminho no formato do Windows: o aws.exe e o python.exe não entendem /c/Users.
# No Linux (GitHub Actions) não há cygpath, e o caminho já serve como está.
win() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }
export ZIP="$(win "$AQUI/..")/.brecho-funcao.zip"

# pipeline.py é do App — a Lambda usa o mesmo contour_of da geração das peças,
# então a cópia é feita na hora de empacotar e nunca diverge do original.
cp "$AQUI/../App/tools/pipeline.py" "$AQUI/lambda/pipeline.py"

( cd "$AQUI/lambda" && python -c "
import os, zipfile
alvo = os.environ['ZIP']
with zipfile.ZipFile(alvo, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for nome in ('app.py', 'contas.py', 'estado.py', 'pessoas.py', 'estoque.py', 'acervo.py', 'esteira.py', 'feed.py', 'pipeline.py'):
        z.write(nome)
print('empacotado: %.1f KB' % (os.path.getsize(alvo) / 1024))
" )

aws lambda update-function-code --function-name brecho-api \
  --zip-file "fileb://$ZIP" \
  --query '{Funcao:FunctionName,Tamanho:CodeSize,Versao:Version}' --output table

aws lambda wait function-updated-v2 --function-name brecho-api
rm -f "$AQUI/../.brecho-funcao.zip"
echo "== API publicada"
