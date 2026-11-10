/* A live obligation receipt. The hero artifact: Cynex settles an obligation
   and issues a receipt. This one is read live from the vault on render, so
   every field is real chain state, not a mock. If the read is slow it shows a
   skeleton, and if it fails it says so. Nothing here is staged. */

import { useEffect, useState } from "react";
import { getObligation, type ObligationView } from "../lib/chain";
import { RECORD } from "../lib/record";
import { baseUnits, shortHash, explorerAccount, explorerTx } from "../lib/format";
import { Logo } from "./brand";
import { GradeBadge, Chip, Skel, Unavailable } from "./ui";
import { LiveStamp } from "./LiveStamp";

export function LiveReceipt() {
  const [o, setO] = useState<ObligationView | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    getObligation(RECORD.vaults.test, RECORD.obligation.id).then((row) => {
      if (!alive) return;
      setO(row);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="receipt">
      <div className="receipt-top">
        <div className="receipt-brand">
          <Logo size={24} />
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            obligation
          </div>
          <div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>
            {RECORD.obligation.id}
          </div>
        </div>
      </div>

      <div className="receipt-rows">
        <Row k="recipient">
          {o ? (
            <a href={explorerAccount(o.recipient)} target="_blank" rel="noreferrer">
              {shortHash(o.recipient, 14, 6)}
            </a>
          ) : loaded ? (
            <Unavailable what="obligation" />
          ) : (
            <Skel w={120} />
          )}
        </Row>
        <Row k="amount">
          {o ? <>{baseUnits(o.amount)} <span className="muted">test tokens</span></> : <Skel w={80} />}
        </Row>
        <Row k="nonce">{o ? <>{o.nonce}, pays once</> : <Skel w={60} />}</Row>
        <Row k="evidence">{o ? o.evidence_type : <Skel w={70} />}</Row>
        <Row k="policy">{o ? o.policy_id : <Skel w={60} />}</Row>
        <Row k="state">
          {o ? (
            <span className={o.state === "PAID" ? "pos" : ""}>{o.state}</span>
          ) : (
            <Skel w={50} />
          )}
        </Row>
      </div>

      <div className="receipt-total">
        <div>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            authorized total
          </div>
          <div className="t-v">{o ? baseUnits(o.amount) : <Skel w={80} />}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <GradeBadge g="chain-read" />
        </div>
      </div>

      <div className="receipt-sig">
        <span className="mono" style={{ maxWidth: "60%" }}>
          terms fixed on chain · settle checks recipient, amount, nonce, evidence, budget
        </span>
        <LiveStamp label="obligation" />
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="receipt-row">
      <span className="r-k">{k}</span>
      <span className="r-v">{children}</span>
    </div>
  );
}
