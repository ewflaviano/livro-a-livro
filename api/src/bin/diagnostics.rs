#[path = "../diagnostics.rs"]
mod diagnostics;

#[tokio::main]
async fn main() -> Result<(), lambda_http::Error> {
    lambda_http::run(diagnostics::router()).await
}
