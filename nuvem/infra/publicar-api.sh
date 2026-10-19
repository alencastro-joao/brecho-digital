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
    # Todo .py da pasta entra: uma lista fixa esqueceu o redes.py e a Lambda
    # inteira caiu no import (login fora do ar).
    for nome in sorted(os.listdir('.')):
        if nome.endswith('.py'):
            z.write(nome)
print('empacotado: %.1f KB' % (os.path.getsize(alvo) / 1024))
" )

aws lambda update-function-code --function-name brecho-api \
  --zip-file "fileb://$ZIP" \
  --query '{Funcao:FunctionName,Tamanho:CodeSize,Versao:Version}' --output table

aws lambda wait function-updated-v2 --function-name brecho-api
rm -f "$AQUI/../.brecho-funcao.zip"
echo "== API publicada"

# Sem BD_SEGREDO_ORIGEM a função aceita pedido que não passou pelo CloudFront
# (ver o topo de nuvem/lambda/app.py). Confere só se existe; o valor nunca é
# impresso.
if ! segredo="$(aws lambda get-function-configuration --function-name brecho-api \
    --query 'Environment.Variables.BD_SEGREDO_ORIGEM' --output text 2>/dev/null)"; then
  echo "== não consegui conferir o BD_SEGREDO_ORIGEM (sem permissão de leitura?)"
elif [ -z "$segredo" ] || [ "$segredo" = "None" ]; then
  echo "::warning::A Lambda brecho-api está sem BD_SEGREDO_ORIGEM: a Function URL aceita pedido direto, sem o CloudFront."
else
  echo "== BD_SEGREDO_ORIGEM configurado"
fi
unset segredo
