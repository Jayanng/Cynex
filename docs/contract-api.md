# Cynex contract API, frozen in Phase 0

Version: cynex-v1.0.0, schema in schemas/cynex-v1.0.0, test vectors in tests/test-vectors/vectors.json.

This document is the no-clash contract between Lane A and Lane B. Both lanes build against exactly what is written here. A change to anything in this file needs sign off from both lanes, and a change to the schema or the digest needs new test vectors that both languages reproduce byte for byte. Nothing in this file is left vague. Where a value is not yet measured, it is marked TBD in plain sight, and the phase that must fill it is named.

Network: testnet throughout. The settlement digest uses the literal network id testnet, and the digest function rejects any other network id. Mainnet would be a new domain and a new schema version, not a quiet edit here.

## Types

All amounts are u128 base units. Token amounts use 6 decimals, read from ft_metadata, so 250.000000 USDC.e is 250000000 base units. All timestamps and expiries are u64 nanoseconds. Use BigInt for every u64 and u128 value in TypeScript, without exception, because nanosecond timestamps are far above 2 to the power of 53 and a plain JS Number would silently lose precision.

Policy: policy_id (string), owner (account id), token_id (account id), limit (u128), spent (u128), reserved (u128), funded (u128), frozen (bool), version (u64), reconciler (account id or null). Funded is the amount credited to this policy by ft_on_transfer, never the vault account balance. A policy with no reconciler is owner only for timeout and resolution.

Obligation: obligation_id (string), policy_id (string), policy_version (u64, recorded at creation from the policy version at that time), recipient (account id), amount (u128), evidence_type (string), evidence_hash (32 bytes), expires_at_ns (u64), nonce (u64), state (ObligationState), in_flight (bool, true only while a transfer promise is outstanding), transfer_attempt (u64, starts 0, increments by 1 on each dispatch, used to reject stale callbacks), transfer_dispatched_at_ns (u64 or null, set only on dispatch, cleared on callback or resolution), pending_request_id (string or null), pending_digest (32 bytes or null), evidence_requested_at_ns (u64 or null, set only by request_evidence).

Receipt: index (u64), prev_hash (32 bytes), obligation_id (string), recipient (account id), amount (u128), token_id (account id), timestamp (u64), tx_ref (string).

ObligationState: CREATED, EVIDENCE_PENDING, WARN_PENDING, READY, TRANSFER_PENDING, PAID, BLOCKED, CANCELLED, RECONCILIATION_REQUIRED.

EvidenceResult: ALLOWED, WARN, BLOCK.

ReasonCode: RECIPIENT_SUBSTITUTION, TERMS_MISMATCH, NONCE_ALREADY_CONSUMED, BUDGET_EXCEEDED, OBLIGATION_EXPIRED, POLICY_FROZEN, VAULT_STORAGE_EXHAUSTED, EVIDENCE_MISMATCH, EVIDENCE_EXPIRED, UNAUTHORIZED_VERIFIER, TRANSFER_FAILED.

TrustMode: ON_CHAIN_ATTESTATION_VERIFIED, OUTLAYER_CALLBACK, TRUSTED_RELAYER, FIXTURE. A trust mode is never silently downgraded. FIXTURE is only ever a test label, never a production claim.

Token ledger invariant, checked with checked arithmetic and overflow-checks true: spent plus reserved plus amount must be less than or equal to limit, per policy, and also less than or equal to funded, per policy. The vault token ledger for a token is funded as credited deposits across policies for that token, with spent and reserved as allocations against that funded amount, never the vault account balance alone. Available for a policy is funded minus spent minus reserved, and policies sharing a token do not share each other funding. Native NEAR headroom is checked separately and is never summed with token units.

Policy version: version increments only on an owner approved policy change, never on freeze or unfreeze. Freeze sets the frozen flag only, so a freeze and unfreeze cycle does not permanently block obligations created before it. There is no update_policy method in this version. If a policy term must change, freeze the old policy and create a new one, with a new policy_id. Settle checks that the obligation recorded policy_version equals the policy version at settle time, and that the policy is not frozen. A mismatch rejects, because the terms the obligation was created under are no longer the current policy terms.

Nonce: one nonce per obligation, generated at create_obligation, locked on dispatch, not permanently consumed on dispatch. Its job is to make a duplicate settle call detectable as NONCE_ALREADY_CONSUMED even while the first attempt is still in flight, where obligation id plus PAID state alone would not cover that case. The lock is held only while in_flight is true. On a confirmed transfer failure the lock is released, the nonce is reusable for a retry, and the obligation returns to READY settleable. On PAID the nonce is permanently consumed, because PAID is terminal. The nonce does not replace state checks.

Pending evidence fields: pending_request_id is the id the verifier must echo in submit_evidence. pending_digest is the settlement digest that evidence must bind to. Evidence for a different request id or digest is rejected.

