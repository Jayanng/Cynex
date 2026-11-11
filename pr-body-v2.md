## Summary

Implements the v2 frontend packaging mockup on Home, Guided demo, Break it, Docs, and Proof, plus docs/JUDGES.md and a tightened README. Keeps the Swiss International design system exactly (cream #f7f4ee, near-black ink #1f1b16, one orange accent #f3923c, Instrument Sans, JetBrains Mono). No rebrand. Nothing about the build plan and nothing about the NEAR hackathon in frontend page copy.

The v2 mockup is at `cynex-system/frontend-packaging-overhaul/full-site-mockup-v2.html` in the workspace. The implementation spec is `v2-implementation-spec.md` in the same directory.

## What changed

Home: conflict line "The agent asked. The vault said no." above the hero; subhead "Cynex lets a human authorize one exact payment, then the vault pays only that payment and refuses everything else."; expected result stated next to Run it live, labelled honestly as not yet proven live; Judges start here in three steps with times; scripted-path box to receipt 24, usecase-report-002; numbers strip with the 54 percent policy bar, read live; dark refusal band used exactly once, with the four-row itemised refusal breakdown (error codes, live tx, 0 tokens moved); three layers with Check lines; use case cycle and fact card; two command blocks; Honest limits as a named section.

Break it: BreakIt form first (recipient and amount inputs, four attack buttons set the form), TamperPanel moved up and relabelled "Check the chain yourself, in your browser" with a typed amount input, six-ways runner with the 650ms fake delay removed and verdicts labelled recorded, playground matrix, reputation gate and budget, verify command.

Guided demo: five steps, the failure, the refusal, the verify command, and the settle with receipt 12.

Docs: ten sections, all eleven settle codes, the mcp:demo command in the MCP section, the deployment code hash read live, the scorecard with the Contract tests row (142).

Proof: acme warning at the top, claim map (10 rows), build status (5 Done, 2 Partial), Real vs Simulated table (11 rows), Honest limits (6 bullets), attestation bundles unchanged, TamperPanel moved up.

Shared: sticky nav fixed at all widths with the "Testnet live" dot and a nav Run it live button; the strip is one 5-stat component on every page, one set of live reads; TEST_COUNTS is a single source.

## The Run it live button

PR #20 is merged into this branch (merge commit 23114cf). The real button code is in place (web/api/demo-settle.ts backend, LiveDemoButton component), wired in as the Home centerpiece. The button is NOT proven live: the live settle proof is blocked on adding the preview target to CYNEX_DEMO_KEY in Vercel, which needs Johnson's go-ahead. That state is labelled honestly everywhere the button appears (Home, Demo, Proof row 10, JUDGES.md, README, MCP README). No demo-live obligation was settled in this work. No simulated button is presented as real.

## Stale numbers fixed at the source

TEST_COUNTS is now a single source, verified against the fresh Jest run. COMMIT and MASTER_TIP are 4157e8d. docs/contract-api.md now says eleven settle reason codes (was six), and the ERR_INVALID_STATE sentence is correct. The three conflicting p6-001 spent figures in Docs are fixed to the live read (5400 of 10000). The README Status block is dated 11 Nov 2026. All numbers below were re-verified live against testnet RPC on 11 Nov 2026: test receipts 31, production receipts 13, test policy p6-001 spent 5400 of 10000, production policy p5-prod-001 spent 500 of 1000, agent 2700, agent2 100, code hash 65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6 on both vaults, all 10 demo-live obligations READY, acme-supplies.testnet does not exist.

## docs/JUDGES.md and README

New docs/JUDGES.md with the 60-second path, the 5-minute no-wallet path, Do X see Y with exact expected output, and the "What is real and what is simulated" table. README tightened with the same table, a "Judges, start here" line with one URL and one action, and the Do X see Y format.

## Reviewer record

- GLM-5.3 Flash triage: APPROVE WITH FIXES. 5 findings, all minor or nit. One coverage gap disclosed: GLM completed one pass (README, JUDGES, contract-api, MCP README); the page scopes were covered by direct triage verification and by Argon and DeepSeek.
- Gemini 4 Argon main: APPROVE WITH FIXES. 1 major, 5 minor, 4 nit. Six passes over the full diff.
- DeepSeek V4.1 Flash coder and test quality: REQUEST CHANGES. 7 major, 7 minor, 5 nit. Two model findings discarded as false after verification against the code.
- Skills check (near-agent-skills, direct): FAIL, 3 items, all fixed with exact corrections (contract-api.md ERR_INVALID_STATE wording, Proof claim map methods on_tee_result and submit_evidence_preimage). Rust checks not applicable, no Rust file changed.
- GPT-6 Sol phase-gate audit: APPROVE WITH FIXES. 3 minor, all fixed.
- GPT-6.1 Sol final audit: REQUEST CHANGES. 15 findings, 9 major, 6 minor, all fixed except F7 (see below).
- GPT-6.1 Sol targeted re-check of the final fix diff: PARTIALLY FIXED, 16 of 18 fixed. The one not fixed, F14, was then fixed with live data: the tamper fixture is the real live receipt 24 (tx_ref "" is the live value, because callback-booked receipts store an empty tx_ref), and receipt 25 prev_hash was read independently from the chain. The re-check's premise that the fixture should carry the settle tx hash in tx_ref was wrong; putting it there recomputes to a hash that does not match receipt 25.

Every finding was verified true, false, or partial against the branch code before fixing. The unclosed-div claim was false (div closes at Home.tsx:165, build passes). The rate-limit item (in-memory per-instance Map) is a known limitation, honestly disclosed in the code comment; the shared atomic limiter is a Johnson decision and was not built here.

## Build, test, conformance

- Web build: exit 0 (tsc -b plus tsc -p tsconfig.api.json plus vite build).
- Jest, fresh run on the branch head: 475 tests passed, 3 skipped, 478 total; 24 suites passed, 1 skipped, 0 failed. Includes 26 new v2 tests plus 2 F14 provenance tests. The services/executor live-receipts test passed this run (it is flaky, live-RPC dependent).
- Conformance: 6/6.
- Frontend tsc --noEmit: exit 0. API tsc: exit 0.
- 1:1 re-check of the mockup against the implementation: every v2 section present with the right copy and numbers. Zero em dashes in the diff.

## Preview deployment

The Git-triggered preview for this branch is BLOCKED (Vercel Hobby rule: the repo is private and the commits are authored by Muse, not the team owner, same as PR #21). There is no live v2 preview URL to click yet. A working preview needs the owner to create a preview deployment from commit 7675f2fc5f71f6284fbc475f93f54c182d7932cd via the Vercel API, as was done for the PR #21 production fix. The last READY preview is the pre-v2 code at 23114cf. The production deployment (Master 4157e8d) is untouched.

## Still needs Johnson

- The button live proof: add the preview target to CYNEX_DEMO_KEY in Vercel, then one POST to settle demo-live-001. At most one settle in testing; at least 9 READY obligations must remain for judges.
- The merge decision for this PR.
- A live 390px visual check of the mobile header (the header is now a single non-wrapping row at fixed 64px with a measured-height fallback; no reviewer could operate a live browser, so the visual check is unverified).
- Follow-up, not blocking: F7, the stale undated live-proof block and phase framing in docs/contract-api.md (pre-existing documentation, needs a separate doc-cleanup decision).
- Follow-up, not blocking: the README Hosted demo "Keys" paragraph still describes a client-side demo token with 0.05 NEAR allowance, which contradicts the PR #20 server-side key design (0.25 NEAR, Vercel env var).

## Notes

- Untracked files in the worktree (frontend/playground-client.js, services/mcp/cynex-mcp-0.1.0.tgz) predate this work and are not in the PR.
- Disk on jayanng: /data is 95 percent full (0.9 GiB free) as of 11 Nov 2026.
