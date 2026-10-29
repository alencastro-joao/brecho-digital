#!/usr/bin/env bash
# Liga (ou reajusta) a leitura das pastas do Pinterest com o site fechado.
# Rode do Git Bash, uma vez:
#
#     bash nuvem/infra/publicar-pinterest.sh                              # a cada 15 min
#     FREQUENCIA="rate(1 hour)" bash nuvem/infra/publicar-pinterest.sh
#     LIGADO=DISABLED bash nuvem/infra/publicar-pinterest.sh              # pausa
#
# O código vai com a API (publicar-api.sh, ou o merge no main); aqui é só a
# agenda e a permissão da API chamar a si mesma. Fica fora da pilha da
# esteira porque o papel do GitHub não cria agenda nem papel novo.
set -euo pipefail

export PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"
export MSYS_NO_PATHCONV=1

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
win() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }

FREQUENCIA=${FREQUENCIA:-"rate(15 minutes)"}
LIGADO=${LIGADO:-ENABLED}

aws cloudformation deploy \
  --stack-name brecho-pinterest \
  --template-file "$(win "$RAIZ/nuvem/infra/pinterest.yaml")" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --tags projeto=brecho \
  --parameter-overrides "Frequencia=$FREQUENCIA" "Ligado=$LIGADO"

echo "== pinterest: $FREQUENCIA ($LIGADO)"
