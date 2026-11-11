# Cynex MCP Server

The MCP server lets an agent request settlement using only a scoped settle key, while the NEAR vault enforces the human-authorized terms even if the agent is compromised.

It is a thin adapter, not a new trusted party. The vault still enforces everything on chain, the server holds only the agent scoped settle-only key, and the human still authorizes every obligation. The server adds a way in, not a new way to pay. MCP is supporting evidence (proof of agent compatibility), not the headline.

## The six tools

| Tool | Moves funds | What it does |
| --- | --- | --- |
| `cynex_check_counterparty` | No | Reputation check on an account: verdict (ALLOW, WARN, BLOCK), score, reasons, and the five signals. Read-only. |
| `cynex_prepare_obligation` | No | Prepare-only: validates terms against the contract rules and returns the exact `create_obligation` arguments plus a plain-language summary. Output is labeled "Prepared, not authorized or submitted". It submits nothing and holds no owner key. Validation is a check against current state, not a guarantee that a later transaction will succeed. |
| `cynex_request_settlement` | Yes, the only one | Settles a READY obligation with the scoped key: reads the obligation, refuses unless READY, runs the reputation gate (BLOCK refuses, WARN escalates and never approves itself; a WARN is refused by this server in every case and the owner completes the settlement through the console with CYNEX_APPROVE_WARN=1), submits settle, polls until PAID, and returns the receipt index, the settle transaction hash, the PAID state, and the recipient balance delta, which must equal the obligation amount. Rate limited to 5 settles per 60 seconds, at most one attempt per obligation in that window. The limit is per running server process; restarting the server resets it. The hard bound on cumulative gas is the key on-chain allowance. |
| `cynex_get_obligation` | No | Reads one obligation exactly as the chain returns it. Returns not-found, never a guess. |
| `cynex_list_receipts` | No | Lists receipts as read from the chain. The prev_hash chain is verified by the CLI `verify-live`, not by this tool. |
| `cynex_get_policy` | No | Reads a policy, its balances, and the vault state. |

Every tool validates its inputs strictly and refuses anything malformed, with a reason, before it touches the chain. Nothing is mocked or hardcoded: every tool reads real chain state, real obligations, real receipts, and real balances. If a value cannot be read from the chain, the tool returns the error, it does not invent a value.

## What the server never does

It settles READY obligations only in v1. Evidence stays owner-side through the console: the server does not submit evidence, because `request_evidence` and `request_tee_verification` are owner-only and need the owner key and the artifact, which the server does not hold. The demo must still make the evidence requirement visible: show an obligation before readiness, the owner-side evidence workflow, and its resulting READY state, so nobody concludes evidence is decorative. An accepted preimage proves the artifact bytes hash to the committed digest, nothing about the artifact real-world quality.

It cannot change obligation terms, exceed the budget, settle to a different recipient, create keys, transfer NEAR, create obligations, approve warnings, or submit evidence. A compromised agent can still choose when to request a permitted settlement and consume execution resources within the rate limit, but it cannot expand its settlement authority beyond the contract rules.

A reputation refusal is not a vault refusal. Label them precisely: a gate refusal starts with "MCP reputation gate refused the request", and a vault refusal starts with "the vault refused the settle, no funds moved" followed by the vault error and the settle transaction hash. The reputation gate is a check the adapter runs; the vault is the enforcement boundary.

## Runtime checks on every settle

Before submitting, `cynex_request_settlement` re-reads the live state and fails closed on any failure. The checks, in `services/mcp/runtime-checks.ts`, are: the configured RPC URL is a testnet RPC URL and the endpoint live chain id is `testnet`; the vault account exists and its code hash equals the expected deployed hash (`65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6` on both vaults); the signing key is re-checked per settle (function-call key, receiver is the configured vault, methods exactly `["settle"]`, finite positive allowance, and allowance sufficient for one settle at the live gas price); the `getPolicy` and `getObligation` responses echo the requested ids; the budget covers the amount off chain (spent plus reserved plus amount against limit and funded); and the submitted transaction targets the configured vault with method `settle`.

The checks verify the server integrity and the on-chain state, not the caller terms. A changed recipient or a changed amount is deliberately NOT pre-refused off chain: the server passes the caller exact typed values through unchanged, and the vault enforces the match on chain. A submission error is reported as a vault refusal only when the error names a contract refusal; any other submission error with a transaction hash is indeterminate, because the callback that marks PAID can still land after the re-read. See `services/mcp/SECURITY.md` for the layering decision, the full tool security contract, the threat model, and the adversarial matrix.

## Security contract, threat model, and acceptance matrix

