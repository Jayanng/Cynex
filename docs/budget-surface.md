# Per-token budget surface

Entry: closed on Master 2026-11-04 (contract-api corrections c1dd809, frontend merged, contract and frontend signed). contract landed as f5efac9 (budget and storage safety, contract only): checked arithmetic per token, native-NEAR storage guard with per-settlement receipt storage reserve, invariants asserted on every policy balance change, property test over 1000 sequences.

frontend step (single step): surface the real per-token budget and limit in the frontend, read from chain.

Files:
- frontend/src/cynex/budget.ts: pure describeBudget from the balances view. Invariant mirrors assert_policy_invariant exactly (spent, reserved, and their total against limit and funded). Headroom is min(limit, funded) minus spent minus reserved, zero when the invariant does not hold, so a broken invariant is flagged, never rendered as a negative budget. Token figures must be exact: an unsafe JS number throws instead of rendering a rounded budget. Native headroom is reported separately in yoctoNEAR with an exact flag, never added to token figures.
- frontend/src/cynex/budget.test.ts: 7 tests (live shape, exactly at limit, limit plus one, funded binds, native never mixed, string parse, unsafe throws).
- cli/cynex.ts: budget <vaultId> <policyId> command, read-only, exit 0 on invariant ok, exit 1 on broken invariant, unknown policy, or inexact figures.

Live run, vault cynex-vault.cynexmaster.testnet, policy-001, exit 0:
- Token budget, base units: limit 1000000000, spent 975000000, reserved 0, funded 1000000000, headroom 25000000, invariant ok, policy not frozen.
- Native headroom printed separately and labeled approximate in the JS CLI run (1106409701021703383023616 yoctoNEAR as decoded by near-api-js), while the raw RPC read gives 1106409701021703399999993 yoctoNEAR, about 1.106 NEAR. The difference is JS number rounding above the safe integer range, which is exactly why the display labels it approximate and never mixes it into token figures.
- Unknown policy policy-nope: policy row unreadable, exit 1.
- Vault code_hash changed, consistent with deployment. Hash-to-commit rebuild is not independently possible from here (no cargo-near), so this is consistency, not proof of the exact build.
- Playground regression: same three states (PAID, READY, CANCELLED).

Honest gaps:
- contract verify items (property test output, exactly-at-limit, limit plus one, low liquid VAULT_STORAGE_EXHAUSTED) are contract cargo evidence, not rerun from this machine (no cargo-near or wasm target here). The property test exists in Master lib.rs (the property invariant test over 1000 sequences, prints invariant held over 1000 sequences) and the edge tests exist, but their output was not reproduced here.
- No contract changes, no frozen doc changes, no signing in this work. frontend sign-off and the acceptance audit still pending.

Checks: scaffold typecheck exit 0, frontend typecheck exit 0, conformance 6/6, Jest 23/23 (9 schema plus 7 states plus 7 budget).


## close confirmation (frontend)

The contract-api close corrections draft dated 2026-11-04, updated 2026-11-05, plus its measured gas and live proofs, was verified line by line against Master contract lib.rs and live RPC reads (all six proof transactions queried, gas_burnt checked against the draft figures, rejection obligations read as still READY, deployment transaction checked), and confirmed by frontend. Gas is measured live and replaces the table for settle. The draft is not yet applied to docs/contract-api.md; application happens at close on Master. frontend signed in docs/ledger.md on 2026-11-05; contract signature, draft application, and merge remain outstanding, so this work is not closed by this signature. The acceptance audit PASS (2026-11-05, no blocking findings) is recorded in the draft file; the merge itself carries no audit comment.
