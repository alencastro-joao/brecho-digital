#!/usr/bin/env bash
# Liga (ou reajusta) o gerador de posts do feed. Rode do Git Bash:
#
#     bash nuvem/infra/publicar-gerador.sh                      # a cada 3 horas
#     FREQUENCIA="rate(1 hour)" bash nuvem/infra/publicar-gerador.sh
#     LIGADO=DISABLED bash nuvem/infra/publicar-gerador.sh      # pausa
#
# O código do gerador vai com a API (publicar-api.sh); aqui é só a agenda.
# Com SEMEAR=12 roda uma vez na hora, com 12 posts espalhados pelos últimos
# 3 dias — é o semeio do feed na primeira vez.
set -euo pipefail

export PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"
export MSYS_NO_PATHCONV=1

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
win() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }

FREQUENCIA=${FREQUENCIA:-"rate(3 hours)"}
LIGADO=${LIGADO:-ENABLED}

aws cloudformation deploy \
  --stack-name brecho-gerador \
  --template-file "$(win "$RAIZ/nuvem/infra/gerador.yaml")" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --tags projeto=brecho \
  --parameter-overrides "Frequencia=$FREQUENCIA" "Ligado=$LIGADO"

if [ -n "${SEMEAR:-}" ]; then
  SAIDA="$(win "$RAIZ/..")/.brecho-gerador.json"
  aws lambda invoke --function-name brecho-api \
    --cli-binary-format raw-in-base64-out \
    --payload "{\"agendado\": \"gerar-posts\", \"quantos\": $SEMEAR, \"espalhar_horas\": 72}" \
    "$SAIDA" >/dev/null
  cat "$SAIDA"; echo
  rm -f "$SAIDA"
fi
echo "== gerador: $FREQUENCIA ($LIGADO)"
