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
