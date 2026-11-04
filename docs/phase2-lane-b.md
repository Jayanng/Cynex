# Phase 2 Lane B: console wiring and cynex-verify live receipts

## What was built

- `cli/cynex.ts`: new `verify-live <vaultId>` command. It reads real
  receipts through the paginated receipts view (0, 100 at a time
  until empty), verifies the same genesis-anchored chain as
  `verify-receipts`, and prints CSV rows with the frozen
  cynex-verify columns: index, prev_hash, obligation_id,
  recipient, amount, token_id, timestamp, tx_ref, verified_ok.
  It signs, funds, and settles nothing. Exit 0 only if every
  receipt verifies; any break exits 1.
- `agent/console.ts`: the Phase 2 console flow with near-api-js
  v7 Account callFunction. In order: owner create_obligation,
  agent settle (scoped settle key, via agent/wrapper.ts), then
  a chain read (obligation and receipts). Keys come only from
  files named in environment variables and are never printed.
  Without keys it prints the exact calls it would make and
  exits 2. A dry run is not a settlement and is labelled as
  such in its output.
- `tests/integration/sandbox.ts`: message updated. Contract
  source is present, but no built wasm exists on this machine
  (cargo-near is not installed here), so the harness still
  exits PENDING code 2 and never runs a mock.

## Live state verified on testnet, 2026-11-04 morning

Vault: cynex-vault.cynexmaster.testnet, owner cynexmaster.testnet,
about 2.494 NEAR, code_hash differs from the Phase 1 wasm, so
the vault has been redeployed since Phase 1.

- state: owner cynexmaster.testnet, receipt_index 1.
- Obligation obl-001: policy-001, version 1, recipient
  acme-supplies.testnet, amount 250000000, evidence_type
  delivery-note, state PAID, transfer_attempt 1, in_flight false.
- Policy-001: limit 1000000000, spent 250000000, reserved 0,
  funded 1000000000, not frozen.
- Vault storage_balance_of on usdc.fakes.testnet: non-null
  (total 0.00125 NEAR, available 0). Recipient
  storage_balance_of: non-null, same totals.
- Recipient ft_balance_of: 250000000.
- `verify-live cynex-vault.cynexmaster.testnet` output:
  `0,0000...0000,obl-001,acme-supplies.testnet,250000000,usdc.fakes.testnet,1793751483012073200,,true`, exit 0.

The happy-path settlement is therefore live and PAID, with
the reservation released (reserved 0). The receipt tx_ref is
empty by design in the deployed contract (String::new() in
on_transfer_complete), so the settlement transaction hash
itself is not in contract state; it must be captured from
the Lane A run that made the settlement.

## Self-audit, 2026-11-04

- Frontend typecheck clean; conformance 6/6; Jest 9/9.
- Scaffold typecheck clean (frontend, services, agent, cli,
  tests/integration together).
- verify-live: exit 0, receipt above verified_ok=true.
- verify-receipts (file): Rust test receipt passes, exit 0;
  tampered prev_hash fails, exit 1.
- Console dry run with a demo obligation file: exit 2, exact
  calls printed, no transaction sent.
- Sandbox harness: PENDING, exit 2, no mock run.

## Known limitations, flagged for the section 2.6 audit

- verify-live timestamps: near-api-js parses u64 timestamps
  as JS numbers, so the live timestamp reads
  1793751483012073200 where raw RPC reads
  1793751483012073148. With one receipt this does not change
  the verdict (index plus genesis prev_hash link). With two
  or more receipts, a rounded timestamp would change the
  recomputed hash of the previous receipt and could falsely
  fail the next link. BigInt-preserving JSON parsing is
  needed before verify-live is trusted on a longer chain.
- Deployed-contract divergence: the frozen contract-api.md
  create_obligation signature has no nonce (nonce generated
  at creation), while the deployed contract takes nonce as
  an input argument. The console follows the deployed
  contract and flags this here rather than hiding it.
- Integer encoding in the console: NEAR JSON u64/u128
  inputs are passed as numbers. Demo values are exact in a
  JS number; large amounts or exact timestamps need an
  encoding confirmed with Lane A before use.
- Live run of the console (owner + agent keys) has not been
  exercised from this machine: the keys are held by Lane A,
  not here. The live path is typechecked code, not a live
  proof.

## Still outstanding for Phase 2 sign-off

- The unregistered-recipient failure case has not been run
  live from Lane B: transfer failure with the reservation
  released and the obligation back to READY. The contract
  code implements that path (Err callback releases), but
  code is not the live proof the plan requires.
- Measured static gas values for contract-api.md (Phase 0
  gas TBD) are not yet recorded.
- No Phase 2 ledger row exists yet, and no section 2.6
  audit of this Lane B work is on record. Lane B sign-off
  waits on both, per the standing rule: sign only when the
  phase evidence and the audit are actually on record.
