/* The 1:1 feature contract. Every tool, signal, attack, and enforcement check
   the Cynex codebase ships, captured here so the UI cannot under-report it.
   Sources: services/mcp/tools.ts, services/reputation/reputation.ts,
   services/attacks/attacks.ts, contract/src/lib.rs, README.md. */

export type Kind = "read" | "write" | "gate";

/* ---------------------------------------------------------------- MCP tools */
export interface McpTool {
  name: string;
  kind: Kind;
  summary: string;
  inputs: { key: string; label: string; type: "text" | "number" | "select"; options?: string[]; placeholder?: string; value?: string }[];
  readOnly: boolean;
  invokes: string;
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "cynex_check_counterparty",
    kind: "gate",
    summary:
      "Run the Cynex reputation engine over a counterparty with five live signals. Returns verdict, score, reasons, and each signal. Read-only, moves no funds.",
    inputs: [{ key: "account_id", label: "account_id", type: "text", placeholder: "cynex-agent.cynexmaster.testnet" }],
    readOnly: true,
    invokes: "reputation gate, five live signals",
  },
  {
    name: "cynex_prepare_obligation",
    kind: "read",
    summary:
      "Prepare, never authorize or submit. Validate obligation terms against contract rules and return the exact create_obligation arguments for the owner to review and sign. Holds no owner key.",
    inputs: [
      { key: "policy_id", label: "policy_id", type: "text", value: "p6-001" },
      { key: "obligation_id", label: "obligation_id", type: "text", value: "p10-demo-attack-001" },
      { key: "recipient", label: "recipient", type: "text", value: "cynex-agent.cynexmaster.testnet" },
      { key: "amount", label: "amount", type: "text", value: "100" },
      { key: "evidence_type", label: "evidence_type", type: "select", options: ["PREIMAGE", "TEE", "delivery-note"], value: "PREIMAGE" },
      { key: "nonce", label: "nonce", type: "text", value: "1002" },
    ],
    readOnly: true,
    invokes: "local validation, returns create_obligation args",
  },
  {
    name: "cynex_request_settlement",
    kind: "write",
    summary:
      "Request settlement of a READY obligation with the scoped settle-only key. Refuses unless READY, refuses a BLOCK verdict, escalates WARN to the owner. The vault enforces the terms on chain.",
    inputs: [
      { key: "obligation_id", label: "obligation_id", type: "text", value: "p10-demo-attack-001" },
      { key: "proposed_recipient", label: "proposed_recipient", type: "text", value: "attacker.testnet" },
      { key: "proposed_amount", label: "proposed_amount", type: "text", value: "100" },
      { key: "evidence_ref", label: "evidence_ref", type: "text", value: "mcp-demo" },
    ],
    readOnly: false,
    invokes: "settle with the scoped agent key",
  },
  {
    name: "cynex_get_obligation",
    kind: "read",
    summary: "Read one obligation from the vault exactly as the chain returns it. Read-only.",
    inputs: [{ key: "obligation_id", label: "obligation_id", type: "text", value: "p10-demo-attack-001" }],
    readOnly: true,
    invokes: "view_call get_obligation",
  },
  {
    name: "cynex_list_receipts",
    kind: "read",
    summary:
      "List settlement receipts as read from the chain. The prev_hash chain is verified by the CLI verify-live, not by this tool. Read-only.",
    inputs: [
      { key: "start", label: "start", type: "number", value: "0" },
      { key: "limit", label: "limit", type: "number", value: "20" },
    ],
    readOnly: true,
    invokes: "view_call receipts",
  },
  {
    name: "cynex_get_policy",
    kind: "read",
    summary: "Read a policy, its balances, and the vault state from the chain. Read-only.",
    inputs: [{ key: "policy_id", label: "policy_id", type: "text", value: "p6-001" }],
    readOnly: true,
    invokes: "view_call get_policy + balances",
  },
];

/* -------------------------------------------------------- attack scenarios */
export interface AttackScenario {
  id: string;
  name: string;
  field: string;
  attack: string;
  expectedCode: string;
  onChain: boolean;
  eventId?: string;
  liveObligation: string;
  note: string;
}

export const ATTACKS: AttackScenario[] = [
  {
    id: "recipient",
    name: "Recipient substitution",
    field: "proposed_recipient",
    attack: "Route the money to a different account than the order names.",
    expectedCode: "ERR_RECIPIENT_SUBSTITUTION",
    onChain: true,
    eventId: "refuse-recipient",
    liveObligation: "p10-demo-attack-001",
    note: "Executed on the test vault. The proposed recipient was the owner account. Zero tokens moved.",
  },
  {
    id: "terms",
    name: "Terms mismatch",
    field: "proposed_amount",
    attack: "Inflate the amount from 100 to 200 base units.",
    expectedCode: "ERR_TERMS_MISMATCH",
    onChain: true,
    eventId: "refuse-amount",
    liveObligation: "p10-demo-attack-001",
    note: "Executed on the test vault. The order on chain says 100. The vault does not round up.",
  },
  {
    id: "nonce",
    name: "Nonce replay",
    field: "nonce",
    attack: "Settle the same order twice and collect twice.",
    expectedCode: "ERR_NONCE_ALREADY_CONSUMED",
    onChain: true,
    eventId: "refuse-replay",
    liveObligation: "p10-demo-attack-001",
    note: "Executed on the test vault. Every nonce pays exactly once, even when the first transfer fails.",
  },
  {
    id: "budget",
    name: "Budget breach",
    field: "proposed_amount",
    attack: "Push a single payment through that exceeds the policy's remaining headroom.",
    expectedCode: "ERR_BUDGET_EXCEEDED",
    onChain: false,
    liveObligation: "p6-001",
    note: "The contract checks spent plus reserved plus amount against the policy limit before any transfer. A breach is refused with no partial move. Demonstrated against the live policy balance below.",
  },
];

