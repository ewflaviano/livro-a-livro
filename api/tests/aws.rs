//! Run only against an explicitly provisioned disposable table/key, never production data.
#![cfg(feature = "aws")]
use aws_sdk_dynamodb::types::AttributeValue as A;
use livro_a_livro_auth::{
    aws::{
        crypto::KmsCrypto,
        store::{DueOutcome, DynamoStore},
    },
    config::*,
    ports::*,
    service::{digest, random},
};
use zeroize::Zeroizing;
fn unique() -> String {
    digest(&random().unwrap())
}
async fn environment() -> (DynamoStore, aws_config::SdkConfig, String) {
    let table =
        std::env::var("AUTH_TEST_TABLE").expect("isolated table must be explicitly configured");
    assert!(
        table.starts_with("livro-a-livro-auth-gate-"),
        "refusing a table not marked as a test resource"
    );
    let config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let store = DynamoStore::new(aws_sdk_dynamodb::Client::new(&config), table.clone()).unwrap();
    (store, config, table)
}
async fn connect(store: &DynamoStore, id: &str, hash: &str, now: u64) -> Session {
    store
        .connect(
            id,
            vec![7, 8, 9],
            hash,
            store.grant_epoch().await.unwrap(),
            now,
        )
        .await
        .unwrap()
}
#[tokio::test]
#[ignore = "requires isolated AWS DynamoDB table with work-due index"]
async fn dynamodb_concurrency_deadlines_fencing_revocation_and_cleanup() {
    let (store, config, table) = environment().await;
    let now = SystemClock.now();
    // OAuth cookie mismatch does not consume; expiry and concurrent consumers fail closed.
    let oauth = unique();
    let cookie = unique();
    store
        .put_oauth(
            &oauth,
            Transaction {
                cookie_hash: cookie.clone(),
                nonce: Secret(unique()),
                verifier: Secret(unique()),
                expires_at: now + 600,
            },
        )
        .await
        .unwrap();
    assert!(matches!(
        store.take_oauth(&oauth, "wrong", now).await,
        Err(Error::Unauthorized)
    ));
    let (a, b) = tokio::join!(
        store.take_oauth(&oauth, &cookie, now),
        store.take_oauth(&oauth, &cookie, now)
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    let expired = unique();
    store
        .put_oauth(
            &expired,
            Transaction {
                cookie_hash: cookie.clone(),
                nonce: Secret(unique()),
                verifier: Secret(unique()),
                expires_at: now,
            },
        )
        .await
        .unwrap();
    assert!(matches!(
        store.take_oauth(&expired, &cookie, now).await,
        Err(Error::Unauthorized)
    ));
    // Independent claims race across the service boundary; only one obtains bytes.
    let id = unique();
    let hash = unique();
    let session = connect(&store, &id, &hash, now).await;
    let (a, b) = tokio::join!(
        store.claim(&hash, "first-owner", now),
        store.claim(&hash, "second-owner", now)
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    let lease = a.ok().or_else(|| b.ok()).unwrap();
    store.release(&lease).await.unwrap();
    assert!(matches!(
        store.claim(&hash, "early", now + 29).await,
        Err(Error::Busy)
    ));
    let lease = store.claim(&hash, "rotation", now + 30).await.unwrap();
    store
        .finish(&lease, Some(vec![4, 5, 6]), now + 31)
        .await
        .unwrap();
    let late = store.claim(&hash, "late", now + 60).await.unwrap();
    assert_eq!(late.encrypted_refresh, vec![4, 5, 6]);
    assert!(store.finish(&late, None, now + 90).await.is_err());
    // Renew consumes old hash exactly once, preserving absolute deadline and generation.
    let first = unique();
    let second = unique();
    let (a, b) = tokio::join!(
        store.renew(&hash, &first, now + 91),
        store.renew(&hash, &second, now + 91)
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    let (new_hash, renewed) = if let Ok(value) = a {
        (first, value)
    } else {
        (second, b.unwrap())
    };
    assert_eq!(renewed.absolute_expires_at, session.absolute_expires_at);
    assert!(store.session(&hash, now + 91).await.is_err());
    assert!(
        store
            .session(&new_hash, renewed.absolute_expires_at)
            .await
            .is_err()
    );
    // A callback grant captured before disable cannot persist, nor can a late refresh.
    let epoch = store.grant_epoch().await.unwrap();
    let active_lease = store
        .claim(&new_hash, "before-disable", now + 92)
        .await
        .unwrap();
    let key = store.disable(&new_hash, now + 93).await.unwrap();
    assert!(
        store
            .connect(&unique(), vec![11], &unique(), epoch, now + 94)
            .await
            .is_err()
    );
    assert!(
        store
            .finish(&active_lease, Some(vec![99]), now + 94)
            .await
            .is_err()
    );
    assert!(
        store
            .connect(&id, vec![11], &unique(), epoch, now + 94)
            .await
            .is_err()
    );
    assert!(
        store
            .connect(
                &id,
                vec![11],
                &unique(),
                store.grant_epoch().await.unwrap(),
                now + 94
            )
            .await
            .is_err()
    );
    let (a, b) = tokio::join!(
        store.claim_revocation(&key, "revoke-a", now + 94),
        store.claim_revocation(&key, "revoke-b", now + 94)
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    let claim = a.ok().or_else(|| b.ok()).unwrap();
    store
        .mark_revocation_dispatching(&claim, now + 95)
        .await
        .unwrap();
    store
        .complete_revocation(&claim, RevokeOutcome::Confirmed, now + 96)
        .await
        .unwrap();
    let next = connect(&store, &id, &unique(), now + 97).await;
    assert!(next.generation > key.generation);
    assert!(
        store
            .complete_revocation(&claim, RevokeOutcome::Confirmed, now + 98)
            .await
            .is_err()
    );
    // Logout and session expiry during a refresh fence the unpublished access token.
    let logout_id = unique();
    let logout_hash = unique();
    connect(&store, &logout_id, &logout_hash, now).await;
    let logout_lease = store
        .claim(&logout_hash, "logout-inflight", now)
        .await
        .unwrap();
    store.logout(&logout_hash).await.unwrap();
    assert!(store.finish(&logout_lease, None, now + 1).await.is_err());
    let expire_id = unique();
    let expire_hash = unique();
    let expiring = connect(&store, &expire_id, &expire_hash, now).await;
    let expire_lease = store
        .claim(&expire_hash, "expiring-inflight", expiring.expires_at - 1)
        .await
        .unwrap();
    assert!(
        store
            .finish(&expire_lease, None, expiring.expires_at)
            .await
            .is_err()
    );
    let renew_id = unique();
    let renew_hash = unique();
    connect(&store, &renew_id, &renew_hash, now).await;
    let renew_lease = store
        .claim(&renew_hash, "renew-inflight", now)
        .await
        .unwrap();
    store.renew(&renew_hash, &unique(), now + 1).await.unwrap();
    assert!(store.finish(&renew_lease, None, now + 2).await.is_err());
    // Dead dispatch is uncertain, never automatically retried/reconnected even after24h.
    let id2 = unique();
    let hash2 = unique();
    connect(&store, &id2, &hash2, now).await;
    let key2 = store.disable(&hash2, now).await.unwrap();
    let claim2 = store
        .claim_revocation(&key2, "dead-dispatch", now + 1)
        .await
        .unwrap();
    store
        .mark_revocation_dispatching(&claim2, now + 2)
        .await
        .unwrap();
    assert!(matches!(
        store.prepare_due(&id2, now + 32).await.unwrap(),
        DueOutcome::Uncertain
    ));
    assert!(
        store
            .claim_revocation(&key2, "must-not-retry", now + 33)
            .await
            .is_err()
    );
    assert!(
        store
            .connect(
                &id2,
                vec![11],
                &unique(),
                store.grant_epoch().await.unwrap(),
                now + 33
            )
            .await
            .is_err()
    );
    assert!(matches!(
        store.prepare_due(&id2, now + 86400).await.unwrap(),
        DueOutcome::Purged
    ));
    assert!(
        store
            .connect(
                &id2,
                vec![11],
                &unique(),
                store.grant_epoch().await.unwrap(),
                now + 86401
            )
            .await
            .is_err()
    );
    let client = aws_sdk_dynamodb::Client::new(&config);
    let item = client
        .get_item()
        .table_name(&table)
        .key("pk", A::S(format!("CONNECTION#{id2}")))
        .consistent_read(true)
        .send()
        .await
        .unwrap()
        .item
        .unwrap();
    assert!(!item.contains_key("encryptedRefresh"));
    assert!(!item.contains_key("workType"));
    let wrong = RevocationKey {
        connection_id: id2.clone(),
        generation: key2.generation,
        revocation_id: unique(),
    };
    assert!(store.resolve_uncertain(&wrong, now + 86401).await.is_err());
    store.resolve_uncertain(&key2, now + 86401).await.unwrap();
    connect(&store, &id2, &unique(), now + 86402).await;
    // A queued worker that never dispatched can be reclaimed; deadline forbids bytes.
    let id3 = unique();
    let hash3 = unique();
    connect(&store, &id3, &hash3, now).await;
    let key3 = store.disable(&hash3, now).await.unwrap();
    let abandoned = store
        .claim_revocation(&key3, "before-decrypt", now)
        .await
        .unwrap();
    assert!(matches!(
        store.prepare_due(&id3, now + 31).await.unwrap(),
        DueOutcome::Revocation(_)
    ));
    let reclaimed = store
        .claim_revocation(&key3, "reclaimed", now + 31)
        .await
        .unwrap();
    assert!(
        store
            .mark_revocation_dispatching(&abandoned, now + 32)
            .await
            .is_err()
    );
    store
        .complete_revocation(&reclaimed, RevokeOutcome::NotDispatchedRetryable, now + 32)
        .await
        .unwrap();
    assert!(
        store
            .claim_revocation(&key3, "deadline", now + 86400)
            .await
            .is_err()
    );
    assert!(matches!(
        store.prepare_due(&id3, now + 86400).await.unwrap(),
        DueOutcome::Purged
    ));
    // Expired inactivity is checked independently of eventual TTL/GSI cleanup.
    let id4 = unique();
    let hash4 = unique();
    connect(&store, &id4, &hash4, now).await;
    assert!(store.session(&hash4, now + ABSOLUTE_TTL).await.is_err());
    assert!(matches!(
        store.prepare_due(&id4, now + ABSOLUTE_TTL).await.unwrap(),
        DueOutcome::Revocation(_)
    ));
    // Stale GSI discovery after successful renewal never authorizes expiration.
    let id5 = unique();
    let hash5 = unique();
    connect(&store, &id5, &hash5, now).await;
    let lease = store.claim(&hash5, "activity", now + 1).await.unwrap();
    store.finish(&lease, None, now + 2).await.unwrap();
    assert!(matches!(
        store.prepare_due(&id5, now + ABSOLUTE_TTL).await.unwrap(),
        DueOutcome::NotDue
    ));
    // Query is exercised against the real GSI, but never trusted to authorize bytes.
    store
        .due("REVOCATION", now + ABSOLUTE_TTL, 25)
        .await
        .unwrap();
}
#[tokio::test]
#[ignore = "requires isolated AWS KMS key; uses synthetic plaintext only"]
async fn kms_authenticated_context_and_fail_closed() {
    let config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let key = std::env::var("AUTH_TEST_KMS_KEY").expect("explicit isolated key required");
    let crypto = KmsCrypto::new(
        aws_sdk_kms::Client::new(&config),
        key,
        Zeroizing::new(vec![42; 32]),
        "production".into(),
    )
    .unwrap();
    let context = format!("production:{}", unique());
    let encrypted = crypto.seal(&context, "synthetic-refresh").await.unwrap();
    assert_eq!(
        crypto.open(&context, &encrypted).await.unwrap().0,
        "synthetic-refresh"
    );
    assert!(
        crypto
            .open(&format!("production:{}", unique()), &encrypted)
            .await
            .is_err()
    );
    assert!(crypto.open(&context, &[0, 1, 2]).await.is_err());
    assert!(crypto.seal(&context, &"x".repeat(4097)).await.is_err());
    assert!(crypto.open("development:wrong", &encrypted).await.is_err());
}

#[derive(Debug)]
struct LoseCommittedResponse {
    armed: std::sync::Arc<std::sync::atomic::AtomicBool>,
    transaction: std::sync::atomic::AtomicBool,
    losses: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}
impl aws_smithy_runtime_api::client::interceptors::Intercept for LoseCommittedResponse {
    fn name(&self) -> &'static str {
        "SyntheticCommittedResponseLoss"
    }
    fn read_before_execution(
        &self,
        context:&aws_smithy_runtime_api::client::interceptors::context::BeforeSerializationInterceptorContextRef<'_>,
        _: &mut aws_smithy_types::config_bag::ConfigBag,
    ) -> Result<(), aws_smithy_runtime_api::box_error::BoxError> {
        self.transaction.store(context.input().downcast_ref::<aws_sdk_dynamodb::operation::transact_write_items::TransactWriteItemsInput>().is_some(),std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }
    fn modify_before_deserialization(
        &self,
        context:&mut aws_smithy_runtime_api::client::interceptors::context::BeforeDeserializationInterceptorContextMut<'_>,
        _: &aws_smithy_runtime_api::client::runtime_components::RuntimeComponents,
        _: &mut aws_smithy_types::config_bag::ConfigBag,
    ) -> Result<(), aws_smithy_runtime_api::box_error::BoxError> {
        use std::sync::atomic::Ordering::SeqCst;
        if self.transaction.load(SeqCst)
            && context.response().status().is_success()
            && self.armed.swap(false, SeqCst)
        {
            // DynamoDB already committed. Replace only this successful response with
            // a retryable transport/service failure; the SDK must reuse its token.
            *context.response_mut().status_mut() =
                aws_smithy_runtime_api::http::StatusCode::try_from(500).unwrap();
            *context.response_mut().body_mut() = aws_smithy_types::body::SdkBody::from(
                r#"{"__type":"InternalServerError","message":"synthetic response loss"}"#,
            );
            self.losses.fetch_add(1, SeqCst);
        }
        Ok(())
    }
}
#[tokio::test]
#[ignore = "requires isolated AWS table; injects loss after a committed response"]
async fn committed_transaction_retry_reuses_idempotency_token() {
    use std::sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering::SeqCst},
    };
    let (_, config, table) = environment().await;
    let armed = Arc::new(AtomicBool::new(false));
    let losses = Arc::new(AtomicUsize::new(0));
    let client = aws_sdk_dynamodb::Client::from_conf(
        aws_sdk_dynamodb::config::Builder::from(&config)
            .retry_config(
                aws_sdk_dynamodb::config::retry::RetryConfig::standard().with_max_attempts(2),
            )
            .interceptor(LoseCommittedResponse {
                armed: armed.clone(),
                transaction: AtomicBool::new(false),
                losses: losses.clone(),
            })
            .build(),
    );
    let store = DynamoStore::new(client, table).unwrap();
    let now = SystemClock.now();
    let id = unique();
    let hash = unique();
    connect(&store, &id, &hash, now).await;
    let epoch = store.grant_epoch().await.unwrap();
    armed.store(true, SeqCst);
    let key = store.disable(&hash, now + 1).await.unwrap();
    assert_eq!(losses.load(SeqCst), 1);
    assert_eq!(key.generation, 2);
    assert_eq!(store.grant_epoch().await.unwrap(), epoch + 1);
    assert!(store.session(&hash, now + 2).await.is_err());
}
