/* The MCP playground. Six tools over stdio, made operable in the browser.
   The read-only tools run real chain reads. prepare_obligation validates
   locally and returns the exact create_obligation arguments. The settle tool
   is gated to live mode and signs with the scoped key only when one exists. */

import { useState } from "react";
import { MCP_TOOLS, type McpTool } from "../lib/features";
import { viewCall, getBalances, type ObligationView, type ReceiptRow, type BalanceView } from "../lib/chain";
import { RECORD } from "../lib/record";
import { baseUnits, nsToUtc, shortHash, explorerTx } from "../lib/format";
import { checkCounterparty, type ReputationReport } from "../lib/reputation";
import { demoKeyConfigured, attemptLiveSettle, type LiveAttemptResult } from "../lib/demo-key";
import { Chip, GradeBadge, Panel, Verdict } from "./ui";

type Result = { kind: "json"; data: unknown } | { kind: "verdict"; verdict: string; code?: string } | { kind: "error"; msg: string };

function ResultView({ result }: { result: Result }) {
  if (result.kind === "error") {
    return (
      <div className="cmd" style={{ borderColor: "var(--neg)" }}>
        <div className="cmd-bar">
          <div className="lights"><i /><i /><i /></div>
          <span className="cmd-label">result · error</span>
        </div>
        <pre className="neg">{result.msg}</pre>
      </div>
    );
  }
  if (result.kind === "verdict") {
    return <Verdict kind={result.verdict as "REFUSED" | "PAID" | "OK"} code={result.code} />;
  }
  return (
    <div className="cmd">
      <div className="cmd-bar">
        <div className="lights"><i /><i /><i /></div>
        <span className="cmd-label">result · as the chain returns it</span>
      </div>
      <pre>{JSON.stringify(result.data, null, 2)}</pre>
    </div>
  );
}

