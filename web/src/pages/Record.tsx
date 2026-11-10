/* Record. The audit trail: the full enforcement matrix, the receipts ledger
   from genesis, the attestation bundles, and the errata. Every number graded. */

import { useLive } from "../lib/live";
import { RECORD } from "../lib/record";
import { ENFORCEMENT, ERROR_CODE_TOTAL, SETTLE_REACHABLE_CODES, REP_SIGNALS } from "../lib/features";
import { baseUnits, nsToUtc, shortHash, explorerTx, explorerAccount } from "../lib/format";
import { hashToHex, type ReceiptRow } from "../lib/chain";
import { Chip, CommandBlock, Errata, GradeBadge, Panel, Stat, Unavailable } from "../components/ui";

export function RecordPage() {
  const live = useLive();
  const rows: ReceiptRow[] = live.receiptsTest;

  return (
    <section className="section" style={{ paddingTop: 48 }}>
      <div className="wrap">
        <div className="section-head">
          <p className="kicker">the record · receipts from genesis</p>
          <h2 className="section-title">The books are open.</h2>
          <p className="section-lead">
            Nothing here asks for trust. One command replays the whole receipt chain and recomputes every hash
            link. The table below is the same data, read live in your browser right now.
          </p>
        </div>

        <div className="grid grid-4" style={{ marginBottom: 28 }}>
          <Stat value={ERROR_CODE_TOTAL} label="error codes defined" />
          <Stat value={SETTLE_REACHABLE_CODES} label="reachable through settle" tone="var(--accent-ink)" />
          <Stat value={ENFORCEMENT.length} label="enforcement checks" />
          <Stat value={live.receiptsTest.length || "…"} label="receipts on chain" tone="var(--pos-ink)" />
        </div>

        {/* enforcement matrix */}
        <h3 className="stat-label" style={{ fontSize: 13, marginBottom: 12 }}>the full enforcement matrix</h3>
        <div className="table-wrap" style={{ marginBottom: 32 }}>
          <table className="data">
            <thead>
              <tr>
                <th>check</th>
                <th>error code</th>
                <th>what settle does</th>
              </tr>
            </thead>
            <tbody>
              {ENFORCEMENT.map((e) => (
                <tr key={e.id}>
                  <td className="td-ink">{e.name}</td>
                  <td className="td-neg">{e.code}</td>
                  <td>{e.check}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* reputation signals reference */}
        <h3 className="stat-label" style={{ fontSize: 13, marginBottom: 12 }}>the five reputation signals</h3>
        <div className="table-wrap" style={{ marginBottom: 32 }}>
          <table className="data">
            <thead>
              <tr>
                <th>signal</th>
                <th>source</th>
                <th>block rule</th>
              </tr>
            </thead>
            <tbody>
              {REP_SIGNALS.map((s) => (
                <tr key={s.id}>
                  <td className="td-ink">{s.name}</td>
                  <td>{s.source}</td>
                  <td>{s.blockRule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* receipts ledger */}
        <div className="spread" style={{ marginBottom: 12 }}>
          <h3 className="stat-label" style={{ fontSize: 13, margin: 0 }}>receipt chain · {RECORD.vaults.test}</h3>
          <Chip value={RECORD.vaults.test} href={explorerAccount(RECORD.vaults.test)} label="explorer" />
        </div>
        <div className="table-wrap" style={{ marginBottom: 32 }}>
          <table className="data">
            <thead>
              <tr>
                <th>index</th>
                <th>prev_hash</th>
                <th>order</th>
                <th>recipient</th>
                <th>amount</th>
                <th>when (UTC)</th>
                <th>tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7}>{live.checkedAt ? <Unavailable what="receipts" /> : <span className="skel" style={{ width: 220 }} />}</td>
                </tr>
              )}
              {rows.map((r) => {
                const idx = Number(r.index);
                const acme = idx <= 6;
                return (
                  <tr key={r.index}>
                    <td className="td-ink">{r.index}</td>
                    <td title={hashToHex(r.prev_hash)}>{shortHash(hashToHex(r.prev_hash), 5, 3)}</td>
                    <td>{r.obligation_id}</td>
                    <td className={acme ? "td-warn" : ""}>{shortHash(r.recipient, 12, 5)}</td>
                    <td>{baseUnits(r.amount)}</td>
                    <td>{nsToUtc(r.timestamp)}</td>
                    <td>
                      {r.tx_ref ? (
                        /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(r.tx_ref) ? (
                          <a href={explorerTx(r.tx_ref)} target="_blank" rel="noreferrer">{shortHash(r.tx_ref)}</a>
                        ) : (
                          <span className="muted" title="caller-supplied label, not a tx hash. early demo receipt.">{shortHash(r.tx_ref, 8, 4)}</span>
                        )
                      ) : (
                        <span className="muted" title="the automatic settle path records no tx hash. disclosed, not hidden.">none</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* attestation bundles */}
        <h3 className="stat-label" style={{ fontSize: 13, marginBottom: 12 }}>attestation bundles, filed</h3>
        <div className="grid grid-4" style={{ marginBottom: 28 }}>
          {RECORD.attestations.map((a) => (
            <Panel key={a.bundle} title={`request ${a.request}`}>
              <div className="row" style={{ gap: 8, marginBottom: 10 }}>
                <GradeBadge g="attested" />
                <span className="badge">{a.vault} vault</span>
              </div>
              <div className="mono muted" style={{ fontSize: 11.5, wordBreak: "break-all" }}>{a.bundle.split("/").pop()}</div>
            </Panel>
          ))}
        </div>

        <div className="grid grid-2">
          <div>
            <CommandBlock label="replay every receipt from genesis" command={RECORD.commands.verifyTest} expected={`test vault: ${RECORD.expectedReceipts.test} receipts · all verified`} />
            <CommandBlock label="same replay against the production vault" command={RECORD.commands.verifyProd} expected={`prod vault: ${RECORD.expectedReceipts.prod} receipts · all verified`} />
          </div>
          <div>
            <CommandBlock label="install the verifier, then check any bundle" command={RECORD.commands.verifyAttestation} expected="PASS" />
            <CommandBlock label="export the ledger as CSV" command={RECORD.commands.verifyCsv} expected="receipts.csv, frozen columns" />
          </div>
        </div>

        <Errata title="receipts 0 to 6">
          <p>
            The earliest demo receipts name <span className="mono">acme-supplies.testnet</span>, an account that
            does not exist on chain. Those settles credited a token balance, because a token transfer only
            updates the token contract's map, but the account was never created, so they are not payments to a
            real counterparty. We publish the warning instead of renumbering the ledger.
          </p>
        </Errata>
        <Errata title="tx_ref is empty on most rows">
          <p>
            The automatic settle path records no transaction hash in the receipt, so the tx column is empty
            except where a caller supplied one. The hash chain, index and prev_hash, is intact regardless. Known
            gap, disclosed, fixable, not hidden.
          </p>
        </Errata>
      </div>
    </section>
  );
}
