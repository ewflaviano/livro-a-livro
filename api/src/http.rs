use crate::{
    Auth,
    config::*,
    ports::{CallbackResult, Error},
    service::opaque,
};
use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::json;

const SESSION_COOKIE: &str = "__Host-lal_session";
const IDENTITY_COOKIE: &str = "__Host-lal_identity";
const OAUTH_COOKIE: &str = "__Host-lal_oauth";

pub fn router(auth: Auth) -> Router {
    Router::new()
        .route("/v1/auth/google/start", post(start))
        .route("/v1/auth/google/callback", get(callback))
        .route(
            "/v1/auth/google/identity",
            get(identity).delete(cancel_identity),
        )
        .route("/v1/auth/google/drive/start", post(start_drive))
        .route("/v1/session", get(session).delete(logout))
        .route("/v1/session/renew", post(renew))
        .route("/v1/auth/drive-token", post(access))
        .route("/v1/drive-connection", axum::routing::delete(disconnect))
        .fallback(|| async { Error::InvalidRequest.into_response() })
        .layer(middleware::from_fn_with_state(auth.clone(), guard))
        .with_state(auth)
}

async fn guard(State(auth): State<Auth>, mut request: Request, next: Next) -> Response {
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok());
    let allowed = origin == Some(auth.config.origin.as_str());
    let callback = request.uri().path() == "/v1/auth/google/callback" && request.method() == "GET";
    let mut response = if !callback && !allowed {
        Error::Forbidden.into_response()
    } else if request.method() == "OPTIONS" {
        let method = request
            .headers()
            .get(header::ACCESS_CONTROL_REQUEST_METHOD)
            .and_then(|v| v.to_str().ok());
        let headers = request
            .headers()
            .get(header::ACCESS_CONTROL_REQUEST_HEADERS)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if !matches!(method, Some("GET" | "POST" | "DELETE"))
            || headers.split(',').any(|h| {
                !["", "content-type", "x-lal-csrf"]
                    .contains(&h.trim().to_ascii_lowercase().as_str())
            })
        {
            Error::Forbidden.into_response()
        } else {
            StatusCode::NO_CONTENT.into_response()
        }
    } else if request.uri().query().is_some() && !callback {
        Error::InvalidRequest.into_response()
    } else {
        // Control routes accept NO body, even on GET; no payload can become library ingress.
        let body = std::mem::replace(request.body_mut(), Body::empty());
        match to_bytes(body, 16 * 1024).await {
            Ok(bytes) if bytes.is_empty() => next.run(request).await,
            _ => Error::InvalidRequest.into_response(),
        }
    };
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
    headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    if allowed {
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_str(&auth.config.origin).unwrap(),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
            HeaderValue::from_static("true"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("x-lal-csrf,content-type"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("GET,POST,DELETE,OPTIONS"),
        );
    }
    response
}

