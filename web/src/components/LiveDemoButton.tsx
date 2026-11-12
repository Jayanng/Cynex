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
 * One variant: the big orange button with the expected-result box,
 * the result, and the Dismiss-free flow. The header and Home only
 * link to it; they do not settle. */

import { useReducer, useRef } from "react";
import { fmtToken } from "../lib/near";
import { useLive } from "../lib/live";
import {
  DEMO_BUTTON_PROVEN_LINE,
  DEMO_EXPLORER_TX,
  createInFlightGuard,
  DEMO_SETTLE_ENDPOINT,
  DEMO_SETTLE_FALLBACK,
  demoButtonCanRun,
  demoButtonReducer,
  initialDemoButtonState,
  parseDemoSettleResponse,
} from "../lib/demoSettle";
import { Badge, HashChip } from "./ui";

export function LiveDemoButton({ actions }: { actions?: React.ReactNode }) {
  const [state, dispatch] = useReducer(demoButtonReducer, initialDemoButtonState);
  const { live: L, refreshLive } = useLive();
  const guardRef = useRef(createInFlightGuard());

  const run = async () => {
    if (!guardRef.current.tryAcquire()) return;
    if (!demoButtonCanRun(state)) {
      guardRef.current.release();
      return;
    }
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
        void refreshLive();
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
      // The request never returned an answer, so the tx status cannot
      // be established: the settle may have landed. Never offer a
      // retry here; the user checks the receipt list instead.
      dispatch({
        type: "unconfirmed",
        error: "The request did not return an answer. The settle may still have gone through, check the receipt list on the test vault before running again.",
      });
    } finally {
      guardRef.current.release();
    }
  };

  const result = state.result;
  const remaining = result?.remaining ?? null;
  /* Policy limit comes from the live policy read, never a hardcoded 10000. */
  const policyLimit = L.policy.v ? String(L.policy.v.limit) : null;
  const canRunAgain = state.status === "success" && (remaining === null || remaining > 0);

  /* Live state 12 Nov 2026: demo-live-001 to 005 are PAID, demo-live-006
     to 010 are READY, so 5 are left. After a success the remaining count
     comes from the API. */
  const buttonLabel =
    state.status === "loading"
      ? "Settling on testnet..."
      : state.status === "success" && canRunAgain
        ? "Run it again"
        : state.status === "success"
          ? "Demo settles used up"
          : state.status === "error"
          ? "Try again"
          : state.status === "unconfirmed"
            ? "Settle unconfirmed"
            : state.status === "usedUp"
              ? "Demo settles used up"
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
    /* On success the expected sentence is gone: the box shows only the
       proven result, so a stale expected receipt can never sit next to it.
       The expected result never names a specific receipt number: live
       state can move between render and click, so the number is not
       promised in advance. */
    if (result && state.status === "success") {
      return (
        <div className="expected">
          <b>Proven live:</b>{" "}
          {result.receiptIndex !== null ? <>receipt {result.receiptIndex}, </> : null}
          {result.obligationId ?? "demo settle"} PAID
          {result.txHash ? (
            <>
              {", tx "}
              <a href={DEMO_EXPLORER_TX(result.txHash)}>{result.txHash.slice(0, 8) + String.fromCharCode(8230)}</a>
            </>
          ) : null}
          .
        </div>
      );
    }
    return (
      <div className="expected">
        <b>Press Run it live.</b>{" "}
        <>You will see the next receipt, PAID, and a transaction hash.</>
        <span>{DEMO_BUTTON_PROVEN_LINE}</span>
      </div>
    );
  };
      /* The Run it live section on Break it: the big orange button from the
     dark console design, the expected-result box, then the result. */
  const showArrow =
    state.status === "idle" || (state.status === "success" && canRunAgain) || state.status === "error";
  return (
    <div>
      <button className="btn-big" onClick={() => void run()} disabled={!demoButtonCanRun(state)}>
        {buttonLabel}
        {showArrow ? " \u2192" : ""}
      </button>
      {actions}
      {expectedBox()}
      {resultPanels}
    </div>
  );


}
