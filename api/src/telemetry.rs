//! Aggregated, opt-in telemetry contracts. There is no event, identity or OAuth payload storage.
use async_trait::async_trait;
use axum::{Json, Router, extract::State, http::StatusCode, routing::post};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Event {
    Exposure,
    Use,
    Error,
    Rollback,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Code {
    CatalogInvalid,
    CatalogUnavailable,
    SyncUnavailable,
    StorageUnavailable,
}
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Item {
    pub build: String,
    pub experiment: String,
    pub revision: u64,
    pub variant: String,
    pub event: Event,
    pub code: Option<Code>,
    pub count: u8,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Batch {
    pub items: Vec<Item>,
}

#[async_trait]
pub trait Sink: Clone + Send + Sync + 'static {
    async fn increment(&self, items: Vec<Item>) -> Result<(), ()>;
}
pub fn router<T: Sink>(sink: T) -> Router {
    Router::new()
        .route("/v1/telemetry/batches", post(record::<T>))
        .layer(axum::extract::DefaultBodyLimit::max(10 * 1024))
        .with_state(sink)
}
async fn record<T: Sink>(State(sink): State<T>, Json(batch): Json<Batch>) -> StatusCode {
    if batch.items.is_empty()
        || batch.items.len() > 20
        || batch.items.iter().any(|item| {
            item.build.len() > 80
                || item.experiment.len() > 80
                || item.variant.len() > 80
                || item.count == 0
        })
    {
        return StatusCode::BAD_REQUEST;
    }
    match sink.increment(batch.items).await {
        Ok(()) => StatusCode::NO_CONTENT,
        Err(()) => StatusCode::SERVICE_UNAVAILABLE,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, header},
    };
    use std::sync::{Arc, Mutex};
    use tower::ServiceExt;
    #[derive(Clone, Default)]
    struct Memory(Arc<Mutex<Vec<Item>>>);
    #[async_trait]
    impl Sink for Memory {
        async fn increment(&self, items: Vec<Item>) -> Result<(), ()> {
            self.0.lock().unwrap().extend(items);
            Ok(())
        }
    }
    #[tokio::test]
    async fn accepts_only_small_allowlisted_batches() {
        let sink = Memory::default();
        let copy = sink.clone();
        let body = r#"{"items":[{"build":"1","experiment":"shelf-summary-layout","revision":1,"variant":"control","event":"exposure","count":1}]}"#;
        let response = router(sink)
            .oneshot(
                Request::post("/v1/telemetry/batches")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(copy.0.lock().unwrap().len(), 1);
    }
    #[tokio::test]
    async fn rejects_free_form_or_empty_payloads() {
        let response = router(Memory::default())
            .oneshot(
                Request::post("/v1/telemetry/batches")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"items":[],"title":"private"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
}
