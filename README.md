# Cynex

AI agents now hold wallets and spend money, but a compromised prompt has already drained an agent wallet, because no universal on-chain check ensures a payment matches exactly what the human authorized.

Cynex is a purpose-bound settlement vault for AI agents on NEAR.
Pay the obligation. Not the prompt.

A human authorizes an obligation with a fixed recipient, token, amount,
evidence requirement, and budget. The agent may request settlement, but
the vault itself rejects any payment that changes those terms, exceeds
the budget, or repeats an obligation. The agent is assumed compromised:
it holds a key that can only call settle, and the vault, not the agent,
decides whether the money moves.

## For judges: the whole project in one minute

Cynex is a purpose-bound settlement vault for AI agents on NEAR. A
human authorizes an obligation with a fixed recipient, token, amount,
evidence requirement, and budget, and the vault itself enforces those
terms on chain. The agent is assumed compromised and holds only a
scoped settle key.

Three layers prove a payment is right, and no layer trusts another:

- Layer 1, on-chain integrity: for evidence up to 64 KiB, the
  vault hashes the evidence bytes itself with SHA-256 and compares
  them to the digest committed at authorization.
- Layer 2, TEE provenance: a guest program fetches the evidence
  inside an Intel TDX enclave and hashes it there, and the
  per-execution TDX quote binds what ran, what went in, and what came
  out.
- Layer 3, VRF anchor: the guest requests VRF randomness during
  execution and the vault verifies the signature on chain, bound to
  the pending request.

Live proof, verified on testnet 2026-11-08: both vaults run code hash
65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6. The test vault policy
p6-001 has spent 5300 of a 10000 limit, and the test vault has 30
receipts. The production vault policy p5-prod-001 has spent 500 of
a 1000 limit, and the production vault has 13 receipts. Four TEE
executions carry independently verified TDX attestations, three on
the test vault and one on the production vault.

Verify it yourself, no key and no account needed. Install the
verifier once with the cargo install line in Verifying the TEE
attestation below, then run:

```sh
scripts/verify-tee-attestation.sh --bundle docs/attestation-proofs/attestation-proof-10640.json
```

It prints PASS when the attestation verifies. The full do X, see Y
steps are in Reproduce it below.

## Trust, in one paragraph

Integrity is on-chain and trustless: for small evidence the vault hashes
the artifact bytes itself and compares them to the digest committed at
authorization, so a lying courier is caught by the contract. Provenance
comes from a TEE: an OutLayer guest fetches the evidence from its claimed
source inside an attested enclave and hashes it there. The per-execution
TDX quote binds what ran, what went in, and what came out, and anyone
can verify it through OutLayer's attestation endpoint; the vault itself
does not verify the quote on-chain, it checks the guest-reported digest
and source plus the VRF signature. A VRF signature anchors each
execution to its request on-chain. Semantics are bound at authorization:
the digest, the recipient, the amount, and the budget are fixed by the
human before the agent ever acts. What no layer proves is that the bytes
mean what their source claims; that stays the human's judgment at
authorization time.

## Status

Testnet throughout. The vault is deployed at
`cynex-vault.cynexmaster.testnet`. Phases 0 through 9 are closed. The repo
goes public on 13 November 2026.

Live state, last verified 2026-11-08: both vaults run code hash
65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6. Test vault policy
p6-001: funded 10000, spent 5300, reserved 0, frozen false. The test
vault has 30 receipts. Production vault policy p5-prod-001: funded
1000, spent 500, reserved 0, frozen false. The production vault has
13 receipts. Production policy-001:
funded 1,000,000,000, spent 975,001,000, reserved 0, frozen false.
The agent's token balance is 2600, and the second agent
(`cynex-agent2.cynexmaster.testnet`) holds 100, paid from the test
vault by the use-case settlement `usecase-report-003`. The token is `usdc.fakes.testnet`
(USDC.e, 6 decimals). The full ledger is in `docs/ledger.md`.

## How a settlement works

1. The owner creates an obligation: recipient, token, amount, evidence
   type, evidence hash, expiry, and a nonce. The obligation starts in
   state CREATED.
