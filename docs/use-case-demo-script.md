# Cynex concrete use case: a procurement agent pays a research agent for a named report

For the demo video, the frontend Demo page, and for judges reading the
repo. This is the concrete use case, item 3 of the survival plan. It
ran live on the test vault on 2026-11-08, with real transaction hashes.
The two-agent run is described in its own section below. Obligation
`usecase-report-003`, settled 2026-11-08, pays the research agent
`cynex-agent2.cynexmaster.testnet` exactly 100 while the procurement
agent `cynex-agent.cynexmaster.testnet` receives nothing. The earlier
single-account run, `usecase-report-002`, is kept as the prior proof
and as the canonical attack sequence.
The transaction, receipt, balance, policy, key-scope, and artifact
values below are from the verified testnet run. Nothing here is
mocked, canned, or hardcoded.

## The product in one sentence

A compromised AI agent can request payment, but it cannot change who
gets paid, how much they get, or what evidence is required.

## The story

A human authorizes a procurement agent to pay a research agent exactly
for one named report, and the agent pays on delivery. The payment story
is agent-to-agent. The human authorization is explicit. The deliverable
is one named report artifact, committed by digest, and the same
obligation is carried through the console, the MCP transcript, the
attack log, the receipt, and the proof page.

The actors:

- Human (owner): `cynexmaster.testnet`. Authorizes the obligation and
  submits the evidence owner-side. Holds the full-access key.
- Procurement agent: `cynex-agent.cynexmaster.testnet`. The agent that
  requests settlement. Holds only a scoped settle-only key for the test
  vault.
- Research agent (recipient): `cynex-agent2.cynexmaster.testnet`.
  Delivers the named report and receives the payment. Created
  2026-11-08 as a subaccount of the master, funded with 1 NEAR, public
  key `ed25519:7uWPpfosyMNTsYfz4P1cx7GBjpm88fhiVBSiW7cnG2CR`.

The two-agent run, obligation `usecase-report-003`, is the canonical
demonstration of payment between two distinct agent accounts: the
procurement agent requests settlement and the research agent receives
exactly 100, while the requester receives nothing. See the two-agent
run section below.

The earlier run, obligation `usecase-report-002`, used one NEAR
account, `cynex-agent.cynexmaster.testnet`, in both agent roles: it was
the settlement requester, holding the scoped settle-only key, and it
was the recipient. That run exercises the vault authorization and
settlement controls using one agent account in both roles; it does not
demonstrate payment between two distinct agent accounts. The control
proof is valid, because the vault enforces the recorded terms no
matter which account calls settle, and the attack sequence in that run
is kept below as the canonical attack proof.

The token is USDC.e testnet, `usdc.fakes.testnet`, 6 decimals, no
mainnet value. The amount is 100 base units (0.0001 USDC.e). The policy
is `p6-001` on the test vault. The amounts are testnet demo amounts;
they fit the live policy, which had 5300 units of headroom before this
run.

## The named artifact

The deliverable is one exact file, fixed across the console, the MCP
transcript, the attack log, the receipt, the proof page, and the video.

- Filename: `demo/near-agent-risk-report-v1.md`
- Size: 6421 bytes
- SHA-256 digest: `2a8bddcb3b001fd9051ec68757b8a113fa355cfe619f07882ac622721431ebc9`
- Evidence type: PREIMAGE (Layer 1, on-chain hashing)
- Size under the 64 KiB cap: yes, 6421 of 65536 bytes, so the evidence
  uses the owner-side on-chain hashing path. Evidence over 64 KiB uses
  the explicitly labeled TRUSTED_RELAYER fallback path, which does not
  pretend to have the same trust properties as the vault's own hashing.

The file is a real NEAR ecosystem risk report, written as the research
agent's deliverable. Its bytes are the evidence. The vault hashes those
exact bytes itself and compares the result to the committed digest.

## The obligation

- Obligation ID: `usecase-report-002`
- Policy: `p6-001`
- Recipient: `cynex-agent.cynexmaster.testnet` (the research agent)
- Amount: 100 base units, USDC.e testnet
- Evidence type: PREIMAGE
- Evidence digest: `2a8bddcb3b001fd9051ec68757b8a113fa355cfe619f07882ac622721431ebc9`
- Expires: 2030-01-01 (1893456000000000000 nanoseconds)
- Nonce: 30002
- State at authorization: CREATED

