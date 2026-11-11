/* Cynex web, Home page.
   Hero first, then Judges start here, the scripted path, the numbers
   strip, the refusal dark band, how it works, what it is for, run it
   yourself, honest limits, and the Footer. */

import { AGENT2, USECASE } from "../lib/data";
import { useLive } from "../lib/live";
import { StripSection } from "../components/Strip";
import { LiveDemoButton } from "../components/LiveDemoButton";
import { RefusalPanel, RefusalCard, VerifyHome, Footer } from "../components/shared";
import { CmdBlock } from "../components/ui";

function JudgesSteps() {
  const { live: L } = useLive();
  const next = L.recTest.v;
  const count = L.recTest.v;
  const step = (no: string, time: string, title: string, body: React.ReactNode) => (
    <div className="panel p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="mono text-xs" style={{ color: "var(--accent-text)" }}>
          {no}
        </span>
        <span className="mono text-xs dim2">{time}</span>
      </div>
      <h3 className="text-lg mb-1 text-ink">{title}</h3>
      <p className="dim text-sm leading-relaxed">{body}</p>
    </div>
  );
  return (
    <section className="wrap mt-16">
      <h2 className="mono text-[13px] mb-4" style={{ letterSpacing: ".14em", textTransform: "uppercase", color: "var(--secondary)" }}>
        Judges, start here
      </h2>
      <div className="grid gap-4 md:grid-cols-3">
        {step(
          "01",
          "10 sec",
          "Run it live",
          <>
            <b className="text-ink">Do:</b> Press Run it live on Home (not yet proven live in this deployment).{" "}
            <b className="text-ink">See, once the live proof has run:</b> Receipt{" "}
            {next != null ? next : "the next"}, PAID, and a transaction hash.
          </>,
        )}
        {step(
          "02",
          "15 sec",
          "Try to break it",
          <>
            <b className="text-ink">Do:</b> Change the recipient or the amount on Break it. <b className="text-ink">See:</b> Refused,
            ERR_RECIPIENT_SUBSTITUTION, 0 tokens moved, tx AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S.
          </>,
        )}
        {step(
          "03",
          "30 to 60 sec",
          "Verify on chain",
          <>
            <b className="text-ink">Do:</b> Run <span className="mono text-[12px]">node frontend/dist-test/cli/cynex.js verify-live cynex-testvault.cynexmaster.testnet</span> on the test vault.{" "}
            <b className="text-ink">See:</b>{" "}
            {count != null ? (
              <>Every row verified_ok = true, {count} receipts, all ok.</>
            ) : L.recTest.err ? (
              <>Receipt count unavailable, retrying.</>
            ) : (
              <>Receipt count loading, verification pending.</>
            )}
          </>,
        )}
      </div>
    </section>
  );
}

function Layers() {
  const layer = (n: string, t: string, body: React.ReactNode) => (
    <div className="grid gap-2 md:grid-cols-[64px_1fr_1.1fr] py-6 border-t first:border-t-0 first:pt-0" style={{ borderColor: "var(--line)" }}>
      <span className="mono text-[13px]" style={{ color: "var(--accent-text)" }}>
        {n}
      </span>
      <h3 className="text-xl text-ink">{t}</h3>
      <p className="dim text-sm leading-relaxed">{body}</p>
    </div>
  );
  return (
    <section className="wrap mt-24">
      <div className="kicker mb-3">02&nbsp;&nbsp;How it works</div>
      <h2 className="text-2xl md:text-3xl mb-3">Three layers that trust each other nothing.</h2>
      <p className="dim text-sm leading-relaxed max-w-3xl">Anyone can claim a payment was legitimate. Cynex makes it checkable, in three independent places.</p>
      <div className="mt-8">
        {layer(
          "01",
          "On-chain integrity",
          <>
            The contract hashes the evidence itself and compares it to the digest committed at authorization.{" "}
            <b className="text-ink">Check: the code hash above matches the deployed vault.</b> The three codes a judge meets most are{" "}
            <span className="mono text-[13px]">ERR_RECIPIENT_SUBSTITUTION</span>,{" "}
            <span className="mono text-[13px]">ERR_TERMS_MISMATCH</span>, and{" "}
            <span className="mono text-[13px]">ERR_NONCE_ALREADY_CONSUMED</span>, all eleven are in{" "}
            <a href="#/docs/security" style={{ color: "var(--accent-text)" }}>
              Docs, security
            </a>
            .
          </>,
        )}
        {layer(
          "02",
          "TEE provenance",
          <>
            The evidence is fetched and hashed inside an attested enclave, and the quote binds what ran, what went in, and what came out.{" "}
            <b className="text-ink">Check: the quote is verified off chain through the OutLayer verifier.</b>
          </>,
        )}
        {layer(
          "03",
          "VRF anchor",
          <>
            Randomness is requested during execution and the vault verifies the signature on chain, bound to the pending request.{" "}
            <b className="text-ink">Check: no proof can be reattached to a different order.</b>
          </>,
        )}
      </div>
      <p className="mono text-xs dim2 mt-6">
        The VRF signature does not prove TEE execution. The vault does not verify the TDX quote on chain, by design. Verification is off chain, not part of the contract check.
      </p>
    </section>
  );
}

