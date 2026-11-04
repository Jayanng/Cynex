use near_api::{AccountId, NearGas, NearToken};
use near_sdk::serde_json::json;

#[derive(near_sdk::serde::Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct ObligationView {
    pub obligation_id: String,
    pub policy_id: String,
    pub policy_version: u64,
    pub recipient: AccountId,
    pub amount: u128,
    pub evidence_type: String,
    pub evidence_hash: Vec<u8>,
    pub expires_at_ns: u64,
    pub nonce: u64,
    pub state: String,
    pub in_flight: bool,
    pub transfer_attempt: u64,
    pub transfer_dispatched_at_ns: Option<u64>,
    pub pending_request_id: Option<String>,
    pub pending_digest: Option<Vec<u8>>,
    pub evidence_requested_at_ns: Option<u64>,
}

async fn create_subaccount(
    sandbox: &near_sandbox::Sandbox,
    name: &str,
) -> testresult::TestResult<near_api::Account> {
    let account_id: AccountId = name.parse().unwrap();
    sandbox
        .create_account(account_id.clone())
        .initial_balance(NearToken::from_near(10))
        .send()
        .await?;
    Ok(near_api::Account(account_id))
}

#[tokio::test]
async fn test_async_timeout_paths() -> testresult::TestResult<()> {
    let contract_wasm_path = cargo_near_build::build_with_cli(Default::default())?;
    let contract_wasm = std::fs::read(contract_wasm_path)?;
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let sandbox_network =
        near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let owner = create_subaccount(&sandbox, "owner.sandbox").await?;
    let contract = create_subaccount(&sandbox, "contract.sandbox")
        .await?
        .as_contract();
    let signer = near_api::Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY
            .parse()
            .unwrap(),
    )?;
    near_api::Contract::deploy(contract.account_id().clone())
        .use_code(contract_wasm)
        .with_init_call("init", json!({"owner": owner.account_id()}))?
        .with_signer(signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();
    contract
        .call_function(
            "create_policy",
            json!({"policy_id": "policy-001", "token_id": "usdc.fakes.testnet", "limit": 1000000u128}),
        )
        .transaction()
        .gas(NearGas::from_tgas(30))
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();
    contract
        .call_function(
            "create_obligation",
            json!({"obligation_id": "obl-001", "policy_id": "policy-001", "recipient": "acme-supplies.testnet", "amount": 250000u128, "evidence_type": "delivery-note", "evidence_hash": vec![0u8; 32], "expires_at_ns": 9999999999999999999u64, "nonce": 1u64}),
        )
        .transaction()
        .gas(NearGas::from_tgas(30))
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();
    contract
        .call_function("request_evidence", json!({"obligation_id": "obl-001"}))
        .transaction()
        .gas(NearGas::from_tgas(30))
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();
    // Evidence timeout has not passed yet: this must fail, never silently pass.
    // Note, honestly recorded: sandbox fast_forward advances block height,
    // not block timestamp by 3600 seconds, so a 1 hour timeout success
    // cannot be proven in sandbox without waiting an hour. Timeout success
    // is proven in unit tests with mocked block_timestamp, and live on
    // testnet with a pre-aged obligation, not by this sandbox test.
    contract
        .call_function(
            "mark_evidence_timeout",
            json!({"obligation_id": "obl-001", "escalate": false}),
        )
        .transaction()
        .gas(NearGas::from_tgas(30))
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_failure();
    let obl: ObligationView = contract
        .call_function("get_obligation", json!({"obligation_id": "obl-001"}))
        .read_only()
        .fetch_from(&sandbox_network)
        .await?
        .data;
    assert_eq!(obl.state, "EVIDENCE_PENDING");
    // Cancel from CREATED still works, and cancel from a terminal state fails.
    contract
        .call_function(
            "create_obligation",
            json!({"obligation_id": "obl-002", "policy_id": "policy-001", "recipient": "acme-supplies.testnet", "amount": 100000u128, "evidence_type": "delivery-note", "evidence_hash": vec![0u8; 32], "expires_at_ns": 9999999999999999999u64, "nonce": 2u64}),
        )
        .transaction()
        .gas(NearGas::from_tgas(30))
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();
    contract
        .call_function("cancel_obligation", json!({"obligation_id": "obl-002"}))
        .transaction()
        .gas(NearGas::from_tgas(30))
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();
    contract
        .call_function("cancel_obligation", json!({"obligation_id": "obl-002"}))
        .transaction()
        .gas(NearGas::from_tgas(30))
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_failure();
    // mark_reconciliation_required on a non-TRANSFER_PENDING obligation fails.
    contract
        .call_function(
            "mark_reconciliation_required",
            json!({"obligation_id": "obl-002"}),
        )
        .transaction()
        .gas(NearGas::from_tgas(30))
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_failure();
    Ok(())
}