A first run of the same scenario, obligation `usecase-report-001`
(nonce 30001), settled earlier the same day with the same outcomes
(receipt index 23, agent balance 2000 to 2100, policy spent 4600 to
4700). Its rejected-attempt transaction hashes were not captured
because the proof tool failed to extract them from the error objects.
`usecase-report-002` is the canonical obligation for this demo script
because every transaction hash was captured. Both runs are on chain.

## The two-agent run: payment between two distinct agent accounts

On 2026-11-08, after the `usecase-report-002` run, the same scenario
ran again with two distinct agent accounts, obligation
`usecase-report-003`. This is the run that demonstrates payment
between two distinct agent accounts. The procurement agent is
`cynex-agent.cynexmaster.testnet`, which requests settlement with its
scoped settle-only key for the test vault. The research agent is the
new account `cynex-agent2.cynexmaster.testnet`, created the same day
as a subaccount of `cynexmaster.testnet`, funded with 1 NEAR from the
master account, and registered with the token before settlement. The
research agent receives exactly 100, and the procurement agent
receives nothing.

- New account: `cynex-agent2.cynexmaster.testnet`, public key
  `ed25519:7uWPpfosyMNTsYfz4P1cx7GBjpm88fhiVBSiW7cnG2CR`, 1 NEAR at
  creation. No private key or seed phrase is included in the repository.
- Account creation: transaction
  `JBph4fKi9hzX3VTUhQ9NtexrbPMZ8fX2GyJXgXwUyy8d`, block 276798966,
  signer `cynexmaster.testnet`.
- Token registration: `storage_deposit` for the new account on
  `usdc.fakes.testnet`, 0.00125 NEAR from the master, transaction
  `92MGUi1ikp5LVTGKBfVnGYgYfV6Yp2hzakqufQYdX4pH`. Registration is
  required before the vault can pay the account, and it was confirmed
  on chain (`storage_balance_of` total 1250000000000000000000)
  before the obligation was created.
- Obligation ID: `usecase-report-003`
- Policy: `p6-001`
- Recipient: `cynex-agent2.cynexmaster.testnet` (the research agent)
- Amount: 100 base units, USDC.e testnet
- Evidence type: PREIMAGE, same artifact, same digest `2a8bddcb...`
- Expires: 2030-01-01 (1893456000000000000 nanoseconds)
- Nonce: 30003
- Pending request ID: `usecase-report-003-30003`

The four transactions, all RECORDED ON TESTNET, all status
SuccessValue:

- Create: `2WJF2vZDwWQoyrtpA2p2veUnVMHwTz6HPABxC68tiV4i`,
  2026-11-08 16:16:56 UTC, block 276799089, signer
  `cynexmaster.testnet` (owner). State after: CREATED. Policy
  `p6-001` before: spent 5100, limit 10000, funded 10000, frozen
  false, remaining 4900.
- Request evidence: `ENzaWdGLj688rvgwrL99ccbGsYvVSiz4WD1bYsu9f1W2`,
  2026-11-08 16:17:11 UTC, block 276799114, signer
  `cynexmaster.testnet` (owner). State after: EVIDENCE_PENDING,
  pending request ID `usecase-report-003-30003`.
- Submit evidence preimage:
  `GGyymoK4K8jouvai2LYBfq5iHAQAgwACnzhGbuEsVBAm`, 2026-11-08
  16:17:32 UTC, block 276799149, signer `cynexmaster.testnet`
  (owner, as courier; the method is permissionless). The vault hashed
  the exact report bytes and matched the committed digest. State
  after: READY.
- Settle: `GSD8NfrJhpFzchDcPM75v56QaFge6twdKHa4YJ9ktBur`,
  2026-11-08 16:17:58 UTC, block 276799191, signer
  `cynex-agent.cynexmaster.testnet` with its test-vault-scoped
  settle-only key (receiver the test vault, method `settle` only,
  allowance 0.25 NEAR, public key
  `ed25519:2MBdiB9ayS1SREqAvZFC6ZuzdA9TuAjEFHV8HYPjZKgn`). The settle
  used the exact authorized recipient and amount, with evidence ref
  `usecase-report-003-30003`. State after: PAID.

