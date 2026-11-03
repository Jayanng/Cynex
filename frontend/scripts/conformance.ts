/**
 * Cynex conformance — Lane B, Phase 0 DRAFT.
 *
 * Reads tests/test-vectors/vectors.json (exactly 6 vectors), recomputes
 * each settlement digest with the TypeScript mirror, and prints
 * "name <sha256>" per vector. Exit codes follow the plan §Phase 0
 * loud-failure rule:
 *   - any mismatch: print "expected <hex> got <hex>" for that vector
 *     and exit non-zero;
 *   - a deliberate single-byte change (amount + 1 on vector 0) must
 *     change the hash; if it does not, exit non-zero;
 *   - passing a JS Number for a u64/u128 field must throw; if it
 *     does not, exit non-zero.
 * Usage (after tsc): node dist/scripts/conformance.js
 * The plan names this "npx jest conformance"; this repo uses the
 * Node runner + tsc for Phase 0 DRAFT to avoid adding a test framework
 * before the freeze. The check itself (same 6 hashes, loud failure)
 * is identical, and a jest wrapper can be added at freeze time.
 */
import { readFileSync } from "node:fs";
import { settlementDigest } from "../src/cynex/digest.js";

interface VectorJson {
  name: string;
  vault_id: string;
  policy_id: string;
  policy_version: string;
  obligation_id: string;
  token_id: string;
  recipient: string;
  amount: string;
  evidence_type: string;
  evidence_hash: string;
  nonce: string;
  expiry: string;
  settlement_digest: string;
}

const path = new URL("../../../tests/test-vectors/vectors.json", import.meta.url);
const data = JSON.parse(readFileSync(path, "utf8")) as { vectors: VectorJson[] };
if (data.vectors.length !== 6) {
  console.error(`expected exactly 6 vectors, got ${data.vectors.length}`);
  process.exit(1);
}

let failed = false;
for (const v of data.vectors) {
  const got = settlementDigest({
    vault_id: v.vault_id,
    policy_id: v.policy_id,
    policy_version: BigInt(v.policy_version),
    obligation_id: v.obligation_id,
    token_id: v.token_id,
    recipient: v.recipient,
    amount: BigInt(v.amount),
    evidence_type: v.evidence_type,
    evidence_hash: v.evidence_hash,
    nonce: BigInt(v.nonce),
    expiry: BigInt(v.expiry),
  });
  console.log(`${v.name} ${got}`);
  if (got !== v.settlement_digest) {
    console.error(`${v.name}: expected ${v.settlement_digest} got ${got}`);
    failed = true;
  }
}

// Single-byte-change sensitivity: amount + 1 must change the hash.
const first = data.vectors[0];
const tampered = settlementDigest({
  vault_id: first.vault_id,
  policy_id: first.policy_id,
  policy_version: BigInt(first.policy_version),
  obligation_id: first.obligation_id,
  token_id: first.token_id,
  recipient: first.recipient,
  amount: BigInt(first.amount) + 1n,
  evidence_type: first.evidence_type,
  evidence_hash: first.evidence_hash,
  nonce: BigInt(first.nonce),
  expiry: BigInt(first.expiry),
});
if (tampered === first.settlement_digest) {
  console.error("tamper check failed: amount + 1 did not change the digest");
  failed = true;
} else {
  console.log(`tamper check ok: ${first.name} amount+1 -> ${tampered}`);
}

// BigInt enforcement: a Number amount must throw, not silently lose precision.
try {
  settlementDigest({
    vault_id: first.vault_id,
    policy_id: first.policy_id,
    policy_version: BigInt(first.policy_version),
    obligation_id: first.obligation_id,
    token_id: first.token_id,
    recipient: first.recipient,
    // Deliberately wrong type, to prove the mirror rejects it.
    amount: 1000000 as unknown as bigint,
    evidence_type: first.evidence_type,
    evidence_hash: first.evidence_hash,
    nonce: BigInt(first.nonce),
    expiry: BigInt(first.expiry),
  });
  console.error("BigInt check failed: Number amount was accepted");
  failed = true;
} catch {
  console.log("BigInt check ok: Number amount rejected");
}

if (failed) process.exit(1);
console.log("conformance: 6 passing vectors");
