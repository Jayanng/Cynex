# Cynex ledger

One row per phase. A phase is signed only when its entry criteria,
verification, evidence, and quality gate are all on record. Lane B
rows are signed only after Johnson's own Lane B acceptance audit.

## Phase P: Setup and verification

Status: Phase P closed 2026-11-03. Setup work done on jayanng and on rastadev (Lane B supplementary evidence, merged). Lane A gate passed, Lane B audit passed, both lanes signed.

Evidence, captured live 2026-11-03 on jayanng:
- Toolchain: rustc 1.99.0, cargo 1.99.0, wasm32-unknown-unknown
  installed, cargo-near 0.22.0 (cargo near --version prints cargo-near-near 0.22.0), near-cli 4.0.13, node v22.23.3,
  npm 10.9.9, cargo-audit 0.22.2, cargo-deny 0.20.2,
  cargo-geiger 0.14.0. All version commands below exited 0, see docs/evidence/prep/lane-a-toolchain.md and lane-b-toolchain.md for the exit codes.
- NEAR Agent Skills: git fetch clean, HEAD = origin/main =
  cb32b6af195e636c1e9c2efe2ea75a6d85b6b67b (short cb32b6a), tree clean, 8 skills listed.
- Live facts, testnet RPC, re-verified 2026-11-03:
  usdc.fakes.testnet code_hash E1E1CJYxT5FjzVSF55QoEWzv6dbqTe2yB6Hpmjks7JJ7,
  ft_metadata spec ft-1.0.0, name Bridged USDC, symbol USDC.e,
  decimals 6.
  outlayer.testnet code_hash 5waWVnt6g3FZfjR6vfYXZzpAi3sZdFy8cK2sLz4EJQDt,
  estimate_execution_cost 7000100000000000000000 yocto
  (0.0070001 NEAR), get_execution_cost returns MethodNotFound.
- Repo: https://github.com/Jayanng/Cynex.git, private since 2026-11-03, created
  2026-11-01, cloned empty to /data/workspace/Cynex,
  branch Master. Phase P scaffold committed as c1cbf0f, Lane B evidence
  merged as cd05961 (lane-b e0f7d36 plus correction db6427e).
- Evidence summaries: docs/evidence/prep/lane-a-toolchain.md,
  docs/evidence/prep/lane-b-toolchain.md, docs/evidence/prep/live-facts.md,
  docs/evidence/prep/lane-b-instabox-phase-p.md (Lane B, rastadev, merged).
- Lane A gate, 2026-11-03: GLM, Gemini, DeepSeek and Sol reviews passed,
  findings verified, see gate log held outside the repo to avoid changing the gated diff.
- Lane B acceptance audit, 2026-11-03: live facts and imports reproduced on
  jayanng, skills matched, rastadev runs recorded as unproven but consistent,
  pre-push scaffold note corrected in db6427e, merged in cd05961.

Sign-off: Johnson (Lane A), 2026-11-03
Sign-off: rastadev (Lane B), 2026-11-03


## Phase 0: Schema and interface freeze

Status: Phase 0 closed 2026-11-03. Lane A gate passed with itemized Sol and Gemini verification on NEAR grounds, Lane B mirror audited under section 2.6 and merged as 38e0033, both lanes signed.

Evidence:
- Freeze: Master 5eee26a, schemas/cynex-v1.0.0, docs/contract-api.md,
  tests/test-vectors/vectors.json (exactly 6 vectors), threat model final.
- Lane B mirror: frontend/src/cynex-schema.ts and frontend/src/cynex/
  (digest, schema, receipt, api), frontend/src/cynex-schema.test.ts,
  docs/phase0-lane-b-integration-surface.md, lane-b 81f6987.
- Conformance outputs: docs/evidence/phase0/conformance-outputs.md
  (cargo test ok, TypeScript conformance 6 hashes identical to Rust,
  Jest 9 passed, receipt hash matches Rust test vector).
- Lane B sign-off on docs/contract-api.md: Lane B only, then Lane A signed 2026-11-03.
- Lane B acceptance audit, 2026-11-03: TypeScript digest and Jest reproduced live on jayanng, 6 hashes identical to Rust, Jest 9/9, receipt hash matches, frozen files unchanged except sign-off, one low hex note recorded, merged in 38e0033.

Sign-off: Johnson (Lane A), 2026-11-03
Sign-off: rastadev (Lane B), 2026-11-03


## Phase 1: Contract skeleton and key sandbox

Status: Phase 1 closed 2026-11-03. Lane A gate passed, Lane B scaffold audited under section 2.6, blocking receipts finding fixed and verified live, both lanes signed.

Evidence:
- Lane A: Master 7a85b7b, contract skeleton and key sandbox, 4 files, 5210 insertions, contract/Cargo.toml, Cargo.lock, src/lib.rs, tests/test_skeleton.rs. Unit 6/6, sandbox 1/1, fmt clean, clippy warnings denied clean, everyday reviews GLM triage itemized, Gemini NO FINDINGS, DeepSeek 6 findings verified and fixed or recorded, Sol gate PASS itemized.
- Lane A fix: Master 47b4a80, receipts view uses frozen start/limit params, plus fmt normalization, unit 6/6, sandbox 1/1, clippy clean, fmt clean.
- Wasm, deployed: SHA-256 34f45bc9f6e81f131bf5d36796d84802f8b57b9affab1dfa2d028d91e8a7dc9f, 167,243 bytes, bs58 4ZiK7Kiw7qVGz4ihdUFJRr8fPdvirEFdkpB8F76ahpmU. Earlier wasm 65e317243f90ccde7da10b0a866b1f1dbbe841c1f2ef3a584df9eecbe88a9857 was superseded by the receipts fix, do not use it as final.
- Deploy: vault cynex-vault.cynexmaster.testnet, init owner cynexmaster.testnet, tx 93TL95foXP5i3DW9ruArTjn9kgiFcpYqoE43pizfH2TY, redeploy with receipts fix tx FaF5voGbZezPBrzUuKdAzBEsSx7PCuGMd3yAydUYwwJv, on-chain code_hash 4ZiK7Kiw7qVGz4ihdUFJRr8fPdvirEFdkpB8F76ahpmU matching deployed wasm, state owner cynexmaster.testnet, receipt_index 0, last_receipt_hash zeros.
- Key sandbox: agent cynex-agent.cynexmaster.testnet, exactly 2 keys, FunctionCall key ed25519:9Pkkzc6U8HbaxDF9CRJCPFdZNaXmqSKdzvqZtHv55F6t, receiver vault, methods settle only, allowance 0.25 NEAR, added tx 2qZngxydUmbwaQZ44K9u1VNbAg4cTNmLbJWUKw32ao1i, plus FullAccess key ed25519:EUVNiPKKqiNb2rUyU4Aj5NY6QSvEun1XTBRUKpGRT7RL.
- Forbidden calls, proven live: create_policy from agent key rejected MethodNameMismatch, tx 3bw3FKFP673Sv1uxpJf83mWP7qPvEJGSFtGgGHDi9RkP; ft_transfer from agent key rejected DepositWithFunctionCall, tx 8md4ZrD6L7r9ia2GwRGjzVXJmjJHaKWxyiRNdneAf931; near send from agent key rejected RequiresFullAccess, tx 9Ea3ctjGmoyda8WZXvdDAvieaSyNFM5ogQVpnVfRSDKN. Positive control: settle call from agent key reached vault and failed ActionError as expected in Phase 1, settle not implemented, tx G9wX58aCQj6K7oZWGvtHpywphg1oycRSUkmCJoNMm2BD.
- Lane B: lane-b e2720bf, scaffold verifier, reputation, agent wrapper, frontend client, CLI, sandbox harness, 8 files, 309 insertions, plus audit fix b97e456, client receipts sends numbers not strings, 1 file.
- Lane B acceptance audit, 2026-11-03: section 2.6, live client, state, get_policy, balances, receipts, and key list reproduced on jayanng against deployed vault, no mock or fake outputs, frozen files unchanged, blocking receipts finding closed (contract start/limit plus client numbers, receipts 0,10 and 5,3 both return [] live), notes for Phase 2 cleanup: verifier hash equality, sandbox harness default wasm path. Audit log held outside the repo.
- Merge: Master 522442f, Merge lane-b: Lane B Phase 1 scaffold, audited, 8 files, 310 insertions, clean merge.

Sign-off: Johnson (Lane A), 2026-11-03
Sign-off: rastadev (Lane B), 2026-11-03


## Phase 2: Registration and first real settlement

Status: Phase 2 closed 2026-11-04. Lane-b merged to Master as 64321b5, contract-api corrections and measured gas applied on Master as 9c70b69, both lanes signed below.