export function McpPlayground() {
  const [active, setActive] = useState<McpTool>(MCP_TOOLS[0]);
  const [args, setArgs] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const i of MCP_TOOLS[0].inputs) init[i.key] = i.value ?? "";
    return init;
  });
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);

  function selectTool(t: McpTool) {
    setActive(t);
    setResult(null);
    const init: Record<string, string> = {};
    for (const i of t.inputs) init[i.key] = i.value ?? "";
    setArgs(init);
  }

  async function invoke() {
    setRunning(true);
    setResult(null);
    try {
      switch (active.name) {
        case "cynex_check_counterparty": {
          const r: ReputationReport = await checkCounterparty(args.account_id);
          setResult({ kind: "json", data: r });
          break;
        }
        case "cynex_get_obligation": {
          const o = await viewCall<ObligationView | null>(RECORD.vaults.test, "get_obligation", {
            obligation_id: args.obligation_id,
          });
          setResult(o ? { kind: "json", data: o } : { kind: "error", msg: "obligation not found, or the read was unavailable" });
          break;
        }
        case "cynex_list_receipts": {
          const rows = await viewCall<ReceiptRow[]>(RECORD.vaults.test, "receipts", {
            start: Number(args.start) || 0,
            limit: Math.min(Number(args.limit) || 20, 100),
          });
          setResult(rows ? { kind: "json", data: rows } : { kind: "error", msg: "receipts read failed" });
          break;
        }
        case "cynex_get_policy": {
          const [policy, balances] = await Promise.all([
            viewCall<unknown>(RECORD.vaults.test, "get_policy", { policy_id: args.policy_id }),
            getBalances(RECORD.vaults.test, args.policy_id),
          ]);
          setResult({ kind: "json", data: { policy, balances: balances as BalanceView | null } });
          break;
        }
        case "cynex_prepare_obligation": {
          const problems: string[] = [];
          if (args.obligation_id.length > 64) problems.push("obligation_id is at most 64 characters");
          if (args.amount && !/^\d+$/.test(args.amount)) problems.push("amount must be a decimal string of digits");
          if (args.recipient && !/^[a-z0-9._-]+$/.test(args.recipient)) problems.push("recipient is not a valid account id");
          if (args.nonce && !/^\d+$/.test(args.nonce)) problems.push("nonce must be a decimal string");
          if (problems.length) {
            setResult({ kind: "error", msg: problems.join("\n") });
          } else {
            setResult({
              kind: "json",
              data: {
                note: "prepared only. submits nothing, holds no owner key. review and sign these create_obligation arguments.",
                create_obligation: {
                  policy_id: args.policy_id,
                  obligation_id: args.obligation_id,
                  recipient: args.recipient,
                  amount: args.amount,
                  evidence_type: args.evidence_type,
                  expires_at_ns: args.expires_at_ns ?? "set by owner",
                  nonce: args.nonce,
                },
                summary: `Pay ${args.amount} base units to ${args.recipient} under ${args.policy_id}, once, with ${args.evidence_type} evidence.`,
              },
            });
          }
          break;
        }
        case "cynex_request_settlement": {
          if (!demoKeyConfigured()) {
            setResult({ kind: "error", msg: "live mode not configured. no scoped key is supplied to this deployment, so settlement cannot be signed. this tool moves funds and needs a scoped settle key." });
            break;
          }
          const r: LiveAttemptResult = await attemptLiveSettle(args.obligation_id, args.proposed_recipient, args.proposed_amount, 1002);
          setResult(
            r.errCode
              ? { kind: "verdict", verdict: "REFUSED", code: r.errCode }
              : r.ok
                ? { kind: "verdict", verdict: "PAID", code: r.txHash ?? "settled" }
                : { kind: "error", msg: r.detail },
          );
          break;
        }
        default:
          setResult({ kind: "error", msg: "unknown tool" });
      }
    } catch (e) {
      setResult({ kind: "error", msg: String((e as Error)?.message ?? e) });
    }
    setRunning(false);
  }

  return (
    <Panel
      title="MCP tools · six over stdio"
      right={
        <span className="row" style={{ gap: 8 }}>
          <span className="badge badge-info">agent interface</span>
          <GradeBadge g="chain-read" />
        </span>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 14.5 }}>
        The same six tools the MCP server exposes to an agent, runnable here against testnet. Read-only tools
        return live chain state. The settle tool holds the scoped key and is gated to live mode.
      </p>

      <div className="tabs" role="tablist" style={{ margin: "18px 0" }}>
        {MCP_TOOLS.map((t) => (
          <button
            key={t.name}
            role="tab"
            type="button"
            className="tab"
            aria-selected={active.name === t.name}
            onClick={() => selectTool(t)}
          >
            {t.name.replace("cynex_", "")}
            <span className={`badge ${t.readOnly ? "badge-pos" : "badge-warn"}`} style={{ marginLeft: 8 }}>
              {t.readOnly ? "read" : "write"}
            </span>
          </button>
        ))}
      </div>

      <div className="panel" style={{ background: "var(--bg-2)", borderColor: "var(--line-2)" }}>
        <div className="panel-body">
          <div className="mono accent" style={{ fontSize: 13, marginBottom: 6 }}>
            {active.name}
          </div>
          <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
            {active.summary}
          </p>

          <div className="grid grid-2" style={{ margin: "16px 0" }}>
            {active.inputs.map((i) => (
              <div className="field" key={i.key}>
                <label htmlFor={`arg-${i.key}`}>{i.label}</label>
                {i.type === "select" ? (
                  <select id={`arg-${i.key}`} value={args[i.key] ?? ""} onChange={(e) => setArgs({ ...args, [i.key]: e.target.value })}>
                    {(i.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`arg-${i.key}`}
                    type="text"
                    value={args[i.key] ?? ""}
                    placeholder={i.placeholder}
                    onChange={(e) => setArgs({ ...args, [i.key]: e.target.value })}
                    spellCheck={false}
                  />
                )}
              </div>
            ))}
          </div>

          <button type="button" className="btn btn-primary" onClick={invoke} disabled={running}>
            {running ? "Invoking…" : `Invoke ${active.name}`}
          </button>

          {result && (
            <>
              <div className="row" style={{ gap: 10, margin: "18px 0 10px" }}>
                <span className="stat-label" style={{ margin: 0 }}>
                  response
                </span>
                <span className="badge">{active.invokes}</span>
              </div>
              <ResultView result={result} />
            </>
          )}
        </div>
      </div>

      <div className="note" style={{ marginBottom: 0 }}>
        <strong>What the settle tool refuses to do.</strong> It will not settle unless the obligation reads
        READY, will not proceed on a BLOCK reputation verdict, and escalates WARN to the owner. The scoped key
        can only knock on one door. The vault decides.
      </div>
    </Panel>
  );
}
