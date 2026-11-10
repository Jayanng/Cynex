/* Cynex web, Landing page.
   Refusal first, then the hero, the live strip, the trust row, one verify
   command, try-to-break-it, one live proof, the three layers, the trust
   model, and the calls to action. */

import { useEffect } from "react";
import { AGENT, AGENT2, MCP_FACTS, MCP_RUN, MCP_TOOLS, SETTLE_CODES, USECASE, VAULT_TEST } from "../lib/data";
import { useLive } from "../lib/live";
import { fmtToken, fmtTs, trunc } from "../lib/near";
import { useChainRead } from "../lib/useChainRead";
import { Badge, ChainReadOut, HashChip, AcctChip, Icon, LoadTxt, Unavail } from "../components/ui";
import { StripSection } from "../components/Strip";
import { RefusalPanel, TrustRow, VerifyLanding, Footer } from "../components/shared";
import { BreakIt } from "../components/BreakIt";

function LatestSettle() {
  const { live: L } = useLive();
  const f = L.recTest;
  if (f.err)
    return (
      <div className="p-5">
        <Unavail />
      </div>
    );
  if (!f.rows || !f.rows.length)
    return (
      <div className="p-5">
        <LoadTxt />
      </div>
    );
  const r = f.rows[f.rows.length - 1];
  const row2 = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-4">
      <span className="dim2">{k}</span>
      <span className="text-right" style={{ color: "#c3d3e4" }}>
        {v}
      </span>
    </div>
  );
  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="mono text-[10px] tracking-[.18em] uppercase dim2">latest settle, live read</span>
        <Badge value="PAID" />
      </div>
      <div className="mono text-[12.5px] space-y-1.5">
        {row2("receipt", "#" + r.index)}
        {row2("obligation", r.obligation_id)}
        {row2(
          "amount",
          <span title={fmtToken(r.amount) + " USDC · usdc.fakes.testnet, 6 decimals"}>{String(r.amount)} units</span>
        )}
        {row2("recipient", trunc(r.recipient, 14, 8))}
      </div>
      <div className="pt-1">
        <HashChip hash={r.tx_ref} />
      </div>
      {!r.tx_ref ? (
        <div className="text-[11px] dim2 mono">
          No tx hash on this receipt: the automatic settle path records none, so there is nothing to link to.
        </div>
      ) : null}
      <div className="text-[11px] dim2 mono">
        read from {VAULT_TEST} · {L.checkedAt ? L.checkedAt.toLocaleTimeString() : ""}
      </div>
    </div>
  );
}

function Layer({
  n,
  t,
  body,
  extra,
  linktxt,
  href,
}: {
  n: string;
  t: string;
  body: string;
  extra?: React.ReactNode;
  linktxt: string;
  href: string;
}) {
  return (
    <div className="panel panel-h p-6 flex flex-col">
      <div className="mono text-[11px] dim2 mb-3">{n}</div>
      <h3 className="text-lg mb-2 text-white">{t}</h3>
      <p className="dim text-[13.5px] leading-relaxed">{body}</p>
      {extra}
      <a href={href} className="mono text-[12px] mt-auto pt-4 inline-flex items-center gap-2" style={{ color: "var(--green)" }}>
        {linktxt}{" "}
        <span style={{ width: 12, height: 12, display: "inline-grid", placeItems: "center" }}>
          <Icon name="arrow" size={12} />
        </span>
      </a>
    </div>
  );
}

