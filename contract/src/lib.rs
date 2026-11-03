use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{AccountId, PanicOnDefault, env, near, require};

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
            native_headroom: 0,
        })
    }

    pub fn receipts(&self, start: u64, limit: u64) -> Vec<Receipt> {
        // Phase 1 skeleton: no receipts can exist yet, so this is an empty page
        // for any start and limit. The parameter names must be start and limit,
        // exactly as frozen in docs/contract-api.md, because NEAR JSON calls
        // use parameter names, not positions. Renaming them to _start/_limit
        // broke the frozen client call, which sends {start, limit}.
        let _ = (start, limit);
        Vec::new()
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