Evidence:
- Lane A: Master df7c7f5, settle with frozen check order, reserve-then-dispatch ft_transfer with 1 yocto chained to private on_transfer_complete, hash-chained receipts with NEP-297 array events, unit 26/26, sandbox 1/1, fmt and clippy clean.
- Lane B: lane-b 9a69a4b (console wiring, cynex-verify live receipts), 2a731d6 (console evidence path, exact verify-live timestamps, verifier hash check, sandbox wasm path), c93e9b9 (console polls stale chain reads, prints live tx hashes), d587116 (console poll treats null rows as not visible yet), e2d47cd (takeover fix, see exception below), 74a61ed (takeover continued: console exactness, scaffold from chain, receipts print, see exception below).
- Live settlements on vault cynex-vault.cynexmaster.testnet, policy-001, recipient acme-supplies.testnet unless noted: receipt 0 obl-001, 250000000, Lane A run; receipt 1 obl-004, 250000000, manual completion; receipt 2 obl-005, 250000000, manual completion; receipt 3 obl-006, 100000000, console run failed on gas then manual completion (see obl-006 record below); receipt 4 obl-007, 100000000, first full console success; receipt 5 obl-008, 25000000, console run (see obl-008 below). Policy spent 975000000 of 1000000000 funded, reserved 0, recipient ft_balance_of 975000000, vault and recipient storage registered on the token (0.00125 NEAR each). verify-live on the six-receipt chain: all six true, exit 0, exact timestamps.
- obl-006 record, supplied by the Jayaang side and independently verified by Adejoke via RPC: create huWdzG5cJELhRWrQ3Sqz9YdkeTSrTwnNRYt5eJefcUr, request AXGd2aJ3drry85wiJKBLodmEggND5CmMFQrbrz4LrFnU (pending obl-006-6), submit 3iuznn64C1DLMtwa4GEztidZaTjhxcKnX6Uu3b2yWfBN, balance before settle 750000000, console settle FMnv3edZwBz3KrHsfQ8n8vDxgCyBzKjPWaPowrYyWtRY failed with Exceeded the prepaid gas at 30 TGas, manual near-cli settle y3dGRpBxWYAzp2xhutrqF7bPigsjKYKDA3x2jPq9UmN at 100 TGas, receipt index 3, timestamp 1793788580198155806, prev_hash e08b48ac7d51c12770f4cd20ab521c88abdaf48ed767f19fbb43a0221afb4a0a, balance 750000000 to 850000000. Standalone record file: phase2-obl-006-record, cited here so the chain has no unexplained receipt.
- obl-007, first full console success: create 9jVnt1PfTA5pQpvgxVQa7YvDN9Ky2NTbDjVDLeixBKT, request AfcrZRxbNyPut5s68fX5qCp24reNmUzwCrUhMqQCoqHL, submit 71keXrtq9Yc643ZxpgW8KgEUhoQDYoy1LEfuzpBqiH3N, settle 8gzeDaVNZQyBN3HaoSgT1Zg4A4JRzyzpcVto5feMnpXD, PAID, balance 850000000 to 950000000 exactly. Duplicate obl-007 run failed cleanly at create, exit 1, tx 79dUQp7TTZ1UYXFefAobPiTE9T7WcNPXyYStk6fP2ELy, ERR_OBLIGATION_EXISTS, no state change.
- obl-008, console run: create 5fbBE62r5UBwbCjofPpX5LLapYztu7QFQthdHCX88NLP, request BnDXjmonwbb5GSJxwFaGW1Py3yz9NNAeLaG4tzrb3PLj (pending obl-008-8), submit F5zGbwntiTwqQitfSHkmTozV1XgM5XGNnse2gw93Nnqp, settle EqViKDAQSncjjH7Mc4kg41AtCJfAbZ2UP6fjymaRGHSt, PAID, balance 950000000 to 975000000 exactly, receipt index 5, timestamp 1793792979518109723. All four hashes verified via RPC: owner to vault Success at 30 TGas for create, request, submit; agent to vault Success at 100 TGas for settle.
- Unregistered-recipient failure case, proven by Lane A: obligation back to READY, reservation released, no false paid, tx H1ggfjwdd45jhz4vkAAwkRLSHUXwJsVH47RkBNrk9Txj.
- Checks on 74a61ed, run by Adejoke: scaffold typecheck clean, frontend typecheck clean, conformance 6/6, Jest 9/9, verify-live six receipts all true exit 0, console dry-run 9 calls exit 2, no transaction sent, bad-amount dry-run (1793788981686825275) fails cleanly console FAILED exit 1 no transaction, good-values dry-run (25000000, expiry 1893456000000000000, nonce 8) prints 9 calls exit 2 with expiry exact.
- Headroom warning: only 25000000 of funded headroom remains. No further demo settlement above 25000000 without topping up policy funding first; a 25000000 settlement would take funded headroom to zero. obl-003 remains EVIDENCE_PENDING (250000000) and obl-002 remains READY (100000000, unregistered recipient); neither can settle as things stand.
- Measured gas, now jointly recorded in docs/contract-api.md as 9c70b69, with observed ranges: settle vault 2.588 to 2.592 TGas, ft_transfer 2.023 TGas, callback 2.253 to 2.261 TGas, total settle path about 6.86 to 6.88 TGas, plus create 1.669 TGas, request 1.712 TGas, submit 1.806 TGas, all from obl-007 tx-status gas_burnt. The corrections draft noted in the earlier re-sign row was applied as 9c70b69, not as a solo Lane B edit.

Exception to the lane rule and to the ledger header rule, for this row only: commits e2d47cd and 74a61ed were authored by Jayanng, not by Adejoke, under a Phase 2-only exception. The exception was accepted by rastadev in chat on 2026-11-04, covering e2d47cd (settle gas and error reporting only), and re-confirmed by the re-sign instruction the same day, extending it to 74a61ed (console exactness, scaffold from chain, receipts print only). The lane rule resumes after Phase 2. Acceptance basis for the takeover fix and its continuation is live proof plus independent review by Adejoke, NOT a section 2.6 independent audit, because the auditor side authored both commits. Earlier Phase 2 audit rounds were section 2.6 audits by Jayaang.

Sign-off: Johnson (Lane A), 2026-11-04
Sign-off: rastadev (Lane B), 2026-11-04 (re-signed after 74a61ed, superseding 545746e)

Close note: Phase 2 audit basis is Lane A everyday review plus Sol gate on Lane A code, live testnet proof for both lanes, Adejoke independent review of Lane B code and chain state, and, for the takeover commits e2d47cd and 74a61ed only, live proof plus Adejoke independent review, NOT a section 2.6 independent audit, as labelled in the Lane B row. Contract-api corrections and measured gas in 9c70b69 are doc-to-code alignment only, no contract change. Deferred, not closed by this row: obl-002 READY 100000000 and obl-003 EVIDENCE_PENDING 250000000, both beyond the remaining 25000000 funded headroom, reconciliation methods not implemented in Phase 2 and planned for Phase 3, and broader cancel states not implemented in Phase 2.


## Phase 3: Async money-path hardening

Status: Phase 3 closed 2026-11-04. Contract-api corrections applied on Master c1dd809, lane-b merged to Master, both lanes signed.

Evidence:
- Lane A: Master c541653, timeout paths, reconciliation, per-token in-flight lock (contract/src/lib.rs, contract/tests/test_async.rs, unit 43 passed, sandbox 1 passed each, fmt and clippy clean, Sol gate PASS). Vault cynex-vault.cynexmaster.testnet code_hash 2kFG4ak3EAuSBnFebnvu182DaNk4KkzBP5LMT1XTPeaJ, matching the draft header. Phase 3 code executing live is proven by obl-003 moving from EVIDENCE_PENDING to CANCELLED, a transition only mark_evidence_timeout can produce from that state, since that method is absent from the Phase 2 contract.
- Lane B: lane-b e2b5970 (obligation states display, live playground reader) plus audit fix 5926d77 (WARN_PENDING names approve_warning to READY).
- Lane B acceptance audit, section 2.6, by Jayaang: e2b5970 checked live (obl-008 PAID, obl-002 READY, obl-003 CANCELLED read correctly from the production vault, typecheck clean, Jest 15/15 at that time, conformance 6/6, receipts still 6, no contract changes), one fix requested (WARN_PENDING method name), fix applied as 5926d77, then audit confirmed clean (typecheck clean, Jest 16/16, conformance 6/6, live playground reads correct).
- Contract-api Phase 3 close corrections draft, dated 2026-11-04, not committed, confirmed by Lane B after line-by-line verification against Master contract lib.rs and the frozen API, not taken from the draft alone: timeout constants TRANSFER_TIMEOUT_NS 600000000000 (10 minutes) and EVIDENCE_TIMEOUT_NS 3600000000000 (1 hour) checked against block timestamp; mark_reconciliation_required owner or reconciler, TRANSFER_PENDING only, in_flight true, timeout reached, only state changes, reservation, in_flight, dispatch time, and lock retained; mark_evidence_timeout owner or reconciler, EVIDENCE_PENDING only, timeout reached, escalate false to CANCELLED and true to WARN_PENDING, pending fields cleared on both paths; resolve_settlement RECONCILIATION_REQUIRED only, in_flight true, timeout elapsed before branching, PAID owner only with non-empty proof and checked reserved subtraction and spent addition and receipt booked with proof as tx_ref, READY and CANCELLED owner or reconciler with reservation released and no receipt, other outcomes ERR_INVALID_OUTCOME; cancel_obligation CREATED or RECONCILIATION_REQUIRED, owner only, other states ERR_INVALID_STATE; per-token lock standalone LookupMap prefix b"i", no new Contract struct field, settle checks the lock after the existing obligation checks and before any reservation with ERR_TOKEN_IN_FLIGHT and no state change, lock set on dispatch, retained through reconciliation and frozen callback failure, cleared on callback Ok to PAID, non-frozen callback Err to READY, every resolve outcome, and cancel from RECONCILIATION_REQUIRED; on_transfer_complete private with callback_result, duplicate callbacks ignored via state, in_flight, and attempt checks; frozen callback Err moves to RECONCILIATION_REQUIRED, not CANCELLED; new Phase 3 error codes ERR_TOKEN_IN_FLIGHT, ERR_TIMEOUT_NOT_REACHED, ERR_INVALID_OUTCOME, ERR_INVALID_PROOF, plus reused ERR_INVALID_STATE, ERR_NOT_OWNER, ERR_NOT_AUTHORIZED, ERR_OBLIGATION_MISSING, ERR_POLICY_MISSING. Existing settle checks keep their relative order, with the lock check sitting between the in_flight check and the reservation, as documented in the draft.
- Gas, per the draft addendum, confirmed as worded: attached values unchanged in code (ft_transfer 30 TGas, callback 30 TGas, console settle prepaid 100 TGas, constants untouched by c541653). Measured gas is NOT claimed unchanged: the Phase 3 settle path adds lock set and clear storage writes and no fresh Phase 3 settlement measurement exists, so the Phase 2 measured table is carried over, pending re-measurement on a Phase 3 settlement. Mark, resolve, and cancel were not separately measured at Phase 3 close.
- Draft status: the draft text above is confirmed by Lane B but NOT yet applied to docs/contract-api.md. Application happens at Phase 3 close on Master, after Lane B confirmation, following the Phase 2 close pattern. This row does not claim the document already contains the section.
- Live state at sign-off: obl-008 PAID, obl-002 READY (100000000, unregistered recipient), obl-003 CANCELLED (250000000, evidence timeout outcome), policy-001 spent 975000000 of 1000000000 funded, reserved 0, not frozen, six receipts all true by verify-live.
- Checks on lane-b 5926d77, run by Adejoke: scaffold typecheck clean, frontend typecheck clean, conformance 6/6, Jest 16/16 (9 schema plus 7 states), playground live run exit 0, verify-live six receipts all true.

Sign-off: Johnson (Lane A), 2026-11-04
Sign-off: rastadev (Lane B), 2026-11-04

Lane A close note: test vault live proof, cynex-testvault.cynexmaster.testnet, labelled live proof plus author review, not an independent audit, not production: transfer timeout to PAID test-obl-001 and test-obl-002, token lock ERR_TOKEN_IN_FLIGHT live, resolve to READY test-obl-004, resolve to CANCELLED test-obl-005 with further settle failing ERR_INVALID_STATE, policy test-001 spent 2000000, reserved 0, receipts indices 0 and 1 only. Duplicate callback remains unit only. Production final state at close: policy-001 spent 975000000, reserved 0, funded 1000000000, frozen false, receipts 0 to 5 only.


## Phase 4: Budget and storage safety

Status: Phase 4 closed 2026-11-05. Contract-api corrections applied on Master 604325f, lane-b merged to Master, both lanes signed.

