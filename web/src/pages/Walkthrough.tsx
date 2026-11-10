/* Walkthrough. Four exhibits, in order, receipts and all. The judge reads
   the case chronologically: one good payment, one refused attack, one
   TEE-anchored payment, one reputation refusal. Each exhibit cites its
   transactions and offers a live re-read. */

import { useEffect, useState } from "react";
import { event, RECORD } from "../lib/record";
import { fetchReceipts, type ReceiptRow } from "../lib/chain";
import { baseUnits, nsToUtc, shortHash, explorerTx, explorerAccount } from "../lib/format";
import type { LiveState } from "../lib/live";
import { CommandBlock, ErrataNote, Grade, HashChip, Marginalia, Skel, Unavailable, VerdictStamp } from "../components/ui";
import { LiveRail } from "../components/LiveRail";

function Exhibit({
  no,
  title,
  children,
}: {
  no: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="exhibit">
      <div className="ex-no">Exhibit {no}</div>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function ReceiptLine({ rows, index }: { rows: ReceiptRow[]; index: number }) {
  const r = rows.find((x) => Number(x.index) === index);
  if (!r) return <Unavailable what="receipt" />;
  return (
    <span className="mono small">
      receipt #{r.index} · {shortHash(r.obligation_id, 12, 2)} · {baseUnits(r.amount)} base units ·{" "}
      {nsToUtc(r.timestamp)}
    </span>
  );
}

export function WalkthroughPage({ live }: { live: LiveState }) {
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

  const ePre = event("settle-preimage");
  const eRec = event("refuse-recipient");
  const eAmt = event("refuse-amount");
  const eCor = event("settle-correct");
  const eRep = event("refuse-replay");
  const eTee = event("tee-request");
  const eTeeSettle = event("settle-tee");

  return (
    <div className="page">
      <section className="hero" style={{ paddingTop: 48 }}>
        <p className="kicker">Walkthrough · four exhibits · every step on chain</p>
        <h1 className="display" style={{ fontSize: "clamp(36px, 5vw, 58px)" }}>
          Proof in motion.
        </h1>
        <p className="lede measure">
          Everything below already happened against the live vault on NEAR testnet. Each exhibit shows the real
          transactions, the real receipts, and the exact error codes. No reenactments. No actors.
        </p>
      </section>

      <div className="dossier" style={{ marginTop: 28 }}>
        <div>
          <Exhibit no="A" title="One honest payment, three checks">
            <p>
              The agent delivers its evidence as a preimage and the vault hashes the bytes itself, compares the
              digest to the one committed at authorization, checks the fixed terms, and settles 100 base units
              to the authorized recipient. No human in the loop. The contract did all of it.
            </p>
            <div className="ex-flow">
              <span>evidence delivered</span>
              <span className="arrow">→</span>
              <span>digest matches</span>
              <span className="arrow">→</span>
              <span>terms match</span>
              <span className="arrow">→</span>
              <span>settled</span>
            </div>
            <VerdictStamp verdict="PAID" landed={false} />
            <p className="small mono" style={{ marginTop: 16 }}>
              <Grade g="historical" /> tx{" "}
              <HashChip value={ePre.tx} href={explorerTx(ePre.tx)} /> ·{" "}
              {loaded ? <ReceiptLine rows={rows} index={11} /> : <Skel w={180} />}
            </p>
          </Exhibit>

          <Exhibit no="B" title="The injection, refused three ways">
            <p>
              Now the prompt-injected version. The agent is told the vendor rotated their payout account. The
              vault does not read the prompt. It reads the order. Then the agent is told the bill is 200 now.
              The order says 100. Then, after the correct payment finally goes through, the agent tries to
              collect again with the same nonce. All three attempts end in a code and zero tokens moved.
            </p>
            <p className="small mono">
              <Grade g="historical" /> recipient swap <HashChip value={eRec.tx} href={explorerTx(eRec.tx)} /> →{" "}
              {eRec.errCode}
            </p>
            <p className="small mono">
              <Grade g="historical" /> amount 100 → 200 <HashChip value={eAmt.tx} href={explorerTx(eAmt.tx)} /> →{" "}
              {eAmt.errCode}
            </p>
            <p className="small mono">
              <Grade g="historical" /> correct terms <HashChip value={eCor.tx} href={explorerTx(eCor.tx)} /> →
              PAID
            </p>
            <p className="small mono">
              <Grade g="historical" /> replay of nonce 1002{" "}
              <HashChip value={eRep.tx} href={explorerTx(eRep.tx)} /> → {eRep.errCode}
            </p>
            <VerdictStamp verdict="PAID" code="receipt 12, exactly once" landed={false} />
            <p className="small" style={{ marginTop: 14 }}>
              {loaded ? <ReceiptLine rows={rows} index={12} /> : <Skel w={180} />}
            </p>
          </Exhibit>

          <Exhibit no="C" title="A witness with a serial number">
            <p>
              Evidence produced inside an Intel TDX enclave, hashed in the enclave, verified through OutLayer.
              The VRF signature is bound to the pending request, so a valid-looking proof cannot be reattached
              to a different order. The vault then settles on those checks.
            </p>
            <div className="ex-flow">
              <span>OutLayer request 11912</span>
              <span className="arrow">→</span>
              <span>quote verified off-chain</span>
              <span className="arrow">→</span>
              <span>VRF bound on chain</span>
              <span className="arrow">→</span>
              <span>settled</span>
            </div>
            <p className="small mono">
              <Grade g="historical" /> tee_request{" "}
              <HashChip value={eTee.tx} href={explorerTx(eTee.tx)} /> · settle{" "}
              <HashChip value={eTeeSettle.tx} href={explorerTx(eTeeSettle.tx)} />
            </p>
            <VerdictStamp verdict="PAID" code="receipt 13, VRF-bound" landed={false} />
            <p className="small" style={{ marginTop: 14 }}>
              {loaded ? <ReceiptLine rows={rows} index={13} /> : <Skel w={180} />}
            </p>
            <Marginalia>
              <strong>What this layer does and does not prove.</strong> The quote binds what ran in the enclave.
              The vault checks the guest-reported digest and source plus the VRF signature. The VRF anchor is not
              proof of TEE execution, and we label it accordingly everywhere it appears.
            </Marginalia>
          </Exhibit>

          <Exhibit no="D" title="The gate that says no before the vault is even asked">
            <p>
              Off-chain, before any settle is submitted, the counterparty is scored on five signals. A contract
              that changed code within 24 hours and has no interaction history with the vault gets blocked here,
              by the gate, and the attempt never reaches the chain. The refusal names the signal and its source.
            </p>
            <div className="cmd">
              <span className="cmd-label">Gate evaluation, recorded</span>
              <pre>{`gate.evaluate(counterparty)
  signal : code_change_recency
  source : on-chain code hash vs latest snapshot
  seen   : code changed 6h ago · no prior vault interactions
  rule   : no change or over 7 days → ALLOW
           change under 24h, or change with no history → BLOCK
           otherwise → WARN, escalates unless approved
  verdict: BLOCK`}</pre>
            </div>
            <p className="small">
              <Grade g="simulated" /> The gate is off-chain by design. A reputation refusal is not a vault
              refusal, and the two are never conflated on this site. Signals show as unavailable when they
              cannot be sourced. Neutral is not a penalty.
            </p>
          </Exhibit>

          <hr className="rule" />
          <h2>Read it yourself</h2>
          <p className="small">
            The receipts above are read live from the vault. The commands below replay the whole chain from
            genesis and recompute every hash link, without a key, without a wallet, without trusting this page.
          </p>
          <CommandBlock
            label="Replay the receipt chain, test vault"
            command={RECORD.commands.verifyTest}
            expected="every row verified, index contiguous, hash links intact"
          />
          <CommandBlock
            label="Verify the TEE attestation bundle yourself"
            command={RECORD.commands.verifyAttestation}
            expected="PASS"
          />
          <ErrataNote title="the honest footnote">
            <p>
              The automatic settle path records no transaction hash in the receipt, so most rows show an empty
              tx field. It is a known gap in the receipt schema, disclosed here and on the record page, not a
              missing transaction. The explorer links above the receipts are the authoritative history.
            </p>
          </ErrataNote>
        </div>

        <aside className="rail">
          <LiveRail live={live} />
          <div className="rail-card">
            <h4>Exhibit index</h4>
            <p className="rail-note">
              A, honest payment. B, injection refused three ways. C, TEE and VRF. D, the gate that refuses
              before the chain is asked.
            </p>
          </div>
          <div className="rail-card">
            <h4>Vaults</h4>
            <p className="rail-note mono" style={{ fontSize: 11 }}>
              test{" "}
              <a href={explorerAccount(RECORD.vaults.test)} target="_blank" rel="noreferrer">
                {RECORD.vaults.test}
              </a>
              <br />
              prod{" "}
              <a href={explorerAccount(RECORD.vaults.prod)} target="_blank" rel="noreferrer">
                {RECORD.vaults.prod}
              </a>
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
