/* Home. Cynex's real identity: warm cream editorial, the mark, the tagline,
   and a settlement receipt read live from the vault. No mockup, no dashboard.
   Every claim below is operable or cited. */

import { useEffect, useState } from "react";
import { Link } from "../lib/nav";
import { useLive } from "../lib/live";
import { RECORD, event } from "../lib/record";
import { explorerTx } from "../lib/format";
import { ENFORCEMENT, MCP_TOOLS, REP_SIGNALS, ATTACKS, ERROR_CODE_TOTAL } from "../lib/features";
import { Chip, CommandBlock, GradeBadge, Panel, Stat, Verdict } from "../components/ui";
import { LiveReceipt } from "../components/LiveReceipt";
import { CMark } from "../components/brand";

const refusal = event("refuse-recipient");

const LAYERS = [
  { no: "01", name: "On-chain integrity", body: "For evidence up to 64 KiB the contract hashes the artifact bytes itself and compares them to the digest committed at authorization. A lying courier is caught by the contract, not a service." },
  { no: "02", name: "TEE provenance", body: "A guest program fetches the evidence from its claimed source inside an attested Intel TDX enclave and hashes it there. The quote binds what ran, what went in, and what came out." },
  { no: "03", name: "VRF anchor", body: "The guest requests VRF randomness during execution and the vault verifies the signature on chain, bound to the pending request. No proof gets reattached to a different order." },
];

export function HomePage() {
  const live = useLive();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <section className="hero">
        <div className="wrap">
          <div className="hero-grid">
            <div>
              <span className="eyebrow">
                <CMark size={16} />
                purpose-bound settlement vault · NEAR testnet
              </span>
              <h1 className="hero-title">
                Pay the obligation.
                <br />
                <em>Not the prompt.</em>
              </h1>
              <p className="hero-sub">
                An AI agent holds the wallet. A human fixes the terms. Cynex settles on chain and refuses
                everything else, <strong>even when the agent is compromised</strong>.
              </p>
              <div className="hero-cta">
                <Link to="/console" className="btn btn-primary btn-lg">
                  Open the live console
                </Link>
                <Link to="/tools" className="btn btn-ghost btn-lg">
                  Drive the MCP tools
                </Link>
              </div>
              <div className="hero-proof">
                <span>
                  <b>{ERROR_CODE_TOTAL}</b> error codes
                </span>
                <span>
                  <b>{MCP_TOOLS.length}</b> agent tools
                </span>
                <span>
                  <b>{REP_SIGNALS.length}</b> reputation signals
                </span>
                <span>
                  <b>3</b> evidence layers
                </span>
              </div>
            </div>

            {/* the hero artifact: a receipt read live from the vault */}
            <div className={mounted ? "reveal in" : "reveal"}>
              <LiveReceipt />
            </div>
          </div>
        </div>
      </section>

      {/* the threat */}
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <p className="kicker">the threat</p>
            <h2 className="section-title">A poisoned prompt should not be able to move money.</h2>
            <p className="section-lead">
              Agents hold wallets and sign payments now. One injected instruction can redirect a payment, inflate
              it, or collect it twice. Cynex moves the decision out of the model and onto the chain.
            </p>
          </div>
          <div className="grid grid-3">
            {ATTACKS.slice(0, 3).map((a) => (
              <Panel key={a.id} title={a.name} right={<span className="badge badge-neg">{a.expectedCode}</span>}>
                <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>{a.attack}</p>
              </Panel>
            ))}
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <Link to="/console" className="btn btn-ghost">Fire all four at the vault</Link>
          </div>
        </div>
      </section>

      {/* the verdict, cited */}
      <section className="section alt">
        <div className="wrap">
          <div className="section-head">
            <p className="kicker">the proof</p>
            <h2 className="section-title">This already happened. On chain. Not a story.</h2>
          </div>
          <div className="grid grid-2" style={{ alignItems: "center" }}>
            <div>
              <Verdict kind="REFUSED" code={refusal.errCode} />
              <p className="section-lead" style={{ marginTop: 20 }}>
                A prompt-injected agent tried to pay a different account. The vault read the order, checked the
                terms, and refused before a single token moved. Zero tokens moved.
              </p>
              <div className="row" style={{ gap: 10, marginTop: 18 }}>
                <GradeBadge g="historical" />
                <Chip value={refusal.tx} href={explorerTx(refusal.tx)} label="refusal tx" />
              </div>
            </div>
            <div>
              <CommandBlock
                label="replay the whole receipt chain from genesis"
                command={RECORD.commands.verifyTest}
                expected={`${RECORD.expectedReceipts.test} receipts · every hash link verified · no gaps`}
              />
            </div>
          </div>
        </div>
      </section>

      {/* three layers */}
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <p className="kicker">evidence, three layers that trust each other nothing</p>
            <h2 className="section-title">Anyone can claim a payment was legitimate. Cynex makes it checkable.</h2>
          </div>
          <div className="grid grid-3">
            {LAYERS.map((l) => (
              <div key={l.no} className="panel" style={{ padding: 24 }}>
                <div className="mono accent" style={{ fontSize: 12, letterSpacing: "0.08em" }}>LAYER {l.no}</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 21, fontWeight: 600, margin: "10px 0 12px", letterSpacing: "-0.015em" }}>{l.name}</div>
                <p className="muted" style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6 }}>{l.body}</p>
              </div>
            ))}
          </div>
          <div className="note" style={{ maxWidth: 760 }}>
            <strong>Read the fine print with us.</strong> The vault checks the guest-reported digest and source
            plus the VRF signature. The TDX quote itself is verified off-chain, through OutLayer's verifier. A
            security product that oversells is a security product that lied.
          </div>
        </div>
      </section>

      {/* live stats */}
      <section className="section alt">
        <div className="wrap">
          <div className="section-head">
            <p className="kicker">live on NEAR testnet</p>
            <h2 className="section-title">Sixteen checks before a single token moves.</h2>
            <p className="section-lead">These numbers are read from the vault in your browser while you read this.</p>
          </div>
          <div className="grid grid-4" style={{ marginBottom: 26 }}>
            <Stat value={ERROR_CODE_TOTAL} label="error codes defined" />
            <Stat value={ENFORCEMENT.length} label="enforcement checks" tone="var(--accent-text)" />
            <Stat value={live.receiptsTest.length || "…"} label="receipts on the test vault" tone="var(--pos-text)" />
            <Stat value={live.block ? `#${live.block}` : "…"} label="current block" />
          </div>
          <div className="row" style={{ gap: 12 }}>
            <Link to="/record" className="btn btn-ghost">See the full record</Link>
            <Link to="/tools" className="btn btn-ghost">Drive the six MCP tools</Link>
          </div>
        </div>
      </section>
    </>
  );
}
