use crate::ports::{Error, OAuthPurpose};
use url::Url;

pub const DRIVE_SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";
pub const SCOPES: [&str; 2] = ["openid", DRIVE_SCOPE];
pub const SESSION_TTL: u64 = 30 * 24 * 60 * 60;
pub const ABSOLUTE_TTL: u64 = 180 * 24 * 60 * 60;
pub const OAUTH_TTL: u64 = 10 * 60;
pub const LEASE_TTL: u64 = 30;

#[derive(Clone)]
pub struct Config {
    pub(crate) origin: String,
    pub(crate) callback: String,
    pub(crate) destination: String,
    pub(crate) client_id: String,
    pub(crate) environment: String,
}

impl Config {
    /// Explicit, exact deployment allowlist; no request can choose a redirect or scope.
    pub fn production(client_id: String) -> Result<Self, Error> {
        if client_id.len() > 512 || !client_id.ends_with(".apps.googleusercontent.com") {
            return Err(Error::Configuration);
        }
        Ok(Self {
            origin: "https://livroalivro.app.br".into(),
            callback: "https://api.livroalivro.app.br/v1/auth/google/callback".into(),
            destination: "https://livroalivro.app.br/#/dados".into(),
            client_id,
            environment: "production".into(),
        })
    }

    pub fn authorization_url(
        &self,
        state: &str,
        nonce: &str,
        challenge: &str,
        purpose: &OAuthPurpose,
    ) -> String {
        let drive = matches!(purpose, OAuthPurpose::Drive { .. });
        let scopes = if drive {
            SCOPES.join(" ")
        } else {
            "openid".into()
        };
        let mut url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
        url.query_pairs_mut().extend_pairs([
            ("client_id", self.client_id.as_str()),
            ("redirect_uri", self.callback.as_str()),
            ("response_type", "code"),
            ("scope", scopes.as_str()),
            ("state", state),
            ("nonce", nonce),
            ("code_challenge", challenge),
            ("code_challenge_method", "S256"),
            ("access_type", if drive { "offline" } else { "online" }),
            ("prompt", if drive { "consent" } else { "select_account" }),
            ("include_granted_scopes", "false"),
        ]);
        url.into()
    }
}

pub fn valid_scopes(value: &str) -> bool {
    let values: Vec<_> = value.split_whitespace().collect();
    values.len() == 2 && SCOPES.iter().all(|scope| values.contains(scope))
}
