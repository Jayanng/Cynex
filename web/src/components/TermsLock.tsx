/* TermsLock: the order the vault will not let anyone move. Rendered from a
   live obligation read, so the judge sees the real terms under attack. */

import { RECORD } from "../lib/record";
import { explorerAccount } from "../lib/format";
import type { ObligationView } from "../lib/chain";
import { Grade, Skel, Unavailable } from "./ui";

/* Fallback shape matches ObligationView so the two states share one render.
   These are record facts, not live reads, and the chip says which is which. */
const FALLBACK: ObligationView = {
  obligation_id: RECORD.obligation.id,
  policy_id: RECORD.policy,
  policy_version: 1,
  recipient: RECORD.obligation.recipient,
  amount: RECORD.obligation.amount,
  evidence_type: RECORD.obligation.evidenceType,
  evidence_hash: [],
  expires_at_ns: "0",
  nonce: RECORD.obligation.nonce,
  state: "PAID",
  in_flight: false,
  transfer_attempt: 0,
};

export function TermsLock({ obligation, loaded }: { obligation: ObligationView | null; loaded: boolean }) {
  const o = obligation ?? FALLBACK;
  const live = obligation !== null;
  return (
    <section className="termslock" aria-label="Fixed terms of the obligation">
      <div className="termslock-head">
        <span className="lockglyph" aria-hidden="true">
          ▪▪
        </span>
        <span>The order, fixed on chain</span>
        <span style={{ marginLeft: "auto" }}>
          {live ? <Grade g="chain-read" /> : loaded ? <Unavailable what="obligation" /> : <Skel w={80} />}
        </span>
      </div>
      <dl className="termslock-grid">
        <div className="term">
          <dt>Order</dt>
          <dd>{o.obligation_id}</dd>
        </div>
        <div className="term">
          <dt>
            <span className="lockglyph" aria-hidden="true">
              ▪
            </span>
            Recipient
          </dt>
          <dd>
            <a href={explorerAccount(o.recipient)} target="_blank" rel="noreferrer">
              {o.recipient}
            </a>
          </dd>
        </div>
        <div className="term">
          <dt>
            <span className="lockglyph" aria-hidden="true">
              ▪
            </span>
            Amount
          </dt>
          <dd>
            {o.amount} base units
            <br />
            <span className="small">(0.0001 test tokens)</span>
          </dd>
        </div>
        <div className="term">
          <dt>
            <span className="lockglyph" aria-hidden="true">
              ▪
            </span>
            Nonce
          </dt>
          <dd>{o.nonce}, pays once</dd>
        </div>
        <div className="term">
          <dt>Evidence</dt>
          <dd>{o.evidence_type}</dd>
        </div>
        <div className="term">
          <dt>State</dt>
          <dd>{o.state}</dd>
        </div>
      </dl>
    </section>
  );
}
