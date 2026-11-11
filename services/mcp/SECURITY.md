# Cynex MCP Server: Security Contract, Threat Model, and Adversarial Matrix

The MCP server lets an agent request settlement using only a scoped settle key, while the NEAR vault enforces the human-authorized terms even if the agent is compromised. This document is the contract that statement rests on. It covers what the server is allowed to do, which layer refuses what, the threat model, the adversarial cases for the six-tool surface, and the recovery procedure when a settle outcome is unknown.

## 1. Tool security contract

### Allowed contract IDs

The server submits transactions to exactly one contract: the configured vault (`CYNEX_VAULT`). It calls exactly one other contract method: `ft_balance_of` on the policy token, using the `token_id` read from the policy on chain. There is no other contract call in the server. The reputation sources additionally read counterparty account state (existence and code hash) through RPC view calls; those are reads of public account state, not contract calls.

### Network ID

Testnet only. Startup refuses any `CYNEX_RPC_URL` that is not one of the known testnet RPC hosts (`rpc.testnet.fastnear.com`, `test.rpc.fastnear.com`, `rpc.testnet.near.org`). Every settle re-reads the live chain id from the RPC and refuses anything but `testnet`.

### Method names

Exactly one: `settle`. `buildSettle` asserts it, `createSettleWithKey` in `server.ts` is the single choke point where a transaction is signed, and the key itself allows only `settle`. No other method can be submitted through this server.

### Key permissions

The server holds exactly one key, the agent scoped settle-only function-call key. At startup, and re-checked on every settle, the key must be a function-call key, its receiver must equal the configured vault, its methods must be exactly `["settle"]`, and its allowance must be finite, positive, and sufficient for one settle at the live gas price (100 TGas times the current gas price; at the live gas price of 100,000,000 yocto per gas unit that is 0.01 NEAR). A full-access key, a wrong receiver, broader methods, an unlimited allowance, a zero allowance, or an allowance below the settle cost all refuse, and a missing or changed key refuses too.

### Maximum amount

The server refuses any settle amount above the u128 range, and `prepare` refuses any amount above the JS safe integer bound (9,007,199,254,740,991), because the prepared arguments travel as JSON numbers through the console and a larger amount cannot be returned exactly. The effective bound on any settle is the policy remaining budget: spent plus reserved plus the obligation amount (the recorded amount, not the proposed amount) against the limit and the funded amount. The runtime budget check enforces it off chain before submitting, and the vault enforces it on chain.

### Token contract and decimal handling

No tool takes a token input, so a wrong token cannot be injected. The settle reads `token_id` from the policy on chain and uses it for the balance checks. Amounts are decimal strings in the token smallest units, parsed as bigint. JSON numbers, floats, whitespace-padded strings, and scientific notation are refused before any chain read. A leading-zero string such as `"0100"` parses as its numeric value 100; there is no octal interpretation anywhere in the path.

### Obligation identifier format

An obligation id is 1 to 64 characters of letters, digits, dot, underscore, or hyphen. A policy id follows the same format. Anything else is refused before any chain read.

### Evidence size limit

The server never handles artifact bytes. `evidence_ref` is an audit label only, at most 256 characters, and the contract discards it on chain. Evidence itself is owner-side through the console: preimage evidence is at most 64 KiB (`MAX_PREIMAGE_BYTES` 65,536 in the contract, refused with `ERR_EVIDENCE_TOO_LARGE`), and the server settles READY obligations only.

### No arbitrary function calls

The server can submit exactly one method, `settle`, to exactly one contract, the configured vault. It cannot call any other method or any other contract, because the submitter hardcodes both and the key permits nothing else.

### No arbitrary recipient substitution

The server passes the caller proposed recipient through unchanged; it never substitutes a recipient of its own. A changed recipient is the vault business, not the server business: the vault rejects it on chain with `ERR_RECIPIENT_SUBSTITUTION`.

### No raw transaction injection

No tool accepts a signed transaction, a transaction hash to execute, or raw call data. The only transaction the server builds is the `settle` call constructed from the obligation id, the proposed recipient, the proposed amount, and the evidence reference.

### Policy state changes after startup

