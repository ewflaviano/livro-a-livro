//! Public experiment catalog. It is deliberately independent from OAuth.
use axum::{
    Json, Router,
    extract::State,
    http::{StatusCode, header},
    response::IntoResponse,
    routing::get,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Publication {
    pub catalog_revision: u64,
    pub experiments: Vec<Experiment>,
}
impl Publication {
    pub fn validate(&self) -> bool {
        if self.experiments.len() > 50 {
            return false;
        }
        let mut seen = HashSet::new();
        self.experiments.iter().all(|entry| {
            if entry.key != "shelf-summary-layout"
                || !seen.insert(entry.key.as_str())
                || entry.assignment_version == 0
                || entry.rollout_basis_points > 10_000
                || entry.eligibility.requires_drive
                || entry.eligibility.min_build.is_some()
                || entry.eligibility.max_build.is_some()
                || entry.eligibility.starts_at.is_some()
                || entry.eligibility.ends_at.is_some()
                || entry.variants.is_empty()
                || entry.variants.len() > 10
                || entry.variants.iter().any(|variant| {
                    variant.key != "control" && variant.key != "compact" || variant.weight == 0
                })
                || entry
                    .variants
                    .iter()
                    .map(|variant| u32::from(variant.weight))
                    .sum::<u32>()
                    != 10_000
                || entry
                    .variants
                    .iter()
                    .map(|variant| &variant.key)
                    .collect::<HashSet<_>>()
                    .len()
                    != entry.variants.len()
            {
                return false;
            }
            true
        })
    }
    pub fn catalog(self, expires_at: String) -> Catalog {
        Catalog {
            catalog_revision: self.catalog_revision,
            expires_at,
            experiments: self.experiments,
        }
    }
}

impl Catalog {
    pub fn empty() -> Self {
        Self {
            catalog_revision: 0,
            expires_at: (time::OffsetDateTime::now_utc() + std::time::Duration::from_secs(120))
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default(),
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

#[cfg(test)]
mod publication_tests {
    use super::*;

    fn publication() -> Publication {
        Publication {
            catalog_revision: 1,
            experiments: vec![Experiment {
                key: "shelf-summary-layout".into(),
                assignment_version: 1,
                enabled: true,
                kill_switch: false,
                rollout_basis_points: 500,
                variants: vec![Variant {
                    key: "compact".into(),
                    weight: 10_000,
                }],
                eligibility: Eligibility {
                    min_build: None,
                    max_build: None,
                    starts_at: None,
                    ends_at: None,
                    requires_drive: false,
                },
            }],
        }
    }
    #[test]
    fn only_compiled_experiments_and_bounded_weights_publish() {
        let mut value = publication();
        assert!(value.validate());
        value.experiments[0].rollout_basis_points = 10_001;
        assert!(!value.validate());
        value = publication();
        value.experiments[0].key = "unknown".into();
        assert!(!value.validate());
        value = publication();
        value.experiments.push(value.experiments[0].clone());
        assert!(!value.validate());
        value = publication();
        value.experiments[0].variants[0].key = "html".into();
        assert!(!value.validate());
    }
}