Evidence:
- Lane A: Master f5efac9, budget and storage safety (contract/src/lib.rs only, 315 insertions). Vault cynex-vault.cynexmaster.testnet code_hash GDvKC8GdUuR4n7mWPd8SCk3Heayd2QbqGJaijtnpncYm, deployed by tx 7wTv9xE7sGBXEmqkZ8AEG63SnQVgKifjorGQ7pMH9y2X (DeployContract, Success). Test vault cynex-testvault.cynexmaster.testnet carries the same code hash, so test vault and production run the same wasm.
- Lane B: lane-b 0b33845 (per-token budget surface from live balances).
- Lane B acceptance audit, section 2.6, by Jayaang, recorded in the Phase 4 corrections draft file supplied 2026-11-05: PASS on 2026-11-05, no blocking findings, typecheck clean, Jest 23/23, conformance 6/6, live policy-001 headroom 25000000 confirmed. PR 5 itself carries no audit comment; the audit record is the draft file. The checks listed match the checks run for 0b33845.
- Contract-api Phase 4 close corrections draft, dated 2026-11-04 and updated 2026-11-05, not committed, confirmed by Lane B after line-by-line verification against Master contract lib.rs and live RPC reads, not taken from the draft alone: settle budget check computes new_total as spent plus reserved plus amount with checked_add at each step and requires it at most limit and at most funded, else ERR_BUDGET_EXCEEDED, and the reserve write itself uses checked_add; assert_policy_invariant checks spent at most limit, reserved at most limit, spent plus reserved at most limit and at most funded with checked_add, else ERR_BUDGET_EXCEEDED, and runs at exactly 11 call sites (create, funding, settle reserve, callback Ok, callback Err non-frozen, resolve PAID, resolve READY and CANCELLED, cancel, freeze, unfreeze, set_reconciler), and does not run in the frozen callback Err branch (which writes no policy and says so in code) or on obligation-only transitions; native storage guard liquid is account balance minus storage usage times storage byte cost floored at zero, settle requires liquid at least receipt reserve plus 1 yocto plus gas headroom before any reserve write, else ERR_VAULT_STORAGE_EXHAUSTED, a require rejection with no state change; constants FT_TRANSFER_DEPOSIT_YOCTO 1, SETTLE_GAS_HEADROOM_YOCTO 0.01 NEAR (10^22 yocto), RECEIPT_STORAGE_BYTES 512; the 0.01 NEAR figure is a safety margin, not measured gas, and is recorded as such; token units only, native NEAR never summed with token units.
- Tests, existence and count verified in Master lib.rs, outputs not rerun from this machine (no cargo-near or wasm target here; Lane A gate evidence): property test phase4_property_invariant_over_1000_sequences (deterministic, model checked after every sequence, first failing sequence printed, prints invariant held over 1000 sequences), exactly-at-limit settles, limit plus one rejects ERR_BUDGET_EXCEEDED, low liquid at 0.001 NEAR balance rejects ERR_VAULT_STORAGE_EXHAUSTED, storage formula test; 48 test attributes counted in the file, matching the draft gate figure of 48 passed, 0 failed.
- Gas, measured on Phase 4 and verified against live RPC gas_burnt for test vault settle tx 6tmNdRz6seNB2wpPauYNDzoi2fBsyWk1kAq36vDPEnYd: vault settle receipt 2.867 TGas, ft_transfer 2.017 TGas, callback 2.478 TGas, total 7.362 TGas, within the attached 30 plus 30 TGas, caller prepaid 100 TGas. This replaces the Phase 2 table for Phase 4 settle, as the draft states. Attached values unchanged in code (ft_transfer 30 TGas, callback 30 TGas, console prepaid 100 TGas; the Phase 4 diff adds only SETTLE_GAS_HEADROOM_YOCTO).
- Live proof, verified by Lane B against live RPC reads: test vault exactly at limit 1000 paid, settle 6tmNdRz6seNB2wpPauYNDzoi2fBsyWk1kAq36vDPEnYd, Success, obligation p4-obl-001 on policy p4-001, spent 1000 of limit 1000; test vault limit plus 1 (1001) settle JBdMRgMNaNAsH17SS7KwdYR6jck1tNSERhLPSrwu5rux, Failure ERR_BUDGET_EXCEEDED, obligation p4-obl-002 still READY; test vault low liquid settle 243BzQnKo5RJjnuq5ucFKpow2AduzTZj3SbbzVvDMcmf, Failure ERR_VAULT_STORAGE_EXHAUSTED, obligation p4-obl-003 on policy p4-002 later PAID after top-up and retry (receipt index 3, amount 100, policy p4-002 spent 100 of limit 1000). The pre-top-up headroom figures (0.010524 NEAR below required about 0.01512 NEAR) are not re-derivable after the top-up; the required figure arithmetic checks out (512 times storage byte cost is 0.00512 NEAR plus 0.01 NEAR margin is 0.01512 NEAR). Production exactly at limit 1000 paid, settle FqnRuYQSmGB6C7bCXCiZcU9dFEd3FnSufFczpT5zxyXE, Success, obligation p4-prod-obl-001 on policy p4-prod-001, receipt index 6, policy spent 1000 of limit 1000; production limit plus 1 (1001) settle G5nDEPfA6DfAYmcLRKZvXQ6ibtyWWVTJgNjuEGjZxHUG, Failure ERR_BUDGET_EXCEEDED, obligation p4-prod-obl-002 still READY, receipts still 7. Low liquid was not run on production, by design, as the draft states. Acme token balance reconciles exactly: 975000000 baseline plus 1000000 plus 1000000 (test-obl-001 and test-obl-002) plus 1000 (test p4-obl-001) plus 100 (test p4-obl-003) plus 1000 (production p4-prod-obl-001) equals 977002100 as read live.
- Draft status: the draft text above is confirmed by Lane B but NOT yet applied to docs/contract-api.md. Application happens at Phase 4 close on Master, after Lane B confirmation, following the Phase 3 close pattern. This row does not claim the document already contains the section.
- Live state at sign-off: policy-001 limit 1000000000, spent 975000000, reserved 0, funded 1000000000, not frozen, headroom 25000000; policy p4-prod-001 limit 1000, spent 1000, reserved 0, funded 1000, headroom 0; production receipts 0 to 6, seven total, verify-live not rerun at sign-off (receipts 0 to 5 verified in Phase 3, receipt 6 verified by direct read here).
- Checks on lane-b 0b33845, run by Adejoke at build time: scaffold typecheck clean, frontend typecheck clean, conformance 6/6, Jest 23/23 (9 schema plus 7 states plus 7 budget), budget live runs exit 0 on policy-001 and p4-prod-001, unknown policy exits 1, playground regression unchanged.

Sign-off: Johnson (Lane A), 2026-11-05
Sign-off: rastadev (Lane B), 2026-11-05

Lane A close note: test vault live proof, cynex-testvault.cynexmaster.testnet, same wasm as production, code hash GDvKC8GdUuR4n7mWPd8SCk3Heayd2QbqGJaijtnpncYm, labelled live proof plus author review, not an independent audit: exactly at limit 1000 paid, settle 6tmNdRz6seNB2wpPauYNDzoi2fBsyWk1kAq36vDPEnYd; limit plus 1 rejected ERR_BUDGET_EXCEEDED, settle JBdMRgMNaNAsH17SS7KwdYR6jck1tNSERhLPSrwu5rux, still READY; low liquid rejected ERR_VAULT_STORAGE_EXHAUSTED, settle 243BzQnKo5RJjnuq5ucFKpow2AduzTZj3SbbzVvDMcmf, still READY, then top-up and retry paid. Measured settle gas 7.362 TGas total, vault 2.867, ft_transfer 2.017, callback 2.478. Production live proof, same wasm: exactly at limit 1000 paid on policy p4-prod-001, settle FqnRuYQSmGB6C7bCXCiZcU9dFEd3FnSufFczpT5zxyXE, receipt index 6; limit plus 1 rejected ERR_BUDGET_EXCEEDED, settle G5nDEPfA6DfAYmcLRKZvXQ6ibtyWWVTJgNjuEGjZxHUG, still READY, receipts still 7. Low liquid was not run on production, by design. Production final state at close, read live: policy-001 spent 975000000, reserved 0, funded 1000000000, frozen false, headroom 25000000; policy p4-prod-001 spent 1000, reserved 0, funded 1000; receipts 0 to 6, seven total.


## Phase 5: Evidence gate and verifier

Status: Phase 5 CLOSED 2026-11-05. Lane B signed 2026-11-05 in b0ede24; Lane A signed 2026-11-05; corrections applied as 043f53c; lane-b merged fast-forward to b0ede24; Master pushed.

Sign-off: Johnson (Lane A), 2026-11-05

Lane A close note: test vault live proof, cynex-testvault.cynexmaster.testnet, same wasm as production, code hash B3PkaBjH1izqp1gkcdwV8673Uf5ZkbPp1iX4guHGY8An, labelled live proof plus author review, not an independent audit: correct artifact matched, submit F2Byo7xhxotqsgGuHYNdTAm9KPTWs2U2SoJY8uGUC4Zk, READY, pending fields cleared; flipped byte, unauthorized, wrong request, and expired all rejected and stayed EVIDENCE_PENDING; evidence timeout, 1 hour, late submit rejected ERR_EVIDENCE_EXPIRED, then mark_evidence_timeout 93JbVo5C6GX1J6qcZkXp6XGbB3uR17nf2spXQSuAsKaN to CANCELLED. Production live proof, same wasm: correct artifact matched on policy p5-prod-001, submit CuER2jJ45DqHU33c4v1YhuWTtUTgtu2TqePS4SpiD3bB, READY; flipped byte, unauthorized, and expired all rejected and stayed EVIDENCE_PENDING. The 1 hour evidence timeout was proven live on the test vault only, with identical code. Lane B real verifier, section 2.6 audit PASS, clean, no blocking findings, matched live ALLOWED proven end to end on production: obl-verify-demo, create GadNMtp7hEMpiv6MYr4UAxkSXRGEjgqpZNxfzXH9p8E, request 9zeu6sNTKayvJzwiEaavDt7L23YWZLdennvHJUWaLrJA, submit ERLW1PhouTK3eWcGZzQGwQdHr2NtoJcczcY5fgJRF7t1, settle BCepmiyKS9FUZqXgPcBofrtFiJ8VBwQNyK2HFgBc1zDy, PAID, receipt index 7, acme 977002100 to 977003100 exactly. Production final state at close, read live: policy-001 spent 975001000, reserved 0, funded 1000000000, frozen false, headroom 24999000; policy p5-prod-001 spent 0, reserved 0, funded 1000; receipts 0 to 7, eight total.

