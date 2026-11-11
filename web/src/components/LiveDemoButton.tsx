/* "Run it live": one click settles the next pre-seeded READY demo
 * obligation on testnet, through the serverless backend at
 * /api/demo-settle. The client holds no key and sends no parameters:
 * the backend reads the obligation terms from the chain and signs
 * with a scoped settle-only key the browser never sees.
 *
 * Live testnet settlement, fake USDC, no real value. The button is
 * disabled while a settle is in flight, and after a success it
 * offers to run again until the demo settles run out.
 *
 * Variants: "section" is the full panel (default), "hero" is the bare
 * button with the expected-result box for the Home hero and the end
 * of Guided demo, "nav" is the small header button whose result
 * shows as a line under the header. All three share the same POST,
 * the same states, and the same reducer. */

import { useReducer } from "react";
import { fmtToken } from "../lib/near";
import { useLive } from "../lib/live";
import {
  DEMO_BUTTON_UNPROVEN_LINE,
  DEMO_EXPLORER_TX,
  DEMO_SETTLE_ENDPOINT,
  DEMO_SETTLE_FALLBACK,
  demoButtonCanRun,
  demoButtonReducer,
  initialDemoButtonState,
  parseDemoSettleResponse,
  showUnprovenLine,
} from "../lib/demoSettle";
import { Badge, HashChip } from "./ui";

export type LiveDemoButtonVariant = "hero" | "section" | "nav";


