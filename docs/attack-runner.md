# Attack runner, playground, executor

This is "Attack demo and playground", joint work. contract landed on Master as `cc29f2e`: a duplicate settle
now reports `NONCE_ALREADY_CONSUMED` instead of
`ERR_INVALID_STATE` (settle checks the nonce before the state
check; in-flight and PAID both reject with
`NONCE_ALREADY_CONSUMED`, any other non-READY state with
`ERR_INVALID_STATE`). The vault is the authority: it reads the
terms from state and rejects any proposed difference on chain,
so the rejections below are on-chain events, not UI filtering.
Production vault `cynex-vault.cynexmaster.testnet` and test
vault `cynex-testvault.cynexmaster.testnet` both run code hash
`G3Mt2gKs94C61Se4oLWvMUgR2Bfv2djdFQLz4TVrDH3E`, deployed by tx
`FZUftKtvQytjHEDxpBi8WrKU42VKtnoATs6kSqQATDBh`.

## Deliverable 1: attack runner

`services/attacks/attacks.ts` is the pure core (no network, no
signing): the four scenarios, the reason-code parser, the
settle-parameter validators, the attack-parameter derivation
from a live obligation and policy, and the transcript
formatting. `cli/cynex.ts` adds two commands on top of it.

`cynex attack-one <vaultId> <obligationId> <proposedRecipient> <proposedAmount> <evidenceRef> [--dry-run]`
fires one real settle with the agent key (env `CYNEX_AGENT`
and `CYNEX_AGENT_KEY_FILE`, a bare private key file outside
the repo), at 100 TGas prepaid, with the proposed amount as a
JSON string (a U128 number would fail deserialization before
any contract check, which cost contract one transaction). It
prints the transaction hash, the reason code from the chain,
the obligation state read live after the call, and the
recipient balance before and after, then a `RESULT` JSON line
for the executor to parse. Exit 0 when the call executed
(success or a rejection with a transaction hash), 1 when it
could not execute, 2 on usage, validation, or dry-run.

`cynex attack <vaultId> <scenariosFile> [--only <scenario>] [--dry-run] [--allow-production-settle] [--transcript <file>]`
runs the four scenarios as real transactions, in order:
recipient substitution, terms mismatch, nonce replay, budget
exceeded. The scenario-to-obligation mapping lives in
`demo/attack-scenarios.json`. Each scenario reads its
obligation and policy live, derives the attack parameters
from the recorded terms, fires the settle, and checks the
reason code and that zero tokens moved. An attack that moves
tokens stops the run immediately (a loud failure, file it).
The nonce scenario settles its obligation correctly first in
the same run, then replays it; an already-PAID obligation
replays directly. A happy-path settle on the production vault
needs `--allow-production-settle`, otherwise the run refuses.
`--dry-run` prints the exact calls without sending anything
and exits 2, the console convention. The run appends a dated
section to the transcript file (default
`docs/attack-transcript.md`).

The transcript is `docs/attack-transcript.md`. At
write time it holds six verified proof transactions
on the test vault, each queried by the frontend with the obligation
read live afterwards. The runner's own live run appends
below; it has not run yet, because the runner needs the agent
key held by the contract side (see Honest gaps).

Why the budget scenario proposes the recorded amount: the
settle check order is nonce, state, recipient, terms, expiry,
frozen, policy version, token lock, then budget. A proposal
larger than the recorded amount fails the terms check first,
so a budget proof needs an obligation whose recorded amount
already exceeds the headroom: `p6-obl-004` at 9001 against a
9000 headroom on the test vault, `p6-prod-003` at 1001 against
a 1000 headroom on production.

## Deliverable 2: playground