function UseCaseSection() {
  const cycle = (n: string, t: string, body: string) => (
    <div className="border-t-2 pt-4" style={{ borderColor: "var(--accent)" }}>
      <span className="mono text-xs" style={{ color: "var(--accent-text)" }}>
        {n}
      </span>
      <h3 className="text-base mt-2 mb-1 text-ink">{t}</h3>
      <p className="dim text-sm leading-relaxed">{body}</p>
    </div>
  );
  const fact = (big: string, label: string) => (
    <div>
      <div className="text-2xl font-medium text-ink">{big}</div>
      <div className="dim text-xs mt-1">{label}</div>
    </div>
  );
  return (
    <section className="wrap mt-24">
      <div className="kicker mb-3">03&nbsp;&nbsp;What it is for</div>
      <h2 className="text-2xl md:text-3xl mb-3">One named report. One exact payment. Nothing else.</h2>
      <p className="dim text-sm leading-relaxed max-w-3xl">
        A human authorizes a procurement agent to pay a research agent for one named report. The evidence is the exact report artifact,
        committed by digest. The same obligation runs through the console, the agent tools, the attack log, and the receipt.
      </p>
      <div className="grid gap-4 md:grid-cols-4 mt-8">
        {cycle("01", "Authorize", "A human fixes recipient, token, amount, evidence, and budget.")}
        {cycle("02", "Deliver", "The research agent delivers the named report.")}
        {cycle("03", "Prove", "Evidence is hashed and checked against the committed digest.")}
        {cycle("04", "Settle", "The vault pays exactly what the order says, once.")}
      </div>
      <div className="panel p-6 mt-8">
        <p className="dim text-sm leading-relaxed mb-1">
          Evidence is the exact report artifact committed by digest. The vault hashes the bytes itself and compares them to the digest, so a
          different report cannot release the payment.
        </p>
        <div className="mono text-xs mb-5" style={{ color: "var(--accent-text)", overflowWrap: "anywhere" }}>
          {USECASE.artifact} · {USECASE.artifactBytes} bytes · SHA-256 {USECASE.artifactDigest}
        </div>
        <div className="flex flex-wrap gap-8">
          {fact("100 base units", "Amount, fixed at authorization")}
          {fact("Receipt 24", "The correct settle, on the test vault")}
          {fact("4 refusals", "Settle before evidence, changed recipient, changed amount, replay")}
        </div>
      </div>
      <p className="mono text-xs dim2 mt-4">
        One account, cynex-agent, held both agent roles in the canonical run, so it proves the vault controls, not payment between two
        distinct accounts. The two-agent run is receipt 28.
      </p>
      <p className="dim text-[13px] mt-2">
        Full script: <span className="mono text-xs text-ink">docs/use-case-demo-script.md</span>. The research agent in the two-agent run is
        a real second account, {AGENT2}, created 2026-11-08.
      </p>
    </section>
  );
}

