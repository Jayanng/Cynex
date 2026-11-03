# Lane B Phase P evidence — Instabox machine verification (supplementary)

This file supplements, and does not replace, docs/evidence/prep/lane-b-toolchain.md
and live-facts.md in Master (jayanng, Phase P commit c1cbf0f). Those files record
the jayanng-machine verification. This file records the same Phase P Lane B checks
re-run on the Instabox machine rastadev on 2026-11-03, before lane-b was created
from Master, so Lane B acceptance audit (build plan section 2.6) has live proof from
both machines, not a claim alone.

Machine: Instabox rastadev, agent-browser template, 4 vCPU / 8 GiB / 20 GiB,
home /data/home, work /data/workspace/cynex. GitHub login on the machine:
gh auth status — Logged in to github.com account natureloved, git protocol https,
token scopes gist, read:org, repo. git fetch origin succeeded after gh auth setup-git.

Frontend verification on Master scaffold (lane-b, before commit):
- cd frontend && npm ci: 86 packages added, 87 audited, 0 vulnerabilities
- node ESM import check: near-api-js JsonRpcProvider and Account are functions;
  near-kit Near and InMemoryKeyStore are functions. Imports resolve.
- Note: near-api-js v7 has no legacy connect / keyStores exports; Lane B code
  must use the v7 API (JsonRpcProvider etc.), not v6 patterns.

## Toolchain detail (from the Instabox run, root package at the time)

# Phase P - Lane B toolchain evidence (Instabox machine rastadev)

Run on the machine itself via the Instabox exec API, 2026-11-03.
Raw outputs recorded here; nothing typed in.

## Versions

- node: v22.23.3
- npm: 10.9.9
- git: 2.47.3
- rustc: 1.99.0
- cargo: 1.99.0
- wasm32-unknown-unknown target: NOT installed on this machine (Lane A
  toolchain gap, recorded, not hidden)
- cargo-near: NOT installed (cargo reports no such command near)
- near-cli: NOT installed (near command not found)
  Lane A / joint toolchain items above are for Lane A to install in Phase P;
  they do not block the Lane B Node scaffold.

## Node packages (installed in /data/workspace/cynex)

- near-api-js: 7.4.0 (registry latest at install time)
- near-kit: 0.20.2 (registry latest at install time)
- npm install: 85 packages added, 86 audited, 0 vulnerabilities

## Import check (both module systems)

- near-api-js resolves; exports include JsonRpcProvider,
  Account, Contract, KeyPairEd25519, Transaction, actions, formatNearAmount.
- near-kit resolves; exports include Near, InMemoryKeyStore,
  Amount, Gas, KeyType.
- Note: near-api-js v7 has no legacy connect / keyStores exports.
  Lane B code must use the v7 API (JsonRpcProvider etc.), not v6 patterns
  remembered from older docs. This is a Phase 0 interface note, not a
  Phase P failure: imports resolve and the provider classes exist.

## NEAR Agent Skills (on this machine)

- Clone: /data/workspace/near-agent-skills
- git fetch origin: clean, no changes
- HEAD = origin/main = cb32b6af195e636c1e9c2efe2ea75a6d85b6b67b
- Tree: clean
- Skills (8): near-ai-cloud, near-api-js, near-cli-rs, near-contract-audit,
  near-dapp, near-intents, near-kit, near-smart-contracts
- skills markdown line count: 11,404; all markdown in the clone: 11,448
  (matches the build plan 11,448 figure, which counts the root docs too)

## Scaffold (branch lane-b, NOT pushed)

- Directories: services/, agent/, frontend/, cli/, demo/, scripts/,
  docs/, docs/evidence/prep/, schemas/, tests/integration/,
  tests/test-vectors/
- Files: LICENSE (MIT), SECURITY.md, docs/ledger.md,
  docs/threat-model.md (draft, opened in Phase P, finalised in Phase 0),
  package.json, package-lock.json
- Remote: origin https://github.com/Jayanng/Cynex.git
- Local branch: lane-b (remote repo is still empty, Master, no commits)
- Nothing has been pushed. Push / PR is a separate, user-confirmed step.

## Live facts

See docs/evidence/prep/live-facts.md (testnet RPC reads).


## Live facts detail (from the Instabox run, testnet RPC)

# Phase P - Live facts re-verified (Lane B, testnet RPC)

Run from the Instabox machine on 2026-11-03 with near-api-js v7
JsonRpcProvider against https://rpc.testnet.near.org, finality final.
First attempt failed on the v7 query shape (missing finality); the
corrected call below is the recorded proof, not a typed-in value.

## Token

- usdc.fakes.testnet ft_metadata:
  spec ft-1.0.0, name Bridged USDC, symbol USDC.e, decimals 6.
  Matches the build plan exactly.

## OutLayer

- outlayer.testnet view_account code_hash:
  5waWVnt6g3FZfjR6vfYXZzpAi3sZdFy8cK2sLz4EJQDt
  (starts 5waWVnt6, as in the plan; block 276077202 at read time).
- outlayer.testnet estimate_execution_cost:
  7000100000000000000000 yocto = 0.0070001 NEAR.
  Matches the build plan exactly.
- outlayer.testnet get_execution_cost:
  ERROR: Contract method is not found at block height 276077214.
  This is the plan expected non-existence, worded by the node as
  method-not-found rather than a JSON-RPC MethodNotFound code.
  Recorded as-is, not hidden.

## Not yet proven (per plan, must be proven in Phase P / Phase 0)

- Exact static gas (TGas) values for ft_transfer + callback: not measured
  yet; Phase 2 closes this, never invented.
- OutLayer callback fields: not proven yet.
- Blocklist source URL (Lane B, Phase 7): not named yet.
- Mainnet payout account: supplied by the team lead only, never invented.


Differences from the jayanng files, recorded not hidden:
- Instabox run used a root package.json (near-api-js 7.4.0, near-kit 0.20.2);
  Master correctly puts the Lane B package in frontend/package.json
  (near-api-js ^7.0.0, near-kit ^0.20.0). The root package is NOT carried into
  lane-b, to avoid duplicating dependencies.
- On the Instabox machine, cargo-near, near-cli, and the wasm32 target were
  NOT installed (rustc/cargo 1.99.0 only). Those are Lane A / joint toolchain
  items, already recorded in Master lane-a-toolchain.md, and do not block Lane B.
- get_execution_cost wording: Instabox run recorded the node error as
  Contract method is not found; Master records it as MethodNotFound.
  Both mean the method does not exist, as expected in Phase P.
