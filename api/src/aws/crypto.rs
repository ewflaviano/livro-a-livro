use crate::{
    config::Config,
    ports::{Crypto, Error, Secret},
    service::keyed_digest,
};
use async_trait::async_trait;
use aws_sdk_kms::{Client, primitives::Blob};
use serde::Deserialize;
use zeroize::Zeroizing;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SecretDocument {
    client_id: String,
    client_secret: String,
    hmac_key: String,
}
pub struct Credentials {
    pub config: Config,
    pub client_secret: Secret,
    pub hmac_key: Zeroizing<Vec<u8>>,
}
impl Credentials {
    pub fn parse(value: &str) -> Result<Self, Error> {
        if value.len() > 16_384 {
            return Err(Error::Configuration);
        }
        let mut document: SecretDocument =
            serde_json::from_str(value).map_err(|_| Error::Configuration)?;
        let secret = Secret(std::mem::take(&mut document.client_secret));
        let key = Zeroizing::new(std::mem::take(&mut document.hmac_key).into_bytes());
        if secret.0.is_empty()
            || secret.0.len() > 4096
            || key.len() < 32
            || key.len() > 4096
            || !key.is_ascii()
        {
            return Err(Error::Configuration);
        }
        Ok(Self {
            config: Config::production(document.client_id)?,
            client_secret: secret,
            hmac_key: key,
        })
    }
}

pub struct KmsCrypto {
    client: Client,
    key: String,
    hmac: Zeroizing<Vec<u8>>,
    environment: String,
}
impl KmsCrypto {
    pub fn new(
        client: Client,
        key: String,
        hmac: Zeroizing<Vec<u8>>,
        environment: String,
    ) -> Result<Self, Error> {
        if key.is_empty() || hmac.len() < 32 || environment != "production" {
            return Err(Error::Configuration);
        }
        Ok(Self {
            client,
            key,
            hmac,
            environment,
        })
    }
    fn context(&self, value: &str) -> Result<std::collections::HashMap<String, String>, Error> {
        let (environment, connection) = value.split_once(':').ok_or(Error::Configuration)?;
        if environment != self.environment || !crate::service::opaque(connection) {
            return Err(Error::Configuration);
        }
        Ok([
            ("application".into(), "livro-a-livro".into()),
            ("environment".into(), environment.into()),
            ("connection".into(), connection.into()),
        ]
        .into())
    }
}
#[async_trait]
impl Crypto for KmsCrypto {
    async fn seal(&self, context: &str, plaintext: &str) -> Result<Vec<u8>, Error> {
        if plaintext.is_empty() || plaintext.len() > 4096 {
            return Err(Error::Configuration);
        }
        let result = self
            .client
            .encrypt()
            .key_id(&self.key)
            .set_encryption_context(Some(self.context(context)?))
            .plaintext(Blob::new(plaintext.as_bytes()))
            .send()
            .await
            .map_err(|_| Error::Unavailable)?;
        result
            .ciphertext_blob
            .map(|blob| blob.into_inner())
            .ok_or(Error::Unavailable)
    }
    async fn open(&self, context: &str, ciphertext: &[u8]) -> Result<Secret, Error> {
        if ciphertext.is_empty() || ciphertext.len() > 6144 {
            return Err(Error::Unavailable);
        }
        let result = self
            .client
            .decrypt()
            .key_id(&self.key)
            .set_encryption_context(Some(self.context(context)?))
            .ciphertext_blob(Blob::new(ciphertext))
            .send()
            .await
            .map_err(|_| Error::Unavailable)?;
        let bytes = Zeroizing::new(result.plaintext.ok_or(Error::Unavailable)?.into_inner());
        if bytes.is_empty() || bytes.len() > 4096 {
            return Err(Error::Unavailable);
        }
        Ok(Secret(
            std::str::from_utf8(&bytes)
                .map_err(|_| Error::Unavailable)?
                .into(),
        ))
    }
    fn mac(&self, purpose: &str, value: &str) -> Result<String, Error> {
        keyed_digest(&self.hmac, purpose, value)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_invalid_or_unknown_secrets_fail_closed() {
        for value in [
            "",
            "{}",
            "null",
            r#"{"client_id":"invalid","client_secret":"secret","hmac_key":"01234567890123456789012345678901"}"#,
            r#"{"client_id":"id.apps.googleusercontent.com","client_secret":"","hmac_key":"01234567890123456789012345678901"}"#,
        ] {
            assert!(matches!(
                Credentials::parse(value),
                Err(Error::Configuration)
            ));
        }
    }
}
