#!/usr/bin/env bash
# Publica o front no S3. Rode do Git Bash, de qualquer pasta:
#
#     bash nuvem/infra/publicar.sh
#
# Só sobe o que mudou (é o que o `s3 sync` faz), então republicar é rápido e
# quase de graça. O HTML, o CSS e o JS sobem com `max-age=0` para o navegador
# (ele sempre confere) e `s-maxage` longo para o CloudFront, que guarda tudo na
# borda de São Paulo; no fim, uma invalidação de `/*` faz a borda pegar a versão
# nova. Antes era `no-cache` também para a borda, e cada arquivo, até o
# versao.txt de 16 bytes, custava uma ida ao S3 nos EUA (~0,5 s medidos do
# Brasil, contra ~0,1 s servindo da borda). Sem permissão de invalidar, volta
# ao `no-cache` de antes, sem quebrar nada. As imagens das peças sobem
# imutáveis por um ano porque o nome do arquivo é o id da peça.
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

DISTRIBUICAO=EENWH23ZOF7U2
ETERNO='public, max-age=31536000, immutable'

echo "== app em $APP"

# --- Cache na borda (CloudFront) -------------------------------------------
# Só guarda na borda se este publicador consegue invalidar: sem a invalidação
# do fim, a borda serviria a versão velha por um ano. O teste é uma invalidação
# de verdade de um caminho só (o versao.txt), que conta pouco na franquia de
# 1.000 caminhos por mês.
invalidar() {   # caminhos... -> id da invalidação, ou falha
  aws cloudfront create-invalidation --distribution-id "$DISTRIBUICAO" \
    --paths "$@" --query 'Invalidation.Id' --output text
}
if invalidar /versao.txt >/dev/null 2>&1; then
  REVALIDA='public, max-age=0, must-revalidate, s-maxage=31536000'
  NA_BORDA=1
  echo "== cache na borda: ligado (invalida /* no fim)"
else
  REVALIDA='no-cache, must-revalidate'
  NA_BORDA=0
  echo "::warning::Sem permissão para invalidar o CloudFront: HTML, CSS e JS sobem com no-cache (cada arquivo vai ao S3). Rode nuvem/infra/ligar-github.sh para dar a permissão."
fi

# --- Versão publicada (lida pelo App/sw.js) -------------------------------
# O sw.js guarda CSS e JS no celular e joga tudo fora quando o versao.txt muda.
# Enquanto esta publicação sobe, ele diz "publicando-...": o sw não guarda nada
# e tudo vem da rede. Só no fim, com tudo no ar, ganha o resumo do conteúdo.
# Se a publicação falhar no meio, fica o "publicando" e o app segue sem guardar.
FONTE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../App" && pwd)"
VERSAO="$(cd "$FONTE" && find index.html esteira.html manifest.webmanifest sw.js css js -type f -print0 \
  | sort -z | xargs -0 sha1sum | sha1sum | cut -c1-16)"
versao() {
  printf '%s' "$1" | aws s3 cp - "s3://$SITE/versao.txt" \
    --cache-control "$REVALIDA" --content-type 'text/plain; charset=utf-8'
}
versao "publicando-$(date +%s)"

# Corpo, nariz e cabelo desenhados pela artista (App/tools/corpo.py): o nome
# leva o resumo do conteúdo, então ficam um ano no cache e nunca mudam.
# Sobem antes do JS que aponta para eles.
if [ -d "$APP/assets/corpo" ]; then
  aws s3 sync "$APP/assets/corpo" "s3://$SITE/assets/corpo" \
    --cache-control "$ETERNO" --content-type 'image/png' --exclude '*' --include '*.png'
fi

# --- O que o navegador tem de reler a cada visita -------------------------
# O index.html sobe com a versão numa <meta>: é por ela que o js/versao.js sabe
# em qual versão a aba abriu e recarrega sozinho quando sai outra.
# Junto, um <link rel="modulepreload"> por módulo (App/tools/precarregar.py):
# sem eles o navegador descobre os imports nível por nível, 8 idas à AWS em fila.
PAGINA="$(mktemp)"
PRECARGA="$(mktemp)"
python "$(win "$FONTE/tools/precarregar.py")" "$(win "$FONTE")" > "$PRECARGA"
[ "$(wc -l < "$PRECARGA")" -gt 20 ] || { echo "precarregar.py listou poucos módulos" >&2; exit 1; }
{ printf '<meta name="versao" content="%s">\n' "$VERSAO"; cat "$PRECARGA"; } > "$PRECARGA.head"
python - "$(win "$FONTE/index.html")" "$(win "$PRECARGA.head")" "$(win "$PAGINA")" <<'PY'
import sys
pagina = open(sys.argv[1], encoding='utf-8').read()
extra = open(sys.argv[2], encoding='utf-8').read()
assert pagina.count('</head>') == 1, 'index.html sem um </head> só'
open(sys.argv[3], 'w', encoding='utf-8', newline='\n').write(pagina.replace('</head>', extra + '</head>'))
PY
rm -f "$PRECARGA" "$PRECARGA.head"
grep -q "name=\"versao\" content=\"$VERSAO\"" "$PAGINA" || { echo "meta versao não entrou no index.html" >&2; exit 1; }
grep -q 'rel="modulepreload" href="js/app.js"' "$PAGINA" || { echo "modulepreload não entrou no index.html" >&2; exit 1; }
aws s3 cp "$(win "$PAGINA")" "s3://$SITE/index.html" \
  --cache-control "$REVALIDA" --content-type 'text/html; charset=utf-8'
rm -f "$PAGINA"

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

# Tudo o que o sw.js guarda já está no ar: agora a versão nova vale.
versao "$VERSAO"
echo "== versão $VERSAO"

# A borda larga o que guardou e pega a versão nova do S3. Espera terminar (uns
# minutos): o conferir-cache.sh, que roda depois, confere o versao.txt no ar.
if [ "$NA_BORDA" = 1 ]; then
  if ID="$(invalidar '/*')"; then
    echo "== invalidação $ID (/*): esperando a borda"
    aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUICAO" --id "$ID" \
      || echo "::warning::Não consegui esperar a invalidação $ID; ela segue sozinha."
  else
    echo "invalidação do CloudFront falhou: a borda ficaria com a versão velha" >&2
    exit 1
  fi
fi

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

# As roupas base das coleções de cor (tools/roupas_base.py): nome fixo, e
# podem ser regeradas, então um dia no cache, como os logos.
if [ -d "$APP/assets/roupas" ]; then
  aws s3 sync "$APP/assets/roupas" "s3://$SITE/assets/roupas" --delete \
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
