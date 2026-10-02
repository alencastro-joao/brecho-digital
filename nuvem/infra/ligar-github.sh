#!/usr/bin/env bash
# Liga a publicação automática pelo GitHub Actions. Rode uma vez, do Git Bash:
#
#     bash nuvem/infra/ligar-github.sh
#
# Cria (pela pilha brecho-github, em infra/github.yaml) o papel que o GitHub
# assume por OIDC — só a partir do branch main deste repositório — e imprime o
# ARN que vai no secret AWS_ROLE_ARN do repositório.
set -euo pipefail

export PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"
export MSYS_NO_PATHCONV=1

REPO=${REPO:-alencastro-joao/brecho-digital}
win() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Só pode existir um provedor OIDC do GitHub por conta: reaproveita se houver.
PROVEDOR=$(aws iam list-open-id-connect-providers \
  --query "OpenIDConnectProviderList[?contains(Arn,'token.actions.githubusercontent.com')].Arn" \
  --output text)

aws cloudformation deploy \
  --stack-name brecho-github \
  --template-file "$(win "$RAIZ/nuvem/infra/github.yaml")" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --tags projeto=brecho \
  --parameter-overrides "Repositorio=$REPO" "ProvedorExistente=$PROVEDOR"

echo
echo "== pronto. Copie isto para o secret AWS_ROLE_ARN do repositório:"
aws cloudformation describe-stacks --stack-name brecho-github \
  --query "Stacks[0].Outputs[?OutputKey=='Papel'].OutputValue" --output text
