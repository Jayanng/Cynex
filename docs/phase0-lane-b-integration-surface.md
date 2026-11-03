# Lane B integration surface - Phase 0 - frozen per docs/contract-api.md (5eee26a)

Status: FROZEN (except gas, see below). This file records the Lane B integration surface as
frozen in docs/contract-api.md (Phase 0, 5eee26a).

## Views consumed (plan §3.1.4, caller: anyone)
- get_policy
- get_obligation
- balances
- receipts(start, limit) — paginated, so cynex-verify can replay from genesis
- state

## Events consumed
- Receipts emitted as NEP-297 events (plan §3.1.10), with the hash chain
  in contract state (receipt_index, last_receipt_hash).

## Receipts + cynex-verify
- cynex-verify replays from genesis via receipts(start, limit),
  recomputes each prev_hash link, detects index gaps and hash mismatches.
- CSV columns, frozen in plan §3.1.10: index, prev_hash, obligation_id,
  recipient, amount, token_id, timestamp, tx_ref, verified_ok.
- Acceptance test must include a tampered receipt that cynex-verify
  detects (output pasted, not just a happy-path replay) — not yet built.

## Methods the frontend/CLI must NOT invent
- settle(obligation_id, proposed_recipient, proposed_amount, evidence_ref):
  checked params; the vault reads authoritative terms from state and
  rejects any mismatch with a reason code (plan §3.1.4).
- Owner methods (wallet/CLI, never the executor): create_policy,
  create_obligation, freeze_policy, cancel_obligation, approve_warning,
  add_verifier, remove_verifier, mark_reconciliation_required,
  mark_evidence_timeout, resolve_settlement.
- submit_evidence(request_id, obligation_id, result, proof): predecessor
  in the allowlisted verifier set, NOT #[private]; binds request_id +
  digest + expiry.

## Frozen at Phase 0 (docs/contract-api.md)
- Timeout constants: TRANSFER_TIMEOUT_NS = 600000000000 (10 minutes),
  EVIDENCE_TIMEOUT_NS = 3600000000000 (1 hour).
- Funding path: ft_transfer_call through ft_on_transfer only, msg JSON
  with a fund_policy field naming an existing policy. Plain ft_transfer
  is explicitly NOT a funding path and must not be claimed as one.
- Static gas: TBD, to be measured in Phase 2, and that TBD blocks
  Phase 2 sign-off until filled. No gas number is invented here.
- Threat model: docs/threat-model.md is now "Phase 0 final" (Jayaang,
  5eee26a); Lane B accepts that final version, it is not re-drafted here.
- Schema: Policy now includes funded (u128) and reconciler (or null);
  Obligation includes policy_version, in_flight, transfer_attempt,
  transfer_dispatched_at_ns, evidence_requested_at_ns; version starts
  at 0 and does not bump on freeze/unfreeze (see schema.ts).
