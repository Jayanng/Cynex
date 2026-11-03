/**
 * Cynex conformance — Lane B, Phase 0.
 *
 * Reads the FROZEN tests/test-vectors/vectors.json (exactly 6 vectors,
 * cynex-v1.0.0, commit 5eee26a), recomputes each settlement digest with
 * the TypeScript mirror, and prints "id <sha256>" per vector.
 * Exit codes follow the plan Phase 0 loud-failure rule:
 *   - any mismatch: print "expected <hex> got <hex>" and exit non-zero;
 *   - a deliberate single-byte change (amount + 1 on vector 0) must
 *     change the hash; if it does not, exit non-zero;
 *   - passing a JS Number for a u64/u128 field must throw; if it
 *     does not, exit non-zero.
 * Usage: npm run conformance  (tsc && node dist/scripts/conformance.js)
 * The frozen contract-api.md also names frontend/src/cynex-schema.ts
 * and a Jest test; cynex-schema.ts re-exports this mirror, and the
 * Jest test is provided alongside this runner (see cynex-schema.test.ts).
 * This Node runner is the check that is actually run and reported here.
 */
import { readFileSync } from "node:fs";
import { settlementDigest } from "../src/cynex/digest.js";

interface VectorJson {
  id: string;
  network_id: string;
  vault_id: string;
  policy_id: string;
  policy_version: string;
  obligation_id: string;
  token_id: string;
  recipient: string;
  amount: string;
  evidence_type: string;
  evidence_hash_hex: string;
  nonce: string;
  expiry_ns: string;
  expected_sha256: string;
}

const path = new URL("../../../tests/test-vectors/vectors.json", import.meta.url);
const data = JSON.parse(readFileSync(path, "utf8")) as { vectors: VectorJson[] };
if (data.vectors.length !== 6) {
  console.error(`expected exactly 6 vectors, got ${data.vectors.length}`);
  process.exit(1);
}

let failed = false;
for (const v of data.vectors) {
  if (v.network_id !== "testnet") {
    console.error(`${v.id}: network_id must be testnet, got ${v.network_id}`);
    failed = true;
    continue;
  }
  const got = settlementDigest({
    vault_id: v.vault_id,
    policy_id: v.policy_id,
    policy_version: BigInt(v.policy_version),
    obligation_id: v.obligation_id,
    token_id: v.token_id,
    recipient: v.recipient,
    amount: BigInt(v.amount),
    evidence_type: v.evidence_type,
    evidence_hash: v.evidence_hash_hex,
    nonce: BigInt(v.nonce),
    expiry: BigInt(v.expiry_ns),
  });
  console.log(`${v.id} ${got}`);
  if (got !== v.expected_sha256) {
    console.error(`${v.id}: expected ${v.expected_sha256} got ${got}`);
    failed = true;
  }
}

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
  evidence_hash: first.evidence_hash_hex,
  nonce: BigInt(first.nonce),
  expiry: BigInt(first.expiry_ns),
});
if (tampered === first.expected_sha256) {
  console.error("tamper check failed: amount + 1 did not change the digest");
  failed = true;
} else {
  console.log(`tamper check ok: ${first.id} amount+1 -> ${tampered}`);
}

try {
  settlementDigest({
    vault_id: first.vault_id,
    policy_id: first.policy_id,
    policy_version: BigInt(first.policy_version),
    obligation_id: first.obligation_id,
    token_id: first.token_id,
    recipient: first.recipient,
    amount: 1000000 as unknown as bigint,
    evidence_type: first.evidence_type,
    evidence_hash: first.evidence_hash_hex,
    nonce: BigInt(first.nonce),
    expiry: BigInt(first.expiry_ns),
  });
  console.error("BigInt check failed: Number amount was accepted");
  failed = true;
} catch {
  console.log("BigInt check ok: Number amount rejected");
}

if (failed) process.exit(1);
console.log("conformance: 6 passing vectors");
