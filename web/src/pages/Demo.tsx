/* Cynex web, guided demo page.
   The five-step walkthrough of usecase-report-002, in order, with the
   real on-chain transactions. The refusal transactions below are the
   ones recorded for this obligation, verified from the chain: the
   recipient refusal, the amount refusal, the correct settle that wrote
   receipt 24, and the replay refusal. */

import { Footer } from "../components/shared";
import { CopyButton } from "../components/ui";

const TX_URL = "https://testnet.nearblocks.io/txns/";
const RECIPIENT_REFUSAL_TX = "EiBHjMBqZfBLZB33H4odbBfskGbVCX1Jor422t5S1cpX";
const AMOUNT_REFUSAL_TX = "2NaWqCYiUnh9DMhRCR6JVSDQ3R7yD26U8Auf3qEer91f";
const SETTLE_TX = "2VLL134m83x5fWZLr2qBbPkjJ7gL9YR7V7U9eur7qoVC";
const REPLAY_TX = "hG6uhpePR9ZcvCZXZprpXa8rvbAGGQPxD4ZyMpP91F6";

function TxLine({ k, tx }: { k: string; tx: string }) {
  return (
    <div className="txline">
      <span className="k">{k}</span>
      <a href={TX_URL + tx} target="_blank" rel="noopener">
        {tx}
      </a>
      <CopyButton text={tx} />
    </div>
  );
}

export function Demo({ anchor }: { anchor?: string }) {
  void anchor;
  return (
    <>
      <div className="page-hero">
        <div className="wrap">
          <p className="hero-tag">GUIDED DEMO · USECASE-REPORT-002 · NEAR TESTNET</p>
          <h1 className="page-line">
            One obligation.
            <br />
            Three refusals.
            <br />
            <span className="green">One payment.</span>
          </h1>
          <p className="hero-sub">
            A human authorizes a procurement agent to pay a research agent exactly for one named report. Follow the
            real sequence, in order. Every refusal and the one payment below happened on chain.
          </p>
          <div className="ticket">
            <div className="ticket-rows">
              <div className="trow">
                <div className="k">OBLIGATION</div>
                <div className="v">usecase-report-002</div>
              </div>
              <div className="trow">
                <div className="k">OUTCOME</div>
                <div className="v">Receipt 24 · PAID, after two refusals. A third refusal stops the replay.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="wrap">
        <div className="timeline">
          <div className="tstep">
            <div className="big">01</div>
            <div>
              <span className="pill created">CREATED</span>
              <h3>The obligation is created</h3>
              <p>
                A human authorizes a procurement agent to pay a research agent exactly for the named report. The
                evidence is the exact report artifact, committed by digest up front. Recipient, amount, token,
                evidence and budget are locked at this moment. The agent cannot edit them later.
              </p>
            </div>
          </div>
          <div className="tstep">
            <div className="big">02</div>
            <div>
              <span className="pill refused">REFUSED · 0 TOKENS MOVED</span>
              <h3>The agent tries to change the recipient</h3>
              <p>
                The settle request names a different recipient than the locked obligation. The vault compares the
                field, finds the substitution, and refuses. Nothing moves.
              </p>
              <div className="txline">
                <span className="k">ERROR</span>
                <span>ERR_RECIPIENT_SUBSTITUTION</span>
              </div>
              <TxLine k="TX" tx={RECIPIENT_REFUSAL_TX} />
            </div>
          </div>
          <div className="tstep">
            <div className="big">03</div>
            <div>
              <span className="pill refused">REFUSED · 0 TOKENS MOVED</span>
              <h3>The agent tries to change the amount to 200</h3>
              <p>
                The recipient is right this time, but the amount is not the locked amount. One field differs, so the
                whole request dies on the terms check.
              </p>
              <div className="txline">
                <span className="k">ERROR</span>
                <span>ERR_TERMS_MISMATCH</span>
              </div>
              <TxLine k="TX" tx={AMOUNT_REFUSAL_TX} />
            </div>
          </div>
          <div className="tstep">
            <div className="big">04</div>
            <div>
              <span className="pill paid">PAID · RECEIPT 24</span>
              <h3>The agent submits the correct evidence and settles</h3>
              <p>
                With the exact evidence and every field matching the locked obligation, the vault settles. This is the
                only step where money moves, and it writes receipt 24.
              </p>
              <div className="txline">
                <span className="k">RECEIPT</span>
                <span>24 · usecase-report-002 · PAID</span>
              </div>
              <TxLine k="TX" tx={SETTLE_TX} />
            </div>
          </div>
          <div className="tstep">
            <div className="big">05</div>
            <div>
              <span className="pill refused">REFUSED · 0 TOKENS MOVED</span>
              <h3>The agent tries to settle again: replay</h3>
              <p>
                The same obligation, presented a second time. The nonce was already consumed by receipt 24, so the
                vault refuses. An obligation pays once, never twice.
              </p>
              <div className="txline">
                <span className="k">ERROR</span>
                <span>ERR_NONCE_ALREADY_CONSUMED</span>
              </div>
              <TxLine k="TX" tx={REPLAY_TX} />
            </div>
          </div>
        </div>
        <p className="diagram-note" style={{ paddingBottom: "4rem" }}>
          That is the whole demo:{" "}
          <b style={{ color: "var(--ink)" }}>authorize once, refuse every change, pay exactly once.</b> Try the same
          attacks yourself on Break it.
        </p>
      </div>
      <Footer />
    </>
  );
}