export function LiveDemoButton({ variant = "section", actions, top = 64 }: { variant?: LiveDemoButtonVariant; actions?: React.ReactNode; top?: number }) {
  const [state, dispatch] = useReducer(demoButtonReducer, initialDemoButtonState);
  const { live: L } = useLive();

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
      } else if (parsed.outcome === "unconfirmed") {
        dispatch({
          type: "unconfirmed",
          error: parsed.error,
          txHash: parsed.txHash,
          obligationId: parsed.obligationId,
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
        error: "The request did not return an answer. The settle may still have gone through, check the receipt list on the test vault before running again.",
      });
    }
  };

  const result = state.result;
  const remaining = result?.remaining ?? null;
  /* Policy limit comes from the live policy read, never a hardcoded 10000. */
  const policyLimit = L.policy.v ? String(L.policy.v.limit) : null;
  const canRunAgain = state.status === "success" && (remaining === null || remaining > 0);

  const buttonLabel =
    state.status === "loading"
      ? "Settling on testnet..."
      : state.status === "success" && canRunAgain
        ? "Run it again"
        : state.status === "error"
          ? "Try again"
          : state.status === "unconfirmed"
            ? "Settle unconfirmed"
            : "Run it live";

  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-4">
      <span className="dim2">{k}</span>
      <span className="text-right" style={{ color: "var(--secondary)" }}>
        {v}
      </span>
    </div>
  );

  const resultPanels = (
    <>
      {state.status === "success" && result ? (
        <div className="mt-5 space-y-3">
          <div className="mono text-[13px] space-y-1.5">
            {row("receipt", result.receiptIndex !== null ? "#" + result.receiptIndex : "pending, see the tx")}
            {row("obligation", result.obligationId ?? "-")}
            {row(
              "amount",
              result.amount !== null ? (
                <span title={fmtToken(result.amount) + " USDC, usdc.fakes.testnet, 6 decimals"}>{result.amount} units</span>
              ) : (
                "-"
              ),
            )}
            {row("recipient", result.recipient ?? "-")}
            {row("policy spent", result.policySpent !== null ? result.policySpent + (policyLimit !== null ? " of " + policyLimit + " base units" : " base units") : "-")}
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
          {remaining === 0 ? <p className="dim text-sm leading-relaxed">{DEMO_SETTLE_FALLBACK}</p> : null}
        </div>
      ) : null}

      {state.status === "error" && state.error ? (
        <div className="mt-5 space-y-2">
          <p className="text-sm text-ink">{state.error}</p>
          {state.fallback ? <p className="dim text-sm leading-relaxed">{state.fallback}</p> : null}
        </div>
      ) : null}

      {state.status === "unconfirmed" && state.error ? (
        <div className="mt-5 space-y-2">
          <p className="text-sm text-ink">{state.error}</p>
          {state.txHash ? (
            <div className="pt-1">
              <HashChip hash={state.txHash} />
            </div>
          ) : null}
          <div className="text-xs dim2 mono">
            {state.txHash ? (
              <a href={DEMO_EXPLORER_TX(state.txHash)} target="_blank" rel="noopener">
                Open the settle transaction in the explorer
              </a>
            ) : (
              "No tx hash was returned: check the receipt list on the test vault."
            )}
          </div>
          <p className="dim text-sm leading-relaxed">
            Do not run it again until the explorer shows the outcome for{" "}
            {state.obligationId ?? "the obligation"}.
          </p>
        </div>
      ) : null}

      {state.status === "usedUp" && state.error ? (
        <div className="mt-5 space-y-2">
          <p className="text-sm text-ink">{state.error}</p>
          {state.fallback ? <p className="dim text-sm leading-relaxed">{state.fallback}</p> : null}
          <p className="mono text-xs dim2">
            Same flow, no hosted key needed: npx cynex-mcp --sandbox, docs in services/mcp/README.md.
          </p>
        </div>
      ) : null}
    </>
  );

  const expectedBox = () => {
    const next = L.recTest.v;
    return (
      <div className="expected">
        <b>Press Run it live.</b>{" "}
        {next != null ? (
          <>
            You will see receipt {next}, PAID, and a transaction hash.
          </>
        ) : (
          <>You will see the next receipt, PAID, and a transaction hash.</>
        )}
        {!showUnprovenLine(state.status) && result ? (
          <span>
            Proven live: receipt {result.receiptIndex ?? "?"}, {result.obligationId ?? "demo settle"} PAID
            {result.txHash ? (
              <>
                {", tx "}
                <a href={DEMO_EXPLORER_TX(result.txHash)}>{result.txHash.slice(0, 8)}…</a>
              </>
            ) : null}
            .
          </span>
        ) : (
          <span>{DEMO_BUTTON_UNPROVEN_LINE}</span>
        )}
      </div>
    );
  };

  if (variant === "nav") {
    return (
      <>
        <button className="btn btn-primary sm flex-none" onClick={() => void run()} disabled={!demoButtonCanRun(state)}>
          {buttonLabel}
        </button>
        {state.status !== "idle" && state.status !== "loading" ? (
          <div
            className="fixed left-0 right-0 z-40 border-b"
            style={{ top, background: "var(--bg)", borderColor: "var(--line)" }}
          >
            <div className="wrap py-3 flex flex-wrap items-center gap-3">
              {state.status === "success" && result ? (
                <>
                  <Badge value="PAID" />
                  <span className="mono text-[13px]">
                    {result.receiptIndex !== null ? "Receipt #" + result.receiptIndex + ", " : ""}
                    {result.obligationId ?? "demo settle"} PAID
                    {result.txHash ? (
                      <>
                        {" · "}
                        <a href={DEMO_EXPLORER_TX(result.txHash)} target="_blank" rel="noopener">
                          tx {result.txHash.slice(0, 8)}…
                        </a>
                      </>
                    ) : null}
                  </span>
                  <a className="mono text-xs" style={{ color: "var(--accent-text)" }} href="#/proof">
                    See it on Proof →
                  </a>
                </>
              ) : (
                <span className="text-sm dim">{state.error ?? "The demo settle did not run."}</span>
              )}
              <button className="btn sm ghost ml-auto" onClick={() => dispatch({ type: "reset" })}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  if (variant === "hero") {
    return (
      <div>
        <div className="flex flex-wrap gap-3 items-center">
          <button className="btn btn-primary" onClick={() => void run()} disabled={!demoButtonCanRun(state)}>
            ▶ {buttonLabel}
          </button>
          <span className="mono text-xs dim2">
            {remaining !== null && state.status === "success"
              ? remaining + " demo settle" + (remaining === 1 ? "" : "s") + " left"
              : "10 pre-seeded demo obligations, each settles once"}
          </span>
          {actions}
        </div>
        {expectedBox()}
        {resultPanels}
      </div>
    );
  }

  return (
    <section className="wrap pt-12">
      <div className="panel p-6 fadein">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="kicker">Try it live</span>
          {state.status === "success" ? <Badge value="PAID" /> : null}
        </div>
        <h2 className="text-2xl md:text-3xl mb-4">Run one real settlement</h2>
        <p className="dim text-sm leading-relaxed max-w-3xl">
          One click settles the next pre-seeded demo obligation on testnet, 100 base units of fake USDC to the authorized recipient, with the
          exact terms read from the chain. No wallet, no login, no real value: testnet only, and the key that signs lives on the server,
          scoped to settle on the test vault and nothing else.
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-5">
          <button className="btn btn-primary" onClick={() => void run()} disabled={!demoButtonCanRun(state)}>
            {buttonLabel}
          </button>
          <span className="mono text-xs dim2">
            {remaining !== null && state.status === "success"
              ? remaining + " demo settle" + (remaining === 1 ? "" : "s") + " left"
              : "10 pre-seeded demo obligations, each settles once"}
          </span>
        </div>
        {expectedBox()}
        {resultPanels}
      </div>
    </section>
  );
}
