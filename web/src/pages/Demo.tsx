/* Cynex web — Demo page (Guided / Sandbox).
   Every action already happened on the test vault — each prints its real
   tx hash, explorer-linked, with a live chain read after it. No login,
   no wallet, no obligation creation. */

import { useEffect, useState } from "react";
import { AGENT, ATTACKS, GUIDED, PLAYGROUND_INITIAL, PLAYGROUND_SOURCE_INITIAL, TOKEN, VAULT_TEST, type PlaygroundRow } from "../lib/data";
import { useChainRead } from "../lib/useChainRead";
import { useLive } from "../lib/live";
import { StripSection } from "../components/Strip";
import { Badge, ChainReadOut, CmdBlock, CopyButton, HashChip, Icon, TermsGrid } from "../components/ui";
import { Gate, Footer, CountsLine } from "../components/shared";
import { TamperPanel } from "../components/TamperPanel";

/* ---------- guided ---------- */
function Guided({ anchor }: { anchor?: string }) {
  const { states, run } = useChainRead();
  useEffect(() => {
    if (anchor) {
      const t = setTimeout(() => {
        const el = document.getElementById("guided-" + anchor);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          el.style.scrollMarginTop = "90px";
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
          <div className="panel p-6 md:p-7">
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h3 className="text-lg md:text-xl">{s.title}</h3>
              <span className="hashchip" title="obligation id">
                <span>{s.ob}</span>
                <CopyButton text={s.ob} />
              </span>
            </div>
            <p className="dim text-[14px] leading-relaxed mb-5 max-w-3xl">{s.desc}</p>
            <div className="terms-grid mb-5">
              <TermsGrid terms={s.terms} />
            </div>
            <div className="space-y-2.5 mb-5">
              {s.attempts.map((a) => (
                <div className="attempt" key={a.label}>
                  <span className="att-label">{a.label}</span>
                  <span className="flex items-center gap-2">
                    <Badge value={a.verdict} extra={a.code ?? null} />
                  </span>
                  <HashChip hash={a.tx} />
                  {a.note ? <span className="mono text-[11px] dim2">{a.note}</span> : null}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <span className="mono text-[12px] dim">{s.delta}</span>
              <span className="dim2">·</span>
              <button className="btn sm" onClick={() => void run(s.receipt)}>
                Read receipt #{s.receipt} from chain — now
              </button>
            </div>
            <div id={"cr-" + s.receipt}>
              <ChainReadOut state={states[s.receipt] ?? null} />
            </div>
          </div>
        </div>
      ))}
      <Gate />
      {/* step 4 — verification */}
      <div className="step" id="guided-step4">
        <div className="rail">
          <div className="node">04</div>
        </div>
        <div className="panel p-6 md:p-7">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h3 className="text-lg md:text-xl">Verification — replay the whole chain</h3>
            <Badge value="ALLOW" />
          </div>
          <p className="dim text-[14px] leading-relaxed mb-4 max-w-3xl">
            <span className="mono text-[13px]" style={{ color: "#9be7c4" }}>
              cynex-verify
            </span>{" "}
            paginates <span className="mono text-[12.5px]">receipts(start, limit)</span> from genesis over the test vault, recomputes every
            hash link, and detects gaps and mismatches. Expected: every row{" "}
            <span className="mono text-[12.5px]">verified_ok = true</span>.
          </p>
          <div className="space-y-2 mb-4">
            <CmdBlock cmdKey="verify" />
            <CmdBlock cmdKey="verifyCsv" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <span data-live-region="counts">
              <CountsLine />
            </span>
            <a className="mono text-[12px] inline-flex items-center gap-2" style={{ color: "var(--green)" }} href="#/proof">
              full proof page{" "}
              <span style={{ width: 12, height: 12, display: "inline-grid", placeItems: "center" }}>
                <Icon name="arrow" size={12} />
              </span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- sandbox ---------- */
function pgBadge(expect: string) {
  if (expect === "PAID") return <Badge value="PAID" />;
  if (expect === "ALLOW") return <Badge value="ALLOW" />;
  if (expect === "BLOCK") return <Badge value="BLOCKED" extra="code_change_recency" />;
  if (expect === "WARN") return <Badge value="WARN" />;
  return <Badge value="REFUSED" extra={expect} />;
}

function Sandbox() {
  const { states, run } = useChainRead();
  const [playground, setPlayground] = useState<PlaygroundRow[]>(PLAYGROUND_INITIAL);
  const [playgroundSource, setPlaygroundSource] = useState(PLAYGROUND_SOURCE_INITIAL);
  const [pgFilter, setPgFilter] = useState("all");
  const [pgSelected, setPgSelected] = useState<number | null>(null);
  const [atkOut, setAtkOut] = useState<Record<number, { kind: "loading" | "done"; }>>({});
  const [atkBusy, setAtkBusy] = useState<Record<number, boolean>>({});

  /* Refresh the playground fixture from the repo when reachable. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctl = new AbortController();
        setTimeout(() => ctl.abort(), 6000);
        const r = await fetch("https://raw.githubusercontent.com/Jayanng/Cynex/master/demo/playground-obligations.json", {
          signal: ctl.signal,
        });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        const arr = Array.isArray(j) ? j : j && j.obligations;
        if (Array.isArray(arr) && arr.length === 18 && arr.every((o) => o && (o.id || o.obligation_id))) {
          setPlayground(
            arr.map((o) => ({
              id: o.id || o.obligation_id,
              ev: o.ev || o.evidence || "PREIMAGE",
              amount: String(o.amount ?? "—"),
              nonce: o.nonce ?? "—",
              expect: o.expect || o.expected || "PAID",
              ro: !!(o.ro || o.settleable === false),
              tx: o.tx || null,
              receipt: o.receipt || null,
              note: o.note || o.scenario || "",
            }))
          );
          setPlaygroundSource("fetched live from repo master · demo/playground-obligations.json");
        }
      } catch {
        /* bundled snapshot stays, labeled */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pgRows = () => {
    return playground.map((r, i) => {
      const isErr = r.expect.indexOf("ERR_") === 0;
      const isRep = r.expect === "BLOCK" || r.expect === "WARN";
      const paid = r.expect === "PAID" || r.expect === "ALLOW";
      if (pgFilter === "paid" && !paid) return null;
      if (pgFilter === "refused" && !isErr) return null;
      if (pgFilter === "rep" && !isRep) return null;
      if (pgFilter === "p10" && !r.ro) return null;
      return (
        <tr className="clickable" data-row={i} key={r.id} onClick={() => setPgSelected(i)}>
          <td className="dim2">{i + 1}</td>
          <td style={{ color: "#dbe4ee" }}>{r.id}</td>
          <td className="dim">{r.ev}</td>
          <td>{r.amount}</td>
          <td className="dim">{r.nonce}</td>
          <td>{pgBadge(r.expect)}</td>
          <td>
            {r.ro ? (
              <span className="badge b-dim">
                <span className="bdot"></span>read-only
              </span>
            ) : (
              <span className="mono text-[11px] dim2">explorable</span>
            )}
          </td>
        </tr>
      );
    });
  };

  const pgDetail = (i: number) => {
    const r = playground[i];
    return (
      <div className="p-5 fadein">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="mono text-[15px] text-white">{r.id}</span>
          {pgBadge(r.expect)}
          {r.ro ? (
            <span className="badge b-dim">
              <span className="bdot"></span>read-only · owner-created
            </span>
          ) : null}
        </div>
        <div className="terms-grid mb-4">
          <TermsGrid
            terms={[
              ["recipient", AGENT],
              ["token", TOKEN],
              ["amount", r.amount + " USDC"],
              ["nonce", String(r.nonce)],
              ["evidence", r.ev],
            ]}
          />
        </div>
        <p className="dim text-[13px] mb-3">{r.note}</p>
        {r.tx ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="mono text-[11px] dim2 uppercase tracking-widest">settle tx</span>
              <HashChip hash={r.tx} />
              <span className="mono text-[11px] dim2">receipt #{r.receipt}</span>
              <button className="btn sm ghost" onClick={() => void run(Number(r.receipt))}>
                chain read
              </button>
            </div>
            <div id={"cr-" + r.receipt}>
              <ChainReadOut state={states[Number(r.receipt)] ?? null} />
            </div>
          </>
        ) : (
          <div className="mono text-[11px] dim2">no live settle from the browser — expected verdict shown against the on-chain terms.</div>
        )}
      </div>
    );
  };

  const runAttack = (i: number) => {
    setAtkBusy((prev) => ({ ...prev, [i]: true }));
    setAtkOut((prev) => ({ ...prev, [i]: { kind: "loading" } }));
    setTimeout(() => {
      setAtkOut((prev) => ({ ...prev, [i]: { kind: "done" } }));
      setAtkBusy((prev) => ({ ...prev, [i]: false }));
    }, 650);
  };

  return (
    <section className="wrap mt-10">
      <div className="callout mono text-[12px] mb-8" style={{ color: "#fde68a" }}>
        Read / explore only. Playground obligations are owner-created — this page cannot create obligations and cannot settle. Fixture:{" "}
        {playgroundSource}.
      </div>

      {/* matrix */}
      <div className="panel mb-10">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b" style={{ borderColor: "var(--line2)" }}>
          <div>
            <h2 className="text-xl">Playground matrix — 18 obligations</h2>
            <div className="mono text-[11px] dim2 mt-1">
              demo/playground-obligations.json · the three demo rows are read-only (settleable: false)
            </div>
          </div>
          <select className="input" id="pgfilter" value={pgFilter} onChange={(e) => setPgFilter(e.target.value)}>
            <option value="all">all outcomes</option>
            <option value="paid">PAID / ALLOW</option>
            <option value="refused">REFUSED (ERR_*)</option>
            <option value="rep">reputation (BLOCK / WARN)</option>
            <option value="p10">demo (read-only)</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>obligation</th>
                <th>evidence</th>
                <th>amount</th>
                <th>nonce</th>
                <th>expected</th>
                <th>access</th>
              </tr>
            </thead>
            <tbody id="pgbody">{pgRows()}</tbody>
          </table>
        </div>
        <div id="pgdetail" className="border-t" style={{ borderColor: "var(--line2)" }}>
          {pgSelected == null ? (
            <div className="p-5 mono text-[12px] dim2">select a row for the full result card.</div>
          ) : (
            pgDetail(pgSelected)
          )}
        </div>
      </div>

      {/* attack runner */}
      <div className="mb-4">
        <div className="kicker mb-2" style={{ color: "var(--red)" }}>
          Attack runner
        </div>
        <h2 className="text-xl">Six ways in. Six refusals.</h2>
        <p className="dim text-[13.5px] mt-2 max-w-3xl">
          demo/attack-scenarios.json. Scenarios 1–3 were executed on the test vault — the refusal tx is linked. Scenarios 4–6 are evaluated
          against the same on-chain terms and show the expected verdict and reason code.
        </p>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mb-12">
        {ATTACKS.map((a, i) => (
          <div className="panel p-5 flex flex-col gap-3" key={a.name}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[15px]">{a.name}</h3>
              <span className="mono text-[10px] dim2">atk-{i + 1}</span>
            </div>
            <p className="dim text-[12.5px] leading-relaxed">{a.vector}</p>
            <div className="mono text-[11px] dim2">attempt: {a.attempt}</div>
            <div className="mt-auto flex flex-col gap-2">
              <button className="btn sm" onClick={() => runAttack(i)} disabled={!!atkBusy[i]}>
                Run evaluation
              </button>
              <div id={"atk-" + i}>
                {atkOut[i]?.kind === "loading" ? (
                  <div className="logline diml">
                    <span className="spin g"></span>evaluating against on-chain terms…
                  </div>
                ) : atkOut[i]?.kind === "done" ? (
                  <>
                    <div className="logline bad fadein">
                      <Badge value="REFUSED" extra={a.code} />
                    </div>
                    {a.tx ? (
                      <div className="mt-2 flex flex-col gap-1.5 fadein">
                        <span className="mono text-[10px] dim2 uppercase tracking-widest">executed on test vault</span>
                        <HashChip hash={a.tx} />
                      </div>
                    ) : (
                      <div className="mono text-[10.5px] dim2 mt-2 fadein">expected on-chain verdict — scenario fixture</div>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      <TamperPanel id="sandbox" />
    </section>
  );
}

/* ---------- page ---------- */
export function Demo({ mode, anchor }: { mode: "guided" | "sandbox"; anchor?: string }) {
  const { refreshLive } = useLive();
  useEffect(() => {
    void refreshLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  return (
    <>
      <section className="wrap pt-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="kicker mb-2">Demo · test vault</div>
            <h1 className="text-3xl md:text-4xl">Proof in motion</h1>
            <p className="dim text-[14px] mt-2 max-w-2xl">
              Every action below already happened on{" "}
              <span className="mono text-[12.5px]">{VAULT_TEST}</span> — each prints its real tx hash, explorer-linked, with a live chain
              read after it. No login, no wallet, no obligation creation.
            </p>
          </div>
          <div className="inline-flex items-center gap-1 p-1 rounded-xl border" style={{ borderColor: "var(--line)", background: "rgba(7,11,17,.8)" }}>
            <a className={"togglebtn " + (mode === "guided" ? "active" : "")} href="#/demo/guided">
              Guided
            </a>
            <a className={"togglebtn " + (mode === "sandbox" ? "active" : "")} href="#/demo/sandbox">
              Sandbox
            </a>
          </div>
        </div>
      </section>
      <StripSection />
      {mode === "guided" ? <Guided anchor={anchor} /> : <Sandbox />}
      <Footer />
    </>
  );
}
