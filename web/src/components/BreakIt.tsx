/* Cynex web, try to break it.
   The form judges proposed terms against the authorized terms fixed on
   chain. The refusal it shows is the recorded one from the test vault,
   not a fresh live attempt from this click. It submits nothing and
   settles nothing. */

import { useState } from "react";
import { AUTHORIZED_TERMS, DEMO_ATTACKER } from "../lib/data";
import { evaluateBreakItForm, type BreakItFormOut } from "../lib/breakItForm";
import { CopyButton } from "./ui";

const TX_URL = "https://testnet.nearblocks.io/txns/";
const OBLIGATION_ID = "usecase-report-002";

function KvRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="kvbox">
      <div className="ofield">
        <span className="fk">{k}</span>
        <span className="fv">{v}</span>
      </div>
    </div>
  );
}

export function BreakIt() {
  const [formRecipient, setFormRecipient] = useState(DEMO_ATTACKER);
  const [formAmount, setFormAmount] = useState<string>(AUTHORIZED_TERMS.amount);
  const [formOut, setFormOut] = useState<BreakItFormOut | null>(null);

  const runFormAttack = () => {
    setFormOut(evaluateBreakItForm(formRecipient, formAmount, "terms"));
  };

  return (
    <div className="lab-grid">
      <div className="lab">
        <p className="sec-label">EDITABLE ATTACK FORM</p>
        <h3>Build your attack</h3>
        <p className="sub">
          Locked obligation: <span className="mono" style={{ color: "var(--ink)" }}>{OBLIGATION_ID}</span> ·
          recipient: <span className="mono" style={{ color: "var(--ink)" }}>{AUTHORIZED_TERMS.recipient}</span> ·
          amount: <span className="mono" style={{ color: "var(--ink)" }}>{AUTHORIZED_TERMS.amount}</span>. Edit a
          field, then try.
        </p>
        <label className="flab" htmlFor="atkRecipient">
          RECIPIENT IN YOUR REQUEST
        </label>
        <input
          className="finput"
          id="atkRecipient"
          type="text"
          value={formRecipient}
          onChange={(e) => {
            setFormRecipient(e.target.value);
            setFormOut(null);
          }}
          autoComplete="off"
        />
        <label className="flab" htmlFor="atkAmount">
          AMOUNT IN YOUR REQUEST
        </label>
        <input
          className="finput"
          id="atkAmount"
          type="text"
          inputMode="numeric"
          value={formAmount}
          onChange={(e) => {
            setFormAmount(e.target.value);
            setFormOut(null);
          }}
          autoComplete="off"
        />
        <button className="btn-attack" type="button" onClick={runFormAttack}>
          Try to settle &#8594;
        </button>
        {formOut ? (
          <div
            className={
              "result-box show" + (formOut.kind === "none" ? " ok" : formOut.kind === "invalid" ? " warn" : "")
            }
            role="status"
          >
            {formOut.kind === "refused" ? (
              <>
                <div className="rv">REFUSED</div>
                {formOut.code ? <div className="rc">{formOut.code}</div> : null}
                <p className="rn">{formOut.text}</p>
                {formOut.tx ? (
                  <div className="txline">
                    <span className="k">TX</span>
                    <a href={TX_URL + formOut.tx} target="_blank" rel="noopener">
                      {formOut.tx}
                    </a>
                    <CopyButton text={formOut.tx} />
                  </div>
                ) : null}
                <p className="rn">
                  0 tokens moved. This is the verdict the vault returned on chain for this attack. The form replays
                  the recorded verdict; it does not submit a transaction.
                </p>
              </>
            ) : formOut.kind === "none" ? (
              <>
                <div className="rv">NOTHING TO REFUSE</div>
                <p className="rn">{formOut.text}</p>
              </>
            ) : (
              <>
                <div className="rv">CHECK YOUR INPUT</div>
                <p className="rn">{formOut.text}</p>
              </>
            )}
          </div>
        ) : null}
      </div>
      <div className="lab">
        <p className="sec-label">WHY IT HOLDS</p>
        <h3>The agent can only ask</h3>
        <p className="sub">
          The agent is assumed compromised. It holds only a scoped settle key, so the worst it can do is present a
          request. The vault checks every field against the locked obligation, plus the budget and the replay state,
          before anything can move.
        </p>
        <KvRow k="RECIPIENT" v="Must match exactly" />
        <KvRow k="AMOUNT" v="Must match exactly" />
        <KvRow k="REPLAY" v="Nonce consumed once, then closed" />
        <p className="sub" style={{ marginTop: "1.2rem" }}>
          Leave both fields exactly as locked and there is nothing to refuse: that request is the one that settled as
          receipt 24.
        </p>
      </div>
    </div>
  );
}
