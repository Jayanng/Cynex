/**
 * Cynex contract API - frontend TypeScript mirror, frozen.
 *
 * Method and view shapes are taken verbatim (argument names and
 * order) from docs/contract-api.md (commit 5eee26a).
 * This file types the frozen API only. It does not implement a
 * contract client, does not call a contract, and does not invent
 * a method, a view, or a return shape the frozen document does not
 * state. Where the frozen document leaves a shape open (notably
 * the full state() view), that is marked below, not filled in.
 */
import type { EvidenceResult, ObligationState, Policy, Obligation, Receipt } from "./schema.js";

export const SCHEMA_VERSION = "cynex-v1.0.0";
export const TRANSFER_TIMEOUT_NS = 600_000_000_000n;
export const EVIDENCE_TIMEOUT_NS = 3_600_000_000_000n;

/** Mirror of Rust to_hex: bytes to lowercase hex. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Mirror of Rust hex_to_32: a 64-hex-character string to its
 * normalized lowercase hex form. Trims surrounding whitespace,
 * like Rust, then requires exactly 64 hex characters.
 */
export function hexTo32(value: string): string {
  const cleaned = value.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(cleaned)) {
    throw new Error("expected 64 hex characters (32 bytes)");
  }
  return cleaned.toLowerCase();
}

/**
 * Frozen request_evidence formula (contract-api.md): pending_request_id
 * is obligation_id + "-" + nonce as a decimal string.
 */
export function pendingRequestId(obligation_id: string, nonce: bigint): string {
  return obligation_id + "-" + nonce.toString();
}

/* Owner methods: caller is the owner, signed by wallet or CLI. */
export interface CreatePolicyArgs {
  policy_id: string;
  owner: string;
  token_id: string;
  limit: bigint;
  reconciler: string | null;
}
export interface SetReconcilerArgs {
  policy_id: string;
  reconciler: string | null;
}
export interface CreateObligationArgs {
  policy_id: string;
  obligation_id: string;
  recipient: string;
  amount: bigint;
  evidence_type: string;
  evidence_hash: string;
  expires_at_ns: bigint;
}
export interface PolicyIdArgs {
  policy_id: string;
}
export interface ObligationIdArgs {
  obligation_id: string;
}
export interface AddVerifierArgs {
  account_id: string;
}

/* Agent / anyone method: checked parameters, vault is authoritative. */
export interface SettleArgs {
  obligation_id: string;
  proposed_recipient: string;
  proposed_amount: bigint;
  evidence_ref: string;
}

/* Verifier method: predecessor must be in the allowlisted set, not private. */
export interface SubmitEvidenceArgs {
  request_id: string;
  obligation_id: string;
  result: EvidenceResult;
  proof: string;
}

/* Timeout / resolution methods: owner or policy reconciler. */
export interface MarkEvidenceTimeoutArgs {
  obligation_id: string;
  escalate: boolean;
}
export type ResolveOutcome = "PAID" | "READY" | "CANCELLED";
export interface ResolveSettlementArgs {
  obligation_id: string;
  outcome: ResolveOutcome;
  proof: string;
}

/* Funding: ft_transfer_call through ft_on_transfer only. */
export interface FundPolicyMessage {
  fund_policy: string;
}
export interface FtOnTransferArgs {
  sender_id: string;
  amount: bigint;
  msg: FundPolicyMessage;
}

/* Views: anyone may call. */
export interface Balances {
  spent: bigint;
  reserved: bigint;
  limit: bigint;
  native_headroom: bigint;
}
export interface ReceiptsArgs {
  start: bigint;
  limit: bigint;
}
/**
 * state() view: the frozen document guarantees only that it returns
 * vault-level state including frozen flags and the verifier set size,
 * without leaking keys. Fields beyond verifier_set_size are not
 * frozen in the schema crate, so they are not typed here.
 */
export interface VaultState {
  verifier_set_size: number;
}

/* cynex-verify CSV row, columns frozen in contract-api.md. */
export interface CynexVerifyCsvRow {
  index: bigint;
  prev_hash: string;
  obligation_id: string;
  recipient: string;
  amount: bigint;
  token_id: string;
  timestamp: bigint;
  tx_ref: string;
  verified_ok: boolean;
}

export type { Policy, Obligation, Receipt, ObligationState };
