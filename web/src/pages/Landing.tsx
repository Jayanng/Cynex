/* Cynex web — Landing page.
   Refusal first, then the hero, the live strip, the trust row, one verify
   command, try-to-break-it, one live proof, the three layers, the trust
   model, and the calls to action. */

import { useEffect } from "react";
import { AGENT, VAULT_TEST } from "../lib/data";
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
        <span className="mono text-[10px] tracking-[.18em] uppercase dim2">latest settle — live read</span>
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
            <div className="mono text-[11px] dim2 mt-4">no login · no wallet · every hash opens in the explorer</div>
          </div>
          <div className="panel fadein" data-live-region="latest" style={{ minHeight: 220 }}>
            <LatestSettle />
          </div>
        </div>
      </section>

      <StripSection />
      <TrustRow />
      <VerifyLanding />
      <BreakIt />

      {/* One live proof */}
      <section className="wrap mt-14">
        <div className="panel p-6 md:p-8">
          <div className="flex flex-wrap items-center gap-3 mb-1">
            <span className="kicker">One live proof</span>
          </div>
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <h2 className="text-2xl md:text-3xl">
              A correct settle — <span style={{ color: "var(--green)" }}>PAID</span>
            </h2>
            <Badge value="PAID" />
          </div>
          <p className="dim text-[14px] max-w-3xl leading-relaxed mb-5">
            Step 2: after the vault refused a substituted recipient and an inflated amount, the correct settle of obligation{" "}
            <span className="mono text-[13px] text-white">p10-demo-attack-001</span> went through — 100 USDC to{" "}
            <AcctChip account={AGENT} /> — and wrote receipt #12 to the hash chain.
          </p>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <span className="mono text-[11px] dim2 uppercase tracking-widest">settle tx</span>
            <HashChip hash="Ho97UjQEDDfe7Go66uHrVSJvbF8narZJ2YBH3hWarxi" />
            <span className="mono text-[11px] dim2">receipt #12 · {VAULT_TEST}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn sm" onClick={() => void run(12)}>
              Read receipt #12 from chain — now
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
            t="On-chain enforcement"
            body="Recipient, amount, token, obligation id, nonce, budget and expiry are checked by the contract at settle time. Six refusal codes, no discretion."
            extra={
              <div className="flex flex-wrap gap-1.5 mt-3">
                {["RECIPIENT_SUBSTITUTION", "TERMS_MISMATCH", "NONCE_ALREADY_CONSUMED", "BUDGET_EXCEEDED", "OBLIGATION_EXPIRED", "POLICY_FROZEN"].map(
                  (c) => (
                    <span key={c} className="codechip" style={{ fontSize: 10 }}>
                      {c}
                    </span>
                  )
                )}
              </div>
            }
            linktxt="Live example: wrong recipient refused"
            href="#/demo/guided/step2"
          />
          <Layer
            n="02"
            t="Evidence — before settle"
            body="PREIMAGE: the SHA-256 of the delivery artifact. TEE: verification via OutLayer, with a VRF signature bound to the pending request."
            extra={
              <div className="mono text-[11.5px] dim mt-3">
                OutLayer request <span className="text-white">11912</span> · 300 TGas
              </div>
            }
            linktxt="Live example: TEE settle, receipt #13"
            href="#/demo/guided/step3"
          />
          <Layer
            n="03"
            t="Reputation gate"
            body="Five signals scored before any settle: account_existence, account_age, prior_vault_interactions, blocklist, code_change_recency. BLOCK names the signal and its source. WARN escalates unless CYNEX_APPROVE_WARN=1."
            extra={
              <div className="mt-3">
                <Badge value="BLOCKED" extra="code_change_recency" />
              </div>
            }
            linktxt="The gate moment"
            href="#/demo/guided/gate"
          />
        </div>
      </section>

      {/* Trust model */}
      <section className="wrap mt-16">
        <div className="panel p-6 md:p-8" style={{ borderColor: "rgba(251,191,36,.25)" }}>
          <div className="kicker mb-3" style={{ color: "var(--amber)" }}>
            Trust model
          </div>
          <div className="grid md:grid-cols-2 gap-x-10 gap-y-3 text-[14px] leading-relaxed dim">
            {[
              "The contract is the decision-maker. The agent proposes; the vault disposes. Terms are fixed at obligation creation — settle only checks them.",
              "Funding enters only via ft_transfer_call. Evidence is required before settle: a SHA-256 preimage of the delivery artifact, or TEE verification via OutLayer.",
              "Every settle writes a hash-chained receipt (NEP-297). Anyone can replay the chain from genesis — tamper with receipt i and it is detected at i+1.",
              "NEAR function-call keys restrict which methods an agent key may call — they do not restrict the arguments. That gap is exactly what Cynex closes.",
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
            The VRF signature does not prove TEE execution.
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
              The full demo run — happy path, refused attacks, TEE settle, verification — every step with its real tx hash and a live chain
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
              tamper-and-detect.
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
