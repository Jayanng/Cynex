/* Cynex web, Attack page.
   Try to break the vault: the attack panel first, then the tamper
   panel, the six-ways runner, the playground matrix, the reputation
   gate and budget, and verify. Read / explore only: every settle
   call here is an attack the vault refuses. */

import { useEffect, useState, type ReactNode } from "react";
import { AGENT, ATTACKS, PLAYGROUND_INITIAL, PLAYGROUND_SOURCE_INITIAL, TOKEN, VAULT_TEST, type PlaygroundRow } from "../lib/data";
import { useChainRead } from "../lib/useChainRead";
import { useLive } from "../lib/live";
import { StripSection } from "../components/Strip";
import { Badge, ChainReadOut, CmdBlock, HashChip, TermsGrid } from "../components/ui";
import { Footer } from "../components/shared";
import { CMark } from "../components/Logo";
import { BreakIt } from "../components/BreakIt";
import { policySpentPct } from "../lib/policyPct";
import { TamperPanel } from "../components/TamperPanel";

/* ---------- attack runner: six cards, verdict shown immediately ---------- */
function AttackRunner() {
  const [selected, setSelected] = useState(0);
  const a = ATTACKS[selected];
  return (
    <>
      <div className="mb-4">
        <div className="kicker mb-2">03&nbsp;&nbsp;Six ways in. Six refusals.</div>
        <h2 className="text-xl md:text-2xl">Pick an attack. The vault answers with a code.</h2>
        <p className="dim text-sm mt-2 max-w-3xl">
          Three of these ran on the test vault with a refusal transaction linked. Three show the verdict the on-chain terms require. No fake
          delay: the verdict appears immediately and is labelled as recorded. Scenarios 1 to 3 were executed on the test vault, scenarios 4
          to 6 show the verdict the on-chain terms require and the reason code.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {ATTACKS.map((sc, i) => (
          <button
            key={sc.name}
            type="button"
            className="panel panel-h p-5 text-left"
            style={i === selected ? { borderColor: "var(--accent)", boxShadow: "0 0 0 1px var(--accent)" } : undefined}
            onClick={() => setSelected(i)}
            aria-pressed={i === selected}
          >
            <div className="mono text-xs mb-2" style={{ color: "var(--neg-text)", fontWeight: 600 }}>
              {sc.code}
            </div>
            <h3 className="text-[15px] mb-1 text-ink">{sc.name}</h3>
            <p className="dim text-[13px] leading-relaxed">{sc.vector}</p>
            <div className="mono text-xs dim2 mt-3">{sc.tx ? "Tx linked" : "Verdict by terms, no tx"}</div>
          </button>
        ))}
      </div>
      <div className="panel p-6 mt-5 fadein" key={selected}>
        <div className="flex flex-wrap items-center gap-3">
          <Badge value="REFUSED" extra={a.code} />
          <span className="mono text-[13px] dim">{a.attempt}</span>
        </div>
        <p className="dim text-sm leading-relaxed mt-3 max-w-3xl">{a.vector}</p>
        {a.tx ? (
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <span className="mono text-xs dim2">refusal tx</span>
            <HashChip hash={a.tx} />
            <span className="mono text-xs text-ink">0 tokens moved</span>
          </div>
        ) : (
          <p className="mono text-[13px] mt-3" style={{ color: "var(--secondary)" }}>
            No transaction: the on-chain terms require this refusal, and the verdict is recorded, not executed.
          </p>
        )}
        <p className="mono text-xs dim2 mt-4 border-t pt-3" style={{ borderColor: "var(--line2)" }}>
          Recorded verdict, shown immediately. No fake delay.
        </p>
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
        <div className="terms-grid mb-4">
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
    <section className="wrap mt-10" id="attack-matrix">
      <div className="kicker mb-2">04&nbsp;&nbsp;The playground matrix</div>
      <h2 className="text-xl md:text-2xl mb-2">Every attack, one row, one code.</h2>
      <p className="dim text-sm max-w-3xl mb-8">
        The at-a-glance map. Each row is one way the payment can be tampered with, the code the vault returns, and the transaction where one exists.
      </p>
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
          <select className="input" id="pgfilter" aria-label="Filter playground rows" value={pgFilter} onChange={(e) => setPgFilter(e.target.value)}>
            <option value="all">all outcomes</option>
            <option value="paid">PAID</option>
            <option value="refused">REFUSED (ERR_*)</option>
            <option value="rep">reputation (BLOCK / WARN / ALLOW)</option>
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
            <div className="p-6 mono text-xs dim2">select a row for the full result card.</div>
          ) : (
            pgDetail(pgSelected)
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------- reputation gate and budget ---------- */
function GateBudget() {
  const { live: L } = useLive();
  const p = L.policy.v;
  let pct: number | null = null;
  let spent = "";
  let limit = "";
  if (p) {
    spent = String(p.spent);
    limit = String(p.limit);
    pct = policySpentPct(p.spent, p.limit);
  }
  const card = (no: string, t: string, body: ReactNode) => (
    <div className="panel p-5">
      <span className="mono text-xs" style={{ color: "var(--accent-text)" }}>
        {no}
      </span>
      <h3 className="text-lg mt-2 mb-1 text-ink">{t}</h3>
      <p className="dim text-sm leading-relaxed">{body}</p>
    </div>
  );
  return (
    <section className="wrap mt-10" id="attack-gate">
      <div className="kicker mb-2">05&nbsp;&nbsp;Reputation gate and budget</div>
      <h2 className="text-xl md:text-2xl mb-2">The vault never sees a BLOCKed attempt.</h2>
      <p className="dim text-sm max-w-3xl mb-6">
        Five sourced signals check the counterparty before anything reaches the chain. A BLOCK refuses, a WARN escalates to a human. The vault
        still decides every settle.{" "}
        <a href="#/docs/reputation" style={{ color: "var(--accent-text)" }}>
          The five signals, Docs
        </a>
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {card("BLOCK", "Known bad counterparty", "The gate refuses before a settle is even attempted. The vault never sees the attempt.")}
        {card("WARN", "Uncertain counterparty", "The attempt escalates to a human. The owner completes it from the console with an explicit approval.")}
        {card(
          "BUDGET",
          p ? `Policy spent ${spent} of ${limit}` : "Policy spent",
          p ? (
            <>
              {pct != null ? pct + "%" : ""} of the demo policy is spent. A settle that would cross the budget is refused, even with correct
              terms.
              {pct != null ? (
                <span className="statbar">
                  <i style={{ width: pct + "%" }}></i>
                </span>
              ) : null}
            </>
          ) : (
            "The demo policy spend is read live from the test vault."
          ),
        )}
      </div>
    </section>
  );
}

/* ---------- verify ---------- */
function AttackVerify() {
  const { live: L } = useLive();
  const count = L.recTest.v;
  return (
    <section className="wrap mt-10" id="attack-verify">
      <div className="kicker mb-2">06&nbsp;&nbsp;Verify</div>
      <h2 className="text-xl md:text-2xl mb-2">Check the record yourself.</h2>
      <p className="dim text-sm max-w-3xl mb-5">
        The page ends where the proof starts: one command replays every receipt from genesis and checks the hash links.
      </p>
      <CmdBlock cmdKey="verify" />
      <p className="mono text-xs dim2 mt-4">
        Expected: every row verified_ok = true, {count != null ? count : "all"} receipts on the test vault, all ok.
      </p>
    </section>
  );
}

/* ---------- page ---------- */
export function Attack() {
  const chip = (id: string, label: string) => (
    <button
      key={id}
      type="button"
      className="mono text-xs rounded-full border px-3 py-2"
      style={{ borderColor: "var(--line)", background: "var(--card)", color: "var(--secondary)" }}
      onClick={() => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    >
      {label}
    </button>
  );
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
        <div className="band-ink relative overflow-hidden p-6 md:p-8">
          <span className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 hidden lg:block" aria-hidden="true">
            <CMark size={120} light />
          </span>
          <div className="relative">
            <div className="kicker mb-2">Attack, test vault</div>
            <h1 className="text-3xl md:text-4xl">Attack the vault.</h1>
            <p className="dim text-sm mt-2 max-w-2xl">
              You are the compromised agent. Try to pay the wrong account, inflate the amount, replay a paid order, or drain the budget. The
              vault refuses. The refusals recorded on chain are linked below, and the verdicts the on-chain terms require are labelled as such.
            </p>
            <div className="flex flex-wrap gap-2 mt-5">
              {chip("attack-breakit", "BreakIt")}
              {chip("attack-tamper", "Check the chain")}
              {chip("attack-runner", "Six ways")}
              {chip("attack-matrix", "Matrix")}
              {chip("attack-gate", "Gate and budget")}
              {chip("attack-verify", "Verify")}
            </div>
          </div>
        </div>
      </section>
      <StripSection />
      <div id="attack-breakit">
        <BreakIt />
      </div>
      <section className="wrap mt-10" id="attack-tamper">
        <div className="kicker mb-2">02&nbsp;&nbsp;Check the chain yourself, in your browser</div>
        <h2 className="text-xl md:text-2xl mb-2">Check the chain yourself, in your browser.</h2>
        <p className="dim text-sm max-w-3xl mb-5">
          Each receipt hash links to the one before it. Edit the amount on receipt 2, recompute, and the link to receipt 3 breaks. The hashes
          are recomputed in your browser with real SHA-256, not prewritten.
        </p>
        <TamperPanel id="attack" />
      </section>
      <section className="wrap mt-10" id="attack-runner">
        <AttackRunner />
      </section>
      <Playground />
      <GateBudget />
      <AttackVerify />
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