Verified live from chain after settlement:

- Research agent `cynex-agent2.cynexmaster.testnet` token balance: 0
  to 100, delta exactly 100.
- Procurement agent `cynex-agent.cynexmaster.testnet` token balance:
  2500, unchanged. The requester is paid nothing.
- Policy `p6-001`: spent 5100 to 5200, limit 10000, funded 10000,
  frozen false. Remaining headroom 4800.
- Receipt index: 28. Receipt: obligation `usecase-report-003`,
  recipient `cynex-agent2.cynexmaster.testnet`, amount 100, token
  `usdc.fakes.testnet`, timestamp 1794154680050968600 nanoseconds
  (2026-11-08 16:18:00 UTC). The receipt `tx_ref` field is empty on
  the automatic settle path, as in the earlier runs; the settle
  transaction hash above is the link to the explorer.
- Test vault receipts: 29 (indices 0 to 28). Vault `state()` receipt
  index 29.
- Obligation `usecase-report-003`: PAID.

The earlier run, `usecase-report-002`, remains the canonical attack
sequence in this document, with all four rejections captured. It used
one account in both agent roles. The `usecase-report-003` run is the
canonical two-agent payment: same artifact, same digest, same policy,
same amount, two distinct agent accounts, and the payment lands in
the research agent account only.


## The 12-step sequence, with the live proof (obligation `usecase-report-002`)

All transactions below are RECORDED ON TESTNET, network testnet, with
the transaction hash, timestamp, attempted mutation, and rejection
outcome. They ran live on 2026-11-08. They are not presented as if
they just happened. During a live demo, the same steps would be
LIVE NOW.

### Step 1: Human authorizes the fixed obligation

The owner creates the obligation with the fixed recipient, amount,
evidence digest, and budget. The vault records those terms. Nothing
the agent later proposes can change them.

- Transaction: `9tJoNH6NQAqsHNgYCzzDfh82vxQ9Hrk3g5DUHwGQdDYm`
- Signer: `cynexmaster.testnet` (owner)
- State after: CREATED
- Policy `p6-001` after: spent 4700, limit 10000, funded 10000,
  frozen false, remaining 5300.

### Step 2: The console shows the terms

The obligation is read back from the chain: recipient
`cynex-agent.cynexmaster.testnet`, amount 100, evidence digest
`2a8bddcb...`, policy `p6-001`, remaining budget 5300. The agent sees
the obligation but does not receive general wallet authority. It holds
only a scoped settle-only key for the test vault, verified on chain:
receiver `cynex-testvault.cynexmaster.testnet`, method `settle` only,
allowance 0.25 NEAR. It cannot transfer NEAR directly, create keys,
or call owner methods.

### Step 3: Request evidence

The owner requests evidence. The vault sets the pending request ID to
`usecase-report-002-30002` and the pending digest to the settlement
digest computed from the recorded terms.

- Transaction: `ECqWfdEhVNUefHesNnvHSePdWQYadnqNY4Yu1SfXbZJ9`
- Signer: `cynexmaster.testnet` (owner)
- State after: EVIDENCE_PENDING

### Step 4: Before evidence is ready, settlement is rejected

The agent tries to settle while the obligation is EVIDENCE_PENDING,
with the correct recipient and amount. The vault rejects it because
the obligation is not READY. This is a VAULT REFUSAL: the transaction
reached the contract and the contract rejected it.

- Transaction: `BRXXhezVxYvze3imNHkrShnS8ujUvsShy4f3GtgwpCgQ`
- Label: RECORDED ON TESTNET
- Timestamp: 2026-11-08 14:19:56 UTC, block 276787146
- Network: testnet
- Attempted mutation: settle with the correct terms, before evidence
  was submitted
- Rejection outcome: `ERR_INVALID_STATE`, transaction failed on chain
- Signer: `cynex-agent.cynexmaster.testnet` (agent, scoped settle key)
- State after: EVIDENCE_PENDING, unchanged
- Agent balance delta: 0

### Step 5: The correct evidence is processed owner-side

The owner submits the exact report bytes as the preimage evidence.
The vault hashes the bytes itself with SHA-256 and compares the result
to the committed digest. The bytes match, so the obligation becomes
READY. The bytes are hashed and dropped, never stored.

