use super::{
    crypto::{Credentials, KmsCrypto},
    store::{DueOutcome, DynamoStore},
};
use crate::{
    Auth,
    google::Google,
    ports::{Error, RevokeOutcome, Store, SystemClock},
};
use std::{sync::Arc, time::Duration};
use zeroize::Zeroizing;

fn required(name: &str) -> Result<String, Error> {
    std::env::var(name)
        .ok()
        .filter(|v| !v.is_empty())
        .ok_or(Error::Configuration)
}
pub async fn compose() -> Result<(Auth, Arc<DynamoStore>), Error> {
    let table = required("AUTH_TABLE_NAME")?;
    let key = required("AUTH_KMS_KEY_ID")?;
    let secret = required("AUTH_SECRET_ARN")?;
    if required("APP_ENVIRONMENT")? != "production" {
        return Err(Error::Configuration);
    }
    let config = aws_config::defaults(aws_config::BehaviorVersion::latest())
        .timeout_config(
            aws_config::timeout::TimeoutConfig::builder()
                .operation_timeout(Duration::from_secs(5))
                .operation_attempt_timeout(Duration::from_secs(4))
                .connect_timeout(Duration::from_secs(2))
                .build(),
        )
        .retry_config(aws_config::retry::RetryConfig::standard().with_max_attempts(2))
        .load()
        .await;
    if config.region().map(|r| r.as_ref()) != Some("sa-east-1") {
        return Err(Error::Configuration);
    }
    let response = aws_sdk_secretsmanager::Client::new(&config)
        .get_secret_value()
        .secret_id(secret)
        .send()
        .await
        .map_err(|_| Error::Configuration)?;
    let value = Zeroizing::new(response.secret_string.ok_or(Error::Configuration)?);
    let credentials = Credentials::parse(&value)?;
    let crypto = KmsCrypto::new(
        aws_sdk_kms::Client::new(&config),
        key,
        credentials.hmac_key,
        "production".into(),
    )?;
    let store = Arc::new(DynamoStore::new(
        aws_sdk_dynamodb::Client::new(&config),
        table,
    )?);
    // Bootstrap is conditional and safe across concurrent cold starts; no in-memory fallback.
    store.grant_epoch().await?;
    let provider = Google::new(credentials.config.clone(), credentials.client_secret)?;
    let auth = Auth {
        config: credentials.config,
        provider: Arc::new(provider),
        store: store.clone(),
        crypto: Arc::new(crypto),
        clock: Arc::new(SystemClock),
    };
    Ok((auth, store))
}

#[derive(Default)]
pub struct SweepReport {
    pub processed: u32,
    pub uncertain: u32,
    pub cleaned: u32,
    pub failed: u32,
}
pub async fn sweep(
    auth: &Auth,
    store: &DynamoStore,
    report: &mut SweepReport,
) -> Result<(), Error> {
    let started = std::time::Instant::now();
    let mut dispatched = false;
    for kind in ["REVOCATION", "INACTIVITY"] {
        for id in store.due(kind, auth.clock.now(), 10).await? {
            match store.prepare_due(&id, auth.clock.now()).await {
                Ok(DueOutcome::Revocation(key)) => {
                    if dispatched || started.elapsed() > Duration::from_secs(5) {
                        continue;
                    }
                    dispatched = true;
                    match auth.revoke_key(&key).await {
                        Ok(RevokeOutcome::Confirmed) => report.processed += 1,
                        Ok(RevokeOutcome::Uncertain) => report.uncertain += 1,
                        Ok(RevokeOutcome::NotDispatchedRetryable) => report.failed += 1,
                        Err(Error::Busy) | Err(Error::Unauthorized) => {}
                        Err(_) => report.failed += 1,
                    }
                }
                Ok(DueOutcome::Uncertain) => report.uncertain += 1,
                Ok(DueOutcome::Purged) => report.cleaned += 1,
                Ok(DueOutcome::NotDue) | Err(Error::Busy) | Err(Error::Unauthorized) => {}
                Err(error) => {
                    report.failed += 1;
                    return Err(error);
                }
            }
        }
    }
    Ok(())
}