2. The owner requests evidence. The obligation moves to EVIDENCE_PENDING
   with a pending request id and a settlement digest bound to the exact
   terms.
3. Evidence is verified. See the three layers below. A pass moves the
   obligation to READY. A block moves it to BLOCKED, which the owner can cancel. A warn moves it to
   WARN_PENDING and needs the owner's explicit approval, or the owner can cancel it.
4. The agent settles with its scoped key. The vault checks the recipient,
   the amount, the nonce, and the budget, then pays through the token
   contract and writes a receipt chained to the previous receipt hash.

The frozen API, the digest format, the timeouts, and the reason codes are
in `docs/contract-api.md`. The threat model is in `docs/threat-model.md`.

## The agent's key, and its limits

The agent holds a function-call access key, nothing more. It is scoped to
one contract, `cynex-vault.cynexmaster.testnet`, and one method, `settle`.
It cannot transfer NEAR. It cannot add keys. It cannot call any owner
method, create a policy, fund a policy, or change an obligation. It cannot
move funds except by asking the vault to settle an obligation that is
already READY, and the vault re-checks every term before it pays.

That scope is enforced twice: by the key itself on-chain, and by the
agent wrapper in `agent/wrapper.ts`, which refuses to build any call
other than settle before it ever reaches a signer. The limits were proven
live in Phase 1: the scoped key could not call `create_policy`, could not
make a plain token transfer, and a NEAR send with it was rejected as
requiring full access.

One caveat from the NEAR access key docs: an account that holds only
function-call keys cannot transfer NEAR or add keys, and it can lock
itself out if the gas allowance runs out. Keep the agent's allowance
topped up, and keep a full-access key for the agent account somewhere
safe, outside this repo, so the scope can be repaired.

## On-chain enforcement

The contract enforces the terms, not the agent and not the console. Every
check below runs in the vault itself, so a compromised agent, a spoofed UI,
or a lying courier cannot change the outcome.

- Recipient: settle reads the recipient from the obligation in state and
  compares it to the proposed recipient. A mismatch rejects with
  RECIPIENT_SUBSTITUTION. The check lives in the contract, not in the
  console.
- Amount: settle reads the amount from the obligation in state and
  compares it to the proposed amount. A mismatch rejects with
  TERMS_MISMATCH.
- Replay: a one-time nonce is consumed and locked on the first settle
  attempt. A duplicate attempt rejects with NONCE_ALREADY_CONSUMED, even
  while the first attempt is still in flight.
- Budget: settle checks spent plus reserved plus amount against the policy
  limit and the funded amount, using checked arithmetic, and reserves
  synchronously before any promise is returned, so two concurrent settle
  calls cannot both pass and both pay. A breach rejects with
  BUDGET_EXCEEDED.
- Evidence: the obligation moves to READY only when the evidence matches
  the digest committed at authorization. For layer 1 the vault hashes the
  bytes itself. For layers 2 and 3 the vault checks the guest-reported
  digest and source plus the VRF signature. The TDX quote itself is verified
  off chain through OutLayer's attestation endpoint, not on chain; what the
  vault checks on chain is the digest, the source, and the VRF signature.
  A mismatch changes no state.
- Expiry: settle after expires_at_ns rejects with OBLIGATION_EXPIRED.
  Expiry alone does not auto-cancel, because auto-cancel would hide a
  missed settlement.
- Timeout: a transfer that does not complete within the transfer timeout
  escalates to reconciliation, and evidence that never arrives never moves
  an obligation to READY by default.

The frozen API, the digest format, the timeouts, and the reason codes are
in `docs/contract-api.md`.

## Security model

The agent is assumed compromised. Its prompt, its inputs, and any data it
carries may be attacker controlled. The attacker can submit any settle call
the scoped key allows, with any arguments. The attacker cannot sign as the
owner, cannot add keys, and cannot call other contracts with the agent key.
The owner key is human held and never on the executor host.

What the vault assumes: the owner authorizes obligations with care, because
the vault enforces the terms the human set, it does not judge whether those
terms are wise. The verifier set is owner managed, and evidence from anyone
outside it is rejected. The token ledger in the vault is authoritative; the
token balance on the account is not, on its own, the ledger.

