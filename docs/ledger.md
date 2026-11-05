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
