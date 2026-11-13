# Cynex MCP Server: Production Acceptance Matrix

The matrix is the live proof for the MCP server. Each row states which layer produces the refusal or the success (server, reputation gate, or vault), the expected error code or outcome, and how to run it. The runner is `test-client.ts --matrix` (from `frontend/` after `npm run mcp:build`). It records one result per row with its transaction hash, prints a summary, and writes the JSON to `--matrix-out <file>` when given. Rows without a fixture are recorded as skipped, never as passed.

No live settle runs in this task. The matrix document and the runner are the deliverables; the live proof runs them after the focused re-review.

## How to run

Test vault first, then production, in that order. The test vault is `cynex-testvault.cynexmaster.testnet`, the production vault is `cynex-vault.cynexmaster.testnet`, the agent is `cynex-agent.cynexmaster.testnet`. The policy id is not fixed in the runner: pass `--policy <id>`, or give `--matrix-obligation <id>` and the runner reads the policy id from that obligation on chain, or set `CYNEX_POLICY`. The test vault policy and the production policy differ, so no policy id is hardcoded.

```sh
node dist-test/services/mcp/test-client.js --matrix --matrix-obligation <id> --matrix-out matrix-test.json
node dist-test/services/mcp/test-client.js --matrix --matrix-settle <id> <recipient> <amount> <evidence-ref> --matrix-out matrix-test-settle.json
```

The runner prints the exact remaining budget before every live run (the `BUDGET` lines), from the policy read on chain. The vault guard refuses mismatched terms against the production vault: production is for the clean happy path and at most one carefully selected security failure, never exploratory testing. The one selected production security failure needs the explicit flag `--allow-production-negative`.

Fixtures needed for a full run: one READY obligation on the test vault for M1, a second READY obligation for M2 and M3 (the changed terms must reach the vault), one EVIDENCE_PENDING obligation for M4 and M8, one READY obligation whose recorded on-chain amount exceeds the remaining budget for M5, and one READY obligation with a BLOCK or WARN recipient for M9. M7 needs a function-call key scoped to a different receiver, run outside MCP.

Prior evidence, not a substitute: the concrete use case already proved the same refusals through the console on the test vault (obligation `usecase-report-002`, policy `p6-001`, 100 units, PREIMAGE: settle before evidence `ERR_INVALID_STATE`, changed recipient `ERR_RECIPIENT_SUBSTITUTION`, changed amount `ERR_TERMS_MISMATCH`, correct settle PAID with receipt index 24, replay `ERR_NONCE_ALREADY_CONSUMED`). This matrix re-proves them through MCP.

Local proof: `services/mcp/sandbox.test.ts` re-proves the same rows on a local near-sandbox chain (the M1 happy path, the M2 changed-recipient vault refusal, the replay refusal, and the read-only tools), with no testnet funds and the same vault code hash as the deployed testnet vaults. Testnet remains the live proof; the sandbox run is the repeatable local gate.

## Precondition rows

| Row | Layer | Expected outcome |
| --- | --- | --- |
| P1 counterparty check | Reputation gate | `cynex_check_counterparty` on the agent returns a verdict with the five signals |
| P2 policy read | Server | `cynex_get_policy` returns the policy and the exact remaining budget |
| P3 receipts list | Server | `cynex_list_receipts` returns rows as read from the chain |
| P4 prepare | Server | `cynex_prepare_obligation` returns the exact arguments and the label "Prepared, not authorized or submitted", and submits nothing |
| P5 obligation read | Server | `cynex_get_obligation` returns the recorded terms exactly as the chain returns them |

## Matrix rows

