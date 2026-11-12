/* Cynex web, home page.
   Dark console redesign: the conflict first, the refusal ticket under
   it, the live strip, the obligation diagram, the proven-live line,
   how it works, honest limits, and the MCP section. No standalone Run
   it live block here: the live action lives on Break it. The obligation
   values are the real usecase-report-002 terms, read live from the test
   vault and confirmed in docs/use-case-demo-script.md. */

import { StripSection } from "../components/Strip";
import { Footer } from "../components/shared";
import { CopyButton } from "../components/ui";

const REFUSAL_TX = "EiBHjMBqZfBLZB33H4odbBfskGbVCX1Jor422t5S1cpX";
const PROVEN_TX = "D7aRDckcLkt4FghZUGpAkrCLx677NAVjPYrWUvTM2EJe";
const DIGEST = "2a8bddcb3b001fd9051ec68757b8a113fa355cfe619f07882ac622721431ebc9";
const RECIPIENT = "cynex-agent.cynexmaster.testnet";
const TX_URL = "https://testnet.nearblocks.io/txns/";

function CheckIcon() {
  return (
    <svg className="check" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="#3ED97A" strokeWidth="2" />
      <path d="M8 12.5l2.6 2.6L16 9.5" stroke="#3ED97A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg className="check" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="#FF4A3D" strokeWidth="2" />
      <path d="M9 9l6 6M15 9l-6 6" stroke="#FF4A3D" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function OField({ k, v, sub, bad }: { k: string; v: React.ReactNode; sub?: string; bad?: boolean }) {
  return (
    <div className={"ofield" + (bad ? " bad" : "")}>
      <span className="fk">{k}</span>
      <span className="fv">
        {v}
        {sub ? <small>{sub}</small> : null}
      </span>
      {bad ? <CrossIcon /> : <CheckIcon />}
    </div>
  );
}

export function Home() {
  return (
    <>
      <div className="hero">
        <div className="wrap">
          <p className="hero-tag">CYNEX · PURPOSE-BOUND SETTLEMENT VAULT · NEAR TESTNET</p>
          <h1 className="hero-line">
            The agent asked.
            <br />
            The vault said <span className="no">no.</span>
          </h1>
          <p className="hero-sub">
            A human fixes the terms: <strong>recipient, amount, token, evidence, budget</strong>. The agent can only
            ask. When the ask changes one field, the vault refuses on chain and <strong>no money moves</strong>. This
            refusal already happened:
          </p>

          <div className="ticket" role="group" aria-label="On-chain refusal record">
            <div className="ticket-head">
              <span className="verdict">REFUSED</span>
              <span className="code">ERR_RECIPIENT_SUBSTITUTION</span>
              <div className="moved">
                <div className="n">0</div>
                <div className="l">TOKENS MOVED</div>
              </div>
            </div>
            <div className="ticket-rows">
              <div className="trow">
                <div className="k">OBLIGATION</div>
                <div className="v">usecase-report-002</div>
              </div>
              <div className="trow">
                <div className="k">TRANSACTION</div>
                <div className="v">
                  <a href={TX_URL + REFUSAL_TX} target="_blank" rel="noopener">
                    {REFUSAL_TX}
                  </a>
                  <CopyButton text={REFUSAL_TX} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <StripSection />

      <section className="block" id="diagram">
        <div className="wrap">
          <p className="sec-label">THE MECHANISM, IN ONE GLANCE</p>
          <h2 className="sec-title">One field changed. Everything stops.</h2>
          <p className="sec-lede">
            An obligation is a locked card, not a prompt. The vault compares every field of a settle request against
            the card the human authorized. <strong>One mismatch and the request dies.</strong>
          </p>

          <div className="diagram">
            <div className="ocard">
              <div className="ocard-head">
                <span className="obadge lock">LOCKED BY HUMAN</span>
                <span className="id">usecase-report-002</span>
              </div>
              <OField k="RECIPIENT" v={RECIPIENT} sub="The named payee, fixed at authorization" />
              <OField k="AMOUNT" v="100" sub="Exact amount, not a range" />
              <OField k="TOKEN" v="usdc.fakes.testnet" sub="The one token, substitutes do not settle" />
              <OField k="EVIDENCE" v={DIGEST} sub="Committed digest of the report artifact" />
              <OField k="BUDGET" v="10000" sub="Policy p6-001 cap, never exceeded" />
            </div>

            <div className="gate" aria-hidden="true">
              <div className="gt">
                SETTLE REQUEST<b>EVERY FIELD CHECKED</b>
              </div>
              <div className="arrow">&#8594;</div>
              <div className="gate-box">VAULT</div>
              <div className="arrow">&#8594;</div>
              <div className="gt">
                MISMATCH<b>NO PAYMENT</b>
              </div>
            </div>

            <div className="ocard">
              <div className="ocard-head">
                <span className="obadge atk">AGENT REQUEST</span>
                <span className="id">settle attempt</span>
              </div>
              <OField
                k="RECIPIENT"
                v={
                  <>
                    cynexmaster.testnet<span className="was">was: {RECIPIENT}</span>
                  </>
                }
                bad
              />
              <OField k="AMOUNT" v="100" sub="Unchanged" />
              <OField k="TOKEN" v="usdc.fakes.testnet" sub="Unchanged" />
              <OField k="EVIDENCE" v={DIGEST} sub="Unchanged" />
              <OField k="BUDGET" v="10000" sub="Unchanged" />
              <div className="stamp">REFUSED</div>
            </div>
          </div>

          <p className="diagram-note">
            Verdict on chain: <b>ERR_RECIPIENT_SUBSTITUTION</b> · tx{" "}
            <a href={TX_URL + REFUSAL_TX} target="_blank" rel="noopener" className="mono">
              {REFUSAL_TX}
            </a>{" "}
            · 0 tokens moved. The agent is assumed compromised. It holds only a scoped settle key, so the worst it can
            do is ask.
          </p>
        </div>
      </section>

      <div className="proven-line">
        <div className="wrap">
          <span className="pl-k">PROVEN LIVE</span>
          <span>
            Receipt 35 · demo-live-005 · <strong>PAID</strong> · tx <span className="mono">{PROVEN_TX}</span> ·
            block 277362593
          </span>
          <a href="#/attack/run" className="pl-link">
            Run it live on Break it &#8594;
          </a>
        </div>
      </div>

      <section className="block" id="how">
        <div className="wrap">
          <p className="sec-label">HOW IT WORKS</p>
          <h2 className="sec-title">Three steps. No trust in the agent.</h2>
          <div className="hwsteps">
            <div className="hwstep">
              <div className="num">01</div>
              <h3>The human authorizes</h3>
              <p>
                One obligation, fixed terms: recipient, amount, token, the evidence digest, and a budget. Once
                created, the terms cannot be edited by the agent.
              </p>
            </div>
            <div className="hwstep">
              <div className="num">02</div>
              <h3>The agent requests</h3>
              <p>
                The agent holds a scoped key that can only call <span className="mono">settle</span>. It can ask for
                payment against the obligation. It cannot change what it asks for without the vault seeing it.
              </p>
            </div>
            <div className="hwstep">
              <div className="num">03</div>
              <h3>The vault decides</h3>
              <p>
                Every field is checked against the locked card, plus the budget and replay state. Exact match:{" "}
                <span className="mono" style={{ color: "var(--green)" }}>
                  PAID
                </span>
                , with a receipt. Anything else:{" "}
                <span className="mono" style={{ color: "var(--red)" }}>
                  REFUSED
                </span>
                , and nothing moves.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="block" id="mcp" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="split">
            <div className="limits">
              <p className="sec-label">HONEST LIMITS</p>
              <h2 className="sec-title" style={{ fontSize: "clamp(1.7rem,3.4vw,2.4rem)" }}>
                What Cynex does not claim
              </h2>
              <ul>
                <li>
                  <span>
                    <strong>The vault checks terms, not the caller.</strong> Safety comes from the fixed terms, the
                    budget, and the scoped settle key, never from trusting who asks.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>TEE quotes are verified off chain.</strong> The vault does not verify the attestation
                    quote on chain. That is by design, and it is stated plainly.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>VRF is not TEE proof.</strong> The VRF signature proves determinism and binding to a
                    pending request. It does not prove TEE execution, and Cynex does not claim it does.
                  </span>
                </li>
              </ul>
            </div>
            <div className="mcp">
              <p className="sec-label">FOR AGENTS · MCP</p>
              <h2 className="sec-title" style={{ fontSize: "clamp(1.7rem,3.4vw,2.4rem)" }}>
                Drive the vault from your agent
              </h2>
              <div className="mcpfacts">
                <div>
                  <div className="n">6</div>
                  <div className="l">
                    TOOLS,
                    <br />
                    STDIO ONLY
                  </div>
                </div>
                <div>
                  <div className="n">1</div>
                  <div className="l">
                    MOVES FUNDS:
                    <br />
                    SETTLE
                  </div>
                </div>
                <div>
                  <div className="n">5</div>
                  <div className="l">
                    READ OR
                    <br />
                    PREPARE ONLY
                  </div>
                </div>
              </div>
              <p>
                The MCP server exposes the vault over stdio. <strong>Only one of the six tools can move funds</strong>
                , and it still has to pass every vault check on chain. Start it against a local sandbox:
              </p>
              <div className="termcmd">
                <span className="prompt">$</span> npx cynex-mcp --sandbox
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </>
  );
}
