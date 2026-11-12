/* Cynex web, Attack page.
   Try to break the vault: the attack panel first, then the six-ways
   attack runner, then the playground and sandbox. Read / explore only:
   every settle call here is an attack the vault refuses. */

import { useEffect, useRef, useState } from "react";
import { AGENT, ATTACKS, PLAYGROUND_INITIAL, PLAYGROUND_SOURCE_INITIAL, TOKEN, VAULT_TEST, type PlaygroundRow } from "../lib/data";
import { useChainRead } from "../lib/useChainRead";
import { StripSection } from "../components/Strip";
import { Badge, ChainReadOut, HashChip, TermsGrid } from "../components/ui";
import { Footer } from "../components/shared";
import { CMark } from "../components/Logo";
import { BreakIt } from "../components/BreakIt";
import { TamperPanel } from "../components/TamperPanel";

/* ---------- attack runner ---------- */
function AttackRunner() {
  const [atkOut, setAtkOut] = useState<Record<number, { kind: "loading" | "done"; }>>({});
  const [atkBusy, setAtkBusy] = useState<Record<number, boolean>>({});
  const atkTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    const timers = atkTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  const runAttack = (i: number) => {
    setAtkBusy((prev) => ({ ...prev, [i]: true }));
    setAtkOut((prev) => ({ ...prev, [i]: { kind: "loading" } }));
    const t = setTimeout(() => {
      setAtkOut((prev) => ({ ...prev, [i]: { kind: "done" } }));
      setAtkBusy((prev) => ({ ...prev, [i]: false }));
      atkTimers.current.delete(t);
    }, 650);
    atkTimers.current.add(t);
  };

  return (
    <>
      {/* attack runner */}
      <div className="mb-4">
        <div className="kicker mb-2">
          Attack runner
        </div>
        <h2 className="text-xl">Six ways in. Six refusals.</h2>
        <p className="dim text-sm mt-2 max-w-3xl">
          demo/attack-scenarios.json. Scenarios 1–3 were executed on the test vault, the refusal tx is linked. Scenarios 4–6 show the verdict the on-chain terms require and the reason code.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-10">
          {ATTACKS.map((a, i) => (
            <div
              key={a.name}
              className="panel p-5 flex flex-col justify-between gap-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-[15px]">{a.name}</h3>
                <span className="mono text-xs dim2">atk-{i + 1}</span>
                <span className="mono text-xs dim2">attempt: {a.attempt}</span>
              </div>
              <p className="dim text-[13px] leading-relaxed max-w-3xl">{a.vector}</p>
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn sm" onClick={() => runAttack(i)} disabled={!!atkBusy[i]}>
                  Run evaluation
                </button>
                <div id={"atk-" + i}>
                  {atkOut[i]?.kind === "loading" ? (
                    <div className="logline diml">
                      <span className="spin g"></span>showing the recorded verdict…
                    </div>
                  ) : atkOut[i]?.kind === "done" ? (
                    <span className="fadein inline-flex flex-wrap items-center gap-3">
                      <span className="logline bad">
                        <Badge value="REFUSED" extra={a.code} />
                      </span>
                      {a.tx ? (
                        <>
                          <span className="mono text-xs dim2">executed on test vault</span>
                          <HashChip hash={a.tx} />
                        </>
                      ) : (
                        <span className="mono text-xs dim2">expected on-chain verdict, scenario fixture</span>
                      )}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
      </div>
    </>
  );
}

/* ---------- playground and sandbox ---------- */
function pgBadge(expect: string) {
  if (expect === "PAID") return <Badge value="PAID" />;
  if (expect === "ALLOW") return <Badge value="ALLOW" />;
  if (expect === "BLOCK") return <Badge value="BLOCK" extra="code_change_recency" />;
  if (expect === "WARN") return <Badge value="WARN" />;
  if (expect === "READY" || expect === "CANCELLED") return <Badge value={expect} />;
  return <Badge value="REFUSED" extra={expect} />;
}

function Playground() {
  const { states, run } = useChainRead();
  const [playground, setPlayground] = useState<PlaygroundRow[]>(PLAYGROUND_INITIAL);
  const [playgroundSource, setPlaygroundSource] = useState(PLAYGROUND_SOURCE_INITIAL);
  const [pgFilter, setPgFilter] = useState("all");
  const [pgSelected, setPgSelected] = useState<number | null>(null);
  /* Refresh the playground fixture from the repo when reachable. */
  useEffect(() => {
    let cancelled = false;
    let abortTimer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const ctl = new AbortController();
        abortTimer = setTimeout(() => ctl.abort(), 6000);
        const r = await fetch("https://raw.githubusercontent.com/Jayanng/Cynex/master/demo/playground-obligations.json", {
          signal: ctl.signal,
        });
        if (!r.ok || cancelled) return;
        const j = await r.json();
        if (cancelled) return;
        /* The file has top-level vaults, not obligations: j.vaults[].obligations[],
           each row carrying obligation_id, amount, evidence_type, role, note,
           settleable. It has no nonce, expect, tx, receipt, or recipient field,
           so the expected outcome is derived from the role and the note text,
           while the recipient comes from the bundled snapshot's explicit
           recipient field, keyed by obligation id: the note does not always
           name the recipient (p6-prod-004 never mentions acme, but is an
           acme obligation in the snapshot). */
        const ROLE_EXPECT: Record<string, string> = {
          "recipient substitution": "ERR_RECIPIENT_SUBSTITUTION",
          "terms mismatch": "ERR_TERMS_MISMATCH",
          "budget exceeded": "ERR_BUDGET_EXCEEDED",
          "expired-only": "ERR_OBLIGATION_EXPIRED",
          expired: "ERR_OBLIGATION_EXPIRED",
          "spare READY": "READY",
          "nonce replay": "ERR_NONCE_ALREADY_CONSUMED",
          "happy path (live demo, read-only)": "PAID",
          "attack, three tries (live demo, read-only)": "PAID",
          "TEE and VRF (live demo, read-only)": "PAID",
        };
        const vaults: { vaultId?: string; obligations?: Record<string, unknown>[] }[] = Array.isArray(j?.vaults) ? j.vaults : [];
        type PgFileRow = Record<string, unknown> & { vaultId?: string };
        const arr: PgFileRow[] = vaults.flatMap((v) =>
          (v.obligations ?? []).map((o: Record<string, unknown>): PgFileRow => ({ ...o, vaultId: v.vaultId }))
        );
        if (arr.length === 18 && arr.every((o) => o && o.obligation_id)) {
          /* The three p10 demo rows carry their settle tx and receipt, which
             the file does not record; keep them from the bundled snapshot. */
          const knownTx: Record<string, { tx: string; receipt: number }> = {
            "p10-demo-preimage-001": { tx: "3Gp3J2zZCKrne1PamDVf6PgXHk4qGc3a58GBvoFcNhrZ", receipt: 11 },
            "p10-demo-attack-001": { tx: "Ho97UjQEDDfe7Go66uHrVSJvbF8narZJ2YBH3hWarxi", receipt: 12 },
            "p10-demo-tee-001": { tx: "3QV2aCRSiJ8ZYqLECCpK6ZkXpYE4AdxJzmyP3JTaDqWB", receipt: 13 },
          };
          setPlayground([
            ...arr.map((o) => {
              const note = String(o.note ?? "");
              const id = String(o.obligation_id);
              const expect = note.startsWith("CANCELLED")
                ? "CANCELLED"
                : id.startsWith("p10-demo")
                  ? "PAID"
                  : note.startsWith("PAID")
                    ? "ERR_NONCE_ALREADY_CONSUMED"
                    : ROLE_EXPECT[String(o.role ?? "")] ?? "READY"; /* Unmapped role: a pre-created obligation that has not settled yet. Never assume PAID. */
              return {
                id,
                ev: String(o.evidence_type ?? "PREIMAGE"),
                amount: String(o.amount ?? "-"),
                nonce: "-",
                expect,
                ro: o.settleable === false,
                tx: knownTx[id]?.tx ?? null,
                receipt: knownTx[id]?.receipt ?? null,
                note,
                vault: String(o.vaultId ?? ""),
                /* Recipient from the snapshot explicit recipient field, not the note.
                   An id with no snapshot match shows "recipient unknown", never a guessed recipient. */
                recipient: PLAYGROUND_INITIAL.find((s) => s.id === id)?.recipient ?? "recipient unknown",
                role: String(o.role ?? ""),
              };
            }),
            /* Keep the 13 bundled scenario fixtures alongside the 18 mapped file rows, so the header count stays true. */
            ...PLAYGROUND_INITIAL.filter((r) => r.fixture),
          ]);
          setPlaygroundSource("fetched live from repo master · demo/playground-obligations.json");
        }
      } catch {
        /* bundled snapshot stays, labeled */
      } finally {
        clearTimeout(abortTimer);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(abortTimer);
    };
  }, []);

  const pgRows = () => {
    return playground.map((r, i) => {
      const isErr = r.expect.indexOf("ERR_") === 0;
      const isRep = r.expect === "BLOCK" || r.expect === "WARN" || r.expect === "ALLOW";
      const paid = r.expect === "PAID";
      if (pgFilter === "paid" && !paid) return null;
      if (pgFilter === "refused" && !isErr) return null;
      if (pgFilter === "rep" && !isRep) return null;
      if (pgFilter === "p10" && !r.ro) return null;
      return (
        <tr className="clickable" data-row={i} key={r.id} onClick={() => setPgSelected(i)}>
          <td className="dim2">{i + 1}</td>
          <td style={{ color: "var(--txt)" }}>{r.id}</td>
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
              <span className="mono text-xs dim2">explorable</span>
            )}
          </td>
        </tr>
      );
    });
  };

  const pgDetail = (i: number) => {
    const r = playground[i];
    return (
      <div className="p-6 fadein">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="mono text-[15px] text-ink">{r.id}</span>
          {pgBadge(r.expect)}
          {r.ro ? (
            <span className="badge b-dim">
              <span className="bdot"></span>read-only · owner-created
            </span>
          ) : null}
        </div>
        <div className="mb-4">
          <TermsGrid
            terms={[
              ["recipient", r.recipient ?? AGENT],
              ["token", TOKEN],
              ["amount", r.amount + " base units"],
              ["nonce", String(r.nonce)],
              ["evidence", r.ev],
              ["vault", r.vault ?? VAULT_TEST],
              ["role", r.role ?? ""],
              ["source", r.fixture ? "scenario fixture, not a file obligation" : "demo/playground-obligations.json"],
            ]}
          />
        </div>
        {r.recipient === "acme-supplies.testnet" ? (
          <p className="text-[13px] mb-3" style={{ color: "var(--warn-text)" }}>
            Warning: acme-supplies.testnet does not exist on chain. Its token balance exists only because ft_transfer credits the token contract map, so a settle naming it is not a payment to a real account.
          </p>
        ) : null}
        <p className="dim text-[13px] mb-3">{r.note}</p>
        {r.tx ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="mono text-xs dim2 ">settle tx</span>
              <HashChip hash={r.tx} />
              <span className="mono text-xs dim2">receipt #{r.receipt}</span>
              <button className="btn sm ghost" onClick={() => void run(Number(r.receipt))}>
                chain read
              </button>
            </div>
            <div id={"cr-" + r.receipt}>
              <ChainReadOut state={states[Number(r.receipt)] ?? null} />
            </div>
          </>
        ) : (
          <div className="mono text-xs dim2">
            no live settle from the browser, expected outcome shown against the on-chain terms.
            {r.receipt != null ? " Test receipt #" + r.receipt + "." : ""}
          </div>
        )}
      </div>
    );
  };



  return (
    <section className="wrap mt-10">
      <div className="callout mono text-xs mb-8">
        Read / explore only. Playground obligations are owner-created, this page cannot create obligations. Every settle call here is an
        attack the vault refuses. Fixture:{" "}
        {playgroundSource}.
      </div>

      {/* matrix */}
      <div className="panel mb-10">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b" style={{ borderColor: "var(--line2)" }}>
          <div>
            <h2 className="text-xl">Playground matrix, 18 file obligations + 13 scenario fixtures</h2>
            <div className="mono text-xs dim2 mt-1">
              demo/playground-obligations.json · the three demo rows are read-only (settleable: false) · pg-* rows are scenario fixtures,
              not file obligations · amounts are base units
            </div>
          </div>
          <select className="input" id="pgfilter" value={pgFilter} onChange={(e) => setPgFilter(e.target.value)}>
            <option value="all">all outcomes</option>
            <option value="paid">PAID</option>
            <option value="refused">REFUSED (ERR_*)</option>
            <option value="rep">reputation (BLOCK / WARN / ALLOW)</option>
            <option value="p10">demo (read-only)</option>
          </select>
        </div>
        <div className="overflow-auto max-h-[460px]">
          <table className="tbl">
            <thead className="sticky top-0 z-10">
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
            <div className="p-6 mono text-xs dim2">select a row for the full result card.</div>
          ) : (
            pgDetail(pgSelected)
          )}
        </div>
      </div>

      <TamperPanel id="sandbox" />
    </section>
  );
}

