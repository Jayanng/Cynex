# Phase 10 Lane B: demo and submission

Phase 10 is the last phase. Lane A is done: the README sections on
on-chain enforcement and the security model, the deployment and
verification doc, and the demo script and proof (Master fc3ceac), plus
the contract change that adds owner-only `cancel_expired_ready` for
expired READY obligations, deployed to both vaults (Master 0dafcdb).
Master has since moved on (Lane B rebased onto Master 9f31347 on
2026-11-09: DeepSeek retry-review fixes, README live numbers
refreshed to the 2026-11-08 chain state, MCP expiry-parse fix).
Both vaults now run code hash
`65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6`
(the DeepSeek audit fixes deploy; the earlier `7JJ27aMW…` hash in
this doc's first draft is superseded — see the 2026-11-09
re-verification below).

Lane B did three things: the final README "do X, see Y" reproduction
steps, the polished frontend, and the demo video. The demo script is
Lane A's (`docs/phase10-demo-script.md`, proven live on the test vault
with real tx hashes); Lane B verified it independently, built the
frontend around it, and produced the video from it.

## Live state verified by Lane B, 2026-11-07

Both vaults on code hash
`7JJ27aMWztX2F3z4W9zxSmK93eMa7RuTGvmAwWab9x4B`, read live from chain.

- Production: 11 receipts, indices 0-10, all `verified_ok=true`.
  Policy p5-prod-001: spent 300, reserved 0, funded 1000, headroom 700.
  The two dead production obligations are now CANCELLED:
  `p9-prod-preimage-001` and `p9-prod-tee-001` (the cleanup worked).
  `fj-prod-tee-001` is still READY.
- Test vault: 16 receipts, indices 0-15, all `verified_ok=true`.
  The three demo receipts are 11 (`p10-demo-preimage-001`), 12
  (`p10-demo-attack-001`), 13 (`p10-demo-tee-001`). Two more settled
  after the demo: 14 (`concurrent-nonce-001`) and 15
  (`concurrent-nonce-002`), 100 each.
  Policy p6-001: spent 3900, reserved 0, funded 10000, headroom 6100.
  Agent token balance 1200.
- All three demo obligations are PAID on the test vault.

Note: `docs/deployment.md` records the test vault at spent 3700, 14
receipts, agent 1000. That was true when it was written; the two
concurrent-nonce settles moved it to 3900, 16 receipts, agent 1200.
Lane A's doc is stale on that line, not wrong. No balances changed in
the cleanup itself.

## Live state re-verified by Lane B, 2026-11-09 (after rebase onto Master 9f31347)

Read live from chain (RPC `https://test.rpc.fastnear.com`,
block ~276,933,56x), after the rebase. The 2026-11-07 numbers above
are kept as the record of that day; these are the current ones.

- Both vaults on code hash
  `65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6`, unchanged since
  the 2026-11-08 check.