fn cookie(headers: &HeaderMap, name: &str) -> Result<String, Error> {
    let mut matches = headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .filter(|(key, _)| *key == name)
        .map(|(_, value)| value);
    let value = matches.next().ok_or(Error::Unauthorized)?;
    if matches.next().is_some() || !opaque(value) {
        return Err(Error::Unauthorized);
    }
    Ok(value.into())
}
fn set_cookie(response: &mut Response, name: &str, value: &str, max_age: u64) {
    let cookie =
        format!("{name}={value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age={max_age}");
    response
        .headers_mut()
        .append(header::SET_COOKIE, HeaderValue::from_str(&cookie).unwrap());
}
async fn authorized(auth: &Auth, headers: &HeaderMap) -> Result<String, Error> {
    let raw = cookie(headers, SESSION_COOKIE)?;
    let csrf = headers
        .get("x-lal-csrf")
        .and_then(|v| v.to_str().ok())
        .ok_or(Error::Forbidden)?;
    auth.authorize(&raw, csrf).await?;
    Ok(raw)
}
async fn start(State(auth): State<Auth>, headers: HeaderMap) -> Result<Response, Error> {
    let (url, raw) = auth
        .start_sign_in(
            cookie(&headers, IDENTITY_COOKIE).ok().as_deref(),
            cookie(&headers, SESSION_COOKIE).ok().as_deref(),
        )
        .await?;
    let mut response = Json(json!({"authorizationUrl": url})).into_response();
    set_cookie(&mut response, OAUTH_COOKIE, &raw, OAUTH_TTL);
    set_cookie(&mut response, IDENTITY_COOKIE, "", 0);
    set_cookie(&mut response, SESSION_COOKIE, "", 0);
    Ok(response)
}
fn identity_credentials(headers: &HeaderMap) -> Result<(String, &str), Error> {
    let raw = cookie(headers, IDENTITY_COOKIE)?;
    let csrf = headers
        .get("x-lal-csrf")
        .and_then(|v| v.to_str().ok())
        .ok_or(Error::Forbidden)?;
    Ok((raw, csrf))
}
async fn identity(State(auth): State<Auth>, headers: HeaderMap) -> Result<Response, Error> {
    let raw = cookie(&headers, IDENTITY_COOKIE)?;
    let identity = auth.identity(&raw).await?;
    Ok(Json(json!({"connectionId":identity.connection_id,"expiresAt":identity.expires_at,"csrfToken":auth.identity_csrf(&raw)?})).into_response())
}
async fn start_drive(State(auth): State<Auth>, headers: HeaderMap) -> Result<Response, Error> {
    let (identity, csrf) = identity_credentials(&headers)?;
    let (url, raw) = auth.start_drive(&identity, csrf).await?;
    let mut response = Json(json!({"authorizationUrl":url})).into_response();
    set_cookie(&mut response, OAUTH_COOKIE, &raw, OAUTH_TTL);
    Ok(response)
}
async fn cancel_identity(State(auth): State<Auth>, headers: HeaderMap) -> Result<Response, Error> {
    let (identity, csrf) = identity_credentials(&headers)?;
    auth.cancel_identity(&identity, csrf).await?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    set_cookie(&mut response, IDENTITY_COOKIE, "", 0);
    Ok(response)
}

#[derive(Deserialize)]
struct Callback {
    iss: String,
    state: String,
    code: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
    scope: Option<String>,
    authuser: Option<String>,
    prompt: Option<String>,
}
async fn callback(state: State<Auth>, headers: HeaderMap, request: Request) -> Response {
    match callback_inner(state, headers, request).await {
        Ok(response) => response,
        Err(error) => {
            let message = match error {
                Error::ConsentDenied => {
                    "A autorização foi cancelada ou negada. Você pode tentar novamente no aplicativo."
                }
                Error::IdentityExpired => {
                    "Sua identificação expirou. Entre com Google novamente para continuar."
                }
                Error::IncompleteConsent => {
                    "O Google Drive não foi autorizado integralmente. Volte ao aplicativo para autorizar o Drive."
                }
                Error::AccountMismatch => {
                    "A conta escolhida é diferente da conta confirmada. Volte ao aplicativo e use a mesma conta ou entre novamente."
                }
                _ => "Não foi possível concluir a conexão com Google.",
            };
            let status = error.into_response().status();
            let html = format!(
                "<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Conexão com Google</title><h1>{message}</h1><p>Sua biblioteca continua neste dispositivo.</p><a href=\"https://livroalivro.app.br/#/dados\">Voltar ao aplicativo</a></html>"
            );
            let mut response = (status, axum::response::Html(html)).into_response();
            set_cookie(&mut response, OAUTH_COOKIE, "", 0);
            response
        }
    }
}

