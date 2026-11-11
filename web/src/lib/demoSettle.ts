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
      return initialDemoButtonState;
  }
}

/* The button runs from idle, from a shown receipt (run it again,
 * unless that receipt was the last settle), and from an error
 * (retry). It never runs while a settle is in flight, never runs
 * once the demo settles are used up, and never runs after an
 * unconfirmed settle: that tx may still land, so a retry would spend
 * a second obligation. */
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

/* The honest status line under the expected-result box. It is shown in
   every state except success: once a settle succeeds and the PAID result
   with its tx hash is shown, the line would contradict it. */
export const DEMO_BUTTON_UNPROVEN_LINE =
  "Not yet proven live: the button is built, but no live settle has been run from it yet, because the preview deployment cannot see the demo key. The first live settle will be recorded here with its transaction hash.";

export function showUnprovenLine(status: DemoButtonStatus): boolean {
  return status !== "success";
}

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
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* Parse whatever the endpoint returned into one of three outcomes.
 * Anything malformed is an error, never a success, and a used-up
 * answer is recognised by its code first and by its message second,
 * so the button shows the fallback instead of a generic error.
 * A success needs an obligation id, a transaction hash, and a numeric
 * receipt index: without the receipt index the settle cannot be shown as proven. */
export function parseDemoSettleResponse(json: unknown): DemoSettleOutcome {
  if (json === null || typeof json !== "object") {
    return {
      outcome: "error",
      error: "The demo endpoint returned an unreadable answer.",
      fallback: null,
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
        outcome: "error",
        error:
          "The demo endpoint answered success without an obligation id, a transaction hash, or a receipt index.",
        fallback: null,
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
  return { outcome: "error", error, fallback: asString(body.fallback) };
}