What function-call keys do NOT prevent: the key scopes which method can be
called, it does not limit token spending, the vault does that. The key does
not prevent the agent from calling settle on a READY obligation, that is by
design, and the vault re-checks every term before it pays. The key does not
prevent a compromised agent from trying bad terms, the vault rejects them
on-chain. The key does not prevent the owner from authorizing a bad
obligation, that judgment belongs to the human at authorization time. The
key does not prove a real-world delivery happened, and neither does a TEE
attestation, which proves a verifier ran untampered over given inputs, not
that a counterparty is honest.

Reputation signals are detection, not prevention. They inform the owner
before settlement, they do not replace the on-chain checks. The full threat
model is in `docs/threat-model.md`.

## The three layers of evidence verification

No single layer trusts another.

**Layer 1, on-chain integrity.** For evidence up to 64 KiB, anyone may
submit the artifact bytes with `submit_evidence_preimage`. The vault
computes SHA-256 itself with `env::sha256` and compares it to the digest
committed at authorization. A match makes the obligation READY. A
mismatch changes no state. The caller is a courier, not a judge. The
bytes are hashed and dropped, never stored. This layer ships regardless
of the other two.

**Layer 2, TEE provenance.** An OutLayer guest runs inside an Intel TDX
enclave, fetches the evidence from its claimed source, computes SHA-256,
and returns the digest plus the source. The per-execution TDX quote
binds the guest code hash, the input hash, and the output hash, and
anyone can verify it through the live attestation host,
`https://testnet-api.outlayer.ai`, with the commands in Verifying the
TEE attestation below; the vault itself does not verify the quote
on-chain, by design. This
answers the question layer 1 cannot: a digest proves which bytes were
checked, not where they came from.

**Layer 3, VRF anchor.** During execution the guest requests VRF
randomness. The OutLayer keystore signs
`vrf:{request_id}:{sender_id}:{user_seed}` with an Ed25519 key whose
public key is published, and the vault verifies the signature on-chain
with `env::ed25519_verify`, bound to the pending request.

Oversized evidence keeps the labeled fallback, TRUSTED_RELAYER: the owner
as the verifier, named as trusted, never presented as trustless. Layers 2
and 3 shipped in Phase 9 and were proven live on testnet: a TEE obligation
went READY through the full guest fetch and VRF path on OutLayer request
10640, with a real TDX quote binding the input and output hashes. The
fallback stays for oversized evidence, not as a substitute for the
TEE layer, which is live and independently attested.

## Verifying the TEE attestation

The TDX quote is real, and you do not have to take our word for it. Every
TEE execution behind the live proofs has a published attestation you can
fetch and verify yourself, with no account, no key, and no trust in us.

What the vault checks on chain, and what it does not: the vault verifies
the evidence digest with SHA-256, the exact-match terms (recipient,
amount, token), the budget, the one-time nonce, and the VRF signature.
The VRF signature proves the output was not re-rolled and binds the
signature to the pending request. It does not prove a TEE executed the
guest, and we do not claim it does. The TDX quote is what proves the
guest ran inside a genuine enclave, and the vault does not verify the
quote on chain, because on-chain TDX verification is infeasible on NEAR:
a 5 KB quote plus a certificate chain plus Intel collateral is
gas-prohibitive, and NEAR has no native support for it. So the quote is
verified off chain, with a standalone verifier, and the proof is shipped
in this repo.

The four executions, all on testnet. The first three ran on the test vault, the fourth ran on the production vault:

- OutLayer request 10640, the Phase 9 live proof, transaction
  `DusvRubtcAnPyyB1BQYkf66nA8Vy3eSdZVAmdviuPpUu`
- OutLayer request 11912, the Phase 10 demo, transaction
  `5Xvu78qxd9NfgJzRBeyvdQXnqK8sLfSmzrfVC5dgDK68`
- OutLayer request 13040, the loose-ends retry proof, transaction
  `EYyyLXCLusX66ktWH4VyZWpP3UbkrcjZGf3MnX6Dfc6p`
