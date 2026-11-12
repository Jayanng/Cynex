/* Cynex web, constants and ground-truth data.
   Ported 1:1 from the static showcase (index.html, PR #12, fixed).
   No values are invented; live numbers are read from the chain at runtime. */

export const RPC_URL = "https://test.rpc.fastnear.com";
export const VAULT_PROD = "cynex-vault.cynexmaster.testnet";
export const VAULT_TEST = "cynex-testvault.cynexmaster.testnet";
export const AGENT = "cynex-agent.cynexmaster.testnet";
export const AGENT2 = "cynex-agent2.cynexmaster.testnet";
export const TOKEN = "usdc.fakes.testnet";
export const REPO = "https://github.com/Jayanng/Cynex";
export const COMMIT = "a79e426";
export const MASTER_TIP = "e677e53"; // master tip the Docs badges were verified against; bump on release. COMMIT stays pinned as the playground snapshot provenance.
export const TEST_COUNTS = "640 tests passed, 3 skipped, 643 total"; // single source for the Jest counts shown on the site; update README.md by hand to match. Update from a fresh run of: NODE_OPTIONS=--experimental-vm-modules npx jest --roots src ../services --runInBand (from frontend/).
export const ACME = "acme-supplies.testnet";
export const DEMO_POLICY_ID = "p6-001";
export const DEMO_POLICY_PROD_ID = "p5-prod-001";

/* Single source of truth for explorer URLs: lib/links.tsx reuses
   these builders, so the two cannot drift apart again. EX_TX stays
   /txns/; EX_ADDR is /address/, the NearBlocks account path. */
export const EXPLORER_BASE = "https://testnet.nearblocks.io";
export const EX_TX = (h: string) => EXPLORER_BASE + "/txns/" + h;
export const EX_ADDR = (a: string) => EXPLORER_BASE + "/address/" + a;

/* Demo token (live mode), KEY NOT YET SUPPLIED.
   Johnson creates this key (via Muse) on the TEST vault only and sends
   it separately. Until every field below is filled in by hand from
   Johnson's message, live mode stays DISABLED and the page uses the
   simulated panel only. NEVER paste the existing executor key, the owner
   key, or any full-access key here. The demo key is: fresh, settle-only
   on the test vault, allowance 0.05 NEAR, testnet only, low value.
   The two obligation ids must also come from Johnson:
   - readyObligationId: a READY demo obligation (evidence submitted,
     never settled) for the recipient/amount attacks. p10-demo-attack-001
     is PAID, so it would return NONCE_ALREADY_CONSUMED, not the
     recipient/amount codes, do NOT use it for those attacks.
   - pendingObligationId: a CREATED / EVIDENCE_PENDING demo obligation
     (no evidence submitted) for the remove-evidence attack. */
export const DEMO_TOKEN = {
  enabled: false,
  accountId: "",
  publicKey: "",
  privateKey: "",
  readyObligationId: "",
  pendingObligationId: "",
};
export const DEMO_ATTACKER = "cynexmaster.testnet"; // recipient proposed in the recorded refusal tx EiBHjMBq; the vault refuses before any transfer
export const DEMO_LIVE_LABEL =
  "Demo key, testnet only, scoped to settle on the test vault, low allowance. This key can only attempt settles; the vault decides.";

/* Copy registry (commands with quotes live here) */
/* The CLI is compiled TypeScript, run as node frontend/dist-test/cli/cynex.js
   <command> from the repo root (README.md:519-522). There is no cynex-verify
   binary and no --vault or --rpc flag for verify. */
