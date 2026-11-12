/* Cynex web, shared page fragments.
   Refusal band, refusal breakdown, trust row, verify section,
   reputation gate, footer, and the live counts line. */

import { AGENT, CP, REPO, TEST_COUNTS, USECASE } from "../lib/data";
import { useLive } from "../lib/live";
import { Icon, Badge, HashChip, Unavail, LoadTxt, CmdBlock } from "./ui";
import { Logo } from "./Logo";

/* ---------- footer ---------- */
export function Footer() {
  return (
    <footer className="mt-16 border-t" style={{ borderColor: "var(--line2)" }}>
      <div className="wrap py-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Logo markSize={24} />
            <div className="mono text-xs dim2 leading-relaxed">CYNEX · NEAR testnet, no mainnet funds</div>
          </div>
          <div className="flex items-center gap-4">
            <a className="mono text-xs inline-flex items-center gap-2" href={REPO} target="_blank" rel="noopener">
              github.com/Jayanng/Cynex{" "}
              <span style={{ width: 16, height: 16, display: "inline-grid", placeItems: "center" }}>
                <Icon name="ext" />
              </span>
            </a>
          </div>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 mono text-xs pt-5 mt-5 border-t" style={{ borderColor: "var(--line2)" }} aria-label="Site">
          <a href="#/">Home</a>
          <a href="#/demo/guided">Guided demo</a>
          <a href="#/attack">Break it</a>
          <a href="#/docs">Docs</a>
          <a href="#/proof">Proof</a>
        </nav>
      </div>
    </footer>
  );
}

/* ---------- live counts line (used on home verify + proof) ---------- */
export function CountsLine() {
  const { live: L } = useLive();
  const f = L.recTest;
  if (f.err) return <Unavail />;
  if (!f.rows) return <LoadTxt />;
  const ok = f.link?.allOk;
  return (
    <span className="inline-flex items-center gap-2">
      <span style={{ color: ok ? "var(--pos-text)" : "var(--warn-text)", width: 16, height: 16, display: "inline-grid", placeItems: "center" }}>
        <Icon name={ok ? "check" : "warn"} />
      </span>
      <span className="mono text-[13px]">
        test vault: <b className="text-ink">{f.rows.length}</b> receipts · in-browser check: index contiguity only ·{" "}
        <b style={{ color: ok ? "var(--pos-text)" : "var(--warn-text)" }}>{ok ? "all ok" : "check failed"}</b> · canonical hash recompute: verify-live
      </span>
    </span>
  );
}

/* ---------- refusal breakdown: the four checks behind receipt 24 ----------
   Rows are data-driven from USECASE.attacks: the tx hashes and error codes
   come from the data, never hardcoded here. The check names and the plain
   wording of what was wrong are display text, keyed by error code. */
const REFUSAL_META: Record<string, [string, string]> = {
  ERR_INVALID_STATE: ["Evidence missing", "Settle called before evidence was submitted."],
  ERR_RECIPIENT_SUBSTITUTION: ["Recipient changed", "Proposed recipient did not match the recipient fixed at authorization."],
  ERR_TERMS_MISMATCH: ["Amount changed", "Proposed 200 base units, authorized 100."],
  ERR_NONCE_ALREADY_CONSUMED: ["Replay", "Same nonce reused after the order was paid."],
};

