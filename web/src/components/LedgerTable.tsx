/* LedgerTable: the receipt chain, made visible. The spine between rows is
   the prev_hash link drawn as a rule, so the chain reads as a chain. */

import { hashToHex, type ReceiptRow } from "../lib/chain";
import { baseUnits, nsToUtc, shortHash, explorerAccount, explorerTx } from "../lib/format";
import { RECORD } from "../lib/record";
import { Grade, Skel, Unavailable } from "./ui";

const ACME_WARNING_FROM = 0;
const ACME_WARNING_TO = 6;

export function LedgerTable({ rows, loaded }: { rows: ReceiptRow[]; loaded: boolean }) {
  return (
    <>
      <p className="small">
        Frozen columns, exactly as the contract returns them. <Grade g="chain-read" /> receipts() on{" "}
        <a href={explorerAccount(RECORD.vaults.test)} target="_blank" rel="noreferrer">
          {RECORD.vaults.test}
        </a>
        . The spine between rows is each receipt's prev_hash, the link that makes this an audit trail and not a
        table.
      </p>
      <div className="ledger-wrap">
        <table className="ledger">
          <thead>
            <tr>
              <th>Index</th>
              <th>prev_hash</th>
              <th>Order</th>
              <th>Recipient</th>
              <th>Amount</th>
              <th>When (UTC)</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7}>{loaded ? <Unavailable what="receipts" /> : <Skel w={220} />}</td>
              </tr>
            )}
            {rows.map((r) => {
              const idx = Number(r.index);
              const acme = idx >= ACME_WARNING_FROM && idx <= ACME_WARNING_TO;
              return (
                <tr key={r.index}>
                  <td className="idx">{r.index}</td>
                  <td title={hashToHex(r.prev_hash)} className="td-mute">
                    {shortHash(hashToHex(r.prev_hash), 5, 3)}
                  </td>
                  <td>{r.obligation_id}</td>
                  <td className={acme ? "td-warn" : ""}>{shortHash(r.recipient, 14, 6)}</td>
                  <td>
                    {baseUnits(r.amount)} <span className="td-mute">base</span>
                  </td>
                  <td className="td-mute">{nsToUtc(r.timestamp)}</td>
                  <td>
                    {r.tx_ref ? (
                      /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(r.tx_ref) ? (
                        <a href={explorerTx(r.tx_ref)} target="_blank" rel="noreferrer">
                          {shortHash(r.tx_ref)}
                        </a>
                      ) : (
                        /* Demo rows carry a caller-supplied string here, not a
                           transaction hash. Linking it to the explorer would 404,
                           so it prints as data, with its nature on hover. */
                        <span className="td-mute" title="Caller-supplied label, not a transaction hash. Early demo receipt.">
                          {shortHash(r.tx_ref, 8, 4)}
                        </span>
                      )
                    ) : (
                      <span className="td-mute" title="The automatic settle path records no transaction hash. Disclosed, not hidden.">
                        none
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
