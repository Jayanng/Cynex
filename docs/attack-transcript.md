# Attack transcript

One row per attack: the transaction hash, the reason code from the
chain, and the recipient balance before and after, read live with
`ft_balance_of`. Every attack must move zero tokens. A row that
shows tokens moved is a loud failure: stop the run and file it.

## contract baseline, test vault, verified live by frontend 2026-11-05

These six transactions are contract proofs on the test
vault (`cynex-testvault.cynexmaster.testnet`, code hash
`G3Mt2gKs94C61Se4oLWvMUgR2Bfv2djdFQLz4TVrDH3E`). frontend queried
each transaction hash and read each obligation live afterwards;
the codes, the proposed parameters, and the states below are
what the chain returns, not what the instructions claimed.

Every one of the six failed on chain, so none of them moved
tokens: a failed settle runs no `ft_transfer`. The before and
after balances for a failed transaction are therefore the same
value; the exact balance at each transaction's block is not on
record from frontend side, so this table records "unchanged"
rather than inventing a number. The recipient balance read live
by frontend on 2026-11-05 is 977004100. The only successful settle
in this window is `p6-obl-003` (PAID on the test vault), which
accounts for the whole move from the close figure of
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

- The nonce row is the code change in action: a duplicate
 settle against the PAID `p6-obl-003` reports
 `ERR_NONCE_ALREADY_CONSUMED`, where the build would
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

The first runner live run is the section 2.6 audit, recorded below. The runner needs the agent key, which
is held by contract; there are no key files on the frontend
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

## Runner live run, section 2.6 audit, 2026-11-05

The runner's live run happened in the section 2.6 audit (PR #7,
head 4416385), run by contract with the agent key from the compiled
PR code. frontend re-queried every transaction below from the chain
and read the final state live. Balances are
acme-supplies.testnet `ft_balance_of`, read before and after each
call by the runner.

Test vault (`cynex-testvault.cynexmaster.testnet`), policy
`p6-001`: before, spent 1000, reserved 0, funded 10000, headroom
9000; acme 977004100.

| scenario | obligation | proposed recipient | proposed amount | tx hash | reason code | state after | balance before | balance after | moved |
|---|---|---|---|---|---|---|---|---|---|
| recipient substitution | p6-obl-001 | unregistered-xyz.testnet | 1000 | 9K7iyNAhZtxtkyffV4YTk731y6kdacGau8MGL6UL3KDR | ERR_RECIPIENT_SUBSTITUTION | READY | 977004100 | 977004100 | 0 |
| terms mismatch | p6-obl-002 | acme-supplies.testnet | 1001 | GBM6FNb2q6iNtBmFXioupJbL3ZfuygySfPsr78X75AC2 | ERR_TERMS_MISMATCH | READY | 977004100 | 977004100 | 0 |
| nonce happy path | p6-obl-006 | acme-supplies.testnet | 1000 | 5Spykc2QWqbJcywxui1NnBUibrE9vsosyv5bexBFYgE1 | SETTLED | PAID | 977004100 | 977005100 | 1000 |
| nonce replay | p6-obl-006 | acme-supplies.testnet | 1000 | CNm7sQ9K1kbkbE8HQe4bveyW1WZjNc8GhFJzNd8aVCJE | ERR_NONCE_ALREADY_CONSUMED | PAID | 977005100 | 977005100 | 0 |
| budget exceeded | p6-obl-004 | acme-supplies.testnet | 9001 | 9YQSJH6dbvnuTVinLxGW77CtFqoRmxLCiKkoLs18cEvE | ERR_BUDGET_EXCEEDED | READY | 977005100 | 977005100 | 0 |

After: policy `p6-001` spent 2000, reserved 0, funded 10000,
headroom 8000, invariant ok; `p6-obl-006` PAID.

Production (`cynex-vault.cynexmaster.testnet`), rejections only,
no `--allow-production-settle`: before, policy-001 spent
975001000, `p5-prod-001` spent 0, acme 977005100.

| scenario | obligation | proposed recipient | proposed amount | tx hash | reason code | state after | balance before | balance after | moved |
|---|---|---|---|---|---|---|---|---|---|
| recipient substitution | p6-prod-001 | unregistered-xyz.testnet | 1000 | Ax4Ay47y7akf7YvS7ipfhpwJHWgN1JLUt3VvzjCBUjUJ | ERR_RECIPIENT_SUBSTITUTION | READY | 977005100 | 977005100 | 0 |
| terms mismatch | p6-prod-002 | acme-supplies.testnet | 1001 | A951vTsZvrNz1UpsPYyGjewD537Fo1NsGzM65G4bMXiQ | ERR_TERMS_MISMATCH | READY | 977005100 | 977005100 | 0 |
| nonce replay | obl-verify-demo | acme-supplies.testnet | 1000 | 94Qpj2AwoQCqWAk6dPJXe87BVXrFjLL8z6Vu1jWTzgCT | ERR_NONCE_ALREADY_CONSUMED | PAID | 977005100 | 977005100 | 0 |
| budget exceeded | p6-prod-003 | acme-supplies.testnet | 1001 | 3mFru84wQ3MpH8xCrGZi7iHgBsQYW6BfuELKUAShWXyh | ERR_BUDGET_EXCEEDED | READY | 977005100 | 977005100 | 0 |

After: policy-001 spent 975001000, `p5-prod-001` spent 0,
verify-live 8 receipts, all true; acme 977005100, unchanged by
the production run. No tokens moved on production.

Executor live, same audit: a valid wrong-recipient settle via
POST `/settle` on `p6-obl-001`, tx
7Amj8cteMVq4oait1rNKhZgDuXNCGayzgsVnRxE91LtD,
`ERR_RECIPIENT_SUBSTITUTION`, READY, 977005100 to 977005100,
moved 0. Playground blocked case via the executor on
`p6-audit-001` (wrong payee), tx
85WaijMc3MHBDFFrYRFsGD2EoEP1SEqgRbs9BJF3hxUb,
`ERR_RECIPIENT_SUBSTITUTION`, READY, moved 0. Playground settled
case via the executor on `p6-audit-001` (exact terms), tx
Ff6Djco5kZBhyXjrbpDWQfYDiRcAzSt5XU9wKSETKXb6, SETTLED, PAID,
977005100 to 977006100, moved 1000 exactly; replay tx
CDPLEdLtM6z1r1xGPtf5L1mBoKGCMP9kVHnzeeMA7kdC,
`ERR_NONCE_ALREADY_CONSUMED`, stayed PAID, moved 0.
`p6-audit-001` was created for the playground happy path
(create pHDeFpbNzqy2DJWruF9YW1tXknMy3vxt4Yu4ALRkyGw, request
F19Eeq8htyztLCxhpvpytHGAzUdvrBGGBdacdj3qarq, submit ALLOWED
AA2t2h7XJfSU7w9pcFGcis9Q99Ax7q9ra9MNzi9LGg59, nonce 7, amount
1000, acme-supplies.testnet).

Final live state after the audit (read by frontend): acme
977006100, up 2000 from 977004100, 1000 from the runner happy
path on `p6-obl-006` and 1000 from the playground happy path on
`p6-audit-001`. Policy `p6-001` spent 3000. Production receipts
8, all true.