export const CP: Record<string, string> = {
  verify:
    "node frontend/dist-test/cli/cynex.js verify-live cynex-testvault.cynexmaster.testnet",
  verifyCsv:
    "node frontend/dist-test/cli/cynex.js verify --csv cynex-testvault.cynexmaster.testnet > receipts.csv",
  verifyProd:
    "node frontend/dist-test/cli/cynex.js verify-live cynex-vault.cynexmaster.testnet",
  mcpdemo:
    "cd frontend && npm run mcp:build && npm run mcp:demo",
  curlProd:
    'curl -s https://test.rpc.fastnear.com -H "content-type: application/json" -d \'{"jsonrpc":"2.0","id":"1","method":"query","params":{"request_type":"view_code","finality":"final","account_id":"cynex-vault.cynexmaster.testnet"}}\'',
  coldrun:
    "git clone https://github.com/Jayanng/Cynex.git\ncd Cynex/frontend\nnpm install\nnpm run typecheck\nNODE_PATH=$PWD/node_modules npm run jest  # " + TEST_COUNTS + "\n# builds console, CLI, verifier, executor, reputation: exits 2 with 5 known near-api-js type errors (README.md:506-509), dist-test/ still works\nnpx tsc --outDir dist-test --rootDir .. --module NodeNext --moduleResolution NodeNext --target ES2022 --strict --skipLibCheck --esModuleInterop --lib es2022,dom --typeRoots ./node_modules/@types ../agent/console.ts ../cli/cynex.ts ../services/verifier/verifier.ts ../services/verifier/verify.test.ts ../services/executor/executor.ts ../services/executor/executor.test.ts ../services/console/console.test.ts ../services/reputation/reputation.ts ../services/reputation/snapshot.ts ../services/reputation/live-sources.ts || true  # tsc exits 2 with 5 known near-api-js type errors (README.md:506-509); dist-test/ still works\ncd ..\nnode frontend/dist-test/cli/cynex.js verify-live cynex-testvault.cynexmaster.testnet",
  att13324:
    "outlayer-verify bundle docs/attestation-proofs/attestation-proof-prod-tee-001.json --offline",
  att10640:
    "outlayer-verify bundle docs/attestation-proofs/attestation-proof-10640.json --offline",
  att11912:
    "outlayer-verify bundle docs/attestation-proofs/attestation-proof-11912.json --offline",
  att13040:
    "outlayer-verify bundle docs/attestation-proofs/attestation-proof-13040-mainnet-collateral.json --offline",
};

/* Icon paths (Feather-style, stroke icons) */
export const ICON_PATHS: Record<string, string> = {
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  ext: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  x: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};

/* Ground-truth record, live demo, already executed on the test vault.
   Historical facts (tx hashes), not live numbers. */
