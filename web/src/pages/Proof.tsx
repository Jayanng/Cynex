/* Cynex web, Proof page.
   Everything here is either a live chain read or a file in the repo.
   Nothing asks for trust, one command replays the whole receipt chain
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
        className="flex-none w-7 h-7 grid place-items-center rounded-lg border mono text-xs"
        style={{ borderColor: "var(--line)", color: "var(--pos-text)" }}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-ink font-medium text-sm">{t}</div>
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
              <span style={{ width: 16, height: 16, display: "inline-grid", placeItems: "center" }}>
                <Icon name="refresh" />
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
                    <td style={{ color: "var(--txt)" }}>{r.obligation_id}</td>
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
                      {/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(r.tx_ref) ? (
                        <HashChip hash={r.tx_ref} />
                      ) : r.tx_ref ? (
                        <span className="dim mono" title={r.tx_ref}>
                          {trunc(r.tx_ref, 12, 8)}
                        </span>
                      ) : (
                        <span className="dim mono" title="tx_ref is empty on chain for this receipt: the automatic settle path records no tx hash">
                          -
                        </span>
                      )}
                    </td>
                    <td>
                      {ok ? (
                        <span
                          style={{ color: "var(--pos-text)", width: 16, height: 16, display: "inline-grid", placeItems: "center" }}
                          title={"index follows receipt " + (i - 1 < 0 ? "genesis" : String(i - 1)) + " (contiguity only; hash links are checked by verify-live)"}
                        >
                          <Icon name="check" />
                        </span>
                      ) : (
                        <span
                          style={{ color: "var(--neg-text)", width: 16, height: 16, display: "inline-grid", placeItems: "center" }}
                          title="link broken"
                        >
                          <Icon name="x" />
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
          className="px-4 py-3 border-t mono text-xs dim2 flex flex-wrap gap-x-5 gap-y-1"
          style={{ borderColor: "var(--line2)" }}
        >
          <span>source: {VAULT_TEST} · receipts(start, limit) · live</span>
          <span>verified_ok = index contiguity (in-browser); the Receipt struct has no hash field, so the browser cannot compare hash links</span>
          <span>canonical recompute: node frontend/dist-test/cli/cynex.js verify-live cynex-testvault.cynexmaster.testnet</span>
        </div>
        {replay.done ? (
          <div
            className={"logline " + (replay.okCount === f.rows.length ? "ok" : "bad") + " fadein mt-3"}
          >
            structural replay: {replay.okCount}/{f.rows.length} receipts · indices contiguous · hash links are recomputed by the CLI, not
            here · canonical SHA-256 recompute: verify-live (command above)
          </div>
        ) : null}
      </>
    );
  };

  return (
    <>
      <StripSection />
      <section className="wrap pt-12">
        <a
          href="#/"
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium mb-4"
          style={{ borderColor: "var(--line)", background: "var(--raised)", color: "var(--secondary)" }}
        >
          ← Home
        </a>
        <div className="kicker mb-2">Proof</div>
        <h1 className="text-3xl md:text-4xl mb-2">Verify it yourself</h1>
        <p className="dim text-sm max-w-2xl">
          Everything on this page is either a live chain read or a file in the repo. Nothing here asks for trust, one command replays the
          whole receipt chain from genesis.
        </p>
      </section>

      {/* judges start here */}
      <section className="wrap mt-8">
        <div className="panel p-6">
          <div className="kicker mb-4">Judges, start here</div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-4 md:grid-cols-3 text-sm">
            <div className="md:col-span-2">
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
            </div>
            <JudgeItem n="2" t="One command" body={<div className="mt-2"><CmdBlock cmdKey="verify" /></div>} />
            <JudgeItem
              n="3"
              t="Four attestation bundles"
              body={
                <div className="mono text-xs dim mt-1">
                  prod-tee-001 (request 13324) · 10640 · 11912 · 13040, below, with verify commands.
                </div>
              }
            />
            <div className="md:col-span-2">
            <JudgeItem
              n="4"
              t="Demo script + live state"
              body={
                <div className="mt-1 flex flex-col gap-2">
                  <a className="mono text-xs" href="#/docs/p10demo">
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
        </div>
      </section>

      {/* verify command */}
      <section className="wrap mt-8">
        <div className="panel p-6">
          <div className="flex flex-wrap items-center gap-3 mb-1">
            <h2 className="text-xl md:text-2xl">One-command verify</h2>
            <ReadOnlyBadge />
          </div>
          <p className="dim text-sm mb-4">Read-only view calls against the vault, no keys, no wallet. Exact vault id included; the RPC endpoint is the default.</p>
          <div className="space-y-2 mb-4">
            <CmdBlock cmdKey="verify" />
            <CmdBlock cmdKey="verifyCsv" />
            <CmdBlock cmdKey="verifyProd" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="mono text-xs dim2 ">expected output</span>
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
              <h2 className="text-xl">Receipt chain, test vault, live</h2>
              <div className="mono text-xs dim2 mt-1">
                frozen CSV columns · tx_ref is empty for most receipts: the automatic settle path records no tx hash
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn sm" onClick={() => void replayBrowser()} disabled={replay.running}>
                <span style={{ width: 16, height: 16, display: "inline-grid", placeItems: "center" }}>
                  <Icon name="check" />
                </span>
                Replay in browser
              </button>
              <button className="btn sm ghost" onClick={() => void refreshLive()}>
                <span style={{ width: 16, height: 16, display: "inline-grid", placeItems: "center" }}>
                  <Icon name="refresh" />
                </span>
                Refresh
              </button>
            </div>
          </div>
          <div className="callout mono text-xs mx-5 mt-4">
            Warning: receipts 0 to 6 name acme-supplies.testnet, which does not exist on chain (view_account returns UNKNOWN_ACCOUNT). Those
            settles credited a token balance, because ft_transfer only updates the token contract map, but the account was never created, so
            they are not payments to a real counterparty. Do not settle to acme-supplies.testnet.
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
        <p className="dim text-sm max-w-2xl mb-6">
          All four bundles live in the repo under <span className="mono text-[13px] text-ink">docs/attestation-proofs/</span>.
          Production TEE proof first. The VRF signature does not prove TEE execution. Request 13040 verifies offline with mainnet collateral
          bundled in its file, because the testnet collateral archive lags. Verify live from a tx hash with{" "}
          <span className="mono text-[13px]" style={{ color: "var(--accent-text)" }}>
            scripts/verify-tee-attestation.sh --tx &lt;hash&gt;
          </span>
          .
        </p>
        <div className="space-y-4">
          {BUNDLES.map((b) => (
            <div key={b.id} className="panel p-6" style={b.top ? { background: "var(--raised)" } : undefined}>
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <h3 className="text-base">{b.title}</h3>
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
                <a className="mono text-xs" href={"https://testnet.nearblocks.io/address/" + b.vault} target="_blank" rel="noopener">
                  {b.vault}
                </a>
              </p>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <span className="mono text-xs dim2 ">TEE request tx</span>
                <HashChip hash={b.tx} />
              </div>
              <div className="grid md:grid-cols-[1fr_auto] gap-3 items-center">
                <CmdBlock cmdKey={b.key} />
                <a className="btn sm ghost" href={REPO + "/blob/master/docs/attestation-proofs/" + b.file} target="_blank" rel="noopener">
                  view bundle, docs/attestation-proofs/{b.file}{" "}
                  <span style={{ width: 16, height: 16, display: "inline-grid", placeItems: "center" }}>
                    <Icon name="ext" />
                  </span>
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="wrap mt-10">
        <div className="panel p-6">
          <div className="kicker mb-3">Next</div>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <a className="mono text-sm inline-flex items-center gap-2" style={{ color: "var(--accent-text)" }} href="#/docs">
              Read how it works →
            </a>
            <a className="mono text-sm inline-flex items-center gap-2" style={{ color: "var(--accent-text)" }} href="#/">
              Back to the start →
            </a>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}

export { bytesToHex };
