//! Opt-in client diagnostics. This Lambda has no access to OAuth state or book data.
use axum::{
    Router,
    body::to_bytes,
    extract::Request,
    http::{HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::any,
};
use serde::Deserialize;

const ORIGIN: &str = "https://livroalivro.app.br";
const PATH: &str = "/v1/diagnostics/errors";

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Area {
    Runtime,
    Storage,
    Drive,
    Search,
    Backup,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Code {
    RenderFailure,
    RuntimeException,
    UnhandledRejection,
    StorageUnavailable,
    DriveSyncFailed,
    SearchFailed,
    BackupFailed,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Diagnostic {
    area: Area,
    code: Code,
    count: u8,
}

impl Diagnostic {
    fn valid(&self) -> bool {
        (1..=10).contains(&self.count)
            && matches!(
                (self.area, self.code),
                (
                    Area::Runtime,
                    Code::RenderFailure | Code::RuntimeException | Code::UnhandledRejection
                ) | (Area::Storage, Code::StorageUnavailable)
                    | (Area::Drive, Code::DriveSyncFailed)
                    | (Area::Search, Code::SearchFailed)
                    | (Area::Backup, Code::BackupFailed)
            )
    }
    fn metric(&self) -> (&'static str, &'static str) {
        match (self.area, self.code) {
            (Area::Runtime, Code::RenderFailure) => ("runtime", "render_failure"),
            (Area::Runtime, Code::RuntimeException) => ("runtime", "runtime_exception"),
            (Area::Runtime, Code::UnhandledRejection) => ("runtime", "unhandled_rejection"),
            (Area::Storage, Code::StorageUnavailable) => ("storage", "storage_unavailable"),
            (Area::Drive, Code::DriveSyncFailed) => ("drive", "drive_sync_failed"),
            (Area::Search, Code::SearchFailed) => ("search", "search_failed"),
            (Area::Backup, Code::BackupFailed) => ("backup", "backup_failed"),
            _ => unreachable!("validated before metric"),
        }
    }
}

pub fn router() -> Router {
    Router::new()
        .route(PATH, any(handle))
        .fallback(|| async { StatusCode::NOT_FOUND })
}

async fn handle(request: Request) -> Response {
    let mut origins = request.headers().get_all(header::ORIGIN).iter();
    let allowed = origins.next().and_then(|value| value.to_str().ok()) == Some(ORIGIN)
        && origins.next().is_none();
    let mut response = if !allowed
        || request.uri().query().is_some()
        || request.headers().contains_key(header::COOKIE)
        || request.headers().contains_key(header::AUTHORIZATION)
    {
        StatusCode::FORBIDDEN.into_response()
    } else if request.method() == Method::OPTIONS {
        if request
            .headers()
            .get(header::ACCESS_CONTROL_REQUEST_METHOD)
            .and_then(|value| value.to_str().ok())
            != Some("POST")
            || request
                .headers()
                .get(header::ACCESS_CONTROL_REQUEST_HEADERS)
                .and_then(|value| value.to_str().ok())
                .is_some_and(|value| !value.eq_ignore_ascii_case("content-type"))
        {
            StatusCode::FORBIDDEN.into_response()
        } else {
            StatusCode::NO_CONTENT.into_response()
        }
    } else if request.method() != Method::POST {
        StatusCode::METHOD_NOT_ALLOWED.into_response()
    } else if request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        != Some("application/json")
    {
        StatusCode::UNSUPPORTED_MEDIA_TYPE.into_response()
    } else {
        match to_bytes(request.into_body(), 512).await {
            Ok(bytes) => match serde_json::from_slice::<Diagnostic>(&bytes) {
                Ok(event) if event.valid() => {
                    let (area, code) = event.metric();
                    // Only fixed enum values and a bounded count reach CloudWatch.
                    let timestamp = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64;
                    println!(
                        "{}",
                        serde_json::json!({"_aws":{"Timestamp":timestamp,"CloudWatchMetrics":[{"Namespace":"LivroALivro/Diagnostics","Dimensions":[[]],"Metrics":[{"Name":"ClientErrorReport","Unit":"Count"}]}]},"ClientErrorReport":event.count,"kind":"client_error","area":area,"code":code})
                    );
                    StatusCode::NO_CONTENT.into_response()
                }
                _ => StatusCode::BAD_REQUEST.into_response(),
            },
            Err(_) => StatusCode::PAYLOAD_TOO_LARGE.into_response(),
        }
    };
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    if allowed {
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_ORIGIN,
            HeaderValue::from_static(ORIGIN),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static("POST,OPTIONS"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static("content-type"),
        );
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    async fn post(body: &str, origin: &str) -> Response {
        router()
            .oneshot(
                Request::post(PATH)
                    .header(header::ORIGIN, origin)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_owned()))
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn accepts_only_bounded_fixed_diagnostics() {
        assert_eq!(
            post(
                r#"{"area":"runtime","code":"render_failure","count":1}"#,
                ORIGIN
            )
            .await
            .status(),
            StatusCode::NO_CONTENT
        );
        for body in [
            r#"{"area":"runtime","code":"render_failure","count":0}"#,
            r#"{"area":"runtime","code":"render_failure","count":11}"#,
            r#"{"area":"drive","code":"render_failure","count":1}"#,
            r#"{"area":"runtime","code":"render_failure","count":1,"message":"private"}"#,
            r##"{"area":"runtime","code":"render_failure","count":1,"url":"#/livro/private"}"##,
            r#"{"area":"runtime","code":"arbitrary","count":1}"#,
        ] {
            assert_eq!(post(body, ORIGIN).await.status(), StatusCode::BAD_REQUEST);
        }
        assert_eq!(
            post(&"x".repeat(513), ORIGIN).await.status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
        assert_eq!(
            post(
                r#"{"area":"runtime","code":"render_failure","count":1}"#,
                "https://elsewhere.example"
            )
            .await
            .status(),
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn preflight_is_exact_and_never_allows_credentials() {
        let response = router()
            .oneshot(
                Request::builder()
                    .method(Method::OPTIONS)
                    .uri(PATH)
                    .header(header::ORIGIN, ORIGIN)
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                    .header(header::ACCESS_CONTROL_REQUEST_HEADERS, "content-type")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_CREDENTIALS)
                .is_none()
        );
        assert_eq!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .unwrap(),
            ORIGIN
        );
        let response = router()
            .oneshot(
                Request::post(PATH)
                    .header(header::ORIGIN, ORIGIN)
                    .header(header::COOKIE, "session=secret")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"area":"runtime","code":"render_failure","count":1}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
}
