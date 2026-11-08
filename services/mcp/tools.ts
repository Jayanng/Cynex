/**
 * Cynex MCP tools, survival plan item 2.
 *
 * Six tools, one moves funds. The rest are read-only or
 * prepare-only. Every tool validates its inputs strictly and
 * refuses anything malformed, with a reason, before it touches
 * the chain. Nothing here is mocked or hardcoded: every tool
 * reads real chain state, real obligations, real receipts, and
 * real balances, through the existing CynexClient, the reputation
 * service, and the agent wrapper. No vault logic, no reputation
 * logic, and no settlement logic is reimplemented here; only the
 * settle orchestration is duplicated from the console, using the
 * same underlying functions (see agent/console.ts steps 7 to 10).
 *
 * The MCP server lets an agent request settlement using only a
 * scoped settle key, while the NEAR vault enforces the
 * human-authorized terms even if the agent is compromised.
 */
import { z } from "zod";
import type { SettleArgs } from "../../frontend/src/cynex/api.js";
import { createObligationArgs, SETTLE_CALL_GAS, txHashFromError } from "../../agent/console.js";
import type { ObligationFile } from "../../agent/console.js";
import { buildSettle, gateSettleOnReputation } from "../../agent/wrapper.js";
import type { ReputationReport } from "../reputation/reputation.js";
import type { McpConfig } from "./config.js";
import {
  checkBudget,
  parseChainTimestampNs,
  toChainBigInt,
  verifyEcho,
  verifyRuntimeState,
  type RuntimeState,
} from "./runtime-checks.js";

export { SETTLE_CALL_GAS };

export const SETTLE_RATE_LIMIT_CALLS = 5;
export const SETTLE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const MAX_RECEIPTS_LIMIT = 100;
export const EVIDENCE_TYPES = ["PREIMAGE", "TEE", "delivery-note"] as const;

export interface ToolResult {
  ok: boolean;
  reason: string;
  data?: unknown;
  /** Stage of the settle path a refusal stopped at, requestSettlement only. The test client reads it to tell whether an attempt reached the runtime checks, instead of guessing from the reason string. */
  stage?: string;
}

function refused(reason: string): ToolResult {
  return { ok: false, reason };
}

function refusedAt(reason: string, stage: string): ToolResult {
  return { ok: false, reason, stage };
}

function succeeded(reason: string, data: unknown, stage?: string): ToolResult {
  return stage === undefined ? { ok: true, reason, data } : { ok: true, reason, data, stage };
}

export function isValidAccountId(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (value.length < 2 || value.length > 64) {
    return false;
  }
  // Canonical NEAR account id grammar (near-primitives-core): each
  // dot-separated part is alphanumerics with single "-" or "_" separators
  // inside, never leading or trailing a part. A loose check accepts ids
  // the chain rejects, such as "a.-b.testnet", which the testnet RPC
  // answers with PARSE_ERROR.
  return /^(([a-z0-9]+[-_])*[a-z0-9]+\.)*([a-z0-9]+[-_])*[a-z0-9]+$/.test(value);
}

export function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]+$/.test(value);
}

export function isValidObligationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 64 &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

export function isValidPolicyId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 64 &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}

function obligationRow(row: unknown): Record<string, unknown> | null {
  if (row === null || row === undefined) {
    return null;
  }
  if (typeof row !== "object") {
    return null;
  }
  return row as Record<string, unknown>;
}

function rowState(row: unknown): string {
  const record = obligationRow(row);
  return record === null ? "" : String(record.state ?? "");
}

/** Minimal chain-read surface the tools need, satisfied by CynexClient. */
export interface ChainClient {
  getPolicy(policy_id: string): Promise<unknown>;
  getObligation(obligation_id: string): Promise<unknown>;
  balances(policy_id: string): Promise<unknown>;
  receipts(start: bigint, limit: bigint): Promise<unknown>;
  state(): Promise<unknown>;
  viewAccessKeyList(accountId: string): Promise<unknown>;
}

