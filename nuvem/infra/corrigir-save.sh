#!/usr/bin/env bash
# Conserta o save que nunca chegava na nuvem. Rode do Git Bash, de qualquer pasta:
#
#     bash nuvem/infra/corrigir-save.sh
#
# O papel da Lambda tinha `s3:GetObject` em `estado/*` mas não tinha
# `s3:ListBucket` no bucket. Sem ListBucket, o S3 responde **403** — e não 404 —
# para uma chave que ainda não existe: sem permissão de listar, dizer "essa
# chave não existe" já seria contar o que há no bucket. O `ler()` do estado.py
# só trata NoSuchKey/404 como "ainda não gravou", então o 403 virava erro, o
# `GET /api/estado` respondia 500, e o `sincronizarDaNuvem()` caía em `offline`
# — que é a trava que impede escrever na nuvem sem ter lido. Save nunca lido
# nunca é gravado: o prefixo `estado/` nunca chegou a existir.
#
# A statement vai sem condição de prefixo de propósito. O `s3:prefix` só existe
# no contexto de um ListObjectsV2 de verdade; na decisão 403-ou-404 de um
# GetObject ele não existe, e uma condição sobre ele reprovaria — o bug ficaria
# de pé. O bucket só guarda `estado/` e `mestres/`, que são da própria Lambda.
#
# Rodar de novo não faz mal: put-role-policy é idempotente.
set -euo pipefail

export PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"
export MSYS_NO_PATHCONV=1

# Caminho relativo de propósito: `file://` com caminho do Windows é onde o
# Git Bash e o aws.exe costumam brigar.
cd "$(dirname "${BASH_SOURCE[0]}")"

PAPEL=brecho-lambda
POLITICA=brecho-listar-dados

echo "== aplicando $POLITICA em $PAPEL"
aws iam put-role-policy \
  --role-name "$PAPEL" \
  --policy-name "$POLITICA" \
  --policy-document file://politica-listar-dados.json

echo "== políticas do papel agora:"
aws iam list-role-policies --role-name "$PAPEL" --query "PolicyNames[]" --output text

echo
echo "Pronto. Agora entre na conta uma vez em https://dufkck3bmeh9v.cloudfront.net"
echo "e confira o save nascer:"
echo
echo "    aws s3 ls s3://brecho-dados-108826053014/estado/"
