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

/* Claim map data. The Test column names the sandbox test file and
   test name where the repo has one; where no single test exists, it
   says so and does not invent a test name. Keep this table in sync
   with the same table in docs/JUDGES.md by hand. */
const CLAIMS: { claim: string; method: string; test: string; evidence: React.ReactNode }[] = [
  {
    claim: "The vault refuses a changed recipient",
    method: "settle",
    test: "contract/src/lib.rs, settle_rejects_wrong_recipient",
    evidence: (
      <>
        <HashChip hash="AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S" />, ERR_RECIPIENT_SUBSTITUTION, 0 tokens moved
      </>
    ),
  },
  {
    claim: "The vault refuses a changed amount",
    method: "settle",
    test: "contract/src/lib.rs, settle_rejects_wrong_amount",
    evidence: (
      <>
        <HashChip hash="43YaxJVggxuZ3E25WfjzkgGBsGAqLrj8nwdUU9RLAQRy" />, ERR_TERMS_MISMATCH, 0 tokens moved
      </>
    ),
  },
  {
    claim: "The vault refuses a replay",
    method: "settle",
    test: "contract/src/lib.rs, settle_rejects_replay_after_paid",
    evidence: (
      <>
        <HashChip hash="AwzQS7XsuGSYnPmvd5jFJzPDs3WDc2gRgSbW3smWq1Cs" />, ERR_NONCE_ALREADY_CONSUMED, nonce reused after receipt 12
      </>
    ),
  },
  {
    claim: "The vault pays only the exact authorized terms",
    method: "settle",
    test: "contract/src/lib.rs, callback_ok_books_paid_and_receipt",
    evidence: (
      <>
        Receipt 12, PAID, <HashChip hash="Ho97UjQEDDfe7Go66uHrVSJvbF8narZJ2YBH3hWarxi" />. Receipt 24, usecase-report-002, PAID after four
        refusals.
      </>
    ),
  },
  {
    claim: "The evidence digest matches the named report",
    method: "submit_evidence_preimage, vault hashes the artifact bytes and compares to the committed digest",
    test: "contract/src/lib.rs, submit_evidence_preimage_match_goes_ready",
    evidence:
      "Receipt 24, usecase-report-002. Report demo/near-agent-risk-report-v1.md, 6421 bytes, SHA-256 2a8bddcb3b001fd9051ec68757b8a113fa355cfe619f07882ac622721431ebc9.",
  },
  {
    claim: "The VRF signature is verified on chain and bound to the pending request",
    method: "on_tee_result (private callback), VRF signature verified on chain",
    test: "contract/src/lib.rs, on_tee_result_rejects_bad_signature",
    evidence: "OutLayer request 11912, attestation bundle on this page. The signature is verified on chain.",
  },
  {
    claim: "The TEE quote for request 11912 was verified off chain",
    method: "No contract method: the vault does not verify the quote on chain",
    test: "No contract test: outlayer-verify v0.1.0, exit 0 on requests 10640, 11912, 13040",
    evidence:
      "No live on-chain evidence: the TDX v4 quote for request 11912 was verified off chain through the OutLayer verifier, by design. The vault never relies on the quote alone.",
  },
  {
    claim: "The reputation gate refuses a bad counterparty before the chain",
    method: "Gate, not the contract: five sourced signals",
    test: "services/reputation/reputation.test.ts, wrapper gate on the code-change signal",
    evidence:
      "No live transaction: a BLOCKed attempt never reaches the chain, so there is no tx to link. A BLOCK refuses, a WARN escalates to a human.",
  },
  {
    claim: "The MCP sandbox runs the full cycle locally, nothing mocked",
    method: "MCP server, six tools over stdio",
    test: 'services/mcp/demo.test.ts, demo over stdio, "spawns the built demo, drives the three judge tries, and cleans up on SIGTERM"',
    evidence: (
      <>
        Local only, not testnet: demo-ready-001 PAID, receipt 2 in the local sandbox, tx{" "}
        <HashChip hash="B7oka8f5pYcTBGsZkgYpJPWeqjHbhG5512Uzrq2rBNXt" />. A changed recipient is refused, tx{" "}
        <HashChip hash="9G3A9J8AibhRWTQGHRxfhV82hcFWuUxsg6fghc4bme6G" />. Neither appears on testnet.
      </>
    ),
  },
  {
    claim: "The demo key can only call settle on the test vault",
    method: "settle, scoped key",
    test: "services/mcp/runtime-checks.test.ts, verifyRuntimeState",
    evidence:
      "Scoped key, test vault only: receiver test vault, method settle only, allowance 0.25 NEAR. Proven live: demo-live-001, receipt 31 PAID, tx 12pi6dZ1CzgvCeLWCCRSvC2iLyTaN7J2fRHtYnbHmcf6, block 277243629.",
  },
];


/* What is real and what is simulated. Copied from
   judge-experience-copy.md section 4; keep this table in sync with
   the same table in docs/JUDGES.md by hand. */
