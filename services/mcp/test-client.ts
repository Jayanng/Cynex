/**
 * Cynex MCP SDK test client, the canonical reproduction path.
 *
 * Uses the official MCP SDK Client to connect to the server over
 * stdio and call the tools, printing each call and its response.
 * This is the deterministic reproduction path: the same calls a
 * real agent makes, without depending on a live agent session.
 * The real-agent proof (Claude Code) comes after this client
 * proves the tools behave as documented.
 *
 * Default run calls the five tools that move no funds:
 * cynex_check_counterparty, cynex_get_policy,
 * cynex_list_receipts, cynex_get_obligation, and
 * cynex_prepare_obligation. It never settles unless asked.
 *
 * The policy id for the read-only calls and the prepare call is
 * resolved in this order: --policy <id>, the policy id read from
 * the --obligation fixture on chain (or the --settle obligation
 * when the run is a settle), CYNEX_POLICY, and otherwise the
 * client refuses with a message naming --policy. No policy id
 * is hardcoded: the test vault policy and the production policy
 * differ, and a hardcoded id would silently read the wrong one.
 * The settle path already reads the policy from the obligation on
 * chain; this gives the read-only path the same treatment.
 *
 * Usage, from frontend/ after npm run mcp:build, with the same
 * CYNEX_* environment the server needs:
 *
 *   node dist-test/services/mcp/test-client.js
 *   (the bare run needs a policy source: --policy, --obligation, or CYNEX_POLICY)
 *   node dist-test/services/mcp/test-client.js --obligation <id>
 *   node dist-test/services/mcp/test-client.js --policy <id>
 *   node dist-test/services/mcp/test-client.js --settle <obligation-id> <recipient> <amount> <evidence-ref>
 *   node dist-test/services/mcp/test-client.js --matrix [--matrix-obligation <id>] [--matrix-settle <id> <recipient> <amount> <evidence-ref>] [--matrix-negative <id> <recipient> <amount> <evidence-ref>] [--matrix-blocked <id> <recipient> <amount> <evidence-ref>] [--matrix-out <file>]
 *
 * The --settle form is the live settle proof and is only run
 * after review, against a READY obligation on the test vault.
 * Before every live settle the client prints the exact remaining
 * budget from the policy on chain, and the vault guard refuses
 * mismatched terms against the production vault: production is
 * for the clean happy path and at most one carefully selected
 * security failure, never exploratory testing. The one selected
 * production security failure needs the explicit flag
 * --allow-production-negative. The server path is resolved next
 * to this script, so the command works from any working
 * directory.
 *
 * The --matrix form runs the production acceptance matrix from
 * services/mcp/acceptance-matrix.md and records one result per
 * row, with transaction hashes. Rows without a fixture are
 * recorded as skipped, never as passed. No live settle runs in
 * this task; the matrix runner is the deliverable, and the live
 * proof runs it after the focused re-review.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import path from "node:path";

const TEST_VAULT = "cynex-testvault.cynexmaster.testnet";
const PROD_VAULT = "cynex-vault.cynexmaster.testnet";
const TEST_AGENT = "cynex-agent.cynexmaster.testnet";

function serverPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, "server.js");
}

function envRecord(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  console.log("CALL " + name + " " + JSON.stringify(args));
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ text?: string }> | undefined)
    ?.map((c) => c.text ?? "")
    .join("\n");
  console.log("RESPONSE " + name + " isError=" + String(result.isError) + " " + (text ?? ""));
  try {
    return JSON.parse(text ?? "{}") as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}


/**
 * Resolve the policy id for the read-only calls and the prepare
 * call. Order: an explicit --policy flag, the policy id read from
 * the --obligation fixture on chain, CYNEX_POLICY, and otherwise
 * a refusal naming --policy. The reader is the obligation row as
 * the chain returns it (the same shape the settle path reads), so
 * the unit tests can pass a plain object and the live client can
 * pass its cynex_get_obligation call.
 */
export type ObligationPolicyReader = (
  obligationId: string,
) => Promise<Record<string, unknown>>;

/**
 * The obligation the policy id is read from: --obligation when
 * given, otherwise the --settle obligation (a plain settle run
 * carries no --obligation), otherwise nothing to read from.
 */
export function pickResolverObligationId(
  obligationId: string | undefined,
  settleArgs: string[] | undefined,
): string | undefined {
  if (obligationId !== undefined) {
    return obligationId;
  }
  if (settleArgs !== undefined && settleArgs.length > 0) {
    return settleArgs[0];
  }
  return undefined;
}

/**
 * The obligation the matrix policy id is read from:
 * --matrix-obligation when given, otherwise the first fixture
 * obligation on the command line (--matrix-settle,
 * --matrix-negative, --matrix-negative-amount, --matrix-overbudget,
 * --matrix-blocked). A documented --matrix --matrix-settle run
 * carries no --matrix-obligation, and its own fixture obligation
 * is the right source.
 */
export function pickMatrixResolverObligationId(
  matrixObligation: string | undefined,
  fixtures: Array<string[] | undefined>,
): string | undefined {
  if (matrixObligation !== undefined) {
    return matrixObligation;
  }
  for (const fixture of fixtures) {
    if (fixture !== undefined && fixture.length > 0) {
      return fixture[0];
    }
  }
  return undefined;
}

export async function resolvePolicyId(
  readObligation: ObligationPolicyReader,
  opts: { policyFlag?: string; obligationId?: string; envPolicy?: string },
): Promise<string> {
  if (opts.policyFlag !== undefined && opts.policyFlag !== "") {
    return opts.policyFlag;
  }
  if (opts.obligationId !== undefined) {
    const row = await readObligation(opts.obligationId);
    const policyId = row.policy_id;
    if (typeof policyId === "string" && policyId !== "") {
      return policyId;
    }
    throw new Error(
      "cannot resolve the policy id: the obligation " +
        opts.obligationId +
        " has no policy id on chain, pass --policy <id> explicitly",
    );
  }
  if (opts.envPolicy !== undefined && opts.envPolicy !== "") {
    return opts.envPolicy;
  }
  throw new Error(
    "cannot resolve the policy id: pass --policy <id>, or --obligation <id> to read it " +
      "from the obligation on chain, or set CYNEX_POLICY",
  );
}

