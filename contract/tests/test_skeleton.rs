use near_api::{AccountId, NearGas, NearToken};
use near_sdk::serde_json::json;

#[derive(near_sdk::serde::Deserialize, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct PolicyView {
    pub policy_id: String,
    pub token_id: AccountId,
    pub limit: u128,
    pub spent: u128,
    pub reserved: u128,
    pub funded: u128,
    pub frozen: bool,
    pub version: u64,
    pub reconciler: Option<AccountId>,
}

async fn test_skeleton_on(contract_wasm: Vec<u8>) -> testresult::TestResult<()> {
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let sandbox_network =
        near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let owner = create_subaccount(&sandbox, "owner.sandbox").await?;
    let other = create_subaccount(&sandbox, "other.sandbox").await?;
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
    contract.call_function("create_policy", json!({"policy_id": "policy-001", "token_id": "usdc.fakes.testnet", "limit": 1000000u128}))
        .transaction().gas(NearGas::from_tgas(30)).with_signer(owner.account_id().clone(), signer.clone()).send_to(&sandbox_network).await?.assert_success();
    let policy: PolicyView = contract
        .call_function("get_policy", json!({"policy_id": "policy-001"}))
        .read_only()
        .fetch_from(&sandbox_network)
        .await?
        .data;
    assert_eq!(policy.policy_id, "policy-001");
    assert_eq!(policy.version, 1);
    assert!(!policy.frozen);
    contract.call_function("create_obligation", json!({"obligation_id": "obl-001", "policy_id": "policy-001", "recipient": "acme-supplies.testnet", "amount": 250000u128, "evidence_type": "delivery-note", "evidence_hash": vec![0u8; 32], "expires_at_ns": 1767225600000000000u64, "nonce": 1u64}))
        .transaction().gas(NearGas::from_tgas(30)).with_signer(owner.account_id().clone(), signer.clone()).send_to(&sandbox_network).await?.assert_success();
    contract
        .call_function("request_evidence", json!({"obligation_id": "obl-001"}))
        .transaction()
        .gas(NearGas::from_tgas(30))
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();
    contract
        .call_function("freeze_policy", json!({"policy_id": "policy-001"}))
        .transaction()
        .gas(NearGas::from_tgas(30))
        .with_signer(owner.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_success();
    let policy: PolicyView = contract
        .call_function("get_policy", json!({"policy_id": "policy-001"}))
        .read_only()
        .fetch_from(&sandbox_network)
        .await?
        .data;
    assert!(policy.frozen);
    assert_eq!(policy.version, 1);
    contract
        .call_function(
            "create_policy",
            json!({"policy_id": "policy-002", "token_id": "usdc.fakes.testnet", "limit": 1u128}),
        )
        .transaction()
        .gas(NearGas::from_tgas(30))
        .with_signer(other.account_id().clone(), signer.clone())
        .send_to(&sandbox_network)
        .await?
        .assert_failure();
    Ok(())
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
async fn test_contract_is_operational() -> testresult::TestResult<()> {
    let contract_wasm_path = cargo_near_build::build_with_cli(Default::default())?;
    let contract_wasm = std::fs::read(contract_wasm_path)?;
    test_skeleton_on(contract_wasm).await
}
