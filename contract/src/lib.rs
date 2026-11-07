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
pub struct TeeRequest {
    pub obligation_id: String,
    pub evidence_url: String,
    pub seed: String,
    pub requested_at_ns: u64,
    pub sender: AccountId,
}

// Decode a hex string to bytes. Returns None on any bad input (odd
// length, non-hex digit). Used to parse the guest's hex fields.
fn hex_decode(s: &str) -> Option<Vec<u8>> {
    let bytes = s.as_bytes();
    if !bytes.len().is_multiple_of(2) {
        return None;
    }
    let digit = |b: u8| match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    };
    let mut out = Vec::with_capacity(bytes.len() / 2);
    let (pairs, _) = bytes.as_chunks::<2>();
    for pair in pairs {
        let hi = digit(pair[0])?;
        let lo = digit(pair[1])?;
        out.push((hi << 4) | lo);
    }
    Some(out)
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

// A monotonically increasing counter for TEE requests, stored under
// its own trie prefix so the Contract struct is unchanged and no
// migration is needed. Each filed request takes the next value, so
// two requests for the same obligation always derive different seeds
// even when they land in the same block and share a timestamp.
fn next_tee_request_counter() -> u64 {
    let mut map: LookupMap<String, u64> = LookupMap::new(b"u");
    let next = map
        .get(&"tee_request_counter".to_string())
        .copied()
        .unwrap_or(0);
    map.insert("tee_request_counter".to_string(), next + 1);
    next
}

// Verify a TEE guest output against the obligation and the recorded
// request. All three checks must pass: the digest matches the committed
// evidence hash (layer 1 integrity), the guest fetched from the claimed
// source (layer 2 provenance), and the VRF signature verifies against
// the published key with the alpha bound to this request (layer 3
// anchor). Returns false on any failure; the caller leaves the
// obligation pending. The per-execution TDX quote is not verified here:
// the contract runtime has no quote verification primitive, so the
// quote is verified off-chain (the attestation endpoint serves real
// quotes, verified live for requests 10522 and 10640 with matching
// input and output hashes) and the VRF signature is the on-chain
// anchor. The guest build itself is pinned by version_key in the
// request, so the quote and the VRF both describe the same pinned code.
fn verify_tee_output(obligation: &Obligation, tee: &TeeRequest, value: &serde_json::Value) -> bool {
    let digest_hex = match value.get("digest").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return false,
    };
    let digest = match hex_decode(digest_hex) {
        Some(b) if b.len() == 32 => b,
        _ => return false,
    };
    if digest.as_slice() != obligation.evidence_hash.as_slice() {
        return false;
    }
    let source = match value.get("source").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return false,
    };
    if source != tee.evidence_url {
        return false;
    }
    let alpha = match value.get("vrf_alpha").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return false,
    };
    let signature_hex = match value.get("vrf_signature").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return false,
    };
    let output_hex = match value.get("vrf_output").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return false,
    };
    let signature_vec = match hex_decode(signature_hex) {
        Some(b) if b.len() == 64 => b,
        _ => return false,
    };
    let signature: [u8; 64] = match signature_vec.try_into() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let output = match hex_decode(output_hex) {
        Some(b) if b.len() == 32 => b,
        _ => return false,
    };
    // The alpha is "vrf:{request_id}:{sender}:{seed}". Split into at
    // most four parts so a seed containing ':' still parses. The sender
    // is the transaction signer who filed the request (the owner), not
    // the vault itself: OutLayer stores sender_id (signer) and
    // predecessor_id (caller) separately and the VRF uses the signer,
    // proven live on request 10522 where sender_id was
    // cynexmaster.testnet and predecessor_id was the test vault. The
    // seed must be the one recorded for this obligation. The request id
    // is the one the guest reported; a wrong one fails the signature
    // check below, because the host signed the real request id.
    let parts: Vec<&str> = alpha.splitn(4, ':').collect();
    if parts.len() != 4 || parts[0] != "vrf" {
        return false;
    }
    if parts[1].parse::<u64>().is_err() {
        return false;
    }
    if parts[2] != tee.sender.as_str() {
        return false;
    }
    if parts[3] != tee.seed {
        return false;
    }
    // The signature must verify against the published VRF key, and the
    // output must be SHA-256 of the signature.
    if !env::ed25519_verify(&signature, alpha.as_bytes(), &VRF_PUBLIC_KEY) {
        return false;
    }
    if env::sha256(signature).as_slice() != output.as_slice() {
        return false;
    }
    true
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
    // sha256 always returns 32 bytes, so the default is unreachable.
    // unwrap_or_default instead of expect keeps every caller, including
    // the transfer callback, categorically free of panics.
    let hash: [u8; 32] = env::sha256(&buf).try_into().unwrap_or_default();
    hash
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
// Cap on confirmed failed transfer dispatches per obligation. After
// this many failures the obligation escalates to
// RECONCILIATION_REQUIRED instead of returning to READY, so a
// compromised agent cannot loop settle on an unregistered recipient
// and burn the vault's native headroom. The human owner then decides:
// resolve, cancel, or a fresh obligation. The cap counts dispatches
// (transfer_attempt), and a confirmed failure is the callback Err
// path, which proves the transfer did not land.
const MAX_TRANSFER_ATTEMPTS: u64 = 3;

// Phase 9, layer 1: the largest evidence blob the vault will hash
// on-chain for a PREIMAGE obligation. The bytes arrive as a JSON
// number array, so a larger cap would bloat the call arguments.
// Oversized evidence keeps the TRUSTED_RELAYER path. The bytes are
// hashed and dropped, never stored.
const MAX_PREIMAGE_BYTES: usize = 65_536;
// The only evidence type verified by the allowlisted verifier path
// (submit_evidence, TRUSTED_RELAYER). PREIMAGE and TEE each have their
// own verification path and are rejected there. Any other string is not
// a known type and fails closed at creation.
const VERIFIER_EVIDENCE_TYPE: &str = "delivery-note";

// Phase 9, layers 2 and 3: OutLayer TEE verification, testnet only. The
// vault calls the OutLayer contract to run the verifier guest in the TEE,
// and the guest output returns through a private callback.
const OUTLAYER_CONTRACT: &str = "outlayer.testnet";
const OUTLAYER_PROJECT_ID: &str = "cynexmaster.testnet/cynex-verifier";
// The pinned guest version for the project above: the active version's
// full wasm hash, confirmed live on testnet (list_versions on
// outlayer.testnet, is_active true). Pinning it means an execution runs
// exactly this guest build, never whatever version is active later. A
// new guest build needs a new pinned hash here, plus a redeploy: the
// pin is the point, it must not silently follow.
const OUTLAYER_VERSION_KEY: &str =
    "8abfe08bc62919dd3f0aea2c2ea5dbe91d5484c14d6a55289053dce1d0387a6f";
// Attached deposit for request_execution. A small execution costs about
// 0.001 to 0.002 NEAR; the excess is refunded to the vault.
const TEE_REQUEST_DEPOSIT_YOCTO: u128 = 10_000_000_000_000_000_000_000;
const TEE_REQUEST_GAS: Gas = Gas::from_tgas(100);
const TEE_CALLBACK_GAS: Gas = Gas::from_tgas(50);
// The OutLayer VRF public key for TESTNET, published at
// https://testnet-api.outlayer.ai/vrf/pubkey. Testnet and mainnet have
// different keys; the mainnet key (api.outlayer.ai) does NOT verify a
// testnet signature.
const VRF_PUBLIC_KEY: [u8; 32] = [
    192, 197, 174, 174, 22, 136, 194, 247, 204, 35, 80, 170, 225, 238, 60, 233, 110, 221, 192, 222,
    132, 214, 120, 219, 135, 61, 228, 130, 104, 248, 207, 168,
];

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
    // sha256 always returns 32 bytes, so the default is unreachable.
    // unwrap_or_default instead of expect keeps every caller, including
    // the transfer callback, categorically free of panics.
    let hash: [u8; 32] = env::sha256(&buf).try_into().unwrap_or_default();
    hash
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

