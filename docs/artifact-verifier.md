# Real verifier over artifact bytes

contract base: Master 5efce97, "Contract: evidence gate hardening"
(contract/src/lib.rs only, 213 insertions). Vault
cynex-vault.cynexmaster.testnet code_hash
B3PkaBjH1izqp1gkcdwV8673Uf5ZkbPp1iX4guHGY8An, deployed to production.
is closed on Master (corrections 604325f, contract sign be093f0,
frontend merged). The frontend fast-forwarded from 3893cc9 to
5efce97 before this work.

## What changed

- services/verifier/verifier.ts: rewritten. It now computes a real
 SHA-256 over the real artifact bytes and compares it to the
 evidence_hash on the obligation. Matching artifact returns ALLOWED.
 One flipped byte, a wrong digest, a missing open request, a
 non-pending obligation, or an expired obligation returns BLOCK with
 EVIDENCE_MISMATCH or OBLIGATION_EXPIRED. The verifier never returns
 WARN. The result is bound to the obligation: the returned digest is
 the frozen settlement digest computed from the obligation and policy
 as read, the returned request_id is the pending_request_id open on
 the obligation, and the verifier checks the computed digest against
 the pending_digest on the obligation. The 46 line scaffold it
 replaces only compared hash strings and never read artifact bytes.
- agent/console.ts: the live evidence step now reads the artifact
 bytes from CYNEX_ARTIFACT_FILE, verifies them with the real
 verifier against the chain-read obligation (evidence_hash and
 pending_digest from chain, and the file hash must equal the chain
 hash), and submits only on ALLOWED with proof equal to the computed
 hash. Missing or unreadable artifact file, or a BLOCK result, aborts
 before submit_evidence. Fail closed: no result, no READY by default.
- cli/cynex.ts: new verify-artifact command. It reads the obligation
 live from the contract with exact u64 values via raw RPC (the same
 quoting pattern as verify-live, because near-api-js JSON parsing
 rounds u64 values over 2^53), reads the artifact bytes from the
 file, runs the verifier, and prints the trust mode with every
 result. Exit 0 on ALLOWED, 1 on BLOCK or an unreadable chain row,
 2 on usage or an unreadable artifact file.
- services/verifier/verifier.test.ts: 8 tests. Matched case returns
 ALLOWED bound to digest and request. Flipped byte returns BLOCK
 with EVIDENCE_MISMATCH. Expired returns BLOCK with
 OBLIGATION_EXPIRED even when the hash matches. No open request,
 wrong pending digest, and non-pending obligation all fail closed.
 The verifier never returns WARN.
- demo/verifier-artifact.txt: the demo artifact, 62 bytes,
 exact text "cynex demo artifact: delivery note 1 for
 acme-supplies" with no trailing newline. SHA-256
 4bbad2781260fe26366f899de6ff75dbfa35cd69795fa5ef5d3159027ad6c677.
- frontend/package.json: jest now runs with roots src and
 ../services, so the verifier test in services/ is collected.
 The scaffold typecheck file list includes the test file.

## Deployment, identity, measurement, proof format

Deployment: the verifier is a local module
(services/verifier/verifier.ts) run by the console operator on the
machine where the console runs. There is no separate verifier
service. It reads artifact bytes from a local file named by
CYNEX_ARTIFACT_FILE in the console, or by the artifact file argument
in the verify-artifact command.

Identity: the allowlisted verifier account is the vault owner,
cynexmaster.testnet. That is derived, not read from a view: the
recorded submit_evidence transactions (for example obl-008 submit
F5zGbwntiTwqQitfSHkmTozV1XgM5XGNnse2gw93Nnqp) were signed by
cynexmaster.testnet and succeeded, and submit_evidence requires the
caller to be in the on-chain allowlist. The full allowlist set is not
enumerable from here: the contract has no view that lists verifiers.

Measurement: there is no hardware measurement at MVP. The trust mode
is TRUSTED_RELAYER, which means the result is relayed by a trusted
operator. What constrains it is on chain: the allowlist, the request
match, the digest match, the proof equal to the recorded hash, the
expiry, and the one hour evidence timeout enforced in submit_evidence
itself. The mode is printed with every result and carried in the
returned record, and is never silently downgraded.

Proof format: proof is 64 hex characters, the SHA-256 of the artifact
bytes as read. It is submitted as the proof argument to
submit_evidence and must equal the evidence_hash on the obligation.
The result is bound to the settlement digest and the pending request
id, so a result computed for one obligation cannot be submitted for
another. The contract remains authoritative at submit time, and
BLOCKED has no exit by design.

## Live proof, read from this machine

No keys are on this machine, so the live proof here is read-only.
The submit path needs the verifier key held by contract.

