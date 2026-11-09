/* Cynex web — tamper and detect panel.
   Local simulation on a working copy — no chain writes. The working
   copy's hashes are recomputed in the browser with the frozen formula;
   the canonical verifier is cynex-verify. The simulated attacker tampers
   with a receipt and recomputes its hash to cover their tracks — the
   chain still breaks one link later. */

import { useCallback, useEffect, useRef, useState } from "react";
import { AGENT, TOKEN } from "../lib/data";
import { useLive } from "../lib/live";
import { receiptHash, fmtToken, type Receipt } from "../lib/near";

interface WorkReceipt {
  index: number;
  prev_hash: number[] | string;
  obligation_id: string;
  recipient: string;
  amount: string;
  token_id: string;
  timestamp: string;
  tx_ref: string;
  hash: string;
}

interface LogLine {
  kind: "ok" | "bad" | "diml";
  text: string;
}

const randB58 = (n: number) => {
  const a = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
};

export function TamperPanel({ id }: { id: string }) {
  const { live } = useLive();
  const [chain, setChain] = useState<WorkReceipt[]>([]);
  const [base, setBase] = useState<WorkReceipt[]>([]);
  const [log, setLog] = useState<LogLine[]>([{ kind: "diml", text: "working copy loading…" }]);
  const [src, setSrc] = useState("source: …");
  const [picked, setPicked] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const builtFromLive = useRef(false);
  const rows = live.recTest.rows;

  const reset = useCallback((b: WorkReceipt[]) => {
    setChain(b.map((c) => ({ ...c })));
    setPicked(b.length ? Number(b[0].index) : 0);
    setLog([
      {
        kind: "diml",
        text: `working copy ready · ${b.length} receipts · hash = SHA-256(index ‖ prev_hash ‖ obligation_id ‖ recipient ‖ amount ‖ token_id ‖ timestamp ‖ tx_ref)`,
      },
    ]);
  }, []);

  const build = useCallback(async () => {
    setLog([{ kind: "diml", text: "building working copy…" }]);
    let next: WorkReceipt[] = [];
    if (rows && rows.length >= 3) {
      for (const r of rows.slice(0, 12)) {
        const c: WorkReceipt = {
          index: Number(r.index),
          prev_hash: r.prev_hash,
          obligation_id: r.obligation_id,
          recipient: r.recipient,
          amount: String(r.amount),
          token_id: r.token_id,
          timestamp: String(r.timestamp),
          tx_ref: r.tx_ref,
          hash: "",
        };
        c.hash = await receiptHash(c);
        next.push(c);
      }
      setSrc(`source: live receipts · cynex-testvault.cynexmaster.testnet (${next.length} rows, browser-recomputed hashes)`);
      builtFromLive.current = true;
    } else {
      let prev = "0".repeat(64);
      const seed: [string, string][] = [
        ["pg-alpha", "25"],
        ["pg-beta", "40"],
        ["pg-gamma", "60"],
        ["pg-delta", "15"],
        ["pg-epsilon", "80"],
        ["pg-zeta", "30"],
      ];
      for (let i = 0; i < seed.length; i++) {
        const c: WorkReceipt = {
          index: i,
          prev_hash: prev,
          obligation_id: seed[i][0],
          recipient: AGENT,
          amount: (BigInt(seed[i][1]) * 1000000n).toString(),
          token_id: TOKEN,
          timestamp: String(1762531200000000000 + i * 60000000000),
          tx_ref: randB58(44),
          hash: "",
        };
        c.hash = await receiptHash(c);
        prev = c.hash;
        next.push(c);
      }
      setSrc("source: SYNTHETIC — generated locally in your browser (live receipts unavailable). Not chain data.");
    }
    setBase(next);
    reset(next);
  }, [rows, reset]);

  useEffect(() => {
    void build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Rebuild from live receipts once they arrive, if the first build was synthetic. */
  useEffect(() => {
    if (!builtFromLive.current && rows && rows.length >= 3) void build();
  }, [rows, build]);

  const doTamper = async () => {
    if (busy) return;
    const r = chain.find((c) => Number(c.index) === picked);
    if (!r) return;
    setBusy(true);
    const before = fmtToken(String(BigInt(r.amount) - 1000000n));
    const updated: WorkReceipt = { ...r, amount: (BigInt(r.amount) + 1000000n).toString() };
    updated.hash = await receiptHash(updated); // attacker recomputes to cover tracks
    setChain((prev) => prev.map((c) => (Number(c.index) === picked ? updated : c)));
    setLog([
      { kind: "bad", text: `tampered receipt #${picked} — amount ${before} → ${fmtToken(updated.amount)} USDC · stored hash recomputed by the attacker` },
      { kind: "diml", text: "now run the verifier replay." },
    ]);
    setBusy(false);
  };

  const doVerify = async () => {
    if (busy) return;
    setBusy(true);
    const lines: LogLine[] = [];
    setLog(lines);
    let broke = false;
    let ok = 0;
    for (let k = 0; k < chain.length; k++) {
      const r = chain[k];
      const recomputed = await receiptHash(r);
      const integrity = recomputed === r.hash;
      const link = k === 0 ? true : chain[k].prev_hash === (await receiptHash(chain[k - 1]));
      await new Promise((res) => setTimeout(res, 90));
      if (integrity && link && !broke) {
        ok++;
        setLog((prev) => [...prev, { kind: "ok", text: `#${r.index} · recompute ok · link ok` }]);
      } else if (!broke) {
        broke = true;
        setLog((prev) => [...prev, { kind: "bad", text: `#${r.index} · MISMATCH — prev_hash ≠ recomputed hash of receipt ${k - 1} · chain broken here` }]);
      } else {
        setLog((prev) => [...prev, { kind: "bad", text: `#${r.index} · untrusted — chain already broken` }]);
      }
    }
    setLog((prev) => [
      ...prev,
      { kind: broke ? "bad" : "ok", text: broke ? "tamper in receipt i was detected at i+1 — exactly as designed." : "no tamper detected — chain intact." },
    ]);
    void ok;
    setBusy(false);
  };

  const logClass = (k: LogLine["kind"]) => "logline " + (k === "ok" ? "ok" : k === "bad" ? "bad" : "diml");

  return (
    <div className="panel p-6" id={"tamper-" + id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg mb-1">Tamper &amp; detect</h3>
          <p className="dim text-[13px] max-w-2xl leading-relaxed">
            Local simulation on a working copy — no chain writes. The working copy’s hashes are recomputed in your browser with the frozen
            formula; the canonical verifier is <span className="mono text-[12px]" style={{ color: "#9be7c4" }}>cynex-verify</span>. The
            simulated attacker tampers with a receipt <i>and</i> recomputes its hash to cover their tracks — the chain still breaks one link
            later.
          </p>
        </div>
        <div className="mono text-[11px] dim2">{src}</div>
      </div>
      <div className="flex flex-wrap items-center gap-3 mt-5">
        <select
          className="input"
          style={{ minWidth: 220 }}
          value={picked}
          onChange={(e) => setPicked(Number(e.target.value))}
        >
          {chain.map((c) => (
            <option key={c.index} value={c.index}>
              receipt #{c.index} · {c.obligation_id} · {fmtToken(c.amount)} USDC
            </option>
          ))}
        </select>
        <button className="btn sm" onClick={() => void doTamper()} disabled={busy || chain.length === 0}>
          Tamper — amount +1 USDC, recompute hash
        </button>
        <button className="btn sm btn-primary" onClick={() => void doVerify()} disabled={busy || chain.length === 0}>
          Run verifier replay
        </button>
        <button className="btn sm ghost" onClick={() => reset(base)} disabled={busy || base.length === 0}>
          Reset
        </button>
      </div>
      <div className="mt-4 space-y-1.5">
        {log.map((l, i) => (
          <div key={i} className={logClass(l.kind)}>
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export type { Receipt };
