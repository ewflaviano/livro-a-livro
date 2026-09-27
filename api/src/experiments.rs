//! Public experiment catalog. It is deliberately independent from OAuth.
use axum::{
    Json, Router,
    extract::State,
    http::{StatusCode, header},
    response::IntoResponse,
    routing::get,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Catalog {
    pub catalog_revision: u64,
    pub expires_at: String,
    pub experiments: Vec<Experiment>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Experiment {
    pub key: String,
    pub assignment_version: u32,
    pub enabled: bool,
    pub kill_switch: bool,
    pub rollout_basis_points: u16,
    pub variants: Vec<Variant>,
    pub eligibility: Eligibility,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Variant {
    pub key: String,
    pub weight: u16,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Eligibility {
    pub min_build: Option<String>,
    pub max_build: Option<String>,
    pub starts_at: Option<String>,
    pub ends_at: Option<String>,
    pub requires_drive: bool,
}

impl Catalog {
    pub fn empty() -> Self {
        Self {
            catalog_revision: 0,
            expires_at: "1970-01-01T00:00:00.000Z".into(),
            experiments: vec![],
        }
    }
}

/// This router intentionally owns no cookie, OAuth client, user key or library contract.
pub fn router(catalog: Catalog) -> Router {
    Router::new()
        .route("/v1/experiments/catalog", get(get_catalog))
        .with_state(catalog)
}
async fn get_catalog(State(catalog): State<Catalog>) -> impl IntoResponse {
    (
        StatusCode::OK,
        [
            (header::CACHE_CONTROL, "public,max-age=30"),
            (header::VARY, "Origin"),
        ],
        Json(catalog),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;
    #[tokio::test]
    async fn catalog_is_public_and_contains_no_auth_data() {
        let response = router(Catalog::empty())
            .oneshot(
                Request::get("/v1/experiments/catalog")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "public,max-age=30"
        );
    }
}
