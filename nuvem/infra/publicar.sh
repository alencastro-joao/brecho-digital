#!/usr/bin/env bash
# Publica o front no S3. Rode do Git Bash, de qualquer pasta:
#
#     bash nuvem/infra/publicar.sh
#
# Só sobe o que mudou (é o que o `s3 sync` faz), então republicar é rápido e
# quase de graça. Não invalida o CloudFront: o HTML, o CSS e o JS
# sobem com `no-cache`, então o CloudFront revalida por ETag e a mudança
# aparece na hora, sem gastar invalidação. As imagens das peças sobem imutáveis
# por um ano porque o nome do arquivo é o id da peça.
set -euo pipefail

export PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"
export MSYS_NO_PATHCONV=1

SITE=brecho-site-108826053014
DADOS=brecho-dados-108826053014

# O aws.exe é binário do Windows: ele não entende o /c/Users/... do Git Bash.
# cygpath traduz, e MSYS_NO_PATHCONV impede o Git Bash de traduzir de volta.
# No Linux (GitHub Actions) não há cygpath, e o caminho já serve como está.
win() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }
APP="$(win "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../App" && pwd)")"

REVALIDA='no-cache, must-revalidate'
ETERNO='public, max-age=31536000, immutable'

echo "== app em $APP"

# --- O que o navegador tem de reler a cada visita -------------------------
aws s3 cp "$APP/index.html" "s3://$SITE/index.html" \
  --cache-control "$REVALIDA" --content-type 'text/html; charset=utf-8'

aws s3 sync "$APP/css" "s3://$SITE/css" --delete \
  --cache-control "$REVALIDA" --content-type 'text/css; charset=utf-8'

# text/javascript é obrigatório, não cosmético: o navegador recusa um ES module
# servido com outro tipo, e o app é todo ES modules.
aws s3 sync "$APP/js" "s3://$SITE/js" --delete \
  --cache-control "$REVALIDA" --content-type 'text/javascript; charset=utf-8'

aws s3 cp "$APP/esteira.html" "s3://$SITE/esteira.html" \
  --cache-control "$REVALIDA" --content-type 'text/html; charset=utf-8'

# O acervo.json NÃO sobe daqui: quem escreve nele é a Lambda, quando a esteira
# publica uma peça. Subir o do disco apagaria as peças publicadas desde o último
# `tools/sincronizar.py`.

# --- O que não muda ------------------------------------------------------
aws s3 sync "$APP/assets/cloths" "s3://$SITE/assets/cloths" \
  --cache-control "$ETERNO" --content-type 'image/webp' --exclude '*' --include '*.webp'

if [ -d "$APP/assets/audio" ] && [ -n "$(ls -A "$APP/assets/audio" 2>/dev/null)" ]; then
  aws s3 sync "$APP/assets/audio" "s3://$SITE/assets/audio" --cache-control "$ETERNO"
fi

# --- Os másters não são do site -----------------------------------------
# São o arquivo de trabalho do admin: 32 MB de PNG que ninguém precisa baixar.
# Vão para o bucket privado, que o CloudFront nem conhece.
if [ -d "$APP/assets/mestres" ]; then
  aws s3 sync "$APP/assets/mestres" "s3://$DADOS/mestres" \
    --exclude 'rascunhos/*' --storage-class STANDARD_IA
fi

echo
echo "== publicado: https://dufkck3bmeh9v.cloudfront.net"
