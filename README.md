# Cynex

Cynex is a purpose-bound settlement vault for AI agents on NEAR.
Pay the obligation. Not the prompt.

A human authorizes an obligation with a fixed recipient, token, amount,
evidence requirement, and budget. The agent may request settlement, but
the vault itself rejects any payment that changes those terms, exceeds
the budget, or repeats an obligation. The agent is assumed compromised:
it holds a key that can only call settle, and the vault, not the agent,
decides whether the money moves.

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
`cynex-vault.cynexmaster.testnet`. Phases 0 through 8 are closed. Phase 9
is in progress: the three-layer verification described below. The repo
goes public on 13 November 2026.

Live state, last verified 2026-11-06: policy-001 funded 1,000,000,000,
spent 975,001,000, reserved 0, frozen false, 8 receipts. The token is
`usdc.fakes.testnet` (USDC.e, 6 decimals). The full ledger is in
`docs/ledger.md`.

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
anyone can verify it through OutLayer's attestation endpoint; the vault
itself does not verify the quote on-chain. This
answers the question layer 1 cannot: a digest proves which bytes were
checked, not where they came from.

**Layer 3, VRF anchor.** During execution the guest requests VRF
randomness. The OutLayer keystore signs
`vrf:{request_id}:{sender_id}:{user_seed}` with an Ed25519 key whose
public key is published, and the vault verifies the signature on-chain
with `env::ed25519_verify`, bound to the pending request.

Oversized evidence keeps the labeled fallback, TRUSTED_RELAYER: the owner
as the verifier, named as trusted, never presented as trustless. Layers 2
and 3 ship only if the live test proves the guest fetch and the
attestation work. If either fails, Phase 9 ships layer 1 plus the
fallback, not a broken TEE layer.

## The reputation check

Before the agent settles, the console checks the recipient against four
sourced signals: the account exists on-chain and its current code hash,
the account age as a lower bound from snapshots, prior interactions with
this vault from the receipts, and a shared blocklist when one is
configured. The answer is ALLOW, WARN, or BLOCK, with reasons. BLOCK
refuses outright. WARN goes to the owner for a decision and never settles
silently. Unknown maps to WARN, never to a silent ALLOW. The full spec is
in `docs/phase7-lane-b.md`.

## The attack demo

The CLI proves the vault rejects bad terms. From the repo root, after
compiling the TypeScript (see Reproduce it below):

- `cynex attack-one <vaultId> <obligationId> <proposedRecipient> <proposedAmount> <evidenceRef> [--dry-run]`
  fires one deliberate bad settle, a substituted recipient, a changed
  amount, or a replayed nonce, and shows the vault refusing it.
- `cynex playground <vaultId> <obligationId...>` runs the recorded
  scenarios in `demo/playground-obligations.json`.

The attack transcript is in `docs/phase6-attack-transcript.md`. The
compromised-agent scenario is the point: the agent is assumed hostile,
and the vault still does not pay.

## Reproduce it

Do X, see Y. Every step below was run on testnet; the fresh-clone test
in Phase 9 pins the exact console invocation and fixes this section
where it is wrong.

```sh
git clone https://github.com/Jayanng/Cynex.git
cd Cynex
```

Contract, from `contract/`:

```sh
cargo test --lib
cargo clippy --all-targets -- -D warnings
cargo near build non-reproducible-wasm
```

Frontend, from `frontend/`:

```sh
npm run typecheck
npm run jest
```

Console, from `frontend/`: compile the TypeScript with the frontend
`tsc` binary, then run the console with the environment below. The
console creates the obligation, requests evidence, verifies the
evidence, and settles with the agent's scoped key, reading the
obligation and the recipient balance back from chain after each step.
The settle transaction print is not the proof; the PAID read and the
balance delta are. The evidence step branches on the obligation's
evidence_type: PREIMAGE submits the artifact bytes on chain with
`submit_evidence_preimage` (no verifier key needed, and no verifier
check can substitute for it); TEE files a `request_tee_verification`
with the evidence URL from the obligation file's `evidence_ref` and
polls until the obligation is READY or the evidence window closes;
any other type runs the real verifier check and submits the signed
evidence. Evidence over 64 KiB falls back to the verifier path.

```sh
npx tsc --outDir dist-test --rootDir .. --module NodeNext --moduleResolution NodeNext --target ES2022 --strict --skipLibCheck --esModuleInterop --lib es2022,dom --typeRoots ./node_modules/@types ../agent/console.ts ../cli/cynex.ts ../services/verifier/verifier.ts ../services/verifier/verify.test.ts ../services/executor/executor.ts ../services/executor/executor.test.ts ../services/console/console.test.ts ../services/reputation/reputation.ts ../services/reputation/snapshot.ts ../services/reputation/live-sources.ts
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
account call. Separately, no recent execution has a published attestation
through the public API, even successful ones, so the VRF signature is the
on-chain anchor while that gap persists. The full report is in
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

Track: NEAR Hackathon 2026, AI Security and Defense. Submission deadline:
14 November 2026, 23:59 UTC.