| Row | Layer | Expected outcome |
| --- | --- | --- |
| M1 correct recipient succeeds | Vault settles, server verifies | PAID, receipt index recorded, balance delta equals the obligation amount. Fixture: `--matrix-settle <id> <recipient> <amount> <evidence-ref>` with the exact terms |
| M2 changed recipient fails | Vault | The vault refuses with `ERR_RECIPIENT_SUBSTITUTION`, no funds move, the refusal carries the settle transaction hash. Fixture: `--matrix-negative <id> <changed-recipient> <amount> <evidence-ref>`. The changed recipient must read ALLOW from the reputation gate, or the gate refuses first and the vault never sees the attempt; see the one-time setup in the README (settle once through the console with `CYNEX_APPROVE_WARN=1` to an existing account such as `cynexmaster.testnet`, so it holds a prior receipt) |
| M3 changed amount fails | Vault | The vault refuses with `ERR_TERMS_MISMATCH`, no funds move, the refusal carries the settle transaction hash. Fixture: `--matrix-negative-amount <id> <changed-amount> <evidence-ref>`; the recorded recipient is read from the obligation |
| M4 changed evidence fails | Evidence layer | Redefined: this row is not a settle-time failure, because the contract discards `evidence_ref`. The row proves the server refuses to settle an obligation whose evidence has not been accepted: fixture `--matrix-obligation <id>` in EVIDENCE_PENDING, and the server refuses the settle with "not READY", no submit. It does not prove the stronger claim that rejected evidence can never make an obligation READY; that is proven by the contract tests and the console evidence flow, not by this row. |
| M5 over-budget request fails | Server | The server refuses off chain with the budget reason before any submit, naming spent, reserved, amount, limit, and funded. The vault would refuse with `ERR_BUDGET_EXCEEDED` if it reached the chain. Fixture: `--matrix-overbudget <id> <recipient> <amount> <evidence-ref>` where `<id>` is a READY obligation whose RECORDED on-chain amount exceeds the remaining budget. The server checks the recorded amount, not the proposed amount, so a changed proposed amount alone never triggers this row; that is M3. |
| M6 replayed obligation fails | Server, then vault | Through MCP the server refuses, because the obligation is PAID and not READY, so no settle is submitted. The vault rejection (`ERR_NONCE_ALREADY_CONSUMED`) is shown separately via the attack runner bypassing the READY check. Runs automatically after M1 in the same matrix run. The runner records the vault half as external row M6-vault, with the exact attack-one command; it is not claimed as run until that command is run and its hash recorded. |
| M7 a function-call key scoped to another receiver is rejected at the access-key layer | Access-key layer, not the vault | Cannot be produced through MCP: the server always signs with the authorized agent key. Run outside MCP with a function-call key scoped to a different receiver, for example `cli/cynex.ts attack-one` with such a key, or near-cli with such a key. NEAR rejects the transaction at the access-key layer with the receiver-mismatch error (exact name as recorded from the live run) before the contract is invoked, so the vault never sees the attempt. A full-access key can invoke settle: the contract performs no caller check by design, so that case is not what this row proves. What it proves is that NEAR enforces the scope of a function-call key; anything that does reach the contract is checked on terms by the vault. No funds move, and the exact error is recorded from the live run |
| M8 settlement before READY fails | Server, then vault | Through MCP the server refuses a CREATED or EVIDENCE_PENDING obligation with "not READY", no settle submitted. The vault rejection (`ERR_INVALID_STATE`) is shown separately via the attack runner bypassing the READY check. Fixture: `--matrix-obligation <id>` in CREATED or EVIDENCE_PENDING. The runner records the vault half as external row M8-vault, with the exact attack-one command; it is not claimed as run until that command is run and its hash recorded. |
| M9 reputation refusal is clearly separate from vault refusal | Reputation gate | The refusal starts with "MCP reputation gate refused the request" and names the verdict and the blocking signal and source. It is not labeled a vault refusal. Fixture: `--matrix-blocked <id> <recipient> <amount> <evidence-ref>` with a BLOCK or WARN recipient |
| M10 the TDX quote verifies independently | Attestation tooling | `scripts/verify-tee-attestation.sh --tx <settle hash>` exits 0. The server performs no attestation verification. Runs after M1 on a TEE obligation. Skipped when M1 did not settle a TEE obligation. |
| M11 the VRF signature verifies and is bound to the pending request | Attestation tooling | The VRF signature from the attestation bundle verifies and is bound to the pending request. It proves determinism and binding, not TEE execution. Runs after M1 on a TEE obligation. Skipped when M1 did not settle a TEE obligation. |
| M12 a successful receipt links the obligation, evidence digest, quote, and VRF result | Join | The runner proves the first half of the join live: the settle result gives the obligation id, receipt index, and settle transaction hash, and `cynex_get_obligation` gives the evidence digest, which must be present on chain. The second half, the quote and the VRF result from the attestation bundle, is verified by M10 and M11, not by this row. See the linkage join below. Runs after M1 |
| M13 runtime integrity | Server | The runtime checks run on every settle and refuse before submit on failure: wrong network, wrong vault code hash, changed or missing signing key, or an allowance below the settle gas cost. Proven live only by a settle attempt that reaches the runtime checks (M1, M2, M3, or M9); attempts refused before them (not READY, budget) do not prove this row. Each failure mode is proven by `runtime-checks.test.ts` |
| M14 budget printed before every live run | Runner | Every live settle attempt in the matrix goes through the one helper that prints the exact remaining budget from the policy on chain before settling (the `BUDGET` lines). The row passes only when at least one live attempt ran and the recorded count of BUDGET lines covers every attempt; it is skipped when no live attempt ran. |

