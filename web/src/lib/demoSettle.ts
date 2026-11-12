/* "Run it live" button: pure logic, no React, no network.
 * The component in components/LiveDemoButton.tsx owns the fetch and
 * the rendering; this module owns the state machine and the response
 * parsing, so both are covered by Jest without a DOM.
 *
 * The client sends no parameters to /api/demo-settle and holds no
 * key. The backend picks the next READY demo obligation from the
 * chain and settles it with its recorded terms.
 */

export interface DemoSettleResult {
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

export const DEMO_SETTLE_ENDPOINT = "/api/demo-settle";

export const DEMO_SETTLE_FALLBACK =
  "The 10 demo settles are used up. Run the same flow locally with the sandbox demo (npx cynex-mcp --sandbox) or the MCP demo, both documented in services/mcp/README.md.";

/* The eleven error codes the vault settle can return, read from
 * contract/src/lib.rs (the settle function). Only a whitelisted code
 * proves a definitive on-chain refusal. A broad ERR_* regex would also
 * match Node transport errors such as ERR_SOCKET_CLOSED, which prove
 * nothing about the settle. The server in web/api/demo-settle.ts
 * carries the same list; the two must match, and the Jest suite
 * asserts it. */
export const SETTLE_ERROR_CODES: ReadonlySet<string> = new Set([
  "ERR_BUDGET_EXCEEDED",
  "ERR_INVALID_STATE",
  "ERR_NONCE_ALREADY_CONSUMED",
  "ERR_OBLIGATION_EXPIRED",
  "ERR_OBLIGATION_MISSING",
  "ERR_POLICY_FROZEN",
  "ERR_POLICY_MISSING",
  "ERR_RECIPIENT_SUBSTITUTION",
  "ERR_TERMS_MISMATCH",
  "ERR_TOKEN_IN_FLIGHT",
  "ERR_VAULT_STORAGE_EXHAUSTED",
]);

/* Return the whitelisted settle error code found in a message, or null. */
export function settleErrorCode(message: string): string | null {
  const tokens = message.match(/ERR_[A-Z_]+/g) ?? [];
  for (const token of tokens) {
    if (SETTLE_ERROR_CODES.has(token)) return token;
  }
  return null;
}

export const DEMO_EXPLORER_TX = (hash: string) =>
  "https://testnet.nearblocks.io/txns/" + hash;

export type DemoButtonStatus =
  | "idle"
  | "loading"
  | "success"
  | "error"
  | "usedUp"
  | "unconfirmed";

/* "unconfirmed" means a settle was attempted but payment could not be
 * confirmed on chain: the tx may still land, so the button never
 * offers a retry in this state. txHash and obligationId are kept so
 * the panel can link at the explorer for the user to check. */
export interface DemoButtonState {
  status: DemoButtonStatus;
  result: DemoSettleResult | null;
  error: string | null;
  fallback: string | null;
  txHash?: string | null;
  obligationId?: string | null;
}

export const initialDemoButtonState: DemoButtonState = {
  status: "idle",
  result: null,
  error: null,
  fallback: null,
  txHash: null,
  obligationId: null,
};

export type DemoButtonAction =
  | { type: "start" }
  | { type: "succeeded"; result: DemoSettleResult }
  | { type: "failed"; error: string; fallback?: string }
  | { type: "usedUp"; error: string; fallback?: string }
  | {
      type: "unconfirmed";
      error: string;
      txHash?: string | null;
      obligationId?: string | null;
    }
  | { type: "reset" };

/* One transition per action. Loading only starts from a state that
 * can run; a success keeps its receipt on screen until the judge
 * runs again, and a used-up state never runs again. */
export function demoButtonReducer(
  state: DemoButtonState,
  action: DemoButtonAction,
): DemoButtonState {
  switch (action.type) {
    case "start":
      if (
        state.status === "loading" ||
        state.status === "usedUp" ||
        state.status === "unconfirmed"
      ) {
        return state;
      }
      if (state.status === "success" && state.result?.remaining === 0) {
        return state;
      }
      return {
        status: "loading",
        result: null,
        error: null,
        fallback: null,
        txHash: null,
        obligationId: null,
      };
    case "succeeded":
      return {
        status: "success",
        result: action.result,
        error: null,
        fallback: null,
        txHash: null,
        obligationId: null,
      };
    case "failed":
      return {
        status: "error",
        result: null,
        error: action.error,
        fallback: action.fallback ?? null,
        txHash: null,
        obligationId: null,
      };
    case "usedUp":
      return {
        status: "usedUp",
        result: null,
        error: action.error,
        fallback: action.fallback ?? DEMO_SETTLE_FALLBACK,
        txHash: null,
        obligationId: null,
      };
    case "unconfirmed":
      return {
        status: "unconfirmed",
        result: null,
        error: action.error,
        fallback: null,
        txHash: action.txHash ?? null,
        obligationId: action.obligationId ?? null,
      };
    case "reset":
      // An unconfirmed settle must never reset to idle: the tx may
      // still land, so resetting would re-enable a retry. The same
      // applies to an exhausted success: after the final settle there
      // is no READY obligation left, so resetting to idle would offer
      // a run the server can only answer with used-up. The nav
      // variant does not render Dismiss for either state, and this
      // guard makes the state machine itself refuse the transition.
      if (state.status === "unconfirmed") return state;
      if (state.status === "success" && state.result?.remaining === 0) return state;
      return initialDemoButtonState;
  }
}

/* The button runs from idle, from a shown receipt (run it again,
 * unless that receipt was the last settle), and from an error
 * (retry). It never runs while a settle is in flight, never runs
 * once the demo settles are used up, and never runs after an
 * unconfirmed settle: that tx may still land, so a retry would spend
 * a second obligation. */
/* Synchronous in-flight guard for the demo settle button. React state
   updates are async, so a second click before the re-render commits
   would still see the old idle state and send a second POST. The guard
   is a plain boolean flipped synchronously, so the second invocation
   returns false before any dispatch or fetch. */
export function createInFlightGuard() {
  let inFlight = false;
  return {
    tryAcquire(): boolean {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    release() {
      inFlight = false;
    },
  };
}

export function demoButtonCanRun(state: DemoButtonState): boolean {
  if (state.status === "idle" || state.status === "error") return true;
  if (state.status === "success") {
    return (
      state.result?.remaining === null ||
      state.result?.remaining === undefined ||
      state.result.remaining > 0
    );
  }
  return false;
}

/* The proven-live line under the expected-result box. It is shown in
   every state except success: once a settle succeeds and the PAID result
   with its tx hash is shown, that result replaces it. Live state
   12 Nov 2026, re-verified from chain. */
export const DEMO_BUTTON_PROVEN_LINE =
  "Proven live: demo-live-008, receipt 38 PAID, tx BgvVNfX7CL2FoqR9dS6HLjdHRgedKXfsAUeLp2jhLvM2, block 277403330.";

export type DemoSettleOutcome =
  | { outcome: "success"; result: DemoSettleResult }
  | { outcome: "usedUp"; error: string; fallback: string }
  | {
      outcome: "unconfirmed";
      error: string;
      txHash: string | null;
      obligationId: string | null;
    }
  | { outcome: "error"; error: string; fallback: string | null };

function asString(value: unknown): string | null {
  // An empty string is never a meaningful value here: an obligation
  // id, tx hash, code, or message of "" is treated as missing, so a
  // success carrying one cannot parse as proven.
  return typeof value === "string" && value !== "" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* Parse whatever the endpoint returned into one of the outcomes.
 * Anything malformed is unconfirmed, never a retryable error: a
 * resolved fetch with an unreadable body (for example an HTML error
 * page from the host) cannot establish that the settle did not land,
 * because the server may have submitted it before the response was
 * lost. A used-up answer is recognised by its code first and by its
 * message second, so the button shows the fallback instead of a
 * generic error. A success needs an obligation id, a transaction hash,
 * and a numeric receipt index: without the receipt index the settle
 * cannot be shown as proven. */
export function parseDemoSettleResponse(json: unknown): DemoSettleOutcome {
  if (json === null || typeof json !== "object") {
    return {
      outcome: "unconfirmed",
      error:
        "The demo endpoint returned an unreadable answer. The settle may still have gone through, check the receipt list on the test vault before running again.",
      txHash: null,
      obligationId: null,
    };
  }
  const body = json as Record<string, unknown>;
  const code = asString(body.code);
  const error = asString(body.error) ?? "The demo settle failed.";
  const fallback = asString(body.fallback) ?? DEMO_SETTLE_FALLBACK;
  if (body.success === true) {
    const obligationId = asString(body.obligationId);
    const txHash = asString(body.txHash);
    const receiptIndex = asNumber(body.receiptIndex);
    if (obligationId === null || txHash === null || receiptIndex === null) {
      return {
        outcome: "unconfirmed",
        error:
          "The demo endpoint answered success without an obligation id, a transaction hash, or a receipt index. The settle may have gone through, check the receipt list on the test vault before running again.",
        txHash,
        obligationId,
      };
    }
    const result: DemoSettleResult = {
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
    return { outcome: "success", result };
  }
  if (code === "SETTLE_TIMEOUT" || code === "SETTLE_UNCONFIRMED") {
    return {
      outcome: "unconfirmed",
      error,
      txHash: asString(body.txHash),
      obligationId: asString(body.obligationId),
    };
  }
  if (code === "DEMO_USED_UP" || /used up/i.test(error)) {
    return { outcome: "usedUp", error, fallback };
  }
  // A definitive refusal proves the settle did not land, so a retry is
  // safe: a whitelisted settle error code in the message, or a missing
  // demo key (DEMO_NOT_CONFIGURED, which means no settle could have
  // been attempted). Anything else cannot establish that the settle
  // did not land, so it is unconfirmed and never offers a retry.
  if (code === "DEMO_NOT_CONFIGURED" || settleErrorCode(error) !== null) {
    return { outcome: "error", error, fallback: asString(body.fallback) };
  }
  return {
    outcome: "unconfirmed",
    error,
    txHash: asString(body.txHash),
    obligationId: asString(body.obligationId),
  };
}