// A flag with no value (last on the command line, or followed by
// another flag) yields nothing instead of swallowing the next
// flag as its value. Shared by the normal runner and the matrix
// runner, which parse argv separately.
export function flagValue(argv: string[], index: number): string | undefined {
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  return value !== undefined && !value.startsWith("--") ? value : undefined;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const obligationId = flagValue(argv, argv.indexOf("--obligation"));
  const policyFlag = flagValue(argv, argv.indexOf("--policy"));
  const settleIndex = argv.indexOf("--settle");
  const settleArgs = settleIndex >= 0 ? argv.slice(settleIndex + 1, settleIndex + 5) : undefined;
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath()],
    env: envRecord(),
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write("[server] " + chunk.toString());
  });
  const client = new Client({ name: "cynex-test-client", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  console.log("connected to the Cynex MCP server over stdio");
  if (argv.includes("--matrix")) {
    const code = await runMatrix(client, argv);
    await client.close();
    return code;
  }
  const tools = await client.listTools();
  console.log("TOOLS " + tools.tools.map((t: { name: string }) => t.name).join(", "));
  // The policy id is resolved before any read-only call, in the
  // order documented on resolvePolicyId. The obligation it is read
  // from is --obligation when given, otherwise the --settle
  // obligation: a plain settle run carries no --obligation, and
  // its own obligation is the right source. Resolving only from
  // --obligation would make a documented --settle invocation fail
  // here before settlement runs. A failure refuses the run before
  // any call that needs a policy id.
  const resolverObligationId = pickResolverObligationId(obligationId, settleArgs);
  const policyId = await resolvePolicyId(
    async (id: string): Promise<Record<string, unknown>> => {
      const out = await call(client, "cynex_get_obligation", { obligation_id: id });
      return (out.data ?? {}) as Record<string, unknown>;
    },
    { policyFlag, obligationId: resolverObligationId, envPolicy: process.env.CYNEX_POLICY },
  );
  await call(client, "cynex_check_counterparty", { account_id: TEST_AGENT });
  await call(client, "cynex_get_policy", { policy_id: policyId });
  await call(client, "cynex_list_receipts", { start: 0, limit: 5 });
  if (obligationId !== undefined) {
    await call(client, "cynex_get_obligation", { obligation_id: obligationId });
  }
  const prepareId = "mcp-test-" + Date.now().toString();
  await call(client, "cynex_prepare_obligation", {
    policy_id: policyId,
    obligation_id: prepareId,
    recipient: TEST_AGENT,
    amount: "100",
    evidence_type: "PREIMAGE",
    evidence_hash: "f23aeaa4efc068df8a05ef97c1ade88022575ad5ea52dbe9af218028462d4e27",
    expires_at_ns: (BigInt(Date.now()) * 1000000n + 3600000000000n).toString(),
    nonce: "90001",
  });
  if (settleArgs !== undefined && settleArgs.length === 4) {
    const [id, recipient, amount, evidenceRef] = settleArgs as [string, string, string, string];
    const vaultId = process.env.CYNEX_VAULT ?? TEST_VAULT;
    const allowProductionNegative = argv.includes("--allow-production-negative");
    const obligationOut = await call(client, "cynex_get_obligation", { obligation_id: id });
    const obligationData = (obligationOut.data ?? {}) as Record<string, unknown>;
    if (typeof obligationData.obligation_id !== "string") {
      console.log("refusing to settle: the obligation could not be read from the chain, terms cannot be verified");
      await client.close();
      return 1;
    }
    if (typeof obligationData.policy_id !== "string") {
      console.log("refusing to settle: the obligation has no policy id on chain, the budget cannot be verified");
      await client.close();
      return 1;
    }
    const policyOut = await call(client, "cynex_get_policy", { policy_id: obligationData.policy_id });
    const policyData = (policyOut.data ?? {}) as Record<string, unknown>;
    const policyRow = policyData.policy as Record<string, unknown> | undefined;
    if (policyRow === undefined || String(policyRow.policy_id ?? "") !== obligationData.policy_id) {
      console.log("refusing to settle: the policy " + obligationData.policy_id + " could not be read from the chain or did not echo the requested id, the budget cannot be verified");
      await client.close();
      return 1;
    }
    console.log("BUDGET " + budgetLine(policyRow) + " (proposed amount " + amount + ")");
    const guard = guardSettle(vaultId, obligationData, recipient, amount, allowProductionNegative);
    console.log("GUARD vault " + vaultId + ": " + guard.reason);
    if (!guard.allowed) {
      console.log("refusing to settle: " + guard.reason);
      await client.close();
      return 1;
    }
    await call(client, "cynex_request_settlement", {
      obligation_id: id,
      proposed_recipient: recipient,
      proposed_amount: amount,
      evidence_ref: evidenceRef,
    });
    await call(client, "cynex_get_obligation", { obligation_id: id });
    await call(client, "cynex_list_receipts", { start: 0, limit: 5 });
  } else if (settleArgs !== undefined) {
    console.log("ignoring --settle: expected 4 arguments, got " + settleArgs.length);
  }
  await client.close();
  console.log("test client done, vault " + TEST_VAULT + ", no funds moved unless --settle was passed");
  return 0;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error("test client failed: " + (error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    });
}

/**
 * Vault guard for live settles. The client reads the obligation
 * from the chain first and compares the proposed terms with the
 * recorded terms. On the production vault, mismatched terms are
 * refused outright, unless the operator explicitly selected this
 * one security failure with --allow-production-negative. On the
 * test vault, mismatched terms are allowed through, because the
 * vault must see the attempt and refuse it on chain. The guard
 * never approves anything on its own: it only refuses to start
 * a destructive or malformed case against production.
 */
export interface SettleGuard {
  allowed: boolean;
  reason: string;
  termsMatch: boolean;
}

function parseGuardAmount(value: unknown): bigint | null {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number"
        ? String(value)
        : null;
  if (text === null || !/^[0-9]+$/.test(text)) {
    return null;
  }
  try {
    return BigInt(text);
  } catch {
    return null;
  }
}

export function guardSettle(
  vaultId: string,
  obligation: Record<string, unknown>,
  proposedRecipient: string,
  proposedAmount: string,
  allowProductionNegative: boolean,
): SettleGuard {
  // Amounts compare numerically, not as strings: a leading-zero
  // proposed amount such as "0100" is the same 100 base units as the
  // recorded "100", and the settle path parses amounts with BigInt.
  // An unreadable term refuses outright on every vault, because terms
  // that cannot be verified cannot be allowed through.
  const recordedAmount = parseGuardAmount(obligation.amount);
  const proposed = parseGuardAmount(proposedAmount);
  if (
    typeof obligation.recipient !== "string" ||
    recordedAmount === null ||
    proposed === null
  ) {
    return {
      allowed: false,
      reason:
        "vault guard: the obligation terms cannot be verified, the recorded recipient or amount is unreadable or malformed",
      termsMatch: false,
    };
  }
  const termsMatch =
    obligation.recipient === proposedRecipient && recordedAmount === proposed;
  if (termsMatch) {
    return {
      allowed: true,
      reason: "terms match the obligation on chain, clean happy path",
      termsMatch,
    };
  }
  if (vaultId === PROD_VAULT && !allowProductionNegative) {
    return {
      allowed: false,
      reason:
        "production vault guard: the proposed terms do not match the obligation on chain, and production is for the clean happy path and at most one carefully selected security failure, never exploratory testing",
      termsMatch,
    };
  }
  if (vaultId === PROD_VAULT) {
    return {
      allowed: true,
      reason:
        "production vault: mismatched terms allowed only because --allow-production-negative was passed for this one selected security failure",
      termsMatch,
    };
  }
  return {
    allowed: true,
    reason: "test vault: mismatched terms allowed, the vault must see the attempt and refuse it on chain",
    termsMatch,
  };
}

/** One line with the exact remaining budget, from a policy row read on chain. */
export function budgetLine(policy: Record<string, unknown>): string {
  const spent = BigInt(String(policy.spent));
  const reserved = BigInt(String(policy.reserved));
  const limit = BigInt(String(policy.limit));
  const funded = BigInt(String(policy.funded));
  return (
    "policy " +
    String(policy.policy_id) +
    " spent " +
    spent.toString() +
    " reserved " +
    reserved.toString() +
    " limit " +
    limit.toString() +
    " funded " +
    funded.toString() +
    " remaining by limit " +
    (limit - spent - reserved).toString() +
    " remaining by funded " +
    (funded - spent - reserved).toString()
  );
}

/**
 * Verify one receipt row binds to the settled obligation: the row must
 * be for the settled obligation, carry the reported index, and agree
 * on recipient, amount, and token. A row with the right id and index
 * but different terms does not prove the settle.
 */
export function verifyReceiptRow(
  row: Record<string, unknown> | undefined,
  expected: { obligationId: string; recipient: string; amount: string; tokenId: string; index: string },
): { ok: boolean; reason: string } {
  if (row === undefined) {
    return { ok: false, reason: "no receipt row for " + expected.obligationId + " could be read" };
  }
  if (String(row.obligation_id ?? "") !== expected.obligationId) {
    return { ok: false, reason: "the receipt row is for a different obligation" };
  }
  if (String(row.index ?? "") !== expected.index || expected.index === "") {
    return { ok: false, reason: "the receipt row index does not match the reported receipt index" };
  }
  if (String(row.recipient ?? "") !== expected.recipient) {
    return { ok: false, reason: "the receipt row recipient does not match the settled recipient" };
  }
  if (String(row.amount ?? "") !== expected.amount) {
    return { ok: false, reason: "the receipt row amount does not match the settled amount" };
  }
  if (String(row.token_id ?? "") !== expected.tokenId) {
    return { ok: false, reason: "the receipt row token does not match the policy token" };
  }
  if (row.timestamp === undefined || row.timestamp === null || String(row.timestamp) === "") {
    return { ok: false, reason: "the receipt row has no timestamp" };
  }
  return { ok: true, reason: "the receipt row matches the settled obligation" };
}

/**
 * Verify the policy spent delta from two policy reads: both rows must
 * be for the same policy and carry a readable spent figure. A missing
 * spent field is a verification failure, never zero.
 */
export function verifySpentDelta(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  policyId: string,
  amount: string,
): { ok: boolean; reason: string } {
  if (before === null || before === undefined || after === null || after === undefined) {
    return { ok: false, reason: "the policy " + policyId + " could not be read before and after the settle" };
  }
  if (String(before.policy_id ?? "") !== policyId || String(after.policy_id ?? "") !== policyId) {
    return { ok: false, reason: "the policy rows are not for policy " + policyId };
  }
  const spentBefore = before.spent;
  const spentAfter = after.spent;
  if (spentBefore === undefined || spentBefore === null || spentAfter === undefined || spentAfter === null) {
    return { ok: false, reason: "the policy spent figure is missing on one of the reads" };
  }
  let beforeValue: bigint;
  let afterValue: bigint;
  try {
    beforeValue = BigInt(String(spentBefore));
    afterValue = BigInt(String(spentAfter));
  } catch {
    return { ok: false, reason: "the policy spent figure is not a readable integer on one of the reads" };
  }
  let amountValue: bigint;
  try {
    amountValue = BigInt(amount);
  } catch {
    return { ok: false, reason: "the settled amount is not a readable integer" };
  }
  if (afterValue - beforeValue !== amountValue) {
    return { ok: false, reason: "policy spent rose by " + (afterValue - beforeValue).toString() + ", not by the settled amount " + amount };
  }
  return { ok: true, reason: "policy spent rose by the settled amount" };
}

/**
 * Claim one production-negative use for this run. The first claim
 * succeeds and the count rises; any later claim is refused, so the
 * caller must not submit or print. The caller, not this helper,
 * enforces that the flag was passed at all.
 */
export function claimProductionNegativeUse(used: number): { allowed: boolean; used: number } {
  if (used >= 1) {
    return { allowed: false, used };
  }
  return { allowed: true, used: used + 1 };
}

/**
 * Production acceptance matrix runner. Each row records one
 * result with its layer, expected outcome, and transaction hash
 * when a transaction was submitted. Rows without a fixture are
 * recorded as skipped, never as passed. Rows that run outside
 * MCP (the scoped-key caller, the TDX quote, the VRF
 * signature) are recorded as external, with the exact command
 * to run. See services/mcp/acceptance-matrix.md for the row
 * definitions. Exit code 0 means every row that ran passed;
 * exit code 1 means at least one row that ran failed.
 */
export interface MatrixRowResult {
  row: string;
  layer: string;
  expected: string;
  outcome: "pass" | "fail" | "skipped" | "external";
  detail: string;
  txHash?: string;
}

type RowOutcome = { outcome: MatrixRowResult["outcome"]; detail: string; txHash?: string };

function matrixArgs(argv: string[], flag: string, count: number): string[] | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  const args = argv.slice(index + 1, index + 1 + count);
  return args.length === count ? args : undefined;
}