export interface McpContext {
  config: McpConfig;
  client: ChainClient;
  checkCounterparty: (accountId: string) => Promise<ReputationReport>;
  /** Submit settle with the scoped key, return the transaction hash. */
  settleWithKey: (args: SettleArgs) => Promise<string>;
  tokenBalance: (tokenId: string, accountId: string) => Promise<bigint>;
  /** Public key of the signing key, for the per-settle scope re-check. */
  agentPublicKey: string;
  /** Live runtime state for the per-settle integrity checks. */
  runtimeState: () => Promise<RuntimeState>;
  nowMs?: () => number;
  pollIntervalMs?: number;
  pollMaxAttempts?: number;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Settle rate limiter, borrowing the executor pattern
 * (services/executor/executor.ts, createRateLimiter): at most 5
 * settle calls per rolling 60 seconds, and at most one settle
 * attempt per obligation_id in that window. A failed settle still
 * costs gas from the agent key allowance, so a runaway client must
 * not be able to burn the allowance on failed attempts. The limiter
 * is in-memory per server process; restarting the server resets it.
 * The on-chain key allowance is the hard bound on cumulative gas,
 * not this limiter.
 */
export interface SettleRateLimiter {
  check(obligationId: string): { allowed: boolean; reason: string };
}

export function createSettleRateLimiter(
  limit: number = SETTLE_RATE_LIMIT_CALLS,
  windowMs: number = SETTLE_RATE_LIMIT_WINDOW_MS,
  nowMs: () => number = Date.now,
): SettleRateLimiter {
  const attempts: number[] = [];
  const perObligation = new Map<string, number[]>();
  function prune(list: number[], now: number): number[] {
    return list.filter(function (t) {
      return now - t < windowMs;
    });
  }
  return {
    check(obligationId: string): { allowed: boolean; reason: string } {
      const now = nowMs();
      const recent = prune(perObligation.get(obligationId) ?? [], now);
      if (recent.length === 0) {
        perObligation.delete(obligationId);
      } else {
        perObligation.set(obligationId, recent);
      }
      if (recent.length >= 1) {
        return {
          allowed: false,
          reason:
            "rate limited: at most one settle attempt per obligation_id per 60 seconds, " +
            obligationId +
            " was already attempted in this window",
        };
      }
      const global = prune(attempts, now);
      if (global.length >= limit) {
        return {
          allowed: false,
          reason: "rate limited: at most 5 settle calls per 60 seconds",
        };
      }
      recent.push(now);
      perObligation.set(obligationId, recent);
      global.push(now);
      attempts.length = 0;
      attempts.push(...global);
      return { allowed: true, reason: "" };
    },
  };
}

export function createDefaultRateLimiter(): SettleRateLimiter {
  return createSettleRateLimiter();
}

/** Tool input schemas, as Zod shapes for the MCP SDK. */
export const TOOL_SCHEMAS = {
  cynex_check_counterparty: {
    account_id: z.string().describe("NEAR account id to check"),
  },
  cynex_prepare_obligation: {
    policy_id: z.string().describe("Policy the obligation will belong to"),
    obligation_id: z.string().describe("Obligation id, at most 64 characters"),
    recipient: z.string().describe("Recipient NEAR account id"),
    amount: z.string().describe("Amount as a decimal string in the token smallest units"),
    evidence_type: z.enum(["PREIMAGE", "TEE", "delivery-note"]).describe("Evidence type the contract accepts"),
    evidence_hash: z.string().describe("Evidence hash, exactly 64 hex characters"),
    expires_at_ns: z.string().describe("Expiry as a decimal string in nanoseconds"),
    nonce: z.string().describe("Nonce as a decimal string"),
  },
  cynex_request_settlement: {
    obligation_id: z.string().describe("Obligation id to settle"),
    proposed_recipient: z.string().describe("Proposed recipient NEAR account id"),
    proposed_amount: z.string().describe("Proposed amount as a decimal string in the token smallest units"),
    evidence_ref: z.string().describe("Evidence reference for the caller's own records; it is passed to the settle call but the contract discards it on chain and nothing persists it"),
  },
  cynex_get_obligation: {
    obligation_id: z.string().describe("Obligation id to read"),
  },
  cynex_list_receipts: {
    start: z.number().int().optional().describe("First receipt index, default 0"),
    limit: z.number().int().optional().describe("Receipts to return, default 20, maximum 100"),
  },
  cynex_get_policy: {
    policy_id: z.string().describe("Policy id to read"),
  },
} as const;

export const TOOL_NAMES = Object.keys(TOOL_SCHEMAS) as (keyof typeof TOOL_SCHEMAS)[];

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  cynex_check_counterparty:
    "Check a counterparty account with the Cynex reputation engine (five live signals) and return the verdict, score, reasons, and signals. Read-only, it moves no funds.",
  cynex_prepare_obligation:
    "Prepare, not authorized or submitted: validate obligation terms against the contract rules and return the exact create_obligation arguments plus a plain-language summary for the owner to review and sign. Submits nothing and holds no owner key.",
  cynex_request_settlement:
    "Request settlement of a READY obligation with the agent scoped settle-only key. Refuses unless the obligation is READY, refuses a BLOCK reputation verdict, and escalates a WARN verdict to the owner. The vault enforces the terms on chain.",
  cynex_get_obligation:
    "Read one obligation from the vault exactly as the chain returns it. Read-only.",
  cynex_list_receipts:
    "List settlement receipts from the vault as read from the chain. Read-only. The prev_hash chain is verified by the CLI verify-live, not by this tool.",
  cynex_get_policy:
    "Read a policy, its balances, and the vault state from the chain. Read-only.",
};