## Settlement digest

Domain tag first, as raw ASCII: CYNEX_SETTLEMENT_V1. Then, in this exact order: network_id, vault_id, policy_id, policy_version, obligation_id, token_id, recipient, amount, evidence_type, evidence_hash, nonce, expiry.

Encoding: every string field after the domain tag is a u32 big-endian length prefix followed by UTF-8 bytes. Integers are fixed width and big-endian: policy_version, nonce and expiry are u64, amount is u128. evidence_hash is raw 32 bytes, with no length prefix. The hash is SHA-256 over the whole encoding.

The Rust and TypeScript implementations must reproduce the six vectors in tests/test-vectors/vectors.json byte for byte. Any hash mismatch in either language blocks the freeze. Numbers in the vectors file are strings, so no language may parse them as a floating point number.

## Receipt hash

Receipts are stored in contract state and emitted as NEP-297 events. The receipt hash is a different hash from the settlement digest, for a different purpose, and the two must never be interchanged.

receipt_hash equals SHA-256 over: index as u64 big-endian, then prev_hash as raw 32 bytes, then obligation_id with a u32 big-endian length prefix and UTF-8 bytes, then recipient the same way, then amount as u128 big-endian, then token_id the same way, then timestamp as u64 big-endian, then tx_ref the same way.

The genesis receipt uses prev_hash as 32 zero bytes. Each later receipt uses the previous receipt hash as its prev_hash, so the chain can be replayed from genesis and any gap or tamper shows up.

## Methods

Owner means predecessor equals owner. Owner actions are signed by the owner wallet or CLI, never by the executor host. Reconciler means the account recorded in the policy reconciler field at policy creation, or changed later only by the owner via set_reconciler. If the field is null, only the owner may call timeout and resolution methods. A reconciler may only call the two timeout methods and resolve_settlement, never owner only methods, and never resolve_settlement to PAID, see below.

create_policy(policy_id, owner, token_id, limit, reconciler): caller owner. Creates a policy with spent 0, reserved 0, funded 0, frozen false, version 0, and the given reconciler or null. set_reconciler(policy_id, reconciler): caller owner. Changes only the reconciler field, it does not bump version and does not change terms.

create_obligation(policy_id, obligation_id, recipient, amount, evidence_type, evidence_hash, expires_at_ns): caller owner. Creates an obligation in CREATED, with a fresh nonce, policy_version copied from the policy at creation, in_flight false, and no pending evidence and no evidence request time. The recipient, amount, evidence type, evidence hash and expiry recorded here are the authoritative terms. Nothing the agent later proposes can change them.

freeze_policy(policy_id): caller owner. Sets frozen true only, it does not bump version. New settle calls are blocked while frozen. A transfer already in flight is not un-booked by a freeze. unfreeze_policy(policy_id): caller owner. Sets frozen false only, it does not bump version, and obligations created before the freeze become settleable again if their recorded version still matches and they are in READY.

cancel_obligation(obligation_id): caller owner. Allowed from CREATED, EVIDENCE_PENDING, READY, WARN_PENDING, and RECONCILIATION_REQUIRED. Expiry alone does not auto-cancel, because auto-cancel would hide a missed settlement.

approve_warning(obligation_id): caller owner. Moves WARN_PENDING to READY.

add_verifier(account_id): caller owner. Adds an account to the allowlisted verifier set. The set starts empty, and evidence cannot be submitted until at least one verifier is added.

remove_verifier(account_id): caller owner. Removal takes effect immediately for new submissions, and never retroactively for evidence already accepted.

settle(obligation_id, proposed_recipient, proposed_amount, evidence_ref): caller agent through a scoped function call key, or anyone. This is the checked parameter signature, frozen as written. The vault reads the authoritative terms from state and rejects any mismatch on chain with a reason code. A proposed recipient that differs from the recorded recipient rejects with RECIPIENT_SUBSTITUTION. A proposed amount that differs rejects with TERMS_MISMATCH. An id only settle is not an alternative signature, because a bad payee would never reach the contract and the demo rejection would not be real.

Settle checks, in order, before any promise: obligation state is READY, recorded terms against proposed terms, expiry against expires_at_ns, policy not frozen, obligation recorded policy_version against policy version, nonce not locked, then the budget invariant spent plus reserved plus amount less than or equal to limit and also less than or equal to funded, then native NEAR headroom. Only then does it write reserved plus amount to both the policy and the token ledger, set TRANSFER_PENDING and in_flight true, increment transfer_attempt by 1, set transfer_dispatched_at_ns to the current block timestamp, and lock the nonce, all synchronously before the promise is returned. The callback for that dispatch is created with obligation_id and the new transfer_attempt as its arguments, so a callback for an older attempt can never book a newer one. Waiting until the callback to reserve would let two concurrent settle calls both pass the budget check and both pay.