Evidence:
- Lane A: Master 5efce97, evidence gate hardening (contract/src/lib.rs only, 213 insertions). Vault cynex-vault.cynexmaster.testnet code_hash B3PkaBjH1izqp1gkcdwV8673Uf5ZkbPp1iX4guHGY8An, deployed by tx FkY2zjMsuJs2d2ASoXmadyZa68q9CoioAax23prXjTEi (DeployContract, Success). Wasm SHA-256 9531c17bcd8b6a4311dc25de2e8feb2564e87081d69192980bbd1be6c7f3087b, bs58 of which recomputes to the deployed code_hash (checked by Lane B). Test vault cynex-testvault.cynexmaster.testnet carries the same code hash, so test vault and production run the same wasm. Wasm size 233,579 bytes stated in the draft, not independently verified from this machine (no wasm file here).
- Lane B: lane-b eeca0ff (real verifier over artifact bytes, live CLI proof). PR 6 open, head eeca0ff.
- Lane B acceptance audit, section 2.6, by Jayaang, relayed 2026-11-05: PASS, no blocking findings, nothing to fix from Lane B. What he checked: real SHA-256 over artifact bytes, matched ALLOWED, flipped byte, wrong digest, missing request, non-pending, expired all BLOCK, never WARN, TRUSTED_RELAYER printed with every result, console fails closed and aborts before submit, typecheck clean, conformance 6/6, Jest 31/31, playground, budget, verify-live unchanged, digest binding three ways on obl-002, plus the full console live run on production with the demo artifact (obl-verify-demo, create, request, verifier ALLOWED, submit, READY, settle, PAID, receipt index 7, acme 977002100 to 977003100 exactly). PR 6 itself carries no audit comment; the audit record is the relayed note.
- Contract-api Phase 5 close corrections draft, supplied 2026-11-05 as pasted text in chat, not committed, confirmed by Lane B after line-by-line verification against Master contract lib.rs and live RPC reads, not taken from the draft alone: submit_evidence enforces the one-hour evidence timeout itself (block_timestamp at most evidence_requested_at_ns plus EVIDENCE_TIMEOUT_NS 3600000000000, else ERR_EVIDENCE_EXPIRED), strict-after so at exactly requested plus timeout submit still accepts and one nanosecond later rejects, while mark_evidence_timeout becomes valid at exactly requested plus timeout (block_timestamp at least requested plus timeout), so whichever transaction lands first wins with no dead zone and no double decision (the other then fails the EVIDENCE_PENDING state check); a missing evidence_requested_at_ns under EVIDENCE_PENDING panics ERR_INVALID_STATE instead of silently skipping the check; on a decided obligation all three pending fields are cleared (pending_request_id, pending_digest, evidence_requested_at_ns) on ALLOWED to READY, WARN to WARN_PENDING, and BLOCK to BLOCKED; replay is guarded by the EVIDENCE_PENDING state check, not by a field sentinel; before Phase 5 (Master be093f0) EVIDENCE_TIMEOUT_NS appeared only in mark_evidence_timeout and pending fields were cleared only there, confirming both before-claims; BLOCKED has no exit (approve_warning requires WARN_PENDING only, cancel_obligation requires CREATED or RECONCILIATION_REQUIRED only, request_evidence requires CREATED and touches no policy balances so holds no reservation, resolve_settlement requires RECONCILIATION_REQUIRED, and no transition reads BLOCKED as a source state), so it is a dead record, not locked funds.
- Live proof, verified by Lane B against live RPC reads: test vault matched submit F2Byo7xhxotqsgGuHYNdTAm9KPTWs2U2SoJY8uGUC4Zk, Success, request p5-obl-001-1, ALLOWED, proof e79ea21ef3047b8339aac928fc6e9034fbdd8c5143fc5f6138ea16b76e7a55d9, obligation p5-obl-001 READY, pending fields all null, evidence_hash equal to the proof; test vault timeout case mark_evidence_timeout 93JbVo5C6GX1J6qcZkXp6XGbB3uR17nf2spXQSuAsKaN, Success, escalate false, obligation p5-obl-006 CANCELLED, pending fields all null; production matched submit CuER2jJ45DqHU33c4v1YhuWTtUTgtu2TqePS4SpiD3bB, Success, request p5-prod-001-1, ALLOWED, proof e79ea21ef3047b8339aac928fc6e9034fbdd8c5143fc5f6138ea16b76e7a55d9, obligation p5-prod-001 READY, pending fields all null, policy p5-prod-001 limit 1000, funded 1000, spent 0, reserved 0, frozen false. The rejection cases in the draft (test flipped byte, unauthorized, wrong request, expired, late submit; production flipped byte, unauthorized, expired) carry no transaction hash, so they were not independently re-derived from this machine; the states they describe are consistent with what was read (p5-obl-006 reaching CANCELLED through a timeout mark implies it stood EVIDENCE_PENDING with an elapsed request time). The artifact file behind e79ea21e was not supplied, so its SHA-256 was not recomputed here; the proof in both submit transactions equals the recorded evidence_hash of the obligations. The Sol gate and reviewer agreement on BLOCKED is Lane A evidence, not rerun from this machine (no cargo-near here).
- Live proof, production console run, verified by Lane B against live RPC reads: obl-verify-demo PAID, receipt index 7, amount 1000, policy-001 spent 975001000 (975000000 at deployment plus 1000), reserved 0, pending fields all null, evidence_hash 4bbad2781260fe26366f899de6ff75dbfa35cd69795fa5ef5d3159027ad6c677, acme-supplies.testnet 977002100 to 977003100 exactly. The matched live ALLOWED gap flagged at build time is now closed.
- Draft status: the draft text above is confirmed by Lane B but NOT yet applied to docs/contract-api.md. Application happens at Phase 5 close on Master, after Lane B confirmation, following the Phase 4 close pattern. This row does not claim the document already contains the section.
- Live state at sign-off: policy-001 limit 1000000000, spent 975001000, reserved 0, funded 1000000000, not frozen; policy p5-prod-001 limit 1000, spent 0, reserved 0, funded 1000; production receipts 0 to 7, eight total; obl-002 READY, obl-003 CANCELLED, obl-verify-demo PAID.
- Checks on lane-b eeca0ff, run by Adejoke at build time: scaffold typecheck clean, frontend typecheck clean, conformance 6/6, Jest 31/31 (9 schema plus 7 states plus 7 budget plus 8 verifier), verify-artifact live runs (obl-002 BLOCK with digest triple-match, obl-003 BLOCK, unknown id exit 1, missing file exit 2), playground, budget, and verify-live regressions unchanged (7 receipts all true at build time; 8 receipts after the console live run, receipt 7 verified by direct read here).

Sign-off: rastadev (Lane B), 2026-11-05


## Phase 6: Attack demo and playground

Status: Phase 6 CLOSED 2026-11-05. Lane B signed 2026-11-05 in 552a9b8; Lane A signed 2026-11-05; corrections applied as 342399a; lane-b merged fast-forward to 552a9b8; Master pushed.

Sign-off: Johnson (Lane A), 2026-11-05

Lane A close note: test vault live proof, cynex-testvault.cynexmaster.testnet, same wasm as production, code hash G3Mt2gKs94C61Se4oLWvMUgR2Bfv2djdFQLz4TVrDH3E, labelled live proof plus author review, not an independent audit: all six rejection paths proven, recipient substitution hsas9c1Esn1n5S8Gqo3zCTJyvTsioQcpPcQVrAsER3z, terms mismatch 8ZMpTaxUHpaAJrq3Jzh3nMcF1dhZQp2pJozcKmtdWzxF, frozen 45NLRuCvdNUUY4YTWmTnYx7ArcFc3gTWeYNi6YKMRjNq, expired 3dMytgtCvAaF12d9q77PL9gbvFesWxe7TuHcBsDZ7B8x, nonce replay on PAID BWatKA4aDDG1doJJzkqUqY2kovsWMvDWZiDgAvz2nLc, budget exceeded 92em5J5bu4yVwYCiYxZCMAqWNz6bd8gYTUkHtHXRZSPr, all stayed READY or PAID with zero tokens moved; happy path p6-obl-003 settle 7QyaHAVAHhZBiJuq12k8MkZ24YpAP4XqCUFyPGCymDCj, PAID, acme 977003100 to 977004100 exactly. Production live proof, rejections only, same wasm: recipient ZXsrYz396ULaboo3SpZSqsSqfuKLzrjVMbBhaDqU5cC, terms 5BL3QQkZ3NkyCYxxnv9w5QynfiFu1bxFmemNYxbKayf5, budget 7kE4sVc5C9Yj3NbftCt9g91s9xCiw1Ms5nCkcHP4brPE, frozen CasmRnakN1ppiGa2YVgGmbQUwJhNe8RxtvDE4cLmdYux, expired 9yVTpWWtfZZgWrkuZoUuyVEEpg369FCcNB1ZijeWy1yF, nonce replay CgfxG46Z57EquMGr5CtNZXnAn5VyE1LrQLWRMKqFcf5e, all stayed READY or PAID with zero tokens moved. The happy path was proven live on the test vault only, with identical code. Lane B attack runner, playground, and executor, section 2.6 audit PASS with one finding, fixed as 14b16fb, 28 itemized checks, Jest 68/68, conformance 6/6, runner live on both vaults, executor live, playground live through the executor on fresh p6-audit-001. Production final state at close, read live: policy-001 spent 975001000, reserved 0, funded 1000000000, frozen false, headroom 24999000; policy p5-prod-001 spent 0, reserved 0, funded 1000; receipts 0 to 7, eight total, all true; acme 977006100.

