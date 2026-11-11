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
  | "usedUp";

export interface DemoButtonState {
  status: DemoButtonStatus;
  result: DemoSettleResult | null;
  error: string | null;
  fallback: string | null;
}

export const initialDemoButtonState: DemoButtonState = {
  status: "idle",
  result: null,
  error: null,
  fallback: null,
};

export type DemoButtonAction =
  | { type: "start" }
  | { type: "succeeded"; result: DemoSettleResult }
  | { type: "failed"; error: string; fallback?: string }
  | { type: "usedUp"; error: string; fallback?: string }
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
      if (state.status === "loading" || state.status === "usedUp") {
        return state;
      }
      return { status: "loading", result: null, error: null, fallback: null };
    case "succeeded":
      return {
        status: "success",
        result: action.result,
        error: null,
        fallback: null,
      };
    case "failed":
      return {
        status: "error",
        result: null,
        error: action.error,
        fallback: action.fallback ?? null,
      };
    case "usedUp":
      return {
        status: "usedUp",
        result: null,
        error: action.error,
        fallback: action.fallback ?? DEMO_SETTLE_FALLBACK,
      };
    case "reset":
      return initialDemoButtonState;
  }
}

/* The button runs from idle, from a shown receipt (run it again),
 * and from an error (retry). It never runs while a settle is in
 * flight, and never runs once the demo settles are used up. */
export function demoButtonCanRun(state: DemoButtonState): boolean {
  return (
    state.status === "idle" ||
    state.status === "success" ||
    state.status === "error"
  );
}

export type DemoSettleOutcome =
  | { outcome: "success"; result: DemoSettleResult }
  | { outcome: "usedUp"; error: string; fallback: string }
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
 * so the button shows the fallback instead of a generic error. */
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
    if (obligationId === null || txHash === null) {
      return {
        outcome: "error",
        error:
          "The demo endpoint answered success without an obligation id or a transaction hash.",
        fallback: null,
      };
    }
    const result: DemoSettleResult = {
      success: true,
      obligationId,
      receiptIndex: asNumber(body.receiptIndex),
      txHash,
      recipient: asString(body.recipient),
      amount: asString(body.amount),
      policySpent: asString(body.policySpent),
      remaining: asNumber(body.remaining),
      code: code ?? undefined,
    };
    return { outcome: "success", result };
  }
  if (code === "DEMO_USED_UP" || /used up/i.test(error)) {
    return { outcome: "usedUp", error, fallback };
  }
  return { outcome: "error", error, fallback: asString(body.fallback) };
}
