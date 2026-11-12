/* "Break it" live attack: pure logic, no React, no network.
 * The component in components/BreakIt.tsx owns the fetch and the
 * rendering; this module owns the response parsing and the pick of
 * the target obligation, so both are covered by Jest without a DOM.
 *
 * The client sends the judge's terms to /api/demo-attack and holds no
 * key. The backend submits the attempt to the test vault with the
 * scoped settle-only key the browser never sees, and returns the real
 * vault verdict: a refusal with a real tx hash, or PAID with a
 * receipt when the judge entered the correct terms. A refusal whose
 * error carried no usable tx hash is still a refusal, but it is
 * reported without a hash and without claiming a transaction link.
 */

import { SETTLE_ERROR_CODES, settleErrorCode } from "./demoSettle.js";

export const DEMO_ATTACK_ENDPOINT = "/api/demo-attack";

/* Six live attack kinds. change_recipient and change_amount submit
 * the judge's terms; replay and settle_before_evidence submit the
 * obligation's locked terms read from the chain; prompt_injection
 * and freeform submit terms extracted from the judge's free text.
 * The server rejects any other kind with a 400. */
export const ATTACK_KINDS = [
  "change_recipient",
  "change_amount",
  "replay",
  "settle_before_evidence",
  "prompt_injection",
  "freeform",
] as const;
export type AttackKind = (typeof ATTACK_KINDS)[number];

export const DEMO_ATTACK_RATE_LIMIT_TEXT =
  "Rate limit: 1 attempt every 10 seconds, 30 per hour, per IP. Best effort per server instance: a cold start resets the count and separate instances do not share it, so the hard spend cap is the 1 NEAR allowance on the demo key. A refusal does not consume the obligation, so you can try again with different terms.";

export interface DemoAttackResult {
  success: boolean;
  obligationId: string | null;
  receiptIndex: number | null;
  txHash: string | null;
  recipient: string | null;
  amount: string | null;
  policySpent: string | null;
  remaining: number | null;
  code?: string;
  error?: string;
  fallback?: string;
}

export const DEMO_ATTACK_FALLBACK =
  "The 10 demo settles are used up. Run the same flow locally with the sandbox demo (npx cynex-mcp --sandbox) or the MCP demo, both documented in services/mcp/README.md.";

export const DEMO_EXPLORER_TX = (hash: string) =>
  "https://testnet.nearblocks.io/txns/" + hash;

/* The ten demo-live obligations, in order. The target for a live
 * attack is the first one with no receipt yet: it is READY on chain.
 * The server re-checks the state before submitting, so a stale pick
 * still gets the vault's real answer for that obligation.
 */
export const DEMO_LIVE_IDS = [
  "demo-live-001",
  "demo-live-002",
  "demo-live-003",
  "demo-live-004",
  "demo-live-005",
  "demo-live-006",
  "demo-live-007",
  "demo-live-008",
  "demo-live-009",
  "demo-live-010",
];

/* The fresh obligation kept without evidence, so a settle against it
 * is refused on chain with ERR_INVALID_STATE. Created live on
 * testnet 2026-11-12, state CREATED, recipient
 * cynex-agent2.cynexmaster.testnet, amount 100, policy p6-001,
 * evidence type PREIMAGE, digest never submitted. */
export const DEMO_NOEVIDENCE_ID = "demo-live-noevidence-001";

/* The use-case obligation, PAID on the test vault, offered as a
 * replay target alongside the paid demo-live obligations. Its locked
 * terms were verified live on chain 2026-11-12: recipient
 * cynex-agent.cynexmaster.testnet, amount 100, receipt 24. */
export const USECASE_ID = "usecase-report-002";

/* Locked terms of the obligations a live attack can target, verified
 * live on chain 2026-11-12. Every demo-live obligation and the
 * no-evidence obligation lock recipient cynex-agent2 and amount 100;
 * the use-case obligation locks recipient cynex-agent and amount 100.
 * The server reads these from the chain and submits them for replay
 * and settle-before-evidence; the client uses this copy only to show
 * the judge what will be submitted and to label live attempts. */
