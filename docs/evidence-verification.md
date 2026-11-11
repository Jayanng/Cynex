# Console wiring for PREIMAGE and TEE, cynex-verify --csv, playground polish

frontend delivery for (plan card line 927). contract shipped the
contract as bbc8464 (layers 2/3) and 42c9bf6 (layer 1), plus the README
draft (f7fb83a, TDX quote language); both vaults run code hash
7PBw1x6HbH3Eu2dWrTKjEEfxdJnAfFPwPJS5vZMM5zRC. The method signatures
below are taken from the frozen docs/contract-api.md (lines 75-76),
not from the instructions file alone; the two sources agree except
for the TEE vault receipt gas (2.79 TGas in contract-api.md, 2.82
TGas in the instructions — different live runs, immaterial, and the
console attaches 300 TGas prepaid either way).

## 1. Console wiring (agent/console.ts)

The console branches on the obligation's `evidence_type`:

- **PREIMAGE** calls `submit_evidence_preimage(request_id,
 obligation_id, evidence)` with the artifact bytes read from
 `CYNEX_ARTIFACT_FILE` as a JSON number array. The caller is a
 courier, not a judge: no verifier key is needed on this path, and
 no verifier check can substitute for it (the contract's routing
 rule rejects PREIMAGE obligations from `submit_evidence` with
 ERR_EVIDENCE_MISMATCH). Preimage submit uses the default 30 TGas
 call gas; the measured vault receipt is 1.81 TGas. An artifact
 over 65536 bytes aborts with an explanation: the verifier path
 cannot verify a PREIMAGE obligation either, so the owner must
 create a new obligation with a different evidence type.
- **TEE** calls `request_tee_verification(obligation_id,
 evidence_url)` with the evidence URL taken from the obligation
 file's `evidence_ref`, validated as http(s) before the call (a bad
 URL would waste the 0.01 NEAR deposit the contract attaches from
 the vault balance). The console attaches 300 TGas prepaid (the
 live-proof figure; 100 TGas fails with "Exceeded the prepaid
 gas", the console must attach at least 200 TGas). No deposit is
 attached by the console — the contract takes it from the vault
 balance. After filing, `pollTee` reads the obligation every 5
 seconds, up to 120 attempts, until it is READY or the evidence
 window closes (evidence_requested_at_ns plus the 1-hour
 EVIDENCE_TIMEOUT_NS). A still-pending TEE after the poll is
 reported as pending, never as verified.
- **Any other type** keeps the verifier path (TRUSTED_RELAYER):
 the local `verifyArtifact` pre-check, then `submit_evidence`
 with the verifier's signed proof. Evidence over 64 KiB also
 falls back here.

The reputation gate stays on the settle path
(`gateSettleOnReputation` in agent/wrapper.ts: BLOCK refuses naming
signal + source, WARN escalates unless CYNEX_APPROVE_WARN=1, ALLOW
proceeds). The attack runner (cli/cynex.ts attack-one) stays
ungated by design. The console's dry-run (`consoleCalls`) branches
too, so all three paths are visible without keys.

Dry-run proof (no keys supplied, no transaction sent), run against
the test vault:

- PREIMAGE (p9-prod-preimage-002): 9 calls, `submit_evidence_preimage`
 at index 3, after create_obligation, request_evidence, and the
 get_obligation read.
- TEE (p9-prod-tee-001): 9 calls, `request_tee_verification` at
 index 3 with `evidence_url` from `evidence_ref` and gas
 "300 TGas".

## 2. cynex-verify --csv (cli/cynex.ts)

The canonical command is now `cynex-verify --csv <vaultId>` for the
live chain, and `cynex-verify --csv --file <receipts.json>` for a
file replay. Both share `verifyLiveChain` / `verifyReceiptChain`
and a `toCsvRows` / `CSV_COLUMNS` export. The existing
`verify-live` and `verify-receipts` output is unchanged (regressions
depend on it). The header is exactly the frozen columns from plan
section 3.1.10:

```
index,prev_hash,obligation_id,recipient,amount,token_id,timestamp,tx_ref,verified_ok
```

Receipts carry no evidence_type, so chain verification is
path-agnostic; the CSV tests include the PREIMAGE and TEE proof
obligation ids to prove coverage.

Live run on production (2026-11-06): 8 receipts, all
verified_ok=true, identical output from `verify-live` and
`verify --csv`.

### Tamper-detection test (output pasted)

```
PASS ../services/verifier/verify.test.ts
 cynex-verify chain
 ✓ a correct chain verifies every row
 ✓ a tampered middle receipt is detected at the next receipt
 ✓ a tampered last receipt is not anchored until the next receipt arrives
 ✓ an index gap is detected
 ✓ a wrong prev_hash is detected
 ✓ the file replay detects the same tamper
 cynex-verify --csv
 ✓ the header is exactly the frozen columns
 ✓ rows render the frozen columns with the recomputed verdict
 ✓ a tampered row renders verified_ok=false in the CSV
 ✓ the CSV covers PREIMAGE and TEE proof obligations

Test Suites: 1 passed, 1 total
Tests: 10 passed, 10 total
```

The honest boundary, asserted in the tests rather than hidden:
the chain check compares each receipt's prev_hash to the recomputed
hash of the previous receipt, so a tamper in receipt i is detected
at receipt i+1 (and every row after). A tamper in the LAST receipt
has no next row yet, so it is only anchored when the next receipt
arrives. The tests assert [true, true, false] for a tampered middle
receipt and [true, true, true] for a tampered last receipt, and the
doc states the tip property plainly.

## 3. Playground polish

- **Result cards**: the settle result renders as a labelled card
 (verdict, tx hash, state after, balance before/after, moved)
 alongside the raw lines, from `formatSettleCard` /
 `renderSettleCard` in frontend/src/playground-client.ts.
- **Test matrix**: rendered from demo/playground-obligations.json
 (`matrixRows` / `renderTestMatrix`), one row per demo
 obligation with vault, obligation, evidence type, role, amount,
 and expected outcome. Every entry now carries `evidence_type`
 (all 12 existing entries are "delivery-note", read live) and a
 `settleable` flag.
- **Tamper-and-detect**: a new executor endpoint
 `GET /receipts?vaultId` (public, read-only, no key, no session,
 no shell) returns the live receipts with the u64/u128 fields as
 decimal strings, fetched through the raw RPC with the same
 quoting trick as the CLI's `parseReceiptsRaw` (near-api-js would
 round the nanosecond timestamps). The browser verifies the chain
 with Web Crypto (`verifyReceiptChainBrowser`, the frozen receipt
 hash formula), and the tamper UI edits a local copy only — the
 live chain is never modified. The hint text states the tip
 property honestly.
