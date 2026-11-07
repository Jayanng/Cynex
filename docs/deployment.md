# Cynex deployment and verification

Testnet throughout. This doc records where the vaults are deployed, what code
they run, and how anyone can verify that from chain.

## Vaults

| Vault | Account | Code hash |
| --- | --- | --- |
| Production | `cynex-vault.cynexmaster.testnet` | `EChCjrfRGBwMC6yu7QsrJqgkEuMZCJhmRZ5DNU64GJh9` |
| Test | `cynex-testvault.cynexmaster.testnet` | `EChCjrfRGBwMC6yu7QsrJqgkEuMZCJhmRZ5DNU64GJh9` |

Both vaults run the same code: the four TRUE findings from the NEAR AI DeepSeek abliterated audit (Master b0c7cb1, deployed to both vaults on 2026-11-07), on top of the judge audit fixes (Master 6b40576) and the expired READY cleanup (Master 0dafcdb). The code hash is the
on-chain fingerprint of that code. If the hash differs from the table above,
the vault is not running the code this repo describes.

## How to verify

Check the code hash, from any machine with near-cli:

```sh
near state cynex-vault.cynexmaster.testnet --networkId testnet
```

Look for `code_hash` in the output and compare it to the table above. The
same command works for the test vault.

Check a policy, for example the production demo policy:

```sh
near view cynex-vault.cynexmaster.testnet get_policy '{"policy_id":"p5-prod-001"}' --networkId testnet
```

Check the receipts and verify the hash chain with the CLI, from `frontend/`:

```sh
cynex verify-live cynex-vault.cynexmaster.testnet
```

Every receipt should report `verified_ok=true`. A gap or a mismatched hash
is detected and reported, not silently passed.

## Live state, last verified 2026-11-07

Production policy-001: funded 1,000,000,000, spent 975,001,000, reserved 0,
frozen false, 11 receipts. Production policy p5-prod-001: funded 1,000, spent
300, reserved 0, frozen false. Test policy p6-001: funded 10,000, spent
4,000, reserved 0, frozen false, 17 receipts. The token is
`usdc.fakes.testnet` (USDC.e, 6 decimals). The agent token balance is
1,300. The test policy spent and the agent balance moved on 2026-11-07
when the Phase 10 demo settled three obligations of 100 each on the test
vault; the pre-demo baseline was spent 3,400 and balance 700. The expired READY cleanup, deployed 2026-11-07, changed no balances: production p5-prod-001 still spent 300, test p6-001 still spent 3,700, receipts still 11 and 14, agent balance still 1,000. The two dead production obligations p9-prod-preimage-001 and p9-prod-tee-001 are now CANCELLED. The DeepSeek audit fixes deploy, 2026-11-07, changed no production balances: production p5-prod-001 still spent 300, receipts still 11, both dead obligations still CANCELLED. On the test vault it settled one TEE obligation of 100 (audit-fixes-tee-001), so test p6-001 spent 3,900 to 4,000, receipts 16 to 17, agent balance 1,200 to 1,300.

## Deployment history

The production vault was first deployed in Phase 1. The code hash changed
with each phase that touched the contract: G3Mt2gKs94C61Se4oLWvMUgR2Bfv2djdFQLz4TVrDH3E
(Phase 6), 7PBw1x6HbH3Eu2dWrTKjEEfxdJnAfFPwPJS5vZMM5zRC (Phase 9), then E2Uq5FzNcfGuDHQfqTGx6Rqd41ZwsBDXtYVx6bhQoFd1 (the judge audit fixes), then 7JJ27aMWztX2F3z4W9zxSmK93eMa7RuTGvmAwWab9x4B (the expired READY cleanup), then EChCjrfRGBwMC6yu7QsrJqgkEuMZCJhmRZ5DNU64GJh9 (the NEAR AI DeepSeek audit fixes, current). Each deployment was proven live on both
vaults before the phase closed, and the ledger in `docs/ledger.md` records the
tx hash for each one.

## The TEE guest

The OutLayer guest that provides layer 2 provenance is a separate deployment,
not part of the vault code. Project `cynexmaster.testnet/cynex-verifier`,
active version 8abfe08b, pinned in the contract as version key
8abfe08bc62919dd3f0aea2c2ea5dbe91d5484c14d6a55289053dce1d0387a6f. The VRF
public key is the testnet key
c0c5aeae1688c2f7cc2350aae1ee3ce96eddc0de84d678db873de48268f8cfa8. The vault
verifies the VRF signature on-chain; the TDX quote is verified off-chain
through OutLayer's attestation endpoint.