async fn callback_inner(
    State(auth): State<Auth>,
    headers: HeaderMap,
    request: Request,
) -> Result<Response, Error> {
    // Parse manually to prevent extractor errors from echoing untrusted values.
    let query = request.uri().query().ok_or(Error::InvalidRequest)?;
    if query.len() > 8192 {
        return Err(Error::InvalidRequest);
    }
    let query: Callback = axum::extract::Query::try_from_uri(request.uri())
        .map_err(|_| Error::InvalidRequest)?
        .0;
    // RFC 9207: compare the decoded authorization-response issuer literally,
    // including errors, before consuming state or exchanging any code.
    if query.iss != "https://accounts.google.com" {
        return Err(Error::InvalidRequest);
    }
    let _ = (
        &query.scope,
        &query.authuser,
        &query.prompt,
        &query.error_description,
    ); // Google informational fields are never trusted.
    if query.error.is_some() {
        // Consume the state even on denial; never trust or display provider error text.
        auth.store
            .take_oauth(
                &crate::service::digest(&query.state),
                &crate::service::digest(&cookie(&headers, OAUTH_COOKIE)?),
                auth.clock.now(),
            )
            .await?;
        return Err(if query.error.as_deref() == Some("access_denied") {
            Error::ConsentDenied
        } else {
            Error::Provider
        });
    }
    if query.code.is_none() {
        return Err(Error::Unauthorized);
    }
    let raw = auth
        .callback(
            &query.state,
            &cookie(&headers, OAUTH_COOKIE)?,
            query.code.as_deref().unwrap(),
        )
        .await?;
    let mut response = StatusCode::SEE_OTHER.into_response();
    response.headers_mut().insert(
        header::LOCATION,
        HeaderValue::from_str(&auth.config.destination).unwrap(),
    );
    match raw {
        CallbackResult::Identity {
            raw_cookie,
            expires_at,
        } => {
            set_cookie(
                &mut response,
                IDENTITY_COOKIE,
                &raw_cookie,
                expires_at.saturating_sub(auth.clock.now()),
            );
            set_cookie(&mut response, SESSION_COOKIE, "", 0);
        }
        CallbackResult::Drive { raw_session } => {
            set_cookie(&mut response, SESSION_COOKIE, &raw_session, SESSION_TTL);
            set_cookie(&mut response, IDENTITY_COOKIE, "", 0);
        }
    }
    set_cookie(&mut response, OAUTH_COOKIE, "", 0);
    Ok(response)
}
async fn session(State(auth): State<Auth>, headers: HeaderMap) -> Result<Response, Error> {
    let raw = cookie(&headers, SESSION_COOKIE)?;
    let session = auth.session(&raw).await?;
    Ok(Json(json!({"connectionId":session.connection_id,"generation":session.generation,"expiresAt":session.expires_at,"csrfToken":auth.csrf(&raw)?,"scopes":SCOPES})).into_response())
}
async fn renew(State(auth): State<Auth>, headers: HeaderMap) -> Result<Response, Error> {
    let old = authorized(&auth, &headers).await?;
    let (raw, session) = auth.renew(&old).await?;
    let mut response =
        Json(json!({"expiresAt":session.expires_at,"csrfToken":auth.csrf(&raw)?})).into_response();
    set_cookie(
        &mut response,
        SESSION_COOKIE,
        &raw,
        session.expires_at.saturating_sub(auth.clock.now()),
    );
    Ok(response)
}
async fn access(State(auth): State<Auth>, headers: HeaderMap) -> Result<Response, Error> {
    let raw = authorized(&auth, &headers).await?;
    let access = auth.access(&raw).await?;
    Ok(
        Json(json!({"accessToken":access.token.0,"expiresIn":access.expires_in,"scopes":SCOPES}))
            .into_response(),
    )
}
async fn logout(State(auth): State<Auth>, headers: HeaderMap) -> Result<Response, Error> {
    let raw = authorized(&auth, &headers).await?;
    auth.store.logout(&crate::service::digest(&raw)).await?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    set_cookie(&mut response, SESSION_COOKIE, "", 0);
    Ok(response)
}
async fn disconnect(State(auth): State<Auth>, headers: HeaderMap) -> Result<Response, Error> {
    let raw = authorized(&auth, &headers).await?;
    let revoked = auth.disconnect(&raw).await?;
    let mut response =
        Json(json!({"disconnected":true,"revocationPending":!revoked})).into_response();
    set_cookie(&mut response, SESSION_COOKIE, "", 0);
    Ok(response)
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let (status, code) = match self {
            Error::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
            Error::IdentityExpired => (StatusCode::UNAUTHORIZED, "identity_expired"),
            Error::AccountMismatch => (StatusCode::CONFLICT, "account_mismatch"),
            Error::ConsentDenied => (StatusCode::UNAUTHORIZED, "consent_denied"),
            Error::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            Error::InvalidRequest => (StatusCode::BAD_REQUEST, "invalid_request"),
            Error::IncompleteConsent => (StatusCode::CONFLICT, "incomplete_consent"),
            Error::Busy => (StatusCode::TOO_MANY_REQUESTS, "retry_later"),
            Error::Reconnect | Error::InvalidGrant => {
                (StatusCode::UNAUTHORIZED, "reconnect_required")
            }
            Error::Provider => (StatusCode::BAD_GATEWAY, "provider_unavailable"),
            Error::Unavailable | Error::Configuration => {
                (StatusCode::SERVICE_UNAVAILABLE, "unavailable")
            }
        };
        let mut response = (status, Json(json!({"error":code}))).into_response();
        if self == Error::Busy {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static("30"));
        }
        response
    }
}
