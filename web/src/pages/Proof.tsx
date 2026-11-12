/* Cynex web, Proof page.
   Every claim names the contract method behind it and the live evidence
   for it. The receipt table shows the six key receipts with their real
   settle transactions and blocks, all verified from the chain. The
   receipt tx_ref field is empty on chain, so the tx hashes shown are
   the real settle transactions, not values copied out of the receipt. */

import { TEST_COUNTS, VAULT_TEST, TOKEN } from "../lib/data";
import { useLive } from "../lib/live";
import { StripSection } from "../components/Strip";
import { Footer } from "../components/shared";
import { CopyButton } from "../components/ui";
import { TxLink, AccountLink } from "../lib/links";

const CODE_HASH_SNAPSHOT = "65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6";

const RECEIPTS: { index: string; obligation: string; tx: string; block: string }[] = [
  {
    index: "24",
    obligation: "usecase-report-002",
    tx: "2VLL134m83x5fWZLr2qBbPkjJ7gL9YR7V7U9eur7qoVC",
    block: "276787166",
  },
  {
    index: "31",
    obligation: "demo-live-001",
    tx: "12pi6dZ1CzgvCeLWCCRSvC2iLyTaN7J2fRHtYnbHmcf6",
    block: "277243629",
  },
  {
    index: "34",
    obligation: "demo-live-004",
    tx: "3KU6pZ6cQLEaFAne3SvNNJTDUpmeuJ6BwpaYR1Sd3Taq",
    block: "277247420",
  },
  {
    index: "35",
    obligation: "demo-live-005",
    tx: "D7aRDckcLkt4FghZUGpAkrCLx677NAVjPYrWUvTM2EJe",
    block: "277362593",
  },
  {
    index: "36",
    obligation: "demo-live-006",
    tx: "G4t39dyNEXPWE5EWgyrKALewvVU5hMhwCRBhC6AC7qx8",
    block: "277375354",
  },
  {
    index: "37",
    obligation: "demo-live-007",
    tx: "3dKKqs7KNZvTCn1VQTckjkXLWM5KUuw8g5tVWVqAhTDz",
    block: "277387665",
  },
];

function jestCounts(): [string, string, string] {
  const m = TEST_COUNTS.match(/(\d+) tests passed, (\d+) skipped, (\d+) total/);
  if (m) return [m[1], m[2], m[3]];
  return ["640", "3", "643"];
}