Policy, obligation, key scope, vault code hash, and gas price are re-read on every settle, so changes after startup are picked up. The vault and the configuration are fixed at startup: a different vault or key file needs a restart.

### RPC endpoint changes

The RPC URL is fixed at startup and never re-validated from the environment; a change requires a restart. What is re-validated on every settle is the live network: the chain id read from the endpoint must be `testnet`, and the vault account and its code hash are read from that same endpoint.

## 2. Layering decision: what the server refuses, what the vault refuses

The server refuses malformed input, a missing obligation, a non-READY obligation, a BLOCK reputation verdict, a WARN verdict (escalated, never approved by the server), an insufficient budget, and any failed runtime integrity check. The vault refuses a changed recipient (`ERR_RECIPIENT_SUBSTITUTION`), a changed amount (`ERR_TERMS_MISMATCH`), a replay (`ERR_NONCE_ALREADY_CONSUMED`), and a budget excess that reaches the chain (`ERR_BUDGET_EXCEEDED`).

The split is deliberate. The server does NOT pre-refuse mismatched terms (a changed recipient or a changed amount). It passes the caller exact typed values through unchanged, and the vault enforces the match on chain. A cooperative refusal by the server is not proof the vault withstands a compromised agent; the proof needs an actual unauthorized settlement attempt reaching the contract and being rejected. The runtime checks verify the server integrity and the on-chain state, not the caller terms.

One interaction between the layers matters for the proof. The reputation gate runs on the proposed recipient, so a changed recipient that reads WARN is refused by the gate before the vault sees it. To produce the vault proof, the changed recipient must read ALLOW, which needs a prior vault receipt. One-time setup, owner-approved because it spends test budget: settle once through the console with `CYNEX_APPROVE_WARN=1` to an existing account, such as `cynexmaster.testnet`, so it holds a prior receipt and reads ALLOW, then use that account as the changed recipient. A changed recipient that reads WARN is refused by the gate with an escalation, not by the vault, and that is not the proof.

The server must not infer or repair financial terms. It passes exact typed values and rejects ambiguity: a JSON number where a decimal string is required, a whitespace-padded amount, and scientific notation are all refused, never coerced.

## 3. Threat model

Assume the MCP client is compromised, because that is the Cynex threat model. The client may be prompt-injected, and it may call any tool with any arguments at any time.

- `cynex_check_counterparty` is read-only. An injected client learns the verdict, which is public information, and no funds move.
- `cynex_prepare_obligation` returns arguments but submits nothing. An injected client can draft a bad obligation, for example to itself or for a huge amount. That draft is harmless on its own, because the owner must review the plain-language summary and sign it with the owner key before anything is created. The risk is the owner signing without reading; the mitigation is the summary and the label "Prepared, not authorized or submitted".
- `cynex_request_settlement` is the one that matters. An injected client can call it, and the defenses are layered. First, the server checks the obligation is READY, runs the runtime integrity checks, and runs the reputation gate, so a known-bad recipient is refused before any chain call, and a WARN is escalated to the owner. Second, the vault checks everything on chain, so a changed recipient is refused with `ERR_RECIPIENT_SUBSTITUTION`, a changed amount with `ERR_TERMS_MISMATCH`, a replay with `ERR_NONCE_ALREADY_CONSUMED`, and a budget excess with `ERR_BUDGET_EXCEEDED`. Third, the rate limit stops a runaway client from burning the agent key gas allowance on failed attempts: at most 5 settle calls per 60 seconds, and at most one attempt per obligation in that window. The worst case that remains is this: an injected client settles an obligation the owner already authorized, exactly as authorized, with the exact recipient, amount, and evidence the owner set. That is not an attack, that is the intended use. The obligation expiry and the vault checks bound it.
- `cynex_get_obligation`, `cynex_list_receipts`, and `cynex_get_policy` are read-only view calls. An injected client learns the vault state, which is public on chain anyway.

Assume the server itself is buggy or compromised as well. The server holds only the scoped settle-only key, never the owner key, and the vault is the enforcement boundary, not the server. The worst a compromised server can do is call `settle` with the scoped key, and the vault still enforces every term on chain before any funds move. The server cannot authorize a payment the human did not authorize, because the obligation terms are set by the owner and enforced on chain, and the server cannot change them. A runaway client cannot drain the vault, because the vault budget check is per policy and on chain. It can only burn the agent key gas allowance on failed settle attempts, and the rate limit bounds that to a handful of attempts per minute, while the finite allowance is the hard bound on cumulative gas.