export function RefusalBreakdown({ dark }: { dark?: boolean }) {
  const rows = USECASE.attacks.filter((a) => a.code !== "PAID");
  const th = dark ? { color: "var(--bg)", opacity: 0.6 } : undefined;
  const td = dark ? { color: "var(--bg)" } : undefined;
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th style={th}>Check</th>
            <th style={th}>What was wrong</th>
            <th style={th}>Error code</th>
            <th style={th}>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const meta = REFUSAL_META[a.code] ?? [a.label, ""];
            return (
              <tr key={a.code}>
                <td style={td}>{meta[0]}</td>
                <td style={td}>{meta[1]}</td>
                <td>
                  <span className="codechip">{a.code}</span>
                </td>
                <td style={td}>
                  <span className="inline-flex flex-wrap items-center gap-2">
                    {a.tx ? (
                      <HashChip hash={a.tx} />
                    ) : (
                      <span className="mono text-xs dim2">No tx</span>
                    )}
                    <span className="mono text-xs dim2">0 tokens moved</span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


/* ---------- refusal panel: the dark band, used once, for the refusal ---------- */
export function RefusalPanel() {
  return (
    <section className="wrap mt-12 md:mt-14">
      <div className="band-ink p-6 md:p-8">
        <div className="kicker mb-3">01&nbsp;&nbsp;The refusal</div>
        <h2 className="text-2xl md:text-3xl mb-3" style={{ color: "var(--bg)" }}>
          This already happened. On chain. Not a story.
        </h2>
        <p className="dim text-sm md:text-base leading-relaxed max-w-3xl">
          The strongest claim Cynex makes is a negative one: a compromised agent cannot move money it was not told to move. Here is the transaction that proves it.
        </p>
        <div className="grid md:grid-cols-2 gap-8 mt-8 items-start">
          <div>
            <span
              className="mono text-[13px] inline-block rounded-lg border px-4 py-3"
              style={{ letterSpacing: ".12em", color: "var(--band-red)", borderColor: "var(--band-red-border)", background: "var(--band-red-bg)" }}
            >
              REFUSED · ERR_RECIPIENT_SUBSTITUTION
            </span>
            <div className="mono text-[13px] space-y-2 mt-5">
              <div className="flex justify-between gap-4">
                <span className="dim">Attempt</span>
                <span className="text-right" style={{ color: "var(--bg)" }}>Pay a different account than the order names</span>
              </div>
              <div className="flex justify-between gap-4 items-center">
                <span className="dim">Tx</span>
                <HashChip hash="EiBHjMBqZfBLZB33H4odbBfskGbVCX1Jor422t5S1cpX" />
              </div>
              <div className="flex justify-between gap-4">
                <span className="dim">Moved</span>
                <span style={{ color: "var(--band-green)", fontWeight: 600 }}>0 tokens</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="dim">Vault</span>
                <span className="text-right" style={{ color: "var(--bg)", whiteSpace: "nowrap" }}>cynex-testvault.cynexmaster.testnet</span>
              </div>
            </div>
          </div>
          <div>
            <p className="dim leading-relaxed mb-5">
              The vault does not trust the caller, the prompt, or the agent. It reads the order it was given at authorization, compares the request to it, and answers with a code. A refusal is the product working, and every refusal is a receipt you can open.
            </p>
            <a className="btn" href="#/attack" style={{ borderColor: "var(--band-border)", color: "var(--bg)", background: "transparent" }}>
              Break it yourself →
            </a>
          </div>
        </div>
        <h3 className="text-xl mt-10 mb-2" style={{ color: "var(--bg)" }}>
          Why the vault refused, item by item
        </h3>
        <p className="dim text-sm leading-relaxed max-w-3xl mb-4">
          Four checks, four refusals, before the correct settle in receipt 24. Each row is one check the vault ran against the authorized terms.
        </p>
        <RefusalBreakdown dark />
        <p className="mono text-xs dim mt-4">
          Receipt 24, usecase-report-002: four refusals, then PAID. The four txs above are the refusals.
        </p>
      </div>
    </section>
  );
}


/* ---------- verify home: one verify command on Home, with live expected output ---------- */
export function VerifyHome() {
  const { live: L } = useLive();
  const count = L.recTest.v;
  return (
    <div>
      <div className="mb-3">
        <CmdBlock cmdKey="verify" />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span className="mono text-xs dim2">Expected:</span>
        {L.recTest.err ? (
          <Unavail />
        ) : count == null ? (
          <LoadTxt />
        ) : (
          <span className="mono text-[13px]">
            every row verified_ok = true, {count} receipts on the test vault, all ok.
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4 mt-3">
        <span data-live-region="counts">
          <CountsLine />
        </span>
        <a className="mono text-xs inline-flex items-center gap-2" style={{ color: "var(--accent-text)" }} href="#/proof">
          Full record, Proof →
        </a>
      </div>
    </div>
  );
}

/* ---------- trust row (home): one wide panel, four quiet stats ---------- */
export function TrustRow() {
  const { live: L } = useLive();
  const cell = (big: React.ReactNode, sub: string) => (
    <div>
      <div className="text-xl font-medium text-ink">{big}</div>
      <div className="dim text-xs mt-1">{sub}</div>
    </div>
  );
  const receiptsCell = () => {
    const f = L.recTest;
    if (f.err) return <Unavail />;
    if (f.v == null) return <LoadTxt />;
    return (
      <>
        <span className="text-xl font-medium text-ink">{f.v}</span>
        <span className="dim text-xs block mt-1">receipts on chain, test vault · live</span>
      </>
    );
  };
  return (
    <section className="wrap mt-8">
      <div className="panel p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {cell("463 tests passing", TEST_COUNTS + " \u00b7 Jest")}
          {cell("25 error codes", "defined in the contract, 11 returned by settle")}
          <div data-live-region="trustreceipts">{receiptsCell()}</div>
          {cell("4 attestation bundles", "in the repo, verify offline")}
        </div>
      </div>
    </section>
  );
}

/* ---------- reputation gate (guided demo) ---------- */
export function Gate() {
  return (
    <div className="step" id="guided-gate">
      <div className="rail">
        <div className="node gate">4</div>
        <div className="line"></div>
      </div>
      <div className="panel p-6">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h3 className="text-lg">Reputation gate, the moment it says no</h3>
          <Badge value="BLOCK" extra="code_change_recency" />
        </div>
        <p className="dim text-sm leading-relaxed mb-4">
          Before any settle, the counterparty is scored on five signals by the off-chain console gate. Here the gate refuses to submit a
          settle with a counterparty whose contract code changed within the last 24 hours and which has no interaction history. A reputation
          refusal is not a vault refusal: the vault never sees the attempt, and settle never consults reputation. The refusal{" "}
          <b className="text-ink">names the signal and its source</b>. Signals show as unavailable when they cannot be sourced: the
          blocklist is unavailable unless a URL is configured, and account age needs snapshots. ALLOW needs at least one prior receipt, and
          no contract or a first observation is neutral, not a penalty.
        </p>
        <pre className="codeblock dimc">
          {`gate.evaluate(counterparty)\n  signal : code_change_recency\n  source : on-chain code hash vs latest snapshot\n  seen   : code changed 6h ago \u00b7 no prior vault interactions\n  rule   : no change or > 7 days \u2192 ALLOW\n           change < 24h, or change with no history \u2192 BLOCK\n           otherwise \u2192 WARN (escalates unless CYNEX_APPROVE_WARN=1)\n  verdict: `}
          <span style={{ color: "var(--neg-text)" }}>BLOCK</span>
        </pre>
        <div className="mono text-xs dim2 mt-3">
          all five signals: account_existence · account_age · prior_vault_interactions · blocklist · code_change_recency,{" "}
          <a href="#/docs/reputation">docs</a>
        </div>
      </div>
    </div>
  );
}

export { AGENT, CP };