- `services/mcp/SECURITY.md`: the tool security contract, the layering decision, the threat model, the adversarial test matrix for the six-tool surface, and the recovery procedure when receipt polling is interrupted.
- `services/mcp/acceptance-matrix.md`: the production acceptance matrix, with the layer and expected outcome per row, the linkage join for receipts, evidence, quote, and VRF result, and the resolved gaps. The runner is `test-client.ts --matrix`.

## Setup

Stdio only for v1, no HTTP. The MCP client spawns the server as a subprocess and talks JSON-RPC over stdin and stdout. Configuration comes from environment variables, the same `CYNEX_*` pattern the console uses:

```sh
CYNEX_VAULT=cynex-testvault.cynexmaster.testnet
CYNEX_AGENT=cynex-agent.cynexmaster.testnet
CYNEX_AGENT_KEY_FILE=/data/home/.near-credentials/testnet/cynex-agent-testvault-fc.json
CYNEX_RPC_URL=https://rpc.testnet.fastnear.com
CYNEX_SNAPSHOT_DIR=/data/workspace/Cynex-mcp/demo/reputation-snapshots
CYNEX_BLOCKLIST_URL=
CYNEX_NEARBLOCKS_URL=
```

`CYNEX_SNAPSHOT_DIR` is the directory of reputation snapshots (unset means no snapshots on record, the age signal is unavailable, never fabricated). `CYNEX_BLOCKLIST_URL` is unset when no blocklist source is configured. `CYNEX_NEARBLOCKS_URL` defaults to the NearBlocks testnet API.

The key file is a near credentials JSON file (`account_id`, `public_key`, `private_key`) or a bare secret key file. It lives outside the repo, never in it, and the key is never printed, logged, or returned in any tool output.

### The test-vault key (one-time setup)

The agent existing scoped key is bound to the production vault only, so it cannot settle on the test vault. The test-vault key is a settle-only function-call key for `cynex-agent.cynexmaster.testnet`, receiver `cynex-testvault.cynexmaster.testnet`, method `settle`, allowance 0.25 NEAR, created with near-cli using the agent full-access key:

```sh
near add-key cynex-agent.cynexmaster.testnet <new-public-key> \
  --contractId cynex-testvault.cynexmaster.testnet \
  --methodNames settle --allowance 0.25 --networkId testnet
```

The key file is saved as `/data/home/.near-credentials/testnet/cynex-agent-testvault-fc.json` on the machine that runs the server. The server never creates keys itself. The key file determines which vault the server can settle on, and the startup check enforces that the two match.

### Startup scope check

Before it serves any tool, the server reads the agent account access key list on chain and checks its own public key: it must be a function-call key, its receiver must equal the configured vault, its methods must be exactly `["settle"]`, and its allowance must be finite and positive. A full-access key, a wrong receiver, broader methods, an unlimited allowance, or a zero allowance refuse to start. The check result is logged to stderr with the public key only, never the secret key.

## Build and run

From `frontend/`:

```sh
npm install
npm run mcp:build
```

`npm run mcp:build` compiles the MCP entry points (`services/mcp/server.ts`, `test-client.ts`, `demo.ts`, `cli.ts`, plus everything they import, and the standalone sandbox runner) with the frontend `tsc` using `frontend/tsconfig.mcp.json`. The config exists for two reasons: the frontend `tsconfig.json` includes only `src` and `scripts`, and the MCP files live outside `frontend/`, so their bare imports (`near-api-js`, `@modelcontextprotocol/sdk`, `zod`) do not resolve from `frontend/node_modules` by file location. The config maps those imports there with `paths`. The build exits 0. The output is `dist-test/services/mcp/server.js`, `test-client.js`, `demo.js`, and `cli.js`.

Run the server as a plain node command over stdio:

```sh
node dist-test/services/mcp/server.js
```

## Reproduction path

### 1. SDK test client first (canonical, deterministic)

```sh
node dist-test/services/mcp/test-client.js
node dist-test/services/mcp/test-client.js --obligation <obligation-id>
```

The test client connects over stdio, lists the six tools, then calls `cynex_check_counterparty`, `cynex_get_policy`, `cynex_list_receipts`, `cynex_get_obligation` (when an id is given), and `cynex_prepare_obligation`, printing each call and response. It never settles unless asked. This is the canonical reproduction path: the same calls a real agent makes, repeatable, with no live agent session in the loop.

### 1a. Acceptance matrix runner

```sh
node dist-test/services/mcp/test-client.js --matrix --matrix-obligation <id> --matrix-out matrix.json
node dist-test/services/mcp/test-client.js --matrix --matrix-settle <id> <recipient> <amount> <evidence-ref> --matrix-out matrix-settle.json
```

