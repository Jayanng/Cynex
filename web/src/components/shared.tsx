/* Cynex web, shared page fragments.
   Ported from the showcase: refusal panel, trust row, verify section,
   reputation gate, footer, and the live counts line. */

import { AGENT, CP, EX_TX, REPO } from "../lib/data";
import { useLive } from "../lib/live";
import { Icon, Badge, CmdBlock, HashChip, Unavail, LoadTxt } from "./ui";

/* ---------- footer ---------- */
export function Footer() {
  return (
    <footer className="mt-20 border-t" style={{ borderColor: "var(--line2)" }}>
      <div className="wrap py-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="mono text-[11px] dim2 leading-relaxed">CYNEX · NEAR testnet, no mainnet funds</div>
        <div className="flex items-center gap-4">
          <a className="mono text-[12px] inline-flex items-center gap-2" href={REPO} target="_blank" rel="noopener">
            github.com/Jayanng/Cynex{" "}
            <span style={{ width: 12, height: 12, display: "inline-grid", placeItems: "center" }}>
              <Icon name="ext" size={12} />
            </span>
          </a>
        </div>
      </div>
    </footer>
  );
}

/* ---------- live counts line (used on landing verify + proof) ---------- */
export function CountsLine() {
  const { live: L } = useLive();
  const f = L.recTest;
  if (f.err) return <Unavail />;
  if (!f.rows) return <LoadTxt />;
  const ok = f.link?.allOk;
  return (
    <span className="inline-flex items-center gap-2">
      <span style={{ color: "var(--green)", width: 15, height: 15, display: "inline-grid", placeItems: "center" }}>
        <Icon name={ok ? "check" : "warn"} size={15} />
      </span>
      <span className="mono text-[13px]">
        test vault: <b className="text-white">{f.rows.length}</b> receipts · in-browser check: index contiguity only ·{" "}
        <b className={ok ? "text-emerald-300" : "text-amber-300"}>{ok ? "all ok" : "check failed"}</b> · canonical hash recompute: verify-live
      </span>
    </span>
  );
}

/* ---------- refusal panel (first screen, real on-chain refusal) ---------- */
export function RefusalPanel() {
  return (
    <section className="wrap pt-8">
      <div
        className="panel p-6 md:p-7 fadein"
        style={{ borderColor: "rgba(248,113,113,.45)", background: "rgba(248,113,113,.05)" }}
      >
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="kicker" style={{ color: "var(--red)" }}>
            Live refusal, already on chain
          </span>
          <Badge value="REFUSED" extra="ERR_RECIPIENT_SUBSTITUTION" />
        </div>
        <p className="text-[17px] md:text-[19px] leading-snug text-white max-w-3xl">
          The submitted settle tried to pay a different recipient instead of the authorized recipient. The vault refused.
        </p>
        <p className="dim text-[13.5px] mt-2 max-w-3xl">
          Obligation <span className="mono text-[12.5px] text-white">p10-demo-attack-001</span> · 100 base units (0.0001 USDC) · nonce 1002 ·
          the terms are fixed on chain, so the injected instruction was worthless. In the executed tx the proposed recipient was the owner
          account, cynexmaster.testnet. <b className="text-white">0 tokens moved.</b>
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <span className="mono text-[11px] dim2 uppercase tracking-widest">refusal tx</span>
          <HashChip hash="AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S" />
          <a className="btn btn-primary sm" href={EX_TX("AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S")} target="_blank" rel="noopener">
            Read it from the chain
          </a>
        </div>
        <div className="mono text-[11px] dim2 mt-3">
          Historical fact, executed on the test vault, not a simulation. The chain read is live; the refusal itself already happened.
        </div>
      </div>
    </section>
  );
}

