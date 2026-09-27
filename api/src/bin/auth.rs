#[tokio::main]
async fn main() -> Result<(), lambda_http::Error> {
    let (auth, _) = livro_a_livro_auth::aws::runtime::compose()
        .await
        .map_err(|_| "AuthInitializationFailed")?;
    livro_a_livro_auth::run_lambda(auth).await
}
