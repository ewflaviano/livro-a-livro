use lambda_runtime::{LambdaEvent, service_fn};
#[tokio::main]
async fn main() -> Result<(), lambda_runtime::Error> {
    let (auth, store) = livro_a_livro_auth::aws::runtime::compose()
        .await
        .map_err(|_| "WorkerInitializationFailed")?;
    lambda_runtime::run(service_fn(|_:LambdaEvent<serde_json::Value>|{
        let auth=auth.clone();let store=store.clone();
        async move {
            let started=std::time::Instant::now();
            let mut report=livro_a_livro_auth::aws::runtime::SweepReport::default();
            let result=tokio::time::timeout(std::time::Duration::from_secs(20),livro_a_livro_auth::aws::runtime::sweep(&auth,&store,&mut report)).await;
            let incomplete=u32::from(!matches!(result,Ok(Ok(()))));
            // The only operational output is fixed aggregate counters. Never serialize
            // event, error, connection IDs, request data or provider/SDK responses.
            let metrics=serde_json::json!({"_aws":{"Timestamp":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
                "CloudWatchMetrics":[{"Namespace":"LivroALivro/Auth","Dimensions":[[]],"Metrics":[{"Name":"Processed","Unit":"Count"},{"Name":"RevocationUncertain","Unit":"Count"},{"Name":"CleanupCompleted","Unit":"Count"},{"Name":"Failed","Unit":"Count"},{"Name":"Incomplete","Unit":"Count"},{"Name":"Duration","Unit":"Milliseconds"}]}]},
                "Processed":report.processed,"RevocationUncertain":report.uncertain,"CleanupCompleted":report.cleaned,"Failed":report.failed,"Incomplete":incomplete,"Duration":started.elapsed().as_millis() as u64});
            println!("{metrics}");
            if incomplete==0 { Ok::<_,lambda_runtime::Error>(serde_json::json!({"status":"complete"})) } else { Err("WorkerIncomplete".into()) }

        }
    })).await
}
