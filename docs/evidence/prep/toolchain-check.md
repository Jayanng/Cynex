> Correction, 2026-11-03, by contract review: the Scaffold section below describes the pre-push state. The frontend branch was pushed to origin on 2026-11-03, after that section was written, and Master at that time was c1cbf0f. The lines saying the branch was not pushed and the remote was still empty are superseded by the push itself. The evidence above them is unchanged.

# frontend evidence — the build machine verification (supplementary)

This file supplements, and does not replace, docs/evidence/prep/agent-toolchain.md
and live-facts.md in Master (commit c1cbf0f). Those files record
the build machine verification. This file records the same frontend checks
re-run on the build machine on 2026-11-03, before the frontend branch was created
from Master, so the frontend acceptance audit has live proof from
both machines, not a claim alone.

Machine: the build machine, agent-browser template, 4 vCPU / 8 GiB / 20 GiB. GitHub login on the machine:
gh auth status — Logged in to github.com, git protocol https,
token scopes gist, read:org, repo. git fetch origin succeeded after gh auth setup-git.

Frontend verification on the Master scaffold (before commit):
- cd frontend && npm ci: 86 packages added, 87 audited, 0 vulnerabilities
- node ESM import check: near-api-js JsonRpcProvider and Account are functions;
 near-kit Near and InMemoryKeyStore are functions. Imports resolve.
- Note: near-api-js v7 has no legacy connect / keyStores exports; frontend code
 must use the v7 API (JsonRpcProvider etc.), not v6 patterns.

## Toolchain detail (from the run, root package at the time)

## Frontend toolchain evidence (the build machine)

Run on the machine itself, 2026-11-03.
Raw outputs recorded here; nothing typed in.

## Versions

- node: v22.23.3
- npm: 10.9.9
- git: 2.47.3
- rustc: 1.99.0
- cargo: 1.99.0
- wasm32-unknown-unknown target: NOT installed on this machine (contract
 toolchain gap, recorded, not hidden)
- cargo-near: NOT installed (cargo reports no such command near)
- near-cli: NOT installed (near command not found)
 Contract / joint toolchain items above are for the contract side to install;
 they do not block the frontend Node scaffold.

## Node packages (installed in the workspace)

- near-api-js: 7.4.0 (registry latest at install time)
- near-kit: 0.20.2 (registry latest at install time)
- npm install: 85 packages added, 86 audited, 0 vulnerabilities

## Import check (both module systems)

- near-api-js resolves; exports include JsonRpcProvider,
 Account, Contract, KeyPairEd25519, Transaction, actions, formatNearAmount.
- near-kit resolves; exports include Near, InMemoryKeyStore,
 Amount, Gas, KeyType.
- Note: near-api-js v7 has no legacy connect / keyStores exports.
 frontend code must use the v7 API (JsonRpcProvider etc.), not v6 patterns
 remembered from older docs. This is an interface note, not a
 failure: imports resolve and the provider classes exist.

## NEAR Agent Skills (on this machine)

- Clone: the workspace/near-agent-skills
- git fetch origin: clean, no changes
- HEAD = origin/main = cb32b6af195e636c1e9c2efe2ea75a6d85b6b67b
- Tree: clean
- Skills (8): near-ai-cloud, near-api-js, near-cli-rs, near-contract-audit,
 near-dapp, near-intents, near-kit, near-smart-contracts
- skills markdown line count: 11,404; all markdown in the clone: 11,448
 (matches the 11,448 figure, which counts the root docs too)

## Scaffold (frontend branch, NOT pushed)

- Directories: services/, agent/, frontend/, cli/, demo/, scripts/,
 docs/, docs/evidence/prep/, schemas/, tests/integration/,
 tests/test-vectors/
- Files: LICENSE (MIT), SECURITY.md, docs/ledger.md,
 docs/threat-model.md (draft),
 package.json, package-lock.json
- Remote: origin https://github.com/Jayanng/Cynex.git
- Local branch: frontend branch (remote repo is still empty, Master, no commits)
- Nothing has been pushed. Pushing is a separate step.

## Live facts

See docs/evidence/prep/live-facts.md (testnet RPC reads).


## Live facts detail (from the run, testnet RPC)

## Live facts re-verified (frontend, testnet RPC)

Run from the build machine on 2026-11-03 with near-api-js v7
JsonRpcProvider against https://rpc.testnet.near.org, finality final.
First attempt failed on the v7 query shape (missing finality); the
corrected call below is the recorded proof, not a typed-in value.

## Token

- usdc.fakes.testnet ft_metadata:
 spec ft-1.0.0, name Bridged USDC, symbol USDC.e, decimals 6.
 Matches the expected values exactly.

## OutLayer

- outlayer.testnet view_account code_hash:
 5waWVnt6g3FZfjR6vfYXZzpAi3sZdFy8cK2sLz4EJQDt
 (starts 5waWVnt6, as expected; block 276077202 at read time).
- outlayer.testnet estimate_execution_cost:
 7000100000000000000000 yocto = 0.0070001 NEAR.
 Matches the expected values exactly.
- outlayer.testnet get_execution_cost:
 ERROR: Contract method is not found at block height 276077214.
 This is the expected non-existence, worded by the node as
 method-not-found rather than a JSON-RPC MethodNotFound code.
 Recorded as-is, not hidden.

## Not yet proven

- Exact static gas (TGas) values for ft_transfer + callback: not measured
 yet; never invented.
- OutLayer callback fields: not proven yet.
- Blocklist source URL: not named yet.
- Mainnet payout account: supplied by the team lead only, never invented.


Differences from the Master files, recorded not hidden:
- run used a root package.json (near-api-js 7.4.0, near-kit 0.20.2);
 Master correctly puts the frontend package in frontend/package.json
 (near-api-js ^7.0.0, near-kit ^0.20.0). The root package is NOT carried into the frontend branch,
 to avoid duplicating dependencies.
- On the build machine, cargo-near, near-cli, and the wasm32 target were
 NOT installed (rustc/cargo 1.99.0 only). Those are contract / joint toolchain
 items, already recorded in Master contract-toolchain.md, and do not block frontend.
- get_execution_cost wording: run recorded the node error as
 Contract method is not found; Master records it as MethodNotFound.
 Both mean the method does not exist, as expected.
