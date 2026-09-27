#!/usr/bin/env bash
# Operator-only infrastructure deployment. GitHub's publisher cannot change IAM/configuration.
set -euo pipefail

: "${API_ARTIFACT_DIR:?Directory containing auth/bootstrap.zip and revocation/bootstrap.zip from the tested CI run}"
: "${API_ARTIFACT_BUCKET:?Output of the livro-a-livro-api-deploy stack}"
: "${API_RELEASE_ID:?Full tested Git commit SHA}"
: "${API_SECRET_ARN:?Secrets Manager ARN; never put the secret value here}"
: "${API_CERTIFICATE_ARN:?Issued ACM certificate in sa-east-1}"
: "${API_HOSTED_ZONE_ID:?Route 53 hosted zone}"
[[ "$API_RELEASE_ID" =~ ^[a-f0-9]{40}$ ]]
[[ "$API_SECRET_ARN" == arn:aws:secretsmanager:sa-east-1:*:secret:livro-a-livro/production/auth-* ]]
[[ "$API_CERTIFICATE_ARN" == arn:aws:acm:sa-east-1:*:certificate/* ]]
test -f infra/api.yml

for api_function in auth revocation; do
  test -f "$API_ARTIFACT_DIR/$api_function/bootstrap.zip"
  aws --region sa-east-1 s3 cp "$API_ARTIFACT_DIR/$api_function/bootstrap.zip" \
    "s3://$API_ARTIFACT_BUCKET/releases/$API_RELEASE_ID/$api_function.zip" --only-show-errors
done
aws --region sa-east-1 cloudformation deploy \
  --stack-name livro-a-livro-api --template-file infra/api.yml \
  --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset \
  --parameter-overrides \
    "CertificateArn=$API_CERTIFICATE_ARN" "HostedZoneId=$API_HOSTED_ZONE_ID" \
    "SecretArn=$API_SECRET_ARN" "ArtifactBucket=$API_ARTIFACT_BUCKET" \
    "AuthCodeKey=releases/$API_RELEASE_ID/auth.zip" \
    "RevocationCodeKey=releases/$API_RELEASE_ID/revocation.zip"