## 4. Adversarial test matrix

`MCP row` means the case is testable through the server. `Console/contract row` means it cannot occur through MCP, because the server never handles artifact bytes and settles READY obligations only; the case is covered by the console flow or the contract, and the row says so.

| Case | Row | Expected behavior | Test |
| --- | --- | --- | --- |
| Invalid recipient format (`a.-b.testnet`, `NOT AN ACCOUNT`) | MCP row | Refused before any chain read | `tools.test.ts`: prepare bad recipient, settle malformed recipient |
| Implicit 64-hex account as recipient | MCP row | A 64-hex lowercase string IS a valid implicit account id, so the format check accepts it. The defense is the reputation gate (no history reads WARN) and the vault recipient match, not the format check | `tools.test.ts`: `isValidAccountId` accepts 64-hex, rejects 65-hex and uppercase |
| Wrong token | MCP row | Cannot occur: no tool takes a token input. The settle uses the policy token read from chain | `tools.test.ts`: settle uses the policy token from chain |
| Wrong policy ID | MCP row | Prepare refuses a missing policy; settle refuses a missing policy, no submit | `tools.test.ts`: prepare missing policy, settle policy does not exist |
| Wrong obligation ID | MCP row | Get returns not-found, never a guess; settle refuses not-found, no submit | `tools.test.ts`: get not-found, settle obligation missing |
| Amount overflow (above u128) | MCP row | Refused before any chain read | `tools.test.ts`: proposed amount outside the u128 range |
| JSON number amount for settle | MCP row | Refused: the amount must be a decimal string, never coerced | `tools.test.ts`: JSON number amount refuses before any chain read |
| Whitespace-padded amount | MCP row | Refused: `" 100"` is not a decimal string | `tools.test.ts`: whitespace-padded amount refuses |
| Scientific notation amount | MCP row | Refused: `"1e2"` is not a decimal string | `tools.test.ts`: scientific notation amount refuses |
| Leading-zero amount | MCP row | Accepted as its numeric value (`"0100"` is 100); there is no octal path | `tools.test.ts`: leading-zero amount reads as 100 |
| Evidence above 64 KiB | Console/contract row | The server never handles artifact bytes, so it cannot submit oversized evidence. The contract refuses it with `ERR_EVIDENCE_TOO_LARGE` at `submit_evidence_preimage` | Contract: `MAX_PREIMAGE_BYTES` 65,536, covered by the contract tests |
| Empty evidence | Console/contract row | An empty artifact cannot satisfy the committed digest, so the obligation never reaches READY, and MCP settles READY only. An empty `evidence_ref` string is only an audit label and is accepted; it cannot change terms | `tools.test.ts`: empty evidence_ref is only a label |
| Duplicate settlement | MCP row | The second attempt is refused: the rate limiter allows one attempt per obligation per 60 seconds, and after PAID the READY check refuses | `tools.test.ts`: rate limiter, non-READY refusals |
| Two concurrent in-flight settle calls for one obligation | MCP row | Exactly one submit; the other is refused by the rate limiter | `tools.test.ts`: concurrent duplicate settlement submits only once |
| Settlement of a non-READY obligation | MCP row | Refused with the state named, no settle submitted | `tools.test.ts`: CREATED, EVIDENCE_PENDING, PAID refusals |
| Incorrect transaction receiver | MCP row | The submitter targets the configured vault only; any other receiver fails the target assertion before signing | `server.test.ts`: `createSettleWithKey` submits to the configured vault |
| Unsupported method name | MCP row | Only `settle` is ever submitted; any other method fails the target assertion, and `buildSettle` asserts it | `runtime-checks.test.ts`: `assertSettleTarget` refuses `transfer` |
| Stale status between preparation and settlement | MCP row | Prepare validates against current state only and is not a guarantee. Settle re-reads the obligation and refuses unless READY. A change after the READY check is caught by the poll (never PAID, poll-timeout refusal naming the hash) or by the vault replay check | `tools.test.ts`: poll timeout, submission error after PAID |
| RPC timeout followed by retry | MCP row | A failed runtime read refuses fail-closed with a retryable reason and no submit. Retrying the call re-runs every check | `tools.test.ts`: RPC timeout refuses, retry then settles; `runtime-checks.test.ts`: null chain id, null gas price, and null code hash refuse |
| Transaction submitted but receipt polling interrupted | MCP row | Poll-timeout refusal naming the hash; recover manually, see section 5 | `tools.test.ts`: poll timeout names the hash and the recovery tools |
| Prompt injection in evidence or tool output | MCP row | Strings are data, never instructions. A malicious string in a reputation signal or in `evidence_ref` is passed through as data and cannot alter a financial term | `tools.test.ts`: malicious string cannot alter a financial term |

