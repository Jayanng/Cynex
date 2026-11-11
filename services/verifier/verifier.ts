/**
 * Cynex real verifier,  frontend. Replaces the  scaffold,
 * which only compared hash strings and never read artifact bytes.
 *
 * This verifier computes a real SHA-256 over the real artifact bytes
 * and compares it to the evidence_hash recorded on the obligation.
 * A matching artifact returns ALLOWED. One flipped byte, a wrong
 * digest, a missing open request, a non-pending obligation, or an
 * expired obligation returns BLOCK. The verifier never returns WARN:
 * WARN is a contract state for future verifiers, not a result this
 * verifier produces.
 *
 * The result is bound to the obligation it was checked for: the
 * returned digest is the frozen settlement digest computed from the
 * obligation and policy as read, and the returned request_id is the
 * pending_request_id open on the obligation. The verifier also checks
 * that digest against the pending_digest on the obligation, so a
 * result computed for one obligation cannot be submitted for another.
 * The contract remains authoritative at submit time: it re-checks
 * the allowlist, the request, the digest, the proof, and expiry, and
 * BLOCKED has no exit by design.
 *
 * Trust mode is TRUSTED_RELAYER at MVP: the result is relayed by a
 * trusted operator (the allowlisted verifier account, the vault
 * owner). There is no hardware measurement behind it, and the mode
 * is never silently downgraded: it is printed with every result and
 * carried in the returned record. A verifier that is down fails
 * closed: no result, no READY by default.
 */

import { createHash } from "node:crypto";
import { settlementDigest } from "../../frontend/src/cynex/digest.js";
import type {
  Obligation,
  EvidenceResult,
  ReasonCode,
} from "../../frontend/src/cynex/schema.js";

export const TRUST_MODE = "TRUSTED_RELAYER";

export interface ArtifactVerification {
  result: EvidenceResult;
  reasons: ReasonCode[];
  /** SHA-256 of the artifact bytes as read, 64 hex characters. */
  evidenceHash: string;
  /** Frozen settlement digest the result is bound to, 64 hex characters. */
  digest: string;
  /** Pending request the result is bound to, or null when none is open. */
  requestId: string | null;
  obligationId: string;
  trustMode: string;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyArtifact(
  artifact: Uint8Array,
  obligation: Obligation,
  tokenId: string,
  vaultId: string,
  nowNs: bigint,
): ArtifactVerification {
  const reasons: ReasonCode[] = [];
  function addReason(reason: ReasonCode): void {
    if (reasons.indexOf(reason) === -1) {
      reasons.push(reason);
    }
  }
  const computed = sha256Hex(artifact);
  const digest = settlementDigest({
    vault_id: vaultId,
    policy_id: obligation.policy_id,
    policy_version: obligation.policy_version,
    obligation_id: obligation.obligation_id,
    token_id: tokenId,
    recipient: obligation.recipient,
    amount: obligation.amount,
    evidence_type: obligation.evidence_type,
    evidence_hash: obligation.evidence_hash,
    nonce: obligation.nonce,
    expiry: obligation.expires_at_ns,
  });
  if (obligation.state !== "EVIDENCE_PENDING") {
    addReason("EVIDENCE_MISMATCH");
  }
  if (obligation.pending_request_id === null) {
    addReason("EVIDENCE_MISMATCH");
  }
  if (
    obligation.pending_digest !== null &&
    obligation.pending_digest.toLowerCase() !== digest
  ) {
    addReason("EVIDENCE_MISMATCH");
  }
  if (computed.toLowerCase() !== obligation.evidence_hash.toLowerCase()) {
    addReason("EVIDENCE_MISMATCH");
  }
  if (nowNs > obligation.expires_at_ns) {
    addReason("OBLIGATION_EXPIRED");
  }
  return {
    result: reasons.length > 0 ? "BLOCK" : "ALLOWED",
    reasons: reasons,
    evidenceHash: computed,
    digest: digest,
    requestId: obligation.pending_request_id,
    obligationId: obligation.obligation_id,
    trustMode: TRUST_MODE,
  };
}