export interface GuidedAttempt {
  label: string;
  verdict: string;
  code?: string;
  tx: string;
  note?: string;
}
export interface GuidedStep {
  n: string;
  anchor: string;
  cls: string;
  title: string;
  ob: string;
  desc: string;
  terms: [string, string][];
  attempts: GuidedAttempt[];
  delta: string;
  receipt: number;
}
export const GUIDED: GuidedStep[] = [
  {
    n: "1",
    anchor: "step1",
    cls: "",
    title: "Happy path, PREIMAGE evidence",
    ob: "p10-demo-preimage-001",
    desc: "The agent delivers the delivery note and presents its SHA-256 preimage. The vault hashes the bytes itself, compares them to the digest committed at creation, enforces the fixed terms, and settles 100 base units (0.0001 test USDC) to the agent. No human in the loop: the contract checked everything.",
    terms: [
      ["recipient", AGENT],
      ["token", TOKEN],
      ["amount", "100 base units (0.0001 test USDC)"],
      ["nonce", "1001"],
      ["evidence", "PREIMAGE, SHA-256(delivery note demo-delivery-note-001:p10-demo-preimage-001:100)"],
    ],
    attempts: [
      {
        label: "settle · correct terms · valid preimage",
        verdict: "PAID",
        tx: "3Gp3J2zZCKrne1PamDVf6PgXHk4qGc3a58GBvoFcNhrZ",
        note: "receipt #11",
      },
    ],
    delta: "agent 700 → 800 base units",
    receipt: 11,
  },
  {
    n: "2",
    anchor: "step2",
    cls: "attack",
    title: "Attack, substituted terms, then a replay",
    ob: "p10-demo-attack-001",
    desc: "A prompt-injected agent tries to pay the wrong recipient, then the wrong amount. The vault refuses both, the terms are on-chain and cannot be argued with. The correct settle succeeds, and the immediate replay is refused as a double-pay.",
    terms: [
      ["recipient", AGENT],
      ["token", TOKEN],
      ["amount", "100 base units (0.0001 test USDC)"],
      ["nonce", "1002"],
      ["evidence", "PREIMAGE"],
    ],
    attempts: [
      {
        label: "settle · recipient swapped to a different account",
        verdict: "REFUSED",
        code: "ERR_RECIPIENT_SUBSTITUTION",
        tx: "AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S",
      },
      {
        label: "settle · amount inflated 100 → 200 base units",
        verdict: "REFUSED",
        code: "ERR_TERMS_MISMATCH",
        tx: "43YaxJVggxuZ3E25WfjzkgGBsGAqLrj8nwdUU9RLAQRy",
      },
      {
        label: "settle · correct terms",
        verdict: "PAID",
        tx: "Ho97UjQEDDfe7Go66uHrVSJvbF8narZJ2YBH3hWarxi",
        note: "receipt #12",
      },
      {
        label: "settle · replay of nonce 1002",
        verdict: "REFUSED",
        code: "ERR_NONCE_ALREADY_CONSUMED",
        tx: "AwzQS7XsuGSYnPmvd5jFJzPDs3WDc2gRgSbW3smWq1Cs",
      },
    ],
    delta: "agent 800 → 900 base units",
    receipt: 12,
  },
  {
    n: "3",
    anchor: "step3",
    cls: "",
    title: "TEE evidence, OutLayer, VRF-bound",
    ob: "p10-demo-tee-001",
    desc: "Evidence is produced inside a TEE and verified through OutLayer. The VRF signature is bound to the pending request, so it cannot be replayed against a different obligation. The VRF signature does not prove TEE execution.",
    terms: [
      ["recipient", AGENT],
      ["token", TOKEN],
      ["amount", "100 base units (0.0001 test USDC)"],
      ["nonce", "1003"],
      ["evidence", "TEE, OutLayer request 11912 · 300 TGas console caller gas"],
    ],
    attempts: [
      {
        label: "tee_request · OutLayer verification · 300 TGas caller gas",
        verdict: "OK",
        tx: "5Xvu78qxd9NfgJzRBeyvdQXnqK8sLfSmzrfVC5dgDK68",
        note: "OutLayer 11912",
      },
      {
        label: "settle · VRF bound to the pending request",
        verdict: "PAID",
        tx: "3QV2aCRSiJ8ZYqLECCpK6ZkXpYE4AdxJzmyP3JTaDqWB",
        note: "receipt #13",
      },
    ],
    delta: "agent 900 → 1000 base units",
    receipt: 13,
  },
];

/* Playground matrix: the 18 obligations from demo/playground-obligations.json
   (9 production, 9 test vault), with live states read from chain 2026-11-10,
   plus 13 pg-* scenario fixtures, labelled as fixtures. The two impossible
   fixture rows are gone: settle has no token argument, so no token row can
   return ERR_TERMS_MISMATCH, and a bad VRF returns no error code at all.
   Replaced by a live fetch of the repo file when reachable. Read-only. */
export const PLAYGROUND_SOURCE_INITIAL =
  "bundled snapshot · demo/playground-obligations.json @ master " + COMMIT + " · live states read 2026-11-10";