/* --------------------------------------------------------- reputation gate */
export interface RepSignal {
  id: string;
  name: string;
  desc: string;
  source: string;
  blockRule: string;
}

export const REP_SIGNALS: RepSignal[] = [
  {
    id: "account_age",
    name: "account_age",
    desc: "How long the counterparty has existed on chain, from first-seen snapshots we record and publish.",
    source: "NEAR RPC, documented snapshots",
    blockRule: "Unknown maps to WARN, never to a guessed score.",
  },
  {
    id: "blocklist",
    name: "blocklist",
    desc: "Whether the account appears on a real blocklist with a named source.",
    source: "public blocklist with named provenance",
    blockRule: "BLOCK when sourced and listed. No suitable source means unavailable, never invented.",
  },
  {
    id: "code_change_recency",
    name: "code_change_recency",
    desc: "Whether the receiver's contract code changed recently, from code-hash history.",
    source: "on-chain code hash vs latest snapshot",
    blockRule: "changed under 24h is BLOCK, under 7 days is WARN, otherwise ALLOW.",
  },
  {
    id: "prior_vault_interactions",
    name: "prior_vault_interactions",
    desc: "Our own receipt history with this counterparty, paginated from the vault.",
    source: "vault receipts()",
    blockRule: "Unknown maps to WARN. Never a fabricated score.",
  },
  {
    id: "deployed",
    name: "deployed",
    desc: "Whether a contract is deployed on the account at all.",
    source: "NEAR RPC view_account code hash",
    blockRule: "no_contract and unavailable both feed the WARN path, never a guess.",
  },
];

export const REP_THRESHOLDS = {
  codeChangeWarnMs: "7 days",
  codeChangeBlockMs: "24 hours",
  scoreRule: "Score is the mean of sourced signals. It is null unless the verdict is ALLOW.",
  verdicts: {
    BLOCK: "blocklist sourced and lists the account, or code_change_recency fires BLOCK.",
    ALLOW: "account existence sourced and exists, code_change_recency not WARN or BLOCK, no failing signal.",
    WARN: "everything else. Reasons list every failing signal. Unknown is WARN, never a pass.",
  },
};

/* ------------------------------------------------------- enforcement matrix */
export interface Enforcement {
  id: string;
  name: string;
  code: string;
  check: string;
}

export const ENFORCEMENT: Enforcement[] = [
  { id: "recipient", name: "Recipient", code: "ERR_RECIPIENT_SUBSTITUTION", check: "settle reads the recipient from the obligation in state and compares it to the proposed recipient." },
  { id: "terms", name: "Amount", code: "ERR_TERMS_MISMATCH", check: "settle reads the amount from the obligation in state and compares it to the proposed amount." },
  { id: "nonce", name: "Replay", code: "ERR_NONCE_ALREADY_CONSUMED", check: "a one-time nonce is consumed and locked on the first settle, so a second attempt is refused." },
  { id: "budget", name: "Budget", code: "ERR_BUDGET_EXCEEDED", check: "settle checks spent plus reserved plus amount against the policy limit before any transfer." },
  { id: "evidence", name: "Evidence", code: "ERR_EVIDENCE_MISMATCH", check: "the obligation moves to READY only when the evidence matches the committed digest." },
  { id: "evidence-size", name: "Evidence size", code: "ERR_EVIDENCE_TOO_LARGE", check: "evidence over 64 KiB cannot use the on-chain check and is refused at the byte boundary." },
  { id: "evidence-expiry", name: "Evidence expiry", code: "ERR_EVIDENCE_EXPIRED", check: "evidence presented after its window is rejected." },
  { id: "expiry", name: "Expiry", code: "ERR_OBLIGATION_EXPIRED", check: "settle after expires_at_ns rejects. Expiry alone does not auto-cancel, because auto-cancel would hide a real failure." },
  { id: "state", name: "State", code: "ERR_INVALID_STATE", check: "an obligation must be READY before settle. Wrong state is refused." },
  { id: "missing", name: "Missing order", code: "ERR_OBLIGATION_MISSING", check: "settle on an unknown obligation id is refused." },
  { id: "exists", name: "Duplicate order", code: "ERR_OBLIGATION_EXISTS", check: "create_obligation on an id that already exists is refused." },
  { id: "id-length", name: "Order id length", code: "ERR_OBLIGATION_ID_TOO_LONG", check: "an obligation id over the limit is refused at creation." },
  { id: "policy-missing", name: "Policy missing", code: "ERR_POLICY_MISSING", check: "settle against a policy that does not exist is refused." },
  { id: "policy-frozen", name: "Policy frozen", code: "ERR_POLICY_FROZEN", check: "settle against a frozen policy is refused." },
  { id: "policy-exists", name: "Policy duplicate", code: "ERR_POLICY_EXISTS", check: "create_policy on an existing policy id is refused." },
  { id: "storage", name: "Vault storage", code: "ERR_VAULT_STORAGE_EXHAUSTED", check: "when the vault cannot store the receipt, settle refuses rather than lose the audit trail." },
];

export const ERROR_CODE_TOTAL = 25;
export const SETTLE_REACHABLE_CODES = 11;

/* ------------------------------------------------------------- key limits */
export const KEY_LIMITS = [
  { label: "Scope", value: "one method, settle, on one vault", detail: "the agent key cannot call transfer, add_key, or anything else" },
  { label: "Deposit", value: "0 yoctoNEAR", detail: "no attached deposit, ever" },
  { label: "Allowance", value: "bounded gas only", detail: "a small function-call allowance, not a wallet" },
  { label: "Authority", value: "none over terms", detail: "the vault decides. the agent can only ask" },
];
