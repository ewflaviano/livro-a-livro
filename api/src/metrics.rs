/// Fixed operational dimensions only; never accept user/provider/error values here.
pub fn uncertain_revocation() {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    println!(
        "{}",
        serde_json::json!({"_aws":{"Timestamp":timestamp,"CloudWatchMetrics":[{"Namespace":"LivroALivro/Auth","Dimensions":[[]],"Metrics":[{"Name":"RevocationUncertain","Unit":"Count"}]}]},"RevocationUncertain":1})
    );
}