/* Attestation bundles, in repo under docs/attestation-proofs/. Tx hashes from README.md:311-318. */
export interface Bundle {
  id: string;
  req: string;
  key: string;
  title: string;
  vault: string;
  top?: boolean;
  note: string;
  tx: string;
  file: string;
}
export const BUNDLES: Bundle[] = [
  {
    id: "prod-tee-001",
    req: "13324",
    key: "att13324",
    title: "Production TEE proof",
    vault: VAULT_PROD,
    top: true,
    note: "Production vault TEE attestation, OutLayer request 13324.",
    tx: "9rLoxGuEFYSLWPJ8Jc2cv1krSLtummWszASUcX7kzuxZ",
    file: "attestation-proof-prod-tee-001.json",
  },
  {
    id: "10640",
    req: "10640",
    key: "att10640",
    title: "Attestation bundle 10640",
    vault: VAULT_TEST,
    note: "OutLayer request 10640.",
    tx: "DusvRubtcAnPyyB1BQYkf66nA8Vy3eSdZVAmdviuPpUu",
    file: "attestation-proof-10640.json",
  },
  {
    id: "11912",
    req: "11912",
    key: "att11912",
    title: "Attestation bundle 11912",
    vault: VAULT_TEST,
    note: "OutLayer request 11912, used by demo step 3 (p10-demo-tee-001).",
    tx: "5Xvu78qxd9NfgJzRBeyvdQXnqK8sLfSmzrfVC5dgDK68",
    file: "attestation-proof-11912.json",
  },
  {
    id: "13040",
    req: "13040",
    key: "att13040",
    title: "Attestation bundle 13040",
    vault: VAULT_TEST,
    note: "OutLayer request 13040. Verifies offline with mainnet collateral bundled in the file, because the testnet collateral archive lags (README.md:360-368).",
    tx: "EYyyLXCLusX66ktWH4VyZWpP3UbkrcjZGf3MnX6Dfc6p",
    file: "attestation-proof-13040-mainnet-collateral.json",
  },
];

/* Break-it panel scenarios */
export interface BreakItScenario {
  key: string;
  label: string;
  code: string;
  tx: string | null;
  attempt: string;
  why: string;
  live: { obligation: string; recipient: string; amount: string; expectState: string };
}
/* The authorized terms the BreakIt form is judged against, one source so
   the form logic, the authorized line, and the terms grid cannot drift.
   Obligation p10-demo-attack-001 on the test vault: recipient
   cynex-agent, 100 base units, nonce 1002. */
export const AUTHORIZED_TERMS = {
  obligation: "usecase-report-002",
  recipient: AGENT,
  amount: "100",
  nonce: 30002,
} as const;

/* The locked terms of the ten demo-live obligations, the target of a
 * live Break it attack. Every demo-live obligation has the same
 * terms: recipient cynex-agent2, 100 base units, on the test vault.
 * Verified live on chain 2026-11-12. A live attack tampers with
 * these terms on a READY demo-live obligation; the vault refuses
 * before any transfer. */
export const DEMO_LIVE_TERMS = {
  recipient: "cynex-agent2.cynexmaster.testnet",
  amount: "100",
} as const;

