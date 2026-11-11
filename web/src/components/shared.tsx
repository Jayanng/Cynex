/* Cynex web, shared page fragments.
   Ported from the showcase: refusal panel, trust row, verify section,
   reputation gate, footer, and the live counts line. */

import { AGENT, CP, EX_TX, REPO } from "../lib/data";
import { useLive } from "../lib/live";
import { Icon, Badge, HashChip, Unavail, LoadTxt } from "./ui";
import { Logo } from "./Logo";

/* ---------- footer ---------- */
export function Footer() {
  return (
    <footer className="mt-24 border-t" style={{ borderColor: "var(--line2)" }}>
      <div className="wrap py-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
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
        <nav className="flex flex-wrap gap-x-6 gap-y-2 mono text-xs pt-6 mt-6 border-t" style={{ borderColor: "var(--line2)" }} aria-label="Site">
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

/* ---------- refusal panel (first screen, real on-chain refusal) ---------- */
export function RefusalPanel() {
  return (
    <section className="wrap pt-12">
      <div className="panel p-6 fadein">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="kicker">
            Live refusal, already on chain
          </span>
          <Badge value="REFUSED" extra="ERR_RECIPIENT_SUBSTITUTION" />
        </div>
        <p className="text-lg md:text-xl leading-snug text-ink max-w-3xl">
          The submitted settle tried to pay a different recipient instead of the authorized recipient. The vault refused.
        </p>
        <p className="dim text-sm mt-2 max-w-3xl">
          Obligation <span className="mono text-[13px] text-ink">p10-demo-attack-001</span> · 100 base units (0.0001 test USDC) · nonce 1002 ·
          the terms are fixed on chain, so the injected instruction was worthless. In the executed tx the proposed recipient was the owner
          account, cynexmaster.testnet. <b className="text-ink">0 tokens moved.</b>
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <span className="mono text-xs dim2">refusal tx</span>
          <HashChip hash="AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S" />
          <a className="btn btn-primary sm" href={EX_TX("AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S")} target="_blank" rel="noopener">
            Read it from the chain
          </a>
        </div>
        <div className="mono text-xs dim2 mt-3">
          Historical fact, executed on the test vault, not a simulation. The chain read is live; the refusal itself already happened.
        </div>
      </div>
    </section>
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {cell("393 tests passing", "20 suites passed, 1 failed, 1 skipped \u00b7 393 tests passed, 1 failed, 3 skipped, 397 total \u00b7 Jest")}
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