const REAL_VS_SIMULATED: [string, string, string][] = [
  [
    "Vault contract",
    "Real, deployed on NEAR testnet",
    "Testnet only. Both vaults run code hash 65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6 (read live 12 Nov 2026). No mainnet deployment, no mainnet spending.",
  ],
  [
    "Testnet chain",
    "Real NEAR testnet",
    "Testnet only. Receipts, balances, and transactions are live chain reads, but nothing here has real value.",
  ],
  [
    "Refusal",
    "Real transaction on testnet",
    "Transaction AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S, ERR_RECIPIENT_SUBSTITUTION, 0 tokens moved. The refusal shown is the recorded on-chain verdict, and the form on the Attack page evaluates the judge's own terms against it.",
  ],
  [
    "Settle",
    "Real transaction on testnet",
    "Settles use pre-seeded obligations and team keys. A judge does not create their own obligation without their own testnet accounts. Latest test settle is receipt 34, demo-live-004, PAID. Test vault receipts are live, 35. Production vault receipts are live, 13, policy p5-prod-001 spent 500 of 1000. Counts read live 12 Nov 2026.",
  ],
  [
    "TEE attestation",
    "Real, OutLayer, request 11912",
    "The TDX v4 quote was verified off chain. The vault does not verify the quote on chain, by design, so verification is off chain, not part of the contract check.",
  ],
  [
    "VRF anchor",
    "Real signature, verified on chain",
    "The signature is verified on chain and bound to the pending request. It proves determinism and binding. It does NOT prove TEE execution, and that link must never be claimed.",
  ],
  [
    "Reputation gate",
    "Real, five sourced signals",
    "A BLOCK refuses, a WARN escalates. It is a gate on top of the vault check, not a replacement for it. The vault still decides every settle.",
  ],
  [
    "MCP server",
    "Real, six tools over stdio, one moves funds",
    "Stdio only. There is no hosted endpoint. A judge needs their own testnet accounts, vault, scoped settle-only key, and CYNEX_ env vars to use it against testnet. The sandbox mode needs no keys.",
  ],
  [
    "Sandbox demo",
    "Real vault and token contracts in a local near-sandbox",
    "Local only, not testnet. Receipts are local, for example receipt 2 for demo-ready-001, and do not appear on testnet. Nothing is mocked.",
  ],
  [
    "Demo key",
    "Real scoped settle-only key, test vault only",
    "It can only call settle on the test vault. It cannot create obligations or move other funds. The demo endpoint is rate limited (1 per minute, 5 per hour per IP), and, as of 12 Nov 2026, 6 READY obligations remain for judges, demo-live-005 to demo-live-010; demo-live-001, 002, 003 and 004 are PAID. When they are used up, the button stops.",
  ],
  [
    "Token",
    "Real testnet token, usdc.fakes.testnet, 6 decimals, shown as USDC.e testnet",
    "Fake testnet USDC with no value. No mainnet value, no mainnet spending. One past recipient, acme-supplies.testnet, does not exist on chain despite a receipt and a token balance, because settle uses plain ft_transfer, which credits the token contract map even for a nonexistent id. Future settles avoid that recipient unless the owner decides explicitly with the WARN shown.",
  ],
];


const BUILD_STATUS: [string, string, string][] = [
  [
    "Done",
    "Vault on testnet, both vaults.",
    "Same code hash 65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6. Test receipts 35, production receipts 13 (read live 12 Nov 2026; live counts in the table above).",
  ],
  [
    "Done",
    "Recorded refusals on chain.",
    "Canonical refusal tx AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S, 0 tokens moved, and the receipt 24 run: four recorded refusals and one successful settlement; the replay refusal came after the payment.",
  ],
  ["Done", "Verify command.", "One command replays every receipt from genesis and expects every row verified_ok = true."],
  [
    "Done",
    "MCP sandbox demo.",
    "One command, cd frontend && npm run mcp:build && npm run mcp:demo, real vault and token contracts in a local sandbox, five seeded obligations, nothing mocked.",
  ],
  ["Done", "TamperPanel in the browser.", "Recomputes SHA-256 with crypto.subtle, no trust in the page needed."],
  [
    "Done",
    "Run it live button.",
    "Proven live: demo-live-001 settled, receipt 31 PAID, tx 12pi6dZ1CzgvCeLWCCRSvC2iLyTaN7J2fRHtYnbHmcf6, block 277243629. demo-live-002, 003 and 004 are also PAID, demo-live-004 is receipt 34.",
  ],
  [
    "Partial",
    "Live numbers on the site.",
    "The strip and receipt table read live from the chain in production; prose tables below carry dated 12 Nov 2026 chain reads.",
  ],
];