function UseCaseSection() {
  return (
    <section className="wrap mt-16">
      <div className="panel p-6 md:p-8" style={{ borderColor: "rgba(52,211,153,.3)" }}>
        <div className="kicker mb-3">What it is for</div>
        <h2 className="text-2xl md:text-3xl mb-4">One job: pay for one named report, exactly.</h2>
        <p className="dim text-[14px] leading-relaxed max-w-3xl mb-5">{USECASE.story}</p>
        <div className="terms-grid mb-5">
          <div className="term">
            <div className="tl">owner (human)</div>
            <div className="tv">{USECASE.owner}</div>
          </div>
          <div className="term">
            <div className="tl">procurement agent</div>
            <div className="tv">{USECASE.procurementAgent}</div>
          </div>
          <div className="term">
            <div className="tl">research agent (recipient)</div>
            <div className="tv">{USECASE.researchAgent}</div>
          </div>
          <div className="term">
            <div className="tl">amount</div>
            <div className="tv">{USECASE.amount}</div>
          </div>
          <div className="term">
            <div className="tl">artifact</div>
            <div className="tv">{USECASE.artifact}</div>
          </div>
          <div className="term">
            <div className="tl">artifact size</div>
            <div className="tv">{USECASE.artifactBytes} bytes, under the 64 KiB cap</div>
          </div>
        </div>
        <p className="dim text-[13.5px] leading-relaxed max-w-3xl mb-2">
          Evidence is the exact report artifact committed by digest. The vault hashes the bytes itself and compares them to the digest, so a
          different report cannot unlock the payment.
        </p>
        <div className="mono text-[12px] mb-5" style={{ color: "#9be7c4", overflowWrap: "anywhere" }}>
          SHA-256 {USECASE.artifactDigest}
        </div>
        <div className="space-y-2.5 mb-5">
          {USECASE.obligations.map((o) => (
            <div className="attempt" key={o.id}>
              <span className="att-label">{o.id}</span>
              <Badge value="PAID" />
              <span className="mono text-[11px] dim2">receipt #{o.receipt}</span>
              <span className="mono text-[11px] dim2">{o.note}</span>
            </div>
          ))}
        </div>
        <h3 className="text-white text-[15px] mb-3">The attack sequence on usecase-report-002: four refusals, then the correct settle</h3>
        <div className="space-y-2.5">
          {USECASE.attacks.map((a) => (
            <div className="attempt" key={a.tx}>
              <span className="att-label">{a.label}</span>
              <Badge value={a.code === "PAID" ? "PAID" : "REFUSED"} extra={a.code === "PAID" ? undefined : a.code} />
              <HashChip hash={a.tx} />
            </div>
          ))}
        </div>
        <p className="dim text-[12.5px] mt-4">
          Full script: <span className="mono text-[12px] text-white">docs/use-case-demo-script.md</span>. The research agent in the
          two-agent run is a real second account, {AGENT2}, created 2026-11-08.
        </p>
      </div>
    </section>
  );
}

