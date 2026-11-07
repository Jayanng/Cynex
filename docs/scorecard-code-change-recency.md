# Scorecard: fifth reputation signal — code-change recency

Lane B delivery for the scorecard brief (adejoke-scorecard-brief,
2026-11-06). This is the one remaining gap in the Cynex track
scorecard: the reputation engine built in Phase 7 scored four
signals; the scorecard expects a fifth, whether the receiver's
contract code changed recently. This adds it as a fifth signal,
wired into the same gate, with tests and live proof. No contract
change. No change to the Cynex idea. Testnet only.

## 1. The signal

For a given receiver account: has this account's deployed contract
code changed recently, and if so, how recently?

### Data sources

- **Current code hash:** the RPC `view_account` read, already in
  the `AccountView` the existence signal uses. No new RPC call.
- **Previous code hash:** the latest snapshot for the account in
  `demo/reputation-snapshots/` (the snapshot pattern from the
  account-age signal). The snapshot already records `code_hash`,
  `fetched_at`, and the file, so no new snapshot format was needed.
- **Exact age of the current code:** the NearBlocks v3 deployments
  endpoint, `GET /v3/accounts/{account}/contract/deployments`
  (testnet base `https://api-testnet.nearblocks.io`, overridable
  with `--nearblocks-url` on the reputation command or
  `CYNEX_NEARBLOCKS_URL` for the console gate). It returns the
  deployment history; the latest deployment's `block_timestamp`
  is when the current code was deployed. Verified live on testnet
  2026-11-06: the endpoint answers without an API key, and for
  the production vault it returns the Phase 9 deployment at
  block 276504544, timestamp 1793979013847021866, tx
  7HPscpDE6BikHutgALKJP6BDh9LArFS2aZGtHRHTH6ki, with
  `code_hash` 7PBw1x6HbH3Eu2dWrTKjEEfxdJnAfFPwPJS5vZMM5zRC
  matching the live chain. The v1 API is retired (confirmed:
  it returns "API v1 was retired on 2026-11-05. Use /v3").

### How a change is detected

Compare the current `code_hash` to the latest snapshot's:

- It matches: the code has not changed. Signal is ALLOW.
- It differs: the code changed since the last observation. Record
  the new hash and the current time in the snapshot (the
  reputation-snapshot command does this; the signal itself never
  writes files).
- No snapshot yet: first observation. There is no baseline, so
  the signal is neutral, not a penalty. The snapshot is recorded
  so the signal works from the second check onward.
- The account has no contract (code_hash is the default
  `11111111111111111111111111111111`): neutral, not a penalty.
  An account with no contract cannot have changed its code.
- The account does not exist: the signal does not apply (the
  account_existence signal already reports it).

### Assessing recency

Two sources, in order of preference:

1. **Indexer exact age.** When the NearBlocks v3 endpoint returns
   a deployment timestamp for the current code, the age is
   `now - deployment_timestamp`. The timestamp is trusted only
   when it is after the previous snapshot's `fetched_at`; an older
   timestamp means the indexer is missing the latest deployment
   (stale), and it is ignored in favour of the window, with that
   stated in the output.
2. **Snapshot window.** The change happened between the previous
   snapshot's `fetched_at` and now. The window is reported as a
   window (for example "15.4h window"), never as a false precise
   age. A wide window means the change could have happened at any
   point in it, and the output says so.

### Thresholds (named, changeable, in services/reputation/reputation.ts)

- `CODE_CHANGE_WARN_WINDOW_MS` = 7 days.
- `CODE_CHANGE_BLOCK_WINDOW_MS` = 24 hours.

### Verdict mapping

- **ALLOW:** the code has not changed since the last observation,
  or the current code has been deployed and stable for longer than
  the 7-day window (exact age from the indexer).
- **WARN:** the code changed within the 7-day window, or it changed
  and the observation window is too wide to pin down when. The
  reason names the signal and reports the window.
- **BLOCK:** the code changed very recently (exact age or snapshot
  window within 24 hours), or it changed and the receiver has no
  other history (no prior vault interactions, and the account was
  first seen at the baseline snapshot). The refusal names the
  signal and its source.
- **NEUTRAL:** no contract, first observation, or the account does
  not exist. Neutral never blocks ALLOW and never contributes to
  the score.