## 5. Recovery procedure: transaction submitted but receipt polling interrupted

When the settle transaction was submitted but the receipt polling was interrupted, the server returns a poll-timeout refusal naming the transaction hash. That refusal is not a success and not a failure. Do not retry blindly.

1. Read the obligation with `cynex_get_obligation`. If it reads PAID, the settle succeeded.
2. List the receipts with `cynex_list_receipts` and find the receipt for the obligation id. If the receipt exists, the settle succeeded.
3. If the obligation does not read PAID and no receipt exists, the transfer did not complete. Wait, then read again, because the callback that marks PAID lands after the transfer. Only once the on-chain state is known should anyone decide whether to retry.
4. There is no idempotency or lookup-by-tx-hash tool. Recovery is through the obligation and receipt reads above, never through the transaction hash alone.

A submission error is reported as a vault refusal only when the error names a contract refusal code, an `ERR_` code. Every check that panics with an `ERR_` code runs before the ft_transfer promise, so the receipt created no promise and no callback can follow it. A bare panic names no check site, so it proves nothing about where the panic happened, and the outcome is reported as unknown. Any other submission error with a transaction hash is indeterminate: the obligation may still read READY only because the callback that marks PAID has not landed yet, so the server reports the outcome as unknown with the hash and the recovery steps above, never as "no funds moved".

## 6. What is still proven live, not by these tests

The unit tests prove the server logic against test doubles. They do not prove a live settlement, a live vault refusal, or a live attestation. Those are proven by the production acceptance matrix in `services/mcp/acceptance-matrix.md`, run by the matrix runner in `test-client.ts --matrix`, with transaction hashes recorded per row. No live settle runs until that matrix runs after the focused re-review.

## 7. Local sandbox demo mode

The demo mode (`services/mcp/demo.ts`, `npx cynex-mcp --sandbox`)
reuses the sandbox checks that already exist, it does not bypass
them. The server runs through the same `config.ts` sandbox path
(loopback RPC URL only, `CYNEX_RPC_URL` unset) and the same
`verifyRuntimeState` per-settle checks, with the expected vault code
hash and chain id read live from the node the demo started. A
replaced vault still fails the per-settle check.

The demo never touches testnet. The RPC URL is the loopback sandbox
node, `CYNEX_RPC_URL` is deleted, snapshots and the blocklist are
empty, and the NearBlocks indexer is pointed at a closed loopback
port (`http://127.0.0.1:1`) so the deployment check fails closed as
unavailable instead of reaching the testnet indexer. An empty
NearBlocks URL would fall back to the testnet indexer, so empty is
not used. The demo obligations exist only on the local chain, and
the demo key is a settle-only function-call key created fresh on
that chain, written to a file inside the sandbox home directory
(outside the repo), and removed with the sandbox on exit. No secret
key is printed, logged, or returned in any tool output; the ready
summary carries account ids and the agent public key only.

The bundled wasms (`services/mcp/wasms/`) are the same builds the
suite deploys, and the demo still verifies the vault wasm hashes to
`65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6` and the test token
wasm hashes to `DVzJjN5Q4niR5vW4iqE2j5z1a3zBgrEb2huiVcFkBu3f`
before deploying either, so a stale or tampered bundle fails fast
instead of serving a different contract. Stdout stays the MCP
JSON-RPC transport: every demo log and the ready summary go to
stderr.
