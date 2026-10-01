#!/usr/bin/env bash
# Publica a esteira de peças (fila + trabalhador + regra), descrita em
# nuvem/infra/esteira.yaml. Rode do Git Bash:
#
#     bash nuvem/infra/publicar-esteira.sh
#
# Idempotente: rodar de novo sem mudança nenhuma não sobe nada. O pacote do
# código e o da camada levam o hash do conteúdo no nome, então o CloudFormation
# só troca a função quando algo de fato mudou.
set -euo pipefail

export PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"
export MSYS_NO_PATHCONV=1

DADOS=brecho-dados-108826053014
SITE_URL=https://dufkck3bmeh9v.cloudfront.net
PILHA=brecho-esteira

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OBRA="$RAIZ/nuvem/.obra"
rm -rf "$OBRA" && mkdir -p "$OBRA/codigo" "$OBRA/camada/python"
win() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }

# --- Código ----------------------------------------------------------------
# bgbatch e pipeline são do App: a esteira roda exatamente o mesmo recorte e o
# mesmo contorno da máquina do admin, copiados na hora de empacotar.
cp "$RAIZ/nuvem/esteira/"*.py "$RAIZ/App/tools/bgbatch.py" "$RAIZ/App/tools/pipeline.py" "$OBRA/codigo/"

# --- Camada: numpy + onnxruntime para Linux arm64 --------------------------
# Wheels prontos (--only-binary): nada é compilado, então funciona do Windows.
# --no-deps: o onnxruntime puxa sympy, protobuf e coloredlogs, que são de
# ferramenta de conversão — a inferência não toca neles, e só o sympy são 77 MB.
python -m pip install --quiet --disable-pip-version-check --no-deps \
  --platform manylinux2014_aarch64 --platform manylinux_2_28_aarch64 \
  --implementation cp --python-version 3.13 --only-binary=:all: \
  --target "$(win "$OBRA/camada/python")" \
  numpy==2.3.5 onnxruntime==1.23.2
# Testes e cabeçalhos não rodam na Lambda: só ocupam o limite de 250 MB.
find "$OBRA/camada/python" -type d \( -name tests -o -name __pycache__ -o -name include \) -prune -exec rm -rf {} +

empacotar() {   # pasta, zip
  python - "$(win "$1")" "$(win "$2")" <<'PY'
import os, sys, zipfile
raiz, alvo = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(alvo, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for pasta, _, arquivos in sorted(os.walk(raiz)):
        for nome in sorted(arquivos):
            caminho = os.path.join(pasta, nome)
            info = zipfile.ZipInfo(os.path.relpath(caminho, raiz).replace(os.sep, '/'),
                                   date_time=(2020, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            with open(caminho, 'rb') as fh:
                z.writestr(info, fh.read())
print('%s: %.1f MB' % (os.path.basename(alvo), os.path.getsize(alvo) / 1e6))
PY
}
empacotar "$OBRA/codigo" "$OBRA/codigo.zip"
empacotar "$OBRA/camada" "$OBRA/camada.zip"

subir() {   # zip, prefixo -> imprime a chave
  local hash chave
  hash=$(sha256sum "$1" | cut -c1-16)
  chave="deploy/$2-$hash.zip"
  if ! aws s3api head-object --bucket "$DADOS" --key "$chave" >/dev/null 2>&1; then
    aws s3 cp "$(win "$1")" "s3://$DADOS/$chave" --quiet >&2
  fi
  echo "$chave"
}
CODIGO=$(subir "$OBRA/codigo.zip" trabalhador)
CAMADA=$(subir "$OBRA/camada.zip" camada-ciencia)
echo "== código $CODIGO · camada $CAMADA"

# --- O que o bucket de dados (criado fora da pilha) precisa ----------------
# EventBridge ligado: é por ele que a foto nova chega na fila.
aws s3api put-bucket-notification-configuration --bucket "$DADOS" \
  --notification-configuration '{"EventBridgeConfiguration":{}}'
# CORS: o navegador manda a foto direto para o bucket (POST assinado).
aws s3api put-bucket-cors --bucket "$DADOS" --cors-configuration "{
  \"CORSRules\": [{
    \"AllowedOrigins\": [\"$SITE_URL\", \"http://localhost:5173\", \"http://127.0.0.1:5173\"],
    \"AllowedMethods\": [\"POST\", \"GET\"],
    \"AllowedHeaders\": [\"*\"],
    \"MaxAgeSeconds\": 3600
  }]
}"
# Lixo da esteira: foto descartada sem passar pela tela some sozinha. As
# regras que o bucket já tem ficam: a lista é lida, as nossas trocadas pelo id
# e o resto devolvido como estava.
REGRAS="$(aws s3api get-bucket-lifecycle-configuration --bucket "$DADOS" --output json 2>/dev/null || echo '{}')"
python - "$REGRAS" > "$OBRA/ciclo.json" <<'PY'
import json, sys
atual = json.loads(sys.argv[1] or '{}')
nossas = [
    {'ID': 'entrada-esquecida', 'Status': 'Enabled', 'Filter': {'Prefix': 'entrada/'},
     'Expiration': {'Days': 30}},
    {'ID': 'pacotes-antigos', 'Status': 'Enabled', 'Filter': {'Prefix': 'deploy/'},
     'Expiration': {'Days': 90}},
]
ids = {r['ID'] for r in nossas}
regras = [r for r in atual.get('Rules', []) if r.get('ID') not in ids] + nossas
saida = {'Rules': regras}
print(json.dumps(saida))
PY
aws s3api put-bucket-lifecycle-configuration --bucket "$DADOS" \
  --transition-default-minimum-object-size all_storage_classes_128K \
  --lifecycle-configuration "file://$(win "$OBRA/ciclo.json")"

# --- A pilha ---------------------------------------------------------------
aws cloudformation deploy \
  --stack-name "$PILHA" \
  --template-file "$(win "$RAIZ/nuvem/infra/esteira.yaml")" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --tags projeto=brecho \
  --parameter-overrides "CodigoChave=$CODIGO" "CamadaChave=$CAMADA" "$@"

rm -rf "$OBRA"
echo "== esteira publicada"