// Shared guard for the two ways out of RECONCILIATION_REQUIRED:
// resolve_settlement and cancel_obligation. The transfer may still be
// in flight until TRANSFER_TIMEOUT_NS has passed since dispatch, so
// neither path may release the reservation or the token lock early.
// One function, so the two paths cannot drift apart again.
fn require_transfer_timeout_elapsed(obligation: &Obligation) {
    require!(obligation.in_flight, "ERR_INVALID_STATE");
    let dispatched = obligation
        .transfer_dispatched_at_ns
        .unwrap_or_else(|| env::panic_str("ERR_INVALID_STATE"));
    require!(
        env::block_timestamp() >= dispatched.saturating_add(TRANSFER_TIMEOUT_NS),
        "ERR_TIMEOUT_NOT_REACHED"
    );
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

// Obligations whose ambiguous transfer was human-resolved to READY.
// resolve_settlement to READY attests the transfer failed, but the
// contract cannot verify that on chain: a transfer that actually
// succeeded while its callback was lost would be paid twice if the
// obligation settled again. So a READY-resolved obligation never
// settles again; a genuine retry needs a fresh obligation with a fresh
// nonce. The set lives under its own trie prefix, like the receipt and
// token-lock maps, so the Contract struct is unchanged and no migration
// is needed. This is separate from the callback failure path: a
// callback Err proves the transfer failed, so that READY return stays
// retryable up to MAX_TRANSFER_ATTEMPTS.
fn resolved_ready_map() -> LookupMap<String, bool> {
    LookupMap::new(b"y")
}

fn mark_resolved_ready(obligation_id: &str) {
    let mut map = resolved_ready_map();
    map.insert(obligation_id.to_string(), true);
}

fn was_resolved_ready(obligation_id: &str) -> bool {
    resolved_ready_map()
        .get(&obligation_id.to_string())
        .copied()
        .unwrap_or(false)
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

// The OutLayer request_execution arguments for a TEE verification.
// Split out so unit tests can check the pinned version without
// driving a promise: request_tee_verification returns a Promise,
// whose arguments are not inspectable in a unit test.
fn outlayer_request_args(evidence_url: &str, seed: &str) -> Vec<u8> {
    let input = serde_json::to_string(&serde_json::json!({
        "url": evidence_url,
        "seed": seed,
    }))
    .unwrap();
    serde_json::to_vec(&serde_json::json!({
        "source": {
            "Project": {
                "project_id": OUTLAYER_PROJECT_ID,
                "version_key": OUTLAYER_VERSION_KEY,
            }
        },
        "resource_limits": {
            "max_instructions": 1_000_000_000u64,
            "max_memory_mb": 128u32,
            "max_execution_seconds": 60u64,
        },
        "input_data": input,
        "secrets_ref": null,
        "response_format": "Json",
        "payer_account_id": null,
        "params": null,
    }))
    .unwrap()
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
        // Fail fast on terms that can never settle: a zero amount, an
        // already-expired obligation, or an unknown evidence type.
        // Settle enforces the same rules, but rejecting here keeps a
        // bad obligation out of storage entirely. All three use frozen
        // error codes; the frozen reason-code list itself is unchanged.
        require!(amount > 0, "ERR_TERMS_MISMATCH");
        // Creation needs a strictly future expiry; use sites are inclusive at the deadline (block_timestamp() <= expires_at_ns).
        require!(
            expires_at_ns > env::block_timestamp(),
            "ERR_OBLIGATION_EXPIRED"
        );
        require!(
            evidence_type == "PREIMAGE"
                || evidence_type == "TEE"
                || evidence_type == VERIFIER_EVIDENCE_TYPE,
            "ERR_EVIDENCE_MISMATCH"
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

    // Owner only. Passing None clears the reconciler back to owner-only
    // resolution. The parameter is Option, not a separate remove method,
    // because the JSON interface stays backward compatible: an existing
    // caller passing an account id still deserializes to Some, and null
    // clears. It does not bump version and does not change terms.
    pub fn set_reconciler(&mut self, policy_id: String, reconciler: Option<AccountId>) {
        self.assert_owner();
        let mut policy = self
            .policies
            .get(&policy_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_POLICY_MISSING"));
        policy.reconciler = reconciler;
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
        // through the callback or through reconciliation. Cancelling from
        // reconciliation now enforces the same transfer timeout as
        // resolve_settlement, through the shared guard, so an early cancel
        // cannot release a reservation while the transfer might still land.
        // BLOCKED and WARN_PENDING are cancellable too: neither holds a
        // reservation or a token lock, so cancel just moves the obligation
        // to terminal CANCELLED.
        self.assert_owner();
        let mut obligation = self
            .obligations
            .get(&obligation_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_OBLIGATION_MISSING"));
        require!(
            obligation.state == "CREATED"
                || obligation.state == "RECONCILIATION_REQUIRED"
                || obligation.state == "BLOCKED"
                || obligation.state == "WARN_PENDING",
            "ERR_INVALID_STATE"
        );
        if obligation.state == "BLOCKED" || obligation.state == "WARN_PENDING" {
            // Neither state holds a reservation or a token lock, so
            // in_flight must already be false here. Make that explicit
            // in code instead of relying on the invariant alone.
            require!(!obligation.in_flight, "ERR_INVALID_STATE");
        }
        if obligation.state == "RECONCILIATION_REQUIRED" {
            // Same timeout guard as resolve_settlement, shared so the
            // two paths cannot drift apart: the transfer may still be
            // in flight until TRANSFER_TIMEOUT_NS has passed.
            require_transfer_timeout_elapsed(&obligation);
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

    pub fn cancel_expired_ready(&mut self, obligation_id: String) {
        // Owner only. Removes a READY obligation whose evidence window
        // has already expired, the dead record the judge audit fixes
        // left with no cleanup path: cancel_obligation refuses READY,
        // and settle rejects an expired obligation, so an expired READY
        // record could never leave the vault. This is the only way out
        // of READY, and it is deliberately narrow: the obligation must
        // be READY and already expired (block_timestamp() >
        // expires_at_ns, the same boundary settle uses, live at
        // expires_at_ns). A live READY obligation cannot be cleaned up,
        // so the owner cannot cancel a READY obligation that could
        // still settle. No funds move: a READY obligation holds no
        // reservation and no token lock, its amount was never reserved
        // (the reservation is taken at settle time, not at READY), so
        // spent, reserved, funded, and receipts are untouched. The
        // transfer-timeout guard does not apply here: it requires
        // in_flight, and a READY obligation has no transfer in flight.
        // in_flight is still asserted false, so a record that somehow
        // claims both READY and in flight is rejected instead of
        // cleaned up. The obligation goes to terminal CANCELLED, so it
        // can never settle afterwards: settle requires READY. Any stale
        // TEE request record and pending evidence fields are dropped
        // with it, so a late TEE callback finds nothing to resolve.
        // No stored field changes, so no migration is needed.
        self.assert_owner();
        let mut obligation = self
            .obligations
            .get(&obligation_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_OBLIGATION_MISSING"));
        require!(obligation.state == "READY", "ERR_INVALID_STATE");
        require!(!obligation.in_flight, "ERR_INVALID_STATE");
        require!(
            env::block_timestamp() > obligation.expires_at_ns,
            "ERR_NOT_EXPIRED"
        );
        obligation.state = "CANCELLED".to_string();
        obligation.pending_request_id = None;
        obligation.pending_digest = None;
        obligation.evidence_requested_at_ns = None;
        let mut requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        requests.remove(&obligation_id);
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
        // A TEE request in flight is abandoned with the obligation. Drop
        // its record so it does not leak and so a late callback finds
        // nothing to resolve.
        let mut requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        requests.remove(&obligation_id);
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
        // All three outcomes are owner only, never the reconciler.
        // READY and CANCELLED attest the payment did or did not happen,
        // which has the same financial impact as booking PAID, so the
        // reconciler cannot make that attestation. The owner must verify
        // on-chain that the transfer failed before resolving READY or
        // CANCELLED: the contract cannot verify a transaction hash
        // alone, and a READY resolution on a transfer that actually
        // succeeded would release the reservation while the recipient
        // already holds the tokens. A READY-resolved obligation never
        // settles again, so a wrong READY cannot dispatch a second
        // payment; a genuine retry needs a fresh obligation. Failure
        // alone never cancels: CANCELLED here is an explicit human
        // resolution, not an automatic failure outcome.
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
        require_transfer_timeout_elapsed(&obligation);
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
                self.assert_owner();
                policy.reserved = policy
                    .reserved
                    .checked_sub(obligation.amount)
                    .unwrap_or_else(|| env::panic_str("ERR_BUDGET_EXCEEDED"));
                // A READY resolution never settles again: the first
                // dispatch is marked consumed, so a later settle
                // rejects instead of dispatching a second payment.
                // CANCELLED is terminal already and needs no marker.
                if outcome == "READY" {
                    mark_resolved_ready(&obligation_id);
                }
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
        require!(!policy.frozen, "ERR_POLICY_FROZEN");
        require!(
            env::block_timestamp() <= obligation.expires_at_ns,
            "ERR_OBLIGATION_EXPIRED"
        );
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
        // Phase 9, layers 1 and 2: a PREIMAGE obligation is verified only
        // by its bytes, and a TEE obligation only by the TEE guest plus
        // VRF. Routing either through this path would let a compromised
        // verifier mark it READY without the real check.
        // Fail closed on the evidence type: only the known verifier
        // type reaches the verifier path. A negative match would let any
        // unknown string, including a typo, fall through to the weaker
        // verifier echo.
        require!(
            obligation.evidence_type == VERIFIER_EVIDENCE_TYPE,
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
            "ERR_OBLIGATION_EXPIRED"
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
            "ERR_OBLIGATION_EXPIRED"
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

    // Phase 9, layer 2: ask the OutLayer TEE to verify evidence for an
    // obligation. Owner only, because the call attaches NEAR for the
    // execution and anyone could drain the vault by spamming it. The
    // guest fetches the evidence from the given URL, hashes it, requests
    // VRF randomness, and the result returns through on_tee_result. The
    // obligation must already be EVIDENCE_PENDING with type TEE, inside
    // its evidence window.
    pub fn request_tee_verification(
        &mut self,
        obligation_id: String,
        evidence_url: String,
    ) -> Promise {
        self.assert_owner();
        let obligation = self
            .obligations
            .get(&obligation_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_OBLIGATION_MISSING"));
        require!(obligation.state == "EVIDENCE_PENDING", "ERR_INVALID_STATE");
        require!(obligation.evidence_type == "TEE", "ERR_EVIDENCE_MISMATCH");
        let now = env::block_timestamp();
        require!(now <= obligation.expires_at_ns, "ERR_OBLIGATION_EXPIRED");
        match obligation.evidence_requested_at_ns {
            Some(requested_at) => require!(
                now <= requested_at.saturating_add(EVIDENCE_TIMEOUT_NS),
                "ERR_EVIDENCE_EXPIRED"
            ),
            None => env::panic_str("ERR_INVALID_STATE"),
        }
        // A frozen policy files no new TEE request: the vault would
        // pay the OutLayer deposit for it. Matches request_evidence.
        let policy = self
            .policies
            .get(&obligation.policy_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("ERR_POLICY_MISSING"));
        require!(!policy.frozen, "ERR_POLICY_FROZEN");
        let mut requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        // One TEE request at a time per obligation. A second request while
        // one is pending would leave two callbacks racing for it.
        require!(requests.get(&obligation_id).is_none(), "ERR_INVALID_STATE");
        // The vault pays for the execution. Fail closed if it cannot:
        // the check uses liquid headroom, balance minus storage already
        // used, not total balance, so a vault whose balance is mostly
        // storage-locked cannot file a request it cannot pay the state
        // for. The frozen storage code applies, not a generic balance code.
        require!(
            native_headroom_yocto() >= TEE_REQUEST_DEPOSIT_YOCTO + SETTLE_GAS_HEADROOM_YOCTO,
            "ERR_VAULT_STORAGE_EXHAUSTED"
        );
        // Seed is unique per request and bound to the committed
        // digest. The counter makes a retry use a fresh seed even
        // when it lands in the same block and shares the timestamp,
        // so a signature from an earlier execution (same obligation,
        // same nonce) does not match the retry's recorded seed. The
        // digest binds the VRF alpha to the specific evidence the
        // vault committed to, so a signature from a different
        // obligation or a different digest cannot be reused here.
        // The VRF still does not prove the guest fetched the bytes;
        // that rests on the guest being our code, pinned by
        // version_key to one exact build below, and on the
        // per-execution TDX quote, which is verified off-chain: the
        // attestation endpoint serves real quotes, verified live for
        // requests 10522 and 10640 with matching input and output
        // hashes. The contract runtime has no TDX quote verification
        // primitive, so the VRF signature is the on-chain anchor.
        let counter = next_tee_request_counter();
        let seed = format!(
            "{}-{}-{}-{}",
            obligation_id,
            obligation.nonce,
            counter,
            hex_encode(&obligation.evidence_hash)
        );
        requests.insert(
            obligation_id.clone(),
            TeeRequest {
                obligation_id: obligation_id.clone(),
                evidence_url: evidence_url.clone(),
                seed: seed.clone(),
                requested_at_ns: now,
                sender: env::signer_account_id(),
            },
        );
        let args = outlayer_request_args(&evidence_url, &seed);
        Promise::new(OUTLAYER_CONTRACT.parse().unwrap())
            .function_call(
                "request_execution".to_string(),
                args,
                NearToken::from_yoctonear(TEE_REQUEST_DEPOSIT_YOCTO),
                TEE_REQUEST_GAS,
            )
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "on_tee_result".to_string(),
                    serde_json::to_vec(&serde_json::json!({
                        "obligation_id": obligation_id,
                    }))
                    .unwrap(),
                    NearToken::from_yoctonear(0),
                    TEE_CALLBACK_GAS,
                ),
            )
    }

    // Phase 9, layers 2 and 3: the OutLayer execution result, returned
    // through the yield promise. The result is the guest output parsed as
    // JSON (response_format Json), or null when the run failed. This is
    // the frozen callback shape: Result<Output, PromiseError> where Output
    // is the parsed output, never the ExecutionResponse. A failure here
    // never panics and never books anything: the obligation stays
    // EVIDENCE_PENDING, the request record is dropped so the owner can
    // retry, and the timeout method cancels it if the window passes.
    #[private]
    pub fn on_tee_result(
        &mut self,
        obligation_id: String,
        #[callback_result] result: Result<serde_json::Value, PromiseError>,
    ) {
        let mut requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        let mut obligation = match self.obligations.get(&obligation_id).cloned() {
            Some(o) => o,
            None => {
                requests.remove(&obligation_id);
                return;
            }
        };
        let tee = match requests.get(&obligation_id) {
            Some(t) => t,
            None => return,
        };
        // A stale result, after the obligation moved on or the request was
        // already resolved, changes nothing but drops the record, so the
        // storage does not leak and a later request is not blocked.
        if obligation.state != "EVIDENCE_PENDING" {
            requests.remove(&obligation_id);
            return;
        }
        // The TEE result is only usable inside the evidence window, and
        // the window runs from this request's own timestamp, not from
        // the original evidence request: a retry filed near the end of
        // the first hour gets its own fresh hour, so its valid callback
        // is not rejected as expired. The obligation expiry above still
        // bounds everything, and request_tee_verification still only
        // files a retry inside the original window.
        let now = env::block_timestamp();
        if now > obligation.expires_at_ns {
            requests.remove(&obligation_id);
            return;
        }
        if now > tee.requested_at_ns.saturating_add(EVIDENCE_TIMEOUT_NS) {
            requests.remove(&obligation_id);
            return;
        }
        let value = match result {
            Ok(v) => v,
            Err(_) => {
                requests.remove(&obligation_id);
                return;
            }
        };
        if value.is_null() {
            requests.remove(&obligation_id);
            return;
        }
        if !verify_tee_output(&obligation, tee, &value) {
            requests.remove(&obligation_id);
            return;
        }
        obligation.state = "READY".to_string();
        obligation.pending_request_id = None;
        obligation.pending_digest = None;
        obligation.evidence_requested_at_ns = None;
        requests.remove(&obligation_id);
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
        // A zero-amount funding call credits nothing, so it must not
        // touch storage: the checked_add below would pass, but the
        // insert after it would rewrite an unchanged policy.
        if amount.0 == 0 {
            return U128(0);
        }
        // Over-budget funding is refused, not credited: the excess
        // would be inert (settle caps by limit) but locked, with no
        // withdrawal path. The full amount is returned unused, matching
        // this method's frozen convention for rejected funding, and the
        // rejection is logged with the frozen budget code. The check
        // lives here, at the funding entry point, and deliberately not
        // in assert_policy_invariant: the invariant also runs in
        // freeze_policy and unfreeze_policy, and an already over-funded
        // policy must still be freezable, the freeze brake must never
        // be bricked by a funding check.
        // checked_add, not saturating_add, for the guard itself: with
        // limit at u128::MAX a saturating sum would pass the guard and
        // the update below would panic instead of refunding.
        let new_funded = match policy.funded.checked_add(amount.0) {
            Some(v) if v <= policy.limit => v,
            _ => {
                env::log_str("ERR_BUDGET_EXCEEDED");
                return amount;
            }
        };
        policy.funded = new_funded;
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
        // One timestamp for the whole call: the expiry check and the
        // dispatch timestamp below read the same block time.
        let now = env::block_timestamp();
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
        // A READY-resolved obligation never dispatches again: its first
        // transfer was resolved by a human after an ambiguous outcome,
        // and a second dispatch could pay twice. See
        // mark_resolved_ready. A READY return from the callback failure
        // path is different, the callback proved the transfer failed,
        // so that path stays retryable up to MAX_TRANSFER_ATTEMPTS and
        // is not marked.
        require!(
            !was_resolved_ready(&obligation_id),
            "ERR_NONCE_ALREADY_CONSUMED"
        );
        require!(
            obligation.recipient == proposed_recipient,
            "ERR_RECIPIENT_SUBSTITUTION"
        );
        require!(obligation.amount == proposed_amount.0, "ERR_TERMS_MISMATCH");
        require!(
            now <= obligation.expires_at_ns,
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
        obligation.transfer_dispatched_at_ns = Some(now);
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
        Promise::new(token_id)
            .function_call(
                "ft_transfer".to_string(),
                serde_json::to_vec(&serde_json::json!({
                    "receiver_id": recipient,
                    "amount": amount.to_string(),
                    "memo": null,
                }))
                .unwrap(),
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
        env::log_str(&format!("EVENT_JSON:{}", serde_json::to_string(&serde_json::json!({"standard": "nep297", "version": "1.0.0", "event": "receipt", "data": [{"index": receipt.index, "obligation_id": &receipt.obligation_id, "recipient": &receipt.recipient, "amount": receipt.amount.to_string(), "token_id": &receipt.token_id, "timestamp": receipt.timestamp, "prev_hash": receipt.prev_hash.iter().map(|b| format!("{:02x}", b)).collect::<String>(), "tx_ref": &receipt.tx_ref}]})).unwrap_or_default()));
        let mut map: LookupMap<u64, Receipt> = LookupMap::new(b"r");
        map.insert(index, receipt);
        // No explicit flush: a near-sdk store LookupMap flushes on drop,
        // so the insert above is written to storage when map goes out of
        // scope at the end of this function.
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
                // Callbacks must not panic: on any inconsistency the
                // callback returns without writing anything, leaving the
                // obligation TRANSFER_PENDING with in_flight true so the
                // owner can still mark it for reconciliation after the
                // transfer timeout. Unreachable from valid state: settle
                // reserves exactly the amount, and no other path releases
                // the reservation while TRANSFER_PENDING.
                policy.reserved = match policy.reserved.checked_sub(obligation.amount) {
                    Some(v) => v,
                    None => return,
                };
                policy.spent = match policy.spent.checked_add(obligation.amount) {
                    Some(v) => v,
                    None => return,
                };
                // Same condition as assert_policy_invariant, without the
                // panic: spent and reserved within limit, and their total
                // within limit and funded.
                let total = match policy.spent.checked_add(policy.reserved) {
                    Some(v) => v,
                    None => return,
                };
                if policy.spent > policy.limit
                    || policy.reserved > policy.limit
                    || total > policy.limit
                    || total > policy.funded
                {
                    return;
                }
                obligation.state = "PAID".to_string();
                obligation.in_flight = false;
                obligation.transfer_dispatched_at_ns = None;
                clear_token_lock(&policy.token_id);
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
                if obligation.transfer_attempt >= MAX_TRANSFER_ATTEMPTS {
                    // Repeated confirmed failures: the transfer keeps
                    // failing, for example an unregistered recipient,
                    // so returning to READY would let the agent loop
                    // settle and burn native headroom on every attempt.
                    // Escalate to human reconciliation instead, keeping
                    // the reservation, in_flight, dispatch time, and
                    // token lock, exactly like the frozen path. No
                    // automatic retry and no public resume: the owner
                    // resolves or cancels after the transfer timeout.
                    obligation.state = "RECONCILIATION_REQUIRED".to_string();
                    self.obligations.insert(obligation_id, obligation);
                    return;
                }
                // Fail closed, same as the Ok arm: return without
                // writing anything, so the obligation stays TRANSFER_PENDING
                // with in_flight true for owner reconciliation.
                policy.reserved = match policy.reserved.checked_sub(obligation.amount) {
                    Some(v) => v,
                    None => return,
                };
                // Same condition as assert_policy_invariant, without the
                // panic: spent is unchanged on this path, only the released
                // reservation moves the total.
                let total = match policy.spent.checked_add(policy.reserved) {
                    Some(v) => v,
                    None => return,
                };
                if policy.spent > policy.limit
                    || policy.reserved > policy.limit
                    || total > policy.limit
                    || total > policy.funded
                {
                    return;
                }
                obligation.state = "READY".to_string();
                obligation.in_flight = false;
                obligation.transfer_dispatched_at_ns = None;
                clear_token_lock(&policy.token_id);
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
    fn hex_decode_accepts_even_and_rejects_odd_or_bad() {
        assert_eq!(hex_decode(""), Some(vec![]));
        assert_eq!(hex_decode("00ffab"), Some(vec![0x00, 0xff, 0xab]));
        assert_eq!(hex_decode("AB"), Some(vec![0xab]));
        assert_eq!(hex_decode("0"), None);
        assert_eq!(hex_decode("abc"), None);
        assert_eq!(hex_decode("zz"), None);
        assert_eq!(hex_decode("0g"), None);
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
            1000000000,
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
        // A zero-amount funding call credits nothing and returns zero
        // unused: no storage write, funded stays exactly as it was.
        let zero = c.ft_on_transfer(
            "cynexmaster.testnet".parse().unwrap(),
            U128(0),
            "{\"fund_policy\": \"policy-001\"}".to_string(),
        );
        assert_eq!(zero.0, 0);
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

    // Drive an obligation to TRANSFER_PENDING with in_flight true, the
    // state on_transfer_complete expects. Used by the fail-closed
    // callback tests below.
    fn setup_in_flight_obligation(c: &mut Contract) {
        setup_ready_obligation(c, "obl-001", 250000);
        agent_ctx();
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "evidence-ref".to_string(),
        );
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "TRANSFER_PENDING");
        assert!(o.in_flight);
    }

    // Sol re-gate: the callback must not panic when the reservation
    // arithmetic fails. Unreachable from valid state, so the inconsistency
    // is built by hand: the obligation amount is raised above the reserved
    // amount after settle. The callback returns without writing anything,
    // so the owner can still reconcile the obligation after the timeout.
    #[test]
    fn callback_ok_budget_inconsistency_returns_without_writing() {
        let mut c = setup_owner();
        setup_in_flight_obligation(&mut c);
        let mut o = c.get_obligation("obl-001".to_string()).unwrap();
        o.amount = 250001;
        c.obligations.insert("obl-001".to_string(), o);
        c.on_transfer_complete("obl-001".to_string(), 1, Ok(()));
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "TRANSFER_PENDING");
        assert!(o.in_flight);
        assert!(o.transfer_dispatched_at_ns.is_some());
        let p = c.get_policy("policy-001".to_string()).unwrap();
        assert_eq!(p.reserved, 250000);
        assert_eq!(p.spent, 0);
        assert_eq!(c.receipts(0, 10).len(), 0);
        assert!(is_token_locked(
            &"usdc.fakes.testnet".parse::<AccountId>().unwrap()
        ));
    }

    // Same hand-built inconsistency on the retryable Err path, with the
    // policy not frozen and attempt 1 below MAX_TRANSFER_ATTEMPTS, so the
    // arithmetic is the path that would have run.
    #[test]
    fn callback_err_budget_inconsistency_returns_without_writing() {
        let mut c = setup_owner();
        setup_in_flight_obligation(&mut c);
        let mut o = c.get_obligation("obl-001".to_string()).unwrap();
        o.amount = 250001;
        c.obligations.insert("obl-001".to_string(), o);
        c.on_transfer_complete("obl-001".to_string(), 1, Err(PromiseError::Failed));
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "TRANSFER_PENDING");
        assert!(o.in_flight);
        assert!(o.transfer_dispatched_at_ns.is_some());
        let p = c.get_policy("policy-001".to_string()).unwrap();
        assert_eq!(p.reserved, 250000);
        assert_eq!(p.spent, 0);
        assert_eq!(c.receipts(0, 10).len(), 0);
        assert!(is_token_locked(
            &"usdc.fakes.testnet".parse::<AccountId>().unwrap()
        ));
    }

    // The invariant check is separately reachable by hand-built state:
    // the arithmetic itself succeeds, but the policy was already
    // inconsistent before the callback. Here spent is raised so that
    // spent plus amount exceeds the 1000000 limit on the Ok path.
    #[test]
    fn callback_ok_invariant_inconsistency_returns_without_writing() {
        let mut c = setup_owner();
        setup_in_flight_obligation(&mut c);
        let mut p = c.get_policy("policy-001".to_string()).unwrap();
        p.spent = 900000;
        c.policies.insert("policy-001".to_string(), p);
        c.on_transfer_complete("obl-001".to_string(), 1, Ok(()));
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "TRANSFER_PENDING");
        assert!(o.in_flight);
        assert!(o.transfer_dispatched_at_ns.is_some());
        let p = c.get_policy("policy-001".to_string()).unwrap();
        assert_eq!(p.reserved, 250000);
        assert_eq!(p.spent, 900000);
        assert_eq!(c.receipts(0, 10).len(), 0);
        assert!(is_token_locked(
            &"usdc.fakes.testnet".parse::<AccountId>().unwrap()
        ));
    }

    // Same invariant failure on the retryable Err path: spent alone
    // already exceeds the limit, so the released reservation cannot
    // bring the total back inside it.
    #[test]
    fn callback_err_invariant_inconsistency_returns_without_writing() {
        let mut c = setup_owner();
        setup_in_flight_obligation(&mut c);
        let mut p = c.get_policy("policy-001".to_string()).unwrap();
        p.spent = 1100000;
        c.policies.insert("policy-001".to_string(), p);
        c.on_transfer_complete("obl-001".to_string(), 1, Err(PromiseError::Failed));
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "TRANSFER_PENDING");
        assert!(o.in_flight);
        assert!(o.transfer_dispatched_at_ns.is_some());
        let p = c.get_policy("policy-001".to_string()).unwrap();
        assert_eq!(p.reserved, 250000);
        assert_eq!(p.spent, 1100000);
        assert_eq!(c.receipts(0, 10).len(), 0);
        assert!(is_token_locked(
            &"usdc.fakes.testnet".parse::<AccountId>().unwrap()
        ));
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
        // Token lock released, but the obligation can never settle
        // again: a READY resolution marks the first dispatch consumed,
        // so a second settle rejects. See
        // resolve_settlement_ready_cannot_settle_again.
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
            Some("reconciler.testnet".parse().unwrap()),
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

    // Finding 1: the reconciler can still mark a timeout, but resolving
    // to READY is owner only now, so the reconciler guard panics with
    // ERR_NOT_OWNER, not the reconciler guard.
    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn reconciler_cannot_resolve_to_ready() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.set_reconciler(
            "policy-001".to_string(),
            Some("reconciler.testnet".parse().unwrap()),
        );
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("reconciler.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        ctx.block_timestamp(TRANSFER_TIMEOUT_NS);
        testing_env!(ctx.build());
        c.mark_reconciliation_required("obl-001".to_string());
        c.resolve_settlement("obl-001".to_string(), "READY".to_string(), "".to_string());
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
    #[should_panic(expected = "ERR_OBLIGATION_EXPIRED")]
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

    // A TEE obligation, evidence requested, and a TEE request filed. The
    // vault holds 10 NEAR in the mock so the deposit check passes. The
    // evidence hash is the SHA-256 of the v1 guest file, the same file
    // the live guest v2 run fetched (request 10384).
    fn tee_setup_for(vault: &str, obligation_id: &str) -> Contract {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        // The signer is cynexmaster.testnet, matching the live VRF
        // output used by the live-values test: OutLayer uses the
        // transaction signer as the VRF sender, not the vault.
        ctx.signer_account_id("cynexmaster.testnet".parse().unwrap());
        ctx.current_account_id(vault.parse().unwrap());
        ctx.account_balance(NearToken::from_yoctonear(
            10_000_000_000_000_000_000_000_000,
        ));
        ctx.block_timestamp(1000);
        testing_env!(ctx.build());
        let mut c = Contract::init(owner());
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        c.create_obligation(
            obligation_id.to_string(),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            250000,
            "TEE".to_string(),
            hex32("528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6"),
            1_000_000_000_000_000,
            1,
        );
        c.request_evidence(obligation_id.to_string());
        let _ = c.request_tee_verification(
            obligation_id.to_string(),
            "https://test.fastfs.io/cynexmaster.testnet/outlayer.testnet/528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6.wasm"
                .to_string(),
        );
        c
    }

    // Run the vault callback as the vault itself, which is what
    // #[private] requires.
    fn as_vault(vault: &str) {
        let vault_id: AccountId = vault.parse().unwrap();
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(vault_id.clone());
        ctx.current_account_id(vault_id);
        ctx.block_timestamp(2000);
        testing_env!(ctx.build());
    }

    // Run the vault callback as the vault itself at a chosen block
    // timestamp, which is what #[private] requires.
    fn as_vault_at(vault: &str, block_timestamp: u64) {
        let vault_id: AccountId = vault.parse().unwrap();
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(vault_id.clone());
        ctx.current_account_id(vault_id);
        ctx.block_timestamp(block_timestamp);
        testing_env!(ctx.build());
    }

    // The exact output of the live guest v2 run, request 10459. The
    // digest is the SHA-256 of the fetched file, the alpha is the
    // three-part form the host builds, and the signature is the real
    // keystore signature for it.
    fn tee_output_json() -> serde_json::Value {
        // Live output of OutLayer request 10459, run with the counter
        // seed format (obligation id, nonce, counter, digest). The
        // guest fetched the v1 FastFS file and hashed it, and the VRF
        // alpha binds the request id, the transaction signer, and that seed.
        serde_json::json!({
            "digest": "528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6",
            "request_id": "10459",
            "source": "https://test.fastfs.io/cynexmaster.testnet/outlayer.testnet/528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6.wasm",
            "vrf_alpha": "vrf:10459:cynexmaster.testnet:test-seed-1-0-528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6",
            "vrf_output": "f3a6e13835b866d19ce15cbe892c7a690c2f75ba4481b6314412a7adf713bde8",
            "vrf_signature": "b103e1f0cf43b0216024ca27de9de18e41cf104c4d4852f4a995c1fc803655ac9271d9376034c633c73d5c03c360b93fa7a0966d19c7a5c8cf68db0fa43ed509"
        })
    }

    #[test]
    fn request_tee_verification_stores_request() {
        let c = tee_setup_for("cynex-vault.testnet", "obl-001");
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        let tee = requests.get(&"obl-001".to_string()).unwrap();
        assert_eq!(
            tee.evidence_url,
            "https://test.fastfs.io/cynexmaster.testnet/outlayer.testnet/528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6.wasm"
        );
        // The seed is obligation id, nonce, the request counter,
        // and the committed digest hex, so it is unique per request
        // and bound to the evidence the vault committed to.
        assert_eq!(
            tee.seed,
            "obl-001-1-0-528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6"
        );
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn request_tee_verification_rejects_non_owner() {
        let mut c = tee_setup_for("cynex-vault.testnet", "obl-001");
        as_other();
        let _ = c.request_tee_verification(
            "obl-001".to_string(),
            "https://example.com/evidence.bin".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_EVIDENCE_MISMATCH")]
    fn request_tee_verification_rejects_non_tee() {
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let mut c = preimage_setup_at(&evidence, "PREIMAGE", 1_000_000_000_000_000);
        let _ = c.request_tee_verification(
            "obl-001".to_string(),
            "https://example.com/evidence.bin".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_INVALID_STATE")]
    fn request_tee_verification_rejects_not_pending() {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        ctx.account_balance(NearToken::from_yoctonear(
            10_000_000_000_000_000_000_000_000,
        ));
        ctx.block_timestamp(1000);
        testing_env!(ctx.build());
        let mut c = Contract::init(owner());
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
            "TEE".to_string(),
            hex32("528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6"),
            1_000_000_000_000_000,
            1,
        );
        // No request_evidence, so the obligation is still CREATED.
        let _ = c.request_tee_verification(
            "obl-001".to_string(),
            "https://example.com/evidence.bin".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_INVALID_STATE")]
    fn request_tee_verification_rejects_second_request() {
        let mut c = tee_setup_for("cynex-vault.testnet", "obl-001");
        let _ = c.request_tee_verification(
            "obl-001".to_string(),
            "https://example.com/evidence.bin".to_string(),
        );
    }

    #[test]
    fn on_tee_result_accepts_live_output() {
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        as_vault("cynexmaster.testnet");
        c.on_tee_result("test-seed".to_string(), Ok(tee_output_json()));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "READY");
        assert_eq!(o.pending_request_id, None);
        assert_eq!(o.pending_digest, None);
        assert_eq!(o.evidence_requested_at_ns, None);
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert_eq!(requests.get(&"test-seed".to_string()), None);
    }

    #[test]
    fn on_tee_result_accepts_retry_after_original_window() {
        // Finding 3b-2: the callback window must run from the retry's
        // own requested_at_ns, not from the original evidence request.
        // The first request was filed at block 1000, so the original
        // window ends at 1000 + EVIDENCE_TIMEOUT_NS. The retry is
        // filed one second before that deadline, and its callback
        // arrives just past it: the old code rejected this, the fix
        // accepts it. The stored request keeps the original seed, so
        // the canned live output still verifies; only the timestamp
        // moves, which is exactly what a retry changes.
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        let retry_at = 1000 + EVIDENCE_TIMEOUT_NS - 1_000_000_000;
        // The store LookupMap only writes to storage when it is
        // dropped, so the fresh request is written in its own scope
        // and flushed before the callback reads it back.
        {
            let mut requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
            let mut tee = requests.get(&"test-seed".to_string()).unwrap().clone();
            tee.requested_at_ns = retry_at;
            requests.insert("test-seed".to_string(), tee);
        }
        let callback_at = 1000 + EVIDENCE_TIMEOUT_NS + 1;
        as_vault_at("cynexmaster.testnet", callback_at);
        c.on_tee_result("test-seed".to_string(), Ok(tee_output_json()));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "READY");
    }

    #[test]
    fn on_tee_result_rejects_callback_after_retry_window() {
        // The retry's own window is still enforced: a callback past
        // retry requested_at_ns + EVIDENCE_TIMEOUT_NS is rejected.
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        let retry_at = 1000 + EVIDENCE_TIMEOUT_NS - 1_000_000_000;
        // The store LookupMap only writes to storage when it is
        // dropped, so the fresh request is written in its own scope
        // and flushed before the callback reads it back.
        {
            let mut requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
            let mut tee = requests.get(&"test-seed".to_string()).unwrap().clone();
            tee.requested_at_ns = retry_at;
            requests.insert("test-seed".to_string(), tee);
        }
        let callback_at = retry_at + EVIDENCE_TIMEOUT_NS + 1;
        as_vault_at("cynexmaster.testnet", callback_at);
        c.on_tee_result("test-seed".to_string(), Ok(tee_output_json()));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert_eq!(requests.get(&"test-seed".to_string()), None);
    }

    #[test]
    fn on_tee_result_accepts_callback_at_retry_deadline() {
        // Boundary (GLM F3): the check is `now > requested_at +
        // TIMEOUT`, so a callback arriving exactly at the retry
        // deadline is accepted.
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        let retry_at = 1000 + EVIDENCE_TIMEOUT_NS - 1_000_000_000;
        {
            let mut requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
            let mut tee = requests.get(&"test-seed".to_string()).unwrap().clone();
            tee.requested_at_ns = retry_at;
            requests.insert("test-seed".to_string(), tee);
        }
        let callback_at = retry_at + EVIDENCE_TIMEOUT_NS;
        as_vault_at("cynexmaster.testnet", callback_at);
        c.on_tee_result("test-seed".to_string(), Ok(tee_output_json()));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "READY");
    }

    #[test]
    fn on_tee_result_rejects_callback_past_obligation_expiry() {
        // Boundary (GLM F4): the obligation expiry still bounds
        // everything, so a callback inside the retry window but past
        // expires_at_ns is rejected. The obligation is shortened to
        // expire one nanosecond before the callback, the way a
        // short-lived obligation expires in production while its retry
        // window is still open.
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        let retry_at = 1000 + EVIDENCE_TIMEOUT_NS - 1_000_000_000;
        {
            let mut requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
            let mut tee = requests.get(&"test-seed".to_string()).unwrap().clone();
            tee.requested_at_ns = retry_at;
            requests.insert("test-seed".to_string(), tee);
        }
        let callback_at = 1000 + EVIDENCE_TIMEOUT_NS + 1;
        let mut o = c.get_obligation("test-seed".to_string()).unwrap();
        o.expires_at_ns = callback_at - 1;
        c.obligations.insert("test-seed".to_string(), o);
        as_vault_at("cynexmaster.testnet", callback_at);
        c.on_tee_result("test-seed".to_string(), Ok(tee_output_json()));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert_eq!(requests.get(&"test-seed".to_string()), None);
    }

    #[test]
    fn on_tee_result_rejects_bad_digest() {
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        as_vault("cynexmaster.testnet");
        let mut value = tee_output_json();
        value["digest"] =
            serde_json::json!("0000000000000000000000000000000000000000000000000000000000000000");
        c.on_tee_result("test-seed".to_string(), Ok(value));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
    }

    #[test]
    fn on_tee_result_rejects_wrong_source() {
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        as_vault("cynexmaster.testnet");
        let mut value = tee_output_json();
        value["source"] = serde_json::json!("https://example.com/other.bin");
        c.on_tee_result("test-seed".to_string(), Ok(value));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
    }

    #[test]
    fn on_tee_result_rejects_bad_signature() {
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        as_vault("cynexmaster.testnet");
        let mut value = tee_output_json();
        value["vrf_signature"] = serde_json::json!(
            "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
        );
        c.on_tee_result("test-seed".to_string(), Ok(value));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
    }

    #[test]
    fn on_tee_result_rejects_wrong_seed_in_alpha() {
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        as_vault("cynexmaster.testnet");
        let mut value = tee_output_json();
        value["vrf_alpha"] = serde_json::json!("vrf:10384:cynexmaster.testnet:other-seed");
        c.on_tee_result("test-seed".to_string(), Ok(value));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
    }

    #[test]
    fn on_tee_result_ignores_promise_error() {
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        as_vault("cynexmaster.testnet");
        c.on_tee_result("test-seed".to_string(), Err(PromiseError::Failed));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
    }

    #[test]
    fn on_tee_result_ignores_null_output() {
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        as_vault("cynexmaster.testnet");
        c.on_tee_result("test-seed".to_string(), Ok(serde_json::Value::Null));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
    }

    #[test]
    #[should_panic(expected = "ERR_EVIDENCE_MISMATCH")]
    fn submit_evidence_rejects_tee_type() {
        let mut c = tee_setup_for("cynex-vault.testnet", "obl-001");
        // The owner is an allowlisted verifier here and the proof is the
        // correct digest, so the only reason this must fail is the type:
        // a TEE obligation is verified by the guest plus VRF only.
        c.add_verifier(owner());
        c.submit_evidence(
            "obl-001-1".to_string(),
            "obl-001".to_string(),
            "ALLOWED".to_string(),
            "528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6".to_string(),
        );
    }

    #[test]
    fn on_tee_result_failure_drops_record_and_allows_retry() {
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        as_vault("cynexmaster.testnet");
        let mut value = tee_output_json();
        value["digest"] =
            serde_json::json!("0000000000000000000000000000000000000000000000000000000000000000");
        c.on_tee_result("test-seed".to_string(), Ok(value));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
        // The record is gone, so the owner can file a fresh request.
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert_eq!(requests.get(&"test-seed".to_string()), None);
        // Back as the owner, inside the window, the retry is accepted.
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("cynexmaster.testnet".parse().unwrap());
        ctx.account_balance(NearToken::from_yoctonear(
            10_000_000_000_000_000_000_000_000,
        ));
        ctx.block_timestamp(3000);
        testing_env!(ctx.build());
        let _ = c.request_tee_verification(
            "test-seed".to_string(),
            "https://test.fastfs.io/cynexmaster.testnet/outlayer.testnet/528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6.wasm"
                .to_string(),
        );
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert!(requests.get(&"test-seed".to_string()).is_some());
    }

    #[test]
    fn on_tee_result_stale_state_drops_record() {
        // A TeeRequest record exists for an obligation that is no longer
        // EVIDENCE_PENDING. The callback must drop the record, not leave
        // it orphaned.
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        // Move the obligation out of EVIDENCE_PENDING by cancelling the
        // evidence through the timeout path, but restore a record first
        // so the stale branch has one to drop.
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        let tee = requests.get(&"test-seed".to_string()).unwrap().clone();
        // Cancel the evidence window: advance past the timeout and mark it.
        set_time_and_caller(owner(), 1000 + EVIDENCE_TIMEOUT_NS + 1);
        // mark_evidence_timeout drops the record itself, so re-insert one
        // to exercise the callback's stale branch in isolation.
        c.mark_evidence_timeout("test-seed".to_string(), false);
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "CANCELLED");
        let mut requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        requests.insert("test-seed".to_string(), tee);
        as_vault("cynexmaster.testnet");
        c.on_tee_result("test-seed".to_string(), Ok(tee_output_json()));
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert_eq!(requests.get(&"test-seed".to_string()), None);
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "CANCELLED");
    }

    #[test]
    fn mark_evidence_timeout_drops_tee_record() {
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert!(requests.get(&"test-seed".to_string()).is_some());
        set_time_and_caller(owner(), 1000 + EVIDENCE_TIMEOUT_NS + 1);
        c.mark_evidence_timeout("test-seed".to_string(), false);
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert_eq!(requests.get(&"test-seed".to_string()), None);
    }

    #[test]
    #[should_panic(expected = "ERR_OBLIGATION_EXPIRED")]
    fn request_tee_verification_rejects_after_expiry() {
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        // The obligation expires at 1e15; move past it and retry.
        set_time_and_caller(owner(), 1_000_000_000_000_001);
        let _ = c.request_tee_verification(
            "test-seed".to_string(),
            "https://example.com/evidence.bin".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_EVIDENCE_EXPIRED")]
    fn request_tee_verification_rejects_after_evidence_timeout() {
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        set_time_and_caller(owner(), 1000 + EVIDENCE_TIMEOUT_NS + 1);
        let _ = c.request_tee_verification(
            "test-seed".to_string(),
            "https://example.com/evidence.bin".to_string(),
        );
    }

    #[test]
    fn on_tee_result_after_evidence_timeout_stays_pending() {
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        as_vault("cynexmaster.testnet");
        // Rebuild the context past the evidence timeout, keeping the
        // vault as the caller so the private callback is allowed.
        let vault_id: AccountId = "cynexmaster.testnet".parse().unwrap();
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(vault_id.clone());
        ctx.current_account_id(vault_id);
        ctx.block_timestamp(1000 + EVIDENCE_TIMEOUT_NS + 1);
        testing_env!(ctx.build());
        c.on_tee_result("test-seed".to_string(), Ok(tee_output_json()));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert_eq!(requests.get(&"test-seed".to_string()), None);
    }

    #[test]
    #[should_panic(expected = "ERR_VAULT_STORAGE_EXHAUSTED")]
    fn request_tee_verification_rejects_insufficient_balance() {
        // Build a TEE obligation in EVIDENCE_PENDING with no TeeRequest
        // record yet, and a zero vault balance. The only reason the
        // request must fail is the headroom check: zero balance means
        // zero liquid headroom.
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        // The builder defaults the balance to 100 NEAR, which would pass
        // the check. Set it to zero so the balance guard is what fails.
        ctx.account_balance(NearToken::from_yoctonear(0));
        ctx.block_timestamp(1000);
        testing_env!(ctx.build());
        let mut c = Contract::init(owner());
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
            "TEE".to_string(),
            hex32("528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6"),
            1_000_000_000_000_000,
            1,
        );
        c.request_evidence("obl-001".to_string());
        let _ = c.request_tee_verification(
            "obl-001".to_string(),
            "https://example.com/evidence.bin".to_string(),
        );
    }

    #[test]
    fn request_tee_verification_colon_obligation_id() {
        // An obligation id containing ':' must still derive a seed the
        // callback can parse, because the alpha is split on the first
        // three colons only.
        let c = tee_setup_for("cynex-vault.testnet", "obl:001");
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        let tee = requests.get(&"obl:001".to_string()).unwrap();
        // The seed is obligation id, nonce, the request counter,
        // and the committed digest hex, so a colon in the id stays
        // intact and the seed is unique per request.
        assert_eq!(
            tee.seed,
            "obl:001-1-0-528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6"
        );
        let o = c.get_obligation("obl:001".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
    }

    #[test]
    fn on_tee_result_rejects_replayed_old_alpha() {
        // The request 10384 output used the old seed format
        // ("test-seed-1", no timestamp, no digest). The current
        // TeeRequest records the new seed, so the replayed alpha's
        // seed does not match and the obligation stays pending.
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        as_vault("cynexmaster.testnet");
        let old = serde_json::json!({
            "digest": "528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6",
            "request_id": "10384",
            "source": "https://test.fastfs.io/cynexmaster.testnet/outlayer.testnet/528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6.wasm",
            "vrf_alpha": "vrf:10384:cynexmaster.testnet:test-seed-1",
            "vrf_output": "b7a556fd83ded2980137572e812d2e339e8cdf3199007744947597907f11778e",
            "vrf_signature": "365d731eec3dd08003f36ec8dd3e987f377394110faffd995b45bb448bcb03f0f70a8bad9392ff6da7a1e6e53c31a1b437d10bf2e0667e30daf7d13dd460f805"
        });
        c.on_tee_result("test-seed".to_string(), Ok(old));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert!(requests.get(&"test-seed".to_string()).is_none());
    }

    #[test]
    fn on_tee_result_rejects_replay_same_timestamp_retry() {
        // Sol's prescribed test: a failed callback drops the record,
        // the owner retries at the SAME block timestamp, and the first
        // request's correctly signed new-format alpha must be rejected
        // on the retry, because the counter gives the retry a fresh
        // seed even though the timestamp did not advance.
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        // First request used counter 0. Fail it with a bad digest.
        as_vault("cynexmaster.testnet");
        let bad = serde_json::json!({
            "digest": "0000000000000000000000000000000000000000000000000000000000000000",
            "request_id": "10459",
            "source": "https://test.fastfs.io/cynexmaster.testnet/outlayer.testnet/528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6.wasm",
            "vrf_alpha": "vrf:10459:cynexmaster.testnet:test-seed-1-0-528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6",
            "vrf_output": "f3a6e13835b866d19ce15cbe892c7a690c2f75ba4481b6314412a7adf713bde8",
            "vrf_signature": "b103e1f0cf43b0216024ca27de9de18e41cf104c4d4852f4a995c1fc803655ac9271d9376034c633c73d5c03c360b93fa7a0966d19c7a5c8cf68db0fa43ed509"
        });
        c.on_tee_result("test-seed".to_string(), Ok(bad));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
        // Retry at the SAME timestamp (1000). The counter advanced, so
        // the retry's seed is test-seed-1-1-..., not test-seed-1-0-...
        // The signer is set explicitly to cynexmaster.testnet so the
        // retry records the same sender as the first request: only the
        // seed differs, so the replay rejection isolates the seed check
        // instead of the sender check.
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(accounts(0));
        ctx.signer_account_id("cynexmaster.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        ctx.block_timestamp(1000);
        testing_env!(ctx.build());
        let _ = c.request_tee_verification(
            "test-seed".to_string(),
            "https://test.fastfs.io/cynexmaster.testnet/outlayer.testnet/528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6.wasm".to_string(),
        );
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        let tee = requests.get(&"test-seed".to_string()).unwrap();
        assert_eq!(
            tee.seed,
            "test-seed-1-1-528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6"
        );
        // Now replay the first request's correctly signed alpha on the
        // retry. It must be rejected: the seed does not match.
        as_vault("cynexmaster.testnet");
        c.on_tee_result("test-seed".to_string(), Ok(tee_output_json()));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert!(requests.get(&"test-seed".to_string()).is_none());
    }

    #[test]
    fn on_tee_result_rejects_wrong_recorded_sender() {
        // A valid signature for the live alpha (sender
        // cynexmaster.testnet) must still be rejected when the request
        // was filed by a different signer. This proves the sender check
        // is doing work, not just the signature check. The request is
        // filed through the real path with signer other.testnet, so the
        // recorded sender is other.testnet while the live output's
        // sender is cynexmaster.testnet.
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.signer_account_id("other.testnet".parse().unwrap());
        ctx.current_account_id("cynexmaster.testnet".parse().unwrap());
        ctx.account_balance(NearToken::from_yoctonear(
            10_000_000_000_000_000_000_000_000,
        ));
        ctx.block_timestamp(1000);
        testing_env!(ctx.build());
        let mut c = Contract::init(owner());
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        c.create_obligation(
            "test-seed".to_string(),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            250000,
            "TEE".to_string(),
            hex32("528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6"),
            1_000_000_000_000_000,
            1,
        );
        c.request_evidence("test-seed".to_string());
        let _ = c.request_tee_verification(
            "test-seed".to_string(),
            "https://test.fastfs.io/cynexmaster.testnet/outlayer.testnet/528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6.wasm"
                .to_string(),
        );
        as_vault("cynexmaster.testnet");
        c.on_tee_result("test-seed".to_string(), Ok(tee_output_json()));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "EVIDENCE_PENDING");
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert!(requests.get(&"test-seed".to_string()).is_none());
    }

    #[test]
    fn on_tee_result_accepts_live_output_vault_differs_from_signer() {
        // The discriminating accept test: the vault is
        // cynex-vault.testnet but the signer is cynexmaster.testnet, the
        // live topology that produced the defect. The live output must
        // go READY. Under the old vault-based sender check this would
        // fail, because the alpha sender (cynexmaster.testnet) is not
        // the vault.
        let mut c = tee_setup_for("cynex-vault.testnet", "test-seed");
        as_vault("cynex-vault.testnet");
        c.on_tee_result("test-seed".to_string(), Ok(tee_output_json()));
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "READY");
        assert_eq!(o.pending_request_id, None);
        assert_eq!(o.pending_digest, None);
        assert_eq!(o.evidence_requested_at_ns, None);
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert!(requests.get(&"test-seed".to_string()).is_none());
    }

    // Finding 1: a reconciler can no longer resolve to CANCELLED either.
    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn reconciler_cannot_resolve_to_cancelled() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.set_reconciler(
            "policy-001".to_string(),
            Some("reconciler.testnet".parse().unwrap()),
        );
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("reconciler.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        ctx.block_timestamp(TRANSFER_TIMEOUT_NS);
        testing_env!(ctx.build());
        c.mark_reconciliation_required("obl-001".to_string());
        c.resolve_settlement(
            "obl-001".to_string(),
            "CANCELLED".to_string(),
            "".to_string(),
        );
    }

    // Finding 1: a READY-resolved obligation never dispatches again.
    #[test]
    #[should_panic(expected = "ERR_NONCE_ALREADY_CONSUMED")]
    fn resolve_settlement_ready_cannot_settle_again() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.mark_reconciliation_required("obl-001".to_string());
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.resolve_settlement("obl-001".to_string(), "READY".to_string(), "".to_string());
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "READY"
        );
        // The first dispatch is marked consumed, so this rejects
        // instead of dispatching a second payment.
        agent_ctx();
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
    }

    // Finding 1, via the three-failure escalation path: a READY-resolved
    // obligation never dispatches again, even when it reached
    // reconciliation through repeated confirmed failures rather than
    // through mark_reconciliation_required.
    #[test]
    #[should_panic(expected = "ERR_NONCE_ALREADY_CONSUMED")]
    fn escalated_obligation_resolve_ready_cannot_settle_again() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 250000, 1000000, 1000000);
        for attempt in 1..=3u64 {
            agent_ctx();
            let _ = c.settle(
                "obl-001".to_string(),
                "acme-supplies.testnet".parse().unwrap(),
                U128(250000),
                "x".to_string(),
            );
            c.on_transfer_complete("obl-001".to_string(), attempt, Err(PromiseError::Failed));
        }
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "RECONCILIATION_REQUIRED");
        assert!(o.in_flight);
        // Dispatch was at block timestamp 0, so the transfer timeout
        // is reached at TRANSFER_TIMEOUT_NS exactly.
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.resolve_settlement("obl-001".to_string(), "READY".to_string(), "".to_string());
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "READY"
        );
        // The first dispatch is marked consumed, so this rejects
        // instead of dispatching a second payment.
        agent_ctx();
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
    }

    // Finding 2: cancel from reconciliation before the transfer timeout
    // is rejected, even when the obligation entered reconciliation early
    // through the frozen-policy callback path.
    #[test]
    #[should_panic(expected = "ERR_TIMEOUT_NOT_REACHED")]
    fn cancel_obligation_from_reconciliation_before_timeout_rejects() {
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        owner_ctx_at(0);
        c.freeze_policy("policy-001".to_string());
        c.on_transfer_complete("obl-001".to_string(), 1, Err(PromiseError::Failed));
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "RECONCILIATION_REQUIRED"
        );
        // Dispatch was at timestamp 0, so the timeout is not reached
        // until TRANSFER_TIMEOUT_NS.
        owner_ctx_at(TRANSFER_TIMEOUT_NS - 1);
        c.cancel_obligation("obl-001".to_string());
    }

    // Finding 3: after three confirmed failures the obligation escalates
    // to human reconciliation instead of returning to READY.
    #[test]
    fn failed_transfer_escalates_to_reconciliation_after_three_attempts() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 250000, 1000000, 1000000);
        for attempt in 1..=3u64 {
            agent_ctx();
            let _ = c.settle(
                "obl-001".to_string(),
                "acme-supplies.testnet".parse().unwrap(),
                U128(250000),
                "x".to_string(),
            );
            let o = c.get_obligation("obl-001".to_string()).unwrap();
            assert_eq!(o.state, "TRANSFER_PENDING");
            assert_eq!(o.transfer_attempt, attempt);
            c.on_transfer_complete("obl-001".to_string(), attempt, Err(PromiseError::Failed));
            let o = c.get_obligation("obl-001".to_string()).unwrap();
            if attempt < 3 {
                assert_eq!(o.state, "READY");
                assert!(!o.in_flight);
            } else {
                assert_eq!(o.state, "RECONCILIATION_REQUIRED");
                assert!(o.in_flight);
                assert_eq!(o.transfer_attempt, 3);
                assert_eq!(
                    c.get_policy("policy-001".to_string()).unwrap().reserved,
                    250000
                );
                // Dispatch time is retained at escalation, so the timeout
                // guard in resolve_settlement and cancel_obligation can
                // still check it, and the per-token lock is still held,
                // so no second obligation for this token can dispatch
                // while the escalated transfer is unresolved.
                assert!(o.transfer_dispatched_at_ns.is_some());
                assert!(is_token_locked(&"usdc.fakes.testnet".parse().unwrap()));
            }
        }
        // The escalated obligation is resolvable, not a dead end:
        // past the transfer timeout the owner can resolve it READY.
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.resolve_settlement("obl-001".to_string(), "READY".to_string(), "".to_string());
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "READY");
        assert!(!o.in_flight);
        assert_eq!(c.get_policy("policy-001".to_string()).unwrap().reserved, 0);
    }

    // Same escalation as above, but the owner cancels the escalated
    // obligation after the timeout instead of resolving it.
    #[test]
    fn escalated_obligation_can_be_cancelled_after_timeout() {
        let mut c = setup_owner();
        setup_ready_with_amount(&mut c, "obl-001", 250000, 1000000, 1000000);
        for attempt in 1..=3u64 {
            agent_ctx();
            let _ = c.settle(
                "obl-001".to_string(),
                "acme-supplies.testnet".parse().unwrap(),
                U128(250000),
                "x".to_string(),
            );
            c.on_transfer_complete("obl-001".to_string(), attempt, Err(PromiseError::Failed));
        }
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "RECONCILIATION_REQUIRED");
        assert!(o.in_flight);
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.cancel_obligation("obl-001".to_string());
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "CANCELLED");
        assert!(!o.in_flight);
        assert_eq!(c.get_policy("policy-001".to_string()).unwrap().reserved, 0);
    }

    // Finding 4: total balance above the threshold but liquid headroom
    // below it must still reject. Storage usage of 100,000,000 bytes
    // locks far more than the 10 NEAR balance at any realistic storage
    // byte cost, so headroom is zero while the old total-balance check
    // would have passed. The setup stops at EVIDENCE_PENDING on
    // purpose: tee_setup_for files the request itself, so it cannot
    // build this case.
    #[test]
    #[should_panic(expected = "ERR_VAULT_STORAGE_EXHAUSTED")]
    fn request_tee_verification_rejects_low_liquid_headroom() {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.signer_account_id("cynexmaster.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        ctx.account_balance(NearToken::from_yoctonear(
            10_000_000_000_000_000_000_000_000,
        ));
        ctx.block_timestamp(1000);
        ctx.storage_usage(100_000_000);
        testing_env!(ctx.build());
        let mut c = Contract::init(owner());
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
            "TEE".to_string(),
            hex32("528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6"),
            1_000_000_000_000_000,
            1,
        );
        c.request_evidence("obl-001".to_string());
        let _ = c.request_tee_verification(
            "obl-001".to_string(),
            "https://example.com/evidence.bin".to_string(),
        );
    }

    // Finding 5: the OutLayer request pins the exact guest version.
    #[test]
    fn outlayer_request_args_pins_version_key() {
        let args = outlayer_request_args("https://example.com/evidence.bin", "obl-001-1-0-ab12");
        let value: serde_json::Value = serde_json::from_slice(&args).unwrap();
        assert_eq!(
            value["source"]["Project"]["project_id"].as_str(),
            Some(OUTLAYER_PROJECT_ID)
        );
        assert_eq!(
            value["source"]["Project"]["version_key"].as_str(),
            Some(OUTLAYER_VERSION_KEY)
        );
        assert_eq!(
            value["source"]["Project"]["version_key"].as_str(),
            Some("8abfe08bc62919dd3f0aea2c2ea5dbe91d5484c14d6a55289053dce1d0387a6f")
        );
    }

    // Finding 6: passing None to set_reconciler clears the role back to
    // owner-only resolution.
    #[test]
    fn set_reconciler_none_clears_reconciler() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        c.set_reconciler(
            "policy-001".to_string(),
            Some("reconciler.testnet".parse().unwrap()),
        );
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().reconciler,
            Some("reconciler.testnet".parse().unwrap())
        );
        c.set_reconciler("policy-001".to_string(), None);
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().reconciler,
            None
        );
    }

    // Finding 6: passing Some to set_reconciler stores the account, and
    // passing None after that clears it again. The round trip proves
    // the Option<AccountId> JSON shape: an account id deserializes to
    // Some, null clears.
    #[test]
    fn set_reconciler_some_round_trip() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        c.set_reconciler(
            "policy-001".to_string(),
            Some("reconciler.testnet".parse().unwrap()),
        );
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().reconciler,
            Some("reconciler.testnet".parse().unwrap())
        );
        c.set_reconciler("policy-001".to_string(), None);
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().reconciler,
            None
        );
    }

    // Finding 6: the set_reconciler JSON wire shape is an account id
    // string or null. The method takes Option<AccountId>, so a JSON
    // string deserializes to Some and null deserializes to None.
    #[test]
    fn set_reconciler_option_account_id_json_shape() {
        let from_string: Option<AccountId> =
            serde_json::from_str("\"reconciler.testnet\"").unwrap();
        assert_eq!(from_string, Some("reconciler.testnet".parse().unwrap()));
        let from_null: Option<AccountId> = serde_json::from_str("null").unwrap();
        assert_eq!(from_null, None);
        let some: Option<AccountId> = Some("reconciler.testnet".parse().unwrap());
        assert_eq!(
            serde_json::to_string(&some).unwrap(),
            "\"reconciler.testnet\""
        );
        let none: Option<AccountId> = None;
        assert_eq!(serde_json::to_string(&none).unwrap(), "null");
    }

    // Finding 6: request_evidence on a frozen policy rejects.
    #[test]
    #[should_panic(expected = "ERR_POLICY_FROZEN")]
    fn request_evidence_rejects_frozen_policy() {
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
        c.freeze_policy("policy-001".to_string());
        c.request_evidence("obl-001".to_string());
    }

    // request_tee_verification on a frozen policy rejects, matching
    // request_evidence, so no vault-funded OutLayer deposit is filed.
    #[test]
    #[should_panic(expected = "ERR_POLICY_FROZEN")]
    fn request_tee_verification_rejects_frozen_policy() {
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id(owner());
        ctx.signer_account_id("cynexmaster.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        ctx.account_balance(NearToken::from_yoctonear(
            10_000_000_000_000_000_000_000_000,
        ));
        ctx.block_timestamp(1000);
        testing_env!(ctx.build());
        let mut c = Contract::init(owner());
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
            "TEE".to_string(),
            hex32("528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6"),
            1_000_000_000_000_000,
            1,
        );
        c.request_evidence("obl-001".to_string());
        c.freeze_policy("policy-001".to_string());
        let _ = c.request_tee_verification(
            "obl-001".to_string(),
            "https://example.com/evidence.bin".to_string(),
        );
    }

    // Finding 6: request_evidence on an already-expired obligation rejects.
    #[test]
    #[should_panic(expected = "ERR_OBLIGATION_EXPIRED")]
    fn request_evidence_rejects_expired_obligation() {
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
            1000,
            1,
        );
        owner_ctx_at(2000);
        c.request_evidence("obl-001".to_string());
    }

    // Finding 7: an expired obligation reports ERR_OBLIGATION_EXPIRED
    // from submit_evidence, while an unexpired obligation past its
    // evidence window still reports ERR_EVIDENCE_EXPIRED (covered by
    // submit_evidence_after_evidence_timeout_rejects).
    #[test]
    #[should_panic(expected = "ERR_OBLIGATION_EXPIRED")]
    fn submit_evidence_expired_obligation_reports_obligation_expired() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        owner_ctx_at(0);
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
        // Past the obligation expiry, inside the 1 hour evidence window,
        // so only the expiry guard fires.
        owner_ctx_at(2000);
        c.submit_evidence(
            "obl-001-1".to_string(),
            "obl-001".to_string(),
            "ALLOWED".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
        );
    }

    // Finding 8: an obligation with an unknown evidence type is rejected
    // by submit_evidence instead of falling through to the verifier path.
    // Built by direct insert, because create_obligation now whitelists
    // evidence types: the positive match here is defense in depth for
    // any obligation that reaches EVIDENCE_PENDING with an unknown type.
    #[test]
    #[should_panic(expected = "ERR_EVIDENCE_MISMATCH")]
    fn submit_evidence_rejects_unknown_evidence_type() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        let obligation = Obligation {
            obligation_id: "obl-001".to_string(),
            policy_id: "policy-001".to_string(),
            policy_version: 1,
            recipient: "acme-supplies.testnet".parse().unwrap(),
            amount: 250000,
            evidence_type: "unknown-type".to_string(),
            evidence_hash: hex32(
                "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38",
            ),
            expires_at_ns: 9999999999999999999,
            nonce: 1,
            state: "CREATED".to_string(),
            in_flight: false,
            transfer_attempt: 0,
            transfer_dispatched_at_ns: None,
            pending_request_id: None,
            pending_digest: None,
            evidence_requested_at_ns: None,
        };
        c.obligations.insert("obl-001".to_string(), obligation);
        c.request_evidence("obl-001".to_string());
        c.add_verifier(owner());
        c.submit_evidence(
            "obl-001-1".to_string(),
            "obl-001".to_string(),
            "ALLOWED".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
        );
    }

    // Finding 9: funding beyond the policy limit is refused in full.
    #[test]
    fn ft_on_transfer_rejects_over_limit_funding() {
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
        let unused = c.ft_on_transfer(
            "cynexmaster.testnet".parse().unwrap(),
            U128(800000),
            "{\"fund_policy\": \"policy-001\"}".to_string(),
        );
        assert_eq!(unused.0, 0);
        let refunded = c.ft_on_transfer(
            "cynexmaster.testnet".parse().unwrap(),
            U128(300000),
            "{\"fund_policy\": \"policy-001\"}".to_string(),
        );
        assert_eq!(refunded.0, 300000);
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().funded,
            800000
        );
    }

    // Finding 9: funding exactly to the limit still succeeds.
    #[test]
    fn ft_on_transfer_funding_exactly_to_limit_succeeds() {
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
        let unused = c.ft_on_transfer(
            "cynexmaster.testnet".parse().unwrap(),
            U128(1000000),
            "{\"fund_policy\": \"policy-001\"}".to_string(),
        );
        assert_eq!(unused.0, 0);
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().funded,
            1000000
        );
    }

    // A funded plus amount overflow with limit at u128::MAX refunds
    // the full amount instead of panicking in ft_on_transfer.
    #[test]
    fn ft_on_transfer_overflow_refunds_instead_of_panicking() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            u128::MAX,
        );
        let mut ctx = VMContextBuilder::new();
        ctx.predecessor_account_id("usdc.fakes.testnet".parse().unwrap());
        ctx.current_account_id("cynex-vault.testnet".parse().unwrap());
        testing_env!(ctx.build());
        let unused = c.ft_on_transfer(
            "cynexmaster.testnet".parse().unwrap(),
            U128(u128::MAX - 10),
            "{\"fund_policy\": \"policy-001\"}".to_string(),
        );
        assert_eq!(unused.0, 0);
        let refunded = c.ft_on_transfer(
            "cynexmaster.testnet".parse().unwrap(),
            U128(20),
            "{\"fund_policy\": \"policy-001\"}".to_string(),
        );
        assert_eq!(refunded.0, 20);
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().funded,
            u128::MAX - 10
        );
    }

    // Finding 9: the freeze brake still works on an already over-funded
    // policy, because the funded limit is enforced at ft_on_transfer
    // only, never in assert_policy_invariant.
    #[test]
    fn freeze_policy_still_works_on_over_funded_policy() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        let mut policy = c.get_policy("policy-001".to_string()).unwrap();
        policy.funded = 1500000;
        c.policies.insert("policy-001".to_string(), policy);
        c.freeze_policy("policy-001".to_string());
        assert!(c.get_policy("policy-001".to_string()).unwrap().frozen);
        c.unfreeze_policy("policy-001".to_string());
        assert!(!c.get_policy("policy-001".to_string()).unwrap().frozen);
    }

    // Finding 10: the owner can cancel from BLOCKED. No reservation or
    // token lock exists in that state, so cancel just retires it.
    #[test]
    fn cancel_obligation_from_blocked() {
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
            "BLOCK".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
        );
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "BLOCKED"
        );
        c.cancel_obligation("obl-001".to_string());
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "CANCELLED"
        );
    }

    // Finding 10: the owner can cancel from WARN_PENDING.
    #[test]
    fn cancel_obligation_from_warn_pending() {
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
        c.cancel_obligation("obl-001".to_string());
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "CANCELLED"
        );
    }

    // Defense in depth: a BLOCKED obligation with in_flight true
    // cannot occur through the normal flow, so the state is built by
    // hand here. Cancel must reject it instead of silently retiring
    // an obligation that still claims to be in flight.
    #[test]
    #[should_panic(expected = "ERR_INVALID_STATE")]
    fn cancel_obligation_from_blocked_with_in_flight_rejects() {
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
            "BLOCK".to_string(),
            "686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38".to_string(),
        );
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "BLOCKED"
        );
        let mut o = c.get_obligation("obl-001".to_string()).unwrap();
        o.in_flight = true;
        c.obligations.insert("obl-001".to_string(), o);
        c.cancel_obligation("obl-001".to_string());
    }

    // Finding 11: create_obligation rejects a zero amount.
    #[test]
    #[should_panic(expected = "ERR_TERMS_MISMATCH")]
    fn create_obligation_rejects_zero_amount() {
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
            0,
            "delivery-note".to_string(),
            hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
            9999999999999999999,
            1,
        );
    }

    // Finding 11: create_obligation rejects an already-expired obligation.
    #[test]
    #[should_panic(expected = "ERR_OBLIGATION_EXPIRED")]
    fn create_obligation_rejects_expired_obligation() {
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
            0,
            1,
        );
    }

    // Finding 11: create_obligation rejects an unknown evidence type.
    #[test]
    #[should_panic(expected = "ERR_EVIDENCE_MISMATCH")]
    fn create_obligation_rejects_unknown_evidence_type() {
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
            "preimage".to_string(),
            hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
            9999999999999999999,
            1,
        );
    }

    // Finding 11: all three known evidence types are accepted.
    #[test]
    fn create_obligation_accepts_all_three_evidence_types() {
        let mut c = setup_owner();
        c.create_policy(
            "policy-001".to_string(),
            "usdc.fakes.testnet".parse().unwrap(),
            1000000,
        );
        for (id, evidence_type) in [
            ("obl-preimage", "PREIMAGE"),
            ("obl-tee", "TEE"),
            ("obl-verifier", "delivery-note"),
        ] {
            c.create_obligation(
                id.to_string(),
                "policy-001".to_string(),
                "acme-supplies.testnet".parse().unwrap(),
                250000,
                evidence_type.to_string(),
                hex32("686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38"),
                9999999999999999999,
                1,
            );
            assert_eq!(c.get_obligation(id.to_string()).unwrap().state, "CREATED");
        }
    }

    // Expired READY cleanup: a PREIMAGE obligation that went READY
    // with a short expiry, then moved past it.
    fn expired_ready_setup() -> Contract {
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let mut c = preimage_setup_at(&evidence, "PREIMAGE", 1_000_000_000);
        as_other();
        c.submit_evidence_preimage("obl-001-1".to_string(), "obl-001".to_string(), evidence);
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "READY"
        );
        c
    }

    #[test]
    fn cancel_expired_ready_cleans_up_expired_ready() {
        let mut c = expired_ready_setup();
        let token: AccountId = "usdc.fakes.testnet".parse().unwrap();
        assert!(!is_token_locked(&token));
        let before = c.get_policy("policy-001".to_string()).unwrap();
        assert_eq!(c.receipts(0, 10).len(), 0);
        set_time_and_caller(owner(), 1_000_000_001);
        c.cancel_expired_ready("obl-001".to_string());
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "CANCELLED");
        assert!(!o.in_flight);
        assert_eq!(o.pending_request_id, None);
        let after = c.get_policy("policy-001".to_string()).unwrap();
        assert_eq!(after.spent, before.spent);
        assert_eq!(after.reserved, before.reserved);
        assert_eq!(after.funded, before.funded);
        assert_eq!(after.limit, before.limit);
        assert_eq!(c.receipts(0, 10).len(), 0);
        assert!(!is_token_locked(&token));
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_EXPIRED")]
    fn cancel_expired_ready_live_ready_rejects() {
        let mut c = expired_ready_setup();
        // At exactly expires_at_ns the obligation is still live:
        // settle accepts it while block_timestamp() <= expires_at_ns.
        set_time_and_caller(owner(), 1_000_000_000);
        c.cancel_expired_ready("obl-001".to_string());
    }

    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn cancel_expired_ready_non_owner_rejects() {
        let mut c = expired_ready_setup();
        set_time_and_caller(other(), 1_000_000_001);
        c.cancel_expired_ready("obl-001".to_string());
    }

    #[test]
    #[should_panic(expected = "ERR_INVALID_STATE")]
    fn cancel_expired_ready_created_rejects() {
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
            1_000_000_000,
            1,
        );
        set_time_and_caller(owner(), 1_000_000_001);
        c.cancel_expired_ready("obl-001".to_string());
    }

    #[test]
    #[should_panic(expected = "ERR_INVALID_STATE")]
    fn cancel_expired_ready_settle_afterwards_rejects() {
        let mut c = expired_ready_setup();
        set_time_and_caller(owner(), 1_000_000_001);
        c.cancel_expired_ready("obl-001".to_string());
        set_time_and_caller(other(), 1_000_000_001);
        let _ = c.settle(
            "obl-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            U128(250000),
            "x".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_INVALID_STATE")]
    fn cancel_expired_ready_in_flight_rejects() {
        let mut c = expired_ready_setup();
        // A READY record that somehow still claims in_flight must
        // never be cleaned up: in_flight means a transfer may still
        // land or a reservation may still be held.
        let mut o = c.get_obligation("obl-001".to_string()).unwrap();
        o.in_flight = true;
        c.obligations.insert("obl-001".to_string(), o);
        set_time_and_caller(owner(), 1_000_000_001);
        c.cancel_expired_ready("obl-001".to_string());
    }

    #[test]
    fn cancel_expired_ready_removes_tee_request_record() {
        let mut c = expired_ready_setup();
        // The TeeRequest map is keyed by obligation id, like every
        // other use of prefix b"t": request_tee_verification inserts
        // by obligation id, on_tee_result and mark_evidence_timeout
        // remove by obligation id. The pending request id
        // ("obl-001-1") is the evidence request id, not a map key.
        let mut requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        requests.insert(
            "obl-001".to_string(),
            TeeRequest {
                obligation_id: "obl-001".to_string(),
                evidence_url: "https://example.invalid/evidence".to_string(),
                seed: "obl-001-1-0-00".to_string(),
                requested_at_ns: 0,
                sender: owner(),
            },
        );
        assert!(requests.get(&"obl-001".to_string()).is_some());
        set_time_and_caller(owner(), 1_000_000_001);
        c.cancel_expired_ready("obl-001".to_string());
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert_eq!(requests.get(&"obl-001".to_string()), None);
    }

    #[test]
    fn cancel_expired_ready_tee_origin_cleans_up_and_late_callback_noop() {
        let mut c = tee_setup_for("cynexmaster.testnet", "test-seed");
        as_vault("cynexmaster.testnet");
        c.on_tee_result("test-seed".to_string(), Ok(tee_output_json()));
        assert_eq!(
            c.get_obligation("test-seed".to_string()).unwrap().state,
            "READY"
        );
        set_time_and_caller(owner(), 1_000_000_000_000_001);
        c.cancel_expired_ready("test-seed".to_string());
        let o = c.get_obligation("test-seed".to_string()).unwrap();
        assert_eq!(o.state, "CANCELLED");
        assert_eq!(o.pending_request_id, None);
        assert_eq!(o.pending_digest, None);
        assert_eq!(o.evidence_requested_at_ns, None);
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert_eq!(requests.get(&"test-seed".to_string()), None);
        // A late TEE callback must not resurrect the obligation, even
        // if a stale request record is present: on_tee_result returns
        // early unless the obligation is EVIDENCE_PENDING.
        let mut requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        requests.insert(
            "test-seed".to_string(),
            TeeRequest {
                obligation_id: "test-seed".to_string(),
                evidence_url: "https://test.fastfs.io/cynexmaster.testnet/outlayer.testnet/528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6.wasm".to_string(),
                seed: "test-seed-1-0-528f5c78da9fd97698f20eb21a5e405aa9aa6aec54ee17218b1060549e3725b6".to_string(),
                requested_at_ns: 1000,
                sender: "cynexmaster.testnet".parse().unwrap(),
            },
        );
        as_vault("cynexmaster.testnet");
        c.on_tee_result("test-seed".to_string(), Ok(tee_output_json()));
        assert_eq!(
            c.get_obligation("test-seed".to_string()).unwrap().state,
            "CANCELLED"
        );
        let requests: LookupMap<String, TeeRequest> = LookupMap::new(b"t");
        assert_eq!(requests.get(&"test-seed".to_string()), None);
    }

    #[test]
    #[should_panic(expected = "ERR_OBLIGATION_MISSING")]
    fn cancel_expired_ready_missing_rejects() {
        let mut c = setup_owner();
        set_time_and_caller(owner(), 1_000_000_001);
        c.cancel_expired_ready("no-such-obligation".to_string());
    }

    #[test]
    fn cancel_expired_ready_resolve_ready_releases_nothing() {
        // The resolve_settlement READY path: the obligation held a
        // reservation and a token lock while TRANSFER_PENDING, and
        // resolve released both. Cleaning it up after expiry must
        // change no policy counter and create no receipt.
        let mut c = setup_owner();
        setup_transfer_pending(&mut c, "obl-001", 250000);
        // The reservation is held while TRANSFER_PENDING: settle took
        // it before dispatch, and resolve must release it.
        assert_eq!(
            c.get_policy("policy-001".to_string()).unwrap().reserved,
            250000
        );
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.mark_reconciliation_required("obl-001".to_string());
        owner_ctx_at(TRANSFER_TIMEOUT_NS);
        c.resolve_settlement("obl-001".to_string(), "READY".to_string(), "".to_string());
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "READY");
        assert_eq!(c.get_policy("policy-001".to_string()).unwrap().reserved, 0);
        let token: AccountId = "usdc.fakes.testnet".parse().unwrap();
        assert!(!is_token_locked(&token));
        // The fixture expiry is 9999999999999999999, so move past it.
        owner_ctx_at(10_000_000_000_000_000_000);
        c.cancel_expired_ready("obl-001".to_string());
        let o = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(o.state, "CANCELLED");
        let policy = c.get_policy("policy-001".to_string()).unwrap();
        assert_eq!(policy.spent, 0);
        assert_eq!(policy.reserved, 0);
        assert_eq!(policy.funded, 1000000);
        assert_eq!(c.receipts(0, 10).len(), 0);
        assert!(!is_token_locked(&token));
    }

    #[test]
    fn cancel_expired_ready_allows_recreation_with_new_id() {
        // The duplicate check in create_obligation is by obligation
        // id only, not by digest, so a cleaned-up obligation can be
        // re-created with a fresh id and a fresh nonce, the same
        // remediation the contract already prescribes for a retry.
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let digest_vec = env::sha256(&evidence);
        let mut digest = [0u8; 32];
        digest.copy_from_slice(&digest_vec);
        let mut c = preimage_setup_at(&evidence, "PREIMAGE", 1_000_000_000);
        as_other();
        c.submit_evidence_preimage("obl-001-1".to_string(), "obl-001".to_string(), evidence);
        set_time_and_caller(owner(), 1_000_000_001);
        c.cancel_expired_ready("obl-001".to_string());
        // Pin the cancel and the digest: the re-created obligation
        // must carry the same committed digest as the cancelled one,
        // or the test would pass even with a no-op cancel or a
        // different digest.
        let cancelled = c.get_obligation("obl-001".to_string()).unwrap();
        assert_eq!(cancelled.state, "CANCELLED");
        assert_eq!(cancelled.evidence_hash, digest);
        c.create_obligation(
            "obl-002".to_string(),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            250000,
            "PREIMAGE".to_string(),
            digest,
            2_000_000_000,
            2,
        );
        let recreated = c.get_obligation("obl-002".to_string()).unwrap();
        assert_eq!(recreated.state, "CREATED");
        assert_eq!(recreated.evidence_hash, digest);
    }

    #[test]
    #[should_panic(expected = "ERR_OBLIGATION_EXISTS")]
    fn cancel_expired_ready_same_id_cannot_recreate() {
        let mut c = expired_ready_setup();
        set_time_and_caller(owner(), 1_000_000_001);
        c.cancel_expired_ready("obl-001".to_string());
        assert_eq!(
            c.get_obligation("obl-001".to_string()).unwrap().state,
            "CANCELLED"
        );
        let evidence = b"delivery-note-001:obl-001:250000".to_vec();
        let digest_vec = env::sha256(&evidence);
        let mut digest = [0u8; 32];
        digest.copy_from_slice(&digest_vec);
        c.create_obligation(
            "obl-001".to_string(),
            "policy-001".to_string(),
            "acme-supplies.testnet".parse().unwrap(),
            250000,
            "PREIMAGE".to_string(),
            digest,
            2_000_000_000,
            2,
        );
    }
}
