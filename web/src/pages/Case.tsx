/* The case. Verdict first, then the record. A judge should know what Cynex
   does in ten seconds and want to break it in twenty. */

import { useEffect, useState } from "react";
import { event, RECORD } from "../lib/record";
import { explorerTx, baseUnits } from "../lib/format";
import type { LiveState } from "../lib/live";
import type { ObligationView } from "../lib/chain";
import { getObligation } from "../lib/chain";
import {
  CommandBlock,
  ErrataNote,
  Grade,
  HashChip,
  Marginalia,
  VerdictStamp,
} from "../components/ui";
import { LiveRail } from "../components/LiveRail";
import { TermsLock } from "../components/TermsLock";

const refusal = event("refuse-recipient");

export function CasePage({ live }: { live: LiveState }) {
  const [obligation, setObligation] = useState<ObligationView | null>(null);

  useEffect(() => {
    let alive = true;
    getObligation(RECORD.vaults.test, RECORD.obligation.id).then((o) => {
      if (alive) setObligation(o);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="page">
      <section className="hero">
        <div className="dossier">
          <div>
            <p className="kicker">Case file · purpose-bound settlement vault · NEAR testnet</p>
            <h1 className="display">
              Someone told your agent
              <br />
              to pay the wrong account.
            </h1>
            <p className="display-sub">
              The vault read the order, checked the file, and said <em>no</em>. Zero tokens moved. The refusal
              is on chain.
            </p>
            <p className="case-id" style={{ marginTop: 10 }}>
              <span>
                Refusal tx <HashChip value={refusal.tx} href={explorerTx(refusal.tx)} />
              </span>
              <span>Order {refusal.obligationId}</span>
              <span>
                <Grade g="historical" />
              </span>
            </p>
            <div className="btn-row">
              <a className="btn btn-primary" href="#/break">
                Break it yourself
              </a>
              <a className="btn" href="#/record">
                Verify the record
              </a>
            </div>
            <div className="case-id">
              <span>Cynex</span>
              <span>Pay the obligation. Not the prompt.</span>
            </div>
          </div>
          <div className="rail" aria-hidden="true" />
        </div>
      </section>

      <div className="dossier" style={{ marginTop: 40 }}>
        <div>
          <VerdictStamp verdict="REFUSED" code={refusal.errCode} />
          <p className="small mono" style={{ marginTop: 18 }}>
            {refusal.label} · order {refusal.obligationId} · 100 base units (0.0001 test tokens) · nonce{" "}
            {RECORD.obligation.nonce} ·{" "}
            <Grade g="historical" />
          </p>

          <hr className="rule-ink" />

          <h2>What this is</h2>
          <p className="lede">
            AI agents now hold wallets and sign payments. A single poisoned prompt can walk one into paying the
            wrong person, the wrong amount, or the same bill twice. Cynex moves that decision out of the model
            and onto the chain.
          </p>
          <p>
            A human authorizes an order with fixed terms: recipient, token, amount, evidence requirement, and
            budget. The agent may ask for settlement. The vault checks every term itself before a single token
            moves. The agent is assumed compromised from the first line of code to the last. It holds a key that
            can only knock on one door, and the door checks the paperwork.
          </p>

          <h2>What a compromised agent cannot do here</h2>
          <div className="layers">
            <div className="layer">
              <div className="l-no">Refused</div>
              <div className="l-title">Pay anyone else</div>
              <p>
                The recipient is fixed at authorization. A swapped account gets
                <span className="mono"> ERR_RECIPIENT_SUBSTITUTION</span>, on chain, before any transfer is
                scheduled.
              </p>
            </div>
            <div className="layer">
              <div className="l-no">Refused</div>
              <div className="l-title">Change the number</div>
              <p>
                The amount is part of the order. An inflated figure gets
                <span className="mono"> ERR_TERMS_MISMATCH</span>. The vault does not round up. It does not
                improvise.
              </p>
            </div>
            <div className="layer">
              <div className="l-no">Refused</div>
              <div className="l-title">Collect twice</div>
              <p>
                Every nonce pays exactly once, even when the first transfer fails. A replay gets
                <span className="mono"> ERR_NONCE_ALREADY_CONSUMED</span>, and the budget stays spent where it
                should.
              </p>
            </div>
          </div>

          <h2>The evidence, in three layers that trust each other nothing</h2>
          <p>
            Anyone can claim their payment was legitimate. Cynex makes the claim checkable, three times over,
            and no layer vouches for the next.
          </p>
          <div className="layers">
            <div className="layer">
              <div className="l-no">Layer 1 · on-chain integrity</div>
              <div className="l-title">The vault does its own hashing</div>
              <p>
                For evidence up to 64 KiB the contract hashes the delivered bytes itself and compares them to the
                digest committed at authorization. A lying courier is caught by the contract, not by a service.
              </p>
            </div>
            <div className="layer">
              <div className="l-no">Layer 2 · TEE provenance</div>
              <div className="l-title">A witness with a serial number</div>
              <p>
                A guest program fetches the evidence inside an Intel TDX enclave and hashes it there. The
                per-execution quote binds what ran, what went in, and what came out. Anyone can re-verify it
                through OutLayer's attestation endpoint.
              </p>
            </div>
            <div className="layer">
              <div className="l-no">Layer 3 · VRF anchor</div>
              <div className="l-title">Nothing replayable</div>
              <p>
                The guest requests VRF randomness during execution and the vault verifies the signature on
                chain, bound to the pending request. No one gets to reattach a valid-looking proof to a
                different order.
              </p>
            </div>
          </div>
          <Marginalia>
            <strong>Read the fine print with us.</strong> The vault checks the guest-reported digest and source
            plus the VRF signature. The TDX quote itself is verified off-chain, through OutLayer's verifier, and
            the VRF signature is an anchor, not proof of TEE execution. We say this on the page because a
            security product that oversells is a security product that lied.
          </Marginalia>

          <h2>Do not take our word for it</h2>
          <p>
            Every number on this site is fetched from NEAR RPC in your browser while you read, or it carries a
            grade that says what it is. Receipts replay from genesis with one command. Attestation bundles sit
            in the repo with their own verifier. The demo asks you to attack it and shows you the exact code the
            contract answered with.
          </p>
          <CommandBlock
            label="Replay the whole receipt chain from genesis"
            command={RECORD.commands.verifyTest}
            expected="31 receipts on the test vault, every hash link verified, no gaps"
          />

          <h2>Built and tested like it holds money</h2>
          <div className="tag-row">
            <span className="pill">
              {RECORD.repoFacts.contractTests.count} contract tests <Grade g="repo" />
            </span>
            <span className="pill">
              {RECORD.repoFacts.jest.passed} integration tests <Grade g="repo" />
            </span>
            <span className="pill">
              {RECORD.repoFacts.errorCodes.defined} error codes <Grade g="repo" />
            </span>
            <span className="pill">
              4 attestation bundles <Grade g="attested" />
            </span>
            <span className="pill">
              2 live vaults <Grade g="chain-read" />
            </span>
          </div>

          <div className="errata">
            <span className="errata-tag">Errata, receipts 0 to 6</span>
            <p>
              The earliest demo receipts name an account that does not exist on chain. They credited a token
              balance but paid no real counterparty, and we label them rather than quietly renumbering the
              ledger. See the record page for the full note.
            </p>
          </div>

          <hr className="rule" />

          <h2>The terms under the demo attack</h2>
          <p className="small">
            This is the live order the attack page goes after, read from the vault right now.
          </p>
          <TermsLock obligation={obligation} loaded={live.checkedAt !== ""} />
          <div className="btn-row">
            <a className="btn btn-primary" href="#/break">
              Throw an attack at it
            </a>
            <a className="btn" href="#/walkthrough">
              Watch the walkthrough
            </a>
          </div>
        </div>

        <aside className="rail">
          <LiveRail live={live} />
          <div className="rail-card">
            <h4>The verdict in one line</h4>
            <p className="rail-note">
              The vault only pays exactly what a human authorized. Same recipient, same amount, same evidence,
              once. Everything else is refused on chain, in code you can read.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