- OutLayer request 13324, the production proof, obligation `prod-tee-001`, 100 units to the agent, receipt 11, transaction
  `9rLoxGuEFYSLWPJ8Jc2cv1krSLtummWszASUcX7kzuxZ`

The production proof is the first production TEE execution with a fetched and independently verified TDX attestation. An earlier production TEE settle exists, receipt 9, obligation `prod-console-tee-001` from Phase 9, but no attestation was ever recorded for it, so it was never independently verified.

Verify a bundle offline, no network needed. First install the verifier:

```sh
cargo install --git https://github.com/out-layer/outlayer-verify outlayer-verify
```

Then, from the repo root:

```sh
outlayer-verify bundle docs/attestation-proofs/attestation-proof-10640.json --offline
outlayer-verify bundle docs/attestation-proofs/attestation-proof-11912.json --offline
outlayer-verify bundle docs/attestation-proofs/attestation-proof-13040-mainnet-collateral.json --offline
outlayer-verify bundle docs/attestation-proofs/attestation-proof-prod-tee-001.json --offline
```

Each one exits 0. The verifier checks five things: the Intel signature
chain against Intel collateral, the TCB status, all five measurements
against the on-chain approved list, the binding of the quote to the exact
task, and the input and output re-hashed from the on-chain transaction.
The bundles carry the approved measurements and the collateral with them,
so the offline check compares against the bundled list, not a live fetch.

Or run the script, which does the same and prints PASS or FAIL:

```sh
scripts/verify-tee-attestation.sh --bundle docs/attestation-proofs/attestation-proof-10640.json
```

To verify live from a transaction hash instead of a bundle:

```sh
scripts/verify-tee-attestation.sh --tx DusvRubtcAnPyyB1BQYkf66nA8Vy3eSdZVAmdviuPpUu
scripts/verify-tee-attestation.sh --tx 5Xvu78qxd9NfgJzRBeyvdQXnqK8sLfSmzrfVC5dgDK68
scripts/verify-tee-attestation.sh --tx EYyyLXCLusX66ktWH4VyZWpP3UbkrcjZGf3MnX6Dfc6p
scripts/verify-tee-attestation.sh --tx 9rLoxGuEFYSLWPJ8Jc2cv1krSLtummWszASUcX7kzuxZ
```

One note on request 13040: the testnet collateral archive lags
the current Intel window, it still serves the window ending
2026-11-07T23:46:20Z, so a plain live check of request 13040 fails
with TCBInfo expired. That failure says the collateral is out of date, it says
nothing about the quote, and the retry with covering collateral is what
confirms the quote. The mainnet collateral endpoint already has the covering
window, 2026-11-08T00:15:55Z to 2026-12-08T00:15:19Z, and the script fetches
it and retries automatically, saying plainly which collateral it used. The
shipped bundle for 13040 already includes that collateral and verifies offline
with exit 0. The covering collateral is also shipped in this repo at
docs/attestation-proofs/collateral-fmspc-b0c06f000000-2026-11-08.json, and the
script falls back to it when the mainnet endpoint cannot be reached.

The production proof, request 13324, needed the same treatment. It ran on 2026-11-08, after the testnet archive window ended, so it verifies with the mainnet collateral too, and its shipped bundle already includes it and verifies offline with exit 0.

The live attestation host is `https://testnet-api.outlayer.ai`. Two older
hosts are retired and will fail: `coordinator-2gpvryc48.outlayer.workers.dev`
returns nothing, and `testnet-api.outlayer.fastnear.com` returns 410.


## The reputation check

Before the agent settles, the console checks the recipient against five
sourced signals: the account exists on-chain and its current code hash,
the account age as a lower bound from snapshots, prior interactions with
this vault from the receipts, a shared blocklist when one is configured,
and whether the receiver's contract code changed recently. The code-change
signal compares the current code hash to a snapshot baseline and, when the
code changed, uses the NearBlocks v3 deployment timestamp for the exact
age: BLOCK if the change is within 24 hours or the account has no other
history, WARN if within 7 days, ALLOW if the code has not changed or is
stable for over 7 days. No contract and first observation are neutral, not
a penalty. The answer is ALLOW, WARN, or BLOCK, with reasons. BLOCK
refuses outright. WARN goes to the owner for a decision and never settles
silently. Unknown maps to WARN, never to a silent ALLOW. The full spec is
in `docs/phase7-lane-b.md`, and the fifth signal is in
`docs/scorecard-code-change-recency.md`.

