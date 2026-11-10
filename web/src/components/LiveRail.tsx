/* LiveRail: the always-on metadata column. Every figure carries its grade.
   On RPC failure the row shows Unavailable and freezes visibly stale. */

import { RECORD } from "../lib/record";
import { baseUnits, nsToUtc, shortHash, explorerAccount } from "../lib/format";
import { codeHashMatches, type LiveState } from "../lib/live";
import { Grade, Skel, Unavailable } from "./ui";

function Row({ label, value, unavailable }: { label: string; value: React.ReactNode; unavailable?: boolean }) {
  return (
    <div className="rail-row">
      <span>{label}</span>
      <span className={`rv ${unavailable ? "unavailable" : ""}`}>{value}</span>
    </div>
  );
}

export function LiveRail({ live }: { live: LiveState }) {
  const loaded = live.checkedAt !== "";
  const bal = live.balance;
  return (
    <>
      <div className="rail-card">
        <h4>
          Chain state <Grade g="chain-read" />
        </h4>
        <Row
          label="Block"
          value={
            live.block ? (
              live.block
            ) : loaded ? (
              <Unavailable what="block height" />
            ) : (
              <Skel w={48} />
            )
          }
          unavailable={loaded && !live.block}
        />
        <Row
          label="Code hash, test"
          value={
            live.codeHashTest ? (
              <a href={explorerAccount(RECORD.vaults.test)} target="_blank" rel="noreferrer" title={live.codeHashTest}>
                {shortHash(live.codeHashTest)}
                {codeHashMatches(live.codeHashTest) ? " ✓" : " ≠ record"}
              </a>
            ) : loaded ? (
              <Unavailable what="code hash" />
            ) : (
              <Skel />
            )
          }
        />
        <Row
          label="Code hash, prod"
          value={
            live.codeHashProd ? (
              <a href={explorerAccount(RECORD.vaults.prod)} target="_blank" rel="noreferrer" title={live.codeHashProd}>
                {shortHash(live.codeHashProd)}
                {codeHashMatches(live.codeHashProd) ? " ✓" : " ≠ record"}
              </a>
            ) : loaded ? (
              <Unavailable what="code hash" />
            ) : (
              <Skel />
            )
          }
        />
        <Row
          label="Receipts"
          value={
            loaded && live.receiptsTest.length ? (
              <>
                test {live.receiptsTest.length} · prod {live.receiptsProd.length}
              </>
            ) : loaded ? (
              <Unavailable what="receipt counts" />
            ) : (
              <Skel />
            )
          }
        />
        <Row
          label={`Policy ${RECORD.policy}`}
          value={
            bal ? (
              <>
                spent {baseUnits(bal.spent)} / {baseUnits(bal.limit)} test tokens
              </>
            ) : loaded ? (
              <Unavailable what="policy" />
            ) : (
              <Skel />
            )
          }
        />
        <Row
          label="Agent balance"
          value={live.agentUnits ? `${baseUnits(live.agentUnits)} test tokens` : loaded ? <Unavailable what="balance" /> : <Skel />}
        />
        <Row
          label="Last settle"
          value={
            live.lastSettle ? (
              <>
                #{live.lastSettle.index} · {nsToUtc(live.lastSettle.ts)}
              </>
            ) : loaded ? (
              <Unavailable what="receipts" />
            ) : (
              <Skel />
            )
          }
        />
      </div>
      <div className="rail-card">
        <h4>Provenance</h4>
        <p className="rail-note">
          Numbers here are fetched from NEAR RPC in your browser during this session. If a fetch fails the row
          says so. A stale block height stays visibly stale. Nothing on this site is dressed up as live when it
          is not.
        </p>
        <p className="rail-note mono" style={{ fontSize: 11 }}>
          RPC: test.rpc.fastnear.com
          <br />
          checked {live.checkedAt || "…"}
        </p>
      </div>
    </>
  );
}
