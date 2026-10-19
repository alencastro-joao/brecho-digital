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

# App instalável (PWA). O sw.js e o manifesto têm nome fixo e precisam ser
# relidos a cada visita, senão uma versão velha do service worker ficaria presa.
aws s3 cp "$APP/manifest.webmanifest" "s3://$SITE/manifest.webmanifest" \
  --cache-control "$REVALIDA" --content-type 'application/manifest+json; charset=utf-8'

aws s3 cp "$APP/sw.js" "s3://$SITE/sw.js" \
  --cache-control "$REVALIDA" --content-type 'text/javascript; charset=utf-8'

aws s3 sync "$APP/assets/app" "s3://$SITE/assets/app" --delete \
  --cache-control 'public, max-age=86400' --content-type 'image/png' --exclude '*' --include '*.png'

# O acervo.json NÃO sobe daqui: quem escreve nele é a Lambda, quando a esteira
# publica uma peça. Subir o do disco apagaria as peças publicadas desde o último
# `tools/sincronizar.py`.

# --- O que não muda ------------------------------------------------------
# Só sobe imagem que ainda não existe lá. Peça editada (girar, cortar, trocar
# a imagem) é regravada pela Lambda com o mesmo nome; um `sync` daqui acharia
# a do repositório "mais nova" (o checkout do CI é sempre de agora) e desfaria
# a edição a cada publicação.
# Se a listagem falhar, não sobe nada: subir tudo é justamente o que desfaz.
faltando() {   # $1 pasta local, $2 destino s3://…/ — nomes que o destino não tem
  local remotos
  remotos=$(aws s3 ls "$2") || { echo "(não consegui listar $2; nada sobe)" >&2; return 0; }
  comm -23 <(cd "$1" && ls | sort) <(printf '%s\n' "$remotos" | awk '{print $4}' | sort)
}
faltando "$APP/assets/cloths" "s3://$SITE/assets/cloths/" | { grep '\.webp$' || true; } | while read -r f; do
  aws s3 cp "$APP/assets/cloths/$f" "s3://$SITE/assets/cloths/$f" \
    --cache-control "$ETERNO" --content-type 'image/webp'
done

# Os logos das marcas têm nome fixo (o id da coleção) e podem ser trocados,
# então ficam um dia no cache em vez de um ano.
if [ -d "$APP/assets/marcas" ]; then
  aws s3 sync "$APP/assets/marcas" "s3://$SITE/assets/marcas" --delete \
    --cache-control 'public, max-age=86400' --content-type 'image/webp' --exclude '*' --include '*.webp'
fi

# Ícones dos temas (bandeiras redondas em SVG), mesma regra dos logos.
if [ -d "$APP/assets/temas" ]; then
  aws s3 sync "$APP/assets/temas" "s3://$SITE/assets/temas" --delete \
    --cache-control 'public, max-age=86400' --content-type 'image/svg+xml' --exclude '*' --include '*.svg'
fi

# Ícones do app (js/icones.js, Phosphor em SVG). Nome fixo e podem ser
# trocados, então um dia no cache, como os logos.
if [ -d "$APP/assets/icones" ]; then
  aws s3 sync "$APP/assets/icones/ph" "s3://$SITE/assets/icones/ph" --delete \
    --cache-control 'public, max-age=86400' --content-type 'image/svg+xml' --exclude '*' --include '*.svg'
fi

# Fontes da Colagem (etiqueta e assinatura): as mesmas em todo aparelho e no
# PNG exportado. Nome fixo; um dia no cache, como os ícones.
if [ -d "$APP/assets/fontes" ]; then
  aws s3 sync "$APP/assets/fontes" "s3://$SITE/assets/fontes" --delete \
    --cache-control 'public, max-age=86400' --content-type 'font/woff2' --exclude '*' --include '*.woff2'
fi

if [ -d "$APP/assets/audio" ] && [ -n "$(ls -A "$APP/assets/audio" 2>/dev/null)" ]; then
  aws s3 sync "$APP/assets/audio" "s3://$SITE/assets/audio" --cache-control "$ETERNO"
fi

# --- Os másters não são do site -----------------------------------------
# São o arquivo de trabalho do admin: 32 MB de PNG que ninguém precisa baixar.
# Vão para o bucket privado, que o CloudFront nem conhece.
if [ -d "$APP/assets/mestres" ]; then
  faltando "$APP/assets/mestres" "s3://$DADOS/mestres/" | { grep '\.png$' || true; } | while read -r f; do
    aws s3 cp "$APP/assets/mestres/$f" "s3://$DADOS/mestres/$f" --storage-class STANDARD_IA
  done
fi

echo
echo "== publicado: https://dufkck3bmeh9v.cloudfront.net"
