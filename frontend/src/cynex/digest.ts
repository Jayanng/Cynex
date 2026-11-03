/**
 * Cynex settlement digest — Lane B TypeScript mirror, Phase 0 DRAFT.
 *
 * Implements build plan §3.1.3 exactly as written there. This is NOT the
 * frozen Rust schema: Jayaang has not yet landed schemas/cynex-v1.0.0/ or
 * docs/contract-api.md on Master, so this mirror must be cross-checked
 * against his Rust implementation before Phase 0 can be signed. If Rust
 * disagrees on any encoding choice below, the freeze must resolve it and
 * this file must be updated — a hash mismatch is a loud failure, not a
 * detail to paper over.
 *
 * Encoding (§3.1.3):
 *   domain || network_id || vault_id || policy_id || policy_version ||
 *   obligation_id || token_id || recipient || amount || evidence_type ||
 *   evidence_hash || nonce || expiry
 *   - domain = "CYNEX_SETTLEMENT_V1" (ASCII), network_id = "testnet".
 *   - Variable strings (including domain and network_id) are encoded as
 *     u32 big-endian length prefix + UTF-8 bytes. This is the reading of
 *     §3.1.3 that treats domain/network_id as strings under the general
 *     variable-field rule; evidence_hash is the one stated exception,
 *     encoded as raw 32 bytes with NO length prefix. If Rust encodes
 *     domain/network_id as raw bytes instead, the 6 vectors will differ
 *     and that must be settled at freeze time.
 *   - Integers are fixed width, big-endian: u64 for policy_version,
 *     nonce and expiry (expires_at_ns); u128 for amount.
 *   - SHA-256 over the concatenation.
 *   - All u64/u128 values MUST be BigInt. Passing a JS Number throws:
 *     timestamps above 2^53 lose precision as Number, and the plan
 *     (§3.1.3 audit fix) calls a Number-based vector a failure.
 */
import { createHash } from "node:crypto";

export const SETTLEMENT_DOMAIN = "CYNEX_SETTLEMENT_V1";
export const SETTLEMENT_NETWORK = "testnet";

export interface SettlementDigestInput {
  vault_id: string;
  policy_id: string;
  policy_version: bigint;
  obligation_id: string;
  token_id: string;
  recipient: string;
  amount: bigint;
  evidence_type: string;
  /** 32-byte SHA-256 hash, as 64 lowercase/uppercase hex characters. */
  evidence_hash: string;
  nonce: bigint;
  /** expires_at_ns */
  expiry: bigint;
}

function u32be(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value, 0);
  return buf;
}

function u64be(value: bigint): Buffer {
  if (typeof value !== "bigint") throw new TypeError("u64 value must be BigInt, not Number");
  if (value < 0n || value > 0xffffffffffffffffn) throw new RangeError("u64 value out of range");
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(value, 0);
  return buf;
}

function u128be(value: bigint): Buffer {
  if (typeof value !== "bigint") throw new TypeError("u128 value must be BigInt, not Number");
  if (value < 0n || value > (1n << 128n) - 1n) throw new RangeError("u128 value out of range");
  const buf = Buffer.alloc(16);
  let v = value;
  for (let i = 15; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

function lengthPrefixed(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([u32be(bytes.length), bytes]);
}

function evidenceHashBytes(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("evidence_hash must be exactly 64 hex characters (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

export function encodeSettlementDigest(input: SettlementDigestInput): Buffer {
  return Buffer.concat([
    lengthPrefixed(SETTLEMENT_DOMAIN),
    lengthPrefixed(SETTLEMENT_NETWORK),
    lengthPrefixed(input.vault_id),
    lengthPrefixed(input.policy_id),
    u64be(input.policy_version),
    lengthPrefixed(input.obligation_id),
    lengthPrefixed(input.token_id),
    lengthPrefixed(input.recipient),
    u128be(input.amount),
    lengthPrefixed(input.evidence_type),
    evidenceHashBytes(input.evidence_hash),
    u64be(input.nonce),
    u64be(input.expiry),
  ]);
}

export function settlementDigest(input: SettlementDigestInput): string {
  return createHash("sha256").update(encodeSettlementDigest(input)).digest("hex");
}