The "break it yourself" playground is a static page,
`frontend/playground.html`, with a browser client,
`frontend/src/playground-client.ts`, served by the executor
(see below). A judge picks a vault and one of the
owner-created demo obligations in
`demo/playground-obligations.json`, types any payee and any
amount, and fires a real settle. The page holds no key and
makes no chain calls itself: reads go through the executor
(`GET /read`, a live RPC view call) and settles go through
the executor (`POST /settle`). Every result shows the live
transaction hash and the live chain read after the call; a
line without either is treated as canned output and fails
acceptance, so the client renders exactly what the executor
returns.

Demo obligations (owner-created only, a judge cannot create
obligations):

- Production, policy `p5-prod-001`, limit 1000, funded 1000,
 spent 0: `p6-prod-001` (recipient substitution),
 `p6-prod-002` (terms mismatch, propose 1001),
 `p6-prod-003` (budget exceeded, recorded 1001),
 `p6-prod-004` (expired-only: READY on chain, 90-second expiry
 now passed, proposing the recorded terms fails
 `ERR_OBLIGATION_EXPIRED`, not a generic spare),
 `p6-prod-005` (spare), `obl-verify-demo`
 (PAID, nonce replay). No happy-path settle runs on
 production.
- Test vault, policy `p6-001`, limit 10000, funded 10000,
 spent 3000: `p6-obl-001` (recipient substitution),
 `p6-obl-002` (terms mismatch), `p6-obl-003` (PAID, nonce
 replay), `p6-obl-004` (budget exceeded, recorded 9001),
 `p6-obl-005` (expired, propose the recorded terms),
 `p6-obl-006` (happy path, then nonce replay; consumed by
 the first correct settle). The audit settled `p6-audit-001`
 (fresh, created for the playground happy path, nonce 7) the
 same way, so `p6-001` spent is now 3000 and both are PAID.

How a judge runs the cases: pick the test vault, read the
live state (no transaction), then fire a settle. A wrong
payee shows BLOCKED with `ERR_RECIPIENT_SUBSTITUTION` and a
transaction hash; the exact recorded terms on a READY
obligation show SETTLED with a transaction hash and the
balance increase; firing again on the now-PAID obligation
shows BLOCKED with `ERR_NONCE_ALREADY_CONSUMED`. The expired
case is `p6-obl-005` with the recorded terms. The frozen case
needs the owner to freeze policy `p6-001` during the demo,
then unfreeze it; the policy is not frozen now.

The read-only `cynex playground <vaultId> <obligationId...>`
command is unchanged and still works for the
state display.

## Deliverable 3: executor security

`services/executor/executor.ts`. Run it
from the repo root, after compiling to a temp outDir with
node_modules symlinked into it (same as the typecheck
command): `node <outDir>/services/executor/executor.js`.
It listens on `CYNEX_EXECUTOR_HOST` (default 127.0.0.1) and
`CYNEX_EXECUTOR_PORT` (default 8787), localhost only by
default.

- Authentication: `POST /auth` with `{"token": ...}` where the
 token is the operator token from `CYNEX_EXECUTOR_TOKEN`.
 A correct token issues an HttpOnly, SameSite=Strict session
 cookie (random 32-byte id, 1 hour). `POST /settle`
 requires the cookie; anything else gets 401. The server
 refuses to start without `CYNEX_EXECUTOR_TOKEN` set, so it
 can never run open by accident. The token is compared in
 constant time and never logged.
- Input validation: every parameter is validated server side
 before anything is executed, using the shared validators in
 `services/attacks/attacks.ts`. Payee must be a valid account
 id, amount must be a positive u128 as a decimal string, no
 shell metacharacters anywhere in any parameter (including
 the obligation id and evidence ref). Invalid input is
 rejected with 400 before any execution. The browser is never
 trusted.
- Rate limit: 5 settle calls per session per rolling 60
 seconds, then 429 with a Retry-After header. The limit is
 checked before validation, so validation probing is also
 rate-limited.
- Allow-list: the one spawn site in the file runs
 `node <cliPath> attack-one <vaultId> <obligationId>
 <proposedRecipient> <proposedAmount> <evidenceRef>` with an
 argv array and no shell. There is no other spawn site, and
 no parameter can change the command, only the validated
 arguments. Anything that is not exactly that command is
 refused before execution.