export const BREAK_IT: BreakItScenario[] = [
  {
    key: "recipient",
    label: "Change the recipient",
    code: "ERR_RECIPIENT_SUBSTITUTION",
    tx: "EiBHjMBqZfBLZB33H4odbBfskGbVCX1Jor422t5S1cpX",
    attempt: "settle usecase-report-002 to a different recipient · 100 base units (0.0001 test USDC) · nonce 30002",
    why: "The obligation fixes the recipient on chain. The settle call asked for a different recipient, so the vault refused before moving anything.",
    live: { obligation: "ready", recipient: DEMO_ATTACKER, amount: "100", expectState: "READY" },
  },
  {
    key: "amount",
    label: "Change the amount",
    code: "ERR_TERMS_MISMATCH",
    tx: "2NaWqCYiUnh9DMhRCR6JVSDQ3R7yD26U8Auf3qEer91f",
    attempt: "settle usecase-report-002 for 200 base units (0.0002 test USDC) instead of the fixed 100 base units (0.0001 test USDC) · nonce 30002",
    why: "The obligation fixes the amount at 100 base units (0.0001 test USDC). The settle asked for 200 base units (0.0002 test USDC), so the terms did not match and the vault refused.",
    live: { obligation: "ready", recipient: AGENT, amount: "200", expectState: "READY" },
  },
  {
    key: "replay",
    label: "Replay a nonce",
    code: "ERR_NONCE_ALREADY_CONSUMED",
    tx: "hG6uhpePR9ZcvCZXZprpXa8rvbAGGQPxD4ZyMpP91F6",
    attempt: "settle usecase-report-002 again with nonce 30002, after receipt #24 already consumed it",
    why: "Nonce 30002 was consumed by receipt #24. Reusing it is a double-pay, so the vault refused.",
    live: { obligation: "usecase-report-002", recipient: AGENT, amount: "100", expectState: "PAID" },
  },
  {
    key: "evidence",
    label: "Remove the evidence",
    // The settle-before-evidence refusal was executed on usecase-report-002 as tx BRXXhezVxYvze3imNHkrShnS8ujUvsShy4f3GtgwpCgQ; the ERR_INVALID_STATE code is inferred from the contract check order, not read directly from the chain.
    code: "ERR_INVALID_STATE",
    tx: "BRXXhezVxYvze3imNHkrShnS8ujUvsShy4f3GtgwpCgQ",
    attempt: "settle usecase-report-002 with no evidence presented, before evidence was submitted",
    why: "On this obligation, usecase-report-002, settle was attempted before evidence was submitted, so it was not READY and the vault refused with ERR_INVALID_STATE. The code is inferred from the contract check order. The obligation is now PAID as receipt 24, so a live settle today returns ERR_NONCE_ALREADY_CONSUMED first, because the nonce check runs before the state check.",
    live: { obligation: "pending", recipient: AGENT, amount: "100", expectState: "NOT_READY" },
  },
];

/* ---- Concrete use case (docs/use-case-demo-script.md) ---- */
export const USECASE = {
  story:
    "A human authorizes a procurement agent to pay a research agent exactly for one named report, and the agent pays on delivery. The same obligation is carried through the console, the MCP transcript, the attack log, the receipt, and the proof page.",
  artifact: "demo/near-agent-risk-report-v1.md",
  artifactBytes: 6421,
  artifactDigest: "2a8bddcb3b001fd9051ec68757b8a113fa355cfe619f07882ac622721431ebc9",
  procurementAgent: AGENT,
  researchAgent: AGENT2,
  owner: "cynexmaster.testnet",
  amount: "100 base units (0.0001 test USDC)",
  obligations: [
    { id: "usecase-report-001", receipt: 23, note: "First run of the scenario, same artifact and amount, nonce 30001. Agent balance 2000 to 2100 base units, policy spent 4600 to 4700." },
    { id: "usecase-report-002", receipt: 24, note: "Canonical attack proof, nonce 30002. One NEAR account, cynex-agent.cynexmaster.testnet, in both agent roles, so this run proves the vault controls, not payment between two distinct accounts. Agent balance 2100 to 2200 base units, policy spent 4700 to 4800." },
    { id: "usecase-report-003", receipt: 28, note: "Two-agent run, nonce 30003. The procurement agent requests settlement and the research agent, cynex-agent2.cynexmaster.testnet, receives exactly 100 base units. Research agent balance 0 to 100 base units, procurement agent unchanged at 2500, policy spent 5100 to 5200." },
  ],
  attacks: [
    { label: "settle before evidence", code: "ERR_INVALID_STATE", tx: "BRXXhezVxYvze3imNHkrShnS8ujUvsShy4f3GtgwpCgQ" },
    { label: "changed recipient", code: "ERR_RECIPIENT_SUBSTITUTION", tx: "EiBHjMBqZfBLZB33H4odbBfskGbVCX1Jor422t5S1cpX" },
    { label: "changed amount", code: "ERR_TERMS_MISMATCH", tx: "2NaWqCYiUnh9DMhRCR6JVSDQ3R7yD26U8Auf3qEer91f" },
    { label: "replay", code: "ERR_NONCE_ALREADY_CONSUMED", tx: "hG6uhpePR9ZcvCZXZprpXa8rvbAGGQPxD4ZyMpP91F6" },
    { label: "correct settle", code: "PAID", tx: "2VLL134m83x5fWZLr2qBbPkjJ7gL9YR7V7U9eur7qoVC" },
  ],
};

