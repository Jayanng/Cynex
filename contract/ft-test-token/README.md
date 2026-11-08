# ft-test-token

Minimal fungible token for the Cynex near-sandbox suite only. It exists
so the sandbox suite can fund a policy and settle obligations against a
real token on a real local chain. It is test tooling, not a product.

What it implements, and nothing more:

- NEP-141: `ft_total_supply`, `ft_balance_of`, `ft_transfer`,
  `ft_transfer_call` with the `ft_resolve_transfer` callback.
- A transfer to self is a no-op: it moves nothing and mints nothing.
- `storage_balance_of` reports what the account actually deposited; the owner, credited at init without a deposit, reports 0.
- NEP-145: `storage_deposit`, `storage_balance_of`,
  `storage_balance_bounds`. Registration costs 0.0025 NEAR, two map entries at the conventional 0.00125 NEAR each.

What it deliberately omits: metadata, minting after init, burning,
`storage_unregister`. The total supply is fixed at init and credited
to the owner.

Build it with cargo-near, from this directory:

```sh
RUSTUP_TOOLCHAIN=1.93.0 cargo near build non-reproducible-wasm
```

The wasm lands at `target/near/ft_test_token.wasm`. The sandbox
harness builds it on demand when the wasm is missing. Never deploy
this contract to testnet or mainnet, and never point a real vault at
it.
