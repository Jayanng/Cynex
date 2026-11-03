# Cynex threat model (Phase P draft, to be finalized in Phase 0)

Status: none of the mitigations below exist yet. They describe planned vault behaviour, to be built in later phases. Present tense in this draft means planned behaviour, not built behaviour.

## What we protect

Money held for authorized obligations, and the integrity of the
obligation itself: recipient, token, amount, evidence requirement,
budget, and one-time use.

## Attacker model

The agent is assumed compromised. Its prompt, its inputs, and any
data it carries may be attacker controlled. The attacker can submit
any `settle` call the agent's scoped key allows, with any arguments.
The attacker cannot sign as the owner, cannot add keys, and cannot
call other contracts with the agent key.

## Threats and mitigations

- Prompt injection swapping the recipient: rejected on chain by the
  vault reading terms from state and comparing them to proposed
  parameters. Reason code: RECIPIENT_SUBSTITUTION.
- Prompt injection changing the amount: rejected on chain.
  Reason code: TERMS_MISMATCH.
- Replay / double settlement: one-time nonce consumed on first
  settle, plus obligation state. Reason code: NONCE_ALREADY_CONSUMED.
- Over-budget settlement: token invariant spent + reserved + amount
  <= limit, checked arithmetic. Reason code: BUDGET_EXCEEDED.
- Expired obligation: settle after expires_at_ns rejected.
  Reason code: OBLIGATION_EXPIRED.
- Frozen policy: new settle calls blocked while frozen.
  Reason code: POLICY_FROZEN.
- Concurrent settle racing the budget: reservation and lock are
  written synchronously in settle, before any promise is returned.
- Callback failure / ambiguity: confirmed failure releases the
  reservation to READY. A callback that never runs leaves the
  obligation in TRANSFER_PENDING until the timeout method moves it
  to RECONCILIATION_REQUIRED, resolved by the owner or reconciler.
  Never blind-retry a transfer.
- Fake evidence: evidence is accepted only from an allowlisted
  verifier, bound to request id and digest, and checked for expiry.
  Wrong digest, wrong request, expired result, or non-allowlisted
  predecessor are all rejected.
- Storage exhaustion: settlement is refused cleanly with
  VAULT_STORAGE_EXHAUSTED when native NEAR headroom is insufficient,
  instead of panicking mid-transfer.
- Frontend / console spoofing: the console is never the security
  boundary. A rejection that happens only in the UI is a failure.
  Every demo rejection must be a real on-chain rejection with a
  transaction hash and unchanged balances.

## Out of scope / explicitly not claimed

- TEE attestation proves a verifier ran untampered over given inputs.
  It does not prove a real-world delivery happened or that a
  counterparty is honest. OutLayer is a spike, off the critical path.
- Reputation signals are detection, not prevention. Historical
  code-change tracking is not claimed, because it would need an
  archival indexer that is not being built.
- Function-call keys sandbox which method can be called. They do
  not, on their own, limit token spending. The vault does that.

## Assets and trust boundaries

- Owner key: human-held, never on the executor host.
- Agent scoped key: executor host only, receiver = vault,
  methods = [settle], finite allowance, revocable by the owner.
- Verifier set: owner-managed via add_verifier / remove_verifier.
  Evidence from anyone else is rejected.