## The linkage join

The settle result does not return `evidence_hash`, `pending_request_id`, `pending_digest`, or any TDX quote or VRF reference. The linkage is a join across three reads, and the matrix runner records all three for M12:

1. `cynex_request_settlement` returns the obligation id, the receipt index, and the settle transaction hash.
2. `cynex_get_obligation` for that obligation id returns `evidence_hash` (the committed digest, as bytes), `pending_request_id`, and `pending_digest`.
3. `scripts/verify-tee-attestation.sh --tx <settle transaction hash>` fetches the attestation bundle for the TEE execution: the TDX quote and the VRF result, bound to the pending request.

The server performs no attestation verification. The TDX quote and VRF rows belong to the existing attestation tooling, and the vault does not verify the quote on chain by design.

## Resolved gaps

These gaps were established in review, and the matrix is written to resolve them rather than paper over them.

- "Changed evidence fails" is undefined for the MCP path because the contract discards `evidence_ref`. The row is defined as M4 above: an obligation whose evidence was not accepted never reaches READY. It is an evidence-layer row, not a settle-time failure.
- "A function-call key scoped to another receiver is rejected at the access-key layer" cannot be produced through MCP, because the server always signs with the authorized agent key. That row is M7, and it runs outside MCP with such a key. The rejection happens at the NEAR access-key layer (the receiver-mismatch error, exact name as recorded from the live run) before the contract is invoked, so the row proves key scope enforcement, not a contract caller check: a full-access key can invoke settle, the contract performs no caller check by design, the vault checks terms and NEAR enforces key scope.
- Replay (M6) and settlement-before-READY (M8) show a server refusal through MCP, not the vault error, because `requestSettlement` refuses PAID, CREATED, and EVIDENCE_PENDING before submitting. The matrix distinguishes the two layers, and the vault rejection for those rows is shown via the attack runner (`cli/cynex.ts attack-one`, which calls `buildSettle` directly without the gate) bypassing the READY check. The runner records those vault halves as external rows M6-vault and M8-vault, with the exact attack-one commands.
- The settle result carries no evidence or attestation fields. The linkage join above defines how the receipt is joined to the evidence digest, the quote, and the VRF result. M12 proves the obligation half of the join live; M10 and M11 cover the attestation half.
- The test client vault guard refuses destructive or malformed cases against the production vault. Production is for the clean happy path and at most one carefully selected security failure, never exploratory testing. The runner calculates and prints the exact remaining budget before every live run.

## Production run order

1. Run the full matrix on the test vault first, with all fixtures, until every row that runs passes.
2. Run on production only the clean happy path (M1) and at most one carefully selected security failure, with `--allow-production-negative` passed explicitly for that one row.
3. Record the matrix JSON (`--matrix-out`) for both runs, with the transaction hashes, in the proof report.