- **Read-only cases**: the three production proof
 obligations are in the obligations file as read-only cases
 (`settleable: false`): p9-prod-preimage-001 (READY, PREIMAGE),
 p9-prod-preimage-002 (EVIDENCE_PENDING, PREIMAGE), p9-prod-tee-001
 (READY, TEE), 100 units each, recipient
 cynex-agent.cynexmaster.testnet. The playground reads them live
 but the Fire button is disabled for them. Whether to settle,
 cancel, or leave them is Johnson's decision, not frontend.

## 4. README

The "Reproduce it" section (line 141) described only the verifier
path and listed the verifier key as always required. Fixed: it now
pins the exact compile and run commands (verified — the scaffold
tsc from frontend/ emits frontend/dist-test/, and the console runs
as `node dist-test/agent/console.js`), describes the three evidence
branches, and states that `CYNEX_VERIFIER` and
`CYNEX_VERIFIER_KEY_FILE` are only needed on the verifier path. A
PREIMAGE obligation needs no verifier key at all; a TEE obligation
needs the evidence URL from the obligation file's `evidence_ref`.

## Checks (2026-11-06)

- Scaffold typecheck (strict, incl. the new test files): clean.
- Frontend typecheck (`npm run typecheck`): clean.
- Conformance: 6/6.
- Jest: 119/119 in 12 suites (baseline 95/95 in 10; +24 from the
 new verify, console, and executor receipts tests).
- Regressions, all live: `verify-live` production 8 receipts all
 true; `verify --csv` production 8 receipts all true; playground
 p6-prod-001 READY; budget policy-001 headroom 24999000,
 p5-prod-001 headroom 1000; `attack --dry-run` on both vaults
 exit 0; console dry-runs for PREIMAGE and TEE as above.
- On-chain state unchanged by this delivery: both vaults at
 7PBw1x6H, the three proof obligations in their prior states,
 policy-001 spent 975001000, 8 receipts, agent balance 100.

## Gaps, stated plainly

- **Live console proof is the audit step.** Rio's machine holds no
 keys and no CYNEX_ env, so the PREIMAGE and TEE live runs are
 proven by the section 2.6 audit (contract keys, test vault first),
 not by this delivery. The dry-runs above prove the call shapes;
 only a live run proves the chain accepts them.
- **TEE poll duration is unproven until the audit runs it.**
 `pollTee` is 120 attempts at 5 seconds; a slow OutLayer
 execution could still be pending when the poll ends, and the
 console then reports pending, never verified.
- **The three production proof obligations are unsettled.**
 Johnson decides whether to settle, cancel, or leave them.
- **No live ALLOW from the reputation gate.** The blocklist signal
 is unavailable (9 candidates checked, provenance in
 demo/reputation-blocklist-provenance.json); acme-supplies.testnet
 still does not exist on chain — never settle to it.
