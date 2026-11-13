/**
 * Cynex schema — frontend TypeScript mirror, DRAFT.
 *
 * Field lists and types mirror the frozen schema in
 * docs/contract-api.md (commit 5eee26a) and Rust
 * schemas/cynex-v1.0.0/src/lib.rs. Token amounts are u128 base units
 * (BigInt), nonce / expiry / policy version / receipt index /
 * timestamp are u64 (BigInt). Policy version starts at 0 and
 * increments only on an owner-approved policy change, never on
 * freeze/unfreeze (frozen contract-api correction to the plan).
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

/** Trust modes, frozen in docs/contract-api.md. FIXTURE is a test label only. */
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
  /** u128 base units, credited by ft_on_transfer, never vault balance */
  funded: bigint;
  frozen: boolean;
  /** u64, starts 0 */
  version: bigint;
  /** account id or null; null means owner-only for timeout/resolution */
  reconciler: string | null;
}

export interface Obligation {
  obligation_id: string;
  policy_id: string;
  /** u64, copied from the policy version at creation */
  policy_version: bigint;
  recipient: string;
  /** u128 base units */
  amount: bigint;
  evidence_type: string;
  /** 32-byte hash, 64 hex characters */
  evidence_hash: string;
  /** u64, nanoseconds */
  expires_at_ns: bigint;
  /** u64, per-obligation; locked while in_flight, consumed on PAID */
  nonce: bigint;
  state: ObligationState;
  /** true only while a transfer promise is outstanding */
  in_flight: boolean;
  /** u64, starts 0, increments by 1 on each dispatch */
  transfer_attempt: bigint;
  /** u64 or null, set only on dispatch, cleared on callback/resolution */
  transfer_dispatched_at_ns: bigint | null;
  /** null when no evidence request is open */
  pending_request_id: string | null;
  /** settlement digest, 64 hex chars, or null when none open */
  pending_digest: string | null;
  /** u64 or null, set only by request_evidence */
  evidence_requested_at_ns: bigint | null;
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
