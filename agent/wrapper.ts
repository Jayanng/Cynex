/**
 * Agent wrapper, Phase 1 scaffold plus Phase 7 reputation gate.
 *
 * The agent account holds a scoped function-call key. This
 * wrapper enforces the scope in code: it can build only a
 * settle call. Any other method name is rejected here, before
 * it ever reaches a signer, matching the Phase 1 key sandbox
 * (one function-call key, receiver vault, methods settle).
 *
 * Phase 7: the reputation gate. Before the agent settles, the
 * console checks the recipient's reputation (see
 * services/reputation) and applies the gate here:
 * - BLOCK: the counterparty is on a named blocklist. Refuse.
 *   No settle is attempted, and the refusal names the signal
 *   and its source.
 * - WARN: the counterparty has too little sourced history. The
 *   settle does not go through silently; it goes to the owner
 *   for a decision. Without explicit owner approval the gate
 *   escalates and no settle is attempted. With approval it
 *   proceeds and the approval is printed alongside the reason.
 * - ALLOW: proceed.
 *
 * The gate is deliberately separate from buildSettle. The attack
 * runner (cli/cynex.ts attack-one) calls buildSettle directly
 * to fire deliberate rejections against the contract; it must
 * not be reputation-gated, because its whole point is to prove
 * the contract rejects bad terms. Only the agent's own settle
 * path (agent/console.ts) goes through the gate.
 */
import type { SettleArgs } from "../frontend/src/cynex/api.js";
import type { ReputationReport } from "../services/reputation/reputation.js";

export const AGENT_ALLOWED_METHODS = ["settle"] as const;

export function assertAgentMethod(method: string): void {
  if (method !== "settle") {
    throw new Error("agent key scope: only settle is allowed, got " + method);
  }
}

export function buildSettle(args: SettleArgs): SettleArgs {
  assertAgentMethod("settle");
  return {
    obligation_id: args.obligation_id,
    proposed_recipient: args.proposed_recipient,
    proposed_amount: args.proposed_amount,
    evidence_ref: args.evidence_ref,
  };
}

export type GateDecision = "proceed" | "refuse" | "escalate";

export interface GateResult {
  decision: GateDecision;
  reason: string;
}

export function gateSettleOnReputation(
  report: ReputationReport,
  options: { approveWarn: boolean },
): GateResult {
  if (report.verdict === "BLOCK") {
    const blocklist = report.signals.find((s) => s.name === "blocklist");
    return {
      decision: "refuse",
      reason:
        "refused: " +
        report.accountId +
        " is BLOCKED by the blocklist signal (source: " +
        String(blocklist?.source ?? "none") +
        "); no settle attempted",
    };
  }
  if (report.verdict === "WARN") {
    const reasons = report.reasons.join("; ");
    if (!options.approveWarn) {
      return {
        decision: "escalate",
        reason:
          "escalated: " +
          report.accountId +
          " is WARN (" +
          reasons +
          "); settle needs an owner decision, no settle attempted",
      };
    }
    return {
      decision: "proceed",
      reason:
        "proceeding with owner approval: " +
        report.accountId +
        " is WARN (" +
        reasons +
        "); owner approved",
    };
  }
  return {
    decision: "proceed",
    reason:
      "proceeding: " +
      report.accountId +
      " is ALLOW" +
      (report.score === null ? "" : " (score " + report.score.toFixed(3) + ")"),
  };
}
