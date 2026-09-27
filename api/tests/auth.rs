use async_trait::async_trait;
use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use livro_a_livro_auth::{
    Auth,
    config::*,
    ports::*,
    router,
    service::{digest, random},
};
use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tower::ServiceExt;

// Deliberately test-only. No in-memory credentials/session store ships in the runtime.
#[derive(Default)]
struct Database {
    epoch: u64,
    finish_clock: Option<Arc<Time>>,
    identities: HashMap<String, PendingIdentity>,
    oauth: HashMap<String, Transaction>,
    sessions: HashMap<String, Session>,
    connections: HashMap<String, Connection>,
}
struct Connection {
    encrypted: Vec<u8>,
    generation: u64,
    active: bool,
    owner: Option<(String, u64)>,
    refreshed: Option<u64>,
    revocation: Option<(String, Option<String>, u64, bool)>,
}
#[derive(Default)]
struct Memory(Mutex<Database>);
fn current(db: &Database, hash: &str, now: u64) -> Result<Session, Error> {
    let session = db.sessions.get(hash).ok_or(Error::Unauthorized)?;
    let connection = db
        .connections
        .get(&session.connection_id)
        .ok_or(Error::Unauthorized)?;
    if session.expires_at <= now
        || session.absolute_expires_at <= now
        || !connection.active
        || session.generation != connection.generation
    {
        return Err(Error::Unauthorized);
    }
    Ok(session.clone())
}
#[async_trait]
impl Store for Memory {
    async fn put_identity(&self, hash: &str, identity: PendingIdentity) -> Result<(), Error> {
        let mut db = self.0.lock().unwrap();
        if db.identities.contains_key(hash) {
            return Err(Error::Busy);
        }
        db.identities.insert(hash.into(), identity);
        Ok(())
    }
    async fn identity(&self, hash: &str, now: u64) -> Result<PendingIdentity, Error> {
        self.0
            .lock()
            .unwrap()
            .identities
            .get(hash)
            .filter(|i| i.expires_at > now)
            .cloned()
            .ok_or(Error::Unauthorized)
    }
    async fn delete_identity(&self, hash: &str) -> Result<(), Error> {
        self.0.lock().unwrap().identities.remove(hash);
        Ok(())
    }
    async fn put_drive_oauth(
        &self,
        hash: &str,
        transaction: Transaction,
        expected: &PendingIdentity,
        now: u64,
    ) -> Result<(), Error> {
        let mut db = self.0.lock().unwrap();
        let OAuthPurpose::Drive { identity_hash, .. } = &transaction.purpose else {
            return Err(Error::InvalidRequest);
        };
        if db.identities.get(identity_hash) != Some(expected) || expected.expires_at <= now {
            return Err(Error::IdentityExpired);
        }
        db.oauth.insert(hash.into(), transaction);
        Ok(())
    }

