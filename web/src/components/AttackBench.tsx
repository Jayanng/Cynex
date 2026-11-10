/* The attack bench. The judge is the compromised agent. Four real scenarios
   from services/attacks/attacks.ts, each mapped to the exact contract code
   that refuses it. Three have on-chain refusals to link. Live mode, when a
   demo key is supplied, signs a real settle call in the browser. */

import { useState } from "react";
import { ATTACKS, type AttackScenario } from "../lib/features";
import { event } from "../lib/record";
import { explorerTx } from "../lib/format";
import { demoKeyConfigured, attemptLiveSettle, DEMO_KEY, type LiveAttemptResult } from "../lib/demo-key";
import { Chip, GradeBadge, Panel, Verdict } from "./ui";

export function AttackBench() {
  const [picked, setPicked] = useState<AttackScenario | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "verdict">("idle");
  const [live, setLive] = useState<LiveAttemptResult | null>(null);
  const [liveRunning, setLiveRunning] = useState(false);
  const demo = demoKeyConfigured();

  function fire(a: AttackScenario) {
    setPicked(a);
    setLive(null);
    setPhase("running");
    setTimeout(() => setPhase("verdict"), 240);
  }

  async function fireLive() {
    if (!picked || !demo) return;
    setLiveRunning(true);
    const obligationId = picked.liveObligation;
    const amount = picked.id === "terms" ? "200" : "100";
    const r = await attemptLiveSettle(obligationId, "attacker.testnet", amount, 1002);
    setLive(r);
    setLiveRunning(false);
  }

  return (
    <Panel
      title="Attack bench · the four runner scenarios"
      right={
        <span className="row" style={{ gap: 8 }}>
          <span className="badge badge-neg">no tokens can move</span>
          <GradeBadge g="chain-read" />
        </span>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 14.5 }}>
        Every scenario goes after the same fixed order. The vault does not care who is typing. It reads the
        terms on chain and answers with a code. If any of these ever moves a token, the vault is broken and you
        have found the bug nobody else has.
      </p>

      <div className="grid grid-4" style={{ margin: "20px 0" }}>
        {ATTACKS.map((a) => (
          <button
            key={a.id}
            type="button"
            className="panel"
            aria-pressed={picked?.id === a.id}
            onClick={() => fire(a)}
            style={{
              textAlign: "left",
              padding: 16,
              cursor: "pointer",
              borderColor: picked?.id === a.id ? "var(--neg)" : "var(--line)",
              background: picked?.id === a.id ? "var(--neg-soft)" : "var(--surface)",
            }}
          >
            <span className={`badge ${a.onChain ? "badge-accent" : ""}`}>{a.onChain ? "on-chain" : "policy"}</span>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 15, margin: "10px 0 6px" }}>
              {a.name}
            </div>
            <div className="mono neg" style={{ fontSize: 11 }}>
              {a.expectedCode}
            </div>
          </button>
        ))}
      </div>

      {picked && (
        <div className="panel" style={{ borderColor: "var(--line-2)", background: "var(--bg-2)" }}>
          <div className="panel-body">
            <div className="spread" style={{ alignItems: "flex-start" }}>
              <div>
                <div className="stat-label" style={{ marginBottom: 6 }}>
                  attempt · {picked.field}
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 600 }}>{picked.name}</div>
                <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
                  {picked.attack}
                </p>
              </div>
              {phase === "verdict" && <Verdict kind="REFUSED" code={picked.expectedCode} />}
            </div>

            {phase === "verdict" && (
              <>
                <p style={{ margin: "16px 0", fontSize: 14.5, color: "var(--ink-2)" }}>{picked.note}</p>
                <div className="row" style={{ gap: 12 }}>
                  <GradeBadge g={picked.onChain ? "historical" : "simulated"} />
                  {picked.eventId ? (
                    <Chip value={event(picked.eventId).tx} href={explorerTx(event(picked.eventId).tx)} label="refusal tx" />
                  ) : (
                    <span className="muted mono" style={{ fontSize: 12 }}>
                      no on-chain tx for this case, shown against the live policy balance instead
                    </span>
                  )}
                </div>

                <div className="hr" style={{ margin: "22px 0" }} />

                <div className="stat-label" style={{ marginBottom: 10 }}>
                  live mode · fire this on chain from your browser
                </div>
                {demo ? (
                  <>
                    <p className="muted" style={{ fontSize: 13.5, marginTop: 0 }}>
                      A scoped demo key is configured. This signs a real settle call and sends it to the test
                      vault. Only attacks are sent. A failure that is not a vault refusal is reported as itself.
                    </p>
                    <button type="button" className="btn btn-primary" onClick={fireLive} disabled={liveRunning}>
                      {liveRunning ? "Waiting for the chain…" : "Send this attack on chain"}
                    </button>
                    {live && (
                      <div style={{ marginTop: 16 }}>
                        <Verdict kind={live.errCode ? "REFUSED" : live.ok ? "PAID" : "OK"} code={live.errCode ?? undefined} />
                        <div className="row" style={{ gap: 10, marginTop: 12 }}>
                          {live.txHash && <Chip value={live.txHash} href={explorerTx(live.txHash)} label="tx" />}
                          <span className="muted mono" style={{ fontSize: 12 }}>
                            {live.detail}
                          </span>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>
                    <span className="state-unavail">not configured</span> No demo key is supplied for this
                    deployment, so live attacks cannot be signed here. The historical refusals above are real and
                    link to their transactions. Wire a scoped key at build time and this button signs real
                    attacks. Until then, nothing pretends otherwise.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