Evidence:
- Lane A: Master cc29f2e, duplicate settle reports NONCE_ALREADY_CONSUMED (contract/src/lib.rs only, 99 insertions, 2 deletions). Vault cynex-vault.cynexmaster.testnet code_hash G3Mt2gKs94C61Se4oLWvMUgR2Bfv2djdFQLz4TVrDH3E, deployed by tx FZUftKtvQytjHEDxpBi8WrKU42VKtnoATs6kSqQATDBh (DeployContract, Success). Wasm SHA-256 df7a130b2701f1fbb79b267a0260f671fe2040ed575491e0081d8881a00b3f31, bs58 of which recomputes to the deployed code_hash (checked by Lane B). Test vault cynex-testvault.cynexmaster.testnet carries the same code hash, so test vault and production run the same wasm. Wasm size 233,602 bytes stated in the draft, not independently verified from this machine (no wasm file here).
- Lane B: lane-b 4416385 (attack runner, playground, executor security) plus audit fix 14b16fb (p6-prod-004 expired-only, transcript audit-run section, post-audit state notes). PR 7 open, head 14b16fb.
- Lane B acceptance audit, section 2.6, by Jayaang, 2026-11-05, 28 itemized checks: PASS with one finding. What was checked live from the PR head: no contract or frozen doc changes, no dist files or keys; typecheck clean, conformance 6/6, Jest 68/68 across 7 suites; verify-live 8 receipts all true before any new settle; attack runner live on the test vault (all four scenarios plus the happy path) and on production (rejections only, no happy-path settle); executor live (refuses to start without a token, 401 unauthenticated, 401 bad token, 400 invalid with no execution, 429 on the sixth settle, valid settle returns a real transaction); playground live through the executor (blocked case, settled case on fresh p6-audit-001, replay blocked). The one finding: the Lane B doc and demo JSON listed p6-prod-004 as a production spare; the audit probed it live, tx BpdmYUJddh2PJTSMD2V1tzn3YttQCZJ3WFv4djuJQRR, failed ERR_OBLIGATION_EXPIRED, stayed READY, zero moved; it is expired-only. Fixed by Lane B as 14b16fb. Two honest limits stated in the audit: the production happy-path refusal guard was code-reviewed only, not exercised live (obl-verify-demo was already PAID); the frozen playground case was not demonstrated live (needs the owner to freeze policy p6-001 during the demo). The audit record is the audit file supplied 2026-11-05; PR 7 itself carries no audit comment. Lane B independently re-queried all 17 audit transactions from chain, 0 mismatches.
- Contract-api Phase 6 close corrections draft, supplied 2026-11-05 in the sign note, not committed, confirmed by Lane B after line-by-line verification against Master contract lib.rs and live RPC reads, not taken from the draft alone: settle checks the nonce before the state check, in_flight true rejects ERR_NONCE_ALREADY_CONSUMED, state PAID rejects ERR_NONCE_ALREADY_CONSUMED, any other non-READY state rejects ERR_INVALID_STATE; the later in_flight require after the policy version check was removed as unreachable, with a comment noting the move; no other check changed order or code (recipient ERR_RECIPIENT_SUBSTITUTION, amount and policy version ERR_TERMS_MISMATCH, expiry ERR_OBLIGATION_EXPIRED, frozen ERR_POLICY_FROZEN, token lock ERR_TOKEN_IN_FLIGHT, budget ERR_BUDGET_EXCEEDED, storage guard ERR_VAULT_STORAGE_EXHAUSTED; every check runs before any state write and before the ft_transfer promise); RECONCILIATION_REQUIRED keeps in_flight true by design, mark_reconciliation_required changes only the state, so a settle there reports NONCE_ALREADY_CONSUMED, and in_flight can only be true in TRANSFER_PENDING and RECONCILIATION_REQUIRED (the only write to true is the settle reserve); ERR_INVALID_STATE is the pre-existing generic state-machine code, not one of the six settle reason codes, and is unchanged by the diff; the nonce is still not permanently consumed on dispatch, on a confirmed transfer failure the lock releases, the nonce is reusable for a retry, and the obligation returns to READY, and only PAID consumes it permanently (confirmed in on_transfer_complete: Ok books PAID and clears in_flight, Err non-frozen releases the reservation and lock and returns to READY, Err frozen moves to RECONCILIATION_REQUIRED with the lock retained); the frozen nonce paragraph in docs/contract-api.md line 31 already promises a duplicate is detectable as NONCE_ALREADY_CONSUMED even while the first attempt is still in flight, and that PAID permanently consumes the nonce, which is what this change makes true in code. The diff has exactly four hunks (two in settle, two in tests) on contract/src/lib.rs only. The post-review test fix is in the diff: the replay-after-PAID test now asserts !in_flight after the callback, so it cannot pass via the in-flight check. The reviewer and Sol gate figures (GLM triage, Gemini 4 Argon main, DeepSeek V4.1 Flash coder, all blocks commit NO; Sol gate passed all 7 checks; 55 tests passed, 0 failed; fmt and clippy clean) are Lane A evidence, not rerun from this machine (no cargo-near here).
- Live proof, test vault, verified by Lane B against live RPC reads: recipient substitution hsas9c1Esn1n5S8Gqo3zCTJyvTsioQcpPcQVrAsER3z, Failure ERR_RECIPIENT_SUBSTITUTION, stayed READY; terms mismatch 8ZMpTaxUHpaAJrq3Jzh3nMcF1dhZQp2pJozcKmtdWzxF, Failure ERR_TERMS_MISMATCH, stayed READY; frozen policy, freeze HHeu7QVS4q1jJF4QYjnRsP5kZnzoKBziJe5FJC7SAkFM Success, settle 45NLRuCvdNUUY4YTWmTnYx7ArcFc3gTWeYNi6YKMRjNq Failure ERR_POLICY_FROZEN, stayed READY, unfreeze CaZB1xyTQhnHa7PSAPGhv3ozU7xa3mnjBeGx73XWNatr Success; expired 3dMytgtCvAaF12d9q77PL9gbvFesWxe7TuHcBsDZ7B8x, Failure ERR_OBLIGATION_EXPIRED, stayed READY; happy path p6-obl-003, settle 7QyaHAVAHhZBiJuq12k8MkZ24YpAP4XqCUFyPGCymDCj Success, PAID, acme 977003100 to 977004100 exactly; nonce replay on the PAID obligation BWatKA4aDDG1doJJzkqUqY2kovsWMvDWZiDgAvz2nLc, Failure ERR_NONCE_ALREADY_CONSUMED, stayed PAID; budget exceeded 92em5J5bu4yVwYCiYxZCMAqWNz6bd8gYTUkHtHXRZSPr, Failure ERR_BUDGET_EXCEEDED, stayed READY. Zero tokens moved on every rejection. Final test vault state at proof time: policy p6-001 spent 1000, reserved 0, funded 10000, not frozen; acme 977004100.
- Live proof, production, rejections only, verified by Lane B against live RPC reads: recipient substitution ZXsrYz396ULaboo3SpZSqsSqfuKLzrjVMbBhaDqU5cC, Failure ERR_RECIPIENT_SUBSTITUTION, stayed READY; terms mismatch 5BL3QQkZ3NkyCYxxnv9w5QynfiFu1bxFmemNYxbKayf5, Failure ERR_TERMS_MISMATCH, stayed READY; budget exceeded 7kE4sVc5C9Yj3NbftCt9g91s9xCiw1Ms5nCkcHP4brPE, Failure ERR_BUDGET_EXCEEDED, stayed READY; frozen policy, freeze HLDbJYJMLHeC18ztnBh33gUSDNujY9wo7PMZsmiU37RL Success, settle CasmRnakN1ppiGa2YVgGmbQUwJhNe8RxtvDE4cLmdYux Failure ERR_POLICY_FROZEN, stayed READY, unfreeze Gd4eWQEjqTob2aU4A2JWwWtU2ApKtrvp2T2meedgj8rF Success; expired 9yVTpWWtfZZgWrkuZoUuyVEEpg369FCcNB1ZijeWy1yF, Failure ERR_OBLIGATION_EXPIRED, stayed READY; nonce replay on obl-verify-demo CgfxG46Z57EquMGr5CtNZXnAn5VyE1LrQLWRMKqFcf5e, Failure ERR_NONCE_ALREADY_CONSUMED, stayed PAID. Zero tokens moved on production. Final production state: policy-001 spent 975001000, reserved 0, funded 1000000000, frozen false; policy p5-prod-001 spent 0, reserved 0, funded 1000; acme 977004100, unchanged. The happy path was proven live on the test vault only, with identical code, not repeated on production.
- Gas: settle gas was not re-measured in Phase 6. The Phase 4 measured figure, about 7.362 TGas total (vault 2.867, ft_transfer 2.017, callback 2.478), stands until a re-measurement is done. No Phase 6 change touches the settle path after the checks (confirmed in the diff), so the figure is unchanged. The audit's live measurement corroborates within noise: the playground settle totalled 8.353 TGas including three 0.223 TGas token receipts, with execution receipts 2.870, 2.017, and 2.482.
- Draft status: the draft text above is confirmed by Lane B but NOT yet applied to docs/contract-api.md. Application happens at Phase 6 close on Master, after Lane B confirmation, following the Phase 5 close pattern. This row does not claim the document already contains the section.
- Live state at sign-off: policy-001 limit 1000000000, spent 975001000, reserved 0, funded 1000000000, not frozen, headroom 24999000; policy p5-prod-001 limit 1000, spent 0, reserved 0, funded 1000, headroom 1000; production receipts 0 to 7, eight total, verify-live all true; test vault policy p6-001 spent 3000, reserved 0, funded 10000, not frozen; p6-obl-006 and p6-audit-001 PAID; acme-supplies.testnet 977006100.
- Checks on lane-b 14b16fb, run by Adejoke: scaffold typecheck clean, frontend typecheck clean, conformance 6/6, Jest 68/68 (7 suites), playground, budget, and verify-live regressions unchanged (8 receipts all true).

Sign-off: rastadev (Lane B), 2026-11-05


## Phase 7: Reputation signals, real and scoped

Status: Phase 7 CLOSED 2026-11-06. Lane B signed 2026-11-06 in b8d78dd; Lane A signed 2026-11-06; no contract change, so no corrections draft; lane-b merged fast-forward to b8d78dd; Master pushed.

Sign-off: Johnson (Lane A), 2026-11-06

Lane A close note: section 2.6 audit PASS 2026-11-06, 24 itemized checks, no blocking findings, Jest 95/95, conformance 6/6. Console gate proven live on the test vault both ways: escalate without approval on p7-audit-004 (no settle attempted, stayed READY), PAID with owner approval on p7-audit-005 (settle 7HHtxoHX7bvYpRmdm5pyhwhBWWRiCUHiGPMDye8F1oKh, agent balance 0 to 100, receipt index 7). The acme finding, verified live on three RPC endpoints: acme-supplies.testnet does not exist on chain, yet holds 977006100 in token balance across 8 receipts, because settle uses plain ft_transfer; future demo settles should use a recipient account that exists. Production final state at close, read live: policy-001 spent 975001000, reserved 0, funded 1000000000, frozen false, headroom 24999000; receipts 0 to 7, eight total, all true; acme 977006100.

