// Cynex schema, version 1.0.0, frozen in Phase 0.
//
// This crate holds the shared types and the two hashes, and nothing
// else. It is not the contract. The contract, in a later phase, will
// use these types and must not invent its own copies of them.
//
// Encoding rules, from the frozen spec:
// - The settlement digest starts with the domain tag as raw ASCII.
// - Every other string field is a u32 big-endian length prefix
//   followed by UTF-8 bytes.
// - Integers are fixed width and big-endian: u64 for policy version,
//   nonce and expiry, u128 for amounts.
// - evidence_hash is always raw 32 bytes, with no length prefix.
// - Both hashes are SHA-256 over the encoded bytes.

use sha2::{Digest, Sha256};

pub const DOMAIN_TAG: &str = "CYNEX_SETTLEMENT_V1";
pub const NETWORK_ID: &str = "testnet";
pub const SCHEMA_VERSION: &str = "cynex-v1.0.0";

/// Ten minutes, in nanoseconds. After this, an obligation stuck in
/// TRANSFER_PENDING may be moved to RECONCILIATION_REQUIRED by the
/// owner or reconciler. A contract cannot move itself, so the move
/// always needs that explicit call.
pub const TRANSFER_TIMEOUT_NS: u64 = 600_000_000_000;
/// One hour, in nanoseconds. After this, an obligation stuck in
/// EVIDENCE_PENDING may be moved by the owner or reconciler.
/// It never moves to READY by default when evidence is missing.
pub const EVIDENCE_TIMEOUT_NS: u64 = 3_600_000_000_000;

fn append_string(out: &mut Vec<u8>, value: &str) {
    let bytes = value.as_bytes();
    let len = u32::try_from(bytes.len()).expect("string field exceeds 4 GiB");
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(bytes);
}

fn append_u64(out: &mut Vec<u8>, value: u64) {
    out.extend_from_slice(&value.to_be_bytes());
}

fn append_u128(out: &mut Vec<u8>, value: u128) {
    out.extend_from_slice(&value.to_be_bytes());
}

pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn hex_to_32(value: &str) -> Result<[u8; 32], String> {
    if !value.is_ascii() {
        return Err("expected ASCII hex".to_string());
    }
    let cleaned = value.trim();
    if !cleaned.is_ascii() {
        return Err("expected ASCII hex".to_string());
    }
    if cleaned.len() != 64 {
        return Err(format!("expected 64 hex chars, got {}", cleaned.len()));
    }
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&cleaned[i * 2..i * 2 + 2], 16)
            .map_err(|_| format!("invalid hex at byte {}", i))?;
    }
    Ok(out)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReasonCode {
    RecipientSubstitution,
    TermsMismatch,
    NonceAlreadyConsumed,
    BudgetExceeded,
    ObligationExpired,
    PolicyFrozen,
    VaultStorageExhausted,
    EvidenceMismatch,
    EvidenceExpired,
    UnauthorizedVerifier,
    TransferFailed,
}

impl ReasonCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ReasonCode::RecipientSubstitution => "RECIPIENT_SUBSTITUTION",
            ReasonCode::TermsMismatch => "TERMS_MISMATCH",
            ReasonCode::NonceAlreadyConsumed => "NONCE_ALREADY_CONSUMED",
            ReasonCode::BudgetExceeded => "BUDGET_EXCEEDED",
            ReasonCode::ObligationExpired => "OBLIGATION_EXPIRED",
            ReasonCode::PolicyFrozen => "POLICY_FROZEN",
            ReasonCode::VaultStorageExhausted => "VAULT_STORAGE_EXHAUSTED",
            ReasonCode::EvidenceMismatch => "EVIDENCE_MISMATCH",
            ReasonCode::EvidenceExpired => "EVIDENCE_EXPIRED",
            ReasonCode::UnauthorizedVerifier => "UNAUTHORIZED_VERIFIER",
            ReasonCode::TransferFailed => "TRANSFER_FAILED",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrustMode {
    OnChainAttestationVerified,
    OutlayerCallback,
    TrustedRelayer,
    Fixture,
}

impl TrustMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            TrustMode::OnChainAttestationVerified => "ON_CHAIN_ATTESTATION_VERIFIED",
            TrustMode::OutlayerCallback => "OUTLAYER_CALLBACK",
            TrustMode::TrustedRelayer => "TRUSTED_RELAYER",
            TrustMode::Fixture => "FIXTURE",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvidenceResult {
    Allowed,
    Warn,
    Block,
}