The gate (`agent/wrapper.ts`, `gateSettleOnReputation`) refuses
on a BLOCK and names whichever signal caused it (blocklist or
code_change_recency), escalates on a WARN (proceeds only with
owner approval), and proceeds on ALLOW. The attack runner stays
ungated by design. The console shows the fifth signal in the same
place as the other four (the `formatReport` lines), so the owner
sees it before approving a WARN.

## 2. What changed

- `services/reputation/reputation.ts`: `CodeDeploymentCheck`
  interface, `checkCodeDeployment` on `ReputationSources`,
  `DEFAULT_CODE_HASH` / `CODE_CHANGE_WARN_WINDOW_MS` /
  `CODE_CHANGE_BLOCK_WINDOW_MS`, `codeChangeLine` (the signal),
  `buildReport` takes the deployment check and wires the fifth
  signal into BLOCK/WARN/ALLOW and the score, `evaluateCounterparty`
  fetches it (unavailable on failure). The header comment now says
  five signals and replaces the Phase 7 "no code-change history
  claim" rule with the sourced claim.
- `services/reputation/live-sources.ts`: `NEARBLOCKS_TESTNET_API`,
  `nearblocksBaseUrl` option, `checkCodeDeploymentLive` (the
  deployments endpoint, latest by block timestamp; empty list
  means no contract; any failure means unavailable with the
  reason).
- `agent/wrapper.ts`: the BLOCK branch names the blocking signal
  (blocklist or code_change_recency).
- `cli/cynex.ts`: the reputation help text names the fifth signal
  and `--nearblocks-url`; `reputationCmd` passes it through.
- `agent/console.ts`: the gate's `makeLiveSources` passes
  `CYNEX_NEARBLOCKS_URL`.
- `services/reputation/reputation.test.ts`: 13 new tests (11
  signal verdicts, 2 gate). `services/reputation/live-sources.test.ts`:
  3 new tests (deployments parsing, empty list, fetch failure).
- `docs/phase7-lane-b.md`: a note at the top and an addendum at
  the end record the fifth signal in the reputation docs.
- `demo/reputation-snapshots/2026-11-06-205637Z.json`: a new
  snapshot of the test vault, taken as part of the live proof
  (the no-change case). It is the baseline for the test vault
  from here on.

## 3. Tests (Jest, 2026-11-06)

135/135 in 12 suites (baseline 119/119 in 12). The 16 new tests:

- No change since the last snapshot: ALLOW on this signal,
  overall ALLOW, score 1.
- Recent change inside the 7-day window (indexer unavailable):
  WARN, with the window ("3.0d window") and both hashes reported.
- Very recent change inside the 24-hour window: BLOCK.
- Very recent change by the indexer age, with a wide snapshot
  window: BLOCK, proving the indexer refines the verdict (age
  "6.0h" in the note).
- Change with no other history (no receipts, first seen at the
  baseline): BLOCK, with "no other history" in the reason.
- Change whose current code is stable longer than 7 days (exact
  age 12.0d): ALLOW.
- No contract: neutral ("no contract deployed"), does not block
  ALLOW.
- First observation: neutral ("first observation"), does not block
  ALLOW.
- Wide window (36.0d, indexer unavailable): WARN with the window
  reported ("window of 36.0d"), and the note does not claim a
  precise age.
- Stale indexer timestamp (older than the snapshot): falls back
  to the window, WARN, with "indexer is missing the latest
  deployment" in the note.
- Change with no receipts but account-age history (an earlier
  snapshot exists): WARN, not BLOCK, proving the "no other
  history" condition needs both no receipts and a young account.
- Gate: a code-change BLOCK refuses and names
  code_change_recency; a code-change WARN escalates without
  approval and proceeds with it.
- Live sources: the deployments endpoint returns the latest
  deployment timestamp and tx (max block timestamp across the
  page); an empty list means no contract; a failed fetch is
  unavailable with the reason.

One test was fixed during the run, not the code: the stale-indexer
test first used a 1-day window, which sits exactly on the 24-hour
BLOCK boundary (<= 24h is BLOCK), so it returned BLOCK instead of
the intended WARN. The snapshot was moved to a 2-day window and
the test passes. The boundary is <= 24h, as documented.