- Production: 13 receipts, indices 0-12. Last receipt 12 is
  `mcp-prod-001` (Lane A's MCP working check).
- Test vault: 31 receipts, indices 0-30. Last receipt 30 is
  `mcp-working-check-001` (Lane A's MCP working check).
- Agent token balance 2700 (was 2000 on 2026-11-08, 1200 on
  2026-11-07 — the MCP working checks moved it).
- All three demo obligations are still PAID on the test vault:
  `p10-demo-preimage-001`, `p10-demo-attack-001`,
  `p10-demo-tee-001`.
- Policy spent/headroom figures were not re-read in this pass;
  receipt counts, code hash, agent balance, and demo-obligation
  states are the live check recorded here. The showcase page
  reads all of these live on every load and never hardcodes them.

## README "do X, see Y": fresh-clone test (the cold-run transcript)

Cloned Master 0dafcdb to a clean directory (`/tmp/cynex-fresh`) and
ran the README "Reproduce it" steps exactly as written. All pass.

- `git clone https://github.com/Jayanng/Cynex.git` — Master 0dafcdb.
- `npm install` in `frontend/` — exit 0.
- `npm run typecheck` — exit 0, clean.
- `NODE_PATH=$PWD/node_modules npm run jest` — 135 passed, 135 total,
  12 suites. (Without NODE_PATH the three suites that import
  `near-api-js` fail to load; the README already says this.)
- The README `tsc` line (from `frontend/`, `--outDir dist-test`) —
  emits the expected TS2307 errors ("Cannot find module 'near-api-js'")
  and still emits working `dist-test/agent/console.js` and
  `dist-test/cli/cynex.js`, as the README says.
- Console dry-run (no keys) with a PREIMAGE obligation file built
  from the demo proof (delivery note
  `demo-delivery-note-001:p10-demo-preimage-001:100`, SHA-256
  `d51c5d7ddbbe4b8e0e420caa1658d806cb29beb89c608ad9dbb043e3910f7657`,
  matching the proof doc) — prints the calls (9, create through
  settle), the evidence hash bytes are exactly the committed digest,
  exit 2 by design ("no keys supplied"). Note: the obligation file's
  `evidence_hash` must be the 64-character hex string, not a byte
  array; a byte array is misread (the console parses it two hex
  characters at a time). The README already implies hex; this is
  recorded here so a reader does not repeat the mistake.
- `cynex verify-live cynex-testvault.cynexmaster.testnet` — 16
  receipts, all `verified_ok=true`.
- `cynex reputation cynex-vault.cynexmaster.testnet
  cynex-agent.cynexmaster.testnet` — ALLOW, score 1.000.

The README "Reproduce it" steps work from a clean clone. No step was
changed to make them pass.

## README updates (Lane B)

- Status: now says Phases 0 through 9 are closed, the scorecard fifth
  reputation signal (code-change recency) is merged, and Phase 10
  (demo and submission) is the final phase.
- The attack demo section now points at the Phase 10 demo script and
  proof (`docs/phase10-demo-script.md`,
  `docs/phase10-demo-proof.md`).
- The reputation section already described all five signals (Lane A,
  fc3ceac); Lane B did not change it.

## Frontend polish

- `demo/playground-obligations.json`: the three Phase 10 demo
  obligations added to the test vault list as read-only cases
  (`settleable: false`), with their settle tx hashes and receipt
  indices in the notes:
  - `p10-demo-preimage-001`, happy path, settle tx
    `3Gp3J2zZCKrne1PamDVf6PgXHk4qGc3a58GBvoFcNhrZ`, receipt 11.
  - `p10-demo-attack-001`, attack (three tries), correct settle tx
    `Ho97UjQEDDfe7Go66uHrVSJvbF8narZJ2YBH3hWarxi`, receipt 12; the
    three failed tx hashes are in the note.
  - `p10-demo-tee-001`, TEE and VRF, settle tx
    `3QV2aCRSiJ8ZYqLECCpK6ZkXpYE4AdxJzmyP3JTaDqWB`, receipt 13.
  The playground test matrix now renders 18 rows (was 15); the three
  new rows carry the read-only suffix. Verified by calling the
  compiled `matrixRows` on the updated file.
- `frontend/playground.html`: a Demo section at the top, pointing at
  the demo script and proof docs and explaining that the three demo
  obligations are read-only cases in the test matrix.
- No obligation was created or settled by Lane B; the demo
  obligations are the already-PAID ones, read live. The playground
  reads their live state (PAID) and never makes them settleable.

## New frontend (showcase) — implemented 2026-11-09

The 4-page showcase (`index.html` at the repo root, a standalone
static file) is now in the repo on this branch. It is the frontend
Johnson accepted on 2026-11-09: Landing, Demo (Guided/Sandbox
toggle), Docs, Proof. It presents Cynex as a product, not a
hackathon entry or a build plan — no phase, hackathon, Track 6,
submission, or repo-public copy anywhere (the only "phase" strings
left are the repo file paths `docs/phase10-demo-script.md` and
`docs/phase10-demo-proof.md`).

What it does, all verified in the file before it was landed:

- Refusal panel first on Landing, with the real refusal tx
  `AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S`
  (`ERR_RECIPIENT_SUBSTITUTION`), "0 tokens moved", and a
  "Read it from the chain" button.
- "Try to break it" panel on Landing (change recipient, change
  amount, replay a nonce, remove evidence), each with the real
  on-chain terms, error code, and real refusal tx where one
  exists. The remove-evidence case has no executed refusal tx
  and is labelled as evaluated only — no tx invented.
- Live status strip on all four pages, polling every 5 seconds,
  with a Last Settle cell. Failed reads show
  "Unavailable — retrying", never a cached value.
- One verify command on Landing with the expected output.
- Hero tightened to the tagline plus one plain sentence.
- Trust row on Landing: 19 suites / 369 tests passing (verified
  live by the Jest run below), Sol audit pass, receipts live
  from the test vault, 4 TEE attestations verified.
- Jest count in the cold-run command updated to 19 suites,
  369 tests passing. The page notes explicitly that it is a
  standalone static file reading via raw JSON-RPC fetch, not
  the TypeScript client, and that the live behaviour is
  identical.

Demo-token live mode (Johnson's complete brief, section 2) is
implemented as scaffolding in the same file, with the key
NOT yet supplied: `DEMO_TOKEN` is empty and `enabled: false`.
No key was invented. The page loads near-api-js@7 on demand
from the jsDelivr +esm build (verified to return 200) and,
once the key arrives, will sign a real settle call with the
tampered terms, show the refusal with its real tx hash, and
re-read the obligation to prove nothing moved. Only attacks
are offered in live mode, never a correct settle. Network,
RPC, and key-exhausted failures are reported plainly and fall
back to the simulated panel.

Contract finding that decides what live mode needs (verified
against the settle function on origin/Master): the vault
checks nonce/state BEFORE recipient and amount — in-flight or
PAID returns `NONCE_ALREADY_CONSUMED`, a non-READY state
returns `ERR_INVALID_STATE`, and only then recipient
(`ERR_RECIPIENT_SUBSTITUTION`) and amount
(`ERR_TERMS_MISMATCH`). So a live recipient/amount attack
against `p10-demo-attack-001` (PAID) would return the wrong
code. Live mode needs, from Johnson along with the key: a
READY demo obligation (evidence submitted, never settled) for
the recipient/amount attacks, and a CREATED/EVIDENCE_PENDING
demo obligation for the remove-evidence attack. The replay
attack uses the existing PAID `p10-demo-attack-001`, which
is correct as-is. Until those arrive, live mode stays
disabled and the simulated panel is the only mode.

Hosted demo: a README section stating what the hosted demo
can do and what requires a local command, plus a secrets-audit
checklist (full Git history and artifacts, rotate anything
ever committed), is drafted and ready to add to the README;
the hosting provider is still to be chosen and the audit
still to be run before go-live.

## Demo video

A narrated video, 1920x1080, 123 seconds, in
`cynex-demo-video.mp4` (a copy is with the user and in the goal
files; it is not committed to the repo). Six scenes, each with its
real tx hashes, following the demo script exactly. It opens on
the title and then the happy path, so per Johnson's complete
brief it needs re-cutting to the 60-second structure (problem,
authorization, attack fails, correct evidence pays, receipt and
proofs), with every step showing its real tx hash and the
evidence step visible. A 60-second script from the same demo
run and tx hashes is drafted; the rough cut is not yet
recorded. Freeze a release candidate by Wed 11 Nov morning
for the final cut.

1. Title — "Pay the obligation. Not the prompt." The story in one
   line, the test vault, the code hash.
2. Happy path — create, request evidence, submit the delivery note,
   the vault hashes the bytes itself, settle. Receipt 11. Agent
   700 to 800.
3. Attack — three tries. Recipient substitution
   (`ERR_RECIPIENT_SUBSTITUTION`), amount 200
   (`ERR_TERMS_MISMATCH`), correct settle (receipt 12), replay
   (`ERR_NONCE_ALREADY_CONSUMED`). Balances do not move on any
   failed settle.
4. TEE and VRF — the guest fetches the evidence inside the enclave,
   VRF verifies on-chain, settle. Receipt 13. Agent 900 to 1000.
5. Verification — `cynex verify-live` on the test vault: 16 receipts,
   indices 0 to 15, all verified. Policy spent 3900, agent 1200.
6. Closing — the three layers in one line: the bytes match, the
   source, the VRF anchor.

The video is a narrated slideshow of the real flows (the slides were
rendered from the demo script's tx hashes and the live chain state I
verified; the narration is synthetic speech). It is not a screen
recording of live transactions, because no new transaction was
executed for the video: the demo transactions already ran live on the
test vault and are the ones shown. Nothing in it is simulated, and no
tx hash is invented. If a judge wants the live execution, the demo
script and proof docs give the exact steps and hashes to re-run.

Narration script (the exact words spoken):

- Title: "Cynex. Pay the obligation. Not the prompt. A settlement
  vault for AI agents on NEAR, where the vault, not the agent,
  decides whether the money moves. Every step in this demo ran live
  on testnet, with its real transaction hash."
- Happy path: "A human authorizes a payment: one hundred USDC for a
  delivery, with the delivery note as evidence. The vault records
  the recipient, the amount, and the hash of the note. The agent
  submits the note. The vault hashes it itself, matches the
  committed digest, and the obligation goes ready. Settle. The
  agent's balance goes from seven hundred to eight hundred. Exactly
  one hundred moved, and the receipt proves it."
- Attack: "Now the agent is compromised. Its prompt tells it to pay
  a different recipient. The vault refuses on chain: recipient
  substitution. Then a larger amount: two hundred instead of one
  hundred. Refused: terms mismatch. Then the correct settle, to
  show the obligation was still good. It pays. Then the replay:
  settle the same obligation again. Refused: the nonce was already
  consumed. Three failed settles, each with a named on-chain
  rejection, and the balances do not move on any of them."
- TEE: "The same shape, but the evidence is verified by a TEE guest
  instead of the on-chain hash. The guest fetches the evidence from
  its claimed source inside an attested enclave, hashes it there,
  requests VRF randomness, and the vault verifies the digest, the
  source, and the VRF signature on chain. The obligation goes
  ready. Settle. The agent's balance goes from nine hundred to one
  thousand."
- Verification: "Run cynex-verify on the test vault. Sixteen
  receipts, indices zero to fifteen, all verified. The receipt hash
  chain replays from genesis with no gap and no mismatch. Every
  receipt is accounted for."
- Closing: "Three layers, one story. Layer one proves the bytes
  match. Layer two proves where they came from. Layer three anchors
  the execution to the request. Cynex: pay the obligation, not the
  prompt."

## Checks

- Jest (2026-11-09, after rebase onto Master 9f31347):
  **369 passed, 1 skipped, 370 total, 19 suites passed, 1
  skipped** — run with `NODE_PATH=$PWD/node_modules`, as the
  README says. Without NODE_PATH the four MCP suites fail to
  load (`Cannot find module '@modelcontextprotocol/sdk/...'`);
  that is the pre-existing NODE_PATH quirk, not a defect in
  Lane B code. This confirms Johnson's "19 suites, 369 tests
  passing" figure, which Lane B could not verify from the file
  alone before. (The earlier 135/135 figure in this doc's first
  draft predates the MCP suites.)
- Frontend typecheck (`npm run typecheck`): clean.
- Conformance: 6 passing vectors.
- Scaffold typecheck (the strict invocation over the Lane B
  sources): exit 0 on the branch. (The §2.6 audit of the fifth
  signal found 5 pre-existing near-api-js errors under a different
  invocation, identical on Master; none in Lane B code. The wording
  "no new typecheck errors" is the accurate one.)
- The playground matrix renders 18 rows with the three new demo
  obligations as read-only (verified against the compiled
  `matrixRows`).

## What is NOT Lane B's to do (human-gated, Johnson)

Making the repo public, publishing the X post, submitting once, and
supplying the mainnet payout account. The agent never does these
alone. The pre-submission checklist (payout account, repo public,
LICENSE + SECURITY.md, no secrets in history, live rules re-read,
payload human-approved) is Johnson's to confirm.

## Sign-off

Pending the section 2.6 audit.

## Addendum, 2026-11-09

The static index.html (1,459 lines, sha256
159576a45c64700976dd5cd8529df31e998cba543f61d1d0ebd06e45707a3d7c) was
replaced by a React + Vite + TypeScript app in web/ on Johnson's
order, following the stack React 19, Vite 6, TypeScript, Tailwind
bundled, fonts self-hosted, near-api-js for all chain reads. The
three design audit defects are closed in the React version: Docs no
longer scrolls sideways, hashes render as short hex, and the policy
cell reads the real policy. The build exits 0 and the live data was
verified in a headless Chromium render. The demo token remains empty
and disabled.
