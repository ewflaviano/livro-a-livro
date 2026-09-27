use async_trait::async_trait;
use zeroize::Zeroize;

/// Intentionally no Debug/Serialize: secrets must never enter logs or responses by accident.
pub struct Secret(pub String);
impl Drop for Secret {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    Forbidden,
    Unauthorized,
    InvalidRequest,
    IncompleteConsent,
    Busy,
    Reconnect,
    InvalidGrant,
    Provider,
    Unavailable,
    Configuration,
}

pub struct Grant {
    /// Provider already verified JWT signature, issuer, audience, expiration and nonce.
    pub subject: Secret,
    pub refresh_token: Option<Secret>,
    pub scope: String,
}
pub struct Access {
    pub token: Secret,
    pub expires_in: u64,
    pub scope: Option<String>,
    pub rotated_refresh: Option<Secret>,
}
#[async_trait]
pub trait Provider: Send + Sync {
    async fn exchange(&self, code: &str, verifier: &str, nonce: &str) -> Result<Grant, Error>;
    async fn refresh(&self, refresh: &str) -> Result<Access, Error>;
    async fn revoke(&self, refresh: &str) -> RevokeOutcome;
}

#[async_trait]
pub trait Crypto: Send + Sync {
    /// Authenticated encryption with environment/connection as authenticated context (KMS).
    async fn seal(&self, context: &str, plaintext: &str) -> Result<Vec<u8>, Error>;
    async fn open(&self, context: &str, ciphertext: &[u8]) -> Result<Secret, Error>;
    /// Keyed, purpose-separated HMAC, using a secret sourced from Secrets Manager.
    fn mac(&self, purpose: &str, value: &str) -> Result<String, Error>;
}

pub trait Clock: Send + Sync {
    fn now(&self) -> u64;
}
pub struct SystemClock;
impl Clock for SystemClock {
    fn now(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    }
}

pub struct Transaction {
    pub cookie_hash: String,
    pub nonce: Secret,
    pub verifier: Secret,
    pub expires_at: u64,
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct Session {
    pub connection_id: String,
    pub generation: u64,
    pub expires_at: u64,
    pub absolute_expires_at: u64,
}
pub struct Lease {
    pub session_hash: String,
    pub authorization_until: u64,
    pub connection_id: String,
    pub generation: u64,
    pub owner: String,
    pub encrypted_refresh: Vec<u8>,
}

#[derive(Clone)]
pub struct RevocationKey {
    pub connection_id: String,
    pub generation: u64,
    pub revocation_id: String,
}
pub struct RevocationClaim {
    pub key: RevocationKey,
    pub owner: String,
    pub lease_until: u64,
    pub delete_at: u64,
    pub encrypted_refresh: Vec<u8>,
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RevokeOutcome {
    Confirmed,
    NotDispatchedRetryable,
    Uncertain,
}

#[derive(Clone, Copy)]
pub enum InvalidationReason {
    InvalidGrant,
    ScopeChanged,
}

/// All methods are strongly consistent and atomic across processes/Lambda instances.
/// Implementations MUST verify deadlines inside the transaction, not rely on TTL cleanup.
#[async_trait]
pub trait Store: Send + Sync {
    async fn grant_epoch(&self) -> Result<u64, Error>;
    async fn put_oauth(&self, state_hash: &str, transaction: Transaction) -> Result<(), Error>;
    /// Atomically check cookie hash + expiry and delete; wrong cookie must not consume it.
    async fn take_oauth(
        &self,
        state_hash: &str,
        cookie_hash: &str,
        now: u64,
    ) -> Result<Transaction, Error>;
    /// Atomically create/replace encrypted credentials and create a session. Preserve generation
    /// for an active connection; reconnection after disable increments it. Honor refresh lease.
    /// Never resurrect a disabled connection via an old concurrent operation.
    async fn connect(
        &self,
        connection: &str,
        encrypted_refresh: Vec<u8>,
        session_hash: &str,
        expected_grant_epoch: u64,
        now: u64,
    ) -> Result<Session, Error>;
    /// Validate session deadline, active connection, generation and 180-day connection inactivity.
    async fn session(&self, hash: &str, now: u64) -> Result<Session, Error>;
    /// Atomic rotation: old hash removed, same connection/generation and absolute deadline.
    async fn renew(&self, old_hash: &str, new_hash: &str, now: u64) -> Result<Session, Error>;
    async fn logout(&self, hash: &str) -> Result<(), Error>;
    /// Distributed lease, revalidate session/generation, rate limit to one refresh/30s per
    /// connection, lease timeout 30s and unpredictable owner as fencing token.
    async fn claim(&self, session_hash: &str, owner: &str, now: u64) -> Result<Lease, Error>;
    /// Conditional on unexpired owner lease + active generation. Apply rotation atomically.
    /// A stale holder MUST fail and MUST NOT emit its newly acquired access token.
    async fn finish(&self, lease: &Lease, rotated: Option<Vec<u8>>, now: u64) -> Result<(), Error>;
    async fn release(&self, lease: &Lease) -> Result<(), Error>;
    /// Disable only the still-owned lease/generation, before releasing it on invalid_grant.
    /// A concurrent newer consent must never be invalidated by an old refresh failure.
    async fn invalidate(
        &self,
        lease: &Lease,
        reason: InvalidationReason,
        now: u64,
    ) -> Result<(), Error>;
    /// Block immediately, bump generation and invalidate leases before provider revocation.
    /// Retain ciphertext only for revocation retry (max 24h). No new access is permitted.
    async fn disable(&self, session_hash: &str, now: u64) -> Result<RevocationKey, Error>;
    async fn claim_revocation(
        &self,
        key: &RevocationKey,
        owner: &str,
        now: u64,
    ) -> Result<RevocationClaim, Error>;
    async fn mark_revocation_dispatching(
        &self,
        claim: &RevocationClaim,
        now: u64,
    ) -> Result<(), Error>;
    async fn complete_revocation(
        &self,
        claim: &RevocationClaim,
        outcome: RevokeOutcome,
        now: u64,
    ) -> Result<(), Error>;
}
