# Console wiring and cynex-verify live receipts

## What was built

- `cli/cynex.ts`: new `verify-live <vaultId>` command. It reads real
 receipts through the paginated receipts view (0, 100 at a time
 until empty), verifies the same genesis-anchored chain as
 `verify-receipts`, and prints CSV rows with the frozen
 cynex-verify columns: index, prev_hash, obligation_id,
 recipient, amount, token_id, timestamp, tx_ref, verified_ok.
 It signs, funds, and settles nothing. Exit 0 only if every
 receipt verifies; any break exits 1.
- `agent/console.ts`: the console flow with near-api-js
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
about 2.494 NEAR, code_hash differs from the wasm, so
the vault has been redeployed since .

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
the contract run that made the settlement.

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
 encoding confirmed with contract before use.
- Live run of the console (owner + agent keys) has not been
 exercised from this machine: the keys are held by contract,
 not here. The live path is typechecked code, not a live
 proof.

## Still outstanding for sign-off

- The unregistered-recipient failure case has not been run
 live from Frontend: transfer failure with the reservation
 released and the obligation back to READY. The contract
 code implements that path (Err callback releases), but
 code is not the live proof the plan requires.
- Measured static gas values for contract-api.md (
 gas TBD) are not yet recorded.
- No ledger row exists yet, and no section 2.6
 audit of this frontend work is on record. frontend sign-off
 waits on both, per the standing rule: sign only when the
 evidence and the audit are actually on record.


## Section 2.6 audit fixes, 2026-11-04

Audit file: console-audit-fixes, from the reviewer.
All four fixes are frontend code only. No contract or frozen
doc was changed by frontend in this round.

1. BLOCKING, console evidence path (agent/console.ts).
 A fresh obligation is CREATED and settle requires READY,
 so the console now runs, in order: owner
 create_obligation, owner request_evidence, read the
 obligation back and take pending_request_id from chain,
 scaffold verifier check (abort on BLOCK), verifier
 submit_evidence with request_id equal to
 pending_request_id, result ALLOWED, proof equal to the
 obligation evidence_hash hex, read back and abort
 unless READY, read recipient ft_balance_of before
 settle, agent settle, read back and require PAID, read
 recipient ft_balance_of after settle and require the
 increase to equal the obligation amount, else fail.
 New env vars: CYNEX_VERIFIER and
 CYNEX_VERIFIER_KEY_FILE. Precondition, held by Contract:
 the verifier account must already be allowlisted with
 add_verifier. Dry run prints all nine calls in order
 and exits 2, no transaction sent.
 Live console run has NOT been done from this machine:
 the owner, verifier, and agent keys are held by contract,
 and the audit states the live re-audit, including a
 fresh console settlement, is for Jayaang under 2.6.

2. MEDIUM, verify-live timestamp rounding (cli/cynex.ts).
 verify-live now reads receipts through raw RPC and
 quotes index, amount, and timestamp numbers before
 parsing, so u64 values stay exact as BigInt. Live
 verify-live now prints the exact timestamp
 1793751483012073148 (previously rounded to ...3200),
 verified_ok=true, exit 0. Synthetic two-receipt chain
 test with exact timestamps: receipt 0 and receipt 1
 both verified_ok=true. Until the live two-receipt
 chain exists, that synthetic test is the evidence,
 not a live two-receipt proof.

3. Verifier evidence hash (services/verifier/verifier.ts).
 verifyEvidence now compares the supplied evidenceHash
 to obligation.evidence_hash and returns BLOCK with
 EVIDENCE_MISMATCH on mismatch. Tested: correct hash
 ALLOWED, wrong hash BLOCK with EVIDENCE_MISMATCH.

4. Sandbox default wasm path
 (tests/integration/sandbox.ts). DEFAULT_WASM_PATH is
 now contract/target/near/cynex_vault.wasm, where cargo
 near build puts the wasm. Harness still exits PENDING
 code 2 on this machine, no built wasm here, no mock.

## Items confirmed by the audit, not frontend homework

- Unregistered-recipient failure case, already proven by
 Contract: obligation back to READY, reservation released,
 no false paid, tx
 H1ggfjwdd45jhz4vkAAwkRLSHUXwJsVH47RkBNrk9Txj.
