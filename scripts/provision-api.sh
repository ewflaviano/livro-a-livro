#!/usr/bin/env bash
# Operator-only infrastructure deployment. GitHub's publisher cannot change IAM/configuration.
set -euo pipefail

: "${API_ARTIFACT_DIR:?Directory containing bootstrap.zip files from the tested CI run}"
: "${API_ARTIFACT_BUCKET:?Output of the livro-a-livro-api-deploy stack}"
: "${API_RELEASE_ID:?Full tested Git commit SHA}"
[[ "$API_RELEASE_ID" =~ ^[a-f0-9]{40}$ ]]
test -f infra/api.yml

if [[ "${API_DIAGNOSTICS_ONLY:-false}" == true ]]; then
  previous_parameter() {
    aws --region sa-east-1 cloudformation describe-stacks --stack-name livro-a-livro-api \
      --query "Stacks[0].Parameters[?ParameterKey=='$1'].ParameterValue | [0]" --output text
  }
  API_CERTIFICATE_ARN="$(previous_parameter CertificateArn)"
  API_HOSTED_ZONE_ID="$(previous_parameter HostedZoneId)"
  API_SECRET_ARN="$(previous_parameter SecretArn)"
  previous_bucket="$(previous_parameter ArtifactBucket)"
  auth_key="$(previous_parameter AuthCodeKey)"
  revocation_key="$(previous_parameter RevocationCodeKey)"
  for value in "$API_CERTIFICATE_ARN" "$API_HOSTED_ZONE_ID" "$API_SECRET_ARN" "$previous_bucket" "$auth_key" "$revocation_key"; do
    [[ -n "$value" && "$value" != None ]]
  done
  [[ "$API_ARTIFACT_BUCKET" == "$previous_bucket" ]]
else
  : "${API_SECRET_ARN:?Secrets Manager ARN; never put the secret value here}"
  : "${API_CERTIFICATE_ARN:?Issued ACM certificate in sa-east-1}"
  : "${API_HOSTED_ZONE_ID:?Route 53 hosted zone}"
  auth_key="releases/$API_RELEASE_ID/auth.zip"
  revocation_key="releases/$API_RELEASE_ID/revocation.zip"
fi
[[ "$API_SECRET_ARN" == arn:aws:secretsmanager:sa-east-1:*:secret:livro-a-livro/production/auth-* ]]
[[ "$API_CERTIFICATE_ARN" == arn:aws:acm:sa-east-1:*:certificate/* ]]

api_functions=(diagnostics)
if [[ "${API_DIAGNOSTICS_ONLY:-false}" != true ]]; then api_functions+=(auth revocation); fi
for api_function in "${api_functions[@]}"; do
  test -f "$API_ARTIFACT_DIR/$api_function/bootstrap.zip"
  aws --region sa-east-1 s3 cp "$API_ARTIFACT_DIR/$api_function/bootstrap.zip" \
    "s3://$API_ARTIFACT_BUCKET/releases/$API_RELEASE_ID/$api_function.zip" --only-show-errors
done
deploy_options=()
if [[ "${API_PREVIEW_ONLY:-false}" == true ]]; then deploy_options+=(--no-execute-changeset); fi
aws --region sa-east-1 cloudformation deploy \
  --stack-name livro-a-livro-api --template-file infra/api.yml \
  --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset "${deploy_options[@]}" \
  --parameter-overrides \
    "CertificateArn=$API_CERTIFICATE_ARN" "HostedZoneId=$API_HOSTED_ZONE_ID" \
    "SecretArn=$API_SECRET_ARN" "ArtifactBucket=$API_ARTIFACT_BUCKET" \
    "AuthCodeKey=$auth_key" \
    "RevocationCodeKey=$revocation_key" \
    "DiagnosticsCodeKey=releases/$API_RELEASE_ID/diagnostics.zip"
