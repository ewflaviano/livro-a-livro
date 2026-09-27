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
    pub async fn start(&self) -> Result<(String, String), Error> {
        let state = random()?;
        let cookie = random()?;
        let nonce = random()?;
        let verifier = random()?;
        let url = self
            .config
            .authorization_url(&state, &nonce, &digest(&verifier));
        self.store
            .put_oauth(
                &digest(&state),
                Transaction {
                    cookie_hash: digest(&cookie),
                    nonce: Secret(nonce),
                    verifier: Secret(verifier),
                    expires_at: self.clock.now() + OAUTH_TTL,
                },
            )
            .await?;
        Ok((url, cookie))
    }

    pub async fn callback(&self, state: &str, cookie: &str, code: &str) -> Result<String, Error> {
        if !opaque(state) || !opaque(cookie) || code.is_empty() || code.len() > 4096 {
            return Err(Error::InvalidRequest);
        }
        let transaction = self
            .store
            .take_oauth(&digest(state), &digest(cookie), self.clock.now())
            .await?;
        let grant = self
            .provider
            .exchange(code, &transaction.verifier.0, &transaction.nonce.0)
            .await?;
        if !valid_scopes(&grant.scope) {
            return Err(Error::Forbidden);
        }
        // Require a fresh refresh credential; never reuse a token from an unverified older consent.
        let refresh = grant.refresh_token.ok_or(Error::IncompleteConsent)?;
        if refresh.0.is_empty() {
            return Err(Error::IncompleteConsent);
        }
        let connection = self.crypto.mac("connection", &grant.subject.0)?;
        let encrypted = self
            .crypto
            .seal(&self.context(&connection), &refresh.0)
            .await?;
        let raw = random()?;
        self.store
            .connect(&connection, encrypted, &digest(&raw), self.clock.now())
            .await?;
        Ok(raw)
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
        if matches!(result, Err(Error::Reconnect)) {
            // Fail closed before surfacing invalid_grant/scope removal to the client.
            self.store.invalidate(&lease, self.clock.now()).await?;
        } else if result.is_err() {
            let _ = self.store.release(&lease).await;
        }
        result
    }
    async fn refresh_locked(&self, lease: &Lease) -> Result<Access, Error> {
        let context = self.context(&lease.connection_id);
        let refresh = self.crypto.open(&context, &lease.encrypted_refresh).await?;
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
        Ok(access)
    }
    pub async fn disconnect(&self, raw: &str) -> Result<bool, Error> {
        let lease = self.store.disable(&digest(raw), self.clock.now()).await?;
        let refresh = self
            .crypto
            .open(
                &self.context(&lease.connection_id),
                &lease.encrypted_refresh,
            )
            .await?;
        if self.provider.revoke(&refresh.0).await.is_ok() {
            self.store.revoked(&lease).await?;
            Ok(true)
        } else {
            Ok(false)
        }
    }
    fn context(&self, connection: &str) -> String {
        format!("{}:{connection}", self.config.environment)
    }
}
