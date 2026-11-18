#!/usr/bin/env bash
# Confere, depois do publicar.sh, que o site no ar é a versão nova e que nada
# que o navegador precisa reler vem com cache longo. Roda no fim do
# publicar.yml; também serve no Git Bash: bash nuvem/infra/conferir-cache.sh
set -euo pipefail

SITE_URL="${SITE_URL:-https://dufkck3bmeh9v.cloudfront.net}"
FONTE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../App" && pwd)"
# Mesmo resumo que o publicar.sh grava no versao.txt.
VERSAO="$(cd "$FONTE" && find index.html esteira.html manifest.webmanifest sw.js css js -type f -print0 \
  | sort -z | xargs -0 sha1sum | sha1sum | cut -c1-16)"
echo "== esperada: $VERSAO"

# O CloudFront pode levar alguns segundos para revalidar.
no_ar=""
for _ in $(seq 1 24); do
  no_ar="$(curl -fsS "$SITE_URL/versao.txt" || true)"
  [ "$no_ar" = "$VERSAO" ] && break
  sleep 5
done
echo "== versao.txt no ar: $no_ar"
[ "$no_ar" = "$VERSAO" ] || { echo "versao.txt não chegou à versão nova" >&2; exit 1; }

pagina="$(curl -fsS "$SITE_URL/index.html")"
# Sem pipe para o grep -q: com pipefail, o printf leva "Broken pipe" e falha.
[[ "$pagina" == *"name=\"versao\" content=\"$VERSAO\""* ]] \
  || { echo "index.html no ar não traz a versão nova" >&2; exit 1; }

falhou=0
for p in "" index.html sw.js versao.txt manifest.webmanifest js/app.js js/versao.js css/base.css; do
  cab="$(curl -fsSI "$SITE_URL/$p")"
  cc="$(printf '%s' "$cab" | tr -d '\r' | grep -i '^cache-control:' | cut -d' ' -f2- || true)"
  xc="$(printf '%s' "$cab" | tr -d '\r' | grep -i '^x-cache:' | cut -d' ' -f2- || true)"
  echo "/$p -> cache-control: ${cc:-(nenhum)} | x-cache: ${xc:-?}"
  case "$cc" in *no-cache*|*no-store*|*max-age=0*) ;; *) falhou=1 ;; esac
done
[ "$falhou" = 0 ] || { echo "algum arquivo saiu sem no-cache" >&2; exit 1; }
echo "== tudo certo: versão nova no ar e sem cache longo"