export function Home() {
  return (
    <>
      <section className="wrap pt-12 md:pt-24 relative">
        <div className="relative grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-12 items-start">
          <div className="min-w-0">
            <div className="kicker mb-5">Purpose-bound settlement vault · NEAR testnet</div>
            <p className="conflict">The agent asked. The vault said no.</p>
            <h1 className="hero-h">
              Pay the obligation.
              <br />
              Not the prompt<span className="hero-period">.</span>
            </h1>
            <p className="mt-6 text-base leading-relaxed dim max-w-xl">
              Cynex lets a human authorize one exact payment, then the vault pays only that payment and refuses everything else.
            </p>
            <div className="mt-8">
              <LiveDemoButton
                variant="hero"
                actions={
                  <a className="btn ghost" href="#/attack">
                    Break it yourself
                  </a>
                }
              />
            </div>
            <div className="mono text-xs dim2 mt-4">No wallet. No sign up. About 60 seconds, start to finish.</div>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <RefusalCard />
          </div>
        </div>
      </section>

      <JudgesSteps />

      <section className="wrap mt-16">
        <div className="panel p-6">
          <div className="kicker mb-3">Scripted path · one named example</div>
          <h2 className="text-2xl md:text-3xl mb-3">Start with the proof that is already on chain.</h2>
          <p className="dim text-sm leading-relaxed max-w-3xl mb-5">
            <b className="text-ink">Open Proof, find receipt 24, usecase-report-002. You will see four refusals, then the correct settle,
            PAID.</b>{" "}
            Four refusals first, then the exact payment the human authorized, for one named report.
          </p>
          <a className="btn btn-primary" href="#/proof">
            Open Proof, receipt 24
          </a>
        </div>
      </section>

      <StripSection />

      <RefusalPanel />

      <Layers />

      <UseCaseSection />

      <section className="wrap mt-24">
        <div className="kicker mb-3">04&nbsp;&nbsp;Run it yourself</div>
        <h2 className="text-2xl md:text-3xl mb-3">Two commands. No wallet. No account.</h2>
        <p className="dim text-sm leading-relaxed max-w-3xl mb-5">
          The local demo runs the real vault in a sandbox on your machine. The verify command replays the live testnet record from genesis.
        </p>
        <div className="mb-3">
          <div className="mono text-xs dim2 mb-2">Local demo, MCP server over stdio</div>
          <CmdBlock cmdKey="mcpdemo" />
        </div>
        <div className="mono text-xs dim2 mb-2 mt-5">Verify the live testnet record</div>
        <VerifyHome />
        <p className="mono text-xs dim2 mt-5">The verify command reads the NEAR testnet record. The MCP demo runs locally in a sandbox. Nothing here spends real funds, and nothing here needs your keys.</p>
      </section>

      <section className="wrap mt-24">
        <div className="kicker mb-3">05&nbsp;&nbsp;Honest limits</div>
        <h2 className="text-2xl md:text-3xl mb-3">What Cynex does not do.</h2>
        <p className="dim text-sm leading-relaxed max-w-3xl mb-5">The limits, stated on the page, not buried in a file.</p>
        <ul className="space-y-2.5 dim text-sm leading-relaxed max-w-3xl" style={{ listStyle: "disc", paddingLeft: 20 }}>
          <li>
            <b className="text-ink">The VRF signature does not prove TEE execution.</b> It proves determinism and binding to the pending
            request. That link must never be claimed.
          </li>
          <li>
            <b className="text-ink">The vault does not verify the TDX quote on chain.</b> The quote is verified off chain, by design, not as
            part of the contract check.
          </li>
          <li>
            <b className="text-ink">Testnet only, fake testnet USDC with no value.</b> No mainnet deployment, no mainnet spending.
          </li>
          <li>
            <b className="text-ink">One account held both agent roles in the canonical run.</b> Receipt 24 proves the vault controls, not
            payment between two distinct accounts. The two-agent run is receipt 28.
          </li>
          <li>
            <b className="text-ink">The Run it live button is built but not yet proven live.</b> No live settle has been run from it yet,
            because the preview deployment cannot see the demo key. The first live settle will be recorded on this page with its transaction
            hash.
          </li>
        </ul>
      </section>

      <Footer />
    </>
  );
}
