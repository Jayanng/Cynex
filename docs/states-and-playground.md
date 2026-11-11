# States and playground

Entry: closed on Master 2026-11-04 (merged 64321b5, joint gas 9c70b69, contract signed b7f4a59); one real settlement works (six receipts, verify-live all true). contract landed as c541653 (timeout paths, reconciliation, per-token in-flight lock).

frontend steps (plan ):
1. Frontend reflects real states read from the contract.
2. Playground reads real on-chain state and uses owner-created demo obligations (plan section 3.1.11).

Files:
- frontend/src/cynex/states.ts: pure describeState for all 9 frozen ObligationStates. Terminal set is PAID, CANCELLED, BLOCKED: settle requires READY and cancel_obligation allows only CREATED or RECONCILIATION_REQUIRED, so a blocked obligation has no settlement or cancel path. A frozen policy adds a frozen note: settlement is blocked while frozen, but an in-flight callback still books the real outcome.
- frontend/src/cynex/states.test.ts: 6 tests. All nine states covered, terminal set exact, frozen note, reconciliation paths named, transfer pending never implies paid, unknown state throws.
- cli/cynex.ts: playground <vaultId> <obligationId...> command, read-only, no signing, no transactions. Exit 1 on any not-found obligation or unknown state, never a guessed rendering. Prints states seen live and states with no live example in the run, computed from what it actually read.
- demo/playground-obligations.json: owner-created demo set only (obl-008 PAID, obl-002 READY negative demo, obl-003 CANCELLED terminal demo). A judge cannot create obligations (owner-only), so the playground never invents demo state.

Live run, 2026-11-04 evening, vault cynex-vault.cynexmaster.testnet, exit 0:
- obl-008: PAID, acme-supplies.testnet, 25000000, policy-001, policy frozen false.
- obl-002: READY, unregistered-xyz.testnet, 100000000, policy-001, policy frozen false.
- obl-003: CANCELLED, acme-supplies.testnet, 250000000, policy-001, policy frozen false.
- States seen live: PAID, READY, CANCELLED. States with no live example in this run: CREATED, EVIDENCE_PENDING, WARN_PENDING, BLOCKED, TRANSFER_PENDING, RECONCILIATION_REQUIRED.
- Unknown id obl-nope: not found on chain, no state rendered, exit 1.
- verify-live regression: six receipts all true.

Live observation: obl-003 was EVIDENCE_PENDING at the morning check and is CANCELLED now, with pending_request_id null and evidence_requested_at_ns null, transfer_attempt 0, policy reserved 0. From EVIDENCE_PENDING, the only contract path to CANCELLED is mark_evidence_timeout without escalation (cancel_obligation allows only CREATED or RECONCILIATION_REQUIRED, and escalation would move to WARN_PENDING). The triggering transaction hash is not on record from this side and is not claimed here. Consequence: EVIDENCE_PENDING currently has no live example, and CANCELLED now does. The playground reports this honestly from what it reads.

Honest gaps:
- No live example yet for CREATED, WARN_PENDING, BLOCKED, TRANSFER_PENDING, RECONCILIATION_REQUIRED. The states module covers all nine as a mapping with tests, and the contract async suite covers the transitions, but a live TRANSFER_PENDING or RECONCILIATION_REQUIRED example may only be demonstrable in the contract sandbox suite, because a live transfer callback normally runs immediately. frontend cannot stage one (owner and agent keys held by contract).
- contract-api update is a close item, not in this work (frozen doc, both sides).
- No contract changes, no frozen doc changes, no signing in this work. frontend sign-off and the section 2.6 audit are still pending.

Checks: scaffold typecheck exit 0, frontend typecheck exit 0, conformance 6/6, Jest 15/15 (9 schema plus 6 states), verify-live six receipts all true.

Audit correction (audit, Jayaang side, applied on side-b): WARN_PENDING next now names approve_warning (owner) to READY, then settlement proceeds from READY. Verified against contract lib.rs (approve_warning asserts owner, requires WARN_PENDING, moves to READY) and contract-api.md (approve_warning: caller owner, moves WARN_PENDING to READY). The previous text said only that the owner must resolve the state, without naming the method.


## close confirmation (frontend)

The contract-api close corrections draft dated 2026-11-04, plus its gas addendum, was verified line by line against Master contract lib.rs and the frozen API, and confirmed by frontend. Gas is carried over from pending re-measurement, not claimed unchanged. The draft is not yet applied to docs/contract-api.md; application happens at close on Master. frontend signed in docs/ledger.md on 2026-11-04; contract signature, draft application, and merge remain outstanding, so is not closed by this signature.