## 4. Live proof (testnet, 2026-11-06)

All four cases the brief asks for, run with the real CLI against
the real vaults. The change case is a real on-chain change, not a
test deployment: the production vault's code changed from the
Phase 6 hash (G3Mt2gKs94C61Se4oLWvMUgR2Bfv2djdFQLz4TVrDH3E,
recorded in the 2026-11-06-053024Z snapshot) to the Phase 9 hash
(7PBw1x6HbH3Eu2dWrTKjEEfxdJnAfFPwPJS5vZMM5zRC) by the Phase 9
deployment (tx 7HPscpDE6BikHutgALKJP6BDh9LArFS2aZGtHRHTH6ki).

### Change case: production vault, BLOCK

`reputation cynex-vault.cynexmaster.testnet cynex-vault.cynexmaster.testnet` (exit 0):

```
reputation cynex-vault.cynexmaster.testnet: BLOCK
  account_existence: exists, code_hash 7PBw1x6HbH3Eu2dWrTKjEEfxdJnAfFPwPJS5vZMM5zRC | source: https://test.rpc.fastnear.com | at: 2026-11-06T20:54:59.846Z | current state only, read at block 276536871; no past code hash is claimed
  account_age: first seen 2026-11-06T05:30:25.757Z | source: demo/reputation-snapshots/2026-11-06-053024Z.json | at: 2026-11-06T05:30:25.757Z | age is only as old as the earliest snapshot that shows the account; no earlier history on record. Snapshot block 276445951 at 2026-11-06T05:30:23.514Z
  prior_vault_interactions: 0 receipts | source: cynex-vault.cynexmaster.testnet receipts view | at: 2026-11-06T20:55:00.337Z | no prior vault interactions; no history from us, which is not the same as a bad history
  blocklist: unavailable | source: none | at: none | no suitable public blocklist source for NEAR account ids; see docs/phase7-lane-b.md
  code_change_recency: changed 15.4h window | source: demo/reputation-snapshots/2026-11-06-053024Z.json | at: 2026-11-06T05:30:25.757Z | code changed since the latest snapshot demo/reputation-snapshots/2026-11-06-053024Z.json at 2026-11-06T05:30:25.757Z (old G3Mt2gKs94C61Se4oLWvMUgR2Bfv2djdFQLz4TVrDH3E -> new 7PBw1x6HbH3Eu2dWrTKjEEfxdJnAfFPwPJS5vZMM5zRC); the change happened in the window of 15.4h between that snapshot and now. NearBlocks v3 records the current code deployed at 2026-11-06T15:44:29.293Z (tx 7HPscpDE6BikHutgALKJP6BDh9LArFS2aZGtHRHTH6ki), age 5.2h. BLOCK: the code changed within the last 1.0d.
  reasons: code_change_recency: code changed (old G3Mt2gKs94C61Se4oLWvMUgR2Bfv2djdFQLz4TVrDH3E -> new 7PBw1x6HbH3Eu2dWrTKjEEfxdJnAfFPwPJS5vZMM5zRC) in a 15.4h window, current code age 5.2h; the code changed within the last 1.0d
  score: none (BLOCK, no guessed score)
```

The signal fired BLOCK on the real change, with both the window
(15.4h) and the exact indexer age (5.2h) reported, and the
deployment tx named. Note the production vault is BLOCKed as a
receiver right now because its code changed 5.2 hours ago; that
is the signal working as designed, and it does not affect normal
settlements (the usual recipient is the agent, which has no
contract and is neutral on this signal).

### First-observation case: test vault, neutral

`reputation cynex-testvault.cynexmaster.testnet cynex-testvault.cynexmaster.testnet` (exit 0, before the snapshot):

```
reputation cynex-testvault.cynexmaster.testnet: WARN (insufficient history)
  code_change_recency: first observation | source: https://test.rpc.fastnear.com | at: 2026-11-06T20:55:11.395Z | no snapshot on record for this account, so there is no baseline to compare against; the current code_hash is recorded as the baseline by the reputation-snapshot command and the signal works from the second check onward
  reasons: no prior vault interactions in our receipts
  score: none (WARN, no guessed score)
```

The WARN is for "no prior vault interactions", not for the
code-change signal, which is neutral as the brief requires.

### No-contract case: agent, neutral, ALLOW