export async function checkCounterparty(
  ctx: McpContext,
  args: { account_id: unknown },
): Promise<ToolResult> {
  if (!isValidAccountId(args.account_id)) {
    return refused(
      "account_id is not a valid NEAR account id: " + JSON.stringify(args.account_id),
    );
  }
  try {
    const report = await ctx.checkCounterparty(args.account_id);
    if (report.accountId !== args.account_id) {
      return refused(
        "counterparty check failed: the report is for " + JSON.stringify(report.accountId) + ", not the requested " + JSON.stringify(args.account_id),
      );
    }
    return succeeded("counterparty checked, verdict " + report.verdict, report);
  } catch (error) {
    return refused(
      "counterparty check failed: " + (error instanceof Error ? error.message : String(error)),
    );
  }
}

export interface PrepareObligationInput {
  policy_id: unknown;
  obligation_id: unknown;
  recipient: unknown;
  amount: unknown;
  evidence_type: unknown;
  evidence_hash: unknown;
  expires_at_ns: unknown;
  nonce: unknown;
}

/**
 * Prepare-only validation. Every term is checked against the
 * contract create_obligation rules (contract/src/lib.rs), off
 * chain, in order, before any view call that is not needed yet:
 * amount greater than zero, expiry strictly in the future,
 * evidence type one of the three the contract accepts, evidence
 * hash exactly 64 hex characters, obligation id at most 64
 * characters, nonce a u64, then the policy exists and is not
 * frozen, then the obligation id is not already on chain. A bad
 * term is refused with a reason, so the owner never signs a bad
 * obligation. Validation is a check against current state, not a
 * guarantee that a later transaction will succeed.
 */