- Keys: the agent's scoped function-call key stays on the
 executor host, in the bare private key file named by
 `CYNEX_AGENT_KEY_FILE`, which the CLI reads itself. The
 executor never reads the key file, never logs it, and never
 sends it anywhere. The owner key is never on the executor
 host; owner actions in the UI go through a wallet adapter,
 not through `/settle`. The CLI path defaults to the compiled
 CLI next to the executor (`<outDir>/cli/cynex.js`) and can
 be overridden with `CYNEX_CLI_PATH`; the repo root for the
 served page and demo JSON defaults to the working directory
 (`CYNEX_REPO_ROOT`).
- Reads: `GET /read?vaultId&obligationId` is a public live
 view call (obligation, policy, recipient balance). It needs
 no key and no session.

## Honest gaps

- The runner's live end-to-end run happened in the acceptance
 audit on 2026-11-05 (head 4416385): test vault,
 all four scenarios plus the happy path, and production,
 rejections only. Every transaction was re-queried from
 chain by frontend and is recorded in the transcript file.
 No live attack transaction was sent from the frontend; the run
 was the acceptance step, with the agent key held by the owner.
- The playground happy path was proven live in the audit
 through the executor on a fresh owner-created obligation
 `p6-audit-001` (nonce 7, settled, then replay blocked).
 Both settleable test-vault obligations are now PAID
 (`p6-obl-006` and `p6-audit-001`), so the next playground
 happy-path demo again needs one fresh owner-created READY
 obligation on policy `p6-001` (amount 1000,
 acme-supplies.testnet).
- The frozen playground case needs the owner to freeze
 policy `p6-001` during the demo; the policy is not frozen
 now, so it cannot be demonstrated until then.
- The contract-api corrections draft arrived
 2026-11-05 and was confirmed line by line
 by frontend against Master `lib.rs` and the live proofs (see
 the close confirmation below). The contract claims in this doc
 (nonce check before the state check, in-flight and PAID both
 reporting `NONCE_ALREADY_CONSUMED`) were verified directly
 against Master `lib.rs` and the live proof transactions, not
 taken from the instructions alone.

## Checks

- Scaffold typecheck clean (repo-root compile, temp outDir, node_modules symlinked).
- Frontend typecheck clean.
- Conformance 6/6.
- Jest (new suites: attacks, executor, playground client).
- Regressions: playground, budget, verify-live unchanged;
 verify-live shows 8 receipts, all true, before any new
 happy-path settle.
- Attack runner `--dry-run` on both vaults: exact calls
 printed, no transaction sent.
- Executor smoke test: unauthenticated settle 401, bad token
 401, invalid input 400 with no execution, rate limit 429
 on the sixth call in 60 seconds.
- No contract changes, no frozen doc changes. frontend signed
 2026-11-05 after the acceptance audit PASS (see the close
 confirmation below).

## close confirmation (frontend)

The contract-api corrections draft (supplied 2026-11-05, not committed) was verified line by line by
frontend against Master lib.rs (cc29f2e) and live RPC reads and
is confirmed: the nonce check now runs before the state check,
the later in_flight require was removed as unreachable, no
other check changed order or code, RECONCILIATION_REQUIRED
keeps in_flight true, and the nonce is still not permanently
consumed on dispatch. The draft is NOT yet applied to
docs/contract-api.md; application happens at close on
Master, after frontend confirmation. frontend signed in docs/ledger.md on 2026-11-05. contract
signature, draft application, and merge remain outstanding, so
this work is not closed by this signature. The acceptance audit
PASS (28 checks, one finding, fixed as 14b16fb) is recorded in
the audit file supplied 2026-11-05 and in the ledger row; the frontend independently re-queried all 17 audit transactions from
chain with 0 mismatches.