`reputation cynex-vault.cynexmaster.testnet cynex-agent.cynexmaster.testnet` (exit 0):

```
reputation cynex-agent.cynexmaster.testnet: ALLOW score=1.000
  code_change_recency: no contract deployed | source: https://test.rpc.fastnear.com | at: 2026-11-06T20:55:12.425Z | code_hash is the default (no contract); an account with no contract cannot have changed its code, so this signal does not penalise it
  score: 1.000 (fraction of sourced signals positive)
```

### No-change case: test vault after a snapshot, ALLOW on this signal

A snapshot was taken (`reputation-snapshot
cynex-testvault.cynexmaster.testnet`, written to
`demo/reputation-snapshots/2026-11-06-205637Z.json`, test vault
exists at block 276537047), then the check was re-run (exit 0):

```
reputation cynex-testvault.cynexmaster.testnet: WARN (insufficient history)
  code_change_recency: no change since 2026-11-06T20:56:37.780Z | source: demo/reputation-snapshots/2026-11-06-205637Z.json | at: 2026-11-06T20:56:37.780Z | code_hash matches the latest snapshot; the code has not changed since the last observation
  reasons: no prior vault interactions in our receipts
  score: none (WARN, no guessed score)
```

Again the WARN is for "no prior vault interactions"; the
code-change signal itself is ALLOW ("no change").

## 5. Checks (2026-11-06)

- Scaffold typecheck (strict, incl. the new tests): clean.
- Frontend typecheck: clean. Conformance: 6/6.
- Jest: 135/135 in 12 suites (baseline 119/119 in 12).
- Regressions live: `verify-live` on production (10 receipts,
  all verified_ok=true, see the state note below);
  `playground cynex-vault.cynexmaster.testnet p6-prod-001` READY;
  console dry-runs for PREIMAGE and TEE still list the 9 calls
  (the dry-run returns 2 by design, "no keys supplied", as in
  Phase 9).

## 6. Live state found during this work (not changed by it)

The on-chain state moved since the Phase 9 delivery record
(8 receipts, agent balance 100, p5-prod-001 spent 0,
p9-prod-preimage-002 EVIDENCE_PENDING). This is Johnson's audit
and follow-up activity, recorded here so the record stays true:

- Production receipts: **10** (indices 0-9), all verified_ok=true.
  The two new ones are `prod-console-preimage-001` and
  `prod-console-tee-001`, 100 units each to the agent, on policy
  p5-prod-001 (timestamps 1793995446501454212 and
  1793995456256747506).
- policy-001: spent 975001000, reserved 0, funded 1000000000,
  headroom 24999000, frozen false. Unchanged.
- p5-prod-001: spent **200** (was 0), reserved 0, funded 1000,
  headroom **800** (was 1000).
- Agent ft_balance_of: **500** (was 100).
- The three production proof obligations: p9-prod-preimage-001
  READY, p9-prod-preimage-002 **CANCELLED** (was EVIDENCE_PENDING),
  p9-prod-tee-001 READY. Whether to settle or leave the two READY
  ones is still Johnson's decision.

## 7. Gaps, stated plainly

- **The live console gate proof is the audit step.** The console
  dry-run lists the calls but does not run the reputation gate
  (it returns 2, "no keys supplied", by design), and Rio's machine
  holds no keys. The gate refusing on a code-change BLOCK is
  proven by the Jest tests (a stub BLOCK report refuses and names
  code_change_recency) and by the live CLI check showing BLOCK on
  the production vault; only a live console run with Lane A keys
  proves the gate refuses on chain. That is the section 2.6 audit
  step, as in Phase 9.
- **The NearBlocks v3 endpoint is a third-party dependency.** It
  answered without an API key on testnet and its deployment
  timestamp matched the live chain. If it stops answering, the
  signal falls back to the snapshot window and says so; it never
  fabricates an age. The deployments list is only used for the
  latest timestamp; the change itself is always the live RPC code
  hash against the snapshot, so a stale or missing indexer cannot
  hide a change, only widen the recency window.
- **The 24-hour BLOCK boundary is inclusive (<= 24h).** A change
  exactly 24 hours old is BLOCK. That is the documented rule; the
  one test that sat on the boundary was fixed by moving its
  snapshot, not by changing the rule.
