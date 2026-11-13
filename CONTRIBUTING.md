# Contributing to Cynex

Cynex is a purpose-bound settlement vault for AI agents on NEAR. The idea is fixed: a human authorizes an obligation with a fixed recipient, token, amount, evidence requirement, and budget, and the vault enforces those terms on chain. The agent is assumed compromised and holds only a scoped settle key. Contributions must work within that idea. If a change would need the idea to change, say so in the issue instead of opening a pull request for it.

## Before you start

Testnet only. Nothing in this repo spends real money, and no change should need mainnet. Never commit a key, a seed phrase, or a credential file. Key files live outside the repo and are never printed.

## Build and test

The repo pins Rust 1.93.0 in `rust-toolchain.toml`, so run the contract commands with 1.93.0. Clippy is clean on 1.93.0 and on 1.99.0 after the as_chunks lint fix (see the loose-ends section of `docs/ledger.md`).

Contract, from `contract/`:

```sh
RUSTUP_TOOLCHAIN=1.93.0 cargo fmt --check
RUSTUP_TOOLCHAIN=1.93.0 cargo test --lib
RUSTUP_TOOLCHAIN=1.93.0 cargo clippy --all-targets -- -D warnings
RUSTUP_TOOLCHAIN=1.93.0 cargo near build non-reproducible-wasm
```

Frontend, from `frontend/`:

```sh
npm install
npm run typecheck
NODE_PATH=$PWD/node_modules npm run jest
```

`npm run jest` needs `NODE_PATH` set to the frontend `node_modules` in a fresh checkout, or the suites that import `near-api-js` fail to load with "Cannot find module 'near-api-js'". The console compile line (the `tsc` line in `docs/deployment.md`) emits known `near-api-js` type errors (TS2307); tsc itself exits non-zero, but the line ends with `|| true` so the pasted command continues with status zero, and it still emits working JavaScript; those errors are expected, and `npm run typecheck` is the clean check.

One known exception: `cargo fmt --check` currently reports one pre-existing spot in `contract/src/lib.rs` (line 1512). Do not fix it in a docs-only change. Fixing it changes the wasm hash, because line numbers are embedded in panic locations, which breaks the source-to-deployed-code-hash correspondence in `docs/deployment.md`. It lands with the next contract change and redeploy instead.

## How to submit

1. Branch from `Master`. Keep the change small and focused.
2. Run every check above and make sure each one passes before you open the pull request.
3. Check the change directly against the near-agent-skills files and the frozen contract API in `docs/contract-api.md`. A summary of the skills is not a substitute for reading them.
4. Verify every finding the reviewers raise as true, false, partial, or unproven, with a reproduction or live proof as evidence. A bare pass with no itemized evidence is not accepted.
5. Do not name any other project in the README or the docs. Describe Cynex by its own properties only.
6. Do not push to `Master` directly. Open a pull request and wait for review.

## What gets reviewed

Every change is reviewed before it is merged. A change that touches the contract also needs a live proof on testnet before it is accepted: poll the view calls, read the exact values from chain, and keep the transaction hashes. A claim that a change works is not proof; the chain state is.