The matrix runner runs the rows from `services/mcp/acceptance-matrix.md` and records one result per row with its transaction hash. Rows without a fixture are recorded as skipped, never as passed. Before every live run it prints the exact remaining budget from the policy on chain, and the vault guard refuses mismatched terms against the production vault: production is for the clean happy path and at most one carefully selected security failure, never exploratory testing. The one selected production security failure needs the explicit flag `--allow-production-negative`.

### 2. Claude Code for the real-agent proof

After the SDK client proves the tools behave as documented, a real agent (Claude Code) connects to the same server over stdio, retrieves an obligation, requests settlement, and receives the receipt and balance delta. That session is short and tightly scripted, not an open-ended conversation the submission depends on.

### 3. The negative case (the proof that matters)

A cooperative model declining an instruction is not evidence the vault withstands a compromised agent. The proof needs an actual unauthorized settlement attempt reaching the contract and being rejected. That is the `--settle` form, run only after review, against a READY obligation on the test vault, with a changed recipient:

```sh
node dist-test/services/mcp/test-client.js --settle <obligation-id> <changed-recipient> <amount> <evidence-ref>
```

The changed recipient must read ALLOW from the reputation gate, or the gate refuses first and the vault never sees the attempt. That is a real constraint: ALLOW needs the account to exist and to hold at least one prior vault receipt, and the only recipients with prior receipts on the test vault are the agent (the recorded recipient of the demo obligation) and acme-supplies.testnet, which does not exist on chain. So no usable changed recipient exists today. One-time setup, owner-approved because it spends test budget: settle once through the console with CYNEX_APPROVE_WARN=1 to an existing account, such as cynexmaster.testnet, so it holds a prior receipt and reads ALLOW, then use that account as the changed recipient. A changed recipient that reads WARN is refused by the gate with an escalation, not by the vault, and that is not the proof.

The vault refuses with `ERR_RECIPIENT_SUBSTITUTION`, no funds move, and the refusal (with its transaction hash) is the recorded result. The matching positive case, with the exact recipient and amount, settles to PAID with the receipt index and the balance delta equal to the amount.

## Near-sandbox integration suite

`services/mcp/sandbox.test.ts` re-proves the MCP server on a real local
chain, with no testnet funds and no mocks. It starts a near-sandbox
node (binary downloaded once to `~/.near`, the same place the
near-sandbox Rust crate puts it), deploys the compiled vault wasm and
the minimal test token from `contract/ft-test-token`, funds a policy,
drives four PREIMAGE obligations to READY, and runs all six MCP tools
through the real server in sandbox mode. The happy path must settle
PAID with the exact balance delta and receipt, a changed recipient
must be refused by the vault with `ERR_RECIPIENT_SUBSTITUTION` and a
transaction hash, and a replay must be refused as not READY.

Run it with:

```sh
CYNEX_SANDBOX_TESTS=1 npm run jest:sandbox
```

The default `npm run jest` skips it: the suite takes minutes on
a first run (wasm builds, binary download) and is a local gate, not
part of the fast unit loop. A cold first run can take several
minutes; the Jest timeout is 30 minutes, and the standalone runner
has no timeout. The standalone runner is
`node dist-test/tests/integration/sandbox.js` after `npm run mcp:build`.

Sandbox mode is explicit and loopback only. The server reads
`CYNEX_SANDBOX_RPC_URL` (an `http://127.0.0.1:<port>` URL) and
`CYNEX_SANDBOX_VAULT_CODE_HASH` (the hash of the wasm actually
deployed to the sandbox vault), and the per-settle runtime checks
expect that hash and the chain id from `CYNEX_SANDBOX_CHAIN_ID`.
The chain id is a variable, not a constant, because near-sandbox
randomizes it on every init (`test-chain-XXXXX`); the suite reads it
live from the node it started. A remote URL is refused, and
`CYNEX_RPC_URL` must be unset while sandbox mode is on. The testnet
path is unchanged when the sandbox variables are absent.

One setup step is honest, not hidden: the reputation gate WARNs on a
fresh account (no prior vault interactions), so no MCP settle could
ever succeed on a brand-new recipient. The suite settles twice
directly with the agent key first, bypassing MCP and the gate, so both
recipients hold a prior receipt and the gate can ALLOW them. That
mirrors the testnet matrix one-time setup, where the same bootstrap
runs through the console with `CYNEX_APPROVE_WARN=1`. The bootstrap
settles are recorded as transactions like every other step. The
genesis account's key is read from the node's own
`validator_key.json` after init, because near-sandbox generates a
fresh one on every init.

The vault wasm the suite deploys hashes to
`65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6`, the same hash as the
deployed testnet vaults, so the sandbox run exercises byte-identical
contract code. The suite asserts that hash.

## Local sandbox demo mode