- Measured gas, to be recorded JOINTLY in
 docs/contract-api.md, not solo by Frontend: settle 2.588
 TGas, ft_transfer 2.023 TGas, callback 2.253 TGas,
 total about 6.86 TGas, replacing the gas TBD.
- create_obligation nonce in the contract versus no
 nonce in contract-api.md is a joint sign-off item, not
 a frontend fix. The frozen doc was not changed here.
- Still outstanding for close, per the audit:
 Jayaang re-audit live under 2.6 including a fresh
 console settlement and verify-live on the live
 two-receipt chain, merge of side-b to Master, joint
 gas recording in contract-api.md, then a 
 ledger row signed by both sides.


## Re-audit finding, 2026-11-04: console stale reads (BLOCKING, fixed)

Re-audit result: verify-live exact timestamps, verifier hash check, and sandbox wasm path all pass live. Verify-live on the live two-receipt chain: both receipts verified true, exit 0. Receipt 1 prev_hash matches the hash computed independently from receipt 0 with its exact timestamp.

Blocking finding, new failure mode, not the old one: the console ran live twice, fresh obligations obl-003 and obl-004, 250000000 each to acme-supplies.testnet, policy-001. Both times create and request_evidence succeeded on chain, but the immediate read after request_evidence showed CREATED with pending_request_id null, so the console aborted with exit 1. A read minutes later showed EVIDENCE_PENDING with pending_request_id obl-003-3 and obl-004-4. Systematic, twice, not a one-off lag.

Fix, agent/console.ts only, no contract or frozen-doc changes:
1. Poll every chain read after a transaction until the expected state appears or 120 seconds elapse (60 attempts at 2 seconds): pending_request_id after request_evidence, READY after submit_evidence, PAID after settle. A poll timeout returns null and the console aborts with a clear message, never a silent stale-state failure.
2. Print each step live transaction hash. Account.callFunction returns the contract method return value, empty for void methods, not the transaction outcome. The console now uses Account.callFunctionRaw and prints the outcome transaction hash via txHashOf, with transaction_outcome id as fallback and unknown if neither is present.

Two additions beyond the audit text, same failure mode, flagged for the re-auditor: the console also polls for CREATED after create_obligation, and polls the recipient balance after settle until it equals before plus amount, because both reads can go stale the same way.

Evidence for this fix, from this machine, no keys, no transaction sent:
- Scaffold typecheck clean, frontend typecheck clean, conformance 6/6, Jest 9/9.
- Console dry-run with a dummy obligation file and no keys: 9 calls in order, poll note printed, exit 2, no transaction sent.
- Mock poll test against the compiled console: stale CREATED with null pending twice, then EVIDENCE_PENDING with obl-003-3 on attempt 3; stale balance 100 twice, then 350 on attempt 3; timeout case returns null after 3 attempts; txHashOf returns the transaction hash, the outcome id fallback, and unknown for an empty outcome. Exit 0.
- verify-live re-run on cynex-vault.cynexmaster.testnet: receipt 0 obl-001 and receipt 1 obl-004, both verified true, exit 0, exact timestamps.

Live state left by the re-audit, independently re-read from chain before this fix:
- obl-003 remains EVIDENCE_PENDING, pending_request_id obl-003-3, acme-supplies.testnet, 250000000.
- obl-004 PAID, pending_request_id obl-004-4, receipt index 1, recipient balance 250000000 to 500000000 exactly, policy-001 spent 500000000, reserved 0. Manual near-cli completion by Jayaang, not through the console, so it proves the settlement path, not the console.
- obl-002 remains READY from .
- Cancel observation, contract, not frontend homework and not a merge blocker: the deployed cancel_obligation only allows CREATED, while the frozen doc allows cancel from more states, so obl-003 cannot be cancelled from EVIDENCE_PENDING, only completed or left.

Known caveat, corrected 2026-11-07 in the audit fixes (finding 6-2): createObligationArgs used to require expires_at_ns to round-trip exactly as a JS number, so valid arbitrary nanosecond timestamps such as now + 1h were rejected. expires_at_ns now accepts any u64 timestamp that can be sent as a JSON number; the top 1024 u64 values, which round to 2 to the power 64, are rejected locally instead of failing at the contract. The JSON number sent can differ from the specified expiry by at most about a microsecond of Number rounding, far below the granularity at which expiries are specified and blocks are produced. Amount and nonce keep the exact round-trip check.

