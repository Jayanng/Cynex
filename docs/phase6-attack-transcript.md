# Phase 6 attack transcript

One row per attack: the transaction hash, the reason code from the
chain, and the recipient balance before and after, read live with
`ft_balance_of`. Every attack must move zero tokens. A row that
shows tokens moved is a loud failure: stop the run and file it.

## Lane A baseline, test vault, verified live by Lane B 2026-11-05

These six transactions are Lane A's Phase 6 proofs on the test
vault (`cynex-testvault.cynexmaster.testnet`, code hash
`G3Mt2gKs94C61Se4oLWvMUgR2Bfv2djdFQLz4TVrDH3E`). Lane B queried
each transaction hash and read each obligation live afterwards;
the codes, the proposed parameters, and the states below are
what the chain returns, not what the instructions claimed.

Every one of the six failed on chain, so none of them moved
tokens: a failed settle runs no `ft_transfer`. The before and
after balances for a failed transaction are therefore the same
value; the exact balance at each transaction's block is not on
record from Lane B's side, so this table records "unchanged"
rather than inventing a number. The recipient balance read live
by Lane B on 2026-11-05 is 977004100. The only successful settle
in this window is `p6-obl-003` (PAID on the test vault), which
accounts for the whole move from the Phase 5 close figure of
977003100: plus 1000, exactly the obligation amount.

| scenario | obligation | proposed recipient | proposed amount | tx hash | reason code | state after | balance before | balance after | moved |
|---|---|---|---|---|---|---|---|---|---|
| recipient substitution | p6-obl-001 | unregistered-xyz.testnet | 1000 | hsas9c1Esn1n5S8Gqo3zCTJyvTsioQcpPcQVrAsER3z | ERR_RECIPIENT_SUBSTITUTION | READY | unchanged (failed tx) | unchanged (failed tx) | 0 |
| terms mismatch | p6-obl-002 | acme-supplies.testnet | 1001 | 8ZMpTaxUHpaAJrq3Jzh3nMcF1dhZQp2pJozcKmtdWzxF | ERR_TERMS_MISMATCH | READY | unchanged (failed tx) | unchanged (failed tx) | 0 |
| nonce replay | p6-obl-003 | acme-supplies.testnet | 1000 | BWatKA4aDDG1doJJzkqUqY2kovsWMvDWZiDgAvz2nLc | ERR_NONCE_ALREADY_CONSUMED | PAID | unchanged (failed tx) | unchanged (failed tx) | 0 |
| budget exceeded | p6-obl-004 | acme-supplies.testnet | 9001 | 92em5J5bu4yVwYCiYxZCMAqWNz6bd8gYTUkHtHXRZSPr | ERR_BUDGET_EXCEEDED | READY | unchanged (failed tx) | unchanged (failed tx) | 0 |
| expired | p6-obl-005 | acme-supplies.testnet | 1000 | 3dMytgtCvAaF12d9q77PL9gbvFesWxe7TuHcBsDZ7B8x | ERR_OBLIGATION_EXPIRED | READY | unchanged (failed tx) | unchanged (failed tx) | 0 |
| frozen | p6-obl-006 | acme-supplies.testnet | 1000 | 45NLRuCvdNUUY4YTWmTnYx7ArcFc3gTWeYNi6YKMRjNq | ERR_POLICY_FROZEN | READY | unchanged (failed tx) | unchanged (failed tx) | 0 |

Notes on the baseline:

- The nonce row is the Phase 6 code change in action: a duplicate
  settle against the PAID `p6-obl-003` reports
  `ERR_NONCE_ALREADY_CONSUMED`, where the Phase 5 build would
  have reported `ERR_INVALID_STATE`.
- The budget row proposes the recorded amount (9001), not a
  larger one: the terms check runs before the budget check, so
  a larger proposal would have failed with `ERR_TERMS_MISMATCH`
  instead. The obligation was created at 9001 against a 9000
  headroom (policy `p6-001`, limit 10000, spent 1000).
- The frozen row ran while policy `p6-001` was frozen; the
  policy is not frozen now, so a frozen replay needs the owner
  to freeze it again during the demo.

## Runner live run

No runner live run yet. The runner needs the agent key, which
is held by Lane A; there are no key files on the Lane B
machine, so the end-to-end run is the section 2.6 audit step.
Run it on the test vault first, then production for the
rejections only:

```
# from the repo root, with CYNEX_AGENT and CYNEX_AGENT_KEY_FILE set
# (bare private key file, outside the repo), after compiling the CLI:
node <outDir>/cli/cynex.js attack cynex-testvault.cynexmaster.testnet demo/attack-scenarios.json
node <outDir>/cli/cynex.js attack cynex-vault.cynexmaster.testnet demo/attack-scenarios.json
```

Each run appends a dated section below with one row per attack.
The production run must not settle a happy path: its nonce
obligation (`obl-verify-demo`) is already PAID, so it replays
directly, and the runner refuses a production happy-path settle
without `--allow-production-settle`.