Evidence:
- Lane B: lane-b 28c6edf (reputation engine, snapshots, wrapper gate). PR 8 open, head 28c6edf.
- Lane B acceptance audit, section 2.6, 2026-11-06, 24 itemized checks: PASS, clean, no blocking findings. What was checked live from the PR head: scope clean (single commit on Master 38cd48c, 12 files, 1948 insertions, 8 deletions, no contract or frozen doc changes, no signing); no keys or build outputs in the diff or the head tree; exactly four signals, each with source and timestamp; account existence live (acme not found, agent exists with code hash 11111111111111111111111111111111); account age from snapshots with the lower bound stated; prior vault interactions from our receipts (acme 8, agent 0); blocklist unavailable, honestly reported, with the provenance record naming nine candidates; BLOCK path proven by tests with a fixture URL, not live; unknown maps to WARN with score null; snapshot method specified and the first snapshot conforms to it; malformed snapshots rejected on read; wrapper gate logic matches the doc; console gate live on the test vault twice (escalate path and approve path); CLI reputation command reproduces the doc samples live; reputation-snapshot command works live; typechecks clean; conformance 6/6; Jest 95/95 in 10 suites; regressions unchanged; no code-change history claim; the acme finding verified live; no live ALLOW, honestly stated. The audit record is the audit file supplied 2026-11-06; PR 8 itself carries no audit comment.
- Independent verification by Lane B of the audit's live claims, via RPC reads from this machine, 0 mismatches: all seven audit transactions re-queried (create D74fgyw3Pmf92iHemTQkZ7ughrG6R7ckJHN9TYf4CVu1, request 8zdgHw2289xXtvi24RQrsMSKRQUGMXauZrrB7GqsyMbT, submit AF2TYVrc5EXXbLpBqnpKzvpkhMwwsA2zu8ae8vQ9Uh6V for p7-audit-004; create DwdDvRim46XPQ61Q4ZcSGVz81zBPRQ8rf9xjQF9KJ6TA, submit 863D6FPF9ewN2ppCFpY4yzLnAAjgSWpYPy5C75QgWiNZ, settle 7HHtxoHX7bvYpRmdm5pyhwhBWWRiCUHiGPMDye8F1oKh for p7-audit-005; storage_deposit FbCLsHZ4Wk9cGPbgsts6nsyfZuPL1wABSnSvz6zj2j7c for the agent), all SuccessValue. State reads: p7-audit-004 READY with transfer_attempt 0 (escalate path, no settle attempted), p7-audit-005 PAID with transfer_attempt 1, p7-audit-003 READY with transfer_attempt 1 (the failed-transfer path from the first approve attempt, before the agent was storage-registered), test vault receipt index 7 is p7-audit-005 amount 100 to the agent, test vault policy p6-001 spent 3100, agent ft_balance_of 100, production unchanged (policy-001 spent 975001000, receipts 8, acme 977006100).
- The acme finding, verified live by the audit on three RPC endpoints and re-verified by Lane B on the same three: acme-supplies.testnet returns UNKNOWN_ACCOUNT at current blocks on https://test.rpc.fastnear.com, https://rpc.testnet.near.org, and https://rpc.testnet.fastnear.com, while cynex-agent.cynexmaster.testnet exists on all three at the same blocks. The token contract still records a balance of 977006100 for acme and a storage registration of 1250000000000000000000 yocto total. The eight production receipts to acme are real. The mechanism is sourced in the contract: settle calls plain ft_transfer (contract/src/lib.rs line 897), which only updates the token contract's internal ledger and succeeds even when the recipient NEAR account does not exist. So 977006100 in token units was credited across eight settlements to an id that has no account behind it, and nobody controls those tokens on chain. Whether the account never existed or was deleted is not sourced, and neither is claimed. This is a finding about the demo recipient chosen in earlier phases, not a defect in the Phase 7 deliverable; it does not block Phase 7 close. Any future demo settle to acme should use a recipient account that exists, or the owner should decide explicitly with the WARN in front of them.
- Snapshot timestamp observation, confirmed by Lane B against the chain: the first snapshot records block 276445952 with block_timestamp 1793943024164381400, while the chain header timestamp for that block is 1793943024164381335, a difference of 65 ns, because block_timestamp is stored as a JS number and the value exceeds 2^53, so it rounds to the nearest representable double. Both values parse to the same double; the millisecond value is exact, the block height is exact, and a later reader can still check the snapshot against the chain. The doc wording "nanoseconds, from the block header" is slightly imprecise; the stored number is the header timestamp rounded to double precision. No change required; a future snapshot format should store the timestamp as a string if exact nanoseconds matter.
- Audit setup notes, recorded, not findings: the agent account was not storage-registered on usdc.fakes.testnet, so the first approve-path settle attempt failed at ft_transfer and the vault correctly returned the obligation to READY with transfer_attempt 1 and no receipt (the Phase 3 transfer-failure path working as designed); the audit registered the agent with storage_deposit tx FbCLsHZ4Wk9cGPbgsts6nsyfZuPL1wABSnSvz6zj2j7c, 0.00125 NEAR from cynexmaster.testnet, and the approve path then settled cleanly. Five test-vault obligations were created in the audit (p7-audit-001 CREATED, p7-audit-002 READY, p7-audit-003 READY with transfer_attempt 1, p7-audit-004 READY, p7-audit-005 PAID), all test-vault only with one-hour expiries, none touching production. Temporary key-string files created for the audit were deleted after the runs, as in Phase 6.
- Live state at sign-off: policy-001 limit 1000000000, spent 975001000, reserved 0, funded 1000000000, not frozen, headroom 24999000; policy p5-prod-001 limit 1000, spent 0, reserved 0, funded 1000, headroom 1000; production receipts 0 to 7, eight total, verify-live all true; test vault policy p6-001 spent 3100, reserved 0, funded 10000, not frozen; agent ft_balance_of 100; acme-supplies.testnet 977006100.
- Checks on lane-b 28c6edf, run by Adejoke at build time: repo-root typecheck clean, frontend typecheck clean, scaffold typecheck clean (strict), conformance 6/6, Jest 95/95 (10 suites), playground, budget, and verify-live regressions unchanged (8 receipts all true), attack runner dry-run on both vaults exit 0.

Sign-off: rastadev (Lane B), 2026-11-06


## Phase 8: OutLayer spike (TEE route investigation)

Status: CLOSED. Investigation complete, verdict recorded. The spike
report is committed as Master a6dbd30 and pushed 2026-11-06.

- Scope: investigate OutLayer as the TEE route for Phase 9 layer 2,
  via GitHub-source request_execution and FastFS hosting.
- Verdict: DO NOT integrate OutLayer. TRUSTED_RELAYER remains the
  single trust mode.
- Evidence: two live GitHub-source request_execution calls produced
  no verifiable execution. One left pending with no worker resolve
  tx and no attestation; the retry failed with 'Execution promise
  failed'. Only 0.001 NEAR base fee was charged. FastFS hosting also
  failed: three on-chain upload calls failed at the NEAR level, the
  file was never served, so the WasmUrl path was never successfully
  exercised. A successful verification would cost only about 0.001
  to 0.0021 NEAR, so cost is not the blocker, reliability is.
- Reviews: round 1 all FAIL with fixes applied, round 2 all PASS.
  Sol gate FAILED with 7 findings, all fixed and verified, including
  a real callback-type error.
- Full report: docs/spike-outlayer.md.
- Note: the OutLayer CLI Project flow (pre-published WASM, no
  Payment Key on testnet) was found later during the Phase 9
  workaround investigation and became the working TEE route. The
  Phase 8 verdict stands for the GitHub-source route it investigated.

Sign-off: Johnson, 2026-11-06


## Phase 9: Three-layer verification (on-chain preimage, TEE provenance, VRF anchor)

Status: CLOSED 2026-11-06. Lane A shipped and proven live; Lane B
acceptance audit PASSED 2026-11-06 and Johnson signed the Lane B
acceptance below; Adejoke's Lane B sign is recorded below. The joint
fresh-clone reproduction PASSED 2026-11-06 (see the reproduction entry
at the end of this section).

Evidence:
- Lane A: Master 42c9bf6 (layer 1, bounded on-chain preimage evidence,
  69 tests), bbc8464 (layers 2 and 3, TEE provenance via OutLayer
  Project flow plus VRF anchor, 94 tests), f7fb83a (README TDX quote
  fix from the Sol full-audit finding). Code hash
  7PBw1x6HbH3Eu2dWrTKjEEfxdJnAfFPwPJS5vZMM5zRC on both vaults.
  Reviews: Argon, GLM, DeepSeek GATE PASS (0 blocking); Sol full-audit
  GATE PASS (0 blocking, 2 non-blocking PARTIALs, README quote fixed).
  Fresh near-agent-skills check PASS (39 items). Live proof on the test
  vault (layer 1 happy and negative, TEE request 10640 READY with a
  real TDX quote) and on production (layer 1 happy and negative, TEE
  request 10705 READY, no funds moved, no settle called).
- Lane B: lane-b 638695e, PR #9 open, 11 files, 1258 insertions, 92
  deletions (console wiring for PREIMAGE and TEE, cynex-verify --csv,
  playground polish, README reproduction steps, docs/phase9-lane-b.md).
- Lane B acceptance audit, section 2.6, 2026-11-06: PASS. Proven live
  on the test vault by the auditor, not by the delivery: PREIMAGE
  obligation laneb-audit-preimage-001 went READY via
  submit_evidence_preimage (tx
  8npcKTg97FcyGYs75X7jAEYR1eoYSAVPZPunqeNUADY); TEE obligation
  laneb-audit-tee-001 went READY via request_tee_verification (tx
  bn4FepHMcPQdnkEy3HHwE2kURbrBFaCALb4zTnoFzB5, 300 TGas, poll attempt
  2). Both confirmed READY on chain, policy p6-001 unchanged (spent
  3100, reserved 0, funded 10000), no funds moved. cynex-verify --csv
  proven live on production: 8 receipts, all verified_ok=true,
  identical to verify-live, header exactly the frozen columns. Jest
  119/119 in 12 suites (baseline 95/95 in 10 on Master), scaffold and
  frontend typecheck clean, conformance 6/6. Two PARTIAL issues,
  neither a defect in the delivered wiring: npm run jest needs
  NODE_PATH set in a fresh checkout (pre-existing quirk, Master also
  fails 1 suite without it), and the console settle step could not be
  exercised on the test vault because the agent scoped key is bound to
  the production vault. The audit record is held outside the repo at
  cynex-system/phase9-lane-b-section26-audit.md.
- Live state at Lane B acceptance: production policy-001 spent
  975001000, reserved 0, funded 1000000000, frozen false, receipts 8,
  agent ft_balance_of 100, acme-supplies.testnet 977006100 (does not
  exist on chain, see the Phase 7 acme finding, never settle to it).
  Three production proof obligations unsettled (p9-prod-preimage-001
  READY, p9-prod-preimage-002 EVIDENCE_PENDING, p9-prod-tee-001
  READY, 100 units each); two audit obligations on the test vault
  unsettled (laneb-audit-preimage-001 READY, laneb-audit-tee-001
  READY, 100 units each). What to do with them is Johnson's decision.

Sign-off: Johnson (Lane B acceptance audit, section 2.6), 2026-11-06

Sign-off: rastadev (Lane B), 2026-11-06
## Judge's audit fixes (2026-11-06)

