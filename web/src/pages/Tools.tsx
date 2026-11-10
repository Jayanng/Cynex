/* Tools. The six MCP tools over stdio, runnable against testnet. This is the
   agent's interface to Cynex, made operable for a judge. */

import { McpPlayground } from "../components/McpTools";
import { MCP_TOOLS, REP_THRESHOLDS } from "../lib/features";
import { CommandBlock, GradeBadge, Panel } from "../components/ui";

export function ToolsPage() {
  return (
    <section className="section" style={{ paddingTop: 48 }}>
      <div className="wrap">
        <div className="section-head">
          <p className="kicker">the agent interface</p>
          <h2 className="section-title">Six tools. That is the entire surface an agent gets.</h2>
          <p className="section-lead">
            The MCP server hands an agent exactly six tools over stdio, four of them read-only. No transfer, no
            add_key, no arbitrary call. The two that matter gate on reputation and on-chain terms. Drive them
            below against the live vault.
          </p>
        </div>

        <div style={{ marginBottom: 24 }}>
          <McpPlayground />
        </div>

        <div className="grid grid-2">
          <Panel title="What each tool is allowed to do" right={<GradeBadge g="repo" />}>
            <div className="stack">
              {MCP_TOOLS.map((t) => (
                <div key={t.name} className="spread" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="mono" style={{ fontSize: 12.5, color: "var(--ink)" }}>{t.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{t.invokes}</div>
                  </div>
                  <span className={`badge ${t.readOnly ? "badge-pos" : "badge-warn"}`}>{t.readOnly ? "read-only" : "moves funds"}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="The reputation verdicts the tools enforce" right={<GradeBadge g="repo" />}>
            <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
              cynex_request_settlement refuses a BLOCK and escalates a WARN. The gate is advisory defense in
              depth. The vault enforces the terms regardless.
            </p>
            <div className="stack" style={{ marginTop: 8 }}>
              {Object.entries(REP_THRESHOLDS.verdicts).map(([k, v]) => (
                <div key={k} style={{ borderLeft: `2px solid ${k === "BLOCK" ? "var(--neg)" : k === "ALLOW" ? "var(--pos)" : "var(--warn)"}`, paddingLeft: 12 }}>
                  <div className="mono" style={{ fontSize: 12.5, color: "var(--ink)" }}>{k}</div>
                  <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{v}</div>
                </div>
              ))}
            </div>
            <div className="note" style={{ marginBottom: 0, marginTop: 16 }}>
              <strong>{REP_THRESHOLDS.scoreRule}</strong> Code-change recency warns under {REP_THRESHOLDS.codeChangeWarnMs} and blocks under {REP_THRESHOLDS.codeChangeBlockMs}.
            </div>
          </Panel>
        </div>

        <div className="grid grid-2" style={{ marginTop: 24 }}>
          <CommandBlock label="run the MCP server over stdio" command="node frontend/dist-test/services/mcp/server.js" expected="six tools listed on stdio" />
          <CommandBlock label="drive it with the bundled test client" command="node frontend/dist-test/services/mcp/test-client.js" expected="tool calls round-trip against testnet" />
        </div>
      </div>
    </section>
  );
}