- Transaction: `eJtwJXnMTNm9deKfK8aTJpwwMpF7nhXcsQNWcKFa1sq`
- Signer: `cynexmaster.testnet` (owner, as courier; the method is
  permissionless)
- State after: READY

### Step 6: The agent submits an unauthorized altered settlement attempt, changed recipient

The compromised agent tries to redirect the payment to a different
recipient, `cynexmaster.testnet`, instead of the authorized research
agent. The transaction reaches the contract and is rejected. This is
a VAULT REFUSAL, not a reputation refusal and not a client-side
refusal.

- Transaction: `EiBHjMBqZfBLZB33H4odbBfskGbVCX1Jor422t5S1cpX`
- Label: RECORDED ON TESTNET
- Timestamp: 2026-11-08 14:20:03 UTC, block 276787158
- Network: testnet
- Attempted mutation: proposed recipient `cynexmaster.testnet`
  instead of the authorized `cynex-agent.cynexmaster.testnet`
- Rejection outcome: `ERR_RECIPIENT_SUBSTITUTION`, transaction failed
  on chain
- Signer: `cynex-agent.cynexmaster.testnet` (agent, scoped settle key)
- State after: READY, unchanged
- Agent balance delta: 0

### Step 7: The agent submits an unauthorized altered settlement attempt, changed amount

The compromised agent tries to increase the amount from 100 to 200.
The transaction reaches the contract and is rejected. This is a
VAULT REFUSAL.

- Transaction: `2NaWqCYiUnh9DMhRCR6JVSDQ3R7yD26U8Auf3qEer91f`
- Label: RECORDED ON TESTNET
- Timestamp: 2026-11-08 14:20:05 UTC, block 276787162
- Network: testnet
- Attempted mutation: proposed amount 200 instead of the authorized
  100
- Rejection outcome: `ERR_TERMS_MISMATCH`, transaction failed on
  chain
- Signer: `cynex-agent.cynexmaster.testnet` (agent, scoped settle key)
- State after: READY, unchanged
- Agent balance delta: 0

### Step 8: The agent settles, and the receipt proves it

The agent settles with the exact authorized recipient and amount.
The vault dispatches the transfer, the callback books the payment,
and the receipt is appended.

- Transaction: `2VLL134m83x5fWZLr2qBbPkjJ7gL9YR7V7U9eur7qoVC`
- Label: RECORDED ON TESTNET
- Timestamp: 2026-11-08 14:20:08 UTC, block 276787167
- Network: testnet
- Signer: `cynex-agent.cynexmaster.testnet` (agent, scoped settle key)
- State after: PAID
- Receipt index: 24
- Receipt: obligation `usecase-report-002`, recipient
  `cynex-agent.cynexmaster.testnet`, amount 100, token
  `usdc.fakes.testnet`, timestamp 1794147610217529000 nanoseconds
  (2026-11-08 14:20:10 UTC). The receipt `tx_ref` field is empty on
  the automatic settle path; the settle transaction hash above is the
  link to the explorer, and the receipt index is the link to the
  receipt chain.
- Agent balance: 2100 to 2200, delta exactly 100. (2100 is the
  balance after the first run, usecase-report-001, settled earlier
  the same day; 2200 is after this run.)
- Policy `p6-001` after: spent 4700 to 4800, limit 10000, funded
  10000, frozen false

### Step 9: A replay attempt is rejected

The agent tries to settle the same obligation again. The transaction
reaches the contract and is rejected because the nonce is already
consumed. No second payment, no second receipt.

- Transaction: `hG6uhpePR9ZcvCZXZprpXa8rvbAGGQPxD4ZyMpP91F6`
- Label: RECORDED ON TESTNET
- Timestamp: 2026-11-08 14:20:15 UTC, block 276787178
- Network: testnet
- Attempted mutation: settle an already-paid obligation again
- Rejection outcome: `ERR_NONCE_ALREADY_CONSUMED`, transaction failed
  on chain
- Signer: `cynex-agent.cynexmaster.testnet` (agent, scoped settle key)
- State after: PAID, unchanged
- Agent balance delta: 0

### Step 10: The proof page shows the three layers separately

The proof page shows the Layer 1 hash, the TDX attestation, and the
VRF verification as three separate checks, each with its own
verification command and its own pass or fail result. They are not
collapsed into one badge.

