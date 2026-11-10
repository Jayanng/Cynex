/* Cynex web, Demo page (guided walkthrough only).
   Every action already happened on the test vault, each prints its real
   tx hash, explorer-linked, with a live chain read after it. No login,
   no wallet, no obligation creation. */

import { useEffect } from "react";
import { GUIDED, VAULT_TEST } from "../lib/data";
import { useChainRead } from "../lib/useChainRead";
import { useLive } from "../lib/live";
import { StripSection } from "../components/Strip";
import { Badge, ChainReadOut, CmdBlock, CopyButton, HashChip, Icon, ReadOnlyBadge, TermsGrid } from "../components/ui";
import { Gate, Footer, CountsLine } from "../components/shared";

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
            <div className="terms-grid mb-5">
              <TermsGrid terms={s.terms} />
            </div>
            <div className="space-y-2.5 mb-5">
              {s.attempts.map((a) => (
                <div className="attempt" key={a.label}>
                  <span className="att-label">{a.label}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge value={a.verdict} extra={a.code ?? null} />
                  </span>
                  <HashChip hash={a.tx} />
                  {a.note ? <span className="mono text-xs dim2">{a.note}</span> : null}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <span className="mono text-xs dim">{s.delta}</span>
              <span className="dim2">·</span>
              <button className="btn sm" onClick={() => void run(s.receipt)}>
                Read receipt #{s.receipt} from chain, now
              </button>
            </div>
            <div id={"cr-" + s.receipt}>
              <ChainReadOut state={states[s.receipt] ?? null} />
            </div>
          </div>
        </div>
      ))}
      <Gate />
      {/* step 5, verification (step 4 is the reputation gate) */}
      <div className="step" id="guided-step5">
        <div className="rail">
          <div className="node">5</div>
        </div>
        <div className="panel p-6">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h3 className="text-lg md:text-xl">Verification, replay the whole chain</h3>
            <ReadOnlyBadge />
          </div>
          <p className="dim text-sm leading-relaxed mb-4 max-w-3xl">
            <span className="mono text-[13px]" style={{ color: "var(--accent-text)" }}>
              node frontend/dist-test/cli/cynex.js verify-live cynex-testvault.cynexmaster.testnet
            </span>{" "}
            paginates <span className="mono text-[13px]">receipts(start, limit)</span> from genesis over the test vault, recomputes every
            hash link, and detects gaps and mismatches. Expected: every row{" "}
            <span className="mono text-[13px]">verified_ok = true</span>.
          </p>
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
            Every action below already happened on{" "}
            <span className="mono text-[13px]">{VAULT_TEST}</span>, each prints its real tx hash, explorer-linked, with a live chain
            read after it. No login, no wallet, no obligation creation.
          </p>
        </div>
      </section>
      <StripSection />
      <Guided anchor={anchor} />
      <Footer />
    </>
  );
}
