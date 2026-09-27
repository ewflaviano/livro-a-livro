use super::*;
use jsonwebtoken::{EncodingKey, Header, encode};
use rsa::pkcs8::{EncodePrivateKey, EncodePublicKey, LineEnding};
use serde_json::json;

#[test]
fn jwt_verification_rejects_bad_signature_issuer_audience_expiry_and_nonce() {
    let private = rsa::RsaPrivateKey::new(&mut rand::thread_rng(), 2048).unwrap();
    let public = private
        .to_public_key()
        .to_public_key_pem(LineEnding::LF)
        .unwrap();
    let pem = private.to_pkcs8_pem(LineEnding::LF).unwrap();
    let encoding = EncodingKey::from_rsa_pem(pem.as_bytes()).unwrap();
    let decoding = DecodingKey::from_rsa_pem(public.as_bytes()).unwrap();
    let now = SystemClock.now();
    let valid = json!({"sub":"synthetic-sub", "aud":"synthetic-client", "iss":"https://accounts.google.com", "exp":now+60, "nonce":"synthetic-nonce"});
    let token = encode(&Header::new(Algorithm::RS256), &valid, &encoding).unwrap();
    assert!(verify(&token, &decoding, "synthetic-client", "synthetic-nonce").is_ok());
    assert!(verify(&token, &decoding, "synthetic-client", "wrong-nonce").is_err());
    for (field, value) in [
        ("aud", json!("wrong-client")),
        ("iss", json!("https://evil.example")),
        ("exp", json!(now - 1)),
        ("azp", json!("wrong-client")),
    ] {
        let mut claims = valid.clone();
        claims[field] = value;
        let token = encode(&Header::new(Algorithm::RS256), &claims, &encoding).unwrap();
        assert!(verify(&token, &decoding, "synthetic-client", "synthetic-nonce").is_err());
    }
    let other = rsa::RsaPrivateKey::new(&mut rand::thread_rng(), 2048).unwrap();
    let other = other
        .to_public_key()
        .to_public_key_pem(LineEnding::LF)
        .unwrap();
    assert!(
        verify(
            &token,
            &DecodingKey::from_rsa_pem(other.as_bytes()).unwrap(),
            "synthetic-client",
            "synthetic-nonce"
        )
        .is_err()
    );
    let bad_alg = encode(
        &Header::new(Algorithm::HS256),
        &valid,
        &EncodingKey::from_secret(b"test-only-key"),
    )
    .unwrap();
    assert!(verify(&bad_alg, &decoding, "synthetic-client", "synthetic-nonce").is_err());
}