    async fn grant_epoch(&self) -> Result<u64, Error> {
        Ok(self.0.lock().unwrap().epoch)
    }
    async fn put_oauth(&self, key: &str, transaction: Transaction) -> Result<(), Error> {
        self.0.lock().unwrap().oauth.insert(key.into(), transaction);
        Ok(())
    }
    async fn take_oauth(&self, key: &str, cookie: &str, now: u64) -> Result<Transaction, Error> {
        let mut db = self.0.lock().unwrap();
        let transaction = db.oauth.get(key).ok_or(Error::Unauthorized)?;
        if transaction.cookie_hash != cookie {
            return Err(Error::Unauthorized);
        }
        if transaction.expires_at <= now {
            return Err(Error::IdentityExpired);
        }
        Ok(db.oauth.remove(key).unwrap())
    }
    async fn connect(
        &self,
        connection: &str,
        encrypted: Vec<u8>,
        hash: &str,
        epoch: u64,
        identity: IdentityConsumption<'_>,
        now: u64,
    ) -> Result<Session, Error> {
        let mut db = self.0.lock().unwrap();
        if db.identities.get(identity.hash) != Some(identity.expected)
            || identity.expected.expires_at <= now
            || identity.expected.connection_id != connection
        {
            return Err(Error::IdentityExpired);
        }
        if db.epoch != epoch {
            return Err(Error::Busy);
        }
        let old = db.connections.get(connection);
        if old.is_some_and(|c| c.revocation.is_some()) {
            return Err(Error::Busy);
        }
        if old.is_some_and(|c| c.owner.as_ref().is_some_and(|(_, until)| *until > now)) {
            return Err(Error::Busy);
        }
        let generation = old.map_or(1, |c| c.generation + u64::from(!c.active));
        db.connections.insert(
            connection.into(),
            Connection {
                encrypted,
                generation,
                active: true,
                owner: None,
                refreshed: None,
                revocation: None,
            },
        );
        let session = Session {
            connection_id: connection.into(),
            generation,
            expires_at: now + SESSION_TTL,
            absolute_expires_at: now + ABSOLUTE_TTL,
        };
        db.identities.remove(identity.hash);
        db.sessions.insert(hash.into(), session.clone());
        Ok(session)
    }
    async fn session(&self, hash: &str, now: u64) -> Result<Session, Error> {
        current(&self.0.lock().unwrap(), hash, now)
    }
    async fn renew(&self, old: &str, new: &str, now: u64) -> Result<Session, Error> {
        let mut db = self.0.lock().unwrap();
        let mut session = current(&db, old, now)?;
        session.expires_at = (now + SESSION_TTL).min(session.absolute_expires_at);
        db.sessions.remove(old);
        db.sessions.insert(new.into(), session.clone());
        Ok(session)
    }
    async fn logout(&self, hash: &str) -> Result<(), Error> {
        self.0.lock().unwrap().sessions.remove(hash);
        Ok(())
    }
    async fn claim(&self, hash: &str, owner: &str, now: u64) -> Result<Lease, Error> {
        let mut db = self.0.lock().unwrap();
        let session = current(&db, hash, now)?;
        let c = db.connections.get_mut(&session.connection_id).unwrap();
        if c.owner.as_ref().is_some_and(|(_, until)| *until > now)
            || c.refreshed.is_some_and(|last| last + 30 > now)
        {
            return Err(Error::Busy);
        }
        c.owner = Some((owner.into(), now + LEASE_TTL));
        Ok(Lease {
            session_hash: hash.into(),
            authorization_until: (now + LEASE_TTL)
                .min(session.expires_at)
                .min(session.absolute_expires_at),
            connection_id: session.connection_id,
            generation: c.generation,
            owner: owner.into(),
            encrypted_refresh: c.encrypted.clone(),
        })
    }
    async fn finish(&self, lease: &Lease, rotated: Option<Vec<u8>>, now: u64) -> Result<(), Error> {
        let mut db = self.0.lock().unwrap();
        current(&db, &lease.session_hash, now)?;
        let c = db.connections.get_mut(&lease.connection_id).unwrap();
        if !c.active
            || c.generation != lease.generation
            || !c
                .owner
                .as_ref()
                .is_some_and(|(owner, until)| *owner == lease.owner && *until > now)
        {
            return Err(Error::Unauthorized);
        }
        if let Some(encrypted) = rotated {
            c.encrypted = encrypted;
        }
        c.owner = None;
        c.refreshed = Some(now);
        if let Some(clock) = &db.finish_clock {
            clock.0.store(now + LEASE_TTL, Ordering::Relaxed);
        }
        Ok(())
    }
    async fn release(&self, lease: &Lease) -> Result<(), Error> {
        let mut db = self.0.lock().unwrap();
        let c = db.connections.get_mut(&lease.connection_id).unwrap();
        if c.owner
            .as_ref()
            .is_some_and(|(owner, _)| *owner == lease.owner)
        {
            c.owner = None;
        }
        Ok(())
    }
    async fn disable(&self, hash: &str, now: u64) -> Result<RevocationKey, Error> {
        let mut db = self.0.lock().unwrap();
        let session = current(&db, hash, now)?;
        let c = db.connections.get_mut(&session.connection_id).unwrap();
        c.active = false;
        c.generation += 1;
        c.owner = None;
        let id = random()?;
        c.revocation = Some((id.clone(), None, now + 86400, false));
        let key = RevocationKey {
            connection_id: session.connection_id,
            generation: c.generation,
            revocation_id: id,
        };
        db.epoch += 1;
        Ok(key)
    }