/* ---- MCP server (services/mcp/tools.ts:213-243) ---- */
export const MCP_TOOLS: [string, string, boolean][] = [
  ["cynex_check_counterparty", "Reputation check: verdict, score, reasons, five signals. Read-only.", false],
  ["cynex_prepare_obligation", "Prepare, not authorized or submitted. Validates terms and returns the exact create_obligation arguments plus a plain-language summary. Submits nothing and holds no owner key.", false],
  ["cynex_request_settlement", "Settles a READY obligation with the agent scoped settle-only key. Refuses unless READY, refuses a BLOCK reputation verdict, escalates a WARN verdict to the owner. The only tool that moves funds.", true],
  ["cynex_get_obligation", "Read an obligation. Read-only.", false],
  ["cynex_list_receipts", "Read receipts. Read-only. The prev_hash chain is verified by the CLI verify-live, not by this tool.", false],
  ["cynex_get_policy", "Read a policy. Read-only.", false],
];
export const MCP_RUN = "node dist-test/services/mcp/server.js";
export const MCP_DEMO_RUN = "cd frontend && npm run mcp:build && npm run mcp:demo";
export const MCP_FACTS =
  "Six tools, one moves funds. Stdio only for v1, no HTTP: the MCP client spawns the server as a subprocess and talks JSON-RPC over stdin and stdout. At startup the server verifies its key scope on chain and refuses to start on a full-access key, a wrong receiver, or broader methods: the key must be a function-call key, receiver must equal the vault, methods must be exactly [settle], allowance finite and positive. Every cynex_request_settlement call re-runs runtime checks first: testnet chain id, vault code hash, signing key re-check, allowance against the live gas price, echo checks on getPolicy and getObligation, budget check, settle target assertion. Threat model assumes a compromised client. Adversarial matrix: 21 rows (services/mcp/SECURITY.md). Acceptance matrix: 14 rows, M1 to M14 (services/mcp/acceptance-matrix.md). A reputation refusal is not a vault refusal.";

/* ---- Agent console and CLI (agent/console.ts, cli/cynex.ts:1079-1090) ---- */
export const CONSOLE_RUN = "node dist-test/agent/console.js";
export const CONSOLE_FACTS =
  "The console is the full demo path, run from frontend/ as node dist-test/agent/console.js. Ten steps: (1) owner create_obligation, (2) owner request_evidence, (3) read the obligation back and take pending_request_id from chain, (4) evidence branched on evidence_type: PREIMAGE local SHA-256 pre-check then submit_evidence_preimage, TEE request_tee_verification with the evidence URL, with 300 TGas console caller gas attached, then poll until READY, anything else the verifier submit_evidence path, (6) read back, abort unless READY, (7) read recipient ft_balance_of before settle, (8) agent settle with the scoped settle key, (9) read back, must be PAID, (10) read recipient balance after, increase must equal the obligation amount. The settle transaction print is not proof. The obligation PAID read and the balance delta are the proof. The reputation gate runs before the agent settles: BLOCK refuses with no settle, WARN escalates to the owner, no settle unless CYNEX_APPROVE_WARN=1.";