## The attack demo

The CLI proves the vault rejects bad terms. From the repo root, after
compiling the TypeScript (see Reproduce it below):

- `node frontend/dist-test/cli/cynex.js attack-one <vaultId> <obligationId> <proposedRecipient> <proposedAmount> <evidenceRef> [--dry-run]`
  fires one deliberate bad settle, a substituted recipient, a changed
  amount, or a replayed nonce, and shows the vault refusing it.
- `node frontend/dist-test/cli/cynex.js playground <vaultId> <obligationId...>` runs the recorded
  scenarios in `demo/playground-obligations.json`.

A real run on the test vault, 2026-11-08. The attack runner
simulates a compromised agent: it tries to settle obligation
p6-obl-001 to unregistered-xyz.testnet instead of the authorized
recipient, the way an agent acting on an injected prompt would. The
vault refuses it on chain with ERR_RECIPIENT_SUBSTITUTION, and zero
tokens move. The same run also refuses a changed amount, a replayed
nonce, and a budget breach:

| scenario | obligation | proposed recipient | proposed amount | tx hash | reason code | state after | moved |
|---|---|---|---|---|---|---|---|
| recipient substitution | p6-obl-001 | unregistered-xyz.testnet | 1000 | Fq3kmnkneg6pqMjw5vauMy9byKkbqfbzJyta2nmBDG5y | ERR_RECIPIENT_SUBSTITUTION | READY | 0 |
| terms mismatch | p6-obl-002 | acme-supplies.testnet | 1001 | 59XtAnUcYXEQtWxVAEiRtBJj8dVqa5KQsoz6KqiAYiXq | ERR_TERMS_MISMATCH | READY | 0 |
| nonce replay | p6-obl-006 | acme-supplies.testnet | 1000 | 8UAxAjNi3vv4zW6qXSsxPkeQoEcDSAzPzvRsX3GKv1o6 | ERR_NONCE_ALREADY_CONSUMED | PAID | 0 |
| budget exceeded | p6-obl-004 | acme-supplies.testnet | 9001 | HsFZDCfSjKbVmecn3Lhq7pK2rcSJBzJx5iPbUEStaSyF | ERR_BUDGET_EXCEEDED | READY | 0 |

The recipient balance read before and after each call was 977006100
both times, so nothing moved. Run it yourself with no key, after
compiling the TypeScript (see Reproduce it below):

```sh
node frontend/dist-test/cli/cynex.js attack cynex-testvault.cynexmaster.testnet demo/attack-scenarios.json --dry-run
```

The dry run prints what each scenario would settle and the code it
expects, and sends no transaction. The live run needs the agent key.

The attack transcript is in `docs/phase6-attack-transcript.md`. The
compromised-agent scenario is the point: the agent is assumed hostile,
and the vault still does not pay.

## Reproduce it

Do X, see Y. The build and verification commands below were run
from a fresh clone on 2026-11-08, and the expected result is what the
run printed. Rust 1.93.0, cargo-near, and the attestation verifier
were already installed on that machine, so their install lines are
prerequisites, not commands the run executed. Steps 1 to 6 spend
nothing and create nothing on chain: tests, type checks, view calls,
an offline attestation verify, and a dry run. They do create local
build output (node_modules, contract target, dist-test), but no
on-chain state. The console run at the end is the full demo path and
needs keys.

1. Clone and enter the repo. See a clean checkout of the
default branch. The steps below were verified against 61db7a2.

```sh
git clone https://github.com/Jayanng/Cynex.git
cd Cynex
```

