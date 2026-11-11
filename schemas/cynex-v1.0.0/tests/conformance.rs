use cynex_schema::{
    genesis_prev_hash, hex_to_32, receipt_hash, settlement_digest, to_hex, Receipt,
};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn vectors_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("tests")
        .join("test-vectors")
        .join("vectors.json")
}

#[test]
fn conformance() {
    let text = fs::read_to_string(vectors_path()).expect("vectors.json must be readable");
    let doc: Value = serde_json::from_str(&text).expect("vectors.json must be valid JSON");
    let vectors = doc["vectors"].as_array().expect("vectors must be an array");
    assert_eq!(
        vectors.len(),
        6,
        "The freeze holds exactly 6 vectors, no more and no fewer"
    );
    for vector in vectors {
        let get = |key: &str| vector[key].as_str().expect("vector fields are strings");
        let amount: u128 = get("amount").parse().expect("amount must parse as u128");
        let policy_version: u64 = get("policy_version")
            .parse()
            .expect("policy_version must parse as u64");
        let nonce: u64 = get("nonce").parse().expect("nonce must parse as u64");
        let expiry: u64 = get("expiry_ns")
            .parse()
            .expect("expiry_ns must parse as u64");
        let evidence_hash =
            hex_to_32(get("evidence_hash_hex")).expect("evidence hash must be 32 bytes");
        let got = settlement_digest(
            get("network_id"),
            get("vault_id"),
            get("policy_id"),
            policy_version,
            get("obligation_id"),
            get("token_id"),
            get("recipient"),
            amount,
            get("evidence_type"),
            &evidence_hash,
            nonce,
            expiry,
        );
        let got_hex = to_hex(&got);
        println!(
            "{} expected {} got {}",
            get("id"),
            get("expected_sha256"),
            got_hex
        );
        assert_eq!(
            got_hex,
            get("expected_sha256"),
            "hash mismatch for vector {}",
            get("id")
        );
    }
}

#[test]
fn receipt_hash_matches_frozen_formula() {
    let receipt = Receipt {
        index: 0,
        prev_hash: genesis_prev_hash(),
        obligation_id: "obl-001".to_string(),
        recipient: "acme-supplies.testnet".to_string(),
        amount: 250000000,
        token_id: "usdc.fakes.testnet".to_string(),
        timestamp: 1767225600000000000,
        tx_ref: "tx-abc123".to_string(),
    };
    let got = to_hex(&receipt_hash(&receipt));
    println!(
        "receipt expected 2099107143c5609e23746037ee133473bc7459c6234db76ebd93333d03bf4934 got {}",
        got
    );
    assert_eq!(
        got,
        "2099107143c5609e23746037ee133473bc7459c6234db76ebd93333d03bf4934"
    );
}