export const CLI_COMMANDS: [string, string][] = [
  ["verify", "node frontend/dist-test/cli/cynex.js verify --csv <vaultId>"],
  ["verify-receipts", "node frontend/dist-test/cli/cynex.js verify-receipts <receipts.json>"],
  ["verify-live", "node frontend/dist-test/cli/cynex.js verify-live <vaultId>"],
  ["playground", "node frontend/dist-test/cli/cynex.js playground <vaultId> <obligationId...>"],
  ["budget", "node frontend/dist-test/cli/cynex.js budget <vaultId> <policyId>"],
  ["verify-artifact", "node frontend/dist-test/cli/cynex.js verify-artifact <vaultId> <obligationId> <artifactFile>"],
  ["attack-one", "node frontend/dist-test/cli/cynex.js attack-one <vaultId> <obligationId> <proposedRecipient> <proposedAmount> <evidenceRef>"],
  ["attack", "node frontend/dist-test/cli/cynex.js attack <vaultId> <scenariosFile> [--dry-run]"],
  ["reputation", "node frontend/dist-test/cli/cynex.js reputation <vaultId> <accountId>"],
  ["reputation-snapshot", "node frontend/dist-test/cli/cynex.js reputation-snapshot <accountId...> [--rpc <url>]"],
];

/* ---- Settle check order and settle codes (contract/src/lib.rs:1466-1551) ---- */
export const SETTLE_CHECK_ORDER: string[] = [
  "obligation exists, else ERR_OBLIGATION_MISSING",
  "not in flight, else ERR_NONCE_ALREADY_CONSUMED",
  "not already PAID, else ERR_NONCE_ALREADY_CONSUMED",
  "state is READY, else ERR_INVALID_STATE",
  "not previously resolved-ready by a human, else ERR_NONCE_ALREADY_CONSUMED",
  "recipient matches, else ERR_RECIPIENT_SUBSTITUTION",
  "amount matches, else ERR_TERMS_MISMATCH",
  "not expired, else ERR_OBLIGATION_EXPIRED",
  "policy exists, else ERR_POLICY_MISSING",
  "policy not frozen, else ERR_POLICY_FROZEN",
  "policy version matches, else ERR_TERMS_MISMATCH",
  "token not locked, else ERR_TOKEN_IN_FLIGHT",
  "spent plus reserved plus amount within limit and funded, else ERR_BUDGET_EXCEEDED",
  "native headroom covers the receipt reserve plus deposit plus gas, else ERR_VAULT_STORAGE_EXHAUSTED",
];
export const SETTLE_CODES: [string, string][] = [
  ["ERR_OBLIGATION_MISSING", "no obligation with that id"],
  ["ERR_NONCE_ALREADY_CONSUMED", "in flight, already PAID, or previously resolved-ready"],
  ["ERR_INVALID_STATE", "state is not READY"],
  ["ERR_RECIPIENT_SUBSTITUTION", "proposed recipient differs from the fixed recipient"],
  ["ERR_TERMS_MISMATCH", "amount differs, or policy version differs"],
  ["ERR_OBLIGATION_EXPIRED", "now is past expires_at_ns"],
  ["ERR_POLICY_MISSING", "no policy with that id"],
  ["ERR_POLICY_FROZEN", "the owner froze the policy"],
  ["ERR_TOKEN_IN_FLIGHT", "the per-token lock is held"],
  ["ERR_BUDGET_EXCEEDED", "spent plus reserved plus amount over limit or funded"],
  ["ERR_VAULT_STORAGE_EXHAUSTED", "native headroom below the receipt plus deposit plus gas requirement"],
];

/* ---- Last-updated commit per Docs source file (git log, Master a79e426). Multi-file sections list each file's commit. ---- */
export const DOC_COMMITS: Record<string, string> = {
  readme: "620fcb3",
  security: "620fcb3 (README.md), 6b40576 (docs/threat-model.md)",
  deployment: "d9cdf40",
  p10demo: "fc3ceac",
  p10proof: "fc3ceac",
  reputation: "620fcb3 (README.md), 69b9fd7 (docs/reputation-engine.md, docs/scorecard-code-change-recency.md)",
  receipts: "6b40576",
  scorecard: "e26edfb", // docs/scorecard-code-change-recency.md (69b9fd7) and docs/demo-and-submission.md (e26edfb, latest)
  mcp: "ddcbcd3", // services/mcp/README.md (ddcbcd3), SECURITY.md 4dec900
  consoleCli: "b0c7cb1", // agent/console.ts and cli/cynex.ts
};
