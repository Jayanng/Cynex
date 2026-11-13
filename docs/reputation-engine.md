# Reputation signals, real and scoped

This document is "Reputation signals, real and scoped". This is frontend work: there are no contract steps and no contract change is needed. The frontend side built the
reputation engine in `services/reputation/`, wired it into the agent
wrapper, and recorded the snapshot method, the blocklist provenance,
and the sample outputs below. No contract changes, no frozen doc
changes, no signing in the delivery commit.

Note (scorecard brief, 2026-11-06): a fifth signal, code-change
recency, was added to the reputation engine after closed.
It is documented in the addendum at the end of this file and in
docs/scorecard-code-change-recency.md. The "four signals" framing
and the "no code-change history" statement in section 2 below are
the record; the fifth signal supersedes the latter.

## The four signals

Only these four, each returning a source and a timestamp on every
line of output. Nothing else is implemented.

### 1. Account existence plus current code hash (RPC)

Source: a live `view_account` RPC call against the testnet RPC
endpoint (`https://test.rpc.fastnear.com`, or `--rpc` when the
snapshot command names another). The signal records whether the
account exists right now and its current code hash, with the source
as the RPC endpoint and the time of the read, plus the block height
the read was taken at. Current state only. We never claim a past
code hash; we only have the current one.

An account that does not exist is a sourced fact, not a failure:
the RPC returns `UNKNOWN_ACCOUNT`, and the signal reports
"not found" with the source and the block height. A token balance
for an account id, if one exists, is the token contract's own
record and is not proof the account exists; the report says so
where it matters (see the acme finding below).

### 2. Account age and first seen (snapshots)

Source: snapshot files we take and document (see the snapshot
method below). The age is only as old as the earliest snapshot
that shows the account existing, and the output says that plainly.
An account with no snapshot on record has an unknown age, not
zero. An account whose snapshots never show it existing has no
first seen; the latest snapshot records it as not found.

We do NOT claim historical code-change tracking. That needs an
archival source or indexer we are not building, and no such claim
appears anywhere in this document. The pre-existing architecture note
outside the repo makes that claim; it is deliberately not repeated
here.

### 3. Prior vault interactions (our own receipts)

Source: the contract `receipts(start, limit)` view, paginated
from genesis (0, 100 at a time until empty), filtered to the
counterparty as recipient. The signal records the count, the
first receipt index and its timestamp, and the last receipt index.
A counterparty that appears in our receipts has a real history;
one that does not has none from us, which is not the same as a
bad history. A count of zero is a sourced fact, not a missing
signal.

### 4. Blocklist (named source and provenance)

Source: a blocklist URL, only when one is configured
(`--blocklist-url` on the reputation command,
`CYNEX_BLOCKLIST_URL` for the console gate). The signal records
the URL, the fetch time, and whether the checked address was on
it. The accepted formats are a JSON array of NEAR account ids or
a newline-delimited text list of account ids.

**There is no suitable public blocklist source for the accounts we
check, so the live signal is unavailable.** This is the honest
outcome the instructions anticipate, not a gap papered over.
The provenance record is in
`demo/reputation-blocklist-provenance.json` and in the section
below. The engine supports a blocklist (the tests prove the BLOCK
path with a fixture URL), but no live URL is configured, and no
list was invented.

## Snapshot method

Written before the first snapshot was taken.

- **Who takes the snapshots:** frontend (the operator running the
 CLI). The snapshot command is
 `node dist-test/cli/cynex.js reputation-snapshot <accountId...>
 [--snapshots <dir>] [--rpc <url>]`, run from the repo root.
 It takes one live `view_account` read per account plus the
 final block, and writes one file per run.
- **When they are taken, and how often:** before each reputation
 check run that needs an age signal, and at least once for this
 (the first snapshot is dated 2026-11-06). Snapshots are
 taken on demand, not on a schedule; a later snapshot only ever
 adds history, it never rewrites an earlier file.
