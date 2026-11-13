# Cynex threat model, final

Status: this is the frozen threat model. It describes the design to implement, as frozen in docs/contract-api.md and schemas/cynex-v1.0.0. It does not claim that a contract is already running. Implementation status is tracked in docs/ledger.md, and a mitigation counts as built only when it is signed off with a passing test.

## What we protect

Money held for authorized obligations, and the integrity of the obligation itself: recipient, token, amount, evidence requirement, budget, and one-time use. If any of those can be changed by the agent or by an attacker who controls the agent prompt, the vault has failed, even if no money has moved yet.

## Attacker model

The agent is assumed compromised. Its prompt, its inputs, and any data it carries may be attacker controlled. The attacker can submit any settle call the agent scoped key allows, with any arguments. The attacker cannot sign as the owner, cannot add keys, and cannot call other contracts with the agent key. The owner key is human held and never on the executor host. The verifier set is owner managed, and evidence from anyone outside it is rejected.

## Threats and frozen mitigations

Prompt injection swapping the recipient: rejected on chain by the vault reading terms from state and comparing them to the proposed recipient in settle. Reason code: RECIPIENT_SUBSTITUTION. The check lives in the contract, not in the console, so a UI that hides the swap does not change the outcome.

Prompt injection changing the amount: rejected on chain the same way. Reason code: TERMS_MISMATCH.

Replay and double settlement: a PAID settle permanently consumes the nonce. A confirmed callback failure returns the obligation to READY and keeps it retryable up to MAX_TRANSFER_ATTEMPTS (3). A READY resolution marks the first dispatch consumed and cannot be settled again. Cancellation from RECONCILIATION_REQUIRED retires the nonce. A duplicate or otherwise consumed attempt rejects with NONCE_ALREADY_CONSUMED, including while the first attempt is still in flight.

Over-budget settlement: the token invariant spent plus reserved plus amount less than or equal to limit, checked with checked arithmetic. Reservation happens synchronously in settle, before any promise is returned, so two concurrent settle calls cannot both pass the budget check and both pay. Reason code: BUDGET_EXCEEDED.

Expired obligation: settle after expires_at_ns rejects with OBLIGATION_EXPIRED and leaves the obligation in its current state. Expiry alone does not auto-cancel, because auto-cancel would hide a missed settlement. The owner may then cancel from the states listed in the contract API.

Frozen policy: new settle calls are blocked while frozen, with POLICY_FROZEN. A freeze never un-books a transfer already in flight, and a bad agent call never auto-freezes a policy, because that would let the agent brick the demo.

Callback failure and ambiguity: a confirmed failure in on_transfer_complete releases the reservation and returns the obligation to READY, unless the policy is frozen, and after 3 confirmed failures it escalates to RECONCILIATION_REQUIRED instead of returning to READY. A callback that never runs leaves the obligation in TRANSFER_PENDING until the owner or reconciler calls mark_reconciliation_required after TRANSFER_TIMEOUT_NS, which is 600000000000 nanoseconds, and the owner then resolves it with resolve_settlement. A transfer is never blind-retried.

Fake evidence: evidence is accepted only from an allowlisted verifier, bound to pending_request_id and pending_digest, and checked for expiry. Wrong digest, wrong request, expired result, or a non-allowlisted predecessor are all rejected, with EVIDENCE_MISMATCH, OBLIGATION_EXPIRED, EVIDENCE_EXPIRED, or UNAUTHORIZED_VERIFIER as appropriate. Evidence that never arrives never moves an obligation to READY by default. After EVIDENCE_TIMEOUT_NS, which is 3600000000000 nanoseconds, the owner or reconciler calls mark_evidence_timeout.

Storage exhaustion: settlement is refused cleanly with VAULT_STORAGE_EXHAUSTED when native NEAR headroom is insufficient for 1 yocto plus gas headroom plus the per-settlement receipt storage reserve, instead of panicking mid-transfer. Registration storage is one time, not per settlement.

Funding confusion: funding is by ft_transfer_call through ft_on_transfer only. Plain ft_transfer is explicitly not a funding path, so tokens sent that way are not credited to the token ledger and must not be claimed as funded. This stops a quiet mismatch between the token balance on the account and the ledger the vault actually enforces.

Frontend and console spoofing: the console is never the security boundary. A rejection that happens only in the UI is a failure. Every demo rejection must be a real on-chain rejection with a transaction hash and unchanged balances, and every console action must print a live transaction hash and the live chain read that follows it.

Receipt tampering: receipts form a hash chain from genesis, with 32 zero bytes as the genesis prev_hash, and cynex-verify replays them through the paginated receipts view. A gap or a mismatched hash is detected, and acceptance for cynex-verify must include a tampered receipt that it catches.

Key theft: the agent holds only a scoped function call key, receiver set to the vault, methods set to settle, with a finite allowance covering gas and attached deposits. A leaked scoped key can be revoked by the offline owner full-access key. The gate that matters is that the agent only holds the scoped key on the executor host, not a claim that the account has no full-access key at all.

## Out of scope, explicitly not claimed

TEE attestation proves a verifier ran untampered over given inputs. It does not prove a real-world delivery happened or that a counterparty is honest. OutLayer is integrated as an off-chain TEE provenance path. Its callback fields are documented in the contract API, but the vault does not verify the TDX quote on chain and OutLayer is not an on-chain settlement trust gate.

Reputation signals are detection, not prevention. Code-change recency is implemented as the fifth reputation signal (see `docs/scorecard-code-change-recency.md`): a recent vault code change blocks settlement until the code has aged. Signals that are produced must show source and timestamp, unknown maps to WARN for insufficient history, never to a guessed score, and a signal that cannot be sourced is shown as unavailable, not fabricated.

Function-call keys sandbox which method can be called. They do not, on their own, limit token spending. The vault does that.

## Assets and trust boundaries

Owner key: human held, never on the executor host.
Agent scoped key: executor host only, receiver equals vault, methods equal settle, finite allowance, revocable by the owner.
Verifier set: owner managed through add_verifier and remove_verifier. Evidence from anyone else is rejected.
Token ledger: authoritative state in the vault. The token balance on the account is not, on its own, the ledger.
Receipt chain: authoritative history, replayable from genesis by anyone through public views.