request_evidence(obligation_id): caller owner. Moves CREATED to EVIDENCE_PENDING only, sets pending_request_id to obligation_id plus a hyphen plus the nonce as a decimal string, sets pending_digest to the settlement digest computed from the recorded terms, recorded policy_version, and nonce, and sets evidence_requested_at_ns to the current block timestamp. No other method sets these fields, and no evidence can be submitted before this call. submit_evidence(request_id, obligation_id, result, proof): caller predecessor in the allowlisted verifier set. This method is deliberately not private, because a relayer or OutLayer must be able to call it. Proof is the hex string of the SHA-256 of the artifact the verifier checked, it must equal the obligation evidence_hash or the call rejects with EVIDENCE_MISMATCH, the request id must equal pending_request_id, the settlement digest for the recorded terms must equal pending_digest, and a result submitted after expires_at_ns rejects with EVIDENCE_EXPIRED. Result is EvidenceResult: ALLOWED moves the obligation to READY, WARN moves it to WARN_PENDING, BLOCK moves it to BLOCKED. A predecessor outside the allowlist rejects with UNAUTHORIZED_VERIFIER.

ft_on_transfer(sender_id, amount, msg): caller the configured token only, through ft_transfer_call. This is the only funding path, see Funding below.

on_transfer_complete(obligation_id, attempt_id): private, called only as the callback on this contract, with callback result Result<(), PromiseError>. ft_transfer returns unit, so the result carries no value. It acts only if the obligation is still TRANSFER_PENDING, in_flight is true, and attempt_id equals the current transfer_attempt, otherwise it returns without changing state, spent, reserved, or receipts, so a late or stale callback cannot double book or undo a resolution. On Ok, reserved minus amount, spent plus amount, state PAID, append receipt, clear in_flight, clear transfer_dispatched_at_ns, nonce permanently consumed. On Err, confirmed failure, tokens did not move, release reservation and lock, unlock the nonce for a retry, clear in_flight, clear transfer_dispatched_at_ns. If the policy is frozen at callback time, a failure moves the obligation to RECONCILIATION_REQUIRED for an owner decision, it does not move to CANCELLED, because cancel_obligation does not allow TRANSFER_PENDING and freeze never un-books an in-flight transfer. A success always finalizes to PAID even if the policy was frozen in the meantime. Failure alone never cancels.

mark_reconciliation_required(obligation_id): caller owner or the policy reconciler. Moves TRANSFER_PENDING to RECONCILIATION_REQUIRED, only after TRANSFER_TIMEOUT_NS has passed since transfer_dispatched_at_ns, and only from TRANSFER_PENDING. It keeps in_flight true, keeps the reservation held, and does not release the nonce lock, so no retry can happen while the original transfer might still succeed. Rejects otherwise. This exists because a NEAR contract cannot move itself on a timer.

mark_evidence_timeout(obligation_id, escalate): caller owner or the policy reconciler. Moves EVIDENCE_PENDING only, and only after EVIDENCE_TIMEOUT_NS has passed since evidence_requested_at_ns. If escalate is false it moves to CANCELLED, if escalate is true it moves to WARN_PENDING. Evidence that never arrives never moves an obligation to READY by default. Evidence that never arrives never moves an obligation to READY by default.

resolve_settlement(obligation_id, outcome, proof): caller owner for PAID, READY, or CANCELLED, or the policy reconciler for READY or CANCELLED only, never for PAID. Resolves RECONCILIATION_REQUIRED only, with in_flight still true and the reservation still held, after a timeout. Proof is the transaction hash of the transfer as seen on chain, recorded as the receipt tx_ref for a PAID resolution, plus the caller attestation that is the on chain call itself. The contract cannot verify a transaction hash alone on NEAR, so for PAID the owner must first have done a live chain read showing the recipient actually received the amount, and that read is a required human step, not a contract check, and the recorded hash lets anyone audit it later. For PAID, the contract books spent plus amount, clears the reservation, clears in_flight, clears transfer_dispatched_at_ns, permanently consumes the nonce, appends the receipt, and moves to PAID. For READY, on a human confirmed failure where the recipient balance shows no such transfer, it releases the reservation, clears in_flight, clears transfer_dispatched_at_ns, unlocks the nonce, and moves to READY, so the obligation is settleable again with a new attempt. For CANCELLED, it releases the reservation, clears in_flight, clears transfer_dispatched_at_ns, retires the nonce so it cannot be reused, and moves to CANCELLED, which is terminal. This is how every async outcome stays resolvable, and it is never a blind retry of a payment.

## Views

get_policy(policy_id): anyone. Returns the Policy.

get_obligation(obligation_id): anyone. Returns the Obligation.

balances(policy_id): anyone. Returns spent, reserved, limit, and native NEAR headroom as separate figures, never summed.

