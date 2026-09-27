//! Local IAM-authorized administration only; this binary is never a public Lambda route.
use livro_a_livro_auth::{
    aws::store::DynamoStore,
    ports::{Clock, RevocationKey, SystemClock},
    service::opaque,
};
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 4
        || args[3] != "--confirmed-google-revoked-no-inflight"
        || !opaque(&args[0])
        || !opaque(&args[2])
    {
        return Err("Usage: auth-admin CONNECTION_ID GENERATION REVOCATION_ID --confirmed-google-revoked-no-inflight".into());
    }
    let generation = args[1].parse().map_err(|_| "InvalidGeneration")?;
    let key = RevocationKey {
        connection_id: args[0].clone(),
        generation,
        revocation_id: args[2].clone(),
    };
    let table = std::env::var("AUTH_TABLE_NAME").map_err(|_| "MissingTable")?;
    let config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    if config.region().map(|r| r.as_ref()) != Some("sa-east-1") {
        return Err("InvalidRegion".into());
    }
    let store = DynamoStore::new(aws_sdk_dynamodb::Client::new(&config), table)
        .map_err(|_| "InvalidConfiguration")?;
    store
        .resolve_uncertain(&key, SystemClock.now())
        .await
        .map_err(|_| "ResolutionRejected")?;
    println!("RevocationResolved");
    Ok(())
}