2. Contract, from `contract/`. The repo targets Rust 1.93.0. Rust
1.93.0 and cargo-near must already be installed; the commands below
assume they are. A newer default toolchain fails `cargo clippy` on a
lint that did not exist in 1.93 (`clippy::chunks_exact_to_as_chunks`,
on the `chunks_exact(2)` call in `src/lib.rs`), so run the commands
with 1.93.0. See 142
passed with 0 failed, a clean clippy with no warnings, and a built
wasm binary:

```sh
RUSTUP_TOOLCHAIN=1.93.0 cargo test --lib
RUSTUP_TOOLCHAIN=1.93.0 cargo clippy --all-targets -- -D warnings
RUSTUP_TOOLCHAIN=1.93.0 cargo near build non-reproducible-wasm
```

3. Frontend, from `frontend/`. Install dependencies first; a fresh
checkout has no `node_modules`. See a clean install, a clean
typecheck, and 19 suites with 359 tests passed, the gated
near-sandbox suite skipped:

```sh
npm install
npm run typecheck
NODE_PATH=$PWD/node_modules npm run jest
```

`npm run jest` needs `NODE_PATH` set to the frontend `node_modules`
in a fresh checkout, or the three suites that import `near-api-js`
fail to load with "Cannot find module 'near-api-js'".

4. Verify a TEE attestation offline, from the repo root. Install
the verifier once first. This install needs network access:

```sh
cargo install --git https://github.com/out-layer/outlayer-verify outlayer-verify
```

Then run the script. The script itself runs offline and needs no
key. See PASS with exit 0:

```sh
scripts/verify-tee-attestation.sh --bundle docs/attestation-proofs/attestation-proof-10640.json
```

5. Compile the TypeScript and check the live vaults. From
`frontend/`, run the `tsc` line below. See 5 known `near-api-js`
type errors (TS2307) and exit 2, but the emitted `dist-test/` is
working JavaScript; the errors are expected. Then, from the repo
root, run verify-live for each vault. See a CSV of receipts, 30
rows on the test vault and 13 on the production vault, every row
verified_ok=true, exit 0. This reads chain state only and spends
nothing:

```sh
npx tsc --outDir dist-test --rootDir .. --module NodeNext --moduleResolution NodeNext --target ES2022 --strict --skipLibCheck --esModuleInterop --lib es2022,dom --typeRoots ./node_modules/@types ../agent/console.ts ../cli/cynex.ts ../services/verifier/verifier.ts ../services/verifier/verify.test.ts ../services/executor/executor.ts ../services/executor/executor.test.ts ../services/console/console.test.ts ../services/reputation/reputation.ts ../services/reputation/snapshot.ts ../services/reputation/live-sources.ts
```

```sh
node frontend/dist-test/cli/cynex.js verify-live cynex-testvault.cynexmaster.testnet
node frontend/dist-test/cli/cynex.js verify-live cynex-vault.cynexmaster.testnet
```

6. Attack dry run, from the repo root. See four DRY-RUN lines, one
per scenario, each with the code it expects, and no transaction
sent:

```sh
node frontend/dist-test/cli/cynex.js attack cynex-testvault.cynexmaster.testnet demo/attack-scenarios.json --dry-run
```

The full demo run below is separate from steps 1 to 6: it creates
obligations and settles with real keys.

Console, from `frontend/`: use the compiled `dist-test/` from step
5, then run the console with the environment below. The console
creates the obligation, requests evidence, verifies the evidence,
and settles with the agent's scoped key, reading the obligation and
the recipient balance back from chain after each step. The settle
transaction print is not the proof; the PAID read and the balance
delta are. The evidence step branches on the obligation's
evidence_type: PREIMAGE submits the artifact bytes on chain with
`submit_evidence_preimage` (no verifier key needed, and no verifier
check can substitute for it); TEE files a `request_tee_verification`
with the evidence URL from the obligation file's `evidence_ref` and
polls until the obligation is READY or the evidence window closes;
any other type runs the real verifier check and submits the signed
evidence. Evidence over 64 KiB falls back to the verifier path.

```sh
node dist-test/agent/console.js
```

