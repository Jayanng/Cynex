/* Home. A cinematic hook that hands off to the live console. The story is
   told in one breath, then every claim below is operable. */

import { useEffect, useState } from "react";
import { Link } from "../lib/nav";
import { useLive } from "../lib/live";
import { RECORD, event } from "../lib/record";
import { baseUnits, nsToUtc, explorerTx } from "../lib/format";
import { ENFORCEMENT, MCP_TOOLS, REP_SIGNALS, ATTACKS, ERROR_CODE_TOTAL, SETTLE_REACHABLE_CODES } from "../lib/features";
import { Chip, CommandBlock, GradeBadge, Panel, Stat, Verdict } from "../components/ui";

const refusal = event("refuse-recipient");

const LAYERS = [
  {
    no: "01",
    name: "On-chain integrity",
    body: "For evidence up to 64 KiB the contract hashes the artifact bytes itself and compares them to the digest committed at authorization. A lying courier is caught by the contract, not by a service.",
  },
  {
    no: "02",
    name: "TEE provenance",
    body: "A guest program fetches the evidence from its claimed source inside an attested Intel TDX enclave and hashes it there. The quote binds what ran, what went in, and what came out.",
  },
  {
    no: "03",
    name: "VRF anchor",
    body: "The guest requests VRF randomness during execution and the vault verifies the signature on chain, bound to the pending request. No proof gets reattached to a different order.",
  },
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
                <span className="tick" />
                purpose-bound settlement vault · NEAR testnet
              </span>
              <h1 className="hero-title">
                Someone told your agent
                <br />
                to pay the <span className="grad">wrong account.</span>
              </h1>
              <p className="hero-sub">
                The vault read the order, checked the evidence, and said <strong>no</strong>. Zero tokens moved.
                Cynex enforces what a human authorized, <strong>on chain</strong>, where a compromised agent
                cannot argue.
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

            {/* the hero visual: a live console card */}
            <div className={`panel scan ${mounted ? "reveal in" : "reveal"}`} style={{ padding: 0, overflow: "hidden" }}>
              <div className="panel-head" style={{ background: "var(--surface-2)" }}>
                <span className="dot live" />
                <span className="panel-title" style={{ fontSize: 14 }}>
                  live settle · session
                </span>
                <span style={{ marginLeft: "auto" }}>
                  <GradeBadge g="chain-read" />
                </span>
              </div>
              <div className="panel-body">
                <div className="mono muted" style={{ fontSize: 11.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  order {refusal.obligationId}
                </div>
                <div className="spread" style={{ margin: "16px 0 20px", alignItems: "flex-start" }}>
                  <Verdict kind="REFUSED" code={refusal.errCode} />
                  <div style={{ textAlign: "right" }}>
                    <div className="big-num" style={{ fontSize: 30, color: "var(--pos-ink)" }}>0</div>
                    <div className="stat-label">tokens moved</div>
                  </div>
                </div>

                <div className="stack" style={{ gap: 10 }}>
                  {[
                    { l: "block", v: live.block ? `#${live.block}` : "…" },
                    { l: "receipts", v: `${live.receiptsTest.length} test · ${live.receiptsProd.length} prod` },
                    { l: "code hash", v: live.codeHashTest ? `${short(live.codeHashTest)} ✓` : "…" },
                    { l: "policy spent", v: live.balance ? `${baseUnits(live.balance.spent)} / ${baseUnits(live.balance.limit)}` : "…" },
                  ].map((r) => (
                    <div key={r.l} className="spread" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
                      <span className="mono muted" style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {r.l}
                      </span>
                      <span className="mono" style={{ fontSize: 12.5 }}>{r.v}</span>
                    </div>
                  ))}
                </div>

                <div className="row" style={{ gap: 10, marginTop: 16 }}>
                  <Chip value={refusal.tx} href={explorerTx(refusal.tx)} label="refusal tx" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* the problem, in three refusals */}
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <p className="kicker">the threat</p>
            <h2 className="section-title">A poisoned prompt should not be able to move money.</h2>
            <p className="section-lead">
              AI agents hold wallets and sign payments now. One injected instruction can redirect a payment,
              inflate it, or collect it twice. Cynex moves the decision out of the model and onto the chain.
            </p>
          </div>
          <div className="grid grid-3">
            {ATTACKS.slice(0, 3).map((a) => (
              <Panel key={a.id} title={a.name} right={<span className="badge badge-neg">{a.expectedCode}</span>}>
                <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>{a.attack}</p>
              </Panel>
            ))}
          </div>
        </div>
      </section>

      {/* how it works: the three layers */}
      <section className="section" style={{ background: "var(--bg-2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
        <div className="wrap">
          <div className="section-head">
            <p className="kicker">evidence, three layers that trust each other nothing</p>
            <h2 className="section-title">Anyone can claim a payment was legitimate. Cynex makes it checkable.</h2>
          </div>
          <div className="grid grid-3">
            {LAYERS.map((l) => (
              <div key={l.no} className="panel" style={{ padding: 24 }}>
                <div className="mono accent" style={{ fontSize: 13, letterSpacing: "0.1em" }}>LAYER {l.no}</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 21, fontWeight: 600, margin: "10px 0 12px" }}>{l.name}</div>
                <p className="muted" style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6 }}>{l.body}</p>
              </div>
            ))}
          </div>
          <div className="note" style={{ maxWidth: 760 }}>
            <strong>Read the fine print with us.</strong> The vault checks the guest-reported digest and source
            plus the VRF signature. The TDX quote itself is verified off-chain, through OutLayer's verifier, and
            the VRF signature is an anchor, not proof of TEE execution. A security product that oversells is a
            security product that lied.
          </div>
        </div>
      </section>

      {/* live stats + enforcement */}
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <p className="kicker">enforcement</p>
            <h2 className="section-title">Sixteen checks before a single token moves.</h2>
            <p className="section-lead">
              Every settlement is validated against the order on chain. The agent is assumed compromised from
              the first line to the last. It can only ask.
            </p>
          </div>
          <div className="grid grid-4" style={{ marginBottom: 28 }}>
            <Stat value={ERROR_CODE_TOTAL} label="error codes defined" />
            <Stat value={SETTLE_REACHABLE_CODES} label="reachable through settle" />
            <Stat value={ENFORCEMENT.length} label="enforcement checks" tone="var(--accent-ink)" />
            <Stat value={live.receiptsTest.length || "…"} label="receipts on the test vault" tone="var(--pos-ink)" />
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>check</th>
                  <th>error code</th>
                  <th>what settle does</th>
                </tr>
              </thead>
              <tbody>
                {ENFORCEMENT.slice(0, 8).map((e) => (
                  <tr key={e.id}>
                    <td className="td-ink">{e.name}</td>
                    <td className="td-neg">{e.code}</td>
                    <td>{e.check}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <Link to="/record" className="btn btn-ghost">
              See all {ENFORCEMENT.length} checks and the receipt ledger
            </Link>
          </div>
        </div>
      </section>

      {/* verify CTA */}
      <section className="section" style={{ background: "var(--bg-2)", borderTop: "1px solid var(--line)" }}>
        <div className="wrap">
          <div className="section-head">
            <p className="kicker">do not take our word for it</p>
            <h2 className="section-title">Replay the whole receipt chain from genesis.</h2>
            <p className="section-lead">
              One command, no key, no wallet, no trust in this page. Every number here is fetched from NEAR RPC
              in your browser or it carries a grade saying what it is.
            </p>
          </div>
          <div className="grid grid-2">
            <div>
              <CommandBlock
                label="replay the receipt chain"
                command={RECORD.commands.verifyTest}
                expected={`${RECORD.expectedReceipts.test} receipts · every hash link verified · no gaps`}
              />
              <CommandBlock label="verify the TEE attestation yourself" command={RECORD.commands.verifyAttestation} expected="PASS" />
            </div>
            <div>
              <CommandBlock label="run the contract suite" command={RECORD.repoFacts.contractTests.command} expected={`${RECORD.repoFacts.contractTests.count} passed`} />
              <CommandBlock label="run the integration suite" command={RECORD.repoFacts.jest.command} expected={`${RECORD.repoFacts.jest.passed} passed, ${RECORD.repoFacts.jest.skipped} skipped`} />
            </div>
          </div>
          <div className="row" style={{ gap: 12, marginTop: 24 }}>
            <Link to="/console" className="btn btn-primary">Attack it yourself</Link>
            <Link to="/tools" className="btn btn-ghost">Drive the six MCP tools</Link>
          </div>
        </div>
      </section>
    </>
  );
}

function short(h: string) {
  return h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}