const HONEST_LIMITS: string[] = [
  "The VRF signature does not prove TEE execution. It proves determinism and binding to the pending request. That link must never be claimed.",
  "The vault does not verify the TDX quote on chain. The quote for request 11912 was verified off chain, by design, not as part of the contract check.",
  "Receipts 0 to 6 name acme-supplies.testnet, which does not exist on chain. See the warning at the top of this page. Future settles avoid that recipient unless the owner decides explicitly with the warning shown.",
  "One account held both agent roles in the canonical run. Receipt 24 proves the vault enforces its controls, not payment between two distinct accounts. The two-agent run is receipt 28.",
  "The in-browser receipt check is index contiguity only. The Receipt struct carries prev_hash but no field for its own hash, so the browser cannot compare hash links. The terminal verify command recomputes the full hash chain.",
  "Testnet only, fake testnet USDC with no value. No mainnet deployment, no mainnet spending.",
];


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
        <div className="overflow-auto max-h-[460px]">
          <table className="tbl">
            <thead className="sticky top-0 z-10">
              <tr>
                <th>index</th>
                <th>prev_hash</th>
                <th>obligation_id</th>
                <th>recipient</th>
                <th>amount</th>
                <th>token_id</th>
                <th>timestamp</th>
                <th>tx_ref</th>
                <th>link_ok</th>
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
                    <td title={"raw: " + String(r.amount) + " · " + fmtToken(r.amount) + " USDC · usdc.fakes.testnet, 6 decimals"}>{String(r.amount)}</td>
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
          <span>link_ok = index contiguity (in-browser); hash links are recomputed by the CLI verify-live</span>
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
      <section className="wrap pt-8 md:pt-10">
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6 text-sm">
            <div>
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
            <div>
            <JudgeItem
              n="4"
              t="Demo run + live state"
              body={
                <div className="mt-1 flex flex-col gap-2">
                  <a className="mono text-xs" href="#/docs/p10demo">
                    docs/demo-script.md
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

      {/* claim map */}
      <section className="wrap mt-10">
        <div className="kicker mb-2">Claim map</div>
        <h2 className="text-xl md:text-2xl mb-2">Claim map</h2>
        <p className="dim text-sm max-w-3xl mb-6">
          Each claim, the contract method, the test that proves it, and the live transaction that shows it. Where there is no live evidence,
          that is stated in the same format.
        </p>
        <div className="panel overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Claim</th>
                <th>Contract method</th>
                <th>Test</th>
                <th>Live evidence</th>
              </tr>
            </thead>
            <tbody>
              {CLAIMS.map((c) => (
                <tr key={c.claim}>
                  <td style={{ color: "var(--txt)" }}>{c.claim}</td>
                  <td className="mono text-xs dim">{c.method}</td>
                  <td className="mono text-xs dim">{c.test}</td>
                  <td className="dim text-[13px]">{c.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* build status */}
      <section className="wrap mt-10">
        <div className="kicker mb-2">Build status</div>
        <h2 className="text-xl md:text-2xl mb-2">Build status</h2>
        <p className="dim text-sm max-w-3xl mb-6">
          What runs today and what does not, in plain language, so a judge does not have to work it out from the code.
        </p>
        <div className="space-y-3">
          {BUILD_STATUS.map(([status, title, body]) => (
            <div key={title} className="panel p-5 flex gap-4 items-start">
              <span className={status === "Done" ? "badge b-paid" : "badge b-warn"}>
                <span className="bdot"></span>
                {status}
              </span>
              <div className="min-w-0">
                <span className="text-ink font-medium text-sm">{title} </span>
                <span className="dim text-sm leading-relaxed">{body}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* what is real and what is simulated */}
      <section className="wrap mt-10">
        <div className="kicker mb-2">What is real and what is simulated</div>
        <h2 className="text-xl md:text-2xl mb-2">What is real and what is simulated</h2>
        <p className="dim text-sm max-w-3xl mb-6">
          The whole table, in one place, so a judge does not have to collect caveats page by page.
        </p>
        <div className="panel overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Item</th>
                <th>Real or simulated</th>
                <th>Limit, stated plainly</th>
              </tr>
            </thead>
            <tbody>
              {REAL_VS_SIMULATED.map(([item, real, limit]) => (
                <tr key={item}>
                  <td style={{ color: "var(--txt)" }}>{item}</td>
                  <td className="dim">{real}</td>
                  <td className="dim text-[13px]">{limit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* honest limits */}
      <section className="wrap mt-10">
        <div className="kicker mb-2">Honest limits</div>
        <h2 className="text-xl md:text-2xl mb-2">Honest limits</h2>
        <p className="dim text-sm max-w-3xl mb-6">The limits, in one named section, stated plainly.</p>
        <ul className="space-y-3 max-w-3xl">
          {HONEST_LIMITS.map((l) => (
            <li key={l.slice(0, 32)} className="flex gap-3 text-sm leading-relaxed dim">
              <span className="flex-none mt-1" style={{ color: "var(--pos-text)", width: 16, height: 16, display: "inline-grid", placeItems: "center" }}>
                <Icon name="check" />
              </span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
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
              <div className="grid md:grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
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