function McpSection() {
  return (
    <section className="wrap mt-16">
      <div className="kicker mb-3">Agent integration</div>
      <h2 className="text-2xl md:text-3xl mb-4">An MCP server, with one tool that moves funds.</h2>
      <p className="dim text-[14px] leading-relaxed max-w-3xl mb-5">{MCP_FACTS}</p>
      <div className="overflow-x-auto mb-5">
        <table className="tbl">
          <thead>
            <tr>
              <th>tool</th>
              <th>what it does</th>
              <th>moves funds</th>
            </tr>
          </thead>
          <tbody>
            {MCP_TOOLS.map(([name, what, moves]) => (
              <tr key={name}>
                <td className="mono" style={{ color: "#dbe4ee" }}>
                  {name}
                </td>
                <td className="dim">{what}</td>
                <td>{moves ? <span className="mono text-[11px]" style={{ color: "var(--amber)" }}>yes, the only one</span> : <span className="mono text-[11px] dim2">no</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dim text-[13.5px] leading-relaxed max-w-3xl">
        Run it from <span className="mono text-[12.5px] text-white">frontend/</span>:{" "}
        <span className="mono text-[12.5px]" style={{ color: "#9be7c4" }}>
          {MCP_RUN}
        </span>
        . The MCP transcript is one of the deliverables carried through the use case, alongside the console run, the attack log, the receipt,
        and the proof page. Docs: <span className="mono text-[12px] text-white">services/mcp/README.md</span> and{" "}
        <span className="mono text-[12px] text-white">services/mcp/SECURITY.md</span>.
      </p>
    </section>
  );
}

export function Landing() {
  const { states, run } = useChainRead();
  useEffect(() => {
    const t = setTimeout(() => void run(12), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <RefusalPanel />
      <section className="wrap pt-10 md:pt-14">
        <div className="grid lg:grid-cols-[1.5fr,1fr] gap-10 items-start">
          <div>
            <div className="kicker mb-5">Purpose-bound settlement · Testnet</div>
            <h1 className="hero-h">
              Pay the <span className="grad">obligation</span>.
              <br />
              Not the prompt.
            </h1>
            <p className="mt-6 text-[16px] leading-relaxed dim max-w-xl">
              Cynex only pays exactly what a human authorized, same recipient, same amount, same evidence, and refuses everything else, even
              if the AI agent is compromised.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a className="btn btn-primary" href="#/demo/guided">
                See the demo{" "}
                <span style={{ width: 14, height: 14, display: "inline-grid", placeItems: "center" }}>
                  <Icon name="arrow" size={14} />
                </span>
              </a>
              <a className="btn" href="#/proof">
                Verify it yourself
              </a>
            </div>
            <div className="mono text-[11px] dim2 mt-4">no login · no wallet · every receipt is a live chain read</div>
          </div>
          <div className="panel fadein" data-live-region="latest" style={{ minHeight: 220 }}>
            <LatestSettle />
          </div>
        </div>
      </section>

      <StripSection />
      <TrustRow />
      <VerifyLanding />
      <UseCaseSection />
      <BreakIt />

      {/* One live proof */}
      <section className="wrap mt-14">
        <div className="panel p-6 md:p-8">
          <div className="flex flex-wrap items-center gap-3 mb-1">
            <span className="kicker">One live proof</span>
          </div>
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <h2 className="text-2xl md:text-3xl">
              A correct settle, <span style={{ color: "var(--green)" }}>PAID</span>
            </h2>
            <Badge value="PAID" />
          </div>
          <p className="dim text-[14px] max-w-3xl leading-relaxed mb-5">
            Step 2: after the vault refused a substituted recipient and an inflated amount, the correct settle of obligation{" "}
            <span className="mono text-[13px] text-white">p10-demo-attack-001</span> went through, 100 base units (0.0001 USDC) to{" "}
            <AcctChip account={AGENT} />, and wrote receipt #12 to the hash chain.
          </p>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <span className="mono text-[11px] dim2 uppercase tracking-widest">settle tx</span>
            <HashChip hash="Ho97UjQEDDfe7Go66uHrVSJvbF8narZJ2YBH3hWarxi" />
            <span className="mono text-[11px] dim2">receipt #12 · {VAULT_TEST}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn sm" onClick={() => void run(12)}>
              Read receipt #12 from chain, now
            </button>
            <a className="mono text-[12px] dim inline-flex items-center gap-1" href="#/demo/guided/step2">
              or watch the attack get refused first{" "}
              <span style={{ width: 12, height: 12, display: "inline-grid", placeItems: "center" }}>
                <Icon name="arrow" size={12} />
              </span>
            </a>
          </div>
          <div id="cr-12">
            <ChainReadOut state={states[12] ?? null} />
          </div>
        </div>
      </section>

      {/* Three layers */}
      <section className="wrap mt-16">
        <div className="kicker mb-3">The three layers</div>
        <h2 className="text-2xl md:text-3xl mb-8">The decision moves to the chain.</h2>
        <div className="grid md:grid-cols-3 gap-5">
          <Layer
            n="01"
            t="On-chain integrity"
            body="Settle checks the terms in a fixed order: obligation exists, in-flight and PAID nonce checks, READY state, resolved-ready, recipient, amount, expiry, policy exists and unfrozen, policy version, token lock, budget, native headroom. Eleven settle codes, no discretion."
            extra={
              <div className="flex flex-wrap gap-1.5 mt-3">
                {SETTLE_CODES.map(([c]) => (
                  <span key={c} className="codechip" style={{ fontSize: 10 }}>
                    {c}
                  </span>
                ))}
              </div>
            }
            linktxt="Live example: wrong recipient refused"
            href="#/demo/guided/step2"
          />
          <Layer
            n="02"
            t="TEE provenance"
            body="PREIMAGE: the vault hashes the delivery artifact bytes itself and compares them to the digest committed at authorization, capped at 64 KiB (MAX_PREIMAGE_BYTES 65536, ERR_EVIDENCE_TOO_LARGE above it). Oversized evidence falls back to TRUSTED_RELAYER, the allowlisted verifier path for oversized evidence. TEE: verification runs in the OutLayer guest, which fetches the evidence from its claimed source and returns the digest plus the source. The vault does not verify the TDX quote on chain; quote verification is off chain."
            extra={
              <div className="mono text-[11.5px] dim mt-3">
                OutLayer request <span className="text-white">11912</span> · 300 TGas console caller gas (contract: 100 TGas request + 50
                TGas callback) · request_tee_verification is owner only, 0.01 NEAR deposit
              </div>
            }
            linktxt="Live example: TEE settle, receipt #13"
            href="#/demo/guided/step3"
          />
          <Layer
            n="03"
            t="VRF anchor"
            body="During TEE execution the guest requests VRF randomness, and the vault verifies the VRF signature on chain with env::ed25519_verify, bound to the pending request. The signature proves the VRF response is valid and bound to that request. It does not prove TEE execution: the VRF signature is the on-chain anchor, and the TDX quote is verified off chain."
            extra={
              <div className="mono text-[11.5px] dim mt-3">
                VRF signature verified on chain, bound to the pending request.
              </div>
            }
            linktxt="Verify the attestation bundles"
            href="#/proof"
          />
        </div>
      </section>

      {/* Off-chain reputation gate: separate from the three layers, the vault never sees a BLOCKed attempt */}
      <section className="wrap mt-5">
        <div className="panel p-6 md:p-7">
          <div className="mono text-[11px] dim2 mb-3">Off-chain gate, not a layer</div>
          <h3 className="text-lg mb-2 text-white">Reputation gate</h3>
          <p className="dim text-[13.5px] leading-relaxed">
            Five signals scored before any settle by the off-chain console gate, never by the vault: account_existence,
            account_age, prior_vault_interactions, blocklist, code_change_recency. BLOCK refuses before settlement and
            names the signal and its source. WARN escalates unless CYNEX_APPROVE_WARN=1. Signals show as unavailable
            when they cannot be sourced, and ALLOW needs at least one prior receipt. The vault never sees a BLOCKed
            attempt: the gate refuses before anything reaches the chain.
          </p>
          <div className="mt-3">
            <Badge value="BLOCK" extra="code_change_recency" />
          </div>
          <a href="#/demo/guided/gate" className="mono text-[12px] mt-4 pt-2 inline-flex items-center gap-2" style={{ color: "var(--green)" }}>
            The gate moment
            <span style={{ width: 12, height: 12, display: "inline-grid", placeItems: "center" }}>
              <Icon name="arrow" size={12} />
            </span>
          </a>
        </div>
      </section>

      {/* Flow diagram: how a settlement moves through the layers */}
      <section className="wrap mt-10">
        <div className="panel p-5 md:p-6">
          <div className="mono text-[11px] dim2 mb-3 uppercase tracking-widest">How a settlement flows</div>
          <div className="flow">
            <span className="flow-step">human authorizes the obligation</span>
            <span className="flow-arrow">-&gt;</span>
            <span className="flow-step">agent requests settlement</span>
            <span className="flow-arrow">-&gt;</span>
            <span className="flow-step">console reputation gate: BLOCK refuses, WARN escalates</span>
            <span className="flow-arrow">-&gt;</span>
            <span className="flow-step">evidence to READY: preimage hash, TEE, or verifier</span>
            <span className="flow-arrow">-&gt;</span>
            <span className="flow-step">vault checks the fixed terms, in order</span>
            <span className="flow-arrow">-&gt;</span>
            <span className="flow-step">settle writes a hash-chained receipt</span>
          </div>
          <p className="dim text-[12.5px] mt-3">
            The vault is the last check, not the first: the gate can refuse before anything reaches the chain, and the vault refuses any
            settle whose terms differ, whatever the gate said.
          </p>
        </div>
      </section>
      <McpSection />

      {/* Trust model */}
      <section className="wrap mt-16">
        <div className="panel p-6 md:p-8" style={{ borderColor: "rgba(251,191,36,.25)" }}>
          <div className="kicker mb-3" style={{ color: "var(--amber)" }}>
            Trust model
          </div>
          <div className="grid md:grid-cols-2 gap-x-10 gap-y-3 text-[14px] leading-relaxed dim">
            {[
              "The contract is the decision-maker. The agent proposes; the vault disposes. Terms are fixed at obligation creation, settle only checks them.",
              "Funding enters only via ft_transfer_call. Evidence is required before settle: a SHA-256 preimage of the delivery artifact, or TEE verification via OutLayer.",
              "Every settle writes a hash-chained receipt (NEP-297). Anyone can replay the chain from genesis, tamper with receipt i and it is detected at i+1.",
              "NEAR function-call keys restrict which methods an agent key may call, they do not restrict the arguments. That gap is exactly what Cynex closes.",
              "Cancel and reconciliation: cancel_obligation and cancel_expired_ready are owner only. cancel_expired_ready refuses a READY obligation that has not expired yet (ERR_NOT_EXPIRED); only an expired READY obligation can be cancelled that way. A transfer has a 10-minute timeout and evidence has a 1-hour timeout; a stuck transfer goes to RECONCILIATION_REQUIRED for a human. A confirmed failed transfer returns to READY for a fresh settle, up to 3 attempts (MAX_TRANSFER_ATTEMPTS), then escalates to reconciliation, and the contract never redispatches a transfer on its own.",
              "TEE requirements: request_tee_verification is owner only, with a 0.01 NEAR deposit, 100 TGas for the request plus 50 TGas for the callback. The 300 TGas in the demo is the console caller gas, not a contract constant.",
            ].map((t) => (
              <div key={t.slice(0, 24)} className="flex gap-3">
                <span className="flex-none mt-1" style={{ color: "var(--green)", width: 15, height: 15, display: "inline-grid", placeItems: "center" }}>
                  <Icon name="check" size={15} />
                </span>
                <span>{t}</span>
              </div>
            ))}
          </div>
          <div className="callout mt-6 mono text-[13px]" style={{ color: "#fde68a" }}>
            The VRF signature does not prove TEE execution. The vault does not verify the TDX quote on chain: quote verification is off
            chain, and the VRF signature is the on-chain anchor.
          </div>
          <div className="mono text-[11px] dim2 mt-4">Testnet only. No mainnet funds. No production settles from this site.</div>
        </div>
      </section>

      {/* CTAs */}
      <section className="wrap mt-16">
        <div className="grid md:grid-cols-2 gap-5">
          <a href="#/demo/guided" className="panel panel-h p-7 block">
            <div className="kicker mb-2">Demo</div>
            <h3 className="text-xl mb-2 text-white">See the demo</h3>
            <p className="dim text-[14px]">
              The full demo run, happy path, refused attacks, TEE settle, verification, every step with its real tx hash and a live chain
              read.
            </p>
            <div className="mono text-[12px] mt-4 inline-flex items-center gap-2" style={{ color: "var(--green)" }}>
              guided or sandbox{" "}
              <span style={{ width: 13, height: 13, display: "inline-grid", placeItems: "center" }}>
                <Icon name="arrow" size={13} />
              </span>
            </div>
          </a>
          <a href="#/proof" className="panel panel-h p-7 block">
            <div className="kicker mb-2">Proof</div>
            <h3 className="text-xl mb-2 text-white">Verify it yourself</h3>
            <p className="dim text-[14px]">
              One command replays every receipt from genesis and recomputes each link. Live receipt table, four attestation bundles,
              tamper-and-detect. The agent console that drives the demo is in the Docs.
            </p>
            <div className="mono text-[12px] mt-4 inline-flex items-center gap-2" style={{ color: "var(--green)" }}>
              one click away{" "}
              <span style={{ width: 13, height: 13, display: "inline-grid", placeItems: "center" }}>
                <Icon name="arrow" size={13} />
              </span>
            </div>
          </a>
        </div>
      </section>
      <Footer />
    </>
  );
}

export { fmtTs };
