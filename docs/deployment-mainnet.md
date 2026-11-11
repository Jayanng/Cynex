# Cynex mainnet deployment guide

A guide only. There is no mainnet deployment, and nothing here deploys one. Testnet is the rule: this project has no funds for mainnet, and the repo is public with testnet as the live network. This guide exists so a future maintainer can see the path to mainnet, and what must change before that path is safe to walk.

Run the commands in this guide from `contract/` unless stated otherwise. The paths below are relative to that directory.

## The one thing that changes everything

The contract as built is testnet only for layers 2 and 3. Four constants in `contract/src/lib.rs` are pinned to testnet values:

- `OUTLAYER_CONTRACT` is `outlayer.testnet`
- `OUTLAYER_PROJECT_ID` is `cynexmaster.testnet/cynex-verifier`
- `OUTLAYER_VERSION_KEY` is the testnet guest build `8abfe08bc62919dd3f0aea2c2ea5dbe91d5484c14d6a55289053dce1d0387a6f`
- `VRF_PUBLIC_KEY` is the testnet key, published at `https://testnet-api.outlayer.ai/vrf/pubkey`

The contract's own comment on the VRF key says testnet and mainnet have different keys, and the mainnet key does not verify a testnet signature. So the testnet wasm cannot be deployed to mainnet as-is. A mainnet deploy needs those four constants changed to the mainnet values, a rebuild, a fresh audit, and a full live re-proof on testnet first. The code hash will change, and the new hash must be recorded in `docs/deployment.md` before anyone relies on it. Where the mainnet values come from: the mainnet VRF public key is published at `https://api.outlayer.ai/vrf/pubkey`, the mainnet host named in the contract comment, and the mainnet OutLayer project and guest version must be created and published on mainnet first, through the mainnet OutLayer project flow, before the constants are set.

The token changes too. The testnet token `usdc.fakes.testnet` does not exist on mainnet. The mainnet token contract must be chosen and its `ft_metadata` verified before any funding. Never fund a policy until the metadata (name, symbol, decimals) is read from chain and matches what the policy expects.

## Build the wasm

Same commands as testnet, Rust 1.93.0:

```sh
RUSTUP_TOOLCHAIN=1.93.0 cargo test --lib
RUSTUP_TOOLCHAIN=1.93.0 cargo clippy --all-targets -- -D warnings
RUSTUP_TOOLCHAIN=1.93.0 cargo near build non-reproducible-wasm
```

Record the wasm hash and compare it to the audited build before deploying:

```sh
sha256sum target/near/cynex_vault.wasm
```

The testnet wasm is 267,617 bytes with SHA-256 `4b756702791a7973c1a2684157ad628bfd2195fdfed182eeb27099f392b023b1`. A mainnet build will have a different hash, because the constants change, and that hash is the fingerprint to verify after deploy.

## Fund the vault account

Deploying a contract costs storage: NEAR charges 10^19 yocto per byte, which is 1 NEAR per 100 KB. The testnet wasm is 267,617 bytes, so its storage alone costs about 2.68 NEAR. Fund the vault account to cover the wasm storage plus a buffer for the state the vault keeps (policies, obligations, receipts). The exact buffer depends on how many obligations the vault will hold; start with the wasm cost plus a few NEAR and top up as the state grows. The account must exist on mainnet before deploy, created and funded through a wallet or `near account create-account`.

## Deploy

The contract has an `#[init] init(owner)` that sets the owner and empty state. It must run before any other method, because the contract uses `PanicOnDefault` and uninitialized state panics. Deploy with the init call, using near-cli-rs:

```sh
near contract deploy <VAULT_ACCOUNT> use-file target/near/cynex_vault.wasm with-init-call init json-args '{"owner":"<OWNER_ACCOUNT>"}' prepaid-gas '100 Tgas' attached-deposit '0 NEAR' network-config mainnet sign-with-keychain send
```

Testnet used the legacy near-cli 4.0.13 (`near deploy <account> <wasm> --networkId testnet --force`). Either tool works; the init call is the part that must not be skipped.

## Verify the deploy

Check the code hash on chain and compare it to the hash recorded for the audited build:

```sh
near contract inspect <VAULT_ACCOUNT> network-config mainnet now
```

If the code hash differs from the audited build, stop. The vault is not running the code that was reviewed.

## Set the vault up

These are owner steps, in order:

1. Add the verifier, if the deployment uses one: call `add_verifier` with the verifier account.
2. Register the vault and each recipient on the token with `storage_deposit`, then confirm with `storage_balance_of` returning non-null. A receiver that is not registered cannot receive the token. Registration storage is one time, not per settlement.
3. Create the policy with `create_policy`, giving the policy id, the token contract, and the limit.
4. Fund the policy with `ft_transfer_call` into the vault, with a msg that is JSON with a `fund_policy` field naming an existing policy whose token is the token contract. Attach exactly 1 yoctoNEAR to the `ft_transfer_call`, as NEP-141 requires. Funding only works through `ft_transfer_call` into `ft_on_transfer`; a plain `ft_transfer` arrives at the vault account without triggering it and is not credited to any policy. The full funding rule is in `docs/contract-api.md`.
5. Set up the agent's key as a scoped function-call key: receiver is the vault, method is `settle` only, finite allowance. The agent never holds a full-access key, and the owner key stays offline from the executor host.

Verify the token before funding it:

```sh
near contract call-function as-read-only <TOKEN_CONTRACT> ft_metadata empty-args network-config mainnet now
```

Read the name, symbol, and decimals from the result and confirm they are the token the policy was created for.

## Prove it before trusting it

Run the same live proof as testnet, with a small amount first: create an obligation, settle it, and read the receipt back from chain. The settle transaction print is not the proof; the PAID read and the balance delta are. Then run the attack scenarios and confirm each one is refused on chain with its reason code. Do not fund a policy for real use until the proof has run on mainnet and the receipts verify.

## Pre-deploy checklist

- The four testnet constants are changed to mainnet values, and the change is reviewed.
- A fresh audit has run on the mainnet build, and every finding is dispositioned.
- The wasm hash is recorded and matches the audited build.
- The token contract is chosen and its metadata is verified on chain.
- The owner key is held offline, and the agent key is scoped to settle only.
- The vault account is funded for the wasm storage plus a state buffer.
- No key, seed phrase, or credential is in the repo or in the deployment commands.

## What not to do

- Do not deploy the testnet wasm to mainnet. The VRF key and the OutLayer contract are wrong for mainnet, and layer 2 and 3 verification would fail.
- Do not fund a policy before the token metadata is verified on chain.
- Do not give the agent a full-access key, and do not put the owner key on the executor host.
- Do not skip the init call. Uninitialized state panics.
