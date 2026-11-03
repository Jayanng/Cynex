/**
 * Cynex conformance, Jest form - same 6 frozen vectors as the Node
 * runner in scripts/conformance.ts.
 * Run: NODE_OPTIONS=--experimental-vm-modules npx jest src/cynex-schema.test.ts
 */
import { readFileSync } from "node:fs";
import { settlementDigest } from "./cynex/digest.js";
interface VectorJson {
  id: string;
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
const data = JSON.parse(
  readFileSync(new URL("../../tests/test-vectors/vectors.json", import.meta.url), "utf8"),
) as { vectors: VectorJson[] };
function input(v: VectorJson) {
  return {
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
  };
}
test("exactly 6 frozen vectors", () => {
  expect(data.vectors.length).toBe(6);
});
for (const v of data.vectors) {
  test("vector " + v.id + " matches Rust", () => {
    expect(settlementDigest(input(v))).toBe(v.expected_sha256);
  });
}
test("single-byte change changes the digest", () => {
  const v = data.vectors[0];
  const tampered = settlementDigest({ ...input(v), amount: BigInt(v.amount) + 1n });
  expect(tampered).not.toBe(v.expected_sha256);
});
test("Number amount is rejected", () => {
  const v = data.vectors[0];
  expect(() => settlementDigest({ ...input(v), amount: 1000000 as unknown as bigint })).toThrow();
});