    async fn invalidate(
        &self,
        lease: &Lease,
        reason: InvalidationReason,
        now: u64,
    ) -> Result<(), Error> {
        let mut db = self.0.lock().unwrap();
        let c = db.connections.get_mut(&lease.connection_id).unwrap();
        if !c.active
            || c.generation != lease.generation
            || !c
                .owner
                .as_ref()
                .is_some_and(|(owner, until)| *owner == lease.owner && *until > now)
        {
            return Err(Error::Unauthorized);
        }
        c.active = false;
        c.generation += 1;
        c.owner = None;
        match reason {
            InvalidationReason::InvalidGrant => {
                c.encrypted.clear();
                c.revocation = None;
            }
            InvalidationReason::ScopeChanged => {
                c.revocation = Some((random()?, None, now + 86400, false));
            }
        }
        db.epoch += 1;
        Ok(())
    }
    async fn claim_revocation(
        &self,
        key: &RevocationKey,
        owner: &str,
        now: u64,
    ) -> Result<RevocationClaim, Error> {
        let mut db = self.0.lock().unwrap();
        let c = db
            .connections
            .get_mut(&key.connection_id)
            .ok_or(Error::Unauthorized)?;
        let r = c.revocation.as_mut().ok_or(Error::Unauthorized)?;
        if c.generation != key.generation
            || r.0 != key.revocation_id
            || r.1.is_some()
            || r.2 <= now
            || r.3
        {
            return Err(Error::Busy);
        }
        r.1 = Some(owner.into());
        let claim = RevocationClaim {
            key: key.clone(),
            owner: owner.into(),
            lease_until: now + 30,
            delete_at: r.2,
            encrypted_refresh: c.encrypted.clone(),
        };
        db.epoch += 1;
        Ok(claim)
    }
    async fn mark_revocation_dispatching(
        &self,
        claim: &RevocationClaim,
        now: u64,
    ) -> Result<(), Error> {
        let mut db = self.0.lock().unwrap();
        let c = db
            .connections
            .get_mut(&claim.key.connection_id)
            .ok_or(Error::Unauthorized)?;
        let r = c.revocation.as_mut().ok_or(Error::Unauthorized)?;
        if c.generation != claim.key.generation
            || r.0 != claim.key.revocation_id
            || r.1.as_deref() != Some(&claim.owner)
            || claim.lease_until <= now
        {
            return Err(Error::Unauthorized);
        }
        r.3 = true;
        Ok(())
    }
    async fn complete_revocation(
        &self,
        claim: &RevocationClaim,
        outcome: RevokeOutcome,
        now: u64,
    ) -> Result<(), Error> {
        let mut db = self.0.lock().unwrap();
        let c = db
            .connections
            .get_mut(&claim.key.connection_id)
            .ok_or(Error::Unauthorized)?;
        let r = c.revocation.as_mut().ok_or(Error::Unauthorized)?;
        if c.generation != claim.key.generation
            || r.0 != claim.key.revocation_id
            || r.1.as_deref() != Some(&claim.owner)
            || claim.lease_until <= now
            || r.2 <= now
        {
            return Err(Error::Unauthorized);
        }
        if outcome == RevokeOutcome::Confirmed {
            c.encrypted.clear();
            c.revocation = None;
        } else {
            r.1 = None;
            r.3 = outcome == RevokeOutcome::Uncertain;
        }
        db.epoch += 1;
        Ok(())
    }
}
struct TestCrypto;
#[async_trait]
impl Crypto for TestCrypto {
    async fn seal(&self, context: &str, value: &str) -> Result<Vec<u8>, Error> {
        Ok(format!("{context}:{value}").into_bytes())
    }
    async fn open(&self, context: &str, value: &[u8]) -> Result<Secret, Error> {
        Ok(Secret(
            String::from_utf8(value.to_vec())
                .unwrap()
                .strip_prefix(&format!("{context}:"))
                .ok_or(Error::Unavailable)?
                .into(),
        ))
    }
    fn mac(&self, purpose: &str, value: &str) -> Result<String, Error> {
        Ok(digest(&format!("test-only:{purpose}:{value}")))
    }
}
struct Time(AtomicU64);
impl Clock for Time {
    fn now(&self) -> u64 {
        self.0.load(Ordering::Relaxed)
    }
}
#[derive(Default)]
struct FakeGoogle {
    exchanges: AtomicU64,
    mode: AtomicU64,
    revoke_during_exchange: Option<Arc<Memory>>,
}
#[async_trait]
impl Provider for FakeGoogle {
    async fn exchange(
        &self,
        _: &str,
        verifier: &str,
        nonce: &str,
        _: &OAuthPurpose,
    ) -> Result<Grant, Error> {
        self.exchanges.fetch_add(1, Ordering::Relaxed);
        if let Some(store) = &self.revoke_during_exchange {
            store.0.lock().unwrap().epoch += 1;
        }
        assert_eq!(verifier.len(), 43);
        assert_eq!(nonce.len(), 43);
        Ok(Grant {
            subject: Secret(
                if self.mode.load(Ordering::Relaxed) == 4 {
                    "different-sub"
                } else {
                    "synthetic-google-sub"
                }
                .into(),
            ),
            refresh_token: if self.mode.load(Ordering::Relaxed) == 1 {
                None
            } else {
                Some(Secret("synthetic-refresh".into()))
            },
            scope: if self.mode.load(Ordering::Relaxed) == 5 {
                "openid".into()
            } else {
                SCOPES.join(" ")
            },
        })
    }
    async fn refresh(&self, refresh: &str) -> Result<Access, Error> {
        assert!(refresh.starts_with("synthetic-"));
        if self.mode.load(Ordering::Relaxed) == 2 {
            return Err(Error::InvalidGrant);
        }
        Ok(Access {
            token: Secret("synthetic-access".into()),
            expires_in: 3600,
            scope: Some(SCOPES.join(" ")),
            rotated_refresh: Some(Secret("synthetic-rotated".into())),
        })
    }
    async fn revoke(&self, _: &str) -> RevokeOutcome {
        if self.mode.load(Ordering::Relaxed) == 3 {
            RevokeOutcome::Uncertain
        } else {
            RevokeOutcome::Confirmed
        }
    }
}
fn setup() -> (Auth, Arc<Memory>, Arc<Time>, Arc<FakeGoogle>) {
    let store = Arc::new(Memory::default());
    let clock = Arc::new(Time(AtomicU64::new(1000)));
    let provider = Arc::new(FakeGoogle::default());
    (
        Auth {
            config: Config::production("synthetic.apps.googleusercontent.com".into()).unwrap(),
            provider: provider.clone(),
            store: store.clone(),
            crypto: Arc::new(TestCrypto),
            clock: clock.clone(),
        },
        store,
        clock,
        provider,
    )
}
fn params(url: &str) -> HashMap<String, String> {
    url::Url::parse(url)
        .unwrap()
        .query_pairs()
        .into_owned()
        .collect()
}
async fn identify(auth: &Auth) -> String {
    let (url, cookie) = auth.start_sign_in(None, None).await.unwrap();
    let values = params(&url);
    assert_eq!(values["scope"], "openid");
    assert_eq!(values["access_type"], "online");
    assert_eq!(values["prompt"], "select_account");
    match auth
        .callback(&values["state"], &cookie, "synthetic-code")
        .await
        .unwrap()
    {
        CallbackResult::Identity { raw_cookie, .. } => raw_cookie,
        _ => panic!("identification must not connect"),
    }
}
async fn drive_start(auth: &Auth) -> (String, String) {
    let raw = identify(auth).await;
    auth.start_drive(&raw, &auth.identity_csrf(&raw).unwrap())
        .await
        .unwrap()
}
async fn connect(auth: &Auth) -> String {
    let (url, cookie) = drive_start(auth).await;
    let values = params(&url);
    assert_eq!(values["scope"], SCOPES.join(" "));
    assert_eq!(values["access_type"], "offline");
    assert_eq!(values["prompt"], "consent");
    match auth
        .callback(&values["state"], &cookie, "synthetic-code")
        .await
        .unwrap()
    {
        CallbackResult::Drive { raw_session } => raw_session,
        _ => panic!("drive must connect"),
    }
}
async fn call(
    auth: &Auth,
    method: &str,
    path: &str,
    raw: Option<&str>,
    csrf: Option<&str>,
    origin: &str,
    body: &str,
) -> axum::response::Response {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("origin", origin);
    if let Some(raw) = raw {
        request = request.header("cookie", format!("__Host-lal_session={raw}"));
    }
    if let Some(csrf) = csrf {
        request = request.header("x-lal-csrf", csrf);
    }
    router(auth.clone())
        .oneshot(request.body(Body::from(body.to_owned())).unwrap())
        .await
        .unwrap()
}
const ORIGIN: &str = "https://livroalivro.app.br";