- **Where they are stored:** in the repo, under
 `demo/reputation-snapshots/`, one file per run named
 `<YYYY-MM-DD-HHMMSS>Z.json` from the UTC fetch time. The exact
 path of the first snapshot is
 `demo/reputation-snapshots/2026-11-06-053024Z.json` (the time
 in the name is the run's fetch time). The CLI default is `demo/reputation-snapshots`
 relative to the current working directory; the console gate
 reads `CYNEX_SNAPSHOT_DIR` (unset means no snapshots on record,
 and the age signal is unavailable).
- **How a snapshot timestamp is proven:** the file records the
 block height and the block timestamp (nanoseconds, from the
 final block header) at capture time, plus the wall-clock fetch
 time, the RPC endpoint, and who took it. A later reader can
 check the block height and timestamp against the chain. A
 snapshot that cannot be checked later is not provenance, it is
 a claim.
- **What a snapshot contains:** per account, the account id,
 whether the account exists, its code hash (null when the
 account does not exist), the block height, the block timestamp,
 and the wall-clock fetch time; plus file-level taken_by,
 source_rpc, and fetched_at. A file missing a field, or with a
 field of the wrong type, is rejected on read rather than
 silently trusted.

## Blocklist provenance

Searched 2026-11-06. No suitable public blocklist source for NEAR
account ids exists. The candidates checked, and why each is
unsuitable for the accounts we check:

- **OFAC SDN list** (U.S. Treasury): name-based, plus crypto
 addresses on Bitcoin, Ethereum, Tron, Litecoin, Solana and EVM
 chains. No NEAR account ids. Checking a NEAR account id
 against a name list is meaningless.
- **PhishDestroy destroylist** (github.com/phishdestroy/destroylist):
 a phishing *domain* blocklist (232,306 domains, adblock
 format). It lists domains, not NEAR accounts.
- **MetaMask eth-phishing-detect**: phishing domains, not NEAR
 accounts.
- **ScamSniffer scam database**: EVM wallet addresses and
 phishing domains. No NEAR accounts.
- **CryptoScamDB**: scam URLs, fraudulent EVM/BTC addresses, and
 blacklisted domains. No NEAR accounts.
- **BitcoinAbuse**: Bitcoin addresses only.
- **HAPI Protocol**: on-chain malicious-address oracle for
 Solana, ETH, BSC. No NEAR.
- **NearBlocks** (nearblocks.io): an explorer. It has account
 pages and transaction history but no public blocklist, no scam
 labels, and no fetchable list.
- **CertiK incident reports** (e.g. the HOT Bridge / NEAR Intents
 report, 30 September 2026): one-off writeups naming specific
 accounts in one incident. Not a maintained list, not fetchable
 as a blocklist.

Because none of these can answer "is NEAR account X listed?", the
blocklist signal is unavailable for every checked address. The
machine-readable record is
`demo/reputation-blocklist-provenance.json`: the search time, the
candidates with their URLs and reasons, and the per-address
result (unavailable, with the reason) for each account checked.
Nothing was invented to fill the gap.

## Sample reputation outputs

The outputs below are the verbatim `reputation` command output
from the live run on 2026-11-06, after the first snapshot was
taken. Every line shows a real source and timestamp.

`reputation cynex-vault.cynexmaster.testnet acme-supplies.testnet`
(exit 0):

```
reputation acme-supplies.testnet: WARN (insufficient history)
 account_existence: not found | source: https://test.rpc.fastnear.com | at: 2026-11-06T05:30:31.699Z | no account on chain at the current block, read at block 276445962; a token balance for this id, if any, is the token contract's own record, not proof the account exists
 account_age: no snapshot shows this account existing | source: demo/reputation-snapshots/2026-11-06-053024Z.json | at: 2026-11-06T05:30:25.154Z | latest snapshot demo/reputation-snapshots/2026-11-06-053024Z.json at 2026-11-06T05:30:25.154Z records it as not found; first seen is unknown
 prior_vault_interactions: 8 receipts, first index 0 at 2026-11-04T00:18:03.012Z | source: cynex-vault.cynexmaster.testnet receipts view | at: 2026-11-06T05:30:32.163Z | first receipt is the earliest sourced evidence of this counterparty with our vault
 blocklist: unavailable | source: none | at: none | no suitable public blocklist source for NEAR account ids; see docs/reputation-engine.md
 reasons: account does not exist at the current block
 score: none (WARN, no guessed score)
```

`reputation cynex-vault.cynexmaster.testnet cynex-agent.cynexmaster.testnet`
(exit 0):

```
reputation cynex-agent.cynexmaster.testnet: WARN (insufficient history)
 account_existence: exists, code_hash 11111111111111111111111111111111 | source: https://test.rpc.fastnear.com | at: 2026-11-06T05:30:32.427Z | current state only, read at block 276445963; no past code hash is claimed
 account_age: first seen 2026-11-06T05:30:26.372Z | source: demo/reputation-snapshots/2026-11-06-053024Z.json | at: 2026-11-06T05:30:26.372Z | age is only as old as the earliest snapshot that shows the account; no earlier history on record. Snapshot block 276445952 at 2026-11-06T05:30:24.164Z
 prior_vault_interactions: 0 receipts | source: cynex-vault.cynexmaster.testnet receipts view | at: 2026-11-06T05:30:32.874Z | no prior vault interactions; no history from us, which is not the same as a bad history
 blocklist: unavailable | source: none | at: none | no suitable public blocklist source for NEAR account ids; see docs/reputation-engine.md
 reasons: no prior vault interactions in our receipts
 score: none (WARN, no guessed score)
```

`reputation cynex-vault.cynexmaster.testnet unregistered-xyz.testnet`
(exit 0):

```
reputation unregistered-xyz.testnet: WARN (insufficient history)
 account_existence: not found | source: https://test.rpc.fastnear.com | at: 2026-11-06T05:30:33.139Z | no account on chain at the current block, read at block 276445964; a token balance for this id, if any, is the token contract's own record, not proof the account exists
 account_age: no snapshot shows this account existing | source: demo/reputation-snapshots/2026-11-06-053024Z.json | at: 2026-11-06T05:30:26.960Z | latest snapshot demo/reputation-snapshots/2026-11-06-053024Z.json at 2026-11-06T05:30:26.960Z records it as not found; first seen is unknown
 prior_vault_interactions: 0 receipts | source: cynex-vault.cynexmaster.testnet receipts view | at: 2026-11-06T05:30:33.583Z | no prior vault interactions; no history from us, which is not the same as a bad history
 blocklist: unavailable | source: none | at: none | no suitable public blocklist source for NEAR account ids; see docs/reputation-engine.md
 reasons: account does not exist at the current block; no prior vault interactions in our receipts
 score: none (WARN, no guessed score)
```

## Wrapper behavior

The gate lives in `agent/wrapper.ts` (`gateSettleOnReputation`)
and is called by the console (`agent/console.ts`) between the
recipient balance read and the settle call. The console prints
the reputation lines, then the gate decision, before any settle
is attempted.

- **BLOCK:** the counterparty is on a named blocklist. The
 console refuses, names the signal and its source, and no
 settle is attempted. (No live counterparty is BLOCKED: the
 blocklist signal is unavailable, so the live BLOCK path is
 proven by the tests with a fixture URL, not by a live run.)
- **WARN:** the counterparty has too little sourced history.
 The console escalates to the owner: it prints the reasons and
 the missing history, and no settle is attempted unless the
 owner explicitly approves with `CYNEX_APPROVE_WARN=1`. With
 approval it proceeds and prints the approval alongside the
 reason. A warned counterparty never settles silently.
- **ALLOW:** the console proceeds and prints the score (the
 fraction of sourced signals that are positive).

The gate is deliberately separate from `buildSettle`. The attack
runner (`cli/cynex.ts` attack-one) calls `buildSettle` directly
to fire deliberate rejections against the contract; it must not
be reputation-gated, because its whole point is to prove the
contract rejects bad terms. Only the agent's own settle path
goes through the gate.

Defense in depth only: reputation is a second layer. The vault
terms are the prevention, and a good reputation score never
overrides a terms mismatch, a budget excess, or a frozen policy.

## The acme finding

The first live reputation run caught something the earlier work
never checked: **acme-supplies.testnet does not exist on chain.**

Two independent RPC endpoints agree
(`https://rpc.testnet.near.org` and `https://test.rpc.fastnear.com`):
a `view_account` read returns `UNKNOWN_ACCOUNT` for
acme-supplies.testnet at the current block. The token contract
still records a balance of 977006100 for that id and a storage
registration for it, but those are the token contract's own maps;
they do not prove the account exists. The eight receipts to acme
are real on-chain history (first receipt index 0, timestamp
1793751483012073148, obligation obl-001), and the eight
settlements succeeded at the token level, crediting an id that
has no account behind it.

Whether the account never existed or was deleted is not
sourced, and neither is claimed here. What is sourced is: it
does not exist now, it has eight receipts, and no snapshot
shows it existing. The reputation verdict for acme is therefore
WARN, with the reason "account does not exist at the current
block", and the console gate would escalate any new settle to
acme to the owner instead of settling silently. A future settle
to acme would still succeed at the token level (the token
contract credits its own map), which is exactly why the flag
matters: the tokens would go to an id nobody controls.

## Verdict and score rules

Stated exactly, so they can be audited:

- BLOCK: the blocklist signal is sourced and lists the account.
- ALLOW: account existence is sourced and the account exists,
 prior vault interactions are sourced with at least one
 receipt, and at least two signals are sourced. Score is the
 fraction of sourced signals that are positive (for example
 3/3 = 1.000). The blocklist being unavailable does not by
 itself force WARN: the verdict is about the counterparty's
 sourced history, and the unavailable signal is displayed
 plainly in every report. The blocklist can only block, never
 approve.
- WARN: everything else. The reasons list every failing
 condition. Score is null; no number is invented to fill the
 gap.

## Checks

- Repo-root typecheck clean (with `--typeRoots` and
 `--lib es2022,dom`, the compile), frontend typecheck
 clean, scaffold typecheck clean.
- Conformance 6/6.
- Jest: 95 tests in 10 suites, all passing (ended at
 68 tests in 7 suites); the new suites are reputation,
 snapshot, and live-sources.
- Regressions unchanged: playground, budget, verify-live
 (8 receipts, all true), attack runner dry-run on both vaults.
- Every reputation line in the sample outputs shows a real
 source and timestamp. An unknown address shows WARN
 (insufficient history).
- No build outputs in the PR (checked the PR head tree and
 history, the lesson). No keys, credentials, or key
 files anywhere in the repo, the PR, or any file sent.

## Honest gaps

- **Blocklist unavailable.** No suitable public blocklist source
 for NEAR account ids exists (see the provenance section). The
 signal is shown as unavailable for every checked address, and
 the BLOCK path is proven by tests with a fixture URL, not by a
 live list.
- **Two snapshots.** Two snapshots exist (2026-11-06-053024Z and 2026-11-06-205637Z), so the age
 signal is a lower bound: every account's first seen is the
 first snapshot, 2026-11-06, and no earlier history is on
 record. The output says so.
- **No live ALLOW.** No checked counterparty currently earns
 ALLOW: acme has receipts but does not exist, the agent exists
 but has no receipts, and the unknown address has neither. The
 ALLOW path is proven by the tests, not by a live sample.
- **Console gate not exercised live by frontend.** The console
 needs the agent key, which contract holds, so the live console
 run with the gate was the acceptance audit step.
 The audit ran it live twice on the test vault: the escalate path
 (fresh p7-audit-004, WARN, exit 1, no settle attempted, obligation
 stayed READY) and the approve path with CYNEX_APPROVE_WARN=1
 (fresh p7-audit-005, settle 7HHtxoHX7bvYpRmdm5pyhwhBWWRiCUHiGPMDye8F1oKh,
 PAID, agent balance 0 to 100 exactly, receipt index 7). frontend
 independently re-queried all seven audit transactions and the
 resulting state, 0 mismatches. The gate gap is closed by the audit.
- **No code-change history.** Not claimed, not built; it needs
 an archival source or indexer we are not building.
- **acme does not exist.** See the finding above. Any future
 demo settle to acme should use a recipient account that
 exists, or the owner should decide explicitly with the WARN
 in front of them.

## close confirmation (frontend)

The acceptance audit passed (2026-11-06, 24 itemized checks, no
blocking findings); the record is in the audit file supplied
2026-11-06. frontend independently verified the audit's live claims
via RPC: all seven audit transactions re-queried (0 mismatches),
the resulting state read live (p7-audit-004 READY, p7-audit-005
PAID, test receipt 7 p7-audit-005 amount 100, test policy p6-001
spent 3100, agent balance 100, production unchanged), acme
UNKNOWN_ACCOUNT on three RPC endpoints, and the block 276445952
header timestamp confirming the 65 ns snapshot rounding observation
(same millisecond). The acme finding and the snapshot timestamp
observation are recorded in docs/ledger.md; neither blocks the close of this work. There is no contract change in this work, so there is no
corrections draft to apply.

The frontend side signed in docs/ledger.md on 2026-11-06. The contract-side signature
and merge remain outstanding, so the work is not closed by this
signature.

## Addendum: fifth signal - code-change recency (scorecard brief, 2026-11-06)

After closed, the scorecard brief asked for a fifth
signal: whether the receiver's contract code changed recently.
It is implemented in services/reputation/ and wired into the
same gate. The full delivery record is in
docs/scorecard-code-change-recency.md; this addendum records the
signal in the reputation docs, as the brief requires.

### 5. Code-change recency (snapshot + indexer)

Source: the current code hash from the RPC view_account read
(the same read the existence signal uses) compared to the latest
snapshot for the account in demo/reputation-snapshots/; the
exact age of the current code from the NearBlocks v3 deployments
endpoint (https://api-testnet.nearblocks.io/v3/accounts/{account}/contract/deployments).
The indexer timestamp is used only when it is after the previous
snapshot's fetched_at; an older timestamp means the indexer is
missing the latest deployment and the snapshot window is used
instead, with that stated in the output. The change itself is
always the live RPC code hash against the snapshot, so a stale or
missing indexer cannot hide a change, only widen the recency
window. A change is reported as a window (for example "15.4h
window"), never as a false precise age, unless the indexer gives
an exact deployment timestamp.

Thresholds (named in services/reputation/reputation.ts):
CODE_CHANGE_WARN_WINDOW_MS = 7 days, CODE_CHANGE_BLOCK_WINDOW_MS
= 24 hours. Verdict: no change -> ALLOW; change and the current
code stable longer than 7 days (exact age) -> ALLOW; change
within 7 days, or a wide window -> WARN; change within 24 hours,
or a change with no other history (no prior vault interactions
and first seen at the baseline snapshot) -> BLOCK. No contract
(the default code hash) and first observation are neutral, never
a penalty. The gate refuses on a code-change BLOCK and names the
signal; it escalates on WARN. The signal never writes snapshots;
the reputation-snapshot command records baselines.

This supersedes the "no code-change history" statement in section
2 above, which was the record. The fifth signal is the
sourced code-change tracking that deliberately did not
claim.

Live proof (2026-11-06): the production vault BLOCKed on the real
deployment (old G3Mt2gKs -> new 7PBw1x6H, deployment tx
7HPscpDE6BikHutgALKJP6BDh9LArFS2aZGtHRHTH6ki, age 5.2h); the test
vault was neutral on first observation and ALLOW ("no change")
after a snapshot; the agent (no contract) was neutral and ALLOW
score 1.000. See docs/scorecard-code-change-recency.md for the
verbatim outputs.
