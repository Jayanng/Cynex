/**
 * Cynex receipt hash — Lane B mirror, plan §3.1.10 (frozen in the plan
 * itself, so cynex-verify can be built against it; still subject to
 * the Phase 0 Rust cross-check like the settlement digest).
 *
 * receipt_hash = SHA-256(
 *   index_u64_BE || prev_hash_32_bytes ||
 *   obligation_id_len_u32_BE || obligation_id_UTF8 ||
 *   recipient_len_u32_BE || recipient_UTF8 ||
 *   amount_u128_BE ||
 *   token_id_len_u32_BE || token_id_UTF8 ||
 *   timestamp_u64_BE ||
 *   tx_ref_len_u32_BE || tx_ref_UTF8 )
 * Genesis receipt: prev_hash = 32 zero bytes.
 * This is a different hash from the settlement digest (§3.1.3);
 * the two must never be interchanged.
 */
import { createHash } from "node:crypto";
import type { Receipt } from "./schema.js";

export const GENESIS_PREV_HASH = "00".repeat(32);

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

function hashBytes(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("hash must be exactly 64 hex characters (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

export function receiptHash(receipt: Receipt): string {
  const encoded = Buffer.concat([
    u64be(receipt.index),
    hashBytes(receipt.prev_hash),
    lengthPrefixed(receipt.obligation_id),
    lengthPrefixed(receipt.recipient),
    u128be(receipt.amount),
    lengthPrefixed(receipt.token_id),
    u64be(receipt.timestamp),
    lengthPrefixed(receipt.tx_ref),
  ]);
  return createHash("sha256").update(encoded).digest("hex");
}
