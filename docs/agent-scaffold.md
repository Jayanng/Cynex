# Agent scaffold

Entry criteria met: frozen and signed, closed 2026-11-03
(Master 1045e53, both sides signed, frontend mirror audited under
section 2.6 and merged as 38e0033).

## Scaffolded in this , frontend

- Frontend: `frontend/src/cynex/client.ts` — read-only view client
 (get_policy, get_obligation, balances, receipts, state, and
 viewAccessKeyList for the key sandbox check) over near-api-js v7
 JsonRpcProvider, finality final. No signing, no transactions.
- Verifier: `services/verifier/verifier.ts` — pure evidence checks
 (hash format, evidence type, expiry) returning EvidenceResult
 and ReasonCode. Scaffold only; the vault is authoritative.
- Reputation: `services/reputation/reputation.ts` — sourced
 signals only; unsourced history maps to WARN, never a guessed
 score. Full engine is , not built here.
- Agent wrapper: `agent/wrapper.ts` — builds only a settle call;
 any other method is rejected in code, matching the scoped
 function-call key (receiver vault, methods settle).
- CLI: `cli/cynex.ts` — `verify-receipts <receipts.json>`,
 replays receipts from genesis with the frozen receipt hash
 formula and exits non-zero on any chain break.
- Integration harness: `tests/integration/sandbox.ts` — looks
 for the real contract contract wasm and exits PENDING (code 2)
 while it is missing. It never runs a mock contract.

## Pending, not faked

- contract skeleton (`contract/`) has not landed on Master yet, so
 the sandbox harness cannot run a real contract, the vault
 cannot be deployed, and the key checks (exactly one
 function-call key plus one offline full-access key, and the
 three forbidden-call errors) cannot be captured yet.
- sign-off (ledger row, both sides) is therefore also
 pending. This scaffold is frontend work in progress, not a
 closed .
