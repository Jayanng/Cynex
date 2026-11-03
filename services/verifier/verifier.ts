/**
 * Verifier service scaffold, Phase 1 Lane B.
 *
 * Pure evidence checks against the frozen schema. This is a
 * scaffold verifier for local and integration use only: the
 * vault contract remains authoritative at settle time, and
 * external attestation (for example OutLayer callbacks) is a
 * Phase 8 item, not decided here.
 */
import { hexTo32 } from "../../frontend/src/cynex/api.js";
import type { Obligation, EvidenceResult, ReasonCode } from "../../frontend/src/cynex/schema.js";

export interface VerificationOutcome {
  result: EvidenceResult;
  reasons: ReasonCode[];
}

export function verifyEvidence(
  obligation: Obligation,
  evidenceType: string,
  evidenceHash: string,
  nowNs: bigint,
): VerificationOutcome {
  const reasons: ReasonCode[] = [];
  try {
    hexTo32(evidenceHash);
  } catch {
    return { result: "BLOCK", reasons: ["EVIDENCE_MISMATCH"] };
  }
  if (evidenceType !== obligation.evidence_type) {
    reasons.push("EVIDENCE_MISMATCH");
  }
  if (nowNs > obligation.expires_at_ns) {
    reasons.push("OBLIGATION_EXPIRED");
  }
  if (reasons.length > 0) {
    return { result: "BLOCK", reasons };
  }
  return { result: "ALLOWED", reasons: [] };
}
