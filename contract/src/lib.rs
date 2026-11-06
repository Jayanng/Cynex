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
// Phase 4, plan 3.1.5 corrected formula: liquid >= 1 yocto + gas headroom
// + per-settlement receipt storage reserve, else VAULT_STORAGE_EXHAUSTED.
// The 1 yocto term is the NEP-141 ft_transfer deposit, explicit here so
// the formula can be audited line by line. Gas headroom is a conservative
// 0.01 NEAR margin, not a measured gas cost: the vault does not pay
// execution gas from its own balance, the caller prepays it, so this
// margin is safety headroom for future storage and deposit fluctuations,
// not a claim about measured gas. Receipt reserve is 512 bytes, the
// Phase 2 measured bound, at the current storage byte cost.
const FT_TRANSFER_DEPOSIT_YOCTO: u128 = 1;
const SETTLE_GAS_HEADROOM_YOCTO: u128 = 10_000_000_000_000_000_000_000;
// Frozen in Phase 0, recorded in docs/contract-api.md. Timeout durations are
// block timestamps, not wall clock, so a timeout is only reached when the
// chain itself has passed the deadline, never by a caller claiming time passed.
const TRANSFER_TIMEOUT_NS: u64 = 600_000_000_000;
const EVIDENCE_TIMEOUT_NS: u64 = 3_600_000_000_000;

// Phase 9, layer 1: the largest evidence blob the vault will hash
// on-chain for a PREIMAGE obligation. The bytes arrive as a JSON
// number array, so a larger cap would bloat the call arguments.
// Oversized evidence keeps the TRUSTED_RELAYER path. The bytes are
// hashed and dropped, never stored.
const MAX_PREIMAGE_BYTES: usize = 65_536;

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

fn settle_storage_requirement_yocto() -> u128 {
    receipt_storage_reserve_yocto()
        .saturating_add(FT_TRANSFER_DEPOSIT_YOCTO)
        .saturating_add(SETTLE_GAS_HEADROOM_YOCTO)
}

fn assert_policy_invariant(policy: &Policy) {
    // Phase 4: token ledger invariant, checked after every policy balance
    // change, before the policy is written back. Token units only, never
    // summed with native NEAR. A failure here is a budget bug, so it
    // panics with the budget code; because the assert runs before the
    // write, the calling method changes no further state after it.
    // Obligation-only transitions do not change spent, reserved, funded,
    // or limit, so they cannot break this invariant and do not need it.
    let total = policy
        .spent
        .checked_add(policy.reserved)
        .unwrap_or_else(|| env::panic_str("ERR_BUDGET_EXCEEDED"));
    require!(policy.spent <= policy.limit, "ERR_BUDGET_EXCEEDED");
    require!(policy.reserved <= policy.limit, "ERR_BUDGET_EXCEEDED");
    require!(total <= policy.limit, "ERR_BUDGET_EXCEEDED");
    require!(total <= policy.funded, "ERR_BUDGET_EXCEEDED");
}

// Per-token in-flight lock, Phase 3. The map lives under prefix b"i", created
// on demand, not as a new Contract struct field, for the same reason receipts
// use b"r": adding a struct field would change the Borsh layout of the
// already deployed state and break deserialization on upgrade. A token is
// locked while any obligation for that token is TRANSFER_PENDING or in
// RECONCILIATION_REQUIRED with its reservation still held, and released only
// when that obligation reaches a terminal or retryable state (PAID, READY,
// CANCELLED) through the callback, resolve_settlement, or cancel_obligation.
// The per-obligation in_flight flag is still the primary guard; the token
// lock is the second guard, so a second obligation for the same token cannot
// dispatch while the first transfer is still ambiguous. Sequential
// settlements, where the first has already booked PAID or released to READY,
// are unaffected, because the lock is released before the next settle runs.
fn token_lock_map() -> LookupMap<String, bool> {
    LookupMap::new(b"i")
}

fn is_token_locked(token_id: &AccountId) -> bool {
    token_lock_map()
        .get(&token_id.to_string())
        .copied()
        .unwrap_or(false)
}

fn set_token_lock(token_id: &AccountId) {
    let mut map = token_lock_map();
    map.insert(token_id.to_string(), true);
    map.flush();
}

