#[cfg(feature = "aws")]
pub mod aws;
// OAuth control plane only. There are no library or media contracts here.
pub mod config;
pub mod experiments;
pub mod google;
pub mod http;
pub mod metrics;
pub mod ports;
pub mod service;
pub mod telemetry;

pub use http::router;
pub use service::Auth;

/// The infrastructure composition supplies durable storage and KMS before serving.
#[cfg(feature = "lambda")]
pub async fn run_lambda(auth: Auth) -> Result<(), lambda_http::Error> {
    lambda_http::run(router(auth)).await
}
