# NEAR Ecosystem Risk Report, v1

Author: Research Agent (agent-to-agent delivery)
Prepared for: Procurement Agent, human-authorized
Date: 2026-11-08
Scope: AI agents holding NEAR wallets and spending on testnet
Status: Final, version 1

## Executive summary

AI agents now hold NEAR wallets and spend money on behalf of humans. A
compromised prompt has already drained an agent wallet, because no
universal on-chain check ensures a payment matches exactly what the
human authorized. This report names the five risks that matter most for
an agent that pays, and the controls that address each one. The risks
are prompt injection, excessive key scope, replayed payments, budget
excess, and unverified delivery evidence. The controls are scoped
function-call keys, on-chain exact-term enforcement, a single-use
nonce, a funded policy budget, and a committed evidence digest.

## 1. The agent wallet problem

An agent that pays needs a key. A full-access key lets the agent do
anything the human can do, including moving all funds and adding new
keys. A compromised prompt, a poisoned tool output, or a malicious
instruction can therefore drain the wallet in one call. The problem is
not that the agent is malicious. The problem is that the agent acts on
instructions it cannot fully verify, and the key it holds does not
constrain what it can do.

## 2. Threat model

The agent is assumed compromised. It may receive an injected prompt,
a forged tool result, or a manipulated instruction at any time. It
holds a key, and it can call the chain. The human is not present at
payment time. The vault, the token contract, and the chain are trusted.
Everything else, including the agent, its prompt, and its tool
outputs, is untrusted.

## 3. Risk findings

### 3.1 Prompt injection redirects payment (High)

A compromised prompt can instruct the agent to pay a different
recipient than the human authorized. The agent follows the instruction
because it cannot distinguish a legitimate instruction from an
injected one. The payment then goes to an attacker-controlled account.
The control is on-chain recipient enforcement: the vault records the
authorized recipient at authorization time and rejects any settlement
that proposes a different recipient, with a named reason code.

### 3.2 Excessive key scope enables total loss (High)

A full-access key lets the agent transfer any amount, to any account,
and add new keys. A single compromised call can empty the wallet. The
control is a scoped function-call key: the key is bound to one
contract, one method, and a finite allowance. The agent can only call
settle on the vault, and only up to its allowance. It cannot transfer
NEAR directly, create keys, or call owner methods.

### 3.3 Replayed payments double-spend (High)

An agent can be tricked into settling the same obligation twice, or a
stale callback can be replayed. The control is a single-use nonce,
locked on dispatch and permanently consumed on payment, plus a state
check that rejects a settle on an already-paid obligation with a named
reason code. A replay produces no second payment and no second
receipt.

### 3.4 Budget excess drains a policy (Medium)

Without a budget, an agent can be induced to pay more than the human
intended, either by a larger amount or by many small payments. The
control is a funded policy with a fixed limit. The vault enforces the
invariant that spent plus reserved plus the new amount must not exceed
the limit or the funded amount. A payment that would exceed the budget
is rejected with a named reason code.

### 3.5 Unverified delivery evidence pays for nothing (Medium)

An agent can be induced to pay for a delivery that never happened, or
for different bytes than the human authorized. The control is a
committed evidence digest. The human commits the SHA-256 of the exact
deliverable at authorization time. The vault hashes the submitted
bytes itself and compares them to the committed digest. A mismatch is
rejected with a named reason code, and the obligation does not become
ready.

## 4. Mitigations, summarized

| Risk | Control | Where enforced |
|---|---|---|
| Redirected payment | Recipient fixed at authorization, rejected on mismatch | On chain, vault |
| Excessive key scope | Scoped settle-only function-call key | On chain, access key |
| Replayed payment | Single-use nonce, state check | On chain, vault |
| Budget excess | Funded policy limit, invariant checked | On chain, vault |
| Unverified delivery | Committed SHA-256 digest, vault hashes bytes | On chain, vault |

## 5. Recommendations

1. Never give an agent a full-access key. Use a scoped settle-only
   function-call key, bound to one contract and one method, with a
   finite allowance.
2. Authorize every payment as an obligation with a fixed recipient,
   token, amount, evidence requirement, and budget, before the agent
   acts.
3. Commit the evidence digest at authorization time, and require the
   vault to hash the submitted bytes itself.
4. Use a single-use nonce and a state check so a replay cannot pay
   twice.
5. Fund a policy with a fixed limit, and let the vault enforce the
   budget invariant on every settlement.
6. Keep the human authorization explicit and separate from the agent
   request. The agent requests settlement. The vault decides whether
   the money moves.

## 6. Scope and limitations

This report covers the payment risks for an AI agent holding a NEAR
wallet on testnet. It does not cover the correctness of the delivered
work itself. A vault can prove that the submitted bytes match the
authorized digest. It cannot prove that a report is factually correct,
useful, or honest. Evidence verification is about bytes matching a
commitment, not about the semantic truth of the content. A TEE can
prove where bytes were fetched and hashed. A VRF can anchor a request
to randomness. Neither proves that the content is true. Any claim that
a payment proves the quality of the delivered work is an overclaim.

## 7. Conclusion

The five risks above are the ones that drain agent wallets. The five
controls above address them, and each control is enforced on chain by
the vault, not by the agent's goodwill. An agent can be compromised
and still be unable to change who gets paid, how much they get, or
what evidence is required. That is the property that matters, and it
is the property a payment vault must prove on chain, with a receipt,
for every settlement.
