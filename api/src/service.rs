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
    pub async fn start_sign_in(
        &self,
        identity: Option<&str>,
        session: Option<&str>,
    ) -> Result<(String, String), Error> {
        if let Some(raw) = identity.filter(|v| opaque(v)) {
            self.store.delete_identity(&digest(raw)).await?;
        }
        if let Some(raw) = session.filter(|v| opaque(v)) {
            self.store.logout(&digest(raw)).await?;
        }
        self.start_oauth(OAuthPurpose::SignIn, None).await
    }
    async fn start_oauth(
        &self,
        purpose: OAuthPurpose,
        identity: Option<&PendingIdentity>,
    ) -> Result<(String, String), Error> {
        let state = random()?;
        let cookie = random()?;
        let nonce = random()?;
        let verifier = random()?;
        let now = self.clock.now();
        let url = self
            .config
            .authorization_url(&state, &nonce, &digest(&verifier), &purpose);
        let transaction = Transaction {
            purpose,
            cookie_hash: digest(&cookie),
            nonce: Secret(nonce),
            verifier: Secret(verifier),
            expires_at: identity.map_or(now + OAUTH_TTL, |i| (now + OAUTH_TTL).min(i.expires_at)),
        };
        if let Some(expected) = identity {
            self.store
                .put_drive_oauth(&digest(&state), transaction, expected, now)
                .await?;
        } else {
            self.store.put_oauth(&digest(&state), transaction).await?;
        }
        Ok((url, cookie))
    }
    pub async fn identity(&self, raw: &str) -> Result<PendingIdentity, Error> {
        if !opaque(raw) {
            return Err(Error::Unauthorized);
        }
        self.store.identity(&digest(raw), self.clock.now()).await
    }
    pub fn identity_csrf(&self, raw: &str) -> Result<String, Error> {
        self.crypto.mac("identity-csrf", raw)
    }
    pub async fn authorize_identity(
        &self,
        raw: &str,
        csrf: &str,
    ) -> Result<PendingIdentity, Error> {
        let identity = self.identity(raw).await?;
        if !equal(&self.identity_csrf(raw)?, csrf) {
            return Err(Error::Forbidden);
        }
        Ok(identity)
    }
    pub async fn start_drive(&self, raw: &str, csrf: &str) -> Result<(String, String), Error> {
        let identity = self.authorize_identity(raw, csrf).await?;
        self.start_oauth(
            OAuthPurpose::Drive {
                identity_hash: digest(raw),
                expected_connection: identity.connection_id.clone(),
            },
            Some(&identity),
        )
        .await
    }
    pub async fn cancel_identity(&self, raw: &str, csrf: &str) -> Result<(), Error> {
        self.authorize_identity(raw, csrf).await?;
        self.store.delete_identity(&digest(raw)).await
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
        let pending = match &transaction.purpose {
            OAuthPurpose::SignIn => None,
            OAuthPurpose::Drive {
                identity_hash,
                expected_connection,
            } => {
                let identity = self
                    .store
                    .identity(identity_hash, self.clock.now())
                    .await
                    .map_err(identity_error)?;
                if !equal(&identity.connection_id, expected_connection) {
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
                let expires_at = self.clock.now() + OAUTH_TTL;
                self.store
                    .put_identity(
                        &digest(&raw_cookie),
                        PendingIdentity {
                            connection_id: connection,
                            expires_at,
                        },
                    )
                    .await?;
                Ok(CallbackResult::Identity {
                    raw_cookie,
                    expires_at,
                })
            }
            (
                OAuthPurpose::Drive {
                    identity_hash,
                    expected_connection,
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
                if self.clock.now() >= identity.expires_at {
                    return Err(Error::IdentityExpired);
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
                    self.store.logout(&digest(&raw_session)).await?;
                    return Err(Error::IdentityExpired);
                }
                Ok(CallbackResult::Drive { raw_session })
            }
            _ => Err(Error::Unauthorized),
        }
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
