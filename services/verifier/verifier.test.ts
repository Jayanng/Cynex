/**
 * Tests for the Phase 5 real verifier.
 * SHA-256 is computed over real artifact bytes, the result is bound
 * to the settlement digest and the pending request, and the trust
 * mode is TRUSTED_RELAYER, never silently downgraded.
 */
import { createHash } from "node:crypto";
import {
  TRUST_MODE,
  sha256Hex,
  verifyArtifact,
} from "./verifier.js";
import { settlementDigest } from "../../frontend/src/cynex/digest.js";
import type { Obligation } from "../../frontend/src/cynex/schema.js";

const VAULT_ID = "cynex-vault.cynexmaster.testnet";
const TOKEN_ID = "usdc.fakes.testnet";
const ARTIFACT = Buffer.from(
  "cynex phase 5 demo artifact: delivery note 1 for acme-supplies",
  "utf8",
);
const NOW_NS = 1793800000000000000n;

function baseObligation(): Obligation {
  const evidenceHash = sha256Hex(ARTIFACT);
  const obligation: Obligation = {
    obligation_id: "obl-verify-001",
    policy_id: "policy-001",
    policy_version: 1n,
    recipient: "acme-supplies.testnet",
    amount: 1000n,
    evidence_type: "delivery-note",
    evidence_hash: evidenceHash,
    expires_at_ns: 1893456000000000000n,
    nonce: 1n,
    state: "EVIDENCE_PENDING",
    in_flight: false,
    transfer_attempt: 0n,
    transfer_dispatched_at_ns: null,
    pending_request_id: "obl-verify-001-1",
    pending_digest: null,
    evidence_requested_at_ns: 1793799000000000000n,
  };
  obligation.pending_digest = settlementDigest({
    vault_id: VAULT_ID,
    policy_id: obligation.policy_id,
    policy_version: obligation.policy_version,
    obligation_id: obligation.obligation_id,
    token_id: TOKEN_ID,
    recipient: obligation.recipient,
    amount: obligation.amount,
    evidence_type: obligation.evidence_type,
    evidence_hash: obligation.evidence_hash,
    nonce: obligation.nonce,
    expiry: obligation.expires_at_ns,
  });
  return obligation;
}

describe("sha256Hex", function () {
  test("matches node crypto for the demo artifact", function () {
    expect(sha256Hex(ARTIFACT)).toBe(
      createHash("sha256").update(ARTIFACT).digest("hex"),
    );
    expect(sha256Hex(ARTIFACT)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifyArtifact", function () {
  test("matched artifact returns ALLOWED, bound to digest and request", function () {
    const obligation = baseObligation();
    const v = verifyArtifact(ARTIFACT, obligation, TOKEN_ID, VAULT_ID, NOW_NS);
    expect(v.result).toBe("ALLOWED");
    expect(v.reasons).toEqual([]);
    expect(v.evidenceHash).toBe(obligation.evidence_hash);
    expect(v.digest).toBe(obligation.pending_digest);
    expect(v.requestId).toBe("obl-verify-001-1");
    expect(v.obligationId).toBe("obl-verify-001");
    expect(v.trustMode).toBe("TRUSTED_RELAYER");
    expect(TRUST_MODE).toBe("TRUSTED_RELAYER");
  });

  test("one flipped byte returns BLOCK with EVIDENCE_MISMATCH", function () {
    const obligation = baseObligation();
    const flipped = Buffer.from(ARTIFACT);
    flipped[10] = flipped[10] === 0x61 ? 0x62 : 0x61;
    const v = verifyArtifact(flipped, obligation, TOKEN_ID, VAULT_ID, NOW_NS);
    expect(v.result).toBe("BLOCK");
    expect(v.reasons).toEqual(["EVIDENCE_MISMATCH"]);
    expect(v.evidenceHash).not.toBe(obligation.evidence_hash);
    expect(v.trustMode).toBe("TRUSTED_RELAYER");
  });

  test("expired obligation returns BLOCK with OBLIGATION_EXPIRED even when the hash matches", function () {
    const obligation = baseObligation();
    const v = verifyArtifact(
      ARTIFACT,
      obligation,
      TOKEN_ID,
      VAULT_ID,
      1893456000000000001n,
    );
    expect(v.result).toBe("BLOCK");
    expect(v.reasons).toEqual(["OBLIGATION_EXPIRED"]);
  });

  test("no open request fails closed", function () {
    const obligation = baseObligation();
    obligation.pending_request_id = null;
    const v = verifyArtifact(ARTIFACT, obligation, TOKEN_ID, VAULT_ID, NOW_NS);
    expect(v.result).toBe("BLOCK");
    expect(v.reasons).toContain("EVIDENCE_MISMATCH");
  });

  test("wrong pending digest fails closed", function () {
    const obligation = baseObligation();
    obligation.pending_digest = "00".repeat(32);
    const v = verifyArtifact(ARTIFACT, obligation, TOKEN_ID, VAULT_ID, NOW_NS);
    expect(v.result).toBe("BLOCK");
    expect(v.reasons).toEqual(["EVIDENCE_MISMATCH"]);
  });

  test("non-pending obligation fails closed", function () {
    const obligation = baseObligation();
    obligation.state = "READY";
    obligation.pending_request_id = null;
    obligation.pending_digest = null;
    const v = verifyArtifact(ARTIFACT, obligation, TOKEN_ID, VAULT_ID, NOW_NS);
    expect(v.result).toBe("BLOCK");
    expect(v.reasons).toEqual(["EVIDENCE_MISMATCH"]);
  });

  test("verifier never returns WARN", function () {
    const obligation = baseObligation();
    const v = verifyArtifact(ARTIFACT, obligation, TOKEN_ID, VAULT_ID, NOW_NS);
    expect(v.result).not.toBe("WARN");
  });
});
