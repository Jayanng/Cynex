/* The record. The books, open on the table: every receipt from genesis,
   the attestation bundles, the commands, and the errata, in writing. */

import { useEffect, useState } from "react";
import { fetchReceipts, type ReceiptRow } from "../lib/chain";
import { RECORD } from "../lib/record";
import type { LiveState } from "../lib/live";
import { CommandBlock, ErrataNote, Grade, HashChip, Marginalia, Skel, Unavailable } from "../components/ui";
import { LiveRail } from "../components/LiveRail";
import { LedgerTable } from "../components/LedgerTable";
import { explorerTx } from "../lib/format";

export function RecordPage({ live }: { live: LiveState }) {
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (live.receiptsTest.length) {
      setRows(live.receiptsTest);
      setLoaded(true);
      return;
    }
    let alive = true;
    fetchReceipts(RECORD.vaults.test).then((r) => {
      if (!alive) return;
      setRows(r);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [live.receiptsTest]);

  return (
    <div className="page">
      <section className="hero" style={{ paddingTop: 48 }}>
        <p className="kicker">The record · receipts from genesis · verify offline</p>
        <h1 className="display" style={{ fontSize: "clamp(36px, 5vw, 58px)" }}>
          The books are open.
        </h1>
        <p className="lede measure">
          Nothing on this page asks for trust. One command replays the whole receipt chain from genesis and
          recomputes every hash link. The table below is the same data, read live in your browser right now.
        </p>
      </section>

      <div className="dossier" style={{ marginTop: 28 }}>
        <div>
          <h2 style={{ marginTop: 0 }}>Receipt chain, test vault</h2>
          <LedgerTable rows={rows} loaded={loaded} />

          <ErrataNote title="receipts 0 to 6">
            <p>
              These earliest demo receipts name <span className="mono">acme-supplies.testnet</span>, an account
              that does not exist on chain. Those settles credited a token balance, because a token transfer
              only updates the token contract's map, but the account was never created, so they are not payments
              to a real counterparty. We publish the warning instead of renumbering the ledger. Do not treat
              receipts 0 to 6 as evidence of commerce.
            </p>
          </ErrataNote>
          <ErrataNote title="tx_ref is empty on most rows">
            <p>
              The automatic settle path records no transaction hash in the receipt, so the tx column is empty
              except where a caller supplied one. The hash chain, index and prev_hash, is intact regardless, and
              the explorer holds the transaction history. Known gap, disclosed, fixable, not hidden.
            </p>
          </ErrataNote>

          <h2>One command, no key, no wallet</h2>
          <CommandBlock
            label="Replay every receipt from genesis, recompute every hash link"
            command={RECORD.commands.verifyTest}
            expected={`test vault: ${RECORD.expectedReceipts.test} receipts · all verified · index contiguous`}
          />
          <CommandBlock
            label="Export the ledger as CSV"
            command={RECORD.commands.verifyCsv}
            expected="receipts.csv, frozen columns"
          />
          <CommandBlock
            label="Same replay against the production vault"
            command={RECORD.commands.verifyProd}
            expected={`prod vault: ${RECORD.expectedReceipts.prod} receipts · all verified`}
          />

          <h2>Attestation bundles, filed</h2>
          <p>
            Four TEE executions carry independently verifiable attestation bundles in the repo. Each binds what
            ran, what went in, and what came out. Verify them yourself with the repo's verifier, no account
            needed.
          </p>
          {RECORD.attestations.map((a) => (
            <p key={a.bundle} className="small mono">
              <Grade g="attested" /> request {a.request} · {a.vault} vault ·{" "}
              <span title={a.bundle}>{a.bundle.split("/").pop()}</span>
            </p>
          ))}
          <CommandBlock
            label="Install the verifier once, then check any bundle"
            command={RECORD.commands.installVerifier}
            expected="outlayer-verify on your PATH"
          />
          <CommandBlock label="Check a bundle" command={RECORD.commands.verifyAttestation} expected="PASS" />

          <h2>What the repo itself certifies</h2>
          <div className="tag-row">
            <span className="pill">
              {RECORD.repoFacts.contractTests.count} contract tests <Grade g="repo" />
            </span>
            <span className="pill">
              {RECORD.repoFacts.jest.passed} passed, {RECORD.repoFacts.jest.skipped} skipped <Grade g="repo" />
            </span>
            <span className="pill">
              {RECORD.repoFacts.jest.suites} suites <Grade g="repo" />
            </span>
            <span className="pill">
              {RECORD.repoFacts.errorCodes.defined} error codes defined, {RECORD.repoFacts.errorCodes.returnedBySettle}{" "}
              reachable through settle <Grade g="repo" />
            </span>
          </div>
          <Marginalia>
            <strong>How to read a grade.</strong> CHAIN READ means your browser fetched it from NEAR RPC during
            this session. HISTORICAL means a past on-chain event, cited with its transaction hash. ATTESTED means
            a bundle in the repo backs it. SIMULATED means computed in your browser, and never presented as
            chain truth. REPO means anyone with the checkout can check it. ERRATA means a known caveat rides
            with the number.
          </Marginalia>
        </div>

        <aside className="rail">
          <LiveRail live={live} />
          <div className="rail-card">
            <h4>Chain reads</h4>
            <p className="rail-note">
              {loaded ? (
                <>
                  {rows.length} receipts streamed from{" "}
                  <HashChip value={RECORD.vaults.test} href={`https://testnet.nearblocks.io/address/${RECORD.vaults.test}`} />
                </>
              ) : (
                <Unavailable what="receipts" />
              )}
            </p>
            <p className="rail-note">
              {live.receiptsProd.length ? (
                <>Production vault holds {live.receiptsProd.length} receipts.</>
              ) : loaded ? (
                <Unavailable what="production receipts" />
              ) : (
                <Skel w={120} />
              )}
            </p>
          </div>
          <div className="rail-card">
            <h4>Latest refuse in the record</h4>
            <p className="rail-note">
              <Grade g="historical" />{" "}
              <HashChip
                value="AwzQS7XsuGSYnPmvd5jFJzPDs3WDc2gRgSbW3smWq1Cs"
                href={explorerTx("AwzQS7XsuGSYnPmvd5jFJzPDs3WDc2gRgSbW3smWq1Cs")}
              />{" "}
              replay refused, ERR_NONCE_ALREADY_CONSUMED
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
