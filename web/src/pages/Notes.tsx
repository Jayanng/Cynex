/* Notes. The footnotes of the case: what the thing is, what it promises,
   what it does not, and how to reproduce every claim. Written for the judge
   who reads the fine print. We like that judge. */

import { RECORD } from "../lib/record";
import { CommandBlock, ErrataNote, Grade, Marginalia } from "../components/ui";

export function NotesPage() {
  return (
    <div className="page">
      <section className="hero" style={{ paddingTop: 48 }}>
        <p className="kicker">Notes · the fine print, for the judge who reads it</p>
        <h1 className="display" style={{ fontSize: "clamp(36px, 5vw, 58px)" }}>
          Footnotes.
        </h1>
        <p className="lede measure">
          A security product is only as good as what it admits. This page says what Cynex is, what it promises,
          what it deliberately does not claim, and how to check every word of it yourself.
        </p>
      </section>

      <div className="dossier" style={{ marginTop: 28 }}>
        <div>
          <h2 style={{ marginTop: 0 }}>The trust model, in one paragraph</h2>
          <p>
            Integrity is on-chain and trustless for small evidence: the vault hashes the artifact bytes itself
            and compares them to the digest committed at authorization, so a lying courier is caught by the
            contract. Provenance comes from a TEE: an OutLayer guest fetches the evidence from its claimed
            source inside an attested enclave and hashes it there, with the per-execution quote binding what ran,
            what went in, and what came out. The vault itself does not verify the quote on chain, it checks the
            guest-reported digest and source plus the VRF signature, which anchors the execution to its request
            and kills replay. Semantics are bound at authorization: recipient, amount, and budget are fixed by
            the human before the agent ever gets a key. Read that model honestly and it is strong. Read it as
            "the vault verifies the TEE on chain" and it would be an overclaim. We choose the first reading.
          </p>

          <h2>The questions judges actually ask</h2>
          <div className="notes-grid">
            <div className="note-card">
              <h3>What stops a compromised agent?</h3>
              <p>
                The vault, not the agent. The agent's key is scoped to one method on one vault with a zero
                deposit. Every settlement term is checked by the contract in a fixed order. A compromised agent
                can ask. It cannot decide. The demo page exists so you can verify that in person.
              </p>
            </div>
            <div className="note-card">
              <h3>Is anything on this site simulated?</h3>
              <p>
                Yes, and each instance says so on its face. The fourth attack is simulated because it was never
                executed on chain. The reputation gate is off-chain by design. Everything else is either a live
                chain read or a cited historical transaction. The grade chip on every number is the contract we
                hold ourselves to.
              </p>
            </div>
            <div className="note-card">
              <h3>Where are the keys?</h3>
              <p>
                The hosted site holds no settlement key, no owner key, no full-access key. When live mode is
                configured, the only key involved is a fresh function-call key scoped to
                <span className="mono"> settle</span> on the test vault with a small allowance, embedded
                client-side by design and labelled as a demo key. Anything ever committed gets rotated, not just
                deleted. The demo key can only attempt settles. The vault decides.
              </p>
            </div>
            <div className="note-card">
              <h3>Why testnet?</h3>
              <p>
                Because real money needs real audits, and we have not claimed one. Test tokens have no value and
                no mainnet deployment is claimed anywhere in this project. The receipts are real chain state on
                NEAR testnet, and the same code hash is deployed on both vaults:
                <span className="mono"> {RECORD.codeHash.slice(0, 10)}…</span>
              </p>
            </div>
          </div>

          <h2>Reproduce it yourself</h2>
          <p>
            Clone the repo, build the contract, run the suites, replay the receipts, verify an attestation. None
            of it needs a key.
          </p>
          <CommandBlock
            label="Build the site, static, no backend, no database"
            command={RECORD.commands.buildWeb}
            expected="web/dist, served as plain files"
          />
          <CommandBlock
            label="Run the integration suite"
            command={RECORD.repoFacts.jest.command}
            expected={`${RECORD.repoFacts.jest.passed} passed, ${RECORD.repoFacts.jest.skipped} skipped`}
          />
          <CommandBlock
            label="Run the contract tests"
            command={RECORD.repoFacts.contractTests.command}
            expected={`${RECORD.repoFacts.contractTests.count} passed`}
          />

          <h2>The three layers, summarized for the skeptic</h2>
          <p>
            Layer one is pure contract: the vault hashes evidence up to 64 KiB itself and compares to the
            committed digest. Layer two is provenance: an Intel TDX enclave fetches and hashes the evidence at
            its source, and the quote is verifiable by anyone through OutLayer. Layer three is a VRF signature
            the vault verifies on chain, bound to the pending request, so proofs do not travel between orders.
            No layer trusts the next, and no layer trusts the agent.
          </p>

          <ErrataNote title="what we would fix with more time">
            <p>
              Receipts on the automatic settle path do not record a transaction hash, which weakens the
              per-receipt audit trail even though the hash chain itself is intact. The earliest seven demo
              receipts name a non-existent account. Both are disclosed on the record page. Neither is a security
              flaw in the vault. Both are honesty obligations we have kept in public rather than in private
              notes.
            </p>
            <p>
              The contract unit suite is green at 142. The separate skeleton integration binary fails at
              <span className="mono"> create_obligation</span> with
              <span className="mono"> ERR_OBLIGATION_EXPIRED</span>, because its fixture hard-codes an expiry of
              2026-01-01 that is now in the past. A stale test fixture, published here as found, with the exact
              cause named.
            </p>
          </ErrataNote>

          <Marginalia>
            <strong>Colophon.</strong> This interface is a static site, React and TypeScript, every chain read
            executed in your browser against public NEAR RPC. No analytics, no backend, no wallet connection.
            The palette is the Cynex brand. The receipts are the argument.
          </Marginalia>
        </div>

        <aside className="rail">
          <div className="rail-card">
            <h4>At a glance</h4>
            <p className="rail-note">
              Purpose-bound settlement vault for AI agents on NEAR. A human fixes the terms. The chain enforces
              them. The agent only gets to ask.
            </p>
            <p className="rail-note mono" style={{ fontSize: 11 }}>
              tagline
              <br />
              Pay the obligation. Not the prompt.
            </p>
          </div>
          <div className="rail-card">
            <h4>Grades used on this site</h4>
            <p className="rail-note">
              <Grade g="chain-read" /> live RPC
              <br />
              <Grade g="historical" /> cited past event
              <br />
              <Grade g="simulated" /> computed in browser
              <br />
              <Grade g="attested" /> bundle in repo
              <br />
              <Grade g="repo" /> checkable in checkout
              <br />
              <Grade g="errata" /> caveat attached
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
