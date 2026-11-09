/* Cynex web — constants and ground-truth data.
   Ported 1:1 from the static showcase (index.html, PR #12, fixed).
   No values are invented; live numbers are read from the chain at runtime. */

export const RPC_URL = "https://test.rpc.fastnear.com";
export const VAULT_PROD = "cynex-vault.cynexmaster.testnet";
export const VAULT_TEST = "cynex-testvault.cynexmaster.testnet";
export const AGENT = "cynex-agent.cynexmaster.testnet";
export const AGENT2 = "cynex-agent2.cynexmaster.testnet";
export const TOKEN = "usdc.fakes.testnet";
export const REPO = "https://github.com/Jayanng/Cynex";
export const COMMIT = "61db7a2";
export const DEMO_POLICY_ID = "p6-001";
export const DEMO_POLICY_PROD_ID = "p5-prod-001";

export const EX_TX = (h: string) => "https://testnet.nearblocks.io/txns/" + h;
export const EX_ADDR = (a: string) => "https://testnet.nearblocks.io/address/" + a;

/* Demo token (live mode) — KEY NOT YET SUPPLIED.
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
     recipient/amount codes — do NOT use it for those attacks.
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
export const DEMO_ATTACKER = "attacker.testnet"; // tampered recipient used only for live attempts; the vault refuses before any transfer
export const DEMO_LIVE_LABEL =
  "Demo key — testnet only, scoped to settle on the test vault, low allowance. This key can only attempt settles; the vault decides.";

/* Copy registry (commands with quotes live here) */
export const CP: Record<string, string> = {
  verify:
    "npx cynex-verify --vault cynex-testvault.cynexmaster.testnet --rpc https://test.rpc.fastnear.com",
  verifyCsv:
    "npx cynex-verify --vault cynex-testvault.cynexmaster.testnet --rpc https://test.rpc.fastnear.com --csv > receipts.csv",
  verifyProd:
    "npx cynex-verify --vault cynex-vault.cynexmaster.testnet --rpc https://test.rpc.fastnear.com",
  curlProd:
    'curl -s https://test.rpc.fastnear.com -H "content-type: application/json" -d \'{"jsonrpc":"2.0","id":"1","method":"query","params":{"request_type":"view_code","finality":"final","account_id":"cynex-vault.cynexmaster.testnet"}}\'',
  coldrun:
    "git clone https://github.com/Jayanng/Cynex.git\ncd Cynex\nnpm install\nnpm test            # Jest — 19 suites, 369 tests passing\nnpm run conformance # 6/6\nnpx cynex-verify --vault cynex-testvault.cynexmaster.testnet --rpc https://test.rpc.fastnear.com",
  att13324:
    "npx cynex-verify --bundle demo/attestations/prod-tee-001.json --request 13324 --rpc https://test.rpc.fastnear.com",
  att10640:
    "npx cynex-verify --bundle demo/attestations/10640.json --request 10640 --rpc https://test.rpc.fastnear.com",
  att11912:
    "npx cynex-verify --bundle demo/attestations/11912.json --request 11912 --rpc https://test.rpc.fastnear.com",
  att13040:
    "npx cynex-verify --bundle demo/attestations/13040.json --request 13040 --rpc https://test.rpc.fastnear.com",
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

/* Ground-truth record — live demo, already executed on the test vault.
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
    n: "01",
    anchor: "step1",
    cls: "",
    title: "Happy path — PREIMAGE evidence",
    ob: "p10-demo-preimage-001",
    desc: "The agent delivers artifact p6-001 and presents its SHA-256 preimage. The vault verifies the evidence against the obligation, enforces the fixed terms, and settles 100 USDC to the agent. No human in the loop — the contract checked everything.",
    terms: [
      ["recipient", AGENT],
      ["token", TOKEN],
      ["amount", "100 USDC"],
      ["nonce", "1001"],
      ["evidence", "PREIMAGE — SHA-256(delivery artifact p6-001)"],
    ],
    attempts: [
      {
        label: "settle · correct terms · valid preimage",
        verdict: "PAID",
        tx: "3Gp3J2zZCKrne1PamDVf6PgXHk4qGc3a58GBvoFcNhrZ",
        note: "receipt #11",
      },
    ],
    delta: "agent 700 → 800 USDC",
    receipt: 11,
  },
  {
    n: "02",
    anchor: "step2",
    cls: "attack",
    title: "Attack — substituted terms, then a replay",
    ob: "p10-demo-attack-001",
    desc: "A prompt-injected agent tries to pay the wrong recipient, then the wrong amount. The vault refuses both — the terms are on-chain and cannot be argued with. The correct settle succeeds, and the immediate replay is refused as a double-pay.",
    terms: [
      ["recipient", AGENT],
      ["token", TOKEN],
      ["amount", "100 USDC"],
      ["nonce", "1002"],
      ["evidence", "PREIMAGE"],
    ],
    attempts: [
      {
        label: "settle · recipient swapped to attacker",
        verdict: "REFUSED",
        code: "ERR_RECIPIENT_SUBSTITUTION",
        tx: "AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S",
      },
      {
        label: "settle · amount inflated 100 → 200",
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
    delta: "agent 800 → 900 USDC",
    receipt: 12,
  },
  {
    n: "03",
    anchor: "step3",
    cls: "",
    title: "TEE evidence — OutLayer, VRF-bound",
    ob: "p10-demo-tee-001",
    desc: "Evidence is produced inside a TEE and verified through OutLayer. The VRF signature is bound to the pending request, so it cannot be replayed against a different obligation. The VRF signature does not prove TEE execution.",
    terms: [
      ["recipient", AGENT],
      ["token", TOKEN],
      ["amount", "100 USDC"],
      ["nonce", "1003"],
      ["evidence", "TEE — OutLayer request 11912 · 300 TGas"],
    ],
    attempts: [
      {
        label: "tee_request · OutLayer verification · 300 TGas",
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
    delta: "agent 900 → 1000 USDC",
    receipt: 13,
  },
];

/* Playground matrix — bundled snapshot of demo/playground-obligations.json @ master 61db7a2.
   Replaced by a live fetch of the repo file when reachable. Read-only fixtures. */
export interface PlaygroundRow {
  id: string;
  ev: string;
  amount: string;
  nonce: number;
  expect: string;
  ro?: boolean;
  tx?: string | null;
  receipt?: number | null;
  note: string;
}
export const PLAYGROUND_INITIAL: PlaygroundRow[] = [
  { id: "p10-demo-preimage-001", ev: "PREIMAGE", amount: "100", nonce: 1001, expect: "PAID", ro: true, tx: "3Gp3J2zZCKrne1PamDVf6PgXHk4qGc3a58GBvoFcNhrZ", receipt: 11, note: "Happy path — artifact preimage verified, settled." },
  { id: "p10-demo-attack-001", ev: "PREIMAGE", amount: "100", nonce: 1002, expect: "PAID", ro: true, tx: "Ho97UjQEDDfe7Go66uHrVSJvbF8narZJ2YBH3hWarxi", receipt: 12, note: "Attack sequence — two refusals, then the correct settle." },
  { id: "p10-demo-tee-001", ev: "TEE", amount: "100", nonce: 1003, expect: "PAID", ro: true, tx: "3QV2aCRSiJ8ZYqLECCpK6ZkXpYE4AdxJzmyP3JTaDqWB", receipt: 13, note: "TEE/VRF — OutLayer request 11912 bound to the pending request." },
  { id: "pg-preimage-ok-001", ev: "PREIMAGE", amount: "25", nonce: 2001, expect: "PAID", note: "Valid preimage, terms exact." },
  { id: "pg-preimage-ok-002", ev: "PREIMAGE", amount: "10", nonce: 2013, expect: "PAID", note: "Minimum-amount settle." },
  { id: "pg-budget-edge-001", ev: "PREIMAGE", amount: "250", nonce: 2014, expect: "PAID", note: "Settle exactly at remaining policy headroom." },
  { id: "pg-rep-allow-001", ev: "PREIMAGE", amount: "20", nonce: 2015, expect: "ALLOW", note: "Reputation: code unchanged > 7 days → ALLOW, settle proceeds." },
  { id: "pg-wrong-recipient-001", ev: "PREIMAGE", amount: "25", nonce: 2002, expect: "ERR_RECIPIENT_SUBSTITUTION", note: "Injected instruction swaps the recipient to an attacker account." },
  { id: "pg-wrong-amount-001", ev: "PREIMAGE", amount: "40", nonce: 2003, expect: "ERR_TERMS_MISMATCH", note: "Attempts 80 against a 40 obligation." },
  { id: "pg-wrong-token-001", ev: "PREIMAGE", amount: "40", nonce: 2004, expect: "ERR_TERMS_MISMATCH", note: "Pays in a look-alike token — not usdc.fakes.testnet." },
  { id: "pg-replay-nonce-001", ev: "PREIMAGE", amount: "25", nonce: 2005, expect: "ERR_NONCE_ALREADY_CONSUMED", note: "Same bill submitted twice — nonce already consumed." },
  { id: "pg-budget-exceed-001", ev: "PREIMAGE", amount: "900", nonce: 2006, expect: "ERR_BUDGET_EXCEEDED", note: "Cumulative spend would cross the budget policy." },
  { id: "pg-expired-001", ev: "PREIMAGE", amount: "15", nonce: 2007, expect: "ERR_OBLIGATION_EXPIRED", note: "Settle attempted after the obligation expired." },
  { id: "pg-policy-frozen-001", ev: "PREIMAGE", amount: "15", nonce: 2008, expect: "ERR_POLICY_FROZEN", note: "Policy frozen by the owner — every settle refused while frozen." },
  { id: "pg-tee-ok-001", ev: "TEE", amount: "60", nonce: 2009, expect: "PAID", note: "OutLayer verification, VRF bound to the pending request." },
  { id: "pg-tee-bad-vrf-001", ev: "TEE", amount: "60", nonce: 2010, expect: "ERR_TERMS_MISMATCH", note: "VRF signature not bound to this pending request — evidence rejected." },
  { id: "pg-rep-block-001", ev: "PREIMAGE", amount: "30", nonce: 2011, expect: "BLOCK", note: "Reputation: code_change_recency — code changed < 24h ago, no history." },
  { id: "pg-rep-warn-001", ev: "PREIMAGE", amount: "30", nonce: 2012, expect: "WARN", note: "Reputation: code changed 3 days ago — WARN; escalates unless CYNEX_APPROVE_WARN=1." },
];
export const PLAYGROUND_SOURCE_INITIAL =
  "bundled snapshot · demo/playground-obligations.json @ master " + COMMIT;

/* Attack scenarios — demo/attack-scenarios.json */
export interface AttackScenario {
  name: string;
  code: string;
  tx: string | null;
  vector: string;
  attempt: string;
}
export const ATTACKS: AttackScenario[] = [
  {
    name: "Recipient substitution",
    code: "ERR_RECIPIENT_SUBSTITUTION",
    tx: "AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S",
    vector: "A poisoned invoice page tells the agent the vendor rotated their payout account. The agent calls settle with an attacker-controlled recipient.",
    attempt: "recipient → attacker-controlled account · amount 100 · nonce 1002",
  },
  {
    name: "Amount inflation",
    code: "ERR_TERMS_MISMATCH",
    tx: "43YaxJVggxuZ3E25WfjzkgGBsGAqLrj8nwdUU9RLAQRy",
    vector: "The injected instruction claims the bill is 200, not 100. The obligation on chain says 100.",
    attempt: "amount 100 → 200 · nonce 1002",
  },
  {
    name: "Nonce replay — double pay",
    code: "ERR_NONCE_ALREADY_CONSUMED",
    tx: "AwzQS7XsuGSYnPmvd5jFJzPDs3WDc2gRgSbW3smWq1Cs",
    vector: "The agent is told the first payment failed and to retry the identical settle. The nonce was consumed by receipt #12.",
    attempt: "reuse nonce 1002 after receipt #12",
  },
  {
    name: "Budget drain",
    code: "ERR_BUDGET_EXCEEDED",
    tx: null,
    vector: "Repeated plausible-looking settles until cumulative spend crosses the obligation’s budget policy.",
    attempt: "cumulative spend > policy budget",
  },
  {
    name: "Expired obligation",
    code: "ERR_OBLIGATION_EXPIRED",
    tx: null,
    vector: "Settle is attempted after the obligation’s expiry — stale bills cannot be paid.",
    attempt: "settle after expiry",
  },
  {
    name: "Settle under a frozen policy",
    code: "ERR_POLICY_FROZEN",
    tx: null,
    vector: "The owner freezes the policy. Every settle is refused while the policy is frozen.",
    attempt: "settle while policy frozen",
  },
];

/* Attestation bundles — in repo under demo/attestations/ */
export interface Bundle {
  id: string;
  req: string;
  key: string;
  title: string;
  vault: string;
  top?: boolean;
  note: string;
}
export const BUNDLES: Bundle[] = [
  {
    id: "prod-tee-001",
    req: "13324",
    key: "att13324",
    title: "Production TEE proof",
    vault: VAULT_PROD,
    top: true,
    note: "Production vault TEE attestation — OutLayer request 13324.",
  },
  {
    id: "10640",
    req: "10640",
    key: "att10640",
    title: "Attestation bundle 10640",
    vault: VAULT_TEST,
    note: "OutLayer request 10640.",
  },
  {
    id: "11912",
    req: "11912",
    key: "att11912",
    title: "Attestation bundle 11912",
    vault: VAULT_TEST,
    note: "OutLayer request 11912 — used by demo step 3 (p10-demo-tee-001).",
  },
  {
    id: "13040",
    req: "13040",
    key: "att13040",
    title: "Attestation bundle 13040",
    vault: VAULT_TEST,
    note: "OutLayer request 13040.",
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
export const BREAK_IT: BreakItScenario[] = [
  {
    key: "recipient",
    label: "Change the recipient",
    code: "ERR_RECIPIENT_SUBSTITUTION",
    tx: "AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S",
    attempt: "settle p10-demo-attack-001 to an attacker-controlled recipient · 100 USDC · nonce 1002",
    why: "The obligation fixes the recipient on chain. The settle call asked for a different recipient, so the vault refused before moving anything.",
    live: { obligation: "ready", recipient: DEMO_ATTACKER, amount: "100000000", expectState: "READY" },
  },
  {
    key: "amount",
    label: "Change the amount",
    code: "ERR_TERMS_MISMATCH",
    tx: "43YaxJVggxuZ3E25WfjzkgGBsGAqLrj8nwdUU9RLAQRy",
    attempt: "settle p10-demo-attack-001 for 200 USDC instead of the fixed 100 USDC · nonce 1002",
    why: "The obligation fixes the amount at 100 USDC. The settle asked for 200, so the terms did not match and the vault refused.",
    live: { obligation: "ready", recipient: AGENT, amount: "200000000", expectState: "READY" },
  },
  {
    key: "replay",
    label: "Replay a nonce",
    code: "ERR_NONCE_ALREADY_CONSUMED",
    tx: "AwzQS7XsuGSYnPmvd5jFJzPDs3WDc2gRgSbW3smWq1Cs",
    attempt: "settle p10-demo-attack-001 again with nonce 1002, after receipt #12 already consumed it",
    why: "Nonce 1002 was consumed by receipt #12. Reusing it is a double-pay, so the vault refused.",
    live: { obligation: "p10-demo-attack-001", recipient: AGENT, amount: "100000000", expectState: "PAID" },
  },
  {
    key: "evidence",
    label: "Remove the evidence",
    code: "ERR_INVALID_STATE",
    tx: null,
    attempt: "settle p10-demo-attack-001 with no evidence presented — skip the preimage step entirely",
    why: "Settle requires evidence first. With no evidence presented, the obligation is not in a settleable state, so the vault refuses. This case was not executed on chain in the demo run — the verdict shown is the expected on-chain verdict, evaluated against the same terms.",
    live: { obligation: "pending", recipient: AGENT, amount: "100000000", expectState: "NOT_READY" },
  },
];