function txHashFromReason(reason: string): string | undefined {
  const match = /settle transaction hash ([A-Za-z0-9]+)/.exec(reason);
  return match === null ? undefined : match[1];
}

async function runMatrix(client: Client, argv: string[]): Promise<number> {
  const results: MatrixRowResult[] = [];
  function record(result: MatrixRowResult): void {
    results.push(result);
    console.log(
      "MATRIX " +
        result.row +
        " " +
        result.outcome +
        " [" +
        result.layer +
        "] " +
        result.detail +
        (result.txHash === undefined ? "" : " tx " + result.txHash),
    );
  }
  async function row(
    rowId: string,
    layer: string,
    expected: string,
    fn: () => Promise<RowOutcome>,
  ): Promise<void> {
    try {
      const r = await fn();
      record({ row: rowId, layer, expected, outcome: r.outcome, detail: r.detail, txHash: r.txHash });
    } catch (error) {
      record({
        row: rowId,
        layer,
        expected,
        outcome: "fail",
        detail: "runner error: " + (error instanceof Error ? error.message : String(error)),
      });
    }
  }

  // Stages of the settle path that run at or after the runtime
  // checks. A refusal carries its stage in the tool result, so
  // whether an attempt reached the runtime checks is read from the
  // stage, not guessed from the reason string. A success reached
  // them too: the runtime checks run before any submit.
  const RUNTIME_STAGES = new Set(["runtime", "reputation", "rate-limit", "balance", "submit", "success"]);
  function reachedRuntimeChecks(out: Record<string, unknown>): boolean {
    if (out.ok === true) {
      return true;
    }
    return typeof out.stage === "string" && RUNTIME_STAGES.has(out.stage);
  }
  const outFile = flagValue(argv, argv.indexOf("--matrix-out"));
  const vaultId = process.env.CYNEX_VAULT ?? TEST_VAULT;
  const allowProductionNegative = argv.includes("--allow-production-negative");
  const matrixObligation = flagValue(argv, argv.indexOf("--matrix-obligation"));
  const matrixPolicyFlag = flagValue(argv, argv.indexOf("--policy"));
  // The fixtures are parsed before the policy resolves: the
  // policy id is read from --matrix-obligation when given,
  // otherwise from the first fixture obligation on the command
  // line. A documented --matrix --matrix-settle run carries no
  // --matrix-obligation, and its own fixture obligation is the
  // right source; resolving only from --matrix-obligation would
  // fail that run before any row executes.
  const settleFixture = matrixArgs(argv, "--matrix-settle", 4);
  const negativeFixture = matrixArgs(argv, "--matrix-negative", 4);
  const negativeAmountFixture = matrixArgs(argv, "--matrix-negative-amount", 3);
  const overBudgetFixture = matrixArgs(argv, "--matrix-overbudget", 4);
  const blockedFixture = matrixArgs(argv, "--matrix-blocked", 4);
  // The matrix policy resolves the same way as the default run:
  // --policy, a fixture obligation on chain, then CYNEX_POLICY.
  // A failure here does not crash the runner: P2 and P4 record it
  // as a failed row, and the matrix JSON still gets written, so a
  // missing policy is visible, never silent.
  let matrixPolicy: string | undefined;
  let matrixPolicyError: string | undefined;
  try {
    matrixPolicy = await resolvePolicyId(
      async (id: string): Promise<Record<string, unknown>> => {
        const out = await call(client, "cynex_get_obligation", { obligation_id: id });
        return (out.data ?? {}) as Record<string, unknown>;
      },
      {
        policyFlag: matrixPolicyFlag,
        obligationId: pickMatrixResolverObligationId(matrixObligation, [
          settleFixture,
          negativeFixture,
          negativeAmountFixture,
          overBudgetFixture,
          blockedFixture,
        ]),
        envPolicy: process.env.CYNEX_POLICY,
      },
    );
  } catch (error) {
    matrixPolicyError = error instanceof Error ? error.message : String(error);
  }
  // What the matrix actually proved, tracked per attempt, not per
  // row: whether any settle attempt reached the runtime checks, and
  // how many BUDGET lines were printed before live attempts. A
  // refusal before the runtime checks (not READY, budget, echo)
  // never sets runtimeChecksReached, so M13 cannot pass on it.
  let runtimeChecksReached = false;
  let liveAttempts = 0;
  let budgetLines = 0;
  let productionNegativeUsed = 0;
  let settledEvidenceType = "";
  let settledId: string | undefined;
  let settledRecipient = "";
  let settledAmount = "";
  let settledTxHash: string | undefined;
  let matrixState = "";
  let matrixRecipient = "";
  let matrixAmount = "";
  let nonReadyAttempt: RowOutcome | undefined;

  await row("P1", "reputation gate", "counterparty check returns a verdict with signals", async () => {
    const out = await call(client, "cynex_check_counterparty", { account_id: TEST_AGENT });
    const data = (out.data ?? {}) as Record<string, unknown>;
    if (out.ok !== true || typeof data.verdict !== "string") {
      return { outcome: "fail", detail: String(out.reason) };
    }
    return { outcome: "pass", detail: "verdict " + String(data.verdict) };
  });
  await row("P2", "server", "policy read returns the policy and the exact remaining budget", async () => {
    if (matrixPolicy === undefined) {
      return { outcome: "fail", detail: matrixPolicyError ?? "no policy id resolved" };
    }
    const out = await call(client, "cynex_get_policy", { policy_id: matrixPolicy });
    if (out.ok !== true) {
      return { outcome: "fail", detail: String(out.reason) };
    }
    const policyRow = ((out.data ?? {}) as Record<string, unknown>).policy as Record<string, unknown>;
    return { outcome: "pass", detail: budgetLine(policyRow) };
  });
  await row("P3", "server", "receipts list returns rows as read from the chain", async () => {
    const out = await call(client, "cynex_list_receipts", { start: 0, limit: 5 });
    if (out.ok !== true) {
      return { outcome: "fail", detail: String(out.reason) };
    }
    const rows = (((out.data ?? {}) as Record<string, unknown>).receipts ?? []) as unknown[];
    return { outcome: "pass", detail: String(rows.length) + " receipts read" };
  });
  await row("P4", "server", "prepare returns exact arguments and the prepared label, submits nothing", async () => {
    if (matrixPolicy === undefined) {
      return { outcome: "fail", detail: matrixPolicyError ?? "no policy id resolved" };
    }
    const prepareId = "mcp-matrix-" + Date.now().toString();
    const out = await call(client, "cynex_prepare_obligation", {
      policy_id: matrixPolicy,
      obligation_id: prepareId,
      recipient: TEST_AGENT,
      amount: "100",
      evidence_type: "PREIMAGE",
      evidence_hash: "f23aeaa4efc068df8a05ef97c1ade88022575ad5ea52dbe9af218028462d4e27",
      expires_at_ns: (BigInt(Date.now()) * 1000000n + 3600000000000n).toString(),
      nonce: "90001",
    });
    if (out.ok !== true) {
      return { outcome: "fail", detail: String(out.reason) };
    }
    return { outcome: "pass", detail: "prepared " + prepareId };
  });
  await row("P5", "server", "obligation read returns the recorded terms", async () => {
    if (matrixObligation === undefined) {
      return { outcome: "skipped", detail: "needs --matrix-obligation <id>" };
    }
    const out = await call(client, "cynex_get_obligation", { obligation_id: matrixObligation });
    if (out.ok !== true) {
      return { outcome: "fail", detail: String(out.reason) };
    }
    const data = (out.data ?? {}) as Record<string, unknown>;
    matrixState = String(data.state ?? "");
    matrixRecipient = String(data.recipient ?? "");
    matrixAmount = String(data.amount ?? "");
    return { outcome: "pass", detail: "state " + matrixState + " recipient " + matrixRecipient + " amount " + matrixAmount };
  });
  if (matrixObligation !== undefined && matrixState !== "" && matrixState !== "READY") {
    const { out } = await settleWithBudget(matrixObligation, matrixRecipient, matrixAmount, "matrix-non-ready");
    nonReadyAttempt =
      out.ok === false && /not READY/.test(String(out.reason))
        ? { outcome: "pass", detail: String(out.reason) }
        : { outcome: "fail", detail: "expected a not-READY refusal, got ok=" + String(out.ok) + " " + String(out.reason) };
  }

  async function settleWithBudget(
    id: string,
    recipient: string,
    amount: string,
    evidenceRef: string,
  ): Promise<{ out: Record<string, unknown>; guard: SettleGuard }> {
    // The single mandatory path for every live settle attempt in the
    // matrix: read the obligation and the policy, verify the policy
    // echo, print the exact remaining budget, run the vault guard,
    // and only then call cynex_request_settlement. An unreadable
    // obligation or policy fails the row instead of proceeding
    // without a budget line.
    const obligationOut = await call(client, "cynex_get_obligation", { obligation_id: id });
    const obligationData = (obligationOut.data ?? {}) as Record<string, unknown>;
    if (typeof obligationData.obligation_id !== "string") {
      return {
        out: { ok: false, reason: "matrix run refused: the obligation " + id + " could not be read from the chain, terms cannot be verified" },
        guard: guardSettle(vaultId, obligationData, recipient, amount, allowProductionNegative),
      };
    }
    if (typeof obligationData.policy_id !== "string") {
      return {
        out: { ok: false, reason: "matrix run refused: the obligation " + id + " has no policy id on chain, the budget cannot be verified" },
        guard: guardSettle(vaultId, obligationData, recipient, amount, allowProductionNegative),
      };
    }
    const policyOut = await call(client, "cynex_get_policy", { policy_id: obligationData.policy_id });
    const policyRow = ((policyOut.data ?? {}) as Record<string, unknown>).policy as
      | Record<string, unknown>
      | undefined;
    if (policyRow === undefined || String(policyRow.policy_id ?? "") !== obligationData.policy_id) {
      return {
        out: { ok: false, reason: "matrix run refused: the policy " + String(obligationData.policy_id) + " could not be read from the chain or did not echo the requested id, the budget cannot be verified" },
        guard: guardSettle(vaultId, obligationData, recipient, amount, allowProductionNegative),
      };
    }
    console.log("BUDGET " + budgetLine(policyRow) + " (proposed amount " + amount + ")");
    budgetLines += 1;
    const guard = guardSettle(vaultId, obligationData, recipient, amount, allowProductionNegative);
    console.log("GUARD vault " + vaultId + ": " + guard.reason);
    if (vaultId === PROD_VAULT && allowProductionNegative && guard.allowed && !guard.termsMatch) {
      const claim = claimProductionNegativeUse(productionNegativeUsed);
      if (!claim.allowed) {
        return {
          out: { ok: false, reason: "production vault guard: a production-negative use already ran in this run, at most one is allowed; refusing without submitting", guardRefused: true },
          guard,
        };
      }
      productionNegativeUsed = claim.used;
    }
    if (!guard.allowed) {
      return { out: { ok: false, reason: guard.reason, guardRefused: true }, guard };
    }
    liveAttempts += 1;
    const out = await call(client, "cynex_request_settlement", {
      obligation_id: id,
      proposed_recipient: recipient,
      proposed_amount: amount,
      evidence_ref: evidenceRef,
    });
    if (reachedRuntimeChecks(out)) {
      runtimeChecksReached = true;
    }
    return { out, guard };
  }
  await row("M1", "vault", "correct recipient settles to PAID with receipt and balance delta", async () => {
    if (settleFixture === undefined) {
      return { outcome: "skipped", detail: "needs --matrix-settle <id> <recipient> <amount> <evidence-ref>" };
    }
    const [id, recipient, amount, evidenceRef] = settleFixture as [string, string, string, string];
    // Independent verification: read the obligation and the policy
    // before the settle, then re-read both after it, instead of
    // trusting the settle response. The obligation must read PAID
    // with the fixture terms, a receipt row must exist for it with
    // the reported index, and the policy spent must have risen by
    // exactly the settled amount.
    const beforeObligation = await call(client, "cynex_get_obligation", { obligation_id: id });
    const beforeObligationData = (beforeObligation.data ?? {}) as Record<string, unknown>;
    const policyId = String(beforeObligationData.policy_id ?? "");
    if (policyId === "") {
      return { outcome: "fail", detail: "the fixture obligation could not be read before the settle, its policy is unknown" };
    }
    const beforePolicy = await call(client, "cynex_get_policy", { policy_id: policyId });
    const beforePolicyRow = ((beforePolicy.data ?? {}) as Record<string, unknown>).policy as Record<string, unknown> | undefined;
    if (beforePolicyRow === undefined) {
      return { outcome: "fail", detail: "the policy " + policyId + " could not be read before the settle" };
    }
    const { out } = await settleWithBudget(id, recipient, amount, evidenceRef);
    if ((out as Record<string, unknown>).guardRefused === true) {
      return { outcome: "skipped", detail: String(out.reason) };
    }
    if (out.ok !== true) {
      return { outcome: "fail", detail: String(out.reason), txHash: txHashFromReason(String(out.reason)) };
    }
    const data = (out.data ?? {}) as Record<string, unknown>;
    const txHash = typeof data.settle_tx_hash === "string" ? data.settle_tx_hash : undefined;
    if (txHash === undefined) {
      return { outcome: "fail", detail: "the settle reported success but returned no transaction hash" };
    }
    const afterObligation = await call(client, "cynex_get_obligation", { obligation_id: id });
    const afterObligationData = (afterObligation.data ?? {}) as Record<string, unknown>;
    if (afterObligation.ok !== true || String(afterObligationData.state ?? "") !== "PAID") {
      return { outcome: "fail", detail: "the obligation does not read PAID after the settle", txHash };
    }
    if (String(afterObligationData.recipient ?? "") !== recipient || String(afterObligationData.amount ?? "") !== amount) {
      return { outcome: "fail", detail: "the PAID obligation terms do not match the fixture", txHash };
    }
    const receiptIndex = String(data.receipt_index ?? "");
    let receiptRow: Record<string, unknown> | undefined;
    let start = 0;
    for (;;) {
      const receiptsOut = await call(client, "cynex_list_receipts", { start, limit: 100 });
      const rows = (((receiptsOut.data ?? {}) as Record<string, unknown>).receipts ?? []) as Array<Record<string, unknown>>;
      if (!Array.isArray(rows) || rows.length === 0) {
        break;
      }
      const found = rows.find((r) => r.obligation_id === id);
      if (found !== undefined) {
        receiptRow = found;
        break;
      }
      start += rows.length;
      if (rows.length < 100) {
        break;
      }
    }
    const tokenId = String(beforePolicyRow.token_id ?? "");
    const receiptCheck = verifyReceiptRow(receiptRow, { obligationId: id, recipient, amount, tokenId, index: receiptIndex });
    if (!receiptCheck.ok) {
      return { outcome: "fail", detail: receiptCheck.reason, txHash };
    }
    const afterPolicy = await call(client, "cynex_get_policy", { policy_id: policyId });
    const afterPolicyRow = ((afterPolicy.data ?? {}) as Record<string, unknown>).policy as Record<string, unknown> | undefined;
    if (afterPolicyRow === undefined) {
      return { outcome: "fail", detail: "the policy " + policyId + " could not be read after the settle", txHash };
    }
    const spentCheck = verifySpentDelta(beforePolicyRow, afterPolicyRow, policyId, amount);
    if (!spentCheck.ok) {
      return { outcome: "fail", detail: spentCheck.reason, txHash };
    }
    settledId = id;
    settledRecipient = recipient;
    settledAmount = amount;
    settledTxHash = txHash;
    return {
      outcome: "pass",
      detail: "PAID receipt " + receiptIndex + " delta " + String(data.balance_delta ?? "?") + ", obligation, receipt, and policy spent re-read from the chain",
      txHash,
    };
  });
  await row("M2", "vault", "changed recipient is refused by the vault with ERR_RECIPIENT_SUBSTITUTION", async () => {
    if (negativeFixture === undefined) {
      return { outcome: "skipped", detail: "needs --matrix-negative <id> <changed-recipient> <amount> <evidence-ref>" };
    }
    const [id, recipient, amount, evidenceRef] = negativeFixture as [string, string, string, string];
    const { out } = await settleWithBudget(id, recipient, amount, evidenceRef);
    if ((out as Record<string, unknown>).guardRefused === true) {
      return { outcome: "skipped", detail: String(out.reason) };
    }
    if (out.ok === false && /vault refused/.test(String(out.reason)) && /ERR_RECIPIENT_SUBSTITUTION/.test(String(out.reason))) {
      const txHash = txHashFromReason(String(out.reason));
      if (txHash === undefined) {
        return { outcome: "fail", detail: "the vault refused with ERR_RECIPIENT_SUBSTITUTION but no transaction hash was recorded" };
      }
      return { outcome: "pass", detail: String(out.reason), txHash };
    }
    return {
      outcome: "fail",
      detail: "expected a vault ERR_RECIPIENT_SUBSTITUTION refusal, got ok=" + String(out.ok) + " " + String(out.reason) + ". If the gate refused first, the changed recipient does not read ALLOW; run the one-time setup in the README first.",
      txHash: txHashFromReason(String(out.reason)),
    };
  });

  await row("M3", "vault", "changed amount is refused by the vault with ERR_TERMS_MISMATCH", async () => {
    if (negativeAmountFixture === undefined) {
      return { outcome: "skipped", detail: "needs --matrix-negative-amount <id> <changed-amount> <evidence-ref>" };
    }
    const [id, amount, evidenceRef] = negativeAmountFixture as [string, string, string];
    const obligationOut = await call(client, "cynex_get_obligation", { obligation_id: id });
    const obligationData = (obligationOut.data ?? {}) as Record<string, unknown>;
    const recipient = String(obligationData.recipient ?? "");
    if (recipient === "") {
      return { outcome: "fail", detail: "the obligation could not be read, the recorded recipient is unknown" };
    }
    const { out } = await settleWithBudget(id, recipient, amount, evidenceRef);
    if ((out as Record<string, unknown>).guardRefused === true) {
      return { outcome: "skipped", detail: String(out.reason) };
    }
    if (out.ok === false && /vault refused/.test(String(out.reason)) && /ERR_TERMS_MISMATCH/.test(String(out.reason))) {
      const txHash = txHashFromReason(String(out.reason));
      if (txHash === undefined) {
        return { outcome: "fail", detail: "the vault refused with ERR_TERMS_MISMATCH but no transaction hash was recorded" };
      }
      return { outcome: "pass", detail: String(out.reason), txHash };
    }
    return {
      outcome: "fail",
      detail: "expected a vault ERR_TERMS_MISMATCH refusal, got ok=" + String(out.ok) + " " + String(out.reason),
      txHash: txHashFromReason(String(out.reason)),
    };
  });
  await row("M4", "evidence layer", "an obligation whose evidence was not accepted is not READY at attempt time", async () => {
    if (matrixObligation === undefined) {
      return { outcome: "skipped", detail: "needs --matrix-obligation <id> in EVIDENCE_PENDING" };
    }
    if (matrixState !== "EVIDENCE_PENDING") {
      return { outcome: "skipped", detail: "the fixture obligation is " + matrixState + ", not EVIDENCE_PENDING" };
    }
    if (nonReadyAttempt === undefined) {
      return { outcome: "fail", detail: "no settle attempt was made against the fixture obligation" };
    }
    return nonReadyAttempt;
  });
  await row("M5", "server", "over-budget request is refused off chain before any submit", async () => {
    if (overBudgetFixture === undefined) {
      return { outcome: "skipped", detail: "needs --matrix-overbudget <id> <recipient> <amount> <evidence-ref>" };
    }
    const [id, recipient, amount, evidenceRef] = overBudgetFixture as [string, string, string, string];
    const { out } = await settleWithBudget(id, recipient, amount, evidenceRef);
    if ((out as Record<string, unknown>).guardRefused === true) {
      return { outcome: "skipped", detail: String(out.reason) };
    }
    if (out.ok === false && /budget check failed/.test(String(out.reason))) {
      const txHash = txHashFromReason(String(out.reason));
      if (txHash !== undefined) {
        return { outcome: "fail", detail: "the budget refusal names a transaction hash, but no settle should have been submitted", txHash };
      }
      return { outcome: "pass", detail: String(out.reason) };
    }
    return {
      outcome: "fail",
      detail: "expected an off-chain budget refusal, got ok=" + String(out.ok) + " " + String(out.reason) + ". The server checks the recorded obligation amount, not the proposed amount, so the fixture obligation itself must be over budget (see acceptance-matrix.md M5).",
      txHash: txHashFromReason(String(out.reason)),
    };
  });
  await row("M6", "server", "replay is refused by the server because the obligation is PAID, not READY", async () => {
    if (settledId === undefined) {
      return { outcome: "skipped", detail: "needs M1 to settle first" };
    }
    const { out } = await settleWithBudget(settledId, settledRecipient, settledAmount, "matrix-replay");
    if ((out as Record<string, unknown>).guardRefused === true) {
      return { outcome: "skipped", detail: String(out.reason) };
    }
    if (out.ok === false && /not READY/.test(String(out.reason))) {
      return { outcome: "pass", detail: String(out.reason) };
    }
    return { outcome: "fail", detail: "expected a not-READY refusal, got ok=" + String(out.ok) + " " + String(out.reason) };
  });
  await row("M6-vault", "vault", "a replayed settle reaches the vault and fails with ERR_NONCE_ALREADY_CONSUMED", async () => {
    if (settledId === undefined) {
      return { outcome: "skipped", detail: "needs M1 to settle first" };
    }
    if (vaultId === PROD_VAULT && !allowProductionNegative) {
      return { outcome: "skipped", detail: "production vault: the replay attack command is not printed without --allow-production-negative" };
    }
    if (vaultId === PROD_VAULT) {
      const claim = claimProductionNegativeUse(productionNegativeUsed);
      if (!claim.allowed) {
        return { outcome: "skipped", detail: "production vault: a production-negative use already ran in this run, the replay attack command is not printed" };
      }
      productionNegativeUsed = claim.used;
    }
    return {
      outcome: "external",
      detail:
        "run outside MCP with the attack runner, which bypasses the READY check: node dist-test/cli/cynex.js attack-one " + vaultId + " " + settledId + " " + settledRecipient + " " + settledAmount + " matrix-replay; the vault refuses with ERR_NONCE_ALREADY_CONSUMED, no funds move, and the exact error and transaction hash are recorded from the live run",
    };
  });

  await row("M7", "Access-key layer, not the vault", "a function-call key scoped to another receiver is rejected at the access-key layer", async () => {
    if (vaultId === PROD_VAULT && !allowProductionNegative) {
      return { outcome: "skipped", detail: "production vault: the unauthorized-caller command is not printed without --allow-production-negative" };
    }
    if (vaultId === PROD_VAULT) {
      const claim = claimProductionNegativeUse(productionNegativeUsed);
      if (!claim.allowed) {
        return { outcome: "skipped", detail: "production vault: a production-negative use already ran in this run, the unauthorized-caller command is not printed" };
      }
      productionNegativeUsed = claim.used;
    }
    return {
      outcome: "external",
      detail:
        "run outside MCP with a function-call key scoped to a different receiver, for example cli/cynex.ts attack-one with such a key, or near-cli with such a key; the transaction is rejected at the access-key layer with the receiver-mismatch error (exact name as recorded from the live run), no funds move, and the exact error is recorded from the live run. A full-access key can invoke settle; the vault checks terms, it performs no caller check",
    };
  });
  await row("M8", "server", "settlement before READY is refused by the server, no settle submitted", async () => {
    if (matrixObligation === undefined) {
      return { outcome: "skipped", detail: "needs --matrix-obligation <id> in CREATED or EVIDENCE_PENDING" };
    }
    if (matrixState !== "CREATED" && matrixState !== "EVIDENCE_PENDING") {
      return { outcome: "skipped", detail: "the fixture obligation is " + (matrixState === "" ? "unread" : matrixState) + ", a CREATED or EVIDENCE_PENDING obligation is needed" };
    }
    if (nonReadyAttempt === undefined) {
      return { outcome: "fail", detail: "no settle attempt was made against the fixture obligation" };
    }
    return nonReadyAttempt;
  });
  await row("M8-vault", "vault", "a pre-READY settle reaches the vault and fails with ERR_INVALID_STATE", async () => {
    if (matrixObligation === undefined || (matrixState !== "CREATED" && matrixState !== "EVIDENCE_PENDING")) {
      return { outcome: "skipped", detail: "needs --matrix-obligation <id> in CREATED or EVIDENCE_PENDING" };
    }
    if (vaultId === PROD_VAULT && !allowProductionNegative) {
      return { outcome: "skipped", detail: "production vault: the pre-READY attack command is not printed without --allow-production-negative" };
    }
    if (vaultId === PROD_VAULT) {
      const claim = claimProductionNegativeUse(productionNegativeUsed);
      if (!claim.allowed) {
        return { outcome: "skipped", detail: "production vault: a production-negative use already ran in this run, the pre-READY attack command is not printed" };
      }
      productionNegativeUsed = claim.used;
    }
    return {
      outcome: "external",
      detail:
        "run outside MCP with the attack runner, which bypasses the READY check: node dist-test/cli/cynex.js attack-one " + vaultId + " " + matrixObligation + " " + matrixRecipient + " " + matrixAmount + " matrix-non-ready; the vault refuses with ERR_INVALID_STATE, no funds move, and the exact error and transaction hash are recorded from the live run",
    };
  });
  await row("M9", "reputation gate", "a reputation refusal is clearly separate from a vault refusal", async () => {
    if (blockedFixture === undefined) {
      return { outcome: "skipped", detail: "needs --matrix-blocked <id> <recipient> <amount> <evidence-ref>" };
    }
    const [id, recipient, amount, evidenceRef] = blockedFixture as [string, string, string, string];
    const { out } = await settleWithBudget(id, recipient, amount, evidenceRef);
    if ((out as Record<string, unknown>).guardRefused === true) {
      return { outcome: "skipped", detail: String(out.reason) };
    }
    if (out.ok === false && /MCP reputation gate refused/.test(String(out.reason))) {
      return { outcome: "pass", detail: String(out.reason) };
    }
    return {
      outcome: "fail",
      detail: "expected a gate refusal starting with MCP reputation gate refused, got ok=" + String(out.ok) + " " + String(out.reason),
    };
  });
  await row("M10", "attestation tooling", "the TDX quote verifies independently", async () => {
    if (settledId === undefined || settledTxHash === undefined) {
      return { outcome: "skipped", detail: "needs M1 to settle a TEE obligation first" };
    }
    const settled = await call(client, "cynex_get_obligation", { obligation_id: settledId });
    const settledData = (settled.data ?? {}) as Record<string, unknown>;
    settledEvidenceType = String(settledData.evidence_type ?? "");
    if (settledEvidenceType !== "TEE") {
      return { outcome: "skipped", detail: "M1 settled a " + (settledEvidenceType === "" ? "unknown" : settledEvidenceType) + " obligation, not a TEE obligation" };
    }
    return {
      outcome: "external",
      detail:
        "run scripts/verify-tee-attestation.sh --tx " + settledTxHash + " and record exit 0; the server performs no attestation verification",
      txHash: settledTxHash,
    };
  });
  await row("M11", "attestation tooling", "the VRF signature verifies and is bound to the pending request", async () => {
    if (settledTxHash === undefined) {
      return { outcome: "skipped", detail: "needs M1 to settle a TEE obligation first" };
    }
    if (settledEvidenceType !== "TEE") {
      return { outcome: "skipped", detail: "M1 settled a " + (settledEvidenceType === "" ? "non-TEE" : settledEvidenceType) + " obligation, not a TEE obligation" };
    }
    return {
      outcome: "external",
      detail:
        "verify the VRF signature from the attestation bundle for --tx " + settledTxHash + "; it provides an independently verified randomness anchor bound to the pending request, not proof of TEE execution",
      txHash: settledTxHash,
    };
  });

  await row("M12", "join", "the settle result joins to the obligation read: evidence digest present, receipt and hash recorded", async () => {
    if (settledId === undefined || settledTxHash === undefined) {
      return { outcome: "skipped", detail: "needs M1 to settle first" };
    }
    const out = await call(client, "cynex_get_obligation", { obligation_id: settledId });
    if (out.ok !== true) {
      return { outcome: "fail", detail: String(out.reason) };
    }
    const data = (out.data ?? {}) as Record<string, unknown>;
    if (data.evidence_hash === null || data.evidence_hash === undefined) {
      return { outcome: "fail", detail: "the settled obligation has no evidence_hash on chain, the receipt cannot be linked to an evidence digest" };
    }
    let receiptFound = false;
    let start = 0;
    for (;;) {
      const receiptsOut = await call(client, "cynex_list_receipts", { start, limit: 100 });
      const rows = (((receiptsOut.data ?? {}) as Record<string, unknown>).receipts ?? []) as Array<Record<string, unknown>>;
      if (!Array.isArray(rows) || rows.length === 0) {
        break;
      }
      if (rows.some((r) => r.obligation_id === settledId)) {
        receiptFound = true;
        break;
      }
      start += rows.length;
      if (rows.length < 100) {
        break;
      }
    }
    if (!receiptFound) {
      return { outcome: "fail", detail: "no receipt row for " + settledId + " could be read", txHash: settledTxHash };
    }
    return {
      outcome: "pass",
      detail:
        "evidence_hash " +
        JSON.stringify(data.evidence_hash ?? null) +
        " pending_request_id " +
        JSON.stringify(data.pending_request_id ?? null) +
        " pending_digest " +
        JSON.stringify(data.pending_digest ?? null) +
        "; the quote and VRF half of the linkage is verified by M10 and M11, not by this row",
      txHash: settledTxHash,
    };
  });
  await row("M13", "server", "runtime checks run on every settle and refuse before submit on failure", async () => {
    if (!runtimeChecksReached) {
      return { outcome: "skipped", detail: "needs a settle attempt that reaches the runtime checks (M1, M2, M3, or M9); attempts refused before them (not READY, budget) do not prove this row" };
    }
    return {
      outcome: "pass",
      detail: "a settle attempt reached the runtime checks, so the runtime checks ran for that attempt; each failure mode is proven by runtime-checks.test.ts",
    };
  });
  await row("M14", "runner", "the exact remaining budget is printed before every live run", async () => {
    if (liveAttempts === 0) {
      return { outcome: "skipped", detail: "no live settle attempt ran, so no BUDGET line was required" };
    }
    if (budgetLines < liveAttempts) {
      return { outcome: "fail", detail: "only " + budgetLines.toString() + " BUDGET lines were printed before " + liveAttempts.toString() + " live settle attempts" };
    }
    return {
      outcome: "pass",
      detail: budgetLines.toString() + " BUDGET lines printed before " + liveAttempts.toString() + " live settle attempts; see above",
    };
  });
  if (productionNegativeUsed > 1) {
    record({
      row: "PROD-GUARD",
      layer: "runner",
      expected: "at most one production-negative use per run",
      outcome: "fail",
      detail: productionNegativeUsed.toString() + " production-negative uses ran; only one carefully selected security failure is allowed per run on the production vault",
    });
  }
  const failed = results.filter((r) => r.outcome === "fail").length;
  const passed = results.filter((r) => r.outcome === "pass").length;
  const skipped = results.filter((r) => r.outcome === "skipped").length;
  const external = results.filter((r) => r.outcome === "external").length;
  const summary = {
    vault: vaultId,
    passed,
    failed,
    skipped,
    external,
    rows: results,
  };
  console.log("MATRIX SUMMARY vault " + vaultId + " passed " + passed + " failed " + failed + " skipped " + skipped + " external " + external);
  if (outFile !== undefined) {
    writeFileSync(outFile, JSON.stringify(summary, null, 2) + "\n", "utf-8");
    console.log("MATRIX written to " + outFile);
  }
  return failed === 0 ? 0 : 1;
}
