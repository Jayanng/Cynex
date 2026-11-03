# Lane B integration surface - Phase 0 DRAFT (not frozen)

Status: DRAFT. This file records the Lane B integration surface as
specified in build plan §3.1.4 / §3.1.10 / §3.1.11, pending Jayaang's
Rust freeze (schemas/cynex-v1.0.0/, docs/contract-api.md). Anything
the freeze has not yet published is marked TBD and is NOT invented here.

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

## TBD at freeze (do not guess)
- Timeout constants: TRANSFER_TIMEOUT_NS, EVIDENCE_TIMEOUT_NS
  (plan §3.1.2: measured/chosen in Phase 0, then frozen).
- Static gas values for ft_transfer and its callback (plan §3.1.5).
- Funding path chosen in Phase 0: ft_on_transfer via ft_transfer_call
  only, or plain ft_transfer (plan §3.1.4) — the other path must not
  be claimed.
- Exact Rust field order / optionality for pending_request_id and
  pending_digest, and the exact TrustMode enum shape (see schema.ts).