export async function prepareObligation(
  ctx: McpContext,
  input: PrepareObligationInput,
): Promise<ToolResult> {
  if (!isValidPolicyId(input.policy_id)) {
    return refused("policy_id is not valid: " + JSON.stringify(input.policy_id));
  }
  if (!isValidObligationId(input.obligation_id)) {
    return refused(
      "obligation_id must be 1 to 64 characters of letters, digits, dot, underscore, or hyphen: " +
        JSON.stringify(input.obligation_id),
    );
  }
  if (!isValidAccountId(input.recipient)) {
    return refused("recipient is not a valid NEAR account id: " + JSON.stringify(input.recipient));
  }
  if (!isDecimalString(input.amount)) {
    return refused("amount must be a decimal string in the token smallest units: " + JSON.stringify(input.amount));
  }
  let amount: bigint;
  try {
    amount = BigInt(input.amount);
  } catch {
    return refused("amount is not a valid decimal string: " + JSON.stringify(input.amount));
  }
  if (amount <= 0n) {
    return refused("amount must be greater than zero, the contract rejects a zero amount with ERR_TERMS_MISMATCH");
  }
  if (amount > (1n << 128n) - 1n) {
    return refused("amount is outside the u128 range");
  }
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    return refused(
      "amount must be at most 9007199254740991 to be exactly representable as a JS number; the create_obligation arguments travel as JSON numbers through the console, so a larger amount cannot be returned exactly",
    );
  }
  if (
    typeof input.evidence_type !== "string" ||
    !(EVIDENCE_TYPES as readonly string[]).includes(input.evidence_type)
  ) {
    return refused(
      "evidence_type must be one of PREIMAGE, TEE, or delivery-note: " + JSON.stringify(input.evidence_type),
    );
  }
  if (typeof input.evidence_hash !== "string" || !/^[0-9a-fA-F]{64}$/.test(input.evidence_hash)) {
    return refused("evidence_hash must be exactly 64 hex characters");
  }
  if (!isDecimalString(input.expires_at_ns)) {
    return refused("expires_at_ns must be a decimal string in nanoseconds: " + JSON.stringify(input.expires_at_ns));
  }
  let expiresAt: bigint;
  try {
    expiresAt = BigInt(input.expires_at_ns);
  } catch {
    return refused("expires_at_ns is not a valid decimal string: " + JSON.stringify(input.expires_at_ns));
  }
  if (expiresAt > (1n << 64n) - 1n) {
    return refused("expires_at_ns is outside the u64 range");
  }
  const nowNs = BigInt(ctx.nowMs ? ctx.nowMs() : Date.now()) * 1000000n;
  if (expiresAt <= nowNs) {
    return refused(
      "expires_at_ns must be strictly in the future, the contract rejects an already-expired obligation with ERR_OBLIGATION_EXPIRED",
    );
  }
  if (!isDecimalString(input.nonce)) {
    return refused("nonce must be a decimal string: " + JSON.stringify(input.nonce));
  }
  let nonce: bigint;
  try {
    nonce = BigInt(input.nonce);
  } catch {
    return refused("nonce is not a valid decimal string: " + JSON.stringify(input.nonce));
  }
  if (nonce > (1n << 64n) - 1n) {
    return refused("nonce is outside the u64 range");
  }
  let policyRow: unknown;
  try {
    policyRow = await ctx.client.getPolicy(input.policy_id as string);
  } catch (error) {
    return refused(
      "policy check failed, the policy could not be read from the chain: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  const policy = obligationRow(policyRow);
  if (policy === null) {
    return refused("policy " + input.policy_id + " does not exist on the vault");
  }
  if (policy.frozen === true) {
    return refused("policy " + input.policy_id + " is frozen, the contract rejects creation with ERR_POLICY_FROZEN");
  }
  const policyEcho = verifyEcho(policyRow, "policy_id", input.policy_id as string);
  if (!policyEcho.ok) {
    return refused(policyEcho.reason + ", the policy read cannot be trusted");
  }
  let existing: unknown;
  try {
    existing = await ctx.client.getObligation(input.obligation_id as string);
  } catch (error) {
    return refused(
      "obligation check failed, the obligation could not be read from the chain: " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  if (obligationRow(existing) !== null) {
    const existingEcho = verifyEcho(existing, "obligation_id", input.obligation_id as string);
    if (!existingEcho.ok) {
      return refused(existingEcho.reason + ", the obligation read cannot be trusted");
    }
    return refused(
      "obligation_id " + input.obligation_id + " already exists on chain, the contract rejects it with ERR_OBLIGATION_EXISTS",
    );
  }
  let createArgs: unknown;
  try {
    const file: ObligationFile = {
      obligation_id: input.obligation_id as string,
      policy_id: input.policy_id as string,
      recipient: input.recipient as string,
      amount: input.amount as string,
      evidence_type: input.evidence_type as string,
      evidence_hash: (input.evidence_hash as string).toLowerCase(),
      expires_at_ns: input.expires_at_ns as string,
      nonce: input.nonce as string,
      evidence_ref: "",
    };
    createArgs = createObligationArgs(file);
  } catch (error) {
    return refused(
      "terms failed the contract argument check: " + (error instanceof Error ? error.message : String(error)),
    );
  }
  const summary =
    "Prepare obligation " +
    input.obligation_id +
    ": pay " +
    amount.toString() +
    " base units of the policy token to " +
    input.recipient +
    ", evidence type " +
    input.evidence_type +
    ", evidence hash " +
    (input.evidence_hash as string).toLowerCase() +
    ", expiry " +
    expiresAt.toString() +
    " ns, policy " +
    input.policy_id +
    ", nonce " +
    nonce.toString() +
    ".";
  return succeeded("Prepared, not authorized or submitted", {
    status: "prepared",
    label: "Prepared, not authorized or submitted",
    create_obligation_args: createArgs,
    summary,
    note: "Validation is a check against current state, not a guarantee that a later transaction will succeed. The owner must review the summary and the exact arguments and sign with the owner key through the console; this server holds no owner key and submits nothing.",
  });
}

export async function getObligation(
  ctx: McpContext,
  args: { obligation_id: unknown },
): Promise<ToolResult> {
  if (!isValidObligationId(args.obligation_id)) {
    return refused(
      "obligation_id must be 1 to 64 characters of letters, digits, dot, underscore, or hyphen: " +
        JSON.stringify(args.obligation_id),
    );
  }
  let row: unknown;
  try {
    row = await ctx.client.getObligation(args.obligation_id as string);
  } catch (error) {
    return refused(
      "obligation read failed: " + (error instanceof Error ? error.message : String(error)),
    );
  }
  const record = obligationRow(row);
  if (record === null) {
    return refused("obligation " + args.obligation_id + " not found on chain");
  }
  const echo = verifyEcho(row, "obligation_id", args.obligation_id as string);
  if (!echo.ok) {
    return refused(echo.reason + ", the obligation read cannot be trusted");
  }
  return succeeded("obligation " + args.obligation_id + " read, state " + rowState(row), record);
}

export async function listReceipts(
  ctx: McpContext,
  args: { start?: unknown; limit?: unknown },
): Promise<ToolResult> {
  const start = args.start === undefined ? 0 : args.start;
  const limit = args.limit === undefined ? 20 : args.limit;
  if (typeof start !== "number" || !Number.isInteger(start) || start < 0) {
    return refused("start must be a non-negative integer: " + JSON.stringify(args.start));
  }
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_RECEIPTS_LIMIT) {
    return refused("limit must be an integer from 1 to 100: " + JSON.stringify(args.limit));
  }
  let rows: unknown;
  try {
    rows = await ctx.client.receipts(BigInt(start), BigInt(limit));
  } catch (error) {
    return refused(
      "receipts read failed: " + (error instanceof Error ? error.message : String(error)),
    );
  }
  return succeeded("receipts read from the chain, " + (Array.isArray(rows) ? rows.length : 0) + " rows", {
    receipts: rows,
    note: "Receipts are returned as read from the chain; the prev_hash chain is verified by the CLI verify-live, not by this tool.",
  });
}

export async function getPolicy(
  ctx: McpContext,
  args: { policy_id: unknown },
): Promise<ToolResult> {
  if (!isValidPolicyId(args.policy_id)) {
    return refused("policy_id is not valid: " + JSON.stringify(args.policy_id));
  }
  try {
    const policy = await ctx.client.getPolicy(args.policy_id as string);
    const balances = await ctx.client.balances(args.policy_id as string);
    const state = await ctx.client.state();
    if (obligationRow(policy) === null) {
      return refused("policy " + args.policy_id + " does not exist on the vault");
    }
    const echo = verifyEcho(policy, "policy_id", args.policy_id as string);
    if (!echo.ok) {
      return refused(echo.reason + ", the policy read cannot be trusted");
    }
    return succeeded("policy " + args.policy_id + " read", {
      policy,
      balances,
      vault_state: state,
    });
  } catch (error) {
    return refused(
      "policy read failed: " + (error instanceof Error ? error.message : String(error)),
    );
  }
}

export interface RequestSettlementInput {
  obligation_id: unknown;
  proposed_recipient: unknown;
  proposed_amount: unknown;
  evidence_ref: unknown;
}

/**
 * The only tool that moves funds. In order, and it stops at the
 * first refusal: read the obligation, verify it echoes the
 * requested id, and refuse unless READY; read the policy, verify
 * it echoes the obligation policy id, and refuse off chain when
 * the budget does not cover the amount; run the runtime integrity
 * checks (network, vault code hash, signing key scope and
 * allowance); run the reputation gate on the proposed recipient
 * (BLOCK refuses, WARN escalates and never approves itself);
 * rate limit; build the settle arguments with buildSettle; read
 * the recipient balance; submit settle with the scoped key; poll
 * until PAID; read the receipt and the balance delta, which must
 * equal the obligation amount. Before any submit it also refuses
 * off chain when the obligation is expired or the policy is
 * frozen. Every refusal carries the stage it stopped at
 * (validation, read, ready, echo, terms, budget, runtime,
 * reputation, rate-limit, balance, submit), so a caller can tell
 * whether the attempt reached the runtime checks without parsing
 * the reason string.
 *
 * Changed terms are deliberately not refused here: the vault
 * must see the attempt and reject it on chain with
 * ERR_RECIPIENT_SUBSTITUTION or ERR_TERMS_MISMATCH, and that
 * rejection is returned with its transaction hash. A cooperative
 * refusal by the server is not proof the vault withstands a
 * compromised agent; the vault rejection is.
 */
export async function requestSettlement(
  ctx: McpContext,
  input: RequestSettlementInput,
  limiter: SettleRateLimiter,
): Promise<ToolResult> {
  if (!isValidObligationId(input.obligation_id)) {
    return refusedAt("obligation_id is not valid: " + JSON.stringify(input.obligation_id), "validation");
  }
  if (!isValidAccountId(input.proposed_recipient)) {
    return refusedAt("proposed_recipient is not a valid NEAR account id: " + JSON.stringify(input.proposed_recipient), "validation");
  }
  if (!isDecimalString(input.proposed_amount)) {
    return refusedAt("proposed_amount must be a decimal string: " + JSON.stringify(input.proposed_amount), "validation");
  }
  let proposedAmount: bigint;
  try {
    proposedAmount = BigInt(input.proposed_amount);
  } catch {
    return refusedAt("proposed_amount is not a valid decimal string: " + JSON.stringify(input.proposed_amount), "validation");
  }
  if (proposedAmount <= 0n) {
    return refusedAt("proposed_amount must be greater than zero", "validation");
  }
  if (proposedAmount > (1n << 128n) - 1n) {
    return refusedAt("proposed_amount is outside the u128 range", "validation");
  }
  if (typeof input.evidence_ref !== "string" || input.evidence_ref.length > 256) {
    return refusedAt("evidence_ref must be a string of at most 256 characters", "validation");
  }
  const obligationId = input.obligation_id as string;
  let row: unknown;
  try {
    row = await ctx.client.getObligation(obligationId);
  } catch (error) {
    return refusedAt(
      "obligation read failed: " + (error instanceof Error ? error.message : String(error)),
      "read",
    );
  }
  const obligation = obligationRow(row);
  if (obligation === null) {
    return refusedAt("obligation " + obligationId + " not found on chain, no settle attempted", "read");
  }
  const state = rowState(row);
  if (state !== "READY") {
    return refusedAt(
      "obligation " + obligationId + " is " + state + ", not READY; the server settles READY obligations only, no settle attempted",
      "ready",
    );
  }
  const recipient = String(obligation.recipient);
  const policyId = String(obligation.policy_id);
  const obligationEcho = verifyEcho(row, "obligation_id", obligationId);
  if (!obligationEcho.ok) {
    return refusedAt(obligationEcho.reason + ", no settle attempted", "echo");
  }
  // The obligation fields are validated before they are trusted: a
  // malformed view response must refuse with a named reason, never
  // throw out of the settle path or coerce a missing field to the
  // literal string "undefined".
  let amount: bigint;
  try {
    amount = toChainBigInt(obligation.amount, "amount");
  } catch (error) {
    return refusedAt(
      "obligation " +
        obligationId +
        " has an unreadable amount on chain, no settle attempted: " +
        (error instanceof Error ? error.message : String(error)),
      "read",
    );
  }
  if (amount <= 0n || amount > (1n << 128n) - 1n) {
    return refusedAt(
      "obligation " +
        obligationId +
        " has an amount outside the u128 range on chain, no settle attempted",
      "read",
    );
  }
  if (!isValidAccountId(recipient)) {
    return refusedAt(
      "obligation " +
        obligationId +
        " has an unreadable recipient on chain, no settle attempted",
      "read",
    );
  }
  if (!isValidPolicyId(policyId)) {
    return refusedAt(
      "obligation " +
        obligationId +
        " has an unreadable policy id on chain, no settle attempted",
      "read",
    );
  }
  // The policy is read here, before the gate and the rate limit, so
  // the budget check and the token id come from the same fresh read
  // the settle will use. The policy token is the only token the
  // settle can pay: there is no token input, so a wrong token
  // cannot be injected through this tool.
  let policyRow: unknown;
  try {
    policyRow = await ctx.client.getPolicy(policyId);
  } catch (error) {
    return refusedAt(
      "policy read failed, no settle attempted: " +
        (error instanceof Error ? error.message : String(error)),
      "read",
    );
  }
  const policy = obligationRow(policyRow);
  if (policy === null) {
    return refusedAt("policy " + policyId + " does not exist on the vault, no settle attempted", "read");
  }
  const policyEcho = verifyEcho(policyRow, "policy_id", policyId);
  if (!policyEcho.ok) {
    return refusedAt(policyEcho.reason + ", no settle attempted", "echo");
  }
  if (typeof policy.token_id !== "string") {
    return refusedAt("policy " + policyId + " has no token_id on chain, no settle attempted", "read");
  }
  // Off-chain expiry and frozen checks, before any submit: the
  // contract enforces both with ERR_OBLIGATION_EXPIRED and
  // ERR_POLICY_FROZEN, but refusing here saves a doomed submission
  // and its gas, and names the reason in plain terms. The expiry
  // check uses host time, which is not chain time, so it only
  // refuses when the obligation expired more than 60 seconds ago:
  // that bounds any host clock skew, and the contract stays the
  // authority on the exact boundary (it refuses when the block
  // timestamp passes expires_at_ns). The expiry is read with
  // parseChainTimestampNs, not toChainBigInt: the chain returns it
  // as a JSON number above 2^53, and the strict helper would refuse
  // every live obligation at stage "read" with an unreadable expiry.
  const nowNs = BigInt(ctx.nowMs ? ctx.nowMs() : Date.now()) * 1000000n;
  let expiresAt: bigint;
  try {
    expiresAt = parseChainTimestampNs(obligation.expires_at_ns, "expires_at_ns");
  } catch (error) {
    return refusedAt(
      "obligation " +
        obligationId +
        " has an unreadable expiry on chain, no settle attempted: " +
        (error instanceof Error ? error.message : String(error)),
      "read",
    );
  }
  if (expiresAt + 60_000_000_000n < nowNs) {
    return refusedAt(
      "obligation " + obligationId + " expired more than 60 seconds ago, no settle attempted",
      "terms",
    );
  }
  if (policy.frozen === true) {
    return refusedAt(
      "policy " + policyId + " is frozen on chain, no settle attempted",
      "terms",
    );
  }
  let budget: { ok: boolean; reason: string };
  try {
    budget = checkBudget(policy, amount);
  } catch (error) {
    return refusedAt(
      "budget check failed, the policy figures could not be read: " +
        (error instanceof Error ? error.message : String(error)) +
        ", no settle attempted",
      "budget",
    );
  }
  if (!budget.ok) {
    return refusedAt(budget.reason + ", no settle attempted", "budget");
  }
  // Runtime integrity checks, re-read for every settle: network,
  // vault existence and code hash, signing key scope and allowance
  // against the live gas price. Any failure refuses the settle
  // before the reputation gate and before any transaction is built.
  let runtime: RuntimeState;
  try {
    runtime = await ctx.runtimeState();
  } catch (error) {
    return refusedAt(
      "runtime checks could not be read from the chain: " +
        (error instanceof Error ? error.message : String(error)) +
        ", no settle attempted; retrying the call re-runs the checks",
      "runtime",
    );
  }
  const integrity = verifyRuntimeState(runtime, {
    rpcUrl: ctx.config.rpcUrl,
    vaultId: ctx.config.vaultId,
    agentPublicKey: ctx.agentPublicKey,
    sandbox: ctx.config.sandbox,
    expectedChainId: ctx.config.expectedChainId,
    expectedVaultCodeHash: ctx.config.expectedVaultCodeHash,
  });
  if (!integrity.ok) {
    return refusedAt(integrity.reason + ", no settle attempted", "runtime");
  }
  let report: ReputationReport;
  try {
    report = await ctx.checkCounterparty(input.proposed_recipient as string);
  } catch (error) {
    return refusedAt(
      "counterparty check failed, no settle attempted: " +
        (error instanceof Error ? error.message : String(error)),
      "reputation",
    );
  }
  // approve_warning is not named in the escalation on purpose: it moves a
  // WARN_PENDING obligation (the evidence path) to READY, and a reputation
  // WARN leaves the obligation READY, so it cannot apply. The console with
  // CYNEX_APPROVE_WARN=1 is the owner path for a reputation WARN.
  const gate = gateSettleOnReputation(report, { approveWarn: false });
  if (gate.decision !== "proceed") {
    return refusedAt(
      "MCP reputation gate refused the request: " +
        gate.reason +
        (gate.decision === "escalate"
          ? ". The owner must approve the warning through the console with CYNEX_APPROVE_WARN=1; this server never approves a warning itself."
          : ""),
      "reputation",
    );
  }
  const rate = limiter.check(obligationId);
  if (!rate.allowed) {
    return refusedAt(rate.reason + ", no settle attempted", "rate-limit");
  }
  const tokenId = policy.token_id as string;
  let beforeBalance: bigint;
  try {
    beforeBalance = await ctx.tokenBalance(tokenId, recipient);
  } catch (error) {
    return refusedAt(
      "recipient balance read failed, no settle attempted: " +
        (error instanceof Error ? error.message : String(error)),
      "balance",
    );
  }
  const settle = buildSettle({
    obligation_id: obligationId,
    proposed_recipient: input.proposed_recipient as string,
    proposed_amount: proposedAmount,
    evidence_ref: input.evidence_ref as string,
  });
  let txHash: string;
  try {
    txHash = await ctx.settleWithKey(settle);
  } catch (error) {
    const hash = txHashFromError(error);
    const message = error instanceof Error ? error.message : String(error);
    if (hash === "unknown") {
      // No transaction hash came back, so the submission may never have
      // reached the chain or its outcome may have been lost in transit.
      // That is not evidence the vault refused, and it is not evidence
      // the settle failed, so neither claim is made here.
      return refusedAt(
        "settle submission outcome is unknown, no transaction hash was returned: " +
          message +
          ". The settle may or may not have executed; do not treat this as a refusal or a success. Check the obligation with cynex_get_obligation and the receipts with cynex_list_receipts before retrying.",
        "submit",
      );
    }
    // A hash means the transaction reached the chain. Re-read the
    // obligation before claiming anything: if it reads PAID, the settle
    // succeeded despite the submission error, and "no funds moved"
    // would be false. If it cannot be re-read, the outcome is unknown.
    // A readable non-PAID state on its own proves neither a refusal
    // nor a failure: the callback that marks PAID can still land
    // after the re-read. Only an error that names a contract refusal
    // code (an ERR_ code) proves the vault refused: every check that
    // panics with an ERR_ code runs before the ft_transfer promise,
    // so the receipt created no promise and no callback can follow
    // it. A bare panic names no check site, so it proves nothing
    // about where the panic happened, and the outcome is unknown.
    let current: unknown = null;
    let readFailed = false;
    try {
      current = await ctx.client.getObligation(obligationId);
    } catch {
      readFailed = true;
    }
    if (!readFailed && current !== null && rowState(current) === "PAID") {
      return refusedAt(
        "settle submitted (transaction hash " + hash + ") but the submission returned an error: " +
          message +
          ". The obligation now reads PAID, so the settle may have succeeded despite the error; do not treat this as a refusal. Check the receipt with cynex_list_receipts and the balance before reporting success.",
        "submit",
      );
    }
    if (readFailed || current === null) {
      return refusedAt(
        "settle submitted (transaction hash " + hash + ") but the submission returned an error: " +
          message +
          ". The obligation could not be re-read, so the outcome is unknown; do not treat this as a refusal or a success. Check the obligation and the receipts on chain before retrying.",
        "submit",
      );
    }
    const contractCode = /ERR_[A-Z_]+/.exec(message);
    if (contractCode !== null) {
      return refusedAt(
        "the vault refused the settle, no funds moved: " + message + " (settle transaction hash " + hash + ")",
        "submit",
      );
    }
    // No ERR_ code: the error names no contract refusal. A bare
    // panic is not evidence either way, it names no check site, so
    // the outcome is unknown and no "no funds moved" claim is made.
    return refusedAt(
      "settle submitted (transaction hash " + hash + ") but the submission returned an error: " +
        message +
        ". The obligation still reads " + rowState(current) + ", not PAID, and the error names no contract refusal code, so the outcome is unknown; the callback that marks PAID can arrive late. Do not treat this as a refusal or a success. Check the obligation with cynex_get_obligation and the receipts with cynex_list_receipts before retrying.",
      "submit",
    );
  }
  const intervalMs = ctx.pollIntervalMs ?? 2000;
  const maxAttempts = ctx.pollMaxAttempts ?? 30;
  let paidRow: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let current: unknown;
    try {
      current = await ctx.client.getObligation(obligationId);
    } catch {
      current = null;
    }
    if (current !== null && rowState(current) === "PAID") {
      paidRow = current;
      break;
    }
    if (attempt < maxAttempts) {
      await sleepMs(intervalMs);
    }
  }
  if (paidRow === null) {
    return refusedAt(
      "settle submitted (transaction hash " + txHash + ") but the obligation did not read PAID within the poll window; do not treat this as a success. Recover manually: check the obligation with cynex_get_obligation and the receipts with cynex_list_receipts. There is no idempotency or lookup-by-tx-hash tool, so do not retry blindly until the on-chain state is known",
      "submit",
    );
  }
  let afterBalance: bigint;
  try {
    afterBalance = await ctx.tokenBalance(tokenId, recipient);
  } catch (error) {
    return refusedAt(
      "settle submitted (transaction hash " + txHash + ") and the obligation reads PAID, but the recipient balance could not be read: " +
        (error instanceof Error ? error.message : String(error)),
      "balance",
    );
  }
  const delta = afterBalance - beforeBalance;
  if (delta !== amount) {
    return refusedAt(
      "the obligation reads PAID (settle transaction hash " +
        txHash +
        ") but the recipient balance delta " +
        delta.toString() +
        " does not equal the obligation amount " +
        amount.toString() +
        "; a concurrent settle to the same recipient, or a transfer outside the vault, can produce this. Do not report success; check the receipts on chain before retrying",
      "submit",
    );
  }
  let receiptIndex: unknown = null;
  let receiptIndexUnreadable = false;
  try {
    let start = 0n;
    for (;;) {
      const page = (await ctx.client.receipts(start, 100n)) as Array<Record<string, unknown>>;
      if (!Array.isArray(page) || page.length === 0) {
        break;
      }
      const found = page.find((r) => r.obligation_id === obligationId);
      if (found !== undefined) {
        if ((typeof found.index === "number" && Number.isSafeInteger(found.index) && found.index >= 0) || (typeof found.index === "string" && /^[0-9]+$/.test(found.index))) {
          receiptIndex = found.index;
        } else {
          receiptIndexUnreadable = true;
        }
        break;
      }
      start += BigInt(page.length);
      if (page.length < 100) {
        break;
      }
    }
  } catch {
    receiptIndex = null;
  }
  if (receiptIndexUnreadable) {
    return refusedAt(
      "settle submitted (transaction hash " + txHash + ") and the obligation reads PAID with the correct balance delta, but the receipt for " +
        obligationId +
        " has an unreadable index; do not report success without a receipt index",
      "submit",
    );
  }
  if (receiptIndex === null) {
    return refusedAt(
      "settle submitted (transaction hash " + txHash + ") and the obligation reads PAID with the correct balance delta, but no receipt for " +
        obligationId +
        " could be read; do not report success without the receipt",
      "submit",
    );
  }
  return succeeded("obligation " + obligationId + " settled and PAID", {
    obligation_id: obligationId,
    receipt_index: String(receiptIndex),
    settle_tx_hash: txHash,
    state: "PAID",
    balance_before: beforeBalance.toString(),
    balance_after: afterBalance.toString(),
    balance_delta: delta.toString(),
    amount: amount.toString(),
  }, "success");
}

/**
 * Dispatch one tool call by name. The server registers each tool
 * through this dispatch, and the tests call it directly.
 */
export async function dispatchTool(
  ctx: McpContext,
  limiter: SettleRateLimiter,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case "cynex_check_counterparty":
      return checkCounterparty(ctx, { account_id: args.account_id });
    case "cynex_prepare_obligation":
      return prepareObligation(ctx, {
        policy_id: args.policy_id,
        obligation_id: args.obligation_id,
        recipient: args.recipient,
        amount: args.amount,
        evidence_type: args.evidence_type,
        evidence_hash: args.evidence_hash,
        expires_at_ns: args.expires_at_ns,
        nonce: args.nonce,
      });
    case "cynex_request_settlement":
      return requestSettlement(
        ctx,
        {
          obligation_id: args.obligation_id,
          proposed_recipient: args.proposed_recipient,
          proposed_amount: args.proposed_amount,
          evidence_ref: args.evidence_ref,
        },
        limiter,
      );
    case "cynex_get_obligation":
      return getObligation(ctx, { obligation_id: args.obligation_id });
    case "cynex_list_receipts":
      return listReceipts(ctx, { start: args.start, limit: args.limit });
    case "cynex_get_policy":
      return getPolicy(ctx, { policy_id: args.policy_id });
    default:
      return refused("unknown tool: " + name);
  }
}