#[tokio::test]
async fn callback_sets_host_only_cookies_and_redirects_without_secrets() {
    let (auth, _, _, _) = setup();
    let response = call(
        &auth,
        "POST",
        "/v1/auth/google/start",
        None,
        None,
        ORIGIN,
        "",
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    let url = url::Url::parse(body["authorizationUrl"].as_str().unwrap()).unwrap();
    let state = url
        .query_pairs()
        .find(|(key, _)| key == "state")
        .unwrap()
        .1
        .into_owned();
    let request = Request::builder()
        .uri(format!(
            "/v1/auth/google/callback?iss=https%3A%2F%2Faccounts.google.com&state={state}&code=synthetic-code"
        ))
        .header("cookie", cookie)
        .body(Body::empty())
        .unwrap();
    let response = router(auth).oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    assert_eq!(
        response.headers()["location"],
        "https://livroalivro.app.br/#/dados"
    );
    assert_eq!(response.headers()["cache-control"], "no-store");
    let cookies: Vec<_> = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|value| value.to_str().unwrap())
        .collect();
    assert_eq!(cookies.len(), 3);
    assert!(cookies[0].starts_with("__Host-lal_identity="));
    for cookie in cookies {
        assert!(cookie.contains("Path=/; Secure; HttpOnly; SameSite=Lax"));
        assert!(!cookie.contains("Domain="));
    }
}