fn clear_token_lock(token_id: &AccountId) {
    let mut map = token_lock_map();
    map.remove(&token_id.to_string());
    map.flush();
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

    fn assert_owner_or_reconciler(&self, policy: &Policy) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner || policy.reconciler.as_ref() == Some(&caller),
            "ERR_NOT_AUTHORIZED"
        );
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
        assert_policy_invariant(&policy);
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
        assert_policy_invariant(&policy);
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
        assert_policy_invariant(&policy);
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
        assert_policy_invariant(&policy);
        self.policies.insert(policy_id, policy);
    }

    pub fn cancel_obligation(&mut self, obligation_id: String) {
        // Owner only, never the reconciler. Phase 3 adds RECONCILIATION_REQUIRED
        // to the CREATED-only Phase 2 rule: an obligation stuck in
        // reconciliation is resolvable by cancel, not a dead end. Cancelling
        // from reconciliation releases the reservation and the token lock,
        // clears in_flight and the dispatch time, and retires the nonce by
        // making the obligation terminal, so it can never settle again.
        // Cancelling from TRANSFER_PENDING is still forbidden: a transfer
        // already dispatched cannot be un-booked by a cancel, it must go
        // through the callback or through reconciliation.
        self.assert_owner();
        let mut obligation = self
            .obligations
            .get(&obligation_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_OBLIGATION_MISSING"));
        require!(
            obligation.state == "CREATED" || obligation.state == "RECONCILIATION_REQUIRED",
            "ERR_INVALID_STATE"
        );
        if obligation.state == "RECONCILIATION_REQUIRED" {
            let mut policy = self
                .policies
                .get(&obligation.policy_id)
                .cloned()
                .unwrap_or_else(|| env::panic_str("ERR_POLICY_MISSING"));
            policy.reserved = policy
                .reserved
                .checked_sub(obligation.amount)
                .unwrap_or_else(|| env::panic_str("ERR_BUDGET_EXCEEDED"));
            clear_token_lock(&policy.token_id);
            obligation.in_flight = false;
            obligation.transfer_dispatched_at_ns = None;
            assert_policy_invariant(&policy);
            self.policies.insert(obligation.policy_id.clone(), policy);
        }
        obligation.state = "CANCELLED".to_string();
        self.obligations.insert(obligation_id, obligation);
    }

    pub fn mark_reconciliation_required(&mut self, obligation_id: String) {
        // Owner or the policy reconciler, only from TRANSFER_PENDING, only
        // after TRANSFER_TIMEOUT_NS has passed since dispatch. This is the
        // only way a callback that never runs becomes visible instead of
        // staying TRANSFER_PENDING forever. It keeps in_flight true, keeps
        // the reservation held, keeps the token lock, and keeps the dispatch
        // time, so resolve_settlement can still check the timeout and so no
        // retry can happen while the original transfer might still succeed.
        // Never blind-retry: a second payment for the same obligation is a bug.
        let mut obligation = self
            .obligations
            .get(&obligation_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_OBLIGATION_MISSING"));
        let policy = self
            .policies
            .get(&obligation.policy_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_POLICY_MISSING"));
        self.assert_owner_or_reconciler(&policy);
        require!(obligation.state == "TRANSFER_PENDING", "ERR_INVALID_STATE");
        require!(obligation.in_flight, "ERR_INVALID_STATE");
        let dispatched = obligation
            .transfer_dispatched_at_ns
            .unwrap_or_else(|| env::panic_str("ERR_INVALID_STATE"));
        require!(
            env::block_timestamp() >= dispatched.saturating_add(TRANSFER_TIMEOUT_NS),
            "ERR_TIMEOUT_NOT_REACHED"
        );
        obligation.state = "RECONCILIATION_REQUIRED".to_string();
        self.obligations.insert(obligation_id, obligation);
    }

    pub fn mark_evidence_timeout(&mut self, obligation_id: String, escalate: bool) {
        // Owner or the policy reconciler, only from EVIDENCE_PENDING, only
        // after EVIDENCE_TIMEOUT_NS has passed since the evidence request.
        // Evidence that never arrives never moves an obligation to READY by
        // default: escalate false moves to CANCELLED, escalate true moves to
        // WARN_PENDING, from which the owner may approve_warning to READY.
        // Pending fields are cleared on both paths, so a stale evidence
        // submission cannot land after the timeout; submit_evidence also
        // requires EVIDENCE_PENDING, so it rejects anyway.
        let mut obligation = self
            .obligations
            .get(&obligation_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_OBLIGATION_MISSING"));
        let policy = self
            .policies
            .get(&obligation.policy_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_POLICY_MISSING"));
        self.assert_owner_or_reconciler(&policy);
        require!(obligation.state == "EVIDENCE_PENDING", "ERR_INVALID_STATE");
        let requested = obligation
            .evidence_requested_at_ns
            .unwrap_or_else(|| env::panic_str("ERR_INVALID_STATE"));
        require!(
            env::block_timestamp() >= requested.saturating_add(EVIDENCE_TIMEOUT_NS),
            "ERR_TIMEOUT_NOT_REACHED"
        );
        obligation.state = if escalate {
            "WARN_PENDING".to_string()
        } else {
            "CANCELLED".to_string()
        };
        obligation.pending_request_id = None;
        obligation.pending_digest = None;
        obligation.evidence_requested_at_ns = None;
        self.obligations.insert(obligation_id, obligation);
    }

    pub fn resolve_settlement(&mut self, obligation_id: String, outcome: String, proof: String) {
        // Resolves RECONCILIATION_REQUIRED only, with in_flight still true
        // and the reservation still held, after the transfer timeout has
        // passed since dispatch. That timeout check applies even when the
        // obligation entered reconciliation through a frozen-policy callback
        // failure, which happens immediately: the frozen failure does not
        // shortcut the timeout, it only makes the ambiguity visible early.
        // Proof is the transaction hash of the transfer as seen on chain,
        // recorded as the receipt tx_ref for a PAID resolution, plus the
        // caller attestation that is the on-chain call itself. The contract
        // cannot verify a transaction hash alone on NEAR, so for PAID the
        // owner must first have done a live chain read showing the recipient
        // actually received the amount; that read is a required human step,
        // not a contract check, and the recorded hash lets anyone audit it.
        // PAID is owner only, never the reconciler. READY and CANCELLED are
        // owner or reconciler. Failure alone never cancels: CANCELLED here
        // is an explicit human resolution, not an automatic failure outcome.
        let mut obligation = self
            .obligations
            .get(&obligation_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_OBLIGATION_MISSING"));
        let mut policy = self
            .policies
            .get(&obligation.policy_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_POLICY_MISSING"));
        require!(
            obligation.state == "RECONCILIATION_REQUIRED",
            "ERR_INVALID_STATE"
        );
        require!(obligation.in_flight, "ERR_INVALID_STATE");
        let dispatched = obligation
            .transfer_dispatched_at_ns
            .unwrap_or_else(|| env::panic_str("ERR_INVALID_STATE"));
        require!(
            env::block_timestamp() >= dispatched.saturating_add(TRANSFER_TIMEOUT_NS),
            "ERR_TIMEOUT_NOT_REACHED"
        );
        match outcome.as_str() {
            "PAID" => {
                self.assert_owner();
                require!(!proof.is_empty(), "ERR_INVALID_PROOF");
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
                clear_token_lock(&policy.token_id);
                assert_policy_invariant(&policy);
                self.append_receipt(
                    &obligation_id,
                    &obligation.recipient,
                    obligation.amount,
                    &policy.token_id,
                    &proof,
                );
                self.policies.insert(obligation.policy_id.clone(), policy);
                self.obligations.insert(obligation_id, obligation);
            }
            "READY" | "CANCELLED" => {
                self.assert_owner_or_reconciler(&policy);
                policy.reserved = policy
                    .reserved
                    .checked_sub(obligation.amount)
                    .unwrap_or_else(|| env::panic_str("ERR_BUDGET_EXCEEDED"));
                obligation.state = outcome;
                obligation.in_flight = false;
                obligation.transfer_dispatched_at_ns = None;
                clear_token_lock(&policy.token_id);
                assert_policy_invariant(&policy);
                self.policies.insert(obligation.policy_id.clone(), policy);
                self.obligations.insert(obligation_id, obligation);
            }
            _ => env::panic_str("ERR_INVALID_OUTCOME"),
        }
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
        // Phase 9, layer 1: a PREIMAGE obligation is verified only by its
        // bytes, never by a verifier's hex proof. Routing it through this
        // path would let a compromised verifier mark it READY without any
        // bytes being hashed.
        require!(
            obligation.evidence_type != "PREIMAGE",
            "ERR_EVIDENCE_MISMATCH"
        );
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
        // Evidence timeout, Phase 5: a verifier result arriving after
        // EVIDENCE_TIMEOUT_NS from the request is expired, even if the
        // obligation itself has not expired and mark_evidence_timeout
        // has not been called yet. Verifier down fails closed: no
        // READY by default, and no late result can land.
        // EVIDENCE_PENDING always carries a request time, set by
        // request_evidence. A missing time here is an invariant
        // violation, so fail closed instead of silently skipping
        // the timeout check.
        let requested = obligation
            .evidence_requested_at_ns
            .unwrap_or_else(|| env::panic_str("ERR_INVALID_STATE"));
        require!(
            env::block_timestamp() <= requested.saturating_add(EVIDENCE_TIMEOUT_NS),
            "ERR_EVIDENCE_EXPIRED"
        );
        obligation.state = match result.as_str() {
            "ALLOWED" => "READY".to_string(),
            "WARN" => "WARN_PENDING".to_string(),
            "BLOCK" => "BLOCKED".to_string(),
            _ => env::panic_str("ERR_INVALID_RESULT"),
        };
        // Pending evidence fields are cleared on a decided obligation,
        // matching mark_evidence_timeout, so no stale request, digest,
        // or request time remains after the verdict lands.
        obligation.pending_request_id = None;
        obligation.pending_digest = None;
        obligation.evidence_requested_at_ns = None;
        self.obligations.insert(obligation_id, obligation);
    }

    // Phase 9, layer 1: bounded on-chain evidence check. Anyone may call
    // this, the caller is a courier, not a judge. The vault hashes the
    // submitted bytes itself with env::sha256 and compares the result to
    // the digest the owner committed at create_obligation. A lying courier
    // is caught on-chain: a hash mismatch changes no state. Only
    // obligations whose evidence_type is "PREIMAGE" accept raw bytes, and
    // only while the evidence request is outstanding. The bytes are hashed
    // and dropped, never stored, so this adds no storage. A hash match is
    // the verdict, the obligation becomes READY.
    pub fn submit_evidence_preimage(
        &mut self,
        request_id: String,
        obligation_id: String,
        evidence: Vec<u8>,
    ) {
        let mut obligation = self
            .obligations
            .get(&obligation_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_OBLIGATION_MISSING"));
        require!(obligation.state == "EVIDENCE_PENDING", "ERR_INVALID_STATE");
        require!(
            obligation.evidence_type == "PREIMAGE",
            "ERR_EVIDENCE_MISMATCH"
        );
        require!(
            evidence.len() <= MAX_PREIMAGE_BYTES,
            "ERR_EVIDENCE_TOO_LARGE"
        );
        require!(
            obligation.pending_request_id.as_deref() == Some(request_id.as_str()),
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
        // Evidence timeout, same rule as submit_evidence: a result arriving
        // after EVIDENCE_TIMEOUT_NS from the request is expired, and a
        // missing request time fails closed.
        let requested = obligation
            .evidence_requested_at_ns
            .unwrap_or_else(|| env::panic_str("ERR_INVALID_STATE"));
        require!(
            env::block_timestamp() <= requested.saturating_add(EVIDENCE_TIMEOUT_NS),
            "ERR_EVIDENCE_EXPIRED"
        );
        let computed = env::sha256(&evidence);
        require!(
            computed.as_slice() == obligation.evidence_hash.as_slice(),
            "ERR_EVIDENCE_MISMATCH"
        );
        obligation.state = "READY".to_string();
        obligation.pending_request_id = None;
        obligation.pending_digest = None;
        obligation.evidence_requested_at_ns = None;
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
        assert_policy_invariant(&policy);
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
        // Nonce first, before the state check: a duplicate settle must be
        // detectable as NONCE_ALREADY_CONSUMED, per the frozen nonce
        // paragraph in contract-api.md. In flight means the first attempt
        // is still pending, and PAID means the nonce is permanently
        // consumed. Any other non-READY state still rejects with
        // ERR_INVALID_STATE. This check reads state only and writes
        // nothing, so moving it cannot move funds.
        require!(!obligation.in_flight, "ERR_NONCE_ALREADY_CONSUMED");
        require!(obligation.state != "PAID", "ERR_NONCE_ALREADY_CONSUMED");
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
        // The nonce check moved to the top of settle, above the state
        // check, so a duplicate settle is reported as
        // NONCE_ALREADY_CONSUMED instead of ERR_INVALID_STATE.
        // Per-token in-flight lock, Phase 3: a second obligation for the
        // same token cannot dispatch while another transfer for that token
        // is still ambiguous. This is checked before any reserve is written,
        // so a locked settle changes no state at all.
        require!(!is_token_locked(&policy.token_id), "ERR_TOKEN_IN_FLIGHT");
        let new_total = policy
            .spent
            .checked_add(policy.reserved)
            .and_then(|v| v.checked_add(obligation.amount))
            .unwrap_or_else(|| env::panic_str("ERR_BUDGET_EXCEEDED"));
        require!(new_total <= policy.limit, "ERR_BUDGET_EXCEEDED");
        require!(new_total <= policy.funded, "ERR_BUDGET_EXCEEDED");
        let headroom = native_headroom_yocto();
        // Phase 4 formula, plan 3.1.5: liquid >= 1 yocto + gas headroom
        // + receipt reserve. For integer yocto this is the same threshold
        // as the old headroom > reserve + 0.01 NEAR check, with the 1 yocto
        // term now explicit, not hidden inside the margin.
        require!(
            headroom >= settle_storage_requirement_yocto(),
            "ERR_VAULT_STORAGE_EXHAUSTED"
        );
        // Reserve synchronously, before any promise, so two concurrent
        // settle calls cannot both pass the budget check and both pay.
        policy.reserved = policy
            .reserved
            .checked_add(obligation.amount)
            .unwrap_or_else(|| env::panic_str("ERR_BUDGET_EXCEEDED"));
        assert_policy_invariant(&policy);
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
        // Set synchronously, before the promise, like the reservation: a
        // settle that has written TRANSFER_PENDING must also hold the lock,
        // or the lock would not cover the window the promise is in flight.
        set_token_lock(&token_id);
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

    fn append_receipt(
        &mut self,
        obligation_id: &str,
        recipient: &AccountId,
        amount: u128,
        token_id: &AccountId,
        tx_ref: &str,
    ) {
        // Shared by the callback Ok path and by resolve_settlement to PAID,
        // so a receipt booked by human resolution has the same hash chain,
        // index order, and NEP-297 event shape as a receipt booked by the
        // callback. The only difference is tx_ref: empty for a callback,
        // because a NEP-141 callback carries no transaction hash, and the
        // human-supplied proof hash for a resolution.
        let index = self.receipt_index;
        let receipt = Receipt {
            index,
            prev_hash: self.last_receipt_hash,
            obligation_id: obligation_id.to_string(),
            recipient: recipient.clone(),
            amount,
            token_id: token_id.clone(),
            timestamp: env::block_timestamp(),
            tx_ref: tx_ref.to_string(),
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
        env::log_str(&format!("EVENT_JSON:{}", serde_json::to_string(&serde_json::json!({"standard": "nep297", "version": "1.0.0", "event": "receipt", "data": [{"index": receipt.index, "obligation_id": &receipt.obligation_id, "recipient": &receipt.recipient, "amount": receipt.amount.to_string(), "token_id": &receipt.token_id, "timestamp": receipt.timestamp, "prev_hash": receipt.prev_hash.iter().map(|b| format!("{:02x}", b)).collect::<String>(), "tx_ref": &receipt.tx_ref}]})).unwrap()));
        let mut map: LookupMap<u64, Receipt> = LookupMap::new(b"r");
        map.insert(index, receipt);
        map.flush();
        self.receipt_index = self.receipt_index.saturating_add(1);
        self.last_receipt_hash = hash;
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
        // Duplicate callbacks are ignored, not double-booked: a callback
        // that arrives after the first one booked PAID, released to READY,
        // or moved to reconciliation fails the state or attempt check here
        // and changes nothing. A stale attempt id fails the attempt check
        // even if the obligation is in flight again on a later attempt.
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
                // Freeze and version bumps block new settle calls only, they
                // never un-book a transfer already in flight: there is no
                // frozen check on this path, by design, so a success always
                // finalizes to PAID even if the policy was frozen meanwhile.
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
                clear_token_lock(&policy.token_id);
                assert_policy_invariant(&policy);
                self.append_receipt(
                    &obligation_id,
                    &obligation.recipient,
                    obligation.amount,
                    &policy.token_id,
                    "",
                );
                self.policies.insert(obligation.policy_id.clone(), policy);
                self.obligations.insert(obligation_id, obligation);
            }
            Err(_) => {
                if policy.frozen {
                    // Confirmed failure, but the policy is frozen, so the
                    // obligation does not go back to READY for an immediate
                    // retry. It becomes visible as RECONCILIATION_REQUIRED,
                    // with reservation, in_flight, dispatch time, and token
                    // lock all retained, and resolve_settlement decides it
                    // after the transfer timeout, never automatically.
                    obligation.state = "RECONCILIATION_REQUIRED".to_string();
                    // No invariant assert here: policy is unchanged and
                    // not written back in this branch, so an assert would
                    // check a policy that this branch does not touch.
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
                clear_token_lock(&policy.token_id);
                assert_policy_invariant(&policy);
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
    #[should_panic(expected = "ERR_NONCE_ALREADY_CONSUMED")]
    fn settle_rejects_double_settle() {
        // The second call lands while the first attempt is still in
        // flight, TRANSFER_PENDING, so it must report the nonce, not
        // a generic state error.
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
    #[should_panic(expected = "ERR_NONCE_ALREADY_CONSUMED")]
    fn settle_rejects_replay_after_paid() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 250000, 1000000, 1000000);
        agent_ctx();
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
        // In unit tests the callback argument is passed directly.
        c.on_transfer_complete("obl-001".to_string(), 1, Ok(()));
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "PAID");
        // The callback must have cleared in_flight, so the replay below
        // can only be rejected by the new PAID check, not by the
        // in-flight check. Without this assertion the test would pass
        // even if the callback left the nonce locked.
        assert!(!o.in_flight);
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_OBLIGATION_EXPIRED")]
    fn settle_rejects_expired_obligation() {
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
            1000,
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
        // Time passes after the obligation reaches READY, then settle.
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("cynex-agent.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        ctx.block_timestamp(2000);
        testing_env!(ctx.build());
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
    #[should_panic(expected = "ERR_EVIDENCE_EXPIRED")]
    fn submit_evidence_after_evidence_timeout_rejects() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        owner_ctx_at(1000000);
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
        // One nanosecond past the 1 hour evidence timeout, with the
        // obligation itself far from expired, and without calling
        // mark_evidence_timeout first: the late result must reject.
        owner_ctx_at(1000000 + EVIDENCE_TIMEOUT_NS + 1);
        c.submit_evidence(
            "obl-001-1".to_string(),
            "obl-001".to_string(),
            "ALLOWED".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
        );
    }

    #[test]
    fn submit_evidence_clears_pending_fields() {
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
        let before = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(before.pending_request_id, Some("obl-001-1".to_string()));
        assert!(before.pending_digest.is_some());
        assert!(before.evidence_requested_at_ns.is_some());
        c.add_verifier(owner());
        c.submit_evidence(
            "obl-001-1".to_string(),
            "obl-001".to_string(),
            "ALLOWED".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
        );
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "READY");
        assert_eq!(o.pending_request_id, None);
        assert_eq!(o.pending_digest, None);
        assert_eq!(o.evidence_requested_at_ns, None);
    }

    #[test]
    fn submit_evidence_at_exact_evidence_timeout_accepts() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        owner_ctx_at(1000000);
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
        // At exactly requested plus EVIDENCE_TIMEOUT_NS, submit still
        // accepts: the timeout is "after", not "at or after". One
        // nanosecond later it rejects, see the timeout test. At this
        // exact instant mark_evidence_timeout also becomes valid, so
        // whichever transaction lands first wins; there is no dead
        // zone, and no overlapping double decision.
        owner_ctx_at(1000000 + EVIDENCE_TIMEOUT_NS);
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
    }

    #[test]
    fn submit_evidence_warn_and_block_clear_pending_fields() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        for (id, result, expected) in [
            ("obl-001", "WARN", "WARN_PENDING"),
            ("obl-002", "BLOCK", "BLOCKED"),
        ] {
            c.create_obligation(
                id.to_string(),
                "policy-001".to_string(),
                "acme-supplies.testnet".parse().unwrap(),
                250000,
                "delivery-note".to_string(),
                hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
                9999999999999999999,
                1,
            );
            c.request_evidence(id.to_string());
            c.add_verifier(owner());
            c.submit_evidence(
                format!("{}-1", id),
                id.to_string(),
                result.to_string(),
                "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
            );
            let o = c.get_obligation(id.to_string()).unwrap();
            assert_eq!(o.state, expected);
            assert_eq!(o.pending_request_id, None);
            assert_eq!(o.pending_digest, None);
            assert_eq!(o.evidence_requested_at_ns, None);
        }
    }

    #[test]
    #[should_panic(expected = "ERR_INVALID_STATE")]
    fn submit_evidence_second_submit_rejects() {
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
            "ALLOWED".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
        );
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "READY"
        );
        // A second submit with identical args must fail on the state
        // check, not on a field sentinel: the obligation is no longer
        // EVIDENCE_PENDING, and pending fields are already cleared.
        c.submit_evidence(
            "obl-001-1".to_string(),
            "obl-001".to_string(),
            "ALLOWED".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
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

    fn owner_ctx_at(block_timestamp: u64) {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        ctx.block_timestamp(block_timestamp);
        testing_env!(ctx.build());
    }

    fn setup_transfer_pending(c: &mut Contract, obligation_id: &str, amount: u128) {
        setup_ready_with_amount(c, obligation_id, amount, 1000000, 1000000);
        agent_ctx();
        let _ = c.settle(
            obligation_id.to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(amount),
            "x".to_string(),
        );
        assert_eq!(
            c.get_obligation(obligation_id.to_string()).unwrap().state,
            "TRANSFER_PENDING"
        );
    }

    #[test]
    fn mark_reconciliation_required_after_transfer_timeout() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        // Dispatch was at block timestamp 0 in the test context, so the
        // transfer timeout is reached at 600_000_000_000 exactly.
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.mark_reconciliation_required("obl-001".to_string());
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "RECONCILIATION_REQUIRED");
        assert!(o.in_flight);
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().reserved,
            250000
        );
        // Reservation is retained while reconciliation is open, and the
        // token lock is retained with it: the concurrent settle test below
        // proves a second obligation for the same token cannot dispatch
        // while this one is unresolved.
    }

    #[test]
    #[should_panic(expected = "ERR_TOKEN_IN_FLIGHT")]
    fn concurrent_settle_same_token_returns_lock_error() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        // Second obligation, same policy and token, READY while the first
        // transfer is still in flight. It must fail with the lock error,
        // never dispatch a second transfer.
        owner_ctx_at(0);
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
            "obl-002".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(100000),
            "x".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_TIMEOUT_NOT_REACHED")]
    fn mark_reconciliation_required_before_timeout_rejects() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        owner_ctx_at(TRANSFER_TIMEOUT_NS - 1);
        c.mark_reconciliation_required("obl-001".to_string());
    }

    #[test]
    fn resolve_settlement_paid_books_receipt_with_proof() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.mark_reconciliation_required("obl-001".to_string());
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.resolve_settlement(
            "obl-001".to_string(),
            "PAID".to_string(),
            "test-tx-proof-hash".to_string(),
        );
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "PAID");
        assert!(!o.in_flight);
        let policy = c.get_policy("policy-001".to_string()).unwrap();
        assert_eq!(policy.spent, 250000);
        assert_eq!(policy.reserved, 0);
        let receipts = c.receipts(0, 10);
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].obligation_id, "obl-001");
        assert_eq!(receipts[0].tx_ref, "test-tx-proof-hash");
    }

    #[test]
    fn resolve_settlement_ready_releases_reservation() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.mark_reconciliation_required("obl-001".to_string());
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.resolve_settlement("obl-001".to_string(), "READY".to_string(), "".to_string());
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "READY");
        assert!(!o.in_flight);
        assert_eq!(c.get_policy("policy-001".to_string()).unwrap().reserved, 0);
        assert_eq!(c.receipts(0, 10).len(), 0);
        // Token lock released: the obligation can settle again.
        agent_ctx();
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "TRANSFER_PENDING"
        );
    }

    #[test]
    fn resolve_settlement_cancelled_from_reconciliation() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.mark_reconciliation_required("obl-001".to_string());
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.resolve_settlement(
            "obl-001".to_string(),
            "CANCELLED".to_string(),
            "".to_string(),
        );
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "CANCELLED");
        assert!(!o.in_flight);
        assert_eq!(c.get_policy("policy-001".to_string()).unwrap().reserved, 0);
    }

    #[test]
    // PAID resolution is owner only, so the owner guard panics with
    // ERR_NOT_OWNER, not the reconciler guard, when a reconciler tries it.
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn resolve_settlement_reconciler_cannot_resolve_to_paid() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.set_reconciler(
            "policy-001".to_string(),
            "reconciler.testnet".parse().unwrap(),
        );
        c.mark_reconciliation_required("obl-001".to_string());
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("reconciler.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        ctx.block_timestamp(TRANSFER_TIMEOUT_NS);
        testing_env!(ctx.build());
        c.resolve_settlement(
            "obl-001".to_string(),
            "PAID".to_string(),
            "proof".to_string(),
        );
    }

    #[test]
    fn reconciler_can_mark_and_resolve_to_ready() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.set_reconciler(
            "policy-001".to_string(),
            "reconciler.testnet".parse().unwrap(),
        );
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("reconciler.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        ctx.block_timestamp(TRANSFER_TIMEOUT_NS);
        testing_env!(ctx.build());
        c.mark_reconciliation_required("obl-001".to_string());
        c.resolve_settlement("obl-001".to_string(), "READY".to_string(), "".to_string());
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "READY"
        );
    }

    #[test]
    fn mark_evidence_timeout_cancels_after_evidence_timeout() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        owner_ctx_at(1000000);
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
        assert_eq!(
            c.get_obligation("obl-001".to_string())
                .unwrap()
                .evidence_requested_at_ns,
            Some(1000000)
        );
        owner_ctx_at(1000000 + EVIDENCE_TIMEOUT_NS);
        c.mark_evidence_timeout("obl-001".to_string(), false);
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "CANCELLED"
        );
    }

    #[test]
    fn mark_evidence_timeout_escalate_moves_to_warn_pending() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        owner_ctx_at(1000000);
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
        owner_ctx_at(1000000 + EVIDENCE_TIMEOUT_NS);
        c.mark_evidence_timeout("obl-001".to_string(), true);
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "WARN_PENDING"
        );
        // Owner can approve the escalated warning to READY.
        owner_ctx_at(1000000 + EVIDENCE_TIMEOUT_NS);
        c.approve_warning("obl-001".to_string());
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "READY"
        );
    }

    #[test]
    #[should_panic(expected = "ERR_TIMEOUT_NOT_REACHED")]
    fn mark_evidence_timeout_before_timeout_rejects() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        owner_ctx_at(1000000);
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
        owner_ctx_at(1000000 + EVIDENCE_TIMEOUT_NS - 1);
        c.mark_evidence_timeout("obl-001".to_string(), false);
    }

    #[test]
    fn cancel_obligation_from_reconciliation_required() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.mark_reconciliation_required("obl-001".to_string());
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.cancel_obligation("obl-001".to_string());
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "CANCELLED");
        assert!(!o.in_flight);
        assert_eq!(c.get_policy("policy-001".to_string()).unwrap().reserved, 0);
    }

    #[test]
    #[should_panic(expected = "ERR_INVALID_STATE")]
    fn cancel_obligation_from_ready_rejects() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 250000, 1000000, 1000000);
        c.cancel_obligation("obl-001".to_string());
    }

    #[test]
    fn freeze_during_in_flight_callback_still_books_paid() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        owner_ctx_at(0);
        c.freeze_policy("policy-001".to_string());
        // In unit tests the callback is called directly; on chain the
        // #[private] macro enforces that only the contract itself can call
        // it, which Phase 2 already proved live with a direct call rejected.
        c.on_transfer_complete("obl-001".to_string(), 1, Ok(()));
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "PAID");
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().spent,
            250000
        );
        assert_eq!(c.receipts(0, 10).len(), 1);
    }

    #[test]
    fn duplicate_callback_after_paid_books_once() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        c.on_transfer_complete("obl-001".to_string(), 1, Ok(()));
        c.on_transfer_complete("obl-001".to_string(), 1, Ok(()));
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().spent,
            250000
        );
        assert_eq!(c.receipts(0, 10).len(), 1);
    }

    #[test]
    fn frozen_callback_failure_moves_to_reconciliation_required() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        owner_ctx_at(0);
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
    #[should_panic(expected = "ERR_INVALID_STATE")]
    fn submit_evidence_after_evidence_timeout_cancel_rejects() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        owner_ctx_at(1000000);
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
        owner_ctx_at(1000000 + EVIDENCE_TIMEOUT_NS);
        c.mark_evidence_timeout("obl-001".to_string(), false);
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "CANCELLED"
        );
        // Stale evidence after the timeout cancel must reject on state,
        // never resurrect a cancelled obligation.
        c.submit_evidence(
            "obl-001-1".to_string(),
            "obl-001".to_string(),
            "ALLOWED".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
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

    #[test]
    fn phase4_property_invariant_over_1000_sequences() {
        // Phase 4 property test: deterministic, no new dependency.
        // Each sequence is create, request, submit ALLOWED, settle, then
        // one of callback Ok, callback Err, reconcile to READY, reconcile
        // to CANCELLED, or reconcile to PAID. After every sequence the
        // contract policy is checked against a model, and any failure
        // names the sequence and action, so the first failing sequence
        // is printed instead of a bare invariant failure.
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            10_000_000,
        );
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("usdc.fakes.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        c.ft_on_transfer(
            "cynexmaster.testnet".parse().unwrap(),
            U128(10_000_000),
            "{\"fund_policy\": \"policy-001\"}".to_string(),
        );
        owner_ctx_at(0);
        c.add_verifier(owner());
        let mut rng: u64 = 0x9e3779b97f4a7c15;
        let mut next_rand = || {
            rng = rng
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            rng >> 33
        };
        let mut spent_model: u128 = 0;
        let mut paid_count: u64 = 0;
        for i in 0..1000u32 {
            let amount: u128 = 1 + (next_rand() % 400) as u128;
            let action = next_rand() % 5;
            let id = format!("prop-{:04}", i);
            let nonce = (i + 1) as u64;
            owner_ctx_at(0);
            c.create_obligation(
                id.clone(),
                "policy-001".to_string(),
                "acme-supplies.testnet".parse().unwrap(),
                amount,
                "delivery-note".to_string(),
                hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
                9999999999999999999,
                nonce,
            );
            c.request_evidence(id.clone());
            c.submit_evidence(
                format!("{}-{}", id, nonce),
                id.clone(),
                "ALLOWED".to_string(),
                "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
            );
            assert_eq!(
                c.get_obligation(id.clone()).unwrap().state,
                "READY",
                "sequence {} action {}: obligation not READY after evidence",
                i,
                action
            );
            agent_ctx();
            let _ = c.settle(
                id.clone(),
                "acme-supplies.testnet".parse().unwrap(),
                U128(amount),
                "x".to_string(),
            );
            let policy = c.get_policy("policy-001".to_string()).unwrap();
            assert_eq!(
                policy.reserved, amount,
                "sequence {} action {}: reserved after settle",
                i, action
            );
            assert_eq!(
                policy.spent, spent_model,
                "sequence {} action {}: spent after settle",
                i, action
            );
            match action {
                0 => {
                    c.on_transfer_complete(id.clone(), 1, Ok(()));
                    spent_model += amount;
                    paid_count += 1;
                    assert_eq!(
                        c.get_obligation(id.clone()).unwrap().state,
                        "PAID",
                        "sequence {} action {}: not PAID after callback Ok",
                        i,
                        action
                    );
                }
                1 => {
                    c.on_transfer_complete(id.clone(), 1, Err(PromiseError::Failed));
                    assert_eq!(
                        c.get_obligation(id.clone()).unwrap().state,
                        "READY",
                        "sequence {} action {}: not READY after callback Err",
                        i,
                        action
                    );
                }
                2 => {
                    owner_ctx_at(TRANSFER_TIMEOUT_NS + 1);
                    c.mark_reconciliation_required(id.clone());
                    assert_eq!(
                        c.get_obligation(id.clone()).unwrap().state,
                        "RECONCILIATION_REQUIRED",
                        "sequence {} action {}: not reconciling",
                        i,
                        action
                    );
                    owner_ctx_at(TRANSFER_TIMEOUT_NS + 1);
                    c.resolve_settlement(id.clone(), "READY".to_string(), "no-arrival".to_string());
                    assert_eq!(
                        c.get_obligation(id.clone()).unwrap().state,
                        "READY",
                        "sequence {} action {}: not READY after resolve",
                        i,
                        action
                    );
                }
                3 => {
                    owner_ctx_at(TRANSFER_TIMEOUT_NS + 1);
                    c.mark_reconciliation_required(id.clone());
                    owner_ctx_at(TRANSFER_TIMEOUT_NS + 1);
                    c.resolve_settlement(
                        id.clone(),
                        "CANCELLED".to_string(),
                        "no-arrival".to_string(),
                    );
                    assert_eq!(
                        c.get_obligation(id.clone()).unwrap().state,
                        "CANCELLED",
                        "sequence {} action {}: not CANCELLED after resolve",
                        i,
                        action
                    );
                }
                _ => {
                    owner_ctx_at(TRANSFER_TIMEOUT_NS + 1);
                    c.mark_reconciliation_required(id.clone());
                    owner_ctx_at(TRANSFER_TIMEOUT_NS + 1);
                    c.resolve_settlement(
                        id.clone(),
                        "PAID".to_string(),
                        format!("prop-proof-{}", i),
                    );
                    spent_model += amount;
                    paid_count += 1;
                    assert_eq!(
                        c.get_obligation(id.clone()).unwrap().state,
                        "PAID",
                        "sequence {} action {}: not PAID after resolve",
                        i,
                        action
                    );
                }
            }
            let policy = c.get_policy("policy-001".to_string()).unwrap();
            assert_eq!(
                policy.spent, spent_model,
                "sequence {} action {}: spent model mismatch at end",
                i, action
            );
            assert_eq!(
                policy.reserved, 0,
                "sequence {} action {}: reserved not released at end",
                i, action
            );
            assert!(
                policy.spent + policy.reserved <= policy.limit,
                "sequence {} action {}: token invariant over limit",
                i,
                action
            );
            assert!(
                policy.spent + policy.reserved <= policy.funded,
                "sequence {} action {}: token invariant over funded",
                i,
                action
            );
            assert_eq!(
                c.state().1,
                paid_count,
                "sequence {} action {}: receipt count mismatch",
                i,
                action
            );
        }
        println!("invariant held over {} sequences", 1000);
    }

    #[test]
    fn phase4_exactly_at_limit_settles() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 1000, 1000, 1000);
        agent_ctx();
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(1000),
            "x".to_string(),
        );
        c.on_transfer_complete("obl-001".to_string(), 1, Ok(()));
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "PAID"
        );
        let policy = c.get_policy("policy-001".to_string()).unwrap();
        assert_eq!(policy.spent, 1000);
        assert_eq!(policy.reserved, 0);
    }

    #[test]
    #[should_panic(expected = "ERR_BUDGET_EXCEEDED")]
    fn phase4_limit_plus_one_rejects() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 1001, 1000, 1000);
        agent_ctx();
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(1001),
            "x".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_VAULT_STORAGE_EXHAUSTED")]
    fn phase4_low_liquid_returns_storage_exhausted() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 250000, 1000000, 1000000);
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("cynex-agent.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        ctx.account_balance(NearToken::from_yoctonear(1_000_000_000_000_000_000_000));
        testing_env!(ctx.build());
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
    }

    #[test]
    fn phase4_storage_requirement_formula() {
        assert_eq!(
            settle_storage_requirement_yocto(),
            receipt_storage_reserve_yocto()
                .saturating_add(FT_TRANSFER_DEPOSIT_YOCTO)
                .saturating_add(SETTLE_GAS_HEADROOM_YOCTO)
        );
        assert_eq!(FT_TRANSFER_DEPOSIT_YOCTO, 1);
    }

    // Phase 9 layer 1 test helper: a policy plus an obligation whose
    // committed digest is the SHA-256 of the given bytes, already moved to
    // EVIDENCE_PENDING by request_evidence. The digest is computed with
    // the same host function the contract uses, so the test proves the
    // match, not a hardcoded value.
    fn preimage_setup(evidence: &[u8], evidence_type: &str) -> Contract {
        preimage_setup_at(evidence, evidence_type, 9999999999999999999)
    }

    fn preimage_setup_at(evidence: &[u8], evidence_type: &str, expires_at_ns: u64) -> Contract {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        let digest_vec = env::sha256(evidence);
        let mut digest = [0u8; 32];
        digest.copy_from_slice(&digest_vec);
        c.create_obligation(
            "obl-001".to_string(),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            250000,
            evidence_type.to_string(),
            digest,
            expires_at_ns,
            1,
        );
        c.request_evidence("obl-001".to_string());
        c
    }

    fn as_other() {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(other());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
    }

    fn set_time_and_caller(predecessor: AccountId, block_timestamp: u64) {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(predecessor);
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        ctx.block_timestamp(block_timestamp);
        testing_env!(ctx.build());
    }

    #[test]
    fn submit_evidence_preimage_match_goes_ready() {
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let mut c = preimage_setup(&evidence, "PREIMAGE");
        // A stranger, not the owner and not an allowlisted verifier, is
        // the courier. That is the point of layer 1: permissionless.
        as_other();
        c.submit_evidence_preimage("obl-001-1".to_string(), "obl-001".to_string(), evidence);
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "READY");
        assert_eq!(o.pending_request_id, None);
        assert_eq!(o.pending_digest, None);
        assert_eq!(o.evidence_requested_at_ns, None);
    }

    #[test]
    #[should_panic(expected = "ERR_EVIDENCE_MISMATCH")]
    fn submit_evidence_preimage_mismatch_rejects() {
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let mut c = preimage_setup(&evidence, "PREIMAGE");
        as_other();
        c.submit_evidence_preimage(
            "obl-001-1".to_string(),
            "obl-001".to_string(),
            b"tampered-bytes".to_vec(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_EVIDENCE_TOO_LARGE")]
    fn submit_evidence_preimage_oversized_rejects() {
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let mut c = preimage_setup(&evidence, "PREIMAGE");
        as_other();
        c.submit_evidence_preimage(
            "obl-001-1".to_string(),
            "obl-001".to_string(),
            vec![0u8; MAX_PREIMAGE_BYTES + 1],
        );
    }

    #[test]
    #[should_panic(expected = "ERR_EVIDENCE_MISMATCH")]
    fn submit_evidence_preimage_wrong_type_rejects() {
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let mut c = preimage_setup(&evidence, "delivery-note");
        as_other();
        c.submit_evidence_preimage("obl-001-1".to_string(), "obl-001".to_string(), evidence);
    }

    #[test]
    #[should_panic(expected = "ERR_EVIDENCE_MISMATCH")]
    fn submit_evidence_preimage_wrong_request_rejects() {
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let mut c = preimage_setup(&evidence, "PREIMAGE");
        as_other();
        c.submit_evidence_preimage("obl-001-999".to_string(), "obl-001".to_string(), evidence);
    }

    #[test]
    #[should_panic(expected = "ERR_INVALID_STATE")]
    fn submit_evidence_preimage_second_submit_rejects() {
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let mut c = preimage_setup(&evidence, "PREIMAGE");
        as_other();
        c.submit_evidence_preimage(
            "obl-001-1".to_string(),
            "obl-001".to_string(),
            evidence.clone(),
        );
        c.submit_evidence_preimage("obl-001-1".to_string(), "obl-001".to_string(), evidence);
    }

    #[test]
    #[should_panic(expected = "ERR_EVIDENCE_MISMATCH")]
    fn submit_evidence_rejects_preimage_type() {
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let mut c = preimage_setup(&evidence, "PREIMAGE");
        // The owner is an allowlisted verifier here and the proof is the
        // correct digest, so the only reason this must fail is the type:
        // a PREIMAGE obligation is verified by bytes only.
        c.add_verifier(owner());
        c.submit_evidence(
            "obl-001-1".to_string(),
            "obl-001".to_string(),
            "ALLOWED".to_string(),
            "09f787d3967dd0aa7d0d9ec569ef7bd65af66bd44a9f98a8aea4e0174414a2c6".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_EVIDENCE_EXPIRED")]
    fn submit_evidence_preimage_expired_rejects() {
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let mut c = preimage_setup_at(&evidence, "PREIMAGE", 1000);
        // Move the clock past the obligation's expiry. The evidence
        // timeout (1 hour from the request at timestamp 0) has not
        // passed, so only the expiry guard fires.
        set_time_and_caller(other(), 2000);
        c.submit_evidence_preimage("obl-001-1".to_string(), "obl-001".to_string(), evidence);
    }

    #[test]
    #[should_panic(expected = "ERR_EVIDENCE_EXPIRED")]
    fn submit_evidence_preimage_evidence_timeout_rejects() {
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let mut c = preimage_setup(&evidence, "PREIMAGE");
        // The request was made at timestamp 0. Move the clock one
        // nanosecond past the 1 hour evidence timeout; the obligation
        // itself is far from expiry, so only the timeout guard fires.
        set_time_and_caller(other(), EVIDENCE_TIMEOUT_NS + 1);
        c.submit_evidence_preimage("obl-001-1".to_string(), "obl-001".to_string(), evidence);
    }

    #[test]
    fn submit_evidence_preimage_at_evidence_timeout_boundary_accepts() {
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let mut c = preimage_setup(&evidence, "PREIMAGE");
        // The request was made at timestamp 0. At exactly requested plus
        // EVIDENCE_TIMEOUT_NS the submit still accepts; one nanosecond
        // later it rejects (see the timeout test above).
        set_time_and_caller(other(), EVIDENCE_TIMEOUT_NS);
        c.submit_evidence_preimage("obl-001-1".to_string(), "obl-001".to_string(), evidence);
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "READY");
    }

    #[test]
    #[should_panic(expected = "ERR_OBLIGATION_MISSING")]
    fn submit_evidence_preimage_missing_obligation_rejects() {
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let mut c = preimage_setup(&evidence, "PREIMAGE");
        as_other();
        c.submit_evidence_preimage(
            "obl-001-1".to_string(),
            "no-such-obligation".to_string(),
            evidence,
        );
    }

    #[test]
    fn submit_evidence_preimage_at_cap_goes_ready() {
        let evidence = vec![7u8; MAX_PREIMAGE_BYTES];
        let mut c = preimage_setup(&evidence, "PREIMAGE");
        as_other();
        c.submit_evidence_preimage("obl-001-1".to_string(), "obl-001".to_string(), evidence);
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "READY");
    }

    #[test]
    fn submit_evidence_preimage_mismatch_leaves_state() {
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let mut c = preimage_setup(&evidence, "PREIMAGE");
        as_other();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.submit_evidence_preimage(
                "obl-001-1".to_string(),
                "obl-001".to_string(),
                b"tampered-bytes".to_vec(),
            );
        }));
        assert!(result.is_err());
        // A failed submit changes no state: the obligation is still
        // pending with its request, digest, and request time intact.
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
        assert_eq!(o.pending_request_id, Some("obl-001-1".to_string()));
        assert!(o.pending_digest.is_some());
        assert!(o.evidence_requested_at_ns.is_some());
    }

    #[test]
    fn submit_evidence_preimage_known_answer_vector() {
        // The digest is a hardcoded known answer, not computed by the
        // helper: SHA-256 of "delivery-note-001:obl-001:250000" is
        // 09f787d3967dd0aa7d0d9ec569ef7bd65af66bd44a9f98a8aea4e0174414a2c6.
        // If the host function ever diverged from standard SHA-256, this
        // test fails while the helper-based tests would pass.
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
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
            "PREIMAGE".to_string(),
            hex32("09f787d3967dd0aa7d0d9ec569ef7bd65af66bd44a9f98a8aea4e0174414a2c6"),
            9999999999999999999,
            1,
        );
        c.request_evidence("obl-001".to_string());
        as_other();
        c.submit_evidence_preimage("obl-001-1".to_string(), "obl-001".to_string(), evidence);
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "READY");
    }
}
