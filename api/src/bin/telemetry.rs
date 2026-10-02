#[path = "../telemetry.rs"]
mod telemetry;

use async_trait::async_trait;
use aws_config::BehaviorVersion;
use aws_sdk_dynamodb::{Client, types::AttributeValue};
use axum::{
    Router,
    extract::Request,
    http::{HeaderValue, StatusCode, header},
    middleware::{self, Next},
    response::Response,
};
use telemetry::{Item, Sink};
use time::OffsetDateTime;

const ORIGIN: &str = "https://livroalivro.app.br";

#[derive(Clone)]
struct DailyCounters {
    db: Client,
    table: String,
}

#[async_trait]
impl Sink for DailyCounters {
    async fn increment(&self, items: Vec<Item>) -> Result<(), ()> {
        let now = OffsetDateTime::now_utc();
        let day = now.date();
        let expires = day.midnight().assume_utc().unix_timestamp() + 30 * 86_400;
        for item in items {
            let event = match item.event {
                telemetry::Event::Exposure => "exposure",
                telemetry::Event::Use => "use",
                telemetry::Event::Error => "error",
                telemetry::Event::Rollback => "rollback",
            };
            let code = match item.code {
                None => "none",
                Some(telemetry::Code::CatalogInvalid) => "catalog_invalid",
                Some(telemetry::Code::CatalogUnavailable) => "catalog_unavailable",
                Some(telemetry::Code::SyncUnavailable) => "sync_unavailable",
                Some(telemetry::Code::StorageUnavailable) => "storage_unavailable",
            };
            // All fields passed the compiled allowlist before this key is built.
            let pk = format!(
                "{day}#{}#{}#{}#{}#{}#{}",
                item.build, item.experiment, item.revision, item.variant, event, code
            );
            self.db
                .update_item()
                .table_name(&self.table)
                .key("pk", AttributeValue::S(pk))
                .update_expression(
                    "SET #expires = if_not_exists(#expires, :expires) ADD #total :count",
                )
                .expression_attribute_names("#total", "total")
                .expression_attribute_names("#expires", "expiresAt")
                .expression_attribute_values(":count", AttributeValue::N(item.count.to_string()))
                .expression_attribute_values(":expires", AttributeValue::N(expires.to_string()))
                .send()
                .await
                .map_err(|_| ())?;
        }
        Ok(())
    }
}

async fn origin_guard(request: Request, next: Next) -> Response {
    let mut origins = request.headers().get_all(header::ORIGIN).iter();
    let allowed = origins.next().and_then(|value| value.to_str().ok()) == Some(ORIGIN)
        && origins.next().is_none();
    if !allowed
        || request.uri().query().is_some()
        || request.headers().contains_key(header::COOKIE)
        || request.headers().contains_key(header::AUTHORIZATION)
    {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .body(axum::body::Body::empty())
            .unwrap();
    }
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
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
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(header::VARY, HeaderValue::from_static("Origin"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
}

#[tokio::main]
async fn main() -> Result<(), lambda_http::Error> {
    let config = aws_config::load_defaults(BehaviorVersion::latest()).await;
    let app = DailyCounters {
        db: Client::new(&config),
        table: std::env::var("TELEMETRY_TABLE_NAME")?,
    };
    let router: Router = telemetry::router(app).layer(middleware::from_fn(origin_guard));
    lambda_http::run(router).await
}