/* ---------- trust row (landing) ---------- */
export function TrustRow() {
  const { live: L } = useLive();
  const cell = (big: React.ReactNode, sub: string) => (
    <div className="panel p-4">
      <div className="text-2xl font-bold text-white">{big}</div>
      <div className="dim text-[12px] mt-1">{sub}</div>
    </div>
  );
  const receiptsCell = () => {
    const f = L.recTest;
    if (f.err) return <Unavail />;
    if (f.v == null) return <LoadTxt />;
    return (
      <>
        <span className="text-2xl font-bold text-white">{f.v}</span>
        <span className="dim text-[12px] block mt-1">receipts on chain, test vault · live</span>
      </>
    );
  };
  return (
    <section className="wrap mt-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cell("369 tests passing", "19 suites passed, 1 skipped · 369 tests passed, 1 skipped, 370 total · Jest")}
        {cell("Sol audit pass", "security audit")}
        <div className="panel p-4">
          <div data-live-region="trustreceipts">{receiptsCell()}</div>
        </div>
        {cell("4 TEE attestations verified", "attestation bundles in the repo")}
      </div>
    </section>
  );
}

/* ---------- one verify command on the landing page ---------- */
export function VerifyLanding() {
  return (
    <section className="wrap mt-14">
      <div className="panel p-6 md:p-7" style={{ borderColor: "rgba(52,211,153,.3)" }}>
        <div className="kicker mb-2">Verify in 10 seconds</div>
        <h2 className="text-xl md:text-2xl mb-2">One command replays the whole chain</h2>
        <p className="dim text-[13.5px] mb-4">
          Read-only. The CLI replays every receipt from genesis over the test vault and recomputes each hash link. The in-browser table on the
          Proof page checks index contiguity only; only the CLI recomputes the hash links.
        </p>
        <CmdBlock cmdKey="verify" />
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <span className="mono text-[11px] dim2 uppercase tracking-widest">expected output</span>
          <span>every row verified_ok = true · </span>
          <span data-live-region="counts">
            <CountsLine />
          </span>
        </div>
        <div className="mt-3">
          <a className="mono text-[12px] inline-flex items-center gap-2" style={{ color: "var(--green)" }} href="#/proof">
            full proof page{" "}
            <span style={{ width: 12, height: 12, display: "inline-grid", placeItems: "center" }}>
              <Icon name="arrow" size={12} />
            </span>
          </a>
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
        <div className="node gate">04</div>
        <div className="line"></div>
      </div>
      <div className="panel p-6 md:p-7">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h3 className="text-lg">Reputation gate, the moment it says no</h3>
          <Badge value="BLOCK" extra="code_change_recency" />
        </div>
        <p className="dim text-[14px] leading-relaxed mb-4">
          Before any settle, the counterparty is scored on five signals by the off-chain console gate. Here the gate refuses to submit a
          settle with a counterparty whose contract code changed within the last 24 hours and which has no interaction history. A reputation
          refusal is not a vault refusal: the vault never sees the attempt, and settle never consults reputation. The refusal{" "}
          <b className="text-white">names the signal and its source</b>. Signals show as unavailable when they cannot be sourced: the
          blocklist is unavailable unless a URL is configured, and account age needs snapshots. ALLOW needs at least one prior receipt, and
          no contract or a first observation is neutral, not a penalty.
        </p>
        <pre className="codeblock dimc">
          {`gate.evaluate(counterparty)
  signal : code_change_recency
  source : on-chain code hash vs latest snapshot
  seen   : code changed 6h ago · no prior vault interactions
  rule   : no change or > 7 days → ALLOW
           change < 24h, or change with no history → BLOCK
           otherwise → WARN (escalates unless CYNEX_APPROVE_WARN=1)
  verdict: `}
          <span style={{ color: "#fca5a5" }}>BLOCK</span>
        </pre>
        <div className="mono text-[11px] dim2 mt-3">
          all five signals: account_existence · account_age · prior_vault_interactions · blocklist · code_change_recency,{" "}
          <a href="#/docs/reputation">docs</a>
        </div>
      </div>
    </div>
  );
}

export { AGENT, CP };