The fastest way to try the server: a local sandbox demo that needs
no testnet account, no key, and no funds. It starts a real
near-sandbox chain on the local machine, deploys the real vault wasm
and the real test token, funds a policy, seeds five obligations, and
serves the real MCP server over stdio against that chain.

From `frontend/`:

```sh
npm run mcp:build && npm run mcp:demo
```

Or, once the package is published:

```sh
npx cynex-mcp --sandbox
```

What it provisions and seeds, all on policy `sandbox-policy-001`
(limit 10000, funded 10000), each amount 100 with PREIMAGE evidence
for the bytes `cynex-sandbox-report-v1`:

| Obligation | Recipient | State at startup | For |
| --- | --- | --- | --- |
| `demo-bootstrap-001` | `recipient.test.near` | PAID (receipt 0) | Prior receipt so the gate can ALLOW the recipient |
| `demo-bootstrap-002` | `recipient2.test.near` | PAID (receipt 1) | Prior receipt so the gate can ALLOW the recipient |
| `demo-ready-001` | `recipient.test.near` | READY | Settle it through MCP |
| `demo-ready-002` | `recipient2.test.near` | READY | Attempt it with a changed recipient |
| `demo-created-001` | `recipient.test.near` | CREATED | Attempt it and see the not-READY refusal |

The two bootstrap obligations are settled directly with the agent
key during provisioning, bypassing MCP and the reputation gate, so
both recipients hold a prior receipt. Without them the gate
correctly WARNs on a fresh account and no MCP settle could ever
succeed. The demo prints a ready summary to stderr with the vault,
the RPC URL, the policy, the five obligations, and the Claude Code
config snippet to paste into your MCP settings:

```json
{
  "mcpServers": {
    "cynex": {
      "command": "node",
      "args": ["<path to>/frontend/dist-test/services/mcp/demo.js"],
      "env": {}
    }
  }
}
```

What the judge can try, through any MCP client:

1. Settle `demo-ready-001` with `cynex_request_settlement` (recipient `recipient.test.near`, amount `100`): PAID, receipt 2, balance delta exactly 100.
2. Settle `demo-ready-002` with a changed recipient (`recipient.test.near` instead of `recipient2.test.near`): the vault refuses with `ERR_RECIPIENT_SUBSTITUTION`, no funds move, the obligation stays READY.
3. Settle `demo-created-001`: the server refuses it as not READY, and no transaction is submitted.

Limits: sandbox only, not testnet, not production. No live funds
move, the agent key is ephemeral and local-only (written to a temp
directory inside the sandbox home and removed on exit), and the
sandbox is removed when the demo stops. The demo keeps running until
it is killed (SIGINT, SIGTERM, or the client disconnecting). The
vault wasm it deploys hashes to
`65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6`, the same hash as the
deployed vaults, and the demo refuses to run on any other hash.

## Layout

- `config.ts`: `CYNEX_*` configuration, key file reading, the testnet RPC allowlist, the expected vault code hash, and the startup scope check.
- `runtime-checks.ts`: the per-settle runtime checks as pure functions over a live state snapshot: network, vault code hash, signing key scope and allowance sufficiency, echo verification, the off-chain budget check, and the settle target assertion.
- `tools.ts`: the six tools, input validation, the prepare-obligation rules, the settle orchestration, and the rate limiter. It reuses `CynexClient`, `evaluateCounterparty` with `makeLiveSources`, `gateSettleOnReputation`, `buildSettle`, and the console `createObligationArgs` and settle gas.
- `server.ts`: the MCP server over stdio, the startup check, the live runtime state reads, the signer wiring, and the single settle submitter (`createSettleWithKey`).
- `demo.ts`: the local sandbox demo mode: provisions a sandbox, seeds five obligations, serves the server over stdio, prints the ready summary to stderr, and stops the sandbox on exit.
- `cli.ts`: the `cynex-mcp` command line: `--sandbox` runs the demo, no flag runs the normal server.
- `sandbox-harness.ts`: the near-sandbox harness and `provisionSandbox()`, shared by the suite and the demo.
- `wasms/`: the prebuilt vault and test-token wasms the demo and the suite deploy when present, so no Rust build is needed to run them.
- `test-client.ts`: the SDK test client, the canonical reproduction path, plus the vault guard, the budget print, and the acceptance matrix runner (`--matrix`).
- `SECURITY.md`: the tool security contract, the layering decision, the threat model, and the adversarial matrix.
- `acceptance-matrix.md`: the production acceptance matrix, with the layer and expected outcome per row.
- `tools.test.ts`, `config.test.ts`, `runtime-checks.test.ts`, `server.test.ts`, `test-client.test.ts`: Jest unit tests, mocked chain reads where the test is about the server own logic, not the chain.