- Vault integrity, Layer 1: the vault hashed the submitted report
  bytes itself with SHA-256 and compared them to the committed digest
  `2a8bddcb...`. The bytes matched, so the obligation became READY.
  The vault proves that settlement was authorized for a specific
  evidence digest and that the submitted bytes match that digest.
- TEE provenance, Layer 2: for TEE evidence, a guest program fetches
  the evidence inside an Intel TDX enclave and hashes it there, and
  the per-execution TDX quote binds what ran, what went in, and what
  came out. The TDX quote is verified off chain through the verifier
  or the dashboard. The use-case obligation is a PREIMAGE obligation,
  so it does not carry its own TEE execution. The TEE layer is shown
  by the existing verified executions (requests 10640, 11912, 13040
  on the test vault and 13324 on the production vault), each with an
  independently verified TDX attestation.
- VRF anchor, Layer 3: for TEE evidence, the guest requests VRF
  randomness during execution and the vault verifies the signature on
  chain, bound to the pending request. The VRF provides an independently verified randomness anchor
  bound to the pending request. It does not prove
  TEE execution, and it must never be labeled as TEE evidence. The
  use-case obligation is a PREIMAGE obligation, so it does not carry
  its own VRF anchor. The VRF layer is shown by the existing verified
  executions.

## The exact evidence claim

Cynex proves that settlement was authorized for a specific evidence
digest and that the submitted bytes match that digest. TDX provides
execution provenance for the guest that fetched and hashed the
evidence. VRF provides an independently verified randomness anchor
bound to the pending request. Cynex does not prove the semantic truth
of the report. A vault can prove that the submitted bytes match the
authorized digest. It cannot prove that a report is factually correct,
useful, or honest. Evidence verification is about bytes matching a
commitment, not about the semantic truth of the content.

## The attack matrix

Every refusal below is a VAULT REFUSAL: the transaction reached the
contract and the contract rejected it on chain. A reputation refusal
is different: the reputation gate refuses a known-bad recipient before
any chain call, and it is labeled REPUTATION REFUSAL. An RPC failure
is labeled RPC FAILURE. An attestation failure is labeled ATTESTATION
FAILURE. The labels must be impossible to miss.

| Attempt | Mutation | Transaction | Outcome | Label |
|---|---|---|---|---|
| Settle before evidence | Correct terms, obligation EVIDENCE_PENDING | `BRXXhezVxYvze3imNHkrShnS8ujUvsShy4f3GtgwpCgQ` | `ERR_INVALID_STATE` | RECORDED ON TESTNET, VAULT REFUSAL |
| Changed recipient | Recipient `cynexmaster.testnet` instead of the agent | `EiBHjMBqZfBLZB33H4odbBfskGbVCX1Jor422t5S1cpX` | `ERR_RECIPIENT_SUBSTITUTION` | RECORDED ON TESTNET, VAULT REFUSAL |
| Changed amount | Amount 200 instead of 100 | `2NaWqCYiUnh9DMhRCR6JVSDQ3R7yD26U8Auf3qEer91f` | `ERR_TERMS_MISMATCH` | RECORDED ON TESTNET, VAULT REFUSAL |
| Replay | Settle the same obligation again after PAID | `hG6uhpePR9ZcvCZXZprpXa8rvbAGGQPxD4ZyMpP91F6` | `ERR_NONCE_ALREADY_CONSUMED` | RECORDED ON TESTNET, VAULT REFUSAL |

All four rejected transactions were verified on chain with status
Failure, signed by the agent account. All four left the obligation
state and the agent balance unchanged. For usecase-report-002, the correct settle is the only
transaction that moved funds, and it moved exactly 100. The first
run, usecase-report-001, moved 100 units earlier the same day.

The full attack matrix for the product also includes changed evidence
digest or bytes, budget overflow, and reputation refusal before any
chain call. Changed evidence is covered by the vault hashing the
submitted bytes and rejecting a mismatch with `ERR_EVIDENCE_MISMATCH`
(proven live in Phase 9). Budget overflow is covered by the policy
invariant and rejects with `ERR_BUDGET_EXCEEDED` (proven live in the
attack runner). Reputation refusal is covered by the reputation gate,
which refuses a known-bad recipient before any chain call and is
labeled REPUTATION REFUSAL, separate from a vault refusal.

