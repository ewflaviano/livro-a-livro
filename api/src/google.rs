use crate::{
    config::{Config, valid_scopes},
    ports::*,
    service::equal,
};
use async_trait::async_trait;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::Deserialize;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

#[cfg(test)]
#[path = "google_tests.rs"]
mod tests;

const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const JWKS_URL: &str = "https://www.googleapis.com/oauth2/v3/certs";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const MAX_RESPONSE: usize = 64 * 1024;

pub struct Google {
    client: reqwest::Client,
    config: Config,
    secret: Secret,
    keys: Mutex<Option<(Instant, JwkSet)>>,
}
#[derive(Deserialize)]
struct Tokens {
    #[serde(default)]
    access_token: String,
    #[serde(default)]
    expires_in: u64,
    #[serde(default)]
    token_type: String,
    scope: Option<String>,
    refresh_token: Option<String>,
    id_token: Option<String>,
}
impl Tokens {
    fn authorization_scope(&mut self, purpose: &OAuthPurpose) -> Result<String, Error> {
        if matches!(purpose, OAuthPurpose::Drive { .. }) {
            self.validate_access()?;
        }
        let scope = self.scope.take().unwrap_or_default();
        if matches!(purpose, OAuthPurpose::Drive { .. }) && !valid_scopes(&scope) {
            return Err(Error::IncompleteConsent);
        }
        Ok(scope)
    }
    fn validate_access(&self) -> Result<(), Error> {
        if self.token_type != "Bearer"
            || self.access_token.is_empty()
            || self.expires_in == 0
            || self.expires_in > 3600
        {
            return Err(Error::Provider);
        }
        Ok(())
    }
}
impl Drop for Tokens {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.access_token.zeroize();
        self.refresh_token.zeroize();
        self.id_token.zeroize();
    }
}
#[derive(Clone, Deserialize)]
struct Claims {
    sub: String,
    aud: String,
    nonce: String,
    azp: Option<String>,
}
#[derive(Deserialize)]
struct Failure {
    error: String,
}

impl Google {
    pub fn new(config: Config, secret: Secret) -> Result<Self, Error> {
        if secret.0.is_empty() {
            return Err(Error::Configuration);
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| Error::Configuration)?;
        Ok(Self {
            client,
            config,
            secret,
            keys: Mutex::new(None),
        })
    }
    async fn tokens(&self, form: &[(&str, &str)]) -> Result<Tokens, Error> {
        let response = self
            .client
            .post(TOKEN_URL)
            .form(form)
            .send()
            .await
            .map_err(|_| Error::Provider)?;
        let success = response.status().is_success();
        let bytes = bounded(response).await?;
        if !success {
            return Err(
                if serde_json::from_slice::<Failure>(&bytes)
                    .is_ok_and(|e| e.error == "invalid_grant")
                {
                    Error::InvalidGrant
                } else {
                    Error::Provider
                },
            );
        }
        let tokens: Tokens = serde_json::from_slice(&bytes).map_err(|_| Error::Provider)?;
        Ok(tokens)
    }
    async fn identity(&self, token: &str, nonce: &str) -> Result<Secret, Error> {
        let header = decode_header(token).map_err(|_| Error::Unauthorized)?;
        if header.alg != Algorithm::RS256 {
            return Err(Error::Unauthorized);
        }
        let kid = header.kid.ok_or(Error::Unauthorized)?;
        let mut cached = self.keys.lock().await;
        // A bounded cache and one fetch per expiration also bound unknown-kid amplification.
        if cached
            .as_ref()
            .is_none_or(|(time, _)| time.elapsed() >= Duration::from_secs(300))
        {
            let response = self
                .client
                .get(JWKS_URL)
                .send()
                .await
                .map_err(|_| Error::Provider)?;
            if !response.status().is_success() {
                return Err(Error::Provider);
            }
            let keys: JwkSet =
                serde_json::from_slice(&bounded(response).await?).map_err(|_| Error::Provider)?;
            *cached = Some((Instant::now(), keys));
        }
        let key = cached
            .as_ref()
            .and_then(|(_, keys)| keys.find(&kid))
            .ok_or(Error::Unauthorized)?;
        let key = DecodingKey::from_jwk(key).map_err(|_| Error::Unauthorized)?;
        let claims = verify(token, &key, &self.config.client_id, nonce)?;
        Ok(Secret(claims.sub))
    }
}

fn verify(token: &str, key: &DecodingKey, client: &str, nonce: &str) -> Result<Claims, Error> {
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[client]);
    validation.set_issuer(&["https://accounts.google.com", "accounts.google.com"]);
    validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
    validation.leeway = 0;
    let claims = decode::<Claims>(token, key, &validation)
        .map_err(|_| Error::Unauthorized)?
        .claims;
    if claims.aud != client
        || claims.sub.is_empty()
        || claims.sub.len() > 255
        || !equal(&claims.nonce, nonce)
        || claims.azp.as_deref().is_some_and(|azp| azp != client)
    {
        return Err(Error::Unauthorized);
    }
    Ok(claims)
}

async fn bounded(mut response: reqwest::Response) -> Result<Vec<u8>, Error> {
    if response
        .content_length()
        .is_some_and(|len| len > MAX_RESPONSE as u64)
    {
        return Err(Error::Provider);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| Error::Provider)? {
        if bytes.len() + chunk.len() > MAX_RESPONSE {
            return Err(Error::Provider);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[async_trait]
impl Provider for Google {
    async fn exchange(
        &self,
        code: &str,
        verifier: &str,
        nonce: &str,
        purpose: &OAuthPurpose,
    ) -> Result<Grant, Error> {
        let mut tokens = self
            .tokens(&[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("client_id", &self.config.client_id),
                ("client_secret", &self.secret.0),
                ("redirect_uri", &self.config.callback),
                ("code_verifier", verifier),
            ])
            .await?;
        let scope = tokens.authorization_scope(purpose)?;
        let subject = self
            .identity(
                tokens.id_token.as_deref().ok_or(Error::Unauthorized)?,
                nonce,
            )
            .await?;
        Ok(Grant {
            subject,
            refresh_token: if matches!(purpose, OAuthPurpose::Drive { .. }) {
                tokens.refresh_token.take().map(Secret)
            } else {
                None
            },
            scope,
        })
    }
    async fn refresh(&self, refresh: &str) -> Result<Access, Error> {
        let mut tokens = self
            .tokens(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh),
                ("client_id", &self.config.client_id),
                ("client_secret", &self.secret.0),
            ])
            .await?;
        tokens.validate_access()?;
        Ok(Access {
            token: Secret(std::mem::take(&mut tokens.access_token)),
            expires_in: tokens.expires_in,
            scope: tokens.scope.take(),
            rotated_refresh: tokens.refresh_token.take().map(Secret),
        })
    }
    async fn revoke(&self, refresh: &str) -> RevokeOutcome {
        // Any response except success may have followed a dispatched revocation.
        // Conservatively require assisted resolution instead of risking a newer grant.
        match self
            .client
            .post(REVOKE_URL)
            .form(&[("token", refresh)])
            .send()
            .await
        {
            Ok(response) if response.status().is_success() => RevokeOutcome::Confirmed,
            _ => RevokeOutcome::Uncertain,
        }
    }
}