/* ---------- page ---------- */
export function Attack() {
  return (
    <>
      <section className="wrap pt-8 md:pt-10">
        <a
          href="#/"
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium mb-4"
          style={{ borderColor: "var(--line)", background: "var(--raised)", color: "var(--secondary)" }}
        >
          ← Home
        </a>
        <div className="band-ink relative overflow-hidden p-6 md:p-8">
          <span className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 hidden lg:block" aria-hidden="true">
            <CMark size={120} light />
          </span>
          <div className="relative">
            <div className="kicker mb-2">Attack &middot; test vault</div>
            <h1 className="text-3xl md:text-4xl">Try to break it</h1>
            <p className="dim text-sm mt-2 max-w-2xl">
              Every attack here is refused under the real on-chain terms. Every settle call here is an attack the vault refuses.
            </p>
          </div>
        </div>
      </section>
      <StripSection />
      <BreakIt />
      <section className="wrap mt-10">
        <AttackRunner />
      </section>
      <Playground />
      <section className="wrap mt-10">
        <div className="panel p-6">
          <div className="kicker mb-3">Next</div>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <a className="mono text-sm inline-flex items-center gap-2" style={{ color: "var(--accent-text)" }} href="#/docs">
              Read how it works →
            </a>
            <a className="mono text-sm inline-flex items-center gap-2" style={{ color: "var(--accent-text)" }} href="#/proof">
              Verify the chain yourself →
            </a>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
