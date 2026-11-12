/* Cynex web, Break it page.
   The attack lab: an editable form that replays the recorded refusal,
   the three recorded attacks, the Run it live section, and the tamper
   panel. The header Run it live button lands here at #run. */

import { useEffect } from "react";
import { BreakIt } from "../components/BreakIt";
import { LiveDemoButton } from "../components/LiveDemoButton";
import { TamperPanel } from "../components/TamperPanel";
import { Footer } from "../components/shared";
import { CopyButton } from "../components/ui";
import { VAULT_TEST } from "../lib/data";
import { AccountLink, TxLink } from "../lib/links";

const PROVEN_TX = "BgvVNfX7CL2FoqR9dS6HLjdHRgedKXfsAUeLp2jhLvM2";

const RECORDED = [
  {
    title: "Recipient changed",
    code: "ERR_RECIPIENT_SUBSTITUTION",
    tx: "EiBHjMBqZfBLZB33H4odbBfskGbVCX1Jor422t5S1cpX",
  },
  {
    title: "Amount changed to 200",
    code: "ERR_TERMS_MISMATCH",
    tx: "2NaWqCYiUnh9DMhRCR6JVSDQ3R7yD26U8Auf3qEer91f",
  },
  {
    title: "Replay: settle the same obligation again",
    code: "ERR_NONCE_ALREADY_CONSUMED",
    tx: "hG6uhpePR9ZcvCZXZprpXa8rvbAGGQPxD4ZyMpP91F6",
  },
  {
    title: "Settle before evidence",
    code: "ERR_INVALID_STATE",
    tx: "BRXXhezVxYvze3imNHkrShnS8ujUvsShy4f3GtgwpCgQ",
  },
];

export function Attack({ anchor }: { anchor?: string }) {
  useEffect(() => {
    if (anchor === "run") {
      const el = document.getElementById("run");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [anchor]);

  return (
    <>
      <div className="page-hero">
        <div className="wrap">
          <p className="hero-tag">BREAK IT · THE ATTACK LAB</p>
          <h1 className="page-line">
            You try to break it.
            <br />
            <span className="red">The vault refuses.</span>
          </h1>
          <p className="hero-sub">
            Pick one of six live attacks below and try to settle. <strong>Any change from the locked terms is
            refused.</strong> The form submits your attempt to the test vault on chain, and the vault answers with a
            real verdict and a real transaction hash.
          </p>
        </div>
      </div>
      <div className="wrap">
        <BreakIt />
        <section className="block" style={{ paddingBottom: "2rem" }}>
          <p className="sec-label">RECORDED ATTACKS · ON CHAIN</p>
          <h2 className="sec-title" style={{ fontSize: "clamp(1.9rem,4vw,3rem)" }}>
            These four already happened
          </h2>
          <p className="sec-lede">
            All four are on the same obligation, <AccountLink account={VAULT_TEST} title="view the vault account on NearBlocks">usecase-report-002</AccountLink>.
          </p>
          <div className="attack-list">
            {RECORDED.map((a) => (
              <div className="attack-card" key={a.tx}>
                <span className="pill refused">REFUSED</span>
                <h4>{a.title}</h4>
                <p className="mono" style={{ fontSize: ".85rem" }}>
                  {a.code} · 0 tokens moved
                </p>
                <div className="txline">
                  <span className="k">TX</span>
                  <TxLink hash={a.tx}>{a.tx}</TxLink>
                  <CopyButton text={a.tx} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section
        className="block run"
        id="run"
        style={{ paddingTop: "clamp(3.5rem,7vw,5.5rem)", paddingBottom: "clamp(3.5rem,7vw,5.5rem)" }}
      >
        <div className="wrap">
          <div className="run-inner">
            <div>
              <p className="sec-label">DO NOT TAKE OUR WORD FOR IT</p>
              <h2 className="sec-title">Run it live.</h2>
              <p className="sec-lede" style={{ marginBottom: "2rem" }}>
                One click settles the next ready demo obligation on testnet, on its locked terms, and writes a real
                receipt.
              </p>
              <LiveDemoButton />
              <p className="sec-lede" style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
                Rate limit: 1 settle per minute, 5 per hour, per IP. A second click while one is in flight is
                ignored, and a faster repeat returns 429 with a Retry-After.
              </p>
            </div>
            <div className="proven">
              <div className="ph">
                <span className="paid">PAID</span>
                <span className="oid">Already proven live · <TxLink hash={PROVEN_TX} title="vault receipt number 38, settle transaction">receipt 38</TxLink></span>
              </div>
              <dl>
                <div className="row">
                  <dt>OBLIGATION</dt>
                  <dd><AccountLink account={VAULT_TEST} title="view the vault account on NearBlocks">demo-live-008</AccountLink> · settled</dd>
                </div>
                <div className="row">
                  <dt>RECEIPT</dt>
                  <dd><TxLink hash={PROVEN_TX} title="vault receipt number 38, settle transaction">38</TxLink> · PAID</dd>
                </div>
                <div className="row">
                  <dt>TRANSACTION</dt>
                  <dd>
                    <TxLink hash={PROVEN_TX}>{PROVEN_TX}</TxLink>
                  </dd>
                </div>
                <div className="row">
                  <dt>BLOCK</dt>
                  <dd>277403330</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </section>

      <div className="wrap">
        <section className="block" style={{ paddingTop: "1rem" }}>
          <p className="sec-label">TAMPER AND DETECT</p>
          <h2 className="sec-title" style={{ fontSize: "clamp(1.9rem,4vw,3rem)" }}>
            Edit a receipt. The chain breaks.
          </h2>
          <p className="sec-lede">
            Receipts are linked: each receipt carries the hash of the one before it. Change the amount on receipt 24
            below and the link into the next receipt no longer matches. The verifier flags it. Try putting{" "}
            <strong>100</strong> back.
          </p>
          <TamperPanel id="break" />
        </section>
      </div>
      <Footer />
    </>
  );
}
