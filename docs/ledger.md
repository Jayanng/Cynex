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