```sh
CYNEX_VAULT=cynex-vault.cynexmaster.testnet
CYNEX_OWNER=cynexmaster.testnet
CYNEX_AGENT=cynex-agent.cynexmaster.testnet
CYNEX_VERIFIER=cynexmaster.testnet
CYNEX_OWNER_KEY_FILE=<bare owner key file, outside the repo>
CYNEX_AGENT_KEY_FILE=<bare agent key file, outside the repo>
CYNEX_VERIFIER_KEY_FILE=<bare verifier key file, outside the repo>
CYNEX_OBLIGATION_FILE=<obligation JSON file>
CYNEX_ARTIFACT_FILE=<evidence artifact file>
```

`CYNEX_VERIFIER` and `CYNEX_VERIFIER_KEY_FILE` are only needed on the
verifier path. A PREIMAGE obligation needs no verifier key at all,
and a TEE obligation needs the evidence URL, not a verifier key: the
console reads it from the obligation file's `evidence_ref`, which
must be an http(s) URL. The verifier key is also unused by the
playground and by the attack runner, which stays ungated.

Key files hold a bare KeyPairString, the private key string alone, never
a JSON credential file. They are never printed and never committed. The
vault and the recipient must be storage-registered on the token and the
policy funded before a live run; those are owner steps, not console
steps.

## What we tried and rejected

OutLayer was spiked in Phase 8 and the verdict was do not integrate, on
live evidence, not on paper. Two `request_execution` calls from a NEAR
account, using the GitHub source for the public vrf-example, produced no
verifiable execution: one left pending with no worker resolve, the other
failed visibly with an execution promise error. The worker's compiler is
off by default, so GitHub-source requests need a worker with the
compilation capability that the fleet mostly does not have. The way
around it is pre-published WASM through the coordinator cache or a
dashboard Project, and a contract-caller request instead of a direct
account call. Separately, the Phase 8 spike found no recent execution with a published attestation
through the public API, even successful ones. That gap is closed: checked again
on 2026-11-08, every recent execution returns a full TDX quote from the live
host, https://testnet-api.outlayer.ai, and the earlier 404s came from querying
retired hosts. Both parts of the reversal bar are now met for requests 10640,
11912, 13040, and 13324. See Verifying the TEE attestation above. The full report is in
`docs/spike-outlayer.md`, and the workaround findings are in the Phase 9
entry notes. The reversal bar: a contract-caller execution that resolves
with a VRF output whose signature verifies against the published public
key, plus a published attestation for the same request id.

NEAR AI Cloud was checked and does not fit the verifier: it is a TEE
inference service, chat and embeddings, with no endpoint to run a
deterministic hash check. Asking a language model for a verdict would be
weaker than the on-chain check, not stronger.

## Known limits

- The production recipient used through Phase 6, `acme-supplies.testnet`,
  does not exist on chain. The token contract still credits it, because
  `ft_transfer` only updates the token's own ledger, but no account
  stands behind those tokens. Do not demo a settle to it. Use a recipient
  account that exists.
- No suitable shared blocklist for NEAR account ids was found after
  searching nine candidates, so the blocklist signal is unavailable
  unless a URL is configured. The BLOCK path is proven by tests with a
  fixture URL, not by a live list. The provenance record is in
  `demo/reputation-blocklist-provenance.json`.
- Evidence over 64 KiB cannot use the on-chain check and falls back to
  TRUSTED_RELAYER, which is trusted by label.
- The on-chain check proves the bytes match the commitment. It does not
  prove the bytes mean what their source claims. That judgment belongs to
  the human at authorization time.

## Docs

- `docs/contract-api.md`, the frozen API, digest, timeouts, reason codes
- `docs/ledger.md`, the signed phase ledger
- `docs/threat-model.md`, what the vault assumes and what it does not
- `docs/spike-outlayer.md`, the OutLayer spike report and verdict
- `docs/phase6-attack-transcript.md`, the attack demo log
- `docs/phase7-lane-b.md`, the reputation engine
- `docs/deployment.md`, where the vaults are deployed and how to verify them

Track: NEAR Hackathon 2026, AI Security and Defense. Submission deadline:
14 November 2026, 23:59 UTC.
