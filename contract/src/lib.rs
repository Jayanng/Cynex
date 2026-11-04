use near_sdk::json_types::U128;
use near_sdk::serde_json;
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, env, near, require,
};

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Policy {
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

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Obligation {
    pub obligation_id: String,
    pub policy_id: String,
    pub policy_version: u64,
    pub recipient: AccountId,
    pub amount: u128,
    pub evidence_type: String,
    pub evidence_hash: [u8; 32],
    pub expires_at_ns: u64,
    pub nonce: u64,
    pub state: String,
    pub in_flight: bool,
    pub transfer_attempt: u64,
    pub transfer_dispatched_at_ns: Option<u64>,
    pub pending_request_id: Option<String>,
    pub pending_digest: Option<[u8; 32]>,
    pub evidence_requested_at_ns: Option<u64>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Balance {
    pub spent: u128,
    pub reserved: u128,
    pub limit: u128,
    pub funded: u128,
    pub native_headroom: u128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Receipt {
    pub index: u64,
    pub prev_hash: [u8; 32],
    pub obligation_id: String,
    pub recipient: AccountId,
    pub amount: u128,
    pub token_id: AccountId,
    pub timestamp: u64,
    pub tx_ref: String,
}

fn append_string(buf: &mut Vec<u8>, s: &str) {
    buf.extend_from_slice(&(s.len() as u32).to_be_bytes());
    buf.extend_from_slice(s.as_bytes());
}

fn append_u64(buf: &mut Vec<u8>, v: u64) {
    buf.extend_from_slice(&v.to_be_bytes());
}

fn append_u128(buf: &mut Vec<u8>, v: u128) {
    buf.extend_from_slice(&v.to_be_bytes());
}

fn hex_to_32(hex: &str) -> Option<[u8; 32]> {
    let hex = hex.strip_prefix("0x").unwrap_or(hex);
    if hex.len() != 64 || !hex.is_ascii() {
        return None;
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(out)
}

fn parse_fund_policy(msg: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(msg).ok()?;
    v.get("fund_policy")?.as_str().map(|s| s.to_string())
}

#[allow(clippy::too_many_arguments)]
// Frozen digest takes 12 fields by definition, in a fixed order. Bundling them would hide that order, so the allow is explicit, not a warning sweep.
pub fn settlement_digest(
    network_id: &str,
    vault_id: &str,
    policy_id: &str,
    policy_version: u64,
    obligation_id: &str,
    token_id: &str,
    recipient: &str,
    amount: u128,
    evidence_type: &str,
    evidence_hash: &[u8; 32],
    nonce: u64,
    expiry: u64,
) -> [u8; 32] {
    let mut buf = Vec::new();
    buf.extend_from_slice(b"CYNEX_SETTLEMENT_V1");
    append_string(&mut buf, network_id);
    append_string(&mut buf, vault_id);
    append_string(&mut buf, policy_id);
    append_u64(&mut buf, policy_version);
    append_string(&mut buf, obligation_id);
    append_string(&mut buf, token_id);
    append_string(&mut buf, recipient);
    append_u128(&mut buf, amount);
    append_string(&mut buf, evidence_type);
    buf.extend_from_slice(evidence_hash);
    append_u64(&mut buf, nonce);
    append_u64(&mut buf, expiry);
    env::sha256(&buf)
        .try_into()
        .expect("sha256 must be 32 bytes")
}

const FT_TRANSFER_GAS: Gas = Gas::from_tgas(30);
const CALLBACK_GAS: Gas = Gas::from_tgas(30);
const RECEIPT_STORAGE_BYTES: u64 = 512;
// Safety margin for the 1 yocto ft_transfer deposit plus gas headroom,
// per the frozen money path. This is a conservative placeholder margin,
// 0.01 NEAR, not a measured gas cost, and is revisited when gas is measured.
const SETTLE_NATIVE_MARGIN_YOCTO: u128 = 10_000_000_000_000_000_000_000;

#[allow(clippy::too_many_arguments)]
// Frozen receipt hash takes 8 fields by definition, in a fixed order.
fn receipt_hash(
    index: u64,
    prev_hash: &[u8; 32],
    obligation_id: &str,
    recipient: &str,
    amount: u128,
    token_id: &str,
    timestamp: u64,
    tx_ref: &str,
) -> [u8; 32] {
    let mut buf = Vec::new();
    buf.extend_from_slice(&index.to_be_bytes());
    buf.extend_from_slice(prev_hash);
    append_string(&mut buf, obligation_id);
    append_string(&mut buf, recipient);
    append_u128(&mut buf, amount);
    append_string(&mut buf, token_id);
    append_u64(&mut buf, timestamp);
    append_string(&mut buf, tx_ref);
    env::sha256(&buf)
        .try_into()
        .expect("sha256 must be 32 bytes")
}

fn native_headroom_yocto() -> u128 {
    // Spendable headroom, not total balance: storage already used is not
    // spendable again. Native headroom is never summed with token units.
    let balance = env::account_balance().as_yoctonear();
    let used = env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear();
    balance.saturating_sub(used)
}

fn receipt_storage_reserve_yocto() -> u128 {
    RECEIPT_STORAGE_BYTES as u128 * env::storage_byte_cost().as_yoctonear()
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    pub owner: AccountId,
    pub verifiers: IterableSet<AccountId>,
    pub policies: LookupMap<String, Policy>,
    pub obligations: LookupMap<String, Obligation>,
    pub receipt_index: u64,
    pub last_receipt_hash: [u8; 32],
}

#[near]
impl Contract {
    #[init]
    pub fn init(owner: AccountId) -> Self {
        Self {
            owner,
            verifiers: IterableSet::new(b"v"),
            policies: LookupMap::new(b"p"),
            obligations: LookupMap::new(b"o"),
            receipt_index: 0,
            last_receipt_hash: [0u8; 32],
        }
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "ERR_NOT_OWNER");
    }

    pub fn add_verifier(&mut self, verifier: AccountId) {
        self.assert_owner();
        self.verifiers.insert(verifier);
    }

    pub fn remove_verifier(&mut self, verifier: &AccountId) -> bool {
        self.assert_owner();
        self.verifiers.remove(verifier)
    }

    pub fn create_policy(&mut self, policy_id: String, token_id: AccountId, limit: u128) {
        self.assert_owner();
        require!(self.policies.get(&policy_id).is_none(), "ERR_POLICY_EXISTS");
        let policy = Policy {
            policy_id: policy_id.clone(),
            token_id,
            limit,
            spent: 0,
            reserved: 0,
            funded: 0,
            frozen: false,
            version: 1,
            reconciler: None,
        };
        self.policies.insert(policy_id, policy);
    }

    #[allow(clippy::too_many_arguments)]
    // Frozen contract API signature, 9 arguments, cannot be reduced without breaking the frozen interface.
    pub fn create_obligation(
        &mut self,
        obligation_id: String,
        policy_id: String,
        recipient: AccountId,
        amount: u128,
        evidence_type: String,
        evidence_hash: [u8; 32],
        expires_at_ns: u64,
        nonce: u64,
    ) {
        self.assert_owner();
        let policy = self
            .policies
            .get(&policy_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_POLICY_MISSING"));
        require!(!policy.frozen, "ERR_POLICY_FROZEN");
        require!(
            self.obligations.get(&obligation_id).is_none(),
            "ERR_OBLIGATION_EXISTS"
        );
        // Bound obligation_id so the frozen Receipt Borsh size is provably
        // under the 512-byte storage reserve: 64-char ID, 64-char recipient,
        // 64-char token, 44-char tx_ref gives at most 316 bytes.
        require!(obligation_id.len() <= 64, "ERR_OBLIGATION_ID_TOO_LONG");
        let obligation = Obligation {
            obligation_id: obligation_id.clone(),
            policy_id,
            policy_version: policy.version,
            recipient,
            amount,
            evidence_type,
            evidence_hash,
            expires_at_ns,
            nonce,
            state: "CREATED".to_string(),
            in_flight: false,
            transfer_attempt: 0,
            transfer_dispatched_at_ns: None,
            pending_request_id: None,
            pending_digest: None,
            evidence_requested_at_ns: None,
        };
        self.obligations.insert(obligation_id, obligation);
    }

    pub fn freeze_policy(&mut self, policy_id: String) {
        self.assert_owner();
        let mut policy = self
            .policies
            .get(&policy_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_POLICY_MISSING"));
        policy.frozen = true;
        self.policies.insert(policy_id, policy);
    }

    pub fn unfreeze_policy(&mut self, policy_id: String) {
        self.assert_owner();
        let mut policy = self
            .policies
            .get(&policy_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_POLICY_MISSING"));
        policy.frozen = false;
        self.policies.insert(policy_id, policy);
    }

    pub fn set_reconciler(&mut self, policy_id: String, reconciler: AccountId) {
        self.assert_owner();
        let mut policy = self
            .policies
            .get(&policy_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_POLICY_MISSING"));
        policy.reconciler = Some(reconciler);
        self.policies.insert(policy_id, policy);
    }

    pub fn cancel_obligation(&mut self, obligation_id: String) {
        self.assert_owner();
        let mut obligation = self
            .obligations
            .get(&obligation_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_OBLIGATION_MISSING"));
        require!(obligation.state == "CREATED", "ERR_INVALID_STATE");
        obligation.state = "CANCELLED".to_string();
        self.obligations.insert(obligation_id, obligation);
    }

    pub fn approve_warning(&mut self, obligation_id: String) {
        self.assert_owner();
        let mut obligation = self
            .obligations
            .get(&obligation_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_OBLIGATION_MISSING"));
        require!(obligation.state == "WARN_PENDING", "ERR_INVALID_STATE");
        obligation.state = "READY".to_string();
        self.obligations.insert(obligation_id, obligation);
    }

    pub fn request_evidence(&mut self, obligation_id: String) {
        self.assert_owner();
        let mut obligation = self
            .obligations
            .get(&obligation_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_OBLIGATION_MISSING"));
        require!(obligation.state == "CREATED", "ERR_INVALID_STATE");
        let policy = self
            .policies
            .get(&obligation.policy_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_POLICY_MISSING"));
        let digest = settlement_digest(
            "testnet",
            env::current_account_id().as_str(),
            &obligation.policy_id,
            obligation.policy_version,
            &obligation_id,
            policy.token_id.as_str(),
            obligation.recipient.as_str(),
            obligation.amount,
            &obligation.evidence_type,
            &obligation.evidence_hash,
            obligation.nonce,
            obligation.expires_at_ns,
        );
        obligation.state = "EVIDENCE_PENDING".to_string();
        obligation.evidence_requested_at_ns = Some(env::block_timestamp());
        obligation.pending_request_id = Some(format!("{}-{}", obligation_id, obligation.nonce));
        obligation.pending_digest = Some(digest);
        self.obligations.insert(obligation_id, obligation);
    }

    pub fn get_policy(&self, policy_id: String) -> Option<Policy> {
        self.policies.get(&policy_id).cloned()
    }

    pub fn get_obligation(&self, obligation_id: String) -> Option<Obligation> {
        self.obligations.get(&obligation_id).cloned()
    }

    pub fn balances(&self, policy_id: String) -> Option<Balance> {
        self.policies.get(&policy_id).map(|p| Balance {
            spent: p.spent,
            reserved: p.reserved,
            limit: p.limit,
            funded: p.funded,
            native_headroom: native_headroom_yocto(),
        })
    }

    pub fn receipts(&self, start: u64, limit: u64) -> Vec<Receipt> {
        // Receipts live under prefix b"r", created on demand, not as a new
        // Contract struct field. That keeps the already deployed Phase 1
        // state readable on upgrade: adding a struct field would change the
        // Borsh layout of the stored state and break deserialization.
        let map: LookupMap<u64, Receipt> = LookupMap::new(b"r");
        let mut out = Vec::new();
        let limit = limit.min(100);
        let mut i = start;
        while out.len() < limit as usize {
            match map.get(&i) {
                Some(r) => out.push(r.clone()),
                None => break,
            }
            i = i.saturating_add(1);
        }
        out
    }

    pub fn submit_evidence(
        &mut self,
        request_id: String,
        obligation_id: String,
        result: String,
        proof: String,
    ) {
        let caller = env::predecessor_account_id();
        require!(
            self.verifiers.contains(&caller),
            "ERR_UNAUTHORIZED_VERIFIER"
        );
        let mut obligation = self
            .obligations
            .get(&obligation_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_OBLIGATION_MISSING"));
        require!(obligation.state == "EVIDENCE_PENDING", "ERR_INVALID_STATE");
        require!(
            obligation.pending_request_id.as_deref() == Some(request_id.as_str()),
            "ERR_EVIDENCE_MISMATCH"
        );
        let proof_bytes =
            hex_to_32(&proof).unwrap_or_else(|| env::panic_str("ERR_EVIDENCE_MISMATCH"));
        require!(
            proof_bytes == obligation.evidence_hash,
            "ERR_EVIDENCE_MISMATCH"
        );
        let policy = self
            .policies
            .get(&obligation.policy_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_POLICY_MISSING"));
        let digest = settlement_digest(
            "testnet",
            env::current_account_id().as_str(),
            &obligation.policy_id,
            obligation.policy_version,
            &obligation_id,
            policy.token_id.as_str(),
            obligation.recipient.as_str(),
            obligation.amount,
            &obligation.evidence_type,
            &obligation.evidence_hash,
            obligation.nonce,
            obligation.expires_at_ns,
        );
        require!(
            obligation.pending_digest == Some(digest),
            "ERR_EVIDENCE_MISMATCH"
        );
        require!(
            env::block_timestamp() <= obligation.expires_at_ns,
            "ERR_EVIDENCE_EXPIRED"
        );
        obligation.state = match result.as_str() {
            "ALLOWED" => "READY".to_string(),
            "WARN" => "WARN_PENDING".to_string(),
            "BLOCK" => "BLOCKED".to_string(),
            _ => env::panic_str("ERR_INVALID_RESULT"),
        };
        self.obligations.insert(obligation_id, obligation);
    }

    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        // Only funding path, frozen in Phase 0. Predecessor must be the token
        // contract named in the policy, and msg must be JSON with fund_policy.
        // Anything else returns the full amount unused and changes no state.
        let token_id = env::predecessor_account_id();
        let _ = sender_id;
        let fund_policy: Option<String> = parse_fund_policy(&msg);
        let policy_id = match fund_policy {
            Some(id) => id,
            None => return amount,
        };
        let mut policy = match self.policies.get(&policy_id).cloned() {
            Some(p) => p,
            None => return amount,
        };
        if policy.token_id != token_id {
            return amount;
        }
        policy.funded = policy
            .funded
            .checked_add(amount.0)
            .unwrap_or_else(|| env::panic_str("ERR_BUDGET_EXCEEDED"));
        self.policies.insert(policy_id, policy);
        U128(0)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn settle(
        &mut self,
        obligation_id: String,
        proposed_recipient: AccountId,
        proposed_amount: U128,
        evidence_ref: String,
    ) -> Promise {
        // Registration is an operational precondition per frozen contract-api.md:
        // vault and recipient must be storage_deposit-registered on the token
        // and confirmed by storage_balance_of non-null before settle. The contract
        // cannot check that synchronously, so an unregistered recipient fails
        // safely at ft_transfer and the Err callback releases the reservation.
        // evidence_ref is frozen in the settle signature for off-chain audit,
        // it is not an on-chain booking field; terms are read from state.
        let _ = evidence_ref;
        let mut obligation = self
            .obligations
            .get(&obligation_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_OBLIGATION_MISSING"));
        require!(obligation.state == "READY", "ERR_INVALID_STATE");
        require!(
            obligation.recipient == proposed_recipient,
            "ERR_RECIPIENT_SUBSTITUTION"
        );
        require!(obligation.amount == proposed_amount.0, "ERR_TERMS_MISMATCH");
        require!(
            env::block_timestamp() <= obligation.expires_at_ns,
            "ERR_OBLIGATION_EXPIRED"
        );
        let mut policy = self
            .policies
            .get(&obligation.policy_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_POLICY_MISSING"));
        require!(!policy.frozen, "ERR_POLICY_FROZEN");
        require!(
            obligation.policy_version == policy.version,
            "ERR_TERMS_MISMATCH"
        );
        require!(!obligation.in_flight, "ERR_NONCE_ALREADY_CONSUMED");
        let new_total = policy
            .spent
            .checked_add(policy.reserved)
            .and_then(|v| v.checked_add(obligation.amount))
            .unwrap_or_else(|| env::panic_str("ERR_BUDGET_EXCEEDED"));
        require!(new_total <= policy.limit, "ERR_BUDGET_EXCEEDED");
        require!(new_total <= policy.funded, "ERR_BUDGET_EXCEEDED");
        let headroom = native_headroom_yocto();
        require!(
            headroom > receipt_storage_reserve_yocto().saturating_add(SETTLE_NATIVE_MARGIN_YOCTO),
            "ERR_VAULT_STORAGE_EXHAUSTED"
        );
        // Reserve synchronously, before any promise, so two concurrent
        // settle calls cannot both pass the budget check and both pay.
        policy.reserved = policy
            .reserved
            .checked_add(obligation.amount)
            .unwrap_or_else(|| env::panic_str("ERR_BUDGET_EXCEEDED"));
        obligation.state = "TRANSFER_PENDING".to_string();
        obligation.in_flight = true;
        obligation.transfer_attempt = obligation
            .transfer_attempt
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("ERR_NONCE_ALREADY_CONSUMED"));
        let attempt = obligation.transfer_attempt;
        obligation.transfer_dispatched_at_ns = Some(env::block_timestamp());
        let policy_id = obligation.policy_id.clone();
        let token_id = policy.token_id.clone();
        let recipient = obligation.recipient.clone();
        let amount = obligation.amount;
        self.policies.insert(policy_id, policy);
        self.obligations.insert(obligation_id.clone(), obligation);
        let args = serde_json::json!({
            "receiver_id": recipient,
            "amount": amount.to_string(),
            "memo": null,
        });
        Promise::new(token_id)
            .function_call(
                "ft_transfer".to_string(),
                serde_json::to_vec(&args).unwrap(),
                NearToken::from_yoctonear(1),
                FT_TRANSFER_GAS,
            )
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "on_transfer_complete".to_string(),
                    serde_json::to_vec(&serde_json::json!({
                        "obligation_id": obligation_id,
                        "attempt_id": attempt,
                    }))
                    .unwrap(),
                    NearToken::from_yoctonear(0),
                    CALLBACK_GAS,
                ),
            )
    }

    #[private]
    pub fn on_transfer_complete(
        &mut self,
        obligation_id: String,
        attempt_id: u64,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        let mut obligation = match self.obligations.get(&obligation_id).cloned() {
            Some(o) => o,
            None => return,
        };
        if obligation.state != "TRANSFER_PENDING" || !obligation.in_flight {
            return;
        }
        if attempt_id != obligation.transfer_attempt {
            return;
        }
        let mut policy = match self.policies.get(&obligation.policy_id).cloned() {
            Some(p) => p,
            None => return,
        };
        match result {
            Ok(()) => {
                policy.reserved = policy
                    .reserved
                    .checked_sub(obligation.amount)
                    .unwrap_or_else(|| env::panic_str("ERR_BUDGET_EXCEEDED"));
                policy.spent = policy
                    .spent
                    .checked_add(obligation.amount)
                    .unwrap_or_else(|| env::panic_str("ERR_BUDGET_EXCEEDED"));
                obligation.state = "PAID".to_string();
                obligation.in_flight = false;
                obligation.transfer_dispatched_at_ns = None;
                let index = self.receipt_index;
                let receipt = Receipt {
                    index,
                    prev_hash: self.last_receipt_hash,
                    obligation_id: obligation_id.clone(),
                    recipient: obligation.recipient.clone(),
                    amount: obligation.amount,
                    token_id: policy.token_id.clone(),
                    timestamp: env::block_timestamp(),
                    tx_ref: String::new(),
                };
                let hash = receipt_hash(
                    receipt.index,
                    &receipt.prev_hash,
                    &receipt.obligation_id,
                    receipt.recipient.as_str(),
                    receipt.amount,
                    receipt.token_id.as_str(),
                    receipt.timestamp,
                    &receipt.tx_ref,
                );
                let mut map: LookupMap<u64, Receipt> = LookupMap::new(b"r");
                env::log_str(&format!("EVENT_JSON:{}", serde_json::to_string(&serde_json::json!({"standard": "nep297", "version": "1.0.0", "event": "receipt", "data": [{"index": receipt.index, "obligation_id": &receipt.obligation_id, "recipient": &receipt.recipient, "amount": receipt.amount.to_string(), "token_id": &receipt.token_id, "timestamp": receipt.timestamp, "prev_hash": receipt.prev_hash.iter().map(|b| format!("{:02x}", b)).collect::<String>(), "tx_ref": &receipt.tx_ref}]})).unwrap()));
                map.insert(index, receipt);
                map.flush();
                self.receipt_index = self.receipt_index.saturating_add(1);
                self.last_receipt_hash = hash;
                self.policies.insert(obligation.policy_id.clone(), policy);
                self.obligations.insert(obligation_id, obligation);
            }
            Err(_) => {
                if policy.frozen {
                    obligation.state = "RECONCILIATION_REQUIRED".to_string();
                    self.obligations.insert(obligation_id, obligation);
                    return;
                }
                policy.reserved = policy
                    .reserved
                    .checked_sub(obligation.amount)
                    .unwrap_or_else(|| env::panic_str("ERR_BUDGET_EXCEEDED"));
                obligation.state = "READY".to_string();
                obligation.in_flight = false;
                obligation.transfer_dispatched_at_ns = None;
                self.policies.insert(obligation.policy_id.clone(), policy);
                self.obligations.insert(obligation_id, obligation);
            }
        }
    }

    pub fn state(&self) -> (AccountId, u64, [u8; 32]) {
        (
            self.owner.clone(),
            self.receipt_index,
            self.last_receipt_hash,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{VMContextBuilder, accounts};
    use near_sdk::{AccountId, testing_env};

    fn owner() -> AccountId {
        accounts(0)
    }
    fn other() -> AccountId {
        accounts(1)
    }

    fn setup_owner() -> Contract {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        Contract::init(owner())
    }

    fn hex32(hex: &str) -> [u8; 32] {
        let mut out = [0u8; 32];
        for i in 0..32 {
            out[i] = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).unwrap();
        }
        out
    }

    #[test]
    fn owner_can_create_policy_and_obligation() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        c.create_obligation(
            "obl-001".to_string(),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            250000,
            "delivery-note".to_string(),
            hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
            1767225600000000000,
            1,
        );
        assert_eq!(c.get_policy("policy-001".to_string()).unwrap().version, 1);
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "CREATED"
        );
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn non_owner_cannot_create_policy() {
        let mut c = setup_owner();
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(other());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        c.create_policy("p".to_string(), "usdc.fakes.testnet".parse().unwrap(), 1);
    }

    #[test]
    fn freeze_does_not_bump_version() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        c.freeze_policy("policy-001".to_string());
        assert!(c.get_policy("policy-001".to_string()).unwrap().frozen);
        assert_eq!(c.get_policy("policy-001".to_string()).unwrap().version, 1);
        c.unfreeze_policy("policy-001".to_string());
        assert!(!c.get_policy("policy-001".to_string()).unwrap().frozen);
        assert_eq!(c.get_policy("policy-001".to_string()).unwrap().version, 1);
    }

    #[test]
    fn request_evidence_sets_pending_fields() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        c.create_obligation(
            "obl-001".to_string(),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            250000,
            "delivery-note".to_string(),
            hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
            1767225600000000000,
            1,
        );
        c.request_evidence("obl-001".to_string());
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
        assert_eq!(o.pending_request_id, Some("obl-001-1".to_string()));
        assert!(o.pending_digest.is_some());
        assert!(o.evidence_requested_at_ns.is_some());
    }

    #[test]
    fn request_evidence_digest_matches_frozen_basic_vector() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        c.create_obligation(
            "obl-001".to_string(),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            250000000,
            "delivery-note".to_string(),
            hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
            1767225600000000000,
            1,
        );
        c.request_evidence("obl-001".to_string());
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(
            o.pending_digest,
            Some(hex32(
                "0524986a7f7d5e3a332f3a2ec99c1847aa54ae48cad9a9aec1a8e5b6af043ba6"
            ))
        );
    }

    #[test]
    fn ft_on_transfer_credits_policy_and_rejects_bad_msg() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        // Predecessor must be the token contract for a valid funding call.
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("usdc.fakes.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        let unused = c.ft_on_transfer(
            "cynexmaster.testnet".parse().unwrap(),
            U128(250000000),
            "{\"fund_policy\": \"policy-001\"}".to_string(),
        );
        assert_eq!(unused.0, 0);
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().funded,
            250000000
        );
        let refunded = c.ft_on_transfer(
            "cynexmaster.testnet".parse().unwrap(),
            U128(100),
            "not json".to_string(),
        );
        assert_eq!(refunded.0, 100);
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().funded,
            250000000
        );
    }

    #[test]
    fn settle_reserves_synchronously_and_rejects_wrong_recipient() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        // Fund via ft_on_transfer as the token contract, then move to READY
        // through the evidence path, which is the only frozen path to READY.
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("usdc.fakes.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        c.ft_on_transfer(
            "cynexmaster.testnet".parse().unwrap(),
            U128(1000000),
            "{\"fund_policy\": \"policy-001\"}".to_string(),
        );
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        c.create_obligation(
            "obl-001".to_string(),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            250000,
            "delivery-note".to_string(),
            hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
            9999999999999999999,
            1,
        );
        c.request_evidence("obl-001".to_string());
        c.add_verifier(owner());
        c.submit_evidence(
            "obl-001-1".to_string(),
            "obl-001".to_string(),
            "ALLOWED".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
        );
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "READY"
        );
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("cynex-agent.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        let _promise = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "evidence-ref".to_string(),
        );
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "TRANSFER_PENDING");
        assert!(o.in_flight);
        assert_eq!(o.transfer_attempt, 1);
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().reserved,
            250000
        );
    }

    #[test]
    fn receipt_hash_matches_frozen_formula_for_genesis() {
        let h = receipt_hash(
            0,
            &[0u8; 32],
            "obl-001",
            "acme-supplies.testnet",
            250000000,
            "usdc.fakes.testnet",
            1767225600000000000,
            "",
        );
        assert_eq!(h.len(), 32);
        assert_ne!(h, [0u8; 32]);
        let h2 = receipt_hash(
            0,
            &[0u8; 32],
            "obl-001",
            "acme-supplies.testnet",
            250000000,
            "usdc.fakes.testnet",
            1767225600000000000,
            "",
        );
        assert_eq!(h, h2);
    }

    fn setup_ready_obligation(c: &mut Contract, obligation_id: &str, amount: u128) {
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("usdc.fakes.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        c.ft_on_transfer(
            "cynexmaster.testnet".parse().unwrap(),
            U128(1000000),
            "{\"fund_policy\": \"policy-001\"}".to_string(),
        );
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        c.create_obligation(
            obligation_id.to_string(),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            amount,
            "delivery-note".to_string(),
            hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
            9999999999999999999,
            1,
        );
        c.request_evidence(obligation_id.to_string());
        c.add_verifier(owner());
        c.submit_evidence(
            format!("{}-1", obligation_id),
            obligation_id.to_string(),
            "ALLOWED".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
        );
    }

    #[test]
    fn callback_ok_books_paid_and_receipt() {
        let mut c = setup_owner();
        setup_ready_obligation(&mut c, "obl-001", 250000);
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("cynex-agent.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "evidence-ref".to_string(),
        );
        // In unit tests the callback argument is passed directly.
        c.on_transfer_complete("obl-001".to_string(), 1, Ok(()));
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "PAID");
        assert!(!o.in_flight);
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().spent,
            250000
        );
        assert_eq!(c.get_policy("policy-001".to_string()).unwrap().reserved, 0);
        let receipts = c.receipts(0, 10);
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].index, 0);
        assert_eq!(receipts[0].prev_hash, [0u8; 32]);
        assert_eq!(receipts[0].amount, 250000);
        assert_ne!(c.last_receipt_hash, [0u8; 32]);
        // Stale callback must be a no-op, not a second booking.
        c.on_transfer_complete("obl-001".to_string(), 1, Ok(()));
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().spent,
            250000
        );
        assert_eq!(c.receipts(0, 10).len(), 1);
    }

    #[test]
    fn callback_err_releases_reservation_to_ready() {
        let mut c = setup_owner();
        setup_ready_obligation(&mut c, "obl-001", 250000);
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("cynex-agent.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "evidence-ref".to_string(),
        );
        c.on_transfer_complete("obl-001".to_string(), 1, Err(PromiseError::Failed));
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "READY");
        assert!(!o.in_flight);
        assert_eq!(c.get_policy("policy-001".to_string()).unwrap().reserved, 0);
        assert_eq!(c.receipts(0, 10).len(), 0);
    }

    fn setup_ready_with_amount(
        c: &mut Contract,
        obligation_id: &str,
        amount: u128,
        funded: u128,
        limit: u128,
    ) {
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            limit,
        );
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("usdc.fakes.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        c.ft_on_transfer(
            "cynexmaster.testnet".parse().unwrap(),
            U128(funded),
            "{\"fund_policy\": \"policy-001\"}".to_string(),
        );
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        c.create_obligation(
            obligation_id.to_string(),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            amount,
            "delivery-note".to_string(),
            hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
            9999999999999999999,
            1,
        );
        c.request_evidence(obligation_id.to_string());
        c.add_verifier(owner());
        c.submit_evidence(
            format!("{}-1", obligation_id),
            obligation_id.to_string(),
            "ALLOWED".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
        );
    }

    fn agent_ctx() {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("cynex-agent.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
    }

    #[test]
    #[should_panic(expected = "ERR_RECIPIENT_SUBSTITUTION")]
    fn settle_rejects_wrong_recipient() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 250000, 1000000, 1000000);
        agent_ctx();
        let _ = c.settle(
            "obl-001".to_string(),
            "attacker.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_TERMS_MISMATCH")]
    fn settle_rejects_wrong_amount() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 250000, 1000000, 1000000);
        agent_ctx();
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(1),
            "x".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_POLICY_FROZEN")]
    fn settle_rejects_frozen_policy() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 250000, 1000000, 1000000);
        c.freeze_policy("policy-001".to_string());
        agent_ctx();
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_BUDGET_EXCEEDED")]
    fn settle_rejects_unfunded() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 250000, 100, 1000000);
        agent_ctx();
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_INVALID_STATE")]
    fn settle_rejects_double_settle() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 250000, 1000000, 1000000);
        agent_ctx();
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_UNAUTHORIZED_VERIFIER")]
    fn submit_evidence_rejects_unauthorized() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        c.create_obligation(
            "obl-001".to_string(),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            250000,
            "delivery-note".to_string(),
            hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
            9999999999999999999,
            1,
        );
        c.request_evidence("obl-001".to_string());
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(other());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        c.submit_evidence(
            "obl-001-1".to_string(),
            "obl-001".to_string(),
            "ALLOWED".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
        );
    }

    #[test]
    fn submit_evidence_warn_and_block() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        c.create_obligation(
            "obl-001".to_string(),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            250000,
            "delivery-note".to_string(),
            hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
            9999999999999999999,
            1,
        );
        c.request_evidence("obl-001".to_string());
        c.add_verifier(owner());
        c.submit_evidence(
            "obl-001-1".to_string(),
            "obl-001".to_string(),
            "WARN".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
        );
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "WARN_PENDING"
        );
    }

    #[test]
    fn ft_on_transfer_refunds_unknown_policy_and_wrong_token() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("usdc.fakes.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        let r = c.ft_on_transfer(
            "x.testnet".parse().unwrap(),
            U128(100),
            "{\"fund_policy\": \"no-such\"}".to_string(),
        );
        assert_eq!(r.0, 100);
        assert_eq!(c.get_policy("policy-001".to_string()).unwrap().funded, 0);
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("other-token.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        let r = c.ft_on_transfer(
            "x.testnet".parse().unwrap(),
            U128(100),
            "{\"fund_policy\": \"policy-001\"}".to_string(),
        );
        assert_eq!(r.0, 100);
        assert_eq!(c.get_policy("policy-001".to_string()).unwrap().funded, 0);
    }

    #[test]
    fn callback_err_frozen_goes_to_reconciliation() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 250000, 1000000, 1000000);
        agent_ctx();
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        c.freeze_policy("policy-001".to_string());
        c.on_transfer_complete("obl-001".to_string(), 1, Err(PromiseError::Failed));
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "RECONCILIATION_REQUIRED");
        assert!(o.in_flight);
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().reserved,
            250000
        );
    }

    #[test]
    fn two_receipts_chain_and_paginate() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 250000, 1000000, 1000000);
        // Second obligation, same policy, different nonce via create_obligation directly after READY path
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        c.create_obligation(
            "obl-002".to_string(),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            100000,
            "delivery-note".to_string(),
            hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
            9999999999999999999,
            2,
        );
        c.request_evidence("obl-002".to_string());
        c.submit_evidence(
            "obl-002-2".to_string(),
            "obl-002".to_string(),
            "ALLOWED".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
        );
        agent_ctx();
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
        c.on_transfer_complete("obl-001".to_string(), 1, Ok(()));
        let first_hash = c.last_receipt_hash;
        let _ = c.settle(
            "obl-002".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(100000),
            "x".to_string(),
        );
        c.on_transfer_complete("obl-002".to_string(), 1, Ok(()));
        let receipts = c.receipts(0, 10);
        assert_eq!(receipts.len(), 2);
        assert_eq!(receipts[1].prev_hash, first_hash);
        assert_eq!(c.receipts(1, 1).len(), 1);
        assert_eq!(c.receipts(1, 1)[0].obligation_id, "obl-002");
        assert_eq!(c.receipts(0, 1000).len(), 2);
    }

    #[test]
    fn receipt_hash_known_vector() {
        let h = receipt_hash(
            0,
            &[0u8; 32],
            "obl-001",
            "acme-supplies.testnet",
            250000000,
            "usdc.fakes.testnet",
            1767225600000000000,
            "",
        );
        let hex: String = h.iter().map(|b| format!("{:02x}", b)).collect();
        assert_eq!(
            hex,
            "ed10bf951774a2aeeebb98d7b4b98a3f6caf6966f20c432b22bf094e62316ccc"
        );
    }

    #[test]
    fn submit_evidence_block_and_stale_attempt_noop() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 250000, 1000000, 1000000);
        // Fresh obligation for BLOCK
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        c.create_obligation(
            "obl-002".to_string(),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            100000,
            "delivery-note".to_string(),
            hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
            9999999999999999999,
            2,
        );
        c.request_evidence("obl-002".to_string());
        c.submit_evidence(
            "obl-002-2".to_string(),
            "obl-002".to_string(),
            "BLOCK".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
        );
        assert_eq!(
            c.get_obligation("obl-002".to_string()).unwrap().state,
            "BLOCKED"
        );
        // Stale attempt: settle obl-001, fail it, settle again (attempt 2), then replay attempt 1 callback
        agent_ctx();
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
        c.on_transfer_complete("obl-001".to_string(), 1, Err(PromiseError::Failed));
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "READY"
        );
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
        assert_eq!(
            c.get_obligation("obl-001".to_string())
                .unwrap()
                .transfer_attempt,
            2
        );
        c.on_transfer_complete("obl-001".to_string(), 1, Ok(()));
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "TRANSFER_PENDING"
        );
        assert_eq!(c.receipts(0, 10).len(), 0);
    }

    #[test]
    fn receipt_borsh_size_long_fixture_under_reserve() {
        // Worst-case frozen fields: 64-char account IDs (NEAR max), long obligation ID, 44-char tx_ref.
        // 512 bytes covers Borsh value plus LookupMap key/trie headroom, about 0.005 NEAR at 1e19 yocto/byte.
        let r = Receipt {
            index: 999,
            prev_hash: [0xabu8; 32],
            obligation_id: "obl-long-0123456789-abcdefghijklmnopqrstuvwxyz-0123456789".to_string(),
            recipient: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.testnet"
                .parse()
                .unwrap(),
            amount: u128::MAX,
            token_id: "usdc.fakes.testnet".parse().unwrap(),
            timestamp: u64::MAX,
            tx_ref: "44charTxRefBase58Example1234567890ABCDEFGHIJ".to_string(),
        };
        let bytes = near_sdk::borsh::to_vec(&r).unwrap();
        assert!(
            bytes.len() < 512,
            "long receipt borsh {} bytes, reserve 512",
            bytes.len()
        );
    }

    #[test]
    fn receipt_borsh_size_under_reserve() {
        let r = Receipt {
            index: 0,
            prev_hash: [0u8; 32],
            obligation_id: "obl-001".to_string(),
            recipient: "acme-supplies.testnet".parse().unwrap(),
            amount: 250000000,
            token_id: "usdc.fakes.testnet".parse().unwrap(),
            timestamp: 1767225600000000000,
            tx_ref: String::new(),
        };
        let bytes = near_sdk::borsh::to_vec(&r).unwrap();
        assert!(
            bytes.len() < 256,
            "receipt borsh {} bytes, reserve 256",
            bytes.len()
        );
    }

    #[test]
    #[should_panic(expected = "ERR_OBLIGATION_ID_TOO_LONG")]
    fn create_obligation_rejects_id_over_64() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        c.create_obligation(
            "x".repeat(65),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            100,
            "delivery-note".to_string(),
            hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
            9999999999999999999,
            1,
        );
    }

    #[test]
    fn digest_matches_frozen_basic_vector() {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        let d = settlement_digest(
            "testnet",
            "cynex-vault.testnet",
            "policy-001",
            1,
            "obl-001",
            "usdc.fakes.testnet",
            "acme-supplies.testnet",
            250000000,
            "delivery-note",
            &hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
            1,
            1767225600000000000,
        );
        assert_eq!(
            d,
            hex32("0524986a7f7d5e3a332f3a2ec99c1847aa54ae48cad9a9aec1a8e5b6af043ba6")
        );
    }
}
