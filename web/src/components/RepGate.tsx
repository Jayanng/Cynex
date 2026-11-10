/* The live reputation gate. Enter any counterparty, run the five-signal
   engine against real chain data, and see the verdict the vault would act
   on. Unavailable signals say so with their real reason. This is the
   cynex_check_counterparty tool, made operable. */

import { useState } from "react";
import { checkCounterparty, type ReputationReport, type SignalResult } from "../lib/reputation";
import { MCP_TOOLS } from "../lib/features";
import { GradeBadge, Panel, Verdict } from "./ui";

function SignalVerdictBadge({ v }: { v: SignalResult["verdict"] }) {
  const cls = v === "ALLOW" ? "badge-pos" : v === "BLOCK" ? "badge-neg" : v === "WARN" ? "badge-warn" : "";
  return <span className={`badge ${cls}`}>{v}</span>;
}

export function RepGate({ preset }: { preset?: string }) {
  const [account, setAccount] = useState(preset ?? "cynex-agent.cynexmaster.testnet");
  const [report, setReport] = useState<ReputationReport | null>(null);
  const [running, setRunning] = useState(false);
  const tool = MCP_TOOLS.find((t) => t.name === "cynex_check_counterparty")!;

  async function run() {
    setRunning(true);
    setReport(null);
    const r = await checkCounterparty(account.trim());
    setReport(r);
    setRunning(false);
  }

  return (
    <Panel
      title="Reputation gate · cynex_check_counterparty"
      right={
        <span className="row" style={{ gap: 8 }}>
          <span className="badge badge-accent">5 live signals</span>
          <GradeBadge g="chain-read" />
        </span>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 14.5 }}>
        {tool.summary}
      </p>

      <div className="row" style={{ gap: 12, margin: "18px 0" }}>
        <div className="field" style={{ flex: 1, margin: 0 }}>
          <label htmlFor="rep-account">counterparty account</label>
          <input
            id="rep-account"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={run}
          disabled={running}
          style={{ alignSelf: "flex-end", marginBottom: 2 }}
        >
          {running ? "Checking…" : "Run the gate"}
        </button>
      </div>

      {running && (
        <div className="note">
          <strong>Running live.</strong> Reading the counterparty on chain, the vault receipt history, and the
          code-deployment record. Signals with no reachable source are marked unavailable, never guessed.
        </div>
      )}

      {report && (
        <>
          <div className="spread" style={{ margin: "22px 0 10px" }}>
            <Verdict kind={report.verdict as "ALLOW" | "WARN" | "BLOCK"} land />
            <div style={{ textAlign: "right" }}>
              <div className="big-num" style={{ color: report.score === null ? "var(--ink-3)" : "var(--pos-ink)" }}>
                {report.score === null ? "null" : report.score}
              </div>
              <div className="stat-label">score · null unless ALLOW</div>
            </div>
          </div>

          <div className="stack" style={{ margin: "18px 0" }}>
            {report.signals.map((s) => (
              <div key={s.id} className="signal-row">
                <div className="signal-name">{s.name}</div>
                <div className="signal-desc">
                  <span className={s.status === "unavailable" ? "warn-t" : ""}>{s.value}</span>
                  <br />
                  <span className="muted" style={{ fontSize: 12 }}>
                    {s.source}
                    {s.reason ? ` · ${s.reason}` : ""}
                  </span>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <SignalVerdictBadge v={s.verdict} />
                  <span className={`badge ${s.status === "ok" ? "badge-pos" : "badge-warn"}`}>{s.status}</span>
                </div>
              </div>
            ))}
          </div>

          <div>
            <h4 className="stat-label" style={{ marginBottom: 8 }}>
              reasons
            </h4>
            {report.reasons.length === 0 ? (
              <p className="muted mono" style={{ fontSize: 13 }}>
                none
              </p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {report.reasons.map((r, i) => (
                  <li key={i} className="mono" style={{ fontSize: 12.5, color: "var(--ink-2)", marginBottom: 4 }}>
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="note" style={{ marginBottom: 0 }}>
            <strong>Defense in depth only.</strong> A good score never overrides the vault. The gate is advisory:
            a BLOCK stops a settlement request, a WARN escalates to the owner, and the terms are enforced on chain
            regardless of reputation.
          </div>
        </>
      )}
    </Panel>
  );
}