export function lockedTermsForObligation(
  obligationId: string,
): { recipient: string; amount: string } | null {
  if (
    DEMO_LIVE_IDS.includes(obligationId) ||
    obligationId === DEMO_NOEVIDENCE_ID
  ) {
    return { recipient: "cynex-agent2.cynexmaster.testnet", amount: "100" };
  }
  if (obligationId === USECASE_ID) {
    return { recipient: "cynex-agent.cynexmaster.testnet", amount: "100" };
  }
  return null;
}

/* The first demo-live obligation with no receipt in the live receipt
 * rows is READY and is the target for a live attack. A receipt row
 * proves its obligation is PAID. Returns null when the receipts have
 * not loaded yet: guessing demo-live-001 would target an already
 * PAID obligation and answer ERR_NONCE_ALREADY_CONSUMED instead of
 * the recipient or amount refusal the judge is testing. Returns null
 * too when every demo-live obligation has a receipt, which is the
 * used-up state.
 */
export function nextReadyDemoObligation(
  receiptRows: { obligation_id: string }[] | null,
): string | null {
  if (receiptRows === null) return null;
  const paid = new Set(receiptRows.map((r) => r.obligation_id));
  for (const id of DEMO_LIVE_IDS) {
    if (!paid.has(id)) return id;
  }
  return null;
}

/* The most recent PAID demo-live obligation, for a live replay: the
 * judge resubmits it and the vault returns ERR_NONCE_ALREADY_CONSUMED
 * with a real tx hash. Receipt rows arrive in index order, so the
 * last demo-live receipt is the most recent. Returns null when no
 * demo-live obligation is PAID yet.
 */
export function mostRecentPaidDemoObligation(
  receiptRows: { obligation_id: string }[] | null,
): string | null {
  if (receiptRows === null) return null;
  let found: string | null = null;
  for (const row of receiptRows) {
    if (DEMO_LIVE_IDS.includes(row.obligation_id)) found = row.obligation_id;
  }
  return found;
}

/* Every obligation the judge can pick for a live replay, in receipt
 * order: the paid demo-live obligations, plus usecase-report-002
 * when it has a receipt row. Returns null while the receipts have
 * not loaded, and an empty list when nothing is PAID yet. The server
 * still checks the picked obligation reads PAID before submitting,
 * so a stale pick is refused as NOT_REPLAYABLE instead of settling.
 */
export function replayChoices(
  receiptRows: { obligation_id: string }[] | null,
): string[] | null {
  if (receiptRows === null) return null;
  const choices: string[] = [];
  for (const row of receiptRows) {
    const id = row.obligation_id;
    if (
      (DEMO_LIVE_IDS.includes(id) || id === USECASE_ID) &&
      !choices.includes(id)
    ) {
      choices.push(id);
    }
  }
  return choices;
}

export type DemoAttackOutcome =
  | { outcome: "paid"; result: DemoAttackResult }
  | {
      outcome: "refused";
      code: string;
      txHash: string | null;
      obligationId: string | null;
      recipient: string | null;
      amount: string | null;
      error: string;
    }
  | { outcome: "usedUp"; error: string; fallback: string }
  | {
      outcome: "unconfirmed";
      error: string;
      txHash: string | null;
      obligationId: string | null;
    }
  | { outcome: "error"; error: string; fallback: string | null };

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* Parse whatever the endpoint returned into one of the outcomes.
 * A vault refusal is recognised by its code: a whitelisted settle
 * error code in the response code field. That is a successful
 * demonstration, not an error: the vault refused the attempt on
 * chain, and the tx hash is the proof. A refusal with no tx hash is
 * still refused, and the component must not claim a transaction link
 * for it. Anything malformed is unconfirmed, never a retryable
 * error: a resolved fetch with an unreadable body cannot establish
 * that the attempt did not land, because the server may have
 * submitted it before the response was lost. A used-up answer is
 * recognised by its code only: matching on the words "used up" in a
 * message could misclassify a non-vault error. Pre-chain failures
 * are a plain error: nothing was submitted, so a retry is safe once
 * the input or the wait is fixed. That includes the server codes
 * that never reach the chain: METHOD_NOT_ALLOWED, DEMO_KEY_INVALID,
 * CHAIN_UNREADABLE and SCOPE_CHECK_FAILED must never map to
 * unconfirmed, which would wrongly warn the judge the attempt may
 * have landed on chain.
 */