## The states

The obligation moves through these states, each labeled separately.
Do not use a generic "created" state. Do not let a prepared object
appear in the same section as an authorized obligation without a
clear label.

- Prepared: the terms are drafted but not yet authorized. Not an
  obligation.
- Authorized: the owner created the obligation. State CREATED.
- Evidence pending: the owner requested evidence. State
  EVIDENCE_PENDING.
- READY: the evidence was submitted and the vault verified it. The
  obligation can now settle.
- Settlement submitted: the agent called settle and the transfer is
  in flight. State TRANSFER_PENDING.
- Settled: the transfer completed and the receipt was appended. State
  PAID.
- Rejected: a settle attempt failed on chain with a named reason
  code. The obligation state is unchanged.

## How to reproduce it

From the repo root, with the test vault. The artifact is
`demo/near-agent-risk-report-v1.md`. Compute its SHA-256, create the
obligation with that digest as the evidence hash, request evidence,
submit the exact file bytes as the preimage, then settle with the
agent's scoped key. The settle calls in this run were signed by the
agent account `cynex-agent.cynexmaster.testnet` using its
test-vault-scoped settle-only key (receiver the test vault, method
`settle` only, allowance 0.25 NEAR, verified on chain). The
create, request-evidence, and submit-evidence calls were signed by
the owner `cynexmaster.testnet`. The vault performs identical on-chain
term and nonce checks regardless of the caller, so the enforcement
proof is valid.

To verify the live state, run the read-only checks. No key and no
account needed for these:

```sh
node frontend/dist-test/cli/cynex.js verify-live cynex-testvault.cynexmaster.testnet
```

That prints a CSV of receipts. Receipt index 28 is the two-agent run:
obligation `usecase-report-003`, recipient
`cynex-agent2.cynexmaster.testnet`, amount 100, token
`usdc.fakes.testnet`. Receipt index 24 is the attack-sequence run,
obligation `usecase-report-002`. Every row reports `verified_ok=true`.

To verify a single transaction, look it up on the testnet explorer
with its hash, or query it by RPC. For example, the changed-recipient
rejection:

```sh
curl -s https://rpc.testnet.fastnear.com -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":"x","method":"tx","params":["EiBHjMBqZfBLZB33H4odbBfskGbVCX1Jor422t5S1cpX","cynex-agent.cynexmaster.testnet"]}'
```

The response status is Failure, which is the vault rejecting the
altered settlement on chain.

## Final live state after this run

- Test vault policy `p6-001`: limit 10000, funded 10000, spent 5200,
  reserved 0, frozen false. Remaining headroom 4800.
- Research agent token balance (`cynex-agent2.cynexmaster.testnet`): 100.
- Procurement agent token balance (`cynex-agent.cynexmaster.testnet`):
  2500, unchanged by the two-agent settle.
- Test vault receipts: 29 (indices 0 to 28), all verified.
- Obligation `usecase-report-003`: PAID, receipt index 28.
- Obligation `usecase-report-002`: PAID, receipt index 24.
- Obligation `usecase-report-001`: PAID, receipt index 23 (the first
  run of the same scenario).

## For the video

- Lead with the payment problem, not with the TEE or VRF. The first
  sentence is the one-sentence summary above. Then show the
  authorization, the attack failing, and the payment succeeding.
- Show the obligation state and the balances before and after each
  step, not just the transaction hash. The PAID read and the balance
  delta are the proof; the transaction hash alone is not.
- Show the attack rejections with their exact reason codes on screen:
  `ERR_INVALID_STATE`, `ERR_RECIPIENT_SUBSTITUTION`,
  `ERR_TERMS_MISMATCH`, `ERR_NONCE_ALREADY_CONSUMED`.
- Show the three proof layers separately, each with its own label and
  its own verification. Do not collapse them into one badge. Do not
  say the VRF proves TEE execution.
- State the exact evidence claim in one line: Cynex proves the
  submitted bytes match the authorized digest. It does not prove the
  report is true.
- Do not settle to `acme-supplies.testnet`. It does not exist on
  chain. The recipient in the two-agent run is the research agent
  `cynex-agent2.cynexmaster.testnet`; in the earlier single-account
  run it was the agent account.