impl EvidenceResult {
    pub fn as_str(&self) -> &'static str {
        match self {
            EvidenceResult::Allowed => "ALLOWED",
            EvidenceResult::Warn => "WARN",
            EvidenceResult::Block => "BLOCK",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObligationState {
    Created,
    EvidencePending,
    WarnPending,
    Ready,
    TransferPending,
    Paid,
    Blocked,
    Cancelled,
    ReconciliationRequired,
}

impl ObligationState {
    pub fn as_str(&self) -> &'static str {
        match self {
            ObligationState::Created => "CREATED",
            ObligationState::EvidencePending => "EVIDENCE_PENDING",
            ObligationState::WarnPending => "WARN_PENDING",
            ObligationState::Ready => "READY",
            ObligationState::TransferPending => "TRANSFER_PENDING",
            ObligationState::Paid => "PAID",
            ObligationState::Blocked => "BLOCKED",
            ObligationState::Cancelled => "CANCELLED",
            ObligationState::ReconciliationRequired => "RECONCILIATION_REQUIRED",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Policy {
    pub policy_id: String,
    pub owner: String,
    pub token_id: String,
    pub limit: u128,
    pub spent: u128,
    pub reserved: u128,
    pub funded: u128,
    pub frozen: bool,
    pub version: u64,
    pub reconciler: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Obligation {
    pub obligation_id: String,
    pub policy_id: String,
    pub policy_version: u64,
    pub recipient: String,
    pub amount: u128,
    pub evidence_type: String,
    pub evidence_hash: [u8; 32],
    pub expires_at_ns: u64,
    pub nonce: u64,
    pub state: ObligationState,
    pub in_flight: bool,
    pub transfer_attempt: u64,
    pub transfer_dispatched_at_ns: Option<u64>,
    pub pending_request_id: Option<String>,
    pub pending_digest: Option<[u8; 32]>,
    pub evidence_requested_at_ns: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Receipt {
    pub index: u64,
    pub prev_hash: [u8; 32],
    pub obligation_id: String,
    pub recipient: String,
    pub amount: u128,
    pub token_id: String,
    pub timestamp: u64,
    pub tx_ref: String,
}

#[allow(clippy::too_many_arguments)]
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
    expiry_ns: u64,
) -> [u8; 32] {
    assert_eq!(
        network_id, NETWORK_ID,
        "settlement digest is frozen to testnet, got a different network id"
    );
    let mut encoded = Vec::new();
    encoded.extend_from_slice(DOMAIN_TAG.as_bytes());
    append_string(&mut encoded, network_id);
    append_string(&mut encoded, vault_id);
    append_string(&mut encoded, policy_id);
    append_u64(&mut encoded, policy_version);
    append_string(&mut encoded, obligation_id);
    append_string(&mut encoded, token_id);
    append_string(&mut encoded, recipient);
    append_u128(&mut encoded, amount);
    append_string(&mut encoded, evidence_type);
    encoded.extend_from_slice(evidence_hash);
    append_u64(&mut encoded, nonce);
    append_u64(&mut encoded, expiry_ns);
    let mut hasher = Sha256::new();
    hasher.update(&encoded);
    hasher.finalize().into()
}

pub fn receipt_hash(receipt: &Receipt) -> [u8; 32] {
    let mut encoded = Vec::new();
    append_u64(&mut encoded, receipt.index);
    encoded.extend_from_slice(&receipt.prev_hash);
    append_string(&mut encoded, &receipt.obligation_id);
    append_string(&mut encoded, &receipt.recipient);
    append_u128(&mut encoded, receipt.amount);
    append_string(&mut encoded, &receipt.token_id);
    append_u64(&mut encoded, receipt.timestamp);
    append_string(&mut encoded, &receipt.tx_ref);
    let mut hasher = Sha256::new();
    hasher.update(&encoded);
    hasher.finalize().into()
}

pub fn genesis_prev_hash() -> [u8; 32] {
    [0u8; 32]
}

#[cfg(test)]
mod fix_tests {
    use super::*;

    #[test]
    fn hex_to_32_rejects_non_ascii_without_panic() {
        let bad = "a\u{e9}".to_string() + &"a".repeat(61);
        assert_eq!(bad.as_bytes().len(), 64);
        assert!(hex_to_32(&bad).is_err());
    }

    #[test]
    #[should_panic(expected = "frozen to testnet")]
    fn settlement_digest_rejects_other_network() {
        settlement_digest(
            "mainnet",
            "vault.testnet",
            "pol-1",
            1,
            "obl-1",
            "usdc.fakes.testnet",
            "acme-supplies.testnet",
            100,
            "invoice",
            &[0u8; 32],
            1,
            1000,
        );
    }
}

#[cfg(test)]
mod sol_fix_tests {
    use super::*;

    #[test]
    fn hex_rejects_non_ascii_whitespace_before_trim() {
        let bad = "\u{a0}".to_string() + &"a".repeat(64);
        assert!(hex_to_32(&bad).is_err());
    }

    #[test]
    fn obligation_records_policy_version_and_lock() {
        let o = Obligation {
            obligation_id: "obl-1".to_string(),
            policy_id: "pol-1".to_string(),
            policy_version: 0,
            recipient: "acme-supplies.testnet".to_string(),
            amount: 100,
            evidence_type: "invoice".to_string(),
            evidence_hash: [0u8; 32],
            expires_at_ns: 1000,
            nonce: 1,
            state: ObligationState::Created,
            in_flight: false,
            transfer_attempt: 0,
            transfer_dispatched_at_ns: None,
            pending_request_id: None,
            pending_digest: None,
            evidence_requested_at_ns: None,
        };
        assert_eq!(o.policy_version, 0);
        assert!(!o.in_flight);
    }
}