#[tokio::test]
async fn oauth_state_is_bound_to_cookie_single_use_and_expiring() {
    let (auth, _, time, _) = setup();
    let (url, cookie) = auth.start_sign_in(None, None).await.unwrap();
    let state = url::Url::parse(&url)
        .unwrap()
        .query_pairs()
        .find(|(k, _)| k == "state")
        .unwrap()
        .1
        .into_owned();
    assert_eq!(
        auth.callback(&state, &random().unwrap(), "code")
            .await
            .err(),
        Some(Error::Unauthorized)
    );
    assert!(auth.callback(&state, &cookie, "code").await.is_ok());
    assert_eq!(
        auth.callback(&state, &cookie, "code").await.err(),
        Some(Error::Unauthorized)
    );
    let (url, cookie) = auth.start_sign_in(None, None).await.unwrap();
    let state = url::Url::parse(&url)
        .unwrap()
        .query_pairs()
        .find(|(k, _)| k == "state")
        .unwrap()
        .1
        .into_owned();
    time.0.store(1600, Ordering::Relaxed);
    assert_eq!(
        auth.callback(&state, &cookie, "code").await.err(),
        Some(Error::IdentityExpired)
    );
}
#[tokio::test]
async fn control_routes_reject_payload_queries_and_wrong_origin_without_echo() {
    let (auth, _, _, _) = setup();
    for origin in [
        "null",
        "http://localhost:5173",
        "https://evil.example",
        "https://livroalivro.app.br.evil.example",
    ] {
        let response = call(
            &auth,
            "POST",
            "/v1/auth/google/start",
            None,
            None,
            origin,
            "",
        )
        .await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(
            response
                .headers()
                .get("access-control-allow-origin")
                .is_none()
        );
        assert_eq!(response.headers()["cache-control"], "no-store");
    }
    for (path, body) in [
        ("/v1/auth/google/start", "{\"note\":\"private-text\"}"),
        ("/v1/session?token=private-text", ""),
    ] {
        let response = call(&auth, "POST", path, None, None, ORIGIN, body).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(
            !String::from_utf8(to_bytes(response.into_body(), 1024).await.unwrap().to_vec())
                .unwrap()
                .contains("private-text")
        );
    }
    let response = call(
        &auth,
        "POST",
        "/v1/auth/google/start",
        None,
        None,
        ORIGIN,
        &"x".repeat(17000),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
#[tokio::test]
async fn token_requires_csrf_and_is_post_only_no_store() {
    let (auth, store, _, _) = setup();
    let raw = connect(&auth).await;
    assert!(!store.0.lock().unwrap().sessions.contains_key(&raw));
    let response = call(
        &auth,
        "POST",
        "/v1/auth/drive-token",
        Some(&raw),
        None,
        ORIGIN,
        "",
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let response = call(
        &auth,
        "GET",
        "/v1/auth/drive-token",
        Some(&raw),
        None,
        ORIGIN,
        "",
    )
    .await;
    assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
    let response = call(
        &auth,
        "POST",
        "/v1/auth/drive-token",
        Some(&raw),
        Some(&auth.csrf(&raw).unwrap()),
        ORIGIN,
        "",
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let value: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 3);
    assert_eq!(value["accessToken"], "synthetic-access");
    assert_eq!(auth.access(&raw).await.err(), Some(Error::Busy));
}
#[tokio::test]
async fn rotation_expiration_and_logout_are_enforced() {
    let (auth, _, time, _) = setup();
    let raw = connect(&auth).await;
    let (next, _) = auth.renew(&raw).await.unwrap();
    assert_eq!(auth.session(&raw).await.err(), Some(Error::Unauthorized));
    let response = call(
        &auth,
        "DELETE",
        "/v1/session",
        Some(&next),
        Some(&auth.csrf(&next).unwrap()),
        ORIGIN,
        "",
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(
        response.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .contains("Max-Age=0")
    );
    assert_eq!(auth.session(&next).await.err(), Some(Error::Unauthorized));
    let raw = connect(&auth).await;
    time.0.store(1000 + SESSION_TTL, Ordering::Relaxed);
    assert_eq!(auth.session(&raw).await.err(), Some(Error::Unauthorized));
}
#[tokio::test]
async fn incomplete_consent_creates_no_session() {
    let (auth, store, _, provider) = setup();
    provider.mode.store(1, Ordering::Relaxed);
    let (url, cookie) = drive_start(&auth).await;
    let url = url::Url::parse(&url).unwrap();
    let state = url
        .query_pairs()
        .find(|(key, _)| key == "state")
        .unwrap()
        .1
        .into_owned();
    assert_eq!(
        auth.callback(&state, &cookie, "code").await.err(),
        Some(Error::IncompleteConsent)
    );
    assert!(store.0.lock().unwrap().sessions.is_empty());
}
#[tokio::test]
async fn invalid_grant_and_pending_revocation_block_all_sessions() {
    let (auth, _, _, provider) = setup();
    let first = connect(&auth).await;
    let second = connect(&auth).await;
    provider.mode.store(2, Ordering::Relaxed);
    assert_eq!(auth.access(&first).await.err(), Some(Error::Reconnect));
    assert_eq!(auth.session(&second).await.err(), Some(Error::Unauthorized));
    let (auth, _, _, provider) = setup();
    let raw = connect(&auth).await;
    provider.mode.store(3, Ordering::Relaxed);
    assert!(!auth.disconnect(&raw).await.unwrap());
    assert_eq!(auth.session(&raw).await.err(), Some(Error::Unauthorized));
}
#[tokio::test]
async fn revoked_or_expired_lease_cannot_publish_token_or_overwrite_refresh() {
    let (auth, store, time, _) = setup();
    let raw = connect(&auth).await;
    let lease = store
        .claim(&digest(&raw), "owner", time.now())
        .await
        .unwrap();
    assert_eq!(
        store
            .claim(&digest(&raw), "other", time.now())
            .await
            .err()
            .map(|e| e == Error::Busy),
        Some(true)
    );
    store.disable(&digest(&raw), time.now()).await.unwrap();
    assert_eq!(
        store.finish(&lease, Some(vec![1]), time.now()).await.err(),
        Some(Error::Unauthorized)
    );
    let (auth, store, time, _) = setup();
    let raw = connect(&auth).await;
    let lease = store
        .claim(&digest(&raw), "new-owner", time.now())
        .await
        .unwrap();
    time.0.fetch_add(LEASE_TTL, Ordering::Relaxed);
    assert_eq!(
        store.finish(&lease, None, time.now()).await.err(),
        Some(Error::Unauthorized)
    );
}
#[test]
fn scopes_are_exact_and_pkce_matches_rfc7636_vector() {
    assert!(valid_scopes(&SCOPES.join(" ")));
    assert!(!valid_scopes(DRIVE_SCOPE));
    assert!(!valid_scopes(&format!("openid {DRIVE_SCOPE} email")));
    assert!(!valid_scopes(
        "openid https://www.googleapis.com/auth/drive"
    ));
    assert_eq!(
        digest("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
}

#[tokio::test]
async fn callback_crossing_revocation_epoch_cannot_create_a_session() {
    let (mut auth, store, _, _) = setup();
    auth.provider = Arc::new(FakeGoogle {
        mode: AtomicU64::new(0),
        revoke_during_exchange: Some(store.clone()),
        ..Default::default()
    });
    let (url, cookie) = drive_start(&auth).await;
    let url = url::Url::parse(&url).unwrap();
    let state = url
        .query_pairs()
        .find(|(key, _)| key == "state")
        .unwrap()
        .1
        .into_owned();
    assert_eq!(
        auth.callback(&state, &cookie, "synthetic-code").await.err(),
        Some(Error::Busy)
    );
    assert!(store.0.lock().unwrap().sessions.is_empty());
}
#[tokio::test]
async fn deadline_crossed_during_finish_never_publishes_access_token() {
    let (auth, store, time, _) = setup();
    let raw = connect(&auth).await;
    store.0.lock().unwrap().finish_clock = Some(time);
    assert_eq!(auth.access(&raw).await.err(), Some(Error::Unauthorized));
}

#[tokio::test]
async fn callback_failure_is_static_human_readable_and_never_echoes_query() {
    let (auth, _, _, _) = setup();
    let response=router(auth).oneshot(Request::builder().uri("/v1/auth/google/callback?iss=https%3A%2F%2Faccounts.google.com&state=private-state&error=access_denied&code=private-code").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(
        response.headers()["content-type"]
            .to_str()
            .unwrap()
            .starts_with("text/html")
    );
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body =
        String::from_utf8(to_bytes(response.into_body(), 8192).await.unwrap().to_vec()).unwrap();
    assert!(body.contains("https://livroalivro.app.br/#/dados"));
    assert!(!body.contains("private-state"));
    assert!(!body.contains("private-code"));
    assert!(!body.contains("access_denied"));
}

#[tokio::test]
async fn identification_has_no_drive_authority_and_replaces_only_browser_session() {
    let (auth, store, _, provider) = setup();
    let old_session = connect(&auth).await;
    let other_session = connect(&auth).await;
    let old_identity = identify(&auth).await;
    let (url, oauth_cookie) = auth
        .start_sign_in(Some(&old_identity), Some(&old_session))
        .await
        .unwrap();
    assert!(auth.identity(&old_identity).await.is_err());
    assert!(auth.session(&old_session).await.is_err());
    assert!(auth.session(&other_session).await.is_ok());
    // Unexpected refresh in the first exchange never changes persisted credentials/session count.
    let before = store
        .0
        .lock()
        .unwrap()
        .connections
        .values()
        .next()
        .unwrap()
        .encrypted
        .clone();
    provider.mode.store(1, Ordering::Relaxed);
    let CallbackResult::Identity {
        raw_cookie,
        expires_at,
    } = auth
        .callback(&params(&url)["state"], &oauth_cookie, "code")
        .await
        .unwrap()
    else {
        panic!()
    };
    assert_eq!(expires_at, 1600);
    assert_eq!(store.0.lock().unwrap().sessions.len(), 1);
    assert_eq!(
        store
            .0
            .lock()
            .unwrap()
            .connections
            .values()
            .next()
            .unwrap()
            .encrypted,
        before
    );
    for (method, path) in [
        ("GET", "/v1/session"),
        ("POST", "/v1/session/renew"),
        ("POST", "/v1/auth/drive-token"),
    ] {
        let response = router(auth.clone())
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header("origin", ORIGIN)
                    .header("cookie", format!("__Host-lal_identity={raw_cookie}"))
                    .header("x-lal-csrf", auth.identity_csrf(&raw_cookie).unwrap())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    assert_eq!(
        auth.start_drive(&raw_cookie, &auth.csrf(&raw_cookie).unwrap())
            .await
            .err(),
        Some(Error::Forbidden)
    );
    assert_eq!(
        auth.cancel_identity(&raw_cookie, &auth.csrf(&raw_cookie).unwrap())
            .await
            .err(),
        Some(Error::Forbidden)
    );
    assert_eq!(
        auth.authorize(&other_session, &auth.identity_csrf(&other_session).unwrap())
            .await
            .err(),
        Some(Error::Forbidden)
    );
}

#[tokio::test]
async fn first_callback_is_ephemeral_and_drive_requires_matching_account_and_complete_permission() {
    let (auth, store, time, provider) = setup();
    let raw = identify(&auth).await;
    {
        let db = store.0.lock().unwrap();
        assert_eq!(db.identities.len(), 1);
        assert!(db.sessions.is_empty());
        assert!(db.connections.is_empty());
        assert_eq!(db.epoch, 0);
    }
    let csrf = auth.identity_csrf(&raw).unwrap();
    for (mode, error) in [
        (4, Error::AccountMismatch),
        (5, Error::IncompleteConsent),
        (1, Error::IncompleteConsent),
    ] {
        let (url, cookie) = auth.start_drive(&raw, &csrf).await.unwrap();
        provider.mode.store(mode, Ordering::Relaxed);
        assert_eq!(
            auth.callback(&params(&url)["state"], &cookie, "code")
                .await
                .err(),
            Some(error)
        );
        assert!(auth.identity(&raw).await.is_ok());
        assert!(store.0.lock().unwrap().connections.is_empty());
    }
    time.0.store(1600, Ordering::Relaxed);
    assert_eq!(
        auth.start_drive(&raw, &csrf).await.err(),
        Some(Error::Unauthorized)
    );
    assert!(
        store
            .0
            .lock()
            .unwrap()
            .identities
            .contains_key(&digest(&raw))
    );
}

#[tokio::test]
async fn canceled_pending_identity_cannot_connect_or_cancel_a_new_identity() {
    let (auth, store, _, _) = setup();
    let old = identify(&auth).await;
    let csrf = auth.identity_csrf(&old).unwrap();
    let (url, cookie) = auth.start_drive(&old, &csrf).await.unwrap();
    auth.cancel_identity(&old, &csrf).await.unwrap();
    let new = identify(&auth).await;
    assert_eq!(
        auth.cancel_identity(&new, &csrf).await.err(),
        Some(Error::Forbidden)
    );
    assert_eq!(
        auth.callback(&params(&url)["state"], &cookie, "code")
            .await
            .err(),
        Some(Error::IdentityExpired)
    );
    assert!(store.0.lock().unwrap().sessions.is_empty());
    assert!(auth.identity(&new).await.is_ok());
}

#[tokio::test]
async fn callback_errors_are_specific_static_and_denial_consumes_state() {
    let (auth, _, _, _) = setup();
    for (provider_error, expected) in [
        ("access_denied", "cancelada ou negada"),
        ("server_error", "Não foi possível"),
    ] {
        let (url, cookie) = auth.start_sign_in(None, None).await.unwrap();
        let state = &params(&url)["state"];
        let response = router(auth.clone()).oneshot(Request::builder()
            .uri(format!("/v1/auth/google/callback?iss=https%3A%2F%2Faccounts.google.com&state={state}&error={provider_error}&error_description=DO_NOT_ECHO"))
            .header("cookie", format!("__Host-lal_oauth={cookie}")).body(Body::empty()).unwrap()).await.unwrap();
        let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
        let html = std::str::from_utf8(&bytes).unwrap();
        assert!(html.contains(expected));
        assert!(!html.contains("DO_NOT_ECHO"));
        assert!(!html.contains(state));
        assert_eq!(
            auth.callback(state, &cookie, "code").await.err(),
            Some(Error::Unauthorized)
        );
    }
}

struct NoCipher;
#[async_trait]
impl Crypto for NoCipher {
    async fn seal(&self, _: &str, _: &str) -> Result<Vec<u8>, Error> {
        panic!("first step must not encrypt")
    }
    async fn open(&self, _: &str, _: &[u8]) -> Result<Secret, Error> {
        panic!("first step must not decrypt")
    }
    fn mac(&self, purpose: &str, value: &str) -> Result<String, Error> {
        TestCrypto.mac(purpose, value)
    }
}
#[tokio::test]
async fn identification_never_calls_kms_even_with_unexpected_refresh() {
    let (mut auth, store, _, _) = setup();
    auth.crypto = Arc::new(NoCipher);
    let raw = identify(&auth).await;
    assert!(auth.identity(&raw).await.is_ok());
    assert!(store.0.lock().unwrap().connections.is_empty());
}

#[tokio::test]
async fn http_identity_and_explicit_drive_start_issue_only_the_correct_cookies() {
    let (auth, _, _, _) = setup();
    let raw = identify(&auth).await;
    let request = |method: &str, path: &str, csrf: Option<&str>| {
        let mut builder = Request::builder()
            .method(method)
            .uri(path)
            .header("origin", ORIGIN)
            .header("cookie", format!("__Host-lal_identity={raw}"));
        if let Some(csrf) = csrf {
            builder = builder.header("x-lal-csrf", csrf);
        }
        builder.body(Body::empty()).unwrap()
    };
    let response = router(auth.clone())
        .oneshot(request("GET", "/v1/auth/google/identity", None))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(body.as_object().unwrap().len(), 3);
    assert_eq!(body["expiresAt"], 1600);
    let csrf = body["csrfToken"].as_str().unwrap();
    let response = router(auth.clone())
        .oneshot(request("POST", "/v1/auth/google/drive/start", None))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let response = router(auth.clone())
        .oneshot(request("POST", "/v1/auth/google/drive/start", Some(csrf)))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let oauth_cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    assert!(oauth_cookie.starts_with("__Host-lal_oauth="));
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    let values = params(body["authorizationUrl"].as_str().unwrap());
    assert_eq!(values["scope"], SCOPES.join(" "));
    let response = router(auth.clone())
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/v1/auth/google/callback?iss=https%3A%2F%2Faccounts.google.com&state={}&code=synthetic",
                    values["state"]
                ))
                .header("cookie", oauth_cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SEE_OTHER);
    let cookies: Vec<_> = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|v| v.to_str().unwrap())
        .collect();
    assert!(
        cookies
            .iter()
            .any(|v| v.starts_with("__Host-lal_session=") && !v.contains("Max-Age=0"))
    );
    assert!(
        cookies
            .iter()
            .any(|v| v.starts_with("__Host-lal_identity=;") && v.contains("Max-Age=0"))
    );
    assert!(auth.identity(&raw).await.is_err());
    let next = identify(&auth).await;
    let response = router(auth.clone())
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/v1/auth/google/identity")
                .header("origin", ORIGIN)
                .header("cookie", format!("__Host-lal_identity={next}"))
                .header("x-lal-csrf", auth.identity_csrf(&next).unwrap())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(
        response.headers()["set-cookie"]
            .to_str()
            .unwrap()
            .contains("Max-Age=0")
    );
    assert!(auth.identity(&next).await.is_err());
}

#[tokio::test]
async fn callback_requires_one_exact_google_issuer_before_exchange_or_denial() {
    let (auth, store, _, provider) = setup();
    for issuer in [
        "",
        "iss=&",
        "iss=https%3A%2F%2Fevil.example&",
        "iss=accounts.google.com&",
        "iss=https%3A%2F%2Faccounts.google.com%2F&",
        "iss=https%3A%2F%2FACCOUNTS.google.com&",
        "iss=https%3A%2F%2Faccounts.google.com&iss=https%3A%2F%2Faccounts.google.com&",
        "iss=https%3A%2F%2Faccounts.google.com&iss=https%3A%2F%2Fevil.example&",
    ] {
        for result in [
            "code=synthetic-private-code",
            "error=access_denied&error_description=synthetic-private-description",
        ] {
            let (url, cookie) = auth.start_sign_in(None, None).await.unwrap();
            let state = &params(&url)["state"];
            let response = router(auth.clone())
                .oneshot(
                    Request::builder()
                        .uri(format!(
                            "/v1/auth/google/callback?{issuer}state={state}&{result}"
                        ))
                        .header("cookie", format!("__Host-lal_oauth={cookie}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            assert_eq!(response.headers()["cache-control"], "no-store");
            let html =
                String::from_utf8(to_bytes(response.into_body(), 4096).await.unwrap().to_vec())
                    .unwrap();
            assert!(html.contains("Não foi possível concluir a conexão com Google."));
            for private in [
                state.as_str(),
                "synthetic-private-code",
                "synthetic-private-description",
                "evil.example",
                "cancelada ou negada",
            ] {
                assert!(!html.contains(private));
            }
            assert_eq!(provider.exchanges.load(Ordering::Relaxed), 0);
            assert!(store.0.lock().unwrap().oauth.contains_key(&digest(state)));
        }
    }
}

#[tokio::test]
async fn callback_with_google_issuer_cannot_replay_consumed_state() {
    let (auth, _, _, provider) = setup();
    let (url, cookie) = auth.start_sign_in(None, None).await.unwrap();
    let state = &params(&url)["state"];
    for expected in [StatusCode::SEE_OTHER, StatusCode::UNAUTHORIZED] {
        let response = router(auth.clone()).oneshot(Request::builder()
            .uri(format!("/v1/auth/google/callback?state={state}&iss=https%3A%2F%2Faccounts.google.com&code=synthetic&scope=malicious-scope&authuser=0&prompt=select_account&redirect_uri=https%3A%2F%2Fevil.example&access_token=synthetic-untrusted&future_parameter=ignored"))
            .header("cookie", format!("__Host-lal_oauth={cookie}"))
            .body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), expected);
        if expected == StatusCode::SEE_OTHER {
            assert_eq!(
                response.headers()["location"],
                "https://livroalivro.app.br/#/dados"
            );
            assert!(
                response
                    .headers()
                    .get_all("set-cookie")
                    .iter()
                    .any(|v| v.to_str().unwrap().starts_with("__Host-lal_identity="))
            );
            assert!(
                !response.headers().get_all("set-cookie").iter().any(|v| v
                    .to_str()
                    .unwrap()
                    .starts_with("__Host-lal_session=")
                    && !v.to_str().unwrap().contains("Max-Age=0"))
            );
        }
    }
    assert_eq!(provider.exchanges.load(Ordering::Relaxed), 1);
}

#[tokio::test]
async fn callback_rejects_duplicate_known_fields_even_when_issuer_is_valid() {
    let (auth, store, _, provider) = setup();
    for duplicate in [
        "state=other-state",
        "code=other-code",
        "scope=other-scope",
        "error=server_error",
    ] {
        let (url, cookie) = auth.start_sign_in(None, None).await.unwrap();
        let state = &params(&url)["state"];
        let response = router(auth.clone()).oneshot(Request::builder()
            .uri(format!("/v1/auth/google/callback?iss=https%3A%2F%2Faccounts.google.com&state={state}&code=synthetic&scope=openid&error=access_denied&{duplicate}"))
            .header("cookie", format!("__Host-lal_oauth={cookie}"))
            .body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert!(store.0.lock().unwrap().oauth.contains_key(&digest(state)));
    }
    assert_eq!(provider.exchanges.load(Ordering::Relaxed), 0);
}