- verify-artifact on obl-002 (READY, policy-001), demo artifact:
 trust mode TRUSTED_RELAYER, result BLOCK reasons
 EVIDENCE_MISMATCH, computed hash 4bbad2781260fe26366f899de6ff75db
 fa35cd69795fa5ef5d3159027ad6c677 over 62 bytes, settlement digest
 8926de2fd7d8c42a6d6a600257c21ce5ce27f4fa74c565420a45ce8c58cc7a2d,
 request_id obl-002-2, exit 1. The digest binding was checked three
 ways and all three agree: the digest recomputed from the live chain
 fields, the digest printed by the command, and the pending_digest
 read live from the obligation are all
 8926de2fd7d8c42a6d6a600257c21ce5ce27f4fa74c565420a45ce8c58cc7a2d.
 The chain evidence_hash is
 686f753bc595b5260eb0a86315e69cf229be183e3cce985cbee27f9705ea3b38,
 matching the record.
- verify-artifact on obl-003 (CANCELLED): BLOCK, request_id null
 (pending fields cleared by the timeout path), exit 1.
- verify-artifact on obl-nope: not found on chain, nothing verified,
 exit 1.
- verify-artifact with a missing artifact file: exit 2.
- Console dry run with the demo obligation file (evidence_hash equal
 to the demo artifact hash): DRY-RUN, the nine calls in order,
 submit_evidence proof 4bbad2781260fe26366f899de6ff75dbfa35cd69795
 fa5ef5d3159027ad6c677, exit 2. A dry run is not a settlement.
- Playground regression unchanged: obl-008 PAID, obl-002 READY,
 obl-003 CANCELLED, exit 0.
- Budget regression unchanged: policy-001 headroom 25000000,
 invariant ok, exit 0.
- Verify-live regression: all 7 receipts true, including receipt 6
 p4-prod-obl-001.

## Honest gaps

- A matched live proof needs one owner-created obligation whose
 evidence_hash equals the demo artifact hash. The artifact is
 demo/verifier-artifact.txt, hash
 4bbad2781260fe26366f899de6ff75dbfa35cd69795fa5ef5d3159027ad6c677.
 The obligation file to create is: obligation_id obl-verify-demo,
 policy_id policy-001, recipient acme-supplies.testnet, amount
 1000, evidence_type delivery-note, evidence_hash as above,
 expires_at_ns 1893456000000000000, nonce 9, evidence_ref
 sample-demo. After the owner creates it and requests evidence,
 verify-artifact returns ALLOWED live, and the console live run
 (create, request, verify bytes, submit, READY, settle) is a contract
 run, because the verifier key is held by contract.
- No live EVIDENCE_PENDING obligation exists right now, so the
 matched case is proven in tests and by the digest triple-match
 above, not by a live ALLOWED on chain.
- contract cargo suite outputs were not rerun from this machine. The
 contract claims in the corrections draft (timeout enforced in
 submit_evidence itself, pending fields cleared on success, BLOCKED
 having no exit by design) were verified directly against Master
 lib.rs instead: the draft file was not attached in this chat.
 submit_evidence requires the caller in the verifiers set
 (ERR_UNAUTHORIZED_VERIFIER), the request match, the proof equal to
 the recorded hash, the digest match, expiry, and the request time
 plus EVIDENCE_TIMEOUT_NS, and clears the pending fields on a
 decided obligation.

## Checks

- Scaffold typecheck clean (file list includes the verifier test).
- Frontend typecheck clean.
- Conformance 6/6.
- Jest 31/31 (9 schema, 7 states, 7 budget, 8 verifier).
- No contract changes, no frozen doc changes, no signing in this work.


## close confirmation (frontend)

The contract-api close corrections draft, supplied 2026-11-05, was verified line by line against Master contract lib.rs and live RPC reads (all four proof transactions queried, both submit obligations and the timeout obligation read live, deployment transaction checked, wasm SHA-256 recomputed to the deployed code_hash, earlier claims checked against Master be093f0), and confirmed by frontend. The rejection cases in the draft carry no transaction hash and were not independently re-derived; the artifact file behind the proof hash was not supplied; the Sol gate and reviewer agreement is contract evidence. The draft is not yet applied to docs/contract-api.md; application happens at close on Master. The acceptance audit PASS (2026-11-05, no blocking findings) is on record; the merge itself carries no audit comment. The matched live ALLOWED gap is closed: the full console live run on production with the demo artifact (obl-verify-demo PAID, receipt index 7, acme 977002100 to 977003100 exactly) was verified by the frontend against live RPC reads. frontend signed in docs/ledger.md on 2026-11-05; contract signature, draft application, and merge remain outstanding, so this work is not closed by this signature.