Next step, for Jayaang: third live re-audit with a fresh console obligation, create, request, submit, settle, all through the console, with live transaction hashes and the balance delta in the console output, and verify-live re-run on the then three-receipt chain. Live console settlement was not run from this machine: owner, verifier, and agent keys are held by contract.

sign-off is still NOT done. It needs the third live re-audit, merge to Master, joint gas recording in docs/contract-api.md, then a ledger row signed by both sides.


## Third re-audit, 2026-11-04: poll crashes on a null row (BLOCKING, fixed)

Third re-audit result: transaction hash printing passes live. The console first live line was create_obligation tx hash 2VBFdtgKrK7bEixxD1BzNd4EXj6uEJjHpKUbG7Axnxhw, a real hash from callFunctionRaw. Request, submit, and settle hashes are still unproven, not disproven, because the run crashed before them. Frontend and scaffold again: typecheck clean, conformance 6/6, Jest 9/9, dry run with the poll note, 9 calls, exit 2.

Blocking finding, precisely located, smaller than last time: the console ran live with a fresh obligation obl-005, 250000000 to acme-supplies.testnet, policy-001, nonce 5. The create transaction succeeded and its hash printed, then pollObligation for CREATED crashed immediately, uncaught: TypeError Cannot read properties of null (reading state), at obligationState, exit 1. The first poll read returned null, because getObligation with finality final returns null while the just-created obligation is not yet in a final block. pollObligation called obligationState on the row without a null check, and obligationPendingRequestId had the same flaw. A later chain read confirmed obl-005 exists, CREATED, so the create had succeeded and the poll had crashed on a not-yet-visible row, not on a wrong state.

Fix, agent/console.ts only, no contract or frozen-doc changes:
1. In pollObligation, a null or undefined row is now treated as not visible yet, logged as row not visible yet, and polling continues. obligationState and pending_request_id are only read once the row exists.
2. obligationPendingRequestId now returns null for a null or undefined row, instead of reading a field off it.

Other dereferences checked, not changed: every other obligationState call in the console operates on a poll result already checked non-null before use, and the policy row read is for policy-001, which predates the run, so it cannot be a not-yet-visible row. ft_balance_of returns a u128 for a storage-registered recipient, not an Option, so tokenBalance has no null-row case of this kind.

Evidence for this fix, from this machine, no keys, no transaction sent:
- Scaffold typecheck clean, frontend typecheck clean, conformance 6/6, Jest 9/9.
- Console dry-run with a dummy obligation file and no keys: 9 calls in order, poll note printed, exit 2, no transaction sent.
- Mock null-row test against the compiled console: null, null, then CREATED for the CREATED poll, and null, null, CREATED, then EVIDENCE_PENDING with obl-005-5 for the pending poll, both succeeding with no TypeError. Exit 0.
- verify-live re-run on cynex-vault.cynexmaster.testnet: receipts 0 obl-001, 1 obl-004, 2 obl-005, all verified true, exit 0, exact timestamps.

Live state left by the third re-audit, independently re-read from chain before this fix:
- obl-005 PAID, pending_request_id obl-005-5, receipt index 2, recipient balance 500000000 to 750000000 exactly, policy-001 spent 750000000, reserved 0, funded 1000000000.
- Manual near-cli completion by Jayaang, not through the console: request tx AJE1HKm9iN33APWp7uvZ8poZfcW7SCyxkyUJFbCnYshA, submit tx FqbFx3PpkKr6dTq2GJWfuDb9KaGJjpfgVtpHJGgsKfLo, settle tx 6653pDXZWuHfmj4yXXuySqJFwPndCnbiqFqFwpsDNrP6.
- obl-004 PAID, obl-003 still EVIDENCE_PENDING, obl-002 still READY.
- Headroom note for the next run: only 250000000 of funded headroom remains for a further demo settlement at this amount. A fourth console run at 250000000 would take policy spent to 1000000000, leaving no headroom for obl-003 or any further settlement without additional funding. That is a contract funding decision, not a frontend code issue.

Design suggestion from the re-audit, NOT implemented in this fix, not a blocker: the console has no resume mode, so a crashed run leaves an obligation behind and a rerun with the same id fails, while a rerun with a new id leaves the old one stuck. A resume flag or settle-only mode would make future audit runs cheaper, but it changes console semantics and needs a decision on which states are resumable, so it is recorded here for Jayaang rather than bundled in silently.

