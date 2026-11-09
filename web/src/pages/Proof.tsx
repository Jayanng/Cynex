/* Cynex web — Proof page.
   Everything here is either a live chain read or a file in the repo.
   Nothing asks for trust — one command replays the whole receipt chain
   from genesis. The receipt table renders prev_hash as short hex with
   copy and expand, never as a decimal byte list. */

import { useState } from "react";
import { BUNDLES, REPO, VAULT_PROD, VAULT_TEST } from "../lib/data";
import { useLive } from "../lib/live";
import { bytesToHex, fmtToken, fmtTs, trunc } from "../lib/near";
import { StripSection } from "../components/Strip";
import { CmdBlock, HashChip, AcctChip, HexHash, Icon, ReadOnlyBadge, Unavail, LoadTxt } from "../components/ui";
import { Footer, CountsLine } from "../components/shared";
import { TamperPanel } from "../components/TamperPanel";

function JudgeItem({ n, t, body }: { n: string; t: string; body: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span
        className="flex-none w-7 h-7 grid place-items-center rounded-lg border mono text-[11px]"
        style={{ borderColor: "rgba(52,211,153,.4)", color: "var(--green)" }}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-white font-semibold text-[13.5px]">{t}</div>
        {body}
      </div>
    </div>
  );
}

export function Proof() {
  const { live: L, refreshLive } = useLive();
  const [replay, setReplay] = useState<{ running: boolean; marks: Record<number, "ok" | "bad">; done: boolean; okCount: number }>({
    running: false,
    marks: {},
    done: false,
    okCount: 0,
  });

  const replayBrowser = async () => {
    const f = L.recTest;
    if (!f.rows || !f.rows.length) return;
    setReplay({ running: true, marks: {}, done: false, okCount: 0 });
    const marks: Record<number, "ok" | "bad"> = {};
    let ok = 0;
    for (let i = 0; i < f.rows.length; i++) {
      await new Promise((r) => setTimeout(r, 60));
      const good = f.link?.perRow[i] ?? false;
      marks[i] = good ? "ok" : "bad";
      if (good) ok++;
      setReplay({ running: true, marks: { ...marks }, done: false, okCount: ok });
    }
    setReplay({ running: false, marks, done: true, okCount: ok });
  };

  const f = L.recTest;
  const tableBody = () => {
    if (f.err)
      return (
        <div className="p-8 text-center space-y-4">
          <div>
            <Unavail />
          </div>
          <div>
            <button className="btn sm" onClick={() => void refreshLive()}>
              <span style={{ width: 13, height: 13, display: "inline-grid", placeItems: "center" }}>
                <Icon name="refresh" size={13} />
              </span>
              Retry now
            </button>
          </div>
        </div>
      );
    if (!f.rows)
      return (
        <div className="p-8 text-center">
          <LoadTxt />
        </div>
      );
    if (!f.rows.length)
      return <div className="p-8 text-center dim mono text-[13px]">receipts(start: 0, limit: 50) returned no rows.</div>;
    const per = f.link?.perRow ?? [];
    return (
      <>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>index</th>
                <th>prev_hash</th>
                <th>obligation_id</th>
                <th>recipient</th>
                <th>amount</th>
                <th>token_id</th>
                <th>timestamp</th>
                <th>tx_ref</th>
                <th>verified_ok</th>
              </tr>
            </thead>
            <tbody>
              {f.rows.map((r, i) => {
                const ok = per[i];
                const mark = replay.marks[i];
                return (
                  <tr key={r.index} id={"rx-" + i} className={mark === "ok" ? "row-ok" : mark === "bad" ? "row-bad" : undefined}>
                    <td className="dim">{r.index}</td>
                    <td>
                      <HexHash value={r.prev_hash} />
                    </td>
                    <td style={{ color: "#dbe4ee" }}>{r.obligation_id}</td>
                    <td>
                      <a href={"https://testnet.nearblocks.io/address/" + r.recipient} target="_blank" rel="noopener" title={r.recipient}>
                        {trunc(r.recipient, 12, 8)}
                      </a>
                    </td>
                    <td title={"raw: " + String(r.amount) + " · " + fmtToken(r.amount) + " USDC"}>{String(r.amount)}</td>
                    <td className="dim" title={r.token_id}>
                      {trunc(r.token_id, 10, 8)}
                    </td>
                    <td className="dim" title={String(r.timestamp)}>
                      {fmtTs(r.timestamp)}
                    </td>
                    <td>
                      <HashChip hash={r.tx_ref} />
                    </td>
                    <td>
                      {ok ? (
                        <span
                          style={{ color: "var(--green)", width: 15, height: 15, display: "inline-grid", placeItems: "center" }}
                          title={"prev_hash links to receipt " + (i - 1 < 0 ? "genesis" : String(i - 1))}
                        >
                          <Icon name="check" size={15} />
                        </span>
                      ) : (
                        <span
                          style={{ color: "var(--red)", width: 15, height: 15, display: "inline-grid", placeItems: "center" }}
                          title="link broken"
                        >
                          <Icon name="x" size={15} />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div
          className="px-4 py-3 border-t mono text-[11px] dim2 flex flex-wrap gap-x-5 gap-y-1"
          style={{ borderColor: "var(--line2)" }}
        >
          <span>source: {VAULT_TEST} · receipts(start, limit) · live</span>
          <span>verified_ok = index contiguity + prev_hash linkage (in-browser)</span>
          <span>canonical recompute: cynex-verify</span>
        </div>
        {replay.done ? (
          <div
            className={"logline " + (replay.okCount === f.rows.length ? "ok" : "bad") + " fadein mt-3"}
            style={{ fontWeight: 600 }}
          >
            structural replay: {replay.okCount}/{f.rows.length} receipts · indices contiguous · prev_hash links{" "}
            {replay.okCount === f.rows.length ? "intact" : "BROKEN"} · canonical SHA-256 recompute: cynex-verify (command above)
          </div>
        ) : null}
      </>
    );
  };

  return (
    <>
      <StripSection />
      <section className="wrap pt-12">
        <div className="kicker mb-2">Proof</div>
        <h1 className="text-3xl md:text-4xl mb-2">Verify it yourself</h1>
        <p className="dim text-[14px] max-w-2xl">
          Everything on this page is either a live chain read or a file in the repo. Nothing here asks for trust — one command replays the
          whole receipt chain from genesis.
        </p>
      </section>

      {/* judges start here */}
      <section className="wrap mt-8">
        <div className="panel p-6 md:p-7" style={{ borderColor: "rgba(52,211,153,.3)" }}>
          <div className="kicker mb-4">Judges — start here</div>
          <div className="grid md:grid-cols-2 gap-x-10 gap-y-4 text-[13.5px]">
            <JudgeItem
              n="1"
              t="Live vaults"
              body={
                <div className="flex flex-col gap-1.5 mt-1">
                  <AcctChip account={VAULT_PROD} />
                  <AcctChip account={VAULT_TEST} />
                </div>
              }
            />
            <JudgeItem n="2" t="One command" body={<div className="mt-2"><CmdBlock cmdKey="verify" /></div>} />
            <JudgeItem
              n="3"
              t="Four attestation bundles"
              body={
                <div className="mono text-[12px] dim mt-1">
                  prod-tee-001 (request 13324) · 10640 · 11912 · 13040 — below, with verify commands.
                </div>
              }
            />
            <JudgeItem
              n="4"
              t="Demo script + live state"
              body={
                <div className="mt-1 flex flex-col gap-2">
                  <a className="mono text-[12px]" href="#/docs/p10demo">
                    docs/phase10-demo-script.md
                  </a>
                  <span data-live-region="counts">
                    <CountsLine />
                  </span>
                </div>
              }
            />
          </div>
        </div>
      </section>

      {/* verify command */}
      <section className="wrap mt-8">
        <div className="panel p-6 md:p-7">
          <div className="flex flex-wrap items-center gap-3 mb-1">
            <h2 className="text-xl md:text-2xl">One-command verify</h2>
            <ReadOnlyBadge />
          </div>
          <p className="dim text-[13.5px] mb-4">Read-only view calls against the vault — no keys, no wallet. Exact vault id and RPC endpoint included.</p>
          <div className="space-y-2 mb-4">
            <CmdBlock cmdKey="verify" />
            <CmdBlock cmdKey="verifyCsv" />
            <CmdBlock
              cmdKey="verifyProd"
              label="npx cynex-verify --vault cynex-vault.cynexmaster.testnet --rpc https://test.rpc.fastnear.com  · production vault"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="mono text-[11px] dim2 uppercase tracking-widest">expected output</span>
            <span data-live-region="counts">
              <CountsLine />
            </span>
          </div>
        </div>
      </section>

      {/* receipt table */}
      <section className="wrap mt-8">
        <div className="panel">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b" style={{ borderColor: "var(--line2)" }}>
            <div>
              <h2 className="text-xl">Receipt chain — test vault, live</h2>
              <div className="mono text-[11px] dim2 mt-1">frozen CSV columns · every tx_ref is an explorer link</div>
            </div>
            <div className="flex gap-2">
              <button className="btn sm" onClick={() => void replayBrowser()} disabled={replay.running}>
                <span style={{ width: 13, height: 13, display: "inline-grid", placeItems: "center" }}>
                  <Icon name="check" size={13} />
                </span>
                Replay in browser
              </button>
              <button className="btn sm ghost" onClick={() => void refreshLive()}>
                <span style={{ width: 13, height: 13, display: "inline-grid", placeItems: "center" }}>
                  <Icon name="refresh" size={13} />
                </span>
                Refresh
              </button>
            </div>
          </div>
          <div data-live-region="table">{tableBody()}</div>
          <div id="replayout" className="px-5 pb-5"></div>
        </div>
      </section>

      {/* tamper */}
      <section className="wrap mt-8">
        <TamperPanel id="proof" />
      </section>

      {/* bundles */}
      <section className="wrap mt-10">
        <div className="kicker mb-2">Attestation bundles</div>
        <h2 className="text-xl md:text-2xl mb-1">TEE evidence, verifiable offline</h2>
        <p className="dim text-[13.5px] max-w-2xl mb-6">
          All four bundles live in the repo under <span className="mono text-[12.5px] text-white">demo/attestations/</span>. Production TEE
          proof first. The VRF signature does not prove TEE execution.
        </p>
        <div className="space-y-4">
          {BUNDLES.map((b) => (
            <div key={b.id} className="panel p-5 md:p-6" style={b.top ? { borderColor: "rgba(52,211,153,.4)" } : undefined}>
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h3 className="text-[16px]">{b.title}</h3>
                {b.top ? (
                  <span className="badge b-paid">
                    <span className="bdot"></span>production
                  </span>
                ) : null}
                <span className="hashchip" title="OutLayer request id">
                  <span>OutLayer {b.req}</span>
                </span>
              </div>
              <p className="dim text-[13px] mb-3">
                {b.note} Vault:{" "}
                <a className="mono text-[12px]" href={"https://testnet.nearblocks.io/address/" + b.vault} target="_blank" rel="noopener">
                  {b.vault}
                </a>
              </p>
              <div className="grid md:grid-cols-[1fr,auto] gap-3 items-center">
                <CmdBlock cmdKey={b.key} />
                <a className="btn sm ghost" href={REPO} target="_blank" rel="noopener">
                  view bundle — demo/attestations/{b.id}.json{" "}
                  <span style={{ width: 12, height: 12, display: "inline-grid", placeItems: "center" }}>
                    <Icon name="ext" size={12} />
                  </span>
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>
      <Footer />
    </>
  );
}

export { bytesToHex };
