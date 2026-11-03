/**
 * Cynex schema — Lane B TypeScript mirror, Phase 0 DRAFT.
 *
 * Field lists are taken from build plan §3.1.1 / §3.1.8 / §3.1.10.
 * Field types that the plan states explicitly are encoded here:
 * token amounts are u128 base units (BigInt), nonce / expiry /
 * policy version / receipt index / timestamp are u64 (BigInt).
 * Everything else that the Rust freeze has not yet published
 * (exact Rust field order, optionality of pending_* fields, and the
 * exact TrustMode enum shape) is marked DRAFT and must be confirmed
 * against schemas/cynex-v1.0.0/ before Phase 0 sign-off.
 */

export type EvidenceResult = "ALLOWED" | "WARN" | "BLOCK";

export type ReasonCode =
  | "RECIPIENT_SUBSTITUTION"
  | "TERMS_MISMATCH"
  | "NONCE_ALREADY_CONSUMED"
  | "BUDGET_EXCEEDED"
  | "OBLIGATION_EXPIRED"
  | "POLICY_FROZEN"
  | "VAULT_STORAGE_EXHAUSTED"
  | "EVIDENCE_MISMATCH"
  | "EVIDENCE_EXPIRED"
  | "UNAUTHORIZED_VERIFIER"
  | "TRANSFER_FAILED";

export type ObligationState =
  | "CREATED"
  | "EVIDENCE_PENDING"
  | "READY"
  | "WARN_PENDING"
  | "BLOCKED"
  | "CANCELLED"
  | "TRANSFER_PENDING"
  | "PAID"
  | "RECONCILIATION_REQUIRED";

/**
 * Trust modes, plan §3.1.8. DRAFT: the plan labels these modes but
 * does not give a Rust enum definition; the freeze must confirm
 * whether these are the TrustMode enum variants or a separate
 * attestation label.
 */
export type TrustMode =
  | "ON_CHAIN_ATTESTATION_VERIFIED"
  | "OUTLAYER_CALLBACK"
  | "TRUSTED_RELAYER"
  | "FIXTURE";

export interface Policy {
  policy_id: string;
  owner: string;
  token_id: string;
  /** u128 base units */
  limit: bigint;
  /** u128 base units */
  spent: bigint;
  /** u128 base units */
  reserved: bigint;
  frozen: boolean;
  /** u64 */
  version: bigint;
}

export interface Obligation {
  obligation_id: string;
  policy_id: string;
  recipient: string;
  /** u128 base units */
  amount: bigint;
  evidence_type: string;
  /** 32-byte hash, 64 hex characters */
  evidence_hash: string;
  /** u64, nanoseconds */
  expires_at_ns: bigint;
  /** u64, per-obligation, consumed on first settle */
  nonce: bigint;
  state: ObligationState;
  /** DRAFT optionality: null when no evidence request is open. */
  pending_request_id: string | null;
  /** DRAFT optionality: settlement digest (§3.1.3), null when none open. */
  pending_digest: string | null;
}

export interface Receipt {
  /** u64 */
  index: bigint;
  /** 32-byte hash, 64 hex characters; genesis receipt uses 32 zero bytes */
  prev_hash: string;
  obligation_id: string;
  recipient: string;
  /** u128 base units */
  amount: bigint;
  token_id: string;
  /** u64, nanoseconds */
  timestamp: bigint;
  tx_ref: string;
}
