/* Cynex web, Demo page (guided walkthrough only).
   Five steps telling one story, the attack on p10-demo-attack-001.
   Every action already happened on the test vault, each prints its real
   tx hash, explorer-linked, with a live chain read after it. No login,
   no wallet, no obligation creation. */

import { useEffect } from "react";
import { GUIDED, VAULT_TEST } from "../lib/data";
import { useChainRead } from "../lib/useChainRead";
import { useLive } from "../lib/live";
import { StripSection } from "../components/Strip";
import { Badge, ChainReadOut, CmdBlock, CopyButton, HashChip, Icon, TermsGrid } from "../components/ui";
import { Footer, CountsLine } from "../components/shared";
import { LiveDemoButton } from "../components/LiveDemoButton";

/* ---------- guided ---------- */
function Guided({ anchor }: { anchor?: string }) {
  const { states, run } = useChainRead();
  useEffect(() => {
    if (anchor) {
      const t = setTimeout(() => {
        const el = document.getElementById("guided-" + anchor);
        if (el) {
          /* Margin first: scrollIntoView reads it at scroll time. */
          el.style.scrollMarginTop = "90px";
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 80);
      return () => clearTimeout(t);
    }
  }, [anchor]);

  return (
    <section className="wrap mt-12 space-y-8">
      {GUIDED.map((s) => (
        <div className="step" id={"guided-" + s.anchor} key={s.anchor}>
          <div className="rail">
            <div className={"node " + s.cls}>{s.n}</div>
            <div className="line"></div>
          </div>
          <div className="panel p-6">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h3 className="text-lg md:text-xl">{s.title}</h3>
              <span className="hashchip" title="obligation id">
                <span>{s.ob}</span>
                <CopyButton text={s.ob} />
              </span>
            </div>
            <p className="dim text-sm leading-relaxed mb-5 max-w-3xl">{s.desc}</p>
            {s.mono ? <p className="mono text-[13px] mb-5">{s.mono}</p> : null}
            {s.terms && s.terms.length ? (
              <div className="terms-grid mb-5">
                <TermsGrid terms={s.terms} />
              </div>
            ) : null}
            {s.kv && s.kv.length ? (
              <div className="mono text-[13px] space-y-1.5 mb-5 max-w-2xl">
                {s.kv.map(([k, v]) => (
                  <div className="flex flex-wrap justify-between gap-4" key={k}>
                    <span className="dim2">{k}</span>
                    {k === "Tx" ? <HashChip hash={v} /> : <span className="text-right">{v}</span>}
                  </div>
                ))}
              </div>
            ) : null}
            {s.attempts && s.attempts.length ? (
              <div className="space-y-2.5 mb-5">
                {s.attempts.map((a) => (
                  <div className="attempt" key={a.label}>
                    <span className="att-label">{a.label}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge value={a.verdict} extra={a.code ?? null} />
                    </span>
                    <span className="badge b-dim">
                      <span className="bdot"></span>Historical
                    </span>
                    <HashChip hash={a.tx} />
                    {a.note ? <span className="mono text-xs dim2">{a.note}</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {s.cmd === "verify" ? (
              <>
                <div className="space-y-2 mb-4">
                  <CmdBlock cmdKey="verify" />
                  <CmdBlock cmdKey="verifyCsv" />
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <span data-live-region="counts">
                    <CountsLine />
                  </span>
                  <a className="mono text-xs inline-flex items-center gap-2" style={{ color: "var(--accent-text)" }} href="#/proof">
                    full proof page{" "}
                    <span style={{ width: 16, height: 16, display: "inline-grid", placeItems: "center" }}>
                      <Icon name="arrow" />
                    </span>
                  </a>
                </div>
              </>
            ) : null}
            {s.receipt != null ? (
              <>
                <div className="flex flex-wrap items-center gap-4">
                  {s.delta ? <span className="mono text-xs dim">{s.delta}</span> : null}
                  {s.delta ? <span className="dim2">·</span> : null}
                  <button className="btn sm" onClick={() => void run(s.receipt as number)}>
                    Read receipt #{s.receipt} from chain, now
                  </button>
                  <span className="badge b-dim">
                    <span className="bdot"></span>Live
                  </span>
                </div>
                <div id={"cr-" + s.receipt}>
                  <ChainReadOut state={states[s.receipt] ?? null} />
                </div>
              </>
            ) : null}
          </div>
        </div>
      ))}
      {/* The reputation gate moved to Break it, section 05, and stays in
          Docs, reputation signals. This keeps the old guided-gate anchor
          working for inbound links. */}
      <div className="step" id="guided-gate">
        <div className="rail">
          <div className="node gate">G</div>
        </div>
        <div className="panel p-6">
          <h3 className="text-lg mb-2">Reputation gate, the moment it says no</h3>
          <p className="dim text-sm leading-relaxed max-w-3xl">
            The gate check moved to{" "}
            <a href="#/attack" style={{ color: "var(--accent-text)" }}>
              Break it, section 05
            </a>
            , and stays in{" "}
            <a href="#/docs/reputation" style={{ color: "var(--accent-text)" }}>
              Docs, reputation signals
            </a>
            . Five sourced signals check the counterparty before anything reaches the chain. A BLOCK refuses, a WARN escalates to a human.
            The vault still decides every settle.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------- page ---------- */
export function Demo({ anchor }: { anchor?: string }) {
  const { refreshLive } = useLive();
  useEffect(() => {
    void refreshLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <section className="wrap pt-12">
        <a
          href="#/"
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium mb-4"
          style={{ borderColor: "var(--line)", background: "var(--raised)", color: "var(--secondary)" }}
        >
          ← Home
        </a>
        <div>
          <div className="kicker mb-2">Demo · test vault</div>
          <h1 className="text-3xl md:text-4xl">Proof in motion</h1>
          <p className="dim text-sm mt-2 max-w-2xl">
            Five steps. One refusal. One real settle. Every action below already happened on{" "}
            <span className="mono text-[13px]">{VAULT_TEST}</span>, each prints its real tx hash, explorer-linked, with a live chain
            read after it. No login, no wallet, no obligation creation.
          </p>
        </div>
      </section>
      <StripSection />
      <Guided anchor={anchor} />
      <section className="wrap mt-10">
        <p className="dim text-sm max-w-3xl">
          All steps are live data from the NEAR testnet. Read receipt 12 from the chain now, with the same command as step 4.
        </p>
        <div className="flex flex-wrap gap-3 mt-5 items-start">
          <LiveDemoButton variant="hero" />
          <a className="btn ghost" href="#/proof">
            See the proof
          </a>
        </div>
      </section>
      <section className="wrap mt-10">
        <div className="panel p-6">
          <div className="kicker mb-3">Next</div>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <a className="mono text-sm inline-flex items-center gap-2" style={{ color: "var(--accent-text)" }} href="#/attack">
              Try to break it yourself →
            </a>
            <a className="mono text-sm inline-flex items-center gap-2" style={{ color: "var(--accent-text)" }} href="#/docs">
              Read how it works →
            </a>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