Status: all 11 TRUE findings from the judge's audit fixed, reviewed, committed
as 6b40576, deployed to the test vault and proven live, deployed to production
and proven live. Phase 9 is not closed by this entry: the joint fresh-clone
reproduction is still outstanding.

Fixes (contract/src/lib.rs, docs/contract-api.md, docs/threat-model.md,
README.md; 4 files, 1272 insertions, 119 deletions): - Reconciler can no
longer resolve to any outcome: the READY/CANCELLED arm of resolve_settlement
is owner-only, and a READY-resolved obligation is marked in a resolved-ready
LookupMap (prefix b"y") so it can never settle again. The owner must verify on
chain that the transfer failed before resolving READY or CANCELLED. - Shared
transfer-timeout guard require_transfer_timeout_elapsed() for
cancel_obligation and resolve_settlement from RECONCILIATION_REQUIRED. -
MAX_TRANSFER_ATTEMPTS = 3: after three confirmed transfer failures the
obligation escalates to RECONCILIATION_REQUIRED, retaining reservation,
in_flight, dispatch time, and token lock. No public resume. -
request_tee_verification checks native_headroom_yocto() (liquid headroom, not
total balance) and uses the frozen ERR_VAULT_STORAGE_EXHAUSTED. - TEE guest
version pinned: version_key
8abfe08bc62919dd3f0aea2c2ea5dbe91d5484c14d6a55289053dce1d0387a6f, the live
active guest version. TDX quote verified off chain, VRF signature is the
on-chain anchor (the contract runtime has no quote verification primitive). -
set_reconciler takes Option<AccountId> (a string deserializes to Some, null
clears); request_evidence rejects a frozen policy (ERR_POLICY_FROZEN) and an
expired obligation (ERR_OBLIGATION_EXPIRED). - Expired-obligation checks in
submit_evidence, submit_evidence_preimage, and request_tee_verification report
ERR_OBLIGATION_EXPIRED, not ERR_EVIDENCE_EXPIRED. - submit_evidence uses a
positive match on VERIFIER_EVIDENCE_TYPE ("delivery-note"); anything else
rejects with ERR_EVIDENCE_MISMATCH. - Over-limit funding refused in full in
ft_on_transfer only (checked_add, full amount returned unused,
ERR_BUDGET_EXCEEDED logged); deliberately not in assert_policy_invariant, so
freeze and unfreeze still work on an already over-funded policy. - Owner-only
cancel from BLOCKED and WARN_PENDING, with an explicit require!(!in_flight). -
create_obligation fail-fast validation: amount > 0 (ERR_TERMS_MISMATCH),
expires_at_ns in the future (ERR_OBLIGATION_EXPIRED), evidence_type in
PREIMAGE, TEE, delivery-note (ERR_EVIDENCE_MISMATCH). - on_transfer_complete
is categorically non-panicking: reservation arithmetic and the invariant check
return early without writing state on inconsistency. The sha256 expect sites
and the receipt log unwrap() now use unwrap_or_default. No Borsh layout
change: the marker is an on-demand LookupMap, the Contract struct is
unchanged, no migration needed.

Reviews (all before commit, GMI only): Gemini 4 Argon GATE PASS (0 blocking),
DeepSeek V4.1 Flash GATE PASS (0 blocking), GLM-5.3 Flash GATE PASS (0
blocking, on a minimal prompt after four empty outputs on larger prompts; its
five UNPROVEN items were all verified FALSE against the code). Sol gate 1 GATE
FAIL with 0 blocking (scope: full callback body and verbatim docs not
supplied). Sol gate 2: findings 1-11 FIXED, 1 blocking (callback could panic,
pre-existing code). Sol gate 3, focused on the callback fix: GATE PASS (0
blocking). Near-agent-skills check PASS, 0 blocking (skills at cb32b6a). Build
green: fmt, clippy --all-targets -D warnings, cargo test --lib, 125 tests
passed.

Live proof, test vault (cynex-testvault.cynexmaster.testnet), 2026-11-06: -
Wasm: cargo near build non-reproducible-wasm, 257840 bytes, SHA-256
c188fa1ef7c18d1666f5e6e5e1d817bc0c3e5b56ecbae0c7d927afb38ed2acc0, base58
E2Uq5FzNcfGuDHQfqTGx6Rqd41ZwsBDXtYVx6bhQoFd1. Deploy tx
DdLzsaZqwyS6yd1rNKVLY6ekpHCZLSjcJ6Boi6HPJ3r8 (first attempt tx
3ZvK8ijZXhXNev2PWbb113LqwSmSdfu2jtEoZPZoMLqy failed ActorNoPermission, signed
by the owner key instead of the test vault key; retried with the correct key).
Code hash 7PBw1x6H to E2Uq5FzNcfGuDHQfqTGx6Rqd41ZwsBDXtYVx6bhQoFd1. - PREIMAGE
happy: fj-pre-001 (100 units, nonce 101) CREATED to EVIDENCE_PENDING to READY
(create tx 9k14Xy2eBtkUMmPu1JzJeGYCoGRTVqgzP1wBV499yyKv, request tx
56U4yweaxUyxqd8qKDJjb19nCTzRKdG9WJf3ZCVZo3uT, submit tx
Cq2M6kK4GjpwGXsxEoRZBdZQtNBBhjrszYfJaHxn4cW4, 1.80 TGas). PREIMAGE negative:
fj-pre-002 wrong bytes rejected with ERR_EVIDENCE_MISMATCH, state unchanged
EVIDENCE_PENDING (the failed submit tx hash was not captured by the helper). -
TEE full path: fj-tee-001 (100 units, nonce 103) to READY, OutLayer request
11176, guest version 8abfe08b, evidence URL
https://raw.githubusercontent.com/near/agent-skills/cb32b6a/README.md (SHA-256
26d42adb722f5ef9a11238e7f15f780b01abca9507be3457e7727beb4e295b0b), VRF
signature verified on chain by the callback and off chain against the testnet
VRF public key. Request tx 9nG7v6gi3n9X57tmmX7jP56tuUf71JCZtkNctoZLGLi8, 300
TGas, charged 0.00113 NEAR, refunded 0.00887 NEAR. - Settle: fj-pre-001 to
PAID with the owner key, tx DMWtguEdvNZej8P3VR8569UQ73aAzmLRLupMMbXHinFV, 100
TGas. Policy p6-001 spent 3300 to 3400, reserved 0, funded 10000, receipts 10
to 11, agent token balance 500 to 600. - Reconciler cannot resolve: resolve as
reconciler rejected with ERR_NOT_OWNER, state unchanged
RECONCILIATION_REQUIRED. Retry escalation: fj-retry-001 (recipient
fj-unregistered.testnet) failed 3 settles, then RECONCILIATION_REQUIRED with
reserved 100 retained and the token lock held (a settle probe on fj-tee-001
rejected with ERR_TOKEN_IN_FLIGHT). Cancel after timeout: tx
8cAdzXbiUn71Mid7Xns4ZYhbcQq7PvTHfACm9hCdCk9s, CANCELLED, reserved 100 to 0.
Over-limit funding: 1 unit past a 1000 limit refunded in full, funded stayed
1000. Cancel from BLOCKED (fj-block-001) and WARN_PENDING (fj-warn-001): both
CANCELLED. TEE balance check unit-proven only.

Live proof, production (cynex-vault.cynexmaster.testnet), 2026-11-06: - Same
wasm, SHA-256 verified before deploy, no rebuild. Deploy tx
Ba8uDygsaACrGS9mMtjjiuCoTdNmy34gLdmKBm7PwJUr, signed with the production vault
key. Code hash 7PBw1x6H to E2Uq5FzNcfGuDHQfqTGx6Rqd41ZwsBDXtYVx6bhQoFd1,
exactly matching the test vault deploy. - PREIMAGE happy: fj-prod-pre-001 (100
units, p5-prod-001) to READY (create tx
AYcRupfRuivR1huANhbJGUBhNQzzFCteEZjHhgzAusY6, request tx
6ZSgPEpeyuTKCWzJ1AGKdjTGMz2kM5jrgHV7PhcoJWJJ, submit tx
7uMWKD6iYPXkiQT8FXfPGo8rooJzhxEUjTYk8eR8htih). PREIMAGE negative:
fj-prod-pre-002 wrong bytes rejected with ERR_EVIDENCE_MISMATCH, state stayed
EVIDENCE_PENDING (failed tx Fq6kNMGLvFGQ4TYurRhCPbSmMwRbrf747y8hKfxrzvfU). -
TEE full path: fj-prod-tee-001 to READY, OutLayer request 11190, guest version
8abfe08b, VRF verified on chain by the callback. Request tx
6sHmmcpxnEJAyg7CVbqYn74947ax2Qd1ozgQFjBjN11X, 300 TGas. - Settle with the
AGENT scoped key: fj-prod-pre-001 to PAID, tx
CShdVDWT7kg4HyKEEriPivBiBfnRpKch1KtC74ZUv46J, 100 TGas, receipt index 10.
Policy p5-prod-001 spent 200 to 300, reserved 0, funded 1000, receipts 10 to
11, agent token balance 600 to 700. - Over-limit funding: 100 units past the
1000 limit refunded in full (tx GrckusPzden4if26ML8qVekuzpZUzGVZko6QpnhxXRGA),
funded stayed 1000. Reconciler cannot resolve: fj-prod-recon-001 escalated
after 3 failed settles, resolve as reconciler rejected with ERR_NOT_OWNER (tx
32JeyWNZ6NbK8b2YmendqEfd92XwnX2GLn8L4ig5o9a5), owner cancelled it afterwards
(tx 7J5NBZAN74MYRixTWwZWPWWH9sBHEkd1XzwDQ4aCiSxq), reserved back to 0. - Final
production state: p5-prod-001 spent 300, reserved 0, funded 1000, frozen
false, reconciler null; policy-001 unchanged (spent 975001000, reserved 0,
funded 1000000000); receipts 11; agent balance 700. fj-prod-pre-002 stays
EVIDENCE_PENDING and fj-prod-tee-001 stays READY (unsettled, per scope);
neither holds a reservation or funds. The dead Phase 9 production obligations
(p9-prod-preimage-001, p9-prod-tee-001, READY but EXPIRED) were not touched.

