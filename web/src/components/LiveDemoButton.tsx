/* "Run it live": one click settles the next pre-seeded READY demo
 * obligation on testnet, through the serverless backend at
 * /api/demo-settle. The client holds no key and sends no parameters:
 * the backend reads the obligation terms from the chain and signs
 * with a scoped settle-only key the browser never sees.
 *
 * Live testnet settlement, fake USDC, no real value. The button is
 * disabled while a settle is in flight, and after a success it
 * offers to run again until the demo settles run out. */

import { useReducer } from "react";
import { fmtToken } from "../lib/near";
import {
  DEMO_EXPLORER_TX,
  DEMO_SETTLE_ENDPOINT,
  demoButtonCanRun,
  demoButtonReducer,
  initialDemoButtonState,
  parseDemoSettleResponse,
} from "../lib/demoSettle";
import { Badge, HashChip } from "./ui";

export function LiveDemoButton() {
  const [state, dispatch] = useReducer(
    demoButtonReducer,
    initialDemoButtonState,
  );

  const run = async () => {
    if (!demoButtonCanRun(state)) return;
    dispatch({ type: "start" });
    try {
      const res = await fetch(DEMO_SETTLE_ENDPOINT, { method: "POST" });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      const parsed = parseDemoSettleResponse(json);
      if (parsed.outcome === "success") {
        dispatch({ type: "succeeded", result: parsed.result });
      } else if (parsed.outcome === "usedUp") {
        dispatch({
          type: "usedUp",
          error: parsed.error,
          fallback: parsed.fallback,
        });
      } else {
        dispatch({
          type: "failed",
          error: parsed.error,
          fallback: parsed.fallback ?? undefined,
        });
      }
    } catch {
      dispatch({
        type: "failed",
        error: "The request did not reach the demo endpoint. Check the connection and try again.",
      });
    }
  };

  const result = state.result;
  const remaining = result?.remaining ?? null;
  const canRunAgain =
    state.status === "success" && (remaining === null || remaining > 0);

  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-4">
      <span className="dim2">{k}</span>
      <span className="text-right" style={{ color: "var(--secondary)" }}>
        {v}
      </span>
    </div>
  );

  return (
    <section className="wrap pt-12">
      <div className="panel p-6 fadein">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="kicker">Try it live</span>
          {state.status === "success" ? <Badge value="PAID" /> : null}
        </div>
        <h2 className="text-2xl md:text-3xl mb-4">Run one real settlement</h2>
        <p className="dim text-sm leading-relaxed max-w-3xl">
          One click settles the next pre-seeded demo obligation on testnet,
          100 base units of fake USDC to the authorized recipient, with the
          exact terms read from the chain. No wallet, no login, no real
          value: testnet only, and the key that signs lives on the server,
          scoped to settle on the test vault and nothing else.
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-5">
          <button
            className="btn btn-primary"
            onClick={() => void run()}
            disabled={!demoButtonCanRun(state)}
          >
            {state.status === "loading"
              ? "Settling on testnet..."
              : state.status === "success" && canRunAgain
                ? "Run it again"
                : state.status === "error"
                  ? "Try again"
                  : "Run it live"}
          </button>
          <span className="mono text-xs dim2">
            {remaining !== null && state.status === "success"
              ? remaining + " demo settle" + (remaining === 1 ? "" : "s") + " left"
              : "10 pre-seeded demo obligations, each settles once"}
          </span>
        </div>

        {state.status === "success" && result ? (
          <div className="mt-5 space-y-3">
            <div className="mono text-[13px] space-y-1.5">
              {row("receipt", result.receiptIndex !== null ? "#" + result.receiptIndex : "pending, see the tx")}
              {row("obligation", result.obligationId ?? "-")}
              {row(
                "amount",
                result.amount !== null ? (
                  <span title={fmtToken(result.amount) + " USDC, usdc.fakes.testnet, 6 decimals"}>
                    {result.amount} units
                  </span>
                ) : (
                  "-"
                ),
              )}
              {row("recipient", result.recipient ?? "-")}
              {row(
                "policy spent",
                result.policySpent !== null ? result.policySpent + " of 10000 base units" : "-",
              )}
            </div>
            {result.txHash ? (
              <div className="pt-1">
                <HashChip hash={result.txHash} />
              </div>
            ) : null}
            <div className="text-xs dim2 mono">
              {result.txHash ? (
                <a href={DEMO_EXPLORER_TX(result.txHash)} target="_blank" rel="noopener">
                  Open the settle transaction in the explorer
                </a>
              ) : (
                "No tx hash was returned: check the receipt list on the test vault."
              )}
            </div>
          </div>
        ) : null}

        {state.status === "error" && state.error ? (
          <div className="mt-5 space-y-2">
            <p className="text-sm text-ink">{state.error}</p>
            {state.fallback ? (
              <p className="dim text-sm leading-relaxed">{state.fallback}</p>
            ) : null}
          </div>
        ) : null}

        {state.status === "usedUp" && state.error ? (
          <div className="mt-5 space-y-2">
            <p className="text-sm text-ink">{state.error}</p>
            {state.fallback ? (
              <p className="dim text-sm leading-relaxed">{state.fallback}</p>
            ) : null}
            <p className="mono text-xs dim2">
              Same flow, no hosted key needed: npx cynex-mcp --sandbox, docs
              in services/mcp/README.md.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
