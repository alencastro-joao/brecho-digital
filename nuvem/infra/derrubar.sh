#!/usr/bin/env bash
# Apaga TUDO que o brechó tem na AWS. Não tem volta: some o site, somem as
# contas, somem os saves de todo mundo e somem os másters das peças.
#
#     bash nuvem/infra/derrubar.sh
#
# A ordem importa: o CloudFront tem de ser desabilitado e esperar implantar
# antes de aceitar ser apagado, e um bucket só sai vazio — com as versões
# antigas junto, porque o bucket de dados é versionado.
#
# Não toca em nada que não seja deste projeto. As outras distribuições da conta,
# os outros buckets e os outros Lambdas ficam onde estão.
set -euo pipefail

export PATH="$PATH:/c/Program Files/Amazon/AWSCLIV2"
export MSYS_NO_PATHCONV=1

DIST=EENWH23ZOF7U2
SITE=brecho-site-108826053014
DADOS=brecho-dados-108826053014

cat <<AVISO
Isto apaga, de verdade e sem volta:
  - a distribuição $DIST (o site sai do ar)
  - os buckets $SITE e $DADOS
    (os saves de todos os jogadores e os 32 MB de másters)
  - a tabela DynamoDB 'brecho' (todas as contas)
  - a função brecho-api, a camada brecho-pillow e o papel brecho-lambda

AVISO
read -r -p "Digite  apagar tudo  para confirmar: " RESPOSTA
[ "$RESPOSTA" = "apagar tudo" ] || { echo "cancelado."; exit 1; }

echo "== desabilitando a distribuição (leva alguns minutos para implantar)"
ETAG=$(aws cloudfront get-distribution-config --id $DIST --query ETag --output text)
aws cloudfront get-distribution-config --id $DIST --query DistributionConfig > /tmp/dist.json
python -c "
import json; c = json.load(open('/tmp/dist.json')); c['Enabled'] = False
json.dump(c, open('/tmp/dist.json', 'w'))"
aws cloudfront update-distribution --id $DIST --if-match "$ETAG" \
  --distribution-config file:///tmp/dist.json >/dev/null
aws cloudfront wait distribution-deployed --id $DIST

echo "== apagando a distribuição"
ETAG=$(aws cloudfront get-distribution-config --id $DIST --query ETag --output text)
aws cloudfront delete-distribution --id $DIST --if-match "$ETAG"

echo "== esvaziando e apagando os buckets"
for B in $SITE $DADOS; do
  aws s3 rm "s3://$B" --recursive >/dev/null
  # Bucket versionado guarda a versão antiga e o marcador de exclusão; sem
  # tirar os dois, o delete-bucket recusa dizendo que o bucket não está vazio.
  aws s3api list-object-versions --bucket "$B" \
    --query '{Objects: [].{Key:Key,VersionId:VersionId}}' --output json > /tmp/v.json 2>/dev/null || true
  if [ -s /tmp/v.json ] && ! grep -q '"Objects": null' /tmp/v.json; then
    aws s3api delete-objects --bucket "$B" --delete file:///tmp/v.json >/dev/null 2>&1 || true
  fi
  aws s3api list-object-versions --bucket "$B" \
    --query '{Objects: DeleteMarkers[].{Key:Key,VersionId:VersionId}}' --output json > /tmp/m.json 2>/dev/null || true
  if [ -s /tmp/m.json ] && ! grep -q '"Objects": null' /tmp/m.json; then
    aws s3api delete-objects --bucket "$B" --delete file:///tmp/m.json >/dev/null 2>&1 || true
  fi
  aws s3api delete-bucket --bucket "$B" && echo "   apagado: $B"
done

echo "== apagando Lambda, camada e tabela"
aws lambda delete-function-url-config --function-name brecho-api 2>/dev/null || true
aws lambda delete-function --function-name brecho-api
for V in $(aws lambda list-layer-versions --layer-name brecho-pillow \
             --query 'LayerVersions[].Version' --output text); do
  aws lambda delete-layer-version --layer-name brecho-pillow --version-number "$V"
done
aws dynamodb delete-table --table-name brecho >/dev/null

echo "== apagando papel, OAC, log e orçamento"
aws iam delete-role-policy --role-name brecho-lambda --policy-name brecho-dados 2>/dev/null || true
aws iam detach-role-policy --role-name brecho-lambda \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole 2>/dev/null || true
aws iam delete-role --role-name brecho-lambda 2>/dev/null || true
OAC=$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='brecho-site-oac'].Id | [0]" --output text)
if [ "$OAC" != "None" ] && [ -n "$OAC" ]; then
  OETAG=$(aws cloudfront get-origin-access-control --id "$OAC" --query ETag --output text)
  aws cloudfront delete-origin-access-control --id "$OAC" --if-match "$OETAG"
fi
aws logs delete-log-group --log-group-name "/aws/lambda/brecho-api" 2>/dev/null || true
aws budgets delete-budget --account-id 108826053014 \
  --budget-name conta-teto-5-usd 2>/dev/null || true

echo
echo "== tudo apagado."
