/**
 * Cynex obligation state display, Phase 3 Lane B.
 *
 * Pure mapping from the contract states (frozen in docs/contract-api.md,
 * 9 ObligationStates) to what a frontend shows. No chain reads here;
 * callers pass the state read from the contract and the policy frozen
 * flag read from the contract. Nothing is guessed locally.
 *
 * Terminal means the deployed Phase 3 contract offers no outgoing
 * transition: PAID (money moved, receipt appended), CANCELLED
 * (cancel_obligation makes the obligation terminal), and BLOCKED
 * (evidence blocked; settle requires READY and cancel_obligation
 * allows only CREATED or RECONCILIATION_REQUIRED, so a blocked
 * obligation has no settlement or cancel path).
 */

export const OBLIGATION_STATES = [
  "CREATED",
  "EVIDENCE_PENDING",
  "READY",
  "WARN_PENDING",
  "BLOCKED",
  "CANCELLED",
  "TRANSFER_PENDING",
  "PAID",
  "RECONCILIATION_REQUIRED",
] as const;

export type ObligationStateName = (typeof OBLIGATION_STATES)[number];

export interface StateDisplay {
  state: ObligationStateName;
  label: string;
  terminal: boolean;
  meaning: string;
  next: string;
  frozenNote: string | null;
}

const FROZEN_NOTE =
  "Policy frozen: settlement is blocked while frozen, but an in-flight callback still books the real outcome.";

const DISPLAY: Record<
  ObligationStateName,
  { label: string; terminal: boolean; meaning: string; next: string }
> = {
  CREATED: {
    label: "Created",
    terminal: false,
    meaning: "Obligation created, evidence not yet requested.",
    next: "Owner requests evidence (request_evidence).",
  },
  EVIDENCE_PENDING: {
    label: "Evidence pending",
    terminal: false,
    meaning: "Evidence requested, awaiting the verifier.",
    next: "Verifier submits evidence (submit_evidence), or after the evidence timeout the owner or reconciler marks evidence timeout (mark_evidence_timeout): without escalation it cancels, with escalation it moves to WARN_PENDING.",
  },
  READY: {
    label: "Ready to settle",
    terminal: false,
    meaning: "Evidence allowed, ready for settlement.",
    next: "Agent settles (settle).",
  },
  WARN_PENDING: {
    label: "Warning pending",
    terminal: false,
    meaning: "Evidence warned rather than allowed, awaiting an owner decision.",
    next: "Settlement requires READY; the owner must resolve this state before settlement proceeds.",
  },
  BLOCKED: {
    label: "Blocked",
    terminal: true,
    meaning: "Evidence blocked by the verifier.",
    next: "No settlement path and no cancel path in the Phase 3 contract; a new obligation is needed.",
  },
  CANCELLED: {
    label: "Cancelled",
    terminal: true,
    meaning: "Cancelled, no money moved, reservation released.",
    next: "None. This is a terminal state.",
  },
  TRANSFER_PENDING: {
    label: "Transfer pending",
    terminal: false,
    meaning: "Transfer dispatched, callback outstanding. Never assume paid from this state.",
    next: "Wait for the callback; after the transfer timeout the owner or reconciler marks reconciliation required (mark_reconciliation_required).",
  },
  PAID: {
    label: "Paid",
    terminal: true,
    meaning: "Paid, receipt appended.",
    next: "None. Verify the receipt and the recipient balance movement.",
  },
  RECONCILIATION_REQUIRED: {
    label: "Reconciliation required",
    terminal: false,
    meaning: "Ambiguous outcome: the callback never ran. Reservation stays held and the token stays locked until resolution.",
    next: "Owner or configured reconciler resolves with proof (resolve_settlement to PAID, READY, or CANCELLED; PAID resolution is owner-only), or the owner cancels (cancel_obligation).",
  },
};

export function describeState(state: string, frozen: boolean): StateDisplay {
  const known = (OBLIGATION_STATES as readonly string[]).includes(state);
  if (!known) {
    throw new Error("unknown obligation state: " + state);
  }
  const name = state as ObligationStateName;
  const d = DISPLAY[name];
  return {
    state: name,
    label: d.label,
    terminal: d.terminal,
    meaning: d.meaning,
    next: d.next,
    frozenNote: frozen ? FROZEN_NOTE : null,
  };
}
