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
- Measured gas, reported but NOT jointly recorded here: settle 2.588 TGas, ft_transfer 2.023 TGas, callback 2.253 TGas, total about 6.86 TGas. Joint recording in docs/contract-api.md remains a close item and must not be done as a solo Lane B edit. A contract-api corrections draft (nonce, cancel, create_policy, reconciliation methods not implemented in Phase 2, state view, balances funded, measured gas with ranges) is pending for review separately and will be applied on Master after merge and re-sign, not as a solo edit.

Exception to the lane rule and to the ledger header rule, for this row only: commits e2d47cd and 74a61ed were authored by Jayanng, not by Adejoke, under a Phase 2-only exception. The exception was accepted by rastadev in chat on 2026-11-04, covering e2d47cd (settle gas and error reporting only), and re-confirmed by the re-sign instruction the same day, extending it to 74a61ed (console exactness, scaffold from chain, receipts print only). The lane rule resumes after Phase 2. Acceptance basis for the takeover fix and its continuation is live proof plus independent review by Adejoke, NOT a section 2.6 independent audit, because the auditor side authored both commits. Earlier Phase 2 audit rounds were section 2.6 audits by Jayaang.

Sign-off: Johnson (Lane A), 2026-11-04
Sign-off: rastadev (Lane B), 2026-11-04 (re-signed after 74a61ed, superseding 545746e)

Close note: Phase 2 audit basis is Lane A everyday review plus Sol gate on Lane A code, live testnet proof for both lanes, Adejoke independent review of Lane B code and chain state, and, for the takeover commits e2d47cd and 74a61ed only, live proof plus Adejoke independent review, NOT a section 2.6 independent audit, as labelled in the Lane B row. Contract-api corrections and measured gas in 9c70b69 are doc-to-code alignment only, no contract change. Deferred, not closed by this row: obl-002 READY 100000000 and obl-003 EVIDENCE_PENDING 250000000, both beyond the remaining 25000000 funded headroom, reconciliation methods not implemented in Phase 2 and planned for Phase 3, and broader cancel states not implemented in Phase 2.
