/**
 * Agent wrapper scaffold, Phase 1 Lane B.
 *
 * The agent account holds a scoped function-call key. This
 * wrapper enforces the scope in code: it can build only a
 * settle call. Any other method name is rejected here, before
 * it ever reaches a signer, matching the Phase 1 key sandbox
 * (one function-call key, receiver vault, methods settle).
 */
import type { SettleArgs } from "../frontend/src/cynex/api.js";

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