receipts(start, limit): anyone, paginated. Returns receipts in index order, starting at start, up to limit entries. Pagination is what lets cynex-verify replay from genesis without loading the whole chain at once.

state(): anyone. Returns the vault level state needed by the console, including frozen flags and the verifier set size, without leaking keys.

## Timeout constants, frozen

TRANSFER_TIMEOUT_NS equals 600000000000, which is 10 minutes.
EVIDENCE_TIMEOUT_NS equals 3600000000000, which is 1 hour.

These are demo aware by design, not demo shortcuts. The happy path never hits either timeout, so a normal demo runs straight through. A timeout path is demoed with a pre-aged obligation, created an hour or more before the demo, then resolved live in seconds with a real transaction, or with sandbox block time fast forward in tests. Waiting out a timeout live on stage is not the demo plan, and shortening these constants to make that wait bearable would weaken the vault, because a legitimate verifier might not answer in a few minutes and a slow callback could be marked for reconciliation too early.

## Static gas, TBD

Static gas for ft_transfer and for on_transfer_complete is TBD. It will be measured in Phase 2 on testnet and in sandbox, recorded here, and that TBD blocks Phase 2 sign off until it is filled. No gas number in this document is invented, and no gas number from another contract or another chain is borrowed here.

## Funding path, frozen

Funding is by ft_transfer_call through ft_on_transfer only. The owner, or a funder acting for the owner, calls ft_transfer_call on the configured token, sending tokens to the vault with a msg that must be JSON with a fund_policy field naming an existing policy whose token_id equals the predecessor token contract. ft_on_transfer accepts only the configured token, credits funded for that policy by the transferred amount, and returns 0 unused when the msg and policy are valid. If the token is not the policy token, the policy does not exist, or the msg is not valid JSON with a fund_policy field, it returns the full amount as unused, credits nothing, and changes no state. Refunds follow the token contract rule for the returned unused amount.

Plain ft_transfer is explicitly not a funding path and must not be claimed as one. Tokens sent by plain ft_transfer would arrive at the vault account without triggering ft_on_transfer, so they would not be credited to the token ledger, and claiming them as funded would be false. The contract must not treat a plain transfer balance as ledger funds.

Registration, before any settlement: register the vault and each recipient with the token through storage_deposit, one async call each, then confirm with storage_balance_of returning non-null. Registration storage is one time, not per settlement. The agent account also needs gas funding, and the vault needs NEAR for its storage and for 1 yoctoNEAR attached deposits. ft_transfer from the vault attaches 1 yoctoNEAR, as NEP-141 requires.

## Money path, frozen order

Settle validates and reserves synchronously, then dispatches ft_transfer with 1 yoctoNEAR attached and static gas once measured, chained to on_transfer_complete. The callback books the outcome as described above. Freeze and version bumps block new settle calls only. An in-flight success always finalizes, and is never un-booked because policy changed. A bad agent call never auto-freezes a policy, because that would let the agent brick the demo. Storage exhaustion is a clean rejection with VAULT_STORAGE_EXHAUSTED when native headroom is insufficient for 1 yocto plus gas headroom plus the per-settlement receipt storage reserve, never a panic mid-transfer. The per-settlement reserve covers the new receipt only, and its size is measured in Phase 2 and recorded here.

## cynex-verify, frozen surface

cynex-verify is a Lane B deliverable. It replays receipts from genesis through the paginated receipts view, recomputes each prev_hash link, and detects index gaps and hash mismatches. Its CSV columns, frozen here, are: index, prev_hash, obligation_id, recipient, amount, token_id, timestamp, tx_ref, verified_ok.

Acceptance for cynex-verify must include a tampered receipt that it detects, with the tamper output recorded, not only a happy path replay.

## Frontend and CLI integration surface

Lane B builds against this document only. Views consumed: get_policy, get_obligation, balances, receipts with start and limit pagination, and state. Events consumed: NEP-297 receipt events, with the same fields as the stored Receipt. The console must print a live transaction hash and the live chain read that follows it for every action. A console line without either is treated as canned output and fails Lane B acceptance.

TypeScript conformance: frontend/src/cynex-schema.ts mirrors this schema with BigInt, and frontend/src/cynex-schema.test.ts runs the same six vectors through Jest. Jest and its TypeScript tooling are dev dependencies in frontend only, recorded in frontend/package.json, and do not change the near-api-js or near-kit versions.

## What this freeze does not decide

OutLayer callback fields are not frozen here, because they are a Phase 8 spike and are not on the critical path. The blocklist source URL is not frozen here, because it is a Reputation phase decision and must be named there with provenance, never as a bare claim here. The mainnet payout account is not frozen here and must never be invented, it is supplied by the team lead before submission. Exact static gas is TBD above, and blocks Phase 2 sign off until measured.
