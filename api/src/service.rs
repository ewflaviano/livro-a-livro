use crate::{config::*, ports::*};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use subtle::ConstantTimeEq;

#[derive(Clone)]
pub struct Auth {
    pub config: Config,
    pub provider: Arc<dyn Provider>,
    pub store: Arc<dyn Store>,
    pub crypto: Arc<dyn Crypto>,
    pub clock: Arc<dyn Clock>,
}

pub fn digest(value: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(value.as_bytes()))
}

/// Shared primitive for a Secrets Manager-backed Crypto adapter. Purpose-separated,
/// length-delimited input prevents collisions across connection IDs and CSRF tokens.
pub fn keyed_digest(key: &[u8], purpose: &str, value: &str) -> Result<String, Error> {
    use hmac::{Hmac, Mac};
    if key.len() < 32 {
        return Err(Error::Configuration);
    }
    let mut mac = Hmac::<Sha256>::new_from_slice(key).map_err(|_| Error::Configuration)?;
    mac.update(&(purpose.len() as u64).to_be_bytes());
    mac.update(purpose.as_bytes());
    mac.update(value.as_bytes());
    Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
}
pub fn random() -> Result<String, Error> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| Error::Unavailable)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
pub fn equal(a: &str, b: &str) -> bool {
    bool::from(a.as_bytes().ct_eq(b.as_bytes()))
}
pub fn opaque(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

impl Auth {
    pub async fn login(&self, raw: &str) -> Result<Login, Error> {
        if !opaque(raw) {
            return Err(Error::Unauthorized);
        }
        self.store.login(&digest(raw), self.clock.now()).await
    }
    pub fn login_csrf(&self, raw: &str) -> Result<String, Error> {
        self.crypto.mac("login-csrf", raw)
    }
    pub fn authorization_csrf(&self, raw: &str) -> Result<String, Error> {
        self.crypto.mac("oauth-cancel-csrf", raw)
    }
    pub async fn authorize_login(&self, raw: &str, csrf: &str) -> Result<Login, Error> {
        let login = self.login(raw).await?;
        if !equal(&self.login_csrf(raw)?, csrf) {
            return Err(Error::Forbidden);
        }
        Ok(login)
    }
    pub async fn authorization(&self, raw: &str) -> Result<AuthorizationAttempt, Error> {
        if !opaque(raw) {
            return Err(Error::Unauthorized);
        }
        let attempt = self
            .store
            .authorization(&digest(raw), self.clock.now())
            .await?;
        if attempt.phase == AttemptPhase::Cancelled {
            return Err(Error::Unauthorized);
        }
        Ok(attempt)
    }
    pub async fn cancel_authorization(&self, raw: &str, csrf: &str, id: &str) -> Result<(), Error> {
        if !opaque(raw) || !attempt_id(id) {
            return Err(Error::InvalidRequest);
        }
        if !equal(&self.authorization_csrf(raw)?, csrf) {
            return Err(Error::Forbidden);
        }
        self.store
            .cancel_authorization(&digest(raw), id, self.clock.now())
            .await
    }
    pub async fn renew_login(&self, raw: &str, csrf: &str) -> Result<Login, Error> {
        self.authorize_login(raw, csrf).await?;
        let login = self
            .store
            .renew_login(&digest(raw), self.clock.now())
            .await?;
        if !login.valid(self.clock.now()) {
            return Err(Error::Unauthorized);
        }
        Ok(login)
    }
    pub async fn logout_login(
        &self,
        raw: &str,
        csrf: &str,
        session: Option<&str>,
        oauth: Option<&str>,
    ) -> Result<(), Error> {
        self.authorize_login(raw, csrf).await?;
        let login = digest(raw);
        let session = session.map(digest);
        let oauth = oauth.map(digest);
        self.store
            .logout_login(
                PreviousAuthorization {
                    login_hash: Some(&login),
                    session_hash: session.as_deref(),
                    attempt_hash: oauth.as_deref(),
                },
                self.clock.now(),
            )
            .await
    }
    pub async fn start_sign_in(
        &self,
        id: &str,
        login: Option<&str>,
        session: Option<&str>,
        oauth: Option<&str>,
        csrf: Option<&str>,
    ) -> Result<(String, String), Error> {
        if !attempt_id(id) {
            return Err(Error::InvalidRequest);
        }
        if let Some(raw) = login {
            match self.login(raw).await {
                Ok(_) => {
                    self.authorize_login(raw, csrf.ok_or(Error::Forbidden)?)
                        .await?;
                }
                Err(Error::Unauthorized) => {}
                Err(error) => return Err(error),
            }
        }
        let (state, cookie, transaction, url) =
            self.new_oauth(id, OAuthPurpose::SignIn, self.clock.now() + OAUTH_TTL)?;
        let login = login.map(digest);
        let session = session.map(digest);
        let oauth = oauth.map(digest);
        self.store
            .begin_sign_in(
                &digest(&state),
                transaction,
                PreviousAuthorization {
                    login_hash: login.as_deref(),
                    session_hash: session.as_deref(),
                    attempt_hash: oauth.as_deref(),
                },
                self.clock.now(),
            )
            .await?;
        Ok((url, cookie))
    }
    fn new_oauth(
        &self,
        id: &str,
        purpose: OAuthPurpose,
        expires_at: u64,
    ) -> Result<(String, String, Transaction, String), Error> {
        let state = random()?;
        let cookie = random()?;
        let nonce = random()?;
        let verifier = random()?;
        let url = self
            .config
            .authorization_url(&state, &nonce, &digest(&verifier), &purpose);
        let transaction = Transaction {
            version: 2,
            attempt_id: id.into(),
            purpose,
            cookie_hash: digest(&cookie),
            nonce: Secret(nonce),
            verifier: Secret(verifier),
            expires_at,
        };
        Ok((state, cookie, transaction, url))
    }
    pub async fn start_drive(
        &self,
        raw: &str,
        csrf: &str,
        id: &str,
    ) -> Result<(String, String), Error> {
        if !attempt_id(id) {
            return Err(Error::InvalidRequest);
        }
        let login = self.authorize_login(raw, csrf).await?;
        let purpose = OAuthPurpose::Drive {
            identity_hash: digest(&random()?),
            expected_connection: login.connection_id.clone(),
            login_hash: digest(raw),
            drive_epoch: login.drive_epoch.checked_add(1).ok_or(Error::Unavailable)?,
        };
        let expires = (self.clock.now() + OAUTH_TTL)
            .min(login.expires_at)
            .min(login.absolute_expires_at);
        let (state, cookie, transaction, url) = self.new_oauth(id, purpose, expires)?;
        self.store
            .begin_drive(&digest(&state), transaction, &login, self.clock.now())
            .await?;
        Ok((url, cookie))
    }
    pub async fn callback(
        &self,
        state: &str,
        cookie: &str,
        code: &str,
    ) -> Result<CallbackResult, Error> {
        if !opaque(state) || !opaque(cookie) || code.is_empty() || code.len() > 4096 {
            return Err(Error::InvalidRequest);
        }
        let transaction = self
            .store
            .take_oauth(&digest(state), &digest(cookie), self.clock.now())
            .await?;
        let attempt = self.authorization(cookie).await?;
        if transaction.version != 2
            || attempt.phase != AttemptPhase::Pending
            || attempt.attempt_id != transaction.attempt_id
            || attempt.purpose != transaction.purpose
        {
            return Err(Error::IdentityExpired);
        }
        let pending = match &transaction.purpose {
            OAuthPurpose::SignIn => None,
            OAuthPurpose::Drive {
                identity_hash,
                expected_connection,
                login_hash,
                drive_epoch,
            } => {
                let identity = self
                    .store
                    .identity(identity_hash, self.clock.now())
                    .await
                    .map_err(identity_error)?;
                let login = self.store.login(login_hash, self.clock.now()).await?;
                if identity.connection_id != *expected_connection
                    || identity.login_hash != *login_hash
                    || identity.drive_epoch != *drive_epoch
                    || identity.attempt_hash != digest(cookie)
                    || identity.attempt_id != transaction.attempt_id
                    || login.connection_id != *expected_connection
                    || login.drive_epoch != *drive_epoch
                    || login.drive_attempt_id.as_deref() != Some(&transaction.attempt_id)
                {
                    return Err(Error::IdentityExpired);
                }
                Some((identity, self.store.grant_epoch().await?))
            }
        };
        if self.clock.now() >= transaction.expires_at {
            return Err(Error::IdentityExpired);
        }
        let grant = self
            .provider
            .exchange(
                code,
                &transaction.verifier.0,
                &transaction.nonce.0,
                &transaction.purpose,
            )
            .await?;
        if self.clock.now() >= transaction.expires_at {
            return Err(Error::IdentityExpired);
        }
        let connection = self.crypto.mac("connection", &grant.subject.0)?;
        match (&transaction.purpose, pending) {
            (OAuthPurpose::SignIn, None) => {
                let raw_cookie = random()?;
                let login = self
                    .store
                    .finish_sign_in(
                        &digest(cookie),
                        &transaction.attempt_id,
                        &digest(&raw_cookie),
                        &connection,
                        self.clock.now(),
                    )
                    .await?;
                if self.clock.now() >= transaction.expires_at {
                    self.store
                        .logout_login(
                            PreviousAuthorization {
                                login_hash: Some(&digest(&raw_cookie)),
                                session_hash: None,
                                attempt_hash: None,
                            },
                            self.clock.now(),
                        )
                        .await?;
                    return Err(Error::IdentityExpired);
                }
                Ok(CallbackResult::Login {
                    raw_cookie,
                    expires_at: login.expires_at,
                })
            }
            (
                OAuthPurpose::Drive {
                    identity_hash,
                    expected_connection,
                    ..
                },
                Some((identity, epoch)),
            ) => {
                if !equal(&connection, expected_connection) {
                    return Err(Error::AccountMismatch);
                }
                if !valid_scopes(&grant.scope) {
                    return Err(Error::IncompleteConsent);
                }
                let refresh = grant.refresh_token.ok_or(Error::IncompleteConsent)?;
                if refresh.0.is_empty() {
                    return Err(Error::IncompleteConsent);
                }
                let encrypted = self
                    .crypto
                    .seal(&self.context(&connection), &refresh.0)
                    .await?;
                let raw_session = random()?;
                self.store
                    .connect(
                        &connection,
                        encrypted,
                        &digest(&raw_session),
                        epoch,
                        IdentityConsumption {
                            hash: identity_hash,
                            expected: &identity,
                        },
                        self.clock.now(),
                    )
                    .await?;
                if self.clock.now() >= identity.expires_at {
                    self.store
                        .logout(&digest(&raw_session), self.clock.now())
                        .await?;
                    return Err(Error::IdentityExpired);
                }
                Ok(CallbackResult::Drive { raw_session })
            }
            _ => Err(Error::Unauthorized),
        }
    }
    pub async fn bound_session(&self, raw: &str, login_raw: &str) -> Result<Session, Error> {
        let login = self.login(login_raw).await?;
        let session = self.session(raw).await?;
        if session.login_hash != digest(login_raw)
            || session.connection_id != login.connection_id
            || session.login_drive_epoch != login.drive_epoch
        {
            return Err(Error::Unauthorized);
        }
        Ok(session)
    }
    pub async fn session(&self, raw: &str) -> Result<Session, Error> {
        if !opaque(raw) {
            return Err(Error::Unauthorized);
        }
        self.store.session(&digest(raw), self.clock.now()).await
    }
    pub fn csrf(&self, raw: &str) -> Result<String, Error> {
        self.crypto.mac("csrf", raw)
    }
    pub async fn authorize(&self, raw: &str, csrf: &str) -> Result<Session, Error> {
        let session = self.session(raw).await?;
        if !equal(&self.csrf(raw)?, csrf) {
            return Err(Error::Forbidden);
        }
        Ok(session)
    }
    pub async fn renew(&self, raw: &str) -> Result<(String, Session), Error> {
        let next = random()?;
        let session = self
            .store
            .renew(&digest(raw), &digest(&next), self.clock.now())
            .await?;
        Ok((next, session))
    }
    pub async fn access(&self, raw: &str) -> Result<Access, Error> {
        let lease = self
            .store
            .claim(&digest(raw), &random()?, self.clock.now())
            .await?;
        let result = self.refresh_locked(&lease).await;
        if matches!(result, Err(Error::Reconnect | Error::InvalidGrant)) {
            let reason = if matches!(result, Err(Error::InvalidGrant)) {
                InvalidationReason::InvalidGrant
            } else {
                InvalidationReason::ScopeChanged
            };
            self.store
                .invalidate(&lease, reason, self.clock.now())
                .await?;
            return Err(Error::Reconnect);
        } else if result.is_err() {
            let _ = self.store.release(&lease).await;
        }
        result
    }
    async fn refresh_locked(&self, lease: &Lease) -> Result<Access, Error> {
        let context = self.context(&lease.connection_id);
        let refresh = self.crypto.open(&context, &lease.encrypted_refresh).await?;
        if self.clock.now() >= lease.authorization_until {
            return Err(Error::Unauthorized);
        }
        let mut access = self.provider.refresh(&refresh.0).await?;
        if access.token.0.is_empty() || access.expires_in == 0 || access.expires_in > 3600 {
            return Err(Error::Provider);
        }
        if access.scope.as_ref().is_some_and(|s| !valid_scopes(s)) {
            return Err(Error::Reconnect);
        }
        let rotated = match access.rotated_refresh.take() {
            Some(value) if !value.0.is_empty() => Some(self.crypto.seal(&context, &value.0).await?),
            Some(_) => return Err(Error::Provider),
            None => None,
        };
        self.store.finish(lease, rotated, self.clock.now()).await?;
        // AWS round trips can cross a deadline even when the CAS preserved state.
        // Rotation is retained, but a token is never published after its authorization.
        if self.clock.now() >= lease.authorization_until {
            return Err(Error::Unauthorized);
        }
        Ok(access)
    }
    pub async fn disconnect(&self, raw: &str) -> Result<bool, Error> {
        let key = self.store.disable(&digest(raw), self.clock.now()).await?;
        // Blocking is durable even if decryption/provider/worker fails afterwards.
        let outcome = self.revoke_key(&key).await;
        if matches!(outcome, Ok(RevokeOutcome::Uncertain)) {
            crate::metrics::uncertain_revocation();
        }
        Ok(matches!(outcome, Ok(RevokeOutcome::Confirmed)))
    }
    pub async fn revoke_key(&self, key: &RevocationKey) -> Result<RevokeOutcome, Error> {
        let claim = self
            .store
            .claim_revocation(key, &random()?, self.clock.now())
            .await?;
        if self.clock.now() >= claim.delete_at.min(claim.lease_until) {
            return Err(Error::Unauthorized);
        }
        let refresh = match self
            .crypto
            .open(&self.context(&key.connection_id), &claim.encrypted_refresh)
            .await
        {
            Ok(value) => value,
            Err(_) => {
                self.store
                    .complete_revocation(
                        &claim,
                        RevokeOutcome::NotDispatchedRetryable,
                        self.clock.now(),
                    )
                    .await?;
                return Ok(RevokeOutcome::NotDispatchedRetryable);
            }
        };
        self.store
            .mark_revocation_dispatching(&claim, self.clock.now())
            .await?;
        // A persisted dispatch marker ensures a terminated Lambda cannot cause a blind retry.
        let remaining = claim
            .delete_at
            .min(claim.lease_until)
            .saturating_sub(self.clock.now());
        if remaining == 0 {
            return Err(Error::Unauthorized);
        }
        let outcome = tokio::time::timeout(
            std::time::Duration::from_secs(remaining),
            self.provider.revoke(&refresh.0),
        )
        .await
        .unwrap_or(RevokeOutcome::Uncertain);
        self.store
            .complete_revocation(&claim, outcome, self.clock.now())
            .await?;
        Ok(outcome)
    }
    fn context(&self, connection: &str) -> String {
        format!("{}:{connection}", self.config.environment)
    }
}

fn identity_error(error: Error) -> Error {
    if error == Error::Unauthorized {
        Error::IdentityExpired
    } else {
        error
    }
}

pub fn attempt_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
}
