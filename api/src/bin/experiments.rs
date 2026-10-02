use aws_config::BehaviorVersion;
use aws_sdk_dynamodb::{Client, types::AttributeValue};
use axum::{
    Json, Router,
    extract::{Request, State},
    http::{HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
    routing::any,
};
use livro_a_livro_auth::experiments::{Catalog, Publication};
use std::time::Duration;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

const ORIGIN: &str = "https://livroalivro.app.br";
const PATH: &str = "/v1/experiments/catalog";

#[derive(Clone)]
struct App {
    db: Client,
    table: String,
}

#[tokio::main]
async fn main() -> Result<(), lambda_http::Error> {
    let config = aws_config::load_defaults(BehaviorVersion::latest()).await;
    let table = std::env::var("EXPERIMENTS_TABLE_NAME")?;
    lambda_http::run(router(App {
        db: Client::new(&config),
        table,
    }))
    .await
}

fn router(app: App) -> Router {
    Router::new().route(PATH, any(get_catalog)).with_state(app)
}

async fn get_catalog(State(app): State<App>, request: Request) -> Response {
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
        StatusCode::NO_CONTENT.into_response()
    } else if request.method() != Method::GET {
        StatusCode::METHOD_NOT_ALLOWED.into_response()
    } else {
        let publication = app
            .db
            .get_item()
            .table_name(&app.table)
            .key("pk", AttributeValue::S("CATALOG".into()))
            .send()
            .await
            .ok()
            .and_then(|result| result.item)
            .and_then(|item| item.get("config")?.as_s().ok().cloned())
            .filter(|value| value.len() <= 64 * 1024)
            .and_then(|value| serde_json::from_str::<Publication>(&value).ok())
            .filter(Publication::validate);
        let expiry = (OffsetDateTime::now_utc() + Duration::from_secs(120))
            .format(&Rfc3339)
            .unwrap_or_default();
        let catalog = publication.map_or_else(Catalog::empty, |value| value.catalog(expiry));
        let mut response = Json(&catalog).into_response();
        if let Ok(etag) = HeaderValue::from_str(&format!(
            "\"{}:{}\"",
            catalog.catalog_revision, catalog.expires_at
        )) {
            response.headers_mut().insert(header::ETAG, etag);
        }
        response
    };
    let headers = response.headers_mut();
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public,max-age=30"),
    );
    headers.insert(header::VARY, HeaderValue::from_static("Origin"));
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
            HeaderValue::from_static("GET,OPTIONS"),
        );
    }
    response
}
