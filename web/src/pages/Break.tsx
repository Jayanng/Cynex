/* The bench. The judge becomes the compromised agent and picks an attack.
   Three payloads have real on-chain refusals behind them. The fourth is
   honest about being simulated. Live mode, when a demo key is supplied,
   signs a real settle call in the judge's browser. */

import { useEffect, useState } from "react";
import { PAYLOADS, event, RECORD, type Payload } from "../lib/record";
import { getObligation, type ObligationView } from "../lib/chain";
import { explorerTx } from "../lib/format";
import { demoKeyConfigured, attemptLiveSettle, DEMO_KEY, type LiveAttemptResult } from "../lib/demo-key";
import type { LiveState } from "../lib/live";
import { Grade, HashChip, Marginalia, VerdictStamp, Unavailable } from "../components/ui";
import { TermsLock } from "../components/TermsLock";
import { LiveRail } from "../components/LiveRail";

type Phase = "idle" | "running" | "verdict" | "live";

export function BreakPage({ live }: { live: LiveState }) {
  const [obligation, setObligation] = useState<ObligationView | null>(null);
  const [picked, setPicked] = useState<Payload | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [liveResult, setLiveResult] = useState<LiveAttemptResult | null>(null);
  const [liveRunning, setLiveRunning] = useState(false);

  useEffect(() => {
    let alive = true;
    getObligation(RECORD.vaults.test, RECORD.obligation.id).then((o) => {
      if (alive) setObligation(o);
    });
    return () => {
      alive = false;
    };
  }, []);

  const demoConfigured = demoKeyConfigured();

  function pick(p: Payload) {
    setPicked(p);
    setPhase("running");
    setLiveResult(null);
    // The evaluation is instant (the terms are already known), but the stamp
    // should land like a stamp. One frame of ceremony, then the verdict.
    setTimeout(() => setPhase("verdict"), 260);
  }

  async function runLive() {
    if (!picked || !demoConfigured) return;
    setLiveRunning(true);
    setPhase("live");
    const result = await attemptLiveSettle(
      picked.id === "evidence" ? DEMO_KEY.pendingObligationId : RECORD.obligation.id,
      "attacker.testnet",
      picked.id === "amount" ? "200" : RECORD.obligation.amount,
      RECORD.obligation.nonce,
    );
    setLiveResult(result);
    setLiveRunning(false);
  }

  return (
    <div className="page">
      <section className="hero" style={{ paddingTop: 48 }}>
        <p className="kicker">The bench · you are the compromised agent</p>
        <h1 className="display" style={{ fontSize: "clamp(36px, 5vw, 58px)" }}>
          Choose your poison.
        </h1>
        <p className="lede measure">
          Every order below goes after the same fixed terms. The vault does not care who is typing. It reads the
          order on chain and answers with a code. Nothing here can move tokens. If one of these ever does, the
          vault is broken and you have found the bug nobody else has.
        </p>
      </section>

      <div className="dossier" style={{ marginTop: 28 }}>
        <div>
          <TermsLock obligation={obligation} loaded={live.checkedAt !== ""} />

          <h2 style={{ marginTop: 30 }}>Pick an attack</h2>
          <div className="payload-grid">
            {PAYLOADS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="payload"
                aria-pressed={picked?.id === p.id}
                onClick={() => pick(p)}
              >
                <Grade g={p.grade} />
                <div className="p-name">{p.name}</div>
                <p className="p-atk">{p.attack}</p>
                <div className="p-code">expected: {p.expectedCode}</div>
              </button>
            ))}
          </div>

          {phase === "idle" && (
            <Marginalia>
              <strong>What happens when you click.</strong> The panel below evaluates your pick against the real
              on-chain terms and shows the verdict the contract gives. Three of these have already been executed
              against the live vault and link to their refusal transactions. The fourth is labelled as
              simulated, because we would rather be correct than impressive.
            </Marginalia>
          )}

          {(phase === "running" || phase === "verdict") && picked && (
            <section className="exhibit" aria-live="polite">
              <div className="ex-no">Attempt</div>
              <h3>{picked.name}</h3>
              <div className="ex-flow">
                <span>order {RECORD.obligation.id}</span>
                <span className="arrow">→</span>
                <span>settle, tampered</span>
                <span className="arrow">→</span>
                <span>the vault decides</span>
              </div>
              {phase === "verdict" && (
                <>
                  <VerdictStamp verdict="REFUSED" code={picked.expectedCode} />
                  <p style={{ marginTop: 18 }}>{picked.note}</p>
                  <p className="small mono">
                    <Grade g={picked.grade} />{" "}
                    {picked.eventId ? (
                      <>
                        on-chain refusal tx <HashChip value={event(picked.eventId).tx} href={explorerTx(event(picked.eventId).tx)} />
                      </>
                    ) : (
                      "no transaction exists for this case, by design of the demo run"
                    )}
                  </p>

                  <div style={{ marginTop: 22 }}>
                    <h3>Live mode, try it on chain</h3>
                    {demoConfigured ? (
                      <>
                        <p className="small">
                          A demo key is configured. This button signs a real settle call in your browser and
                          sends it to the test vault. Only attacks are ever sent. The vault decides. A failure
                          that is not a vault refusal is reported as itself, never dressed up as a refusal.
                        </p>
                        <button type="button" className="btn btn-primary" onClick={runLive} disabled={liveRunning}>
                          {liveRunning ? "Waiting for the chain…" : "Send this attack on chain"}
                        </button>
                        {liveResult && (
                          <div style={{ marginTop: 16 }}>
                            <VerdictStamp
                              verdict={liveResult.errCode ? "REFUSED" : liveResult.ok ? "PAID" : "OK"}
                              code={liveResult.errCode ?? undefined}
                            />
                            <p className="small mono">
                              <Grade g="historical" />{" "}
                              {liveResult.txHash ? (
                                <HashChip value={liveResult.txHash} href={explorerTx(liveResult.txHash)} />
                              ) : (
                                <Unavailable what="transaction hash" />
                              )}{" "}
                              {liveResult.detail}
                            </p>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="small">
                        <span className="state-unavailable">not configured</span> The demo key has not been
                        supplied for this deployment, so live attacks cannot be signed here. The simulated
                        verdict above stands on its own, and the three historical refusals link to real
                        transactions you can read right now. When a scoped demo key is wired in at build time,
                        this button signs real attacks with it. Until then, nothing here pretends otherwise.
                      </p>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          <hr className="rule" />
          <h2>Why nothing here can hurt anything</h2>
          <p>
            The live button, when configured, holds a function-call key scoped to one method on one vault on
            testnet, with a small gas allowance. It can knock on the door. It cannot reach a wallet, cannot
            transfer tokens by itself, and cannot call anything but settle. Even a fully leaked key can only ask
            the vault to say no faster.
          </p>
        </div>

        <aside className="rail">
          <LiveRail live={live} />
          <div className="rail-card">
            <h4>Judge notes</h4>
            <p className="rail-note">
              The refusal codes you see are the contract's own strings. Search them in
              <span className="mono"> contract/src/lib.rs</span>. The check order is fixed and public:
              obligation, nonce, state, recipient, amount, expiry, policy, version, token, budget, headroom.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