- Joint fresh-clone reproduction, 2026-11-06, the last Phase 9 close
  item: fresh clone of Master 84f0d54 into a clean directory, the
  documented commands run exactly as written. Contract: `cargo test
  --lib` PASS (125 tests, 0 failed); `cargo clippy --all-targets --
  -D warnings` FAILS on the default Rust 1.99.0 with the new
  `clippy::chunks_exact_to_as_chunks` lint (src/lib.rs:67,
  `chunks_exact(2)`), PASSES with RUSTUP_TOOLCHAIN=1.93.0; `cargo
  near build non-reproducible-wasm` PASS (cynex_vault.wasm, 265,737
  bytes). Frontend: `npm install` PASS (379 packages); `npm run
  typecheck` PASS; `npm run jest` FAILS as documented in a fresh
  checkout (3 suites, "Cannot find module 'near-api-js'"), PASSES
  119/119 with NODE_PATH set to frontend/node_modules. Console: the
  documented `npx tsc` line emits known `near-api-js` type errors
  (TS2307, exit 2) but emits working JS (console.js, 28,133 bytes);
  `node dist-test/agent/console.js` prints its usage, `node
  dist-test/cli/cynex.js` prints the full usage listing. No live
  console run was performed in the reproduction; the console's live
  behaviour was already proven on production and the test vault.
  Four trivial README doc corrections were made with this
  reproduction (toolchain 1.93.0, `npm install`, NODE_PATH for jest,
  the tsc type-error note). No code was changed. The `chunks_exact`
  clippy finding is recorded as a code-level item (the code could use
  `as_chunks::<2>().0` or an `#[allow]`), not fixed here. Full report
  held outside the repo at cynex-system/phase9-fresh-clone-reproduction.md.

Sign-off: Johnson (Phase 9 close, fresh-clone reproduction PASSED), 2026-11-06

## Scorecard: fifth reputation signal (code-change recency)

Status: Delivered as Lane B work on the scorecard brief
(2026-11-06). The section 2.6 audit of this delivery is pending;
Adejoke's Lane B sign-off follows the audit. Not a numbered phase;
it closes the last open scorecard item for the reputation engine.

Evidence:
- Lane B: branch lane-b-code-change-signal, 7 modified files +
  1 new snapshot (services/reputation/reputation.ts,
  services/reputation/live-sources.ts, agent/wrapper.ts,
  cli/cynex.ts, agent/console.ts, the two test files,
  demo/reputation-snapshots/2026-11-06-205637Z.json). The signal
  compares the receiver's current code hash (RPC view_account) to
  the latest snapshot and assesses recency from the snapshot window
  and the NearBlocks v3 deployments timestamp (exact age when the
  indexer is current, window otherwise, never a false precise age).
  Thresholds: BLOCK within 24h (or a change with no other history),
  WARN within 7d (or a wide window), ALLOW on no change or a code
  stable longer than 7d; no contract and first observation are
  neutral. The gate refuses on a code-change BLOCK (naming the
  signal) and escalates on WARN.
- Tests: Jest 135/135 in 12 suites (baseline 119/119 in 12).
  Scaffold and frontend typecheck clean, conformance 6/6.
- Live proof on testnet (2026-11-06): production vault BLOCK
  (code changed Phase 6 hash G3Mt2gKs to Phase 9 hash 7PBw1x6H,
  deployment tx 7HPscpDE6BikHutgALKJP6BDh9LArFS2aZGtHRHTH6ki,
  age 5.2h); test vault first observation neutral, then no change
  after a snapshot; agent no contract neutral, ALLOW score 1.000.
  Delivery doc: docs/scorecard-code-change-recency.md.
- Live state at delivery: production receipts 10 (all
  verified_ok=true; new: prod-console-preimage-001 and
  prod-console-tee-001, 100 units each to the agent, on
  p5-prod-001), p5-prod-001 spent 200 headroom 800, agent
  ft_balance_of 500, p9-prod-preimage-002 CANCELLED (was
  EVIDENCE_PENDING), p9-prod-preimage-001 and p9-prod-tee-001
  still READY.

- Lane B acceptance audit, section 2.6, 2026-11-07: PASS. All six
  acceptance criteria met, no blocking findings, no code change
  requested. Auditor verified: Jest 135/135 in 12 suites, frontend
  typecheck clean, conformance 6/6, live proof on testnet for all
  four cases (no change ALLOW, first observation neutral, no
  contract neutral with ALLOW score 1.000, production vault BLOCK
  on the code change at 7.4h exact age), gate tested directly
  (BLOCK refuses and names code_change_recency, WARN escalates,
  ALLOW proceeds). Three PARTIALs, none a defect, none needing a
  fix: (1) scaffold typecheck has 5 pre-existing near-api-js
  errors, identical on Master, none in the new code - "scaffold
  typecheck clean" in the PR is only true as "no new errors";
  (2) the NearBlocks indexer missed the Phase 9 deployment tx in
  its list (third-party data gap; the signal handles it by taking
  the max timestamp and falling back to the window); (3) the
  ledger live state in this entry (10 receipts, spent 200, agent
  500) was true when written on 2026-11-06 and has since moved to
  11, 300, 700 - accurate as a delivery-time record. Lane B
  independently re-verified before signing: Jest 135/135, frontend
  typecheck clean, conformance 6/6, and the production vault BLOCK
  live on the current code (judge's fixes deployment E2Uq5FzN,
  tx Ba8uDygsaACrGS9mMtjjiuCoTdNmy34gLdmKBm7PwJUr, age 8.1h) -
  the signal has now caught a second real code change after the
  Phase 9 one.

Sign-off: rastadev (Lane B), 2026-11-07

Sign-off: Johnson (fifth signal Lane B acceptance, section 2.6 audit PASSED), 2026-11-07

- Expired READY cleanup, 2026-11-07. The fix for the dead production
  obligations p9-prod-preimage-001 and p9-prod-tee-001 (READY but EXPIRED,
  no cleanup path: cancel_obligation refused READY, settle rejected with
  ERR_OBLIGATION_EXPIRED). New owner-only method cancel_expired_ready in
  contract/src/lib.rs: requires state READY, requires in_flight false,
  requires block_timestamp() > expires_at_ns (ERR_NOT_EXPIRED otherwise,
  the exact complement of settle, live at expires_at_ns), moves the
  obligation to terminal CANCELLED, clears pending evidence fields, drops
  the TeeRequest record by obligation id. No funds, reservation, token lock,
  or receipt moves; no stored field changes, so no migration. 12 new unit
  tests, suite 137 passed, 0 failed (baseline 125). fmt clean, clippy
  --all-targets -D warnings clean, overflow-checks on in release profile.
  Gates, all on GMI: Argon GATE PASS, 0 blocking; GLM GATE PASS on re-review,
  0 blocking (its first-round F1/F2 verified FALSE against lib.rs: the b"t"
  prefix is the established TeeRequest prefix in all 19 uses, and every READY
  path releases any reservation and lock); DeepSeek re-review GATE PASS,
  0 blocking (first full run truncated with no verdict; three re-review rounds
  each found one real test gap, each fixed); Sol gate GATE PASS, 0 blocking.
  Near-agent-skills check PASS, 0 blocking (direct check against the skill
  files, main cb32b6a). Full finding verification at
  ~/workspace/cynex-system/expired-ready-cleanup-review-verification.md.
  Wasm sha256 5d943d2db2f8b5c29ac134b54a679c84eee07b6dae17809f6f12ce7a79e8e3b4,
  new code hash 7JJ27aMWztX2F3z4W9zxSmK93eMa7RuTGvmAwWab9x4B.
  Test vault deploy tx HWNENx52Cvxb4L7YNobQGH5vxR2tgKVEDiK8bkXXW6zc (first
  deploy CRoTtLFx47MSPriwP6PJWRBnL2Q2Uxx1nAnYYwnXuKFe). Preimage proof,
  obligation cleanup-test-preimage-003, policy p6-001, 100 units to the
  agent: create 2iFYt6cqGerUBtTL134wLoRzNGXwcK9KQ6McaGqxp8qp,
  request_evidence DaCC46PtWt7trDNfFo9yJ15kryd4vyr8MMimCoXafzEw, submit
  2WwbN82scE42CoX7ADCFy76ux5UEhSpuAPQReQy8vAY9, READY; live cancel failed
  ERR_NOT_EXPIRED, tx CwMySno7Nnjkgfj3EBDqzjfw9QM9kV6PXRiV6HN36eeJ; expired
  cancel tx Ahv5oQHpksrdi8nXdkn8KN1m5STkrBJbESBimC419jpt, CANCELLED; settle
  after cancel failed ERR_INVALID_STATE, tx 9ips83KmTBHuGoiiuDnNhYvuyFLw3Xhtbqyifv6UVsHH.
  TEE proof, obligation cleanup-test-tee-001, same policy and amount:
  create FpHpKvG1HwGuywpZhL1PqCkWATjuKW9p75emPcJvBPrc, request_evidence
  H3PFEsWZjm3MoJ5dVLFwY9td3KbrjyT9P3JT1B82SXvJ, request_tee_verification
  3tCyVS3CjKuNU1pp2F6mTbpsSf96D2XieDuKCPKYJMGf, READY through the OutLayer
  guest and VRF; expired cancel tx eZLnLQfG8Jqnkkntei6EJhwHnnHVc6dCrmfavhwjQ2d,
  CANCELLED; settle after cancel failed ERR_INVALID_STATE, tx
  4TbKPXHUrjevYmQBf4ibSb2ya8AMmtRebWGN5SH7ymY3. Test policy p6-001 after:
  spent 3700, reserved 0, funded 10000, receipts 14, agent balance 1000.
  Production deploy tx Drz9TrJUzspeeF7TmgmQ7FksQMd7gFk1AcmfYgsakhCB, code hash
  7JJ27aMWztX2F3z4W9zxSmK93eMa7RuTGvmAwWab9x4B on both vaults. Production
  cleanup: p9-prod-preimage-001 cancel tx 5RsrMW4iirDEQV2yzU4GWk98VxhLeXFjGy8sqJHsBTkg,
  p9-prod-tee-001 cancel tx 3mewqMYoi1Qwh3H8nwvG6qFW43DGNZjGmJPdj1nyqW2N, both
  CANCELLED; settle after cancel on p9-prod-preimage-001 failed
  ERR_INVALID_STATE, tx 4iGkiTducaYWeUPEzEB1wygnnuGupooMp3xu9VGY71R.
  Production policy p5-prod-001 after: spent 300, reserved 0, funded 1000,
  receipts 11, agent balance 1000. Receipt chains verified on both vaults
  after the deploy (production 11 receipts, test 14, all verified_ok by
  recomputing the hash chain against state). No other production obligation
  touched, nothing settled on production. Test-vault artifact:
  cleanup-test-preimage-001 sits EVIDENCE_PENDING, expired, holding no
  reservation and no funds (its submit used the wrong request id in the
  proof script, a script bug, not a contract bug); it can only be cleared by
  mark_evidence_timeout after EVIDENCE_TIMEOUT_NS. Full report at
  ~/workspace/cynex-system/expired-ready-cleanup-report.md. Work left
  uncommitted in the Cynex-expired-cleanup worktree for Johnson to review;
  NOT committed, NOT pushed.