export function parseDemoAttackResponse(json: unknown): DemoAttackOutcome {
  if (json === null || typeof json !== "object") {
    return {
      outcome: "unconfirmed",
      error:
        "The attack endpoint returned an unreadable answer. The attempt may still have gone through, check the receipt list on the test vault before trying again.",
      txHash: null,
      obligationId: null,
    };
  }
  const body = json as Record<string, unknown>;
  const code = asString(body.code);
  const error = asString(body.error) ?? "The attack attempt failed.";
  const fallback = asString(body.fallback) ?? DEMO_ATTACK_FALLBACK;
  const txHash = asString(body.txHash);
  const obligationId = asString(body.obligationId);
  if (body.success === true) {
    const receiptIndex = asNumber(body.receiptIndex);
    if (obligationId === null || txHash === null || receiptIndex === null) {
      return {
        outcome: "unconfirmed",
        error:
          "The attack endpoint answered success without an obligation id, a transaction hash, or a receipt index. The settle may have gone through, check the receipt list on the test vault before trying again.",
        txHash,
        obligationId,
      };
    }
    const result: DemoAttackResult = {
      success: true,
      obligationId,
      receiptIndex,
      txHash,
      recipient: asString(body.recipient),
      amount: asString(body.amount),
      policySpent: asString(body.policySpent),
      remaining: asNumber(body.remaining),
      code: code ?? undefined,
    };
    return { outcome: "paid", result };
  }
  // A vault refusal: the code is a whitelisted settle error code.
  // The tx hash is the proof the refusal happened on chain.
  if (code !== null && SETTLE_ERROR_CODES.has(code)) {
    return {
      outcome: "refused",
      code,
      txHash,
      obligationId,
      recipient: asString(body.recipient),
      amount: asString(body.amount),
      error,
    };
  }
  if (code === "SETTLE_TIMEOUT" || code === "SETTLE_UNCONFIRMED") {
    return { outcome: "unconfirmed", error, txHash, obligationId };
  }
  if (code === "DEMO_USED_UP") {
    return { outcome: "usedUp", error, fallback };
  }
  // A validation, rate-limit, config, or pre-chain failure is a plain
  // error: nothing was submitted, so a retry is safe once the input
  // or the wait is fixed.
  if (
    code === "INVALID_REQUEST" ||
    code === "INVALID_OBLIGATION" ||
    code === "INVALID_RECIPIENT" ||
    code === "INVALID_AMOUNT" ||
    code === "INVALID_ATTACK_KIND" ||
    code === "RATE_LIMITED" ||
    code === "DEMO_NOT_CONFIGURED" ||
    code === "OBLIGATION_MISSING" ||
    code === "METHOD_NOT_ALLOWED" ||
    code === "DEMO_KEY_INVALID" ||
    code === "CHAIN_UNREADABLE" ||
    code === "SCOPE_CHECK_FAILED" ||
    code === "NOT_REPLAYABLE" ||
    code === "WRONG_STATE"
  ) {
    return { outcome: "error", error, fallback: asString(body.fallback) };
  }
  // Anything else cannot establish that the attempt did not land.
  return { outcome: "unconfirmed", error, txHash, obligationId };
}

/* Re-exported so the component and the tests share one whitelist
 * check. The server in web/api/demo-attack.ts and the client in
 * web/src/lib/demoSettle.ts carry the same list; the Jest suite
 * asserts the three lists are equal.
 */
export { settleErrorCode };