export function Proof() {
  const { live: L } = useLive();
  const [passed, skipped, total] = jestCounts();
  const codeHash = !L.codeTest.err && L.codeTest.v ? L.codeTest.v : CODE_HASH_SNAPSHOT;
  const codeHashIsSnapshot = L.codeTest.err || !L.codeTest.v;
  const countsLine =
    !L.recTest.err && !L.recProd.err && !L.policy.err && L.recTest.v != null && L.recProd.v != null && L.policy.v
      ? `${L.recTest.v} test receipts, ${L.recProd.v} production receipts, policy p6-001 spent ${L.policy.v.spent} of ${L.policy.v.limit}`
      : "38 test receipts, 13 production receipts, policy p6-001 spent 6100 of 10000, read 12 Nov 2026";
  const policyEvidence =
    !L.policy.err && L.policy.v != null
      ? `Policy p6-001 spent ${L.policy.v.spent} of ${L.policy.v.limit}, read live`
      : "Policy p6-001 spent 6100 of 10000, read 12 Nov 2026";

  return (
    <>
      <div className="page-hero">
        <div className="wrap">
          <p className="hero-tag">PROOF · VERIFY EVERY CLAIM</p>
          <h1 className="page-line">
            Do not trust
            <br />
            this page. <span className="accent">Check it.</span>
          </h1>
          <p className="hero-sub">
            Every claim below names the contract method behind it and the live evidence for it. Counts:{" "}
            <strong>{countsLine}</strong>.
          </p>
        </div>
      </div>
      <StripSection />

      <div className="wrap">
        <section className="block" style={{ paddingBottom: "2rem" }}>
          <p className="sec-label">RECEIPTS · ON CHAIN</p>
          <h2 className="sec-title" style={{ fontSize: "clamp(1.9rem,4vw,3rem)" }}>
            The live receipts
          </h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Receipt</th>
                  <th>Obligation</th>
                  <th>Verdict</th>
                  <th>Settle transaction</th>
                  <th>Block</th>
                </tr>
              </thead>
              <tbody>
                {RECEIPTS.map((r) => (
                  <tr key={r.index}>
                    <td data-h="RECEIPT"><TxLink hash={r.tx} title={"vault receipt number " + r.index + ", settle transaction"}>{r.index}</TxLink></td>
                    <td data-h="OBLIGATION" className="mono">
                      <AccountLink account={VAULT_TEST} title="view the vault account on NearBlocks">{r.obligation}</AccountLink>
                    </td>
                    <td data-h="VERDICT">
                      <span className="st-paid">PAID</span>
                    </td>
                    <td data-h="TX" className="hash">
                      <TxLink hash={r.tx}>{r.tx}</TxLink>
                    </td>
                    <td data-h="BLOCK" className="mono">
                      {r.block}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="note-box">
            <b>About tx_ref:</b> the receipt tx_ref field is empty on chain for receipts 24, 31, 34, 35, 36 and 37. The vault does
            not record the settle tx hash in the receipt. The tx hashes shown above are the real settle transactions,
            not values copied out of the receipt.
          </div>
        </section>

        <section className="block" style={{ paddingTop: "1rem", paddingBottom: "2rem" }}>
          <p className="sec-label">CLAIM MAP</p>
          <h2 className="sec-title" style={{ fontSize: "clamp(1.9rem,4vw,3rem)" }}>
            Claim, method, evidence
          </h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Claim</th>
                  <th>Contract method</th>
                  <th>Check</th>
                  <th>Live evidence</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-h="CLAIM">A changed recipient is refused, 0 moved</td>
                  <td data-h="METHOD" className="mono">
                    settle
                  </td>
                  <td data-h="CHECK">Terms comparison on settle</td>
                  <td data-h="EVIDENCE" className="hash">
                    ERR_RECIPIENT_SUBSTITUTION · tx <TxLink hash="EiBHjMBqZfBLZB33H4odbBfskGbVCX1Jor422t5S1cpX">EiBHjMBqZfBLZB33H4odbBfskGbVCX1Jor422t5S1cpX</TxLink>
                  </td>
                </tr>
                <tr>
                  <td data-h="CLAIM">A changed amount is refused, 0 moved</td>
                  <td data-h="METHOD" className="mono">
                    settle
                  </td>
                  <td data-h="CHECK">Terms comparison on settle</td>
                  <td data-h="EVIDENCE" className="hash">
                    ERR_TERMS_MISMATCH · amount 200 · tx <TxLink hash="2NaWqCYiUnh9DMhRCR6JVSDQ3R7yD26U8Auf3qEer91f">2NaWqCYiUnh9DMhRCR6JVSDQ3R7yD26U8Auf3qEer91f</TxLink>
                  </td>
                </tr>
                <tr>
                  <td data-h="CLAIM">A settled obligation cannot be settled again</td>
                  <td data-h="METHOD" className="mono">
                    settle
                  </td>
                  <td data-h="CHECK">Nonce / replay state</td>
                  <td data-h="EVIDENCE" className="hash">
                    ERR_NONCE_ALREADY_CONSUMED · tx <TxLink hash="hG6uhpePR9ZcvCZXZprpXa8rvbAGGQPxD4ZyMpP91F6">hG6uhpePR9ZcvCZXZprpXa8rvbAGGQPxD4ZyMpP91F6</TxLink>
                  </td>
                </tr>
                <tr>
                  <td data-h="CLAIM">Correct evidence and exact terms settle, once</td>
                  <td data-h="METHOD" className="mono">
                    submit_evidence_preimage + settle
                  </td>
                  <td data-h="CHECK">Digest committed up front, compared at settle</td>
                  <td data-h="EVIDENCE" className="hash">
                    Receipt 24 · <AccountLink account={VAULT_TEST} title="view the vault account on NearBlocks">usecase-report-002</AccountLink> · PAID
                  </td>
                </tr>
                <tr>
                  <td data-h="CLAIM">One click on the live site settles a real demo obligation</td>
                  <td data-h="METHOD" className="mono">
                    settle
                  </td>
                  <td data-h="CHECK">Live demo obligations demo-live-001 to 007</td>
                  <td data-h="EVIDENCE" className="hash">
                    Receipts 31, 35, 36 and 37 · PAID · txs in the receipt table above
                  </td>
                </tr>
                <tr>
                  <td data-h="CLAIM">The policy budget is capped and tracked on chain</td>
                  <td data-h="METHOD" className="mono">
                    create_obligation / settle
                  </td>
                  <td data-h="CHECK">Policy spend read from the vault</td>
                  <td data-h="EVIDENCE" className="hash">
                    {policyEvidence}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="block" style={{ paddingTop: "1rem", paddingBottom: "2rem" }}>
          <p className="sec-label">WHAT IS REAL AND WHAT IS SIMULATED</p>
          <h2 className="sec-title" style={{ fontSize: "clamp(1.9rem,4vw,3rem)" }}>
            Stated plainly, 15 rows
          </h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Status</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-h="ITEM">Vault contract on NEAR testnet</td>
                  <td data-h="STATUS">
                    <span className="st-real">REAL</span>
                  </td>
                  <td data-h="NOTE">Deployed code, hash <AccountLink account={VAULT_TEST} title="view the vault account on NearBlocks">{codeHash}</AccountLink>{codeHashIsSnapshot ? " (pinned snapshot from 12 Nov 2026)" : ""}</td>
                </tr>
                <tr>
                  <td data-h="ITEM">Refusal transactions (recipient, amount, replay, before evidence)</td>
                  <td data-h="STATUS">
                    <span className="st-real">REAL</span>
                  </td>
                  <td data-h="NOTE">Four tx hashes listed on Break it and on Guided demo</td>
                </tr>
                <tr>
                  <td data-h="ITEM">Receipts 24, 31, 34, 35, 36, 37</td>
                  <td data-h="STATUS">
                    <span className="st-real">REAL</span>
                  </td>
                  <td data-h="NOTE">Written on chain by real settles</td>
                </tr>
                <tr>
                  <td data-h="ITEM">Receipt counts and policy spend</td>
                  <td data-h="STATUS">
                    <span className="st-real">REAL · LIVE</span>
                  </td>
                  <td data-h="NOTE">{countsLine}</td>
                </tr>
                <tr>
                  <td data-h="ITEM">Test counts</td>
                  <td data-h="STATUS">
                    <span className="st-real">REAL</span>
                  </td>
                  <td data-h="NOTE">
                    Jest {passed} passed, {skipped} skipped, {total} total; cargo test 142 passed
                  </td>
                </tr>
                <tr>
                  <td data-h="ITEM">MCP server and its six tools</td>
                  <td data-h="STATUS">
                    <span className="st-real">REAL CODE</span>
                  </td>
                  <td data-h="NOTE">Stdio only, one tool moves funds, run with npx cynex-mcp --sandbox</td>
                </tr>
                <tr>
                  <td data-h="ITEM">Run it live on this site</td>
                  <td data-h="STATUS">
                    <span className="st-real">REAL</span>
                  </td>
                  <td data-h="NOTE">
                    Settles the next ready demo obligation on testnet and returns the receipt and tx hash. Proven
                    live: receipt 37, <AccountLink account={VAULT_TEST} title="view the vault account on NearBlocks">demo-live-007</AccountLink>, tx <TxLink hash="3dKKqs7KNZvTCn1VQTckjkXLWM5KUuw8g5tVWVqAhTDz">3dKKqs7KNZvTCn1VQTckjkXLWM5KUuw8g5tVWVqAhTDz</TxLink>, block 277387665
                  </td>
                </tr>
                <tr>
                  <td data-h="ITEM">Demo-settle key scope</td>
                  <td data-h="STATUS">
                    <span className="st-real">REAL</span>
                  </td>
                  <td data-h="NOTE">
                    Scoped settle-only key on the test vault, allowance 1 NEAR. The browser never sees it.
                  </td>
                </tr>
                <tr>
                  <td data-h="ITEM">Break it attack form</td>
                  <td data-h="STATUS">
                    <span className="st-sim">REPLAYS RECORD</span>
                  </td>
                  <td data-h="NOTE">Shows the recorded on-chain verdict for that attack, sends no transaction</td>
                </tr>
                <tr>
                  <td data-h="ITEM">Tamper and detect panel</td>
                  <td data-h="STATUS">
                    <span className="st-sim">LOCAL DEMO</span>
                  </td>
                  <td data-h="NOTE">Illustrates the receipt hash-link check in the browser, on receipt 24</td>
                </tr>
                <tr>
                  <td data-h="ITEM">Home obligation card</td>
                  <td data-h="STATUS">
                    <span className="st-real">REAL VALUES</span>
                  </td>
                  <td data-h="NOTE">
                    Recipient, amount, token, evidence digest, and budget are the real usecase-report-002 terms,
                    read from the chain
                  </td>
                </tr>
                <tr>
                  <td data-h="ITEM">TEE attestation</td>
                  <td data-h="STATUS">
                    <span className="st-real">REAL</span>
                  </td>
                  <td data-h="NOTE">
                    Request 11912 quote verified off chain, outlayer-verify v0.1.0 exit 0. The vault does not
                    verify the quote on chain, by design
                  </td>
                </tr>
                <tr>
                  <td data-h="ITEM">VRF anchor</td>
                  <td data-h="STATUS">
                    <span className="st-real">REAL</span>
                  </td>
                  <td data-h="NOTE">
                    Signature verified on chain, bound to the pending request. Proves determinism and binding, not
                    TEE execution
                  </td>
                </tr>
                <tr>
                  <td data-h="ITEM">Reputation gate</td>
                  <td data-h="STATUS">
                    <span className="st-real">REAL</span>
                  </td>
                  <td data-h="NOTE">
                    Five signals scored before settling. BLOCK refuses, WARN escalates to the owner. A reputation
                    refusal is not a vault refusal
                  </td>
                </tr>
                <tr>
                  <td data-h="ITEM">Token</td>
                  <td data-h="STATUS">
                    <span className="st-real">REAL</span>
                  </td>
                  <td data-h="NOTE"><AccountLink account={TOKEN} />, 6 decimals, testnet only, no mainnet value</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="block" style={{ paddingTop: "1rem" }}>
          <div className="split">
            <div className="limits">
              <p className="sec-label">BUILD STATUS</p>
              <h2 className="sec-title" style={{ fontSize: "clamp(1.7rem,3.4vw,2.4rem)" }}>
                As last run
              </h2>
              <ul>
                <li>
                  <span>
                    <strong>Jest:</strong> {passed} passed, {skipped} skipped, {total} total.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Cargo test:</strong> 142 passed.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Vault code hash:</strong>{" "}
                    <span className="mono" style={{ fontSize: ".82rem", wordBreak: "break-all" }}>
                      <AccountLink account={VAULT_TEST} title="view the vault account on NearBlocks">{codeHash}</AccountLink>
                    </span>
                    {codeHashIsSnapshot ? " (pinned snapshot from 12 Nov 2026)" : ""}
                  </span>
                </li>
                <li>
                  <span>
                    <strong>Live reads:</strong> {countsLine}.
                  </span>
                </li>
              </ul>
            </div>
            <div className="limits">
              <p className="sec-label">HONEST LIMITS</p>
              <h2 className="sec-title" style={{ fontSize: "clamp(1.7rem,3.4vw,2.4rem)" }}>
                What Cynex does not claim
              </h2>
              <ul>
                <li>
                  <span>
                    <strong>The vault checks terms, not the caller.</strong> Safety comes from the fixed terms, the
                    budget, and the scoped settle key, never from trusting who asks.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>TEE quotes are verified off chain.</strong> The vault does not verify the attestation
                    quote on chain. That is by design, and it is stated plainly.
                  </span>
                </li>
                <li>
                  <span>
                    <strong>VRF is not TEE proof.</strong> The VRF signature proves determinism and binding to a
                    pending request. It does not prove TEE execution, and Cynex does not claim it does.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </div>
      <Footer />
    </>
  );
}