Next step, for Jayaang: fourth live re-audit with a fresh console obligation, all through the console, with live transaction hashes for all four steps, PAID state, and the balance delta in the console output, and verify-live on the then four-receipt chain. Live console settlement was not run from this machine: owner, verifier, and agent keys are held by contract.

sign-off is still NOT done. It needs the fourth live re-audit, merge to Master, joint gas recording in docs/contract-api.md, then a ledger row signed by both sides.


## Takeover fix, 2026-11-04: console settle gas and error reporting (only, Johnson-ordered exception)

Standing side rule: Muse does only contract, never builds a frontend
deliverable. Johnson ordered an exception for this only, on
2026-11-04, after four back-and-forth fix rounds, so that Muse would
fix the console gas and error handling on side-b, live test it, and
have Adejoke pull, review, and sign herself, instead of further
rounds. The side rule resumes after . This commit is authored
by Jayanng, not by Adejoke, and it is recorded here so the history
stays honest. Adejoke's signature is still hers to give, never forged.

Fix, agent/console.ts only, no contract or frozen-doc changes:
1. Settle gas is now explicit at 100 TGas (SETTLE_CALL_GAS), because
near-api-js defaults to 30 TGas prepaid and settle attaches 30 TGas
for ft_transfer plus 30 TGas for the callback, plus about 2.6 TGas of
its own execution measured in , so 30 TGas prepaid failed live
with Exceeded the prepaid gas in the fourth re-audit. Create,
request, and submit gas is now explicit at 30 TGas, the previous
default, so no behaviour changes there.
2. A failed console run now ends cleanly: the top-level catch prints
console FAILED with the tx hash taken from the error object, when
present, and the failure reason, then exits 1, instead of crashing
uncaught with a Node.js stack trace and no hash printed.

Live test for this fix, by Muse, not through Adejoke: see the
takeover live run notes in the close record. Adejoke is asked
to pull this commit, review the diff, run the checks herself, and
sign frontend herself if she agrees. She is not asked to sign work she
has not reviewed.


## obl-006 record, verified (closes the takeover-note gap)

Receipt index 3 is obl-006, PAID, 100000000, nonce 6, acme-supplies.testnet, policy-001. Path, supplied by the Jayaang side and independently verified by Adejoke via RPC:
- Fourth re-audit console run against d587116: create huWdzG5cJELhRWrQ3Sqz9YdkeTSrTwnNRYt5eJefcUr, request AXGd2aJ3drry85wiJKBLodmEggND5CmMFQrbrz4LrFnU (pending obl-006-6), submit 3iuznn64C1DLMtwa4GEztidZaTjhxcKnX6Uu3b2yWfBN, balance before settle 750000000.
- Console settle FMnv3edZwBz3KrHsfQ8n8vDxgCyBzKjPWaPowrYyWtRY failed with Exceeded the prepaid gas at 30 TGas, no receipt, no money moved.
- Manual near-cli settle y3dGRpBxWYAzp2xhutrqF7bPigsjKYKDA3x2jPq9UmN at 100 TGas, receipt index 3, timestamp 1793788580198155806, prev_hash e08b48ac7d51c12770f4cd20ab521c88abdaf48ed767f19fbb43a0221afb4a0a, balance 750000000 to 850000000, policy spent 850000000. obl-007 then took both to 950000000. Standalone record file: obl-006-record, cited in the ledger row.


## obl-008, console run (74a61ed live proof)

Receipt index 5 is obl-008, PAID, 25000000, nonce 8, acme-supplies.testnet, policy-001, console exit 0: create 5fbBE62r5UBwbCjofPpX5LLapYztu7QFQthdHCX88NLP, request BnDXjmonwbb5GSJxwFaGW1Py3yz9NNAeLaG4tzrb3PLj (pending obl-008-8), submit F5zGbwntiTwqQitfSHkmTozV1XgM5XGNnse2gw93Nnqp, settle EqViKDAQSncjjH7Mc4kg41AtCJfAbZ2UP6fjymaRGHSt, balance 950000000 to 975000000 exactly, timestamp 1793792979518109723. All four hashes verified via RPC by Adejoke. Console fixes in 74a61ed: u64/u128 round-trip throw, scaffold policy_version and transfer_attempt from chain, receipts print without JS-number timestamps.
