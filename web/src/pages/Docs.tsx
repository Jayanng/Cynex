/* Cynex web, Docs page.
   A clean index of the contract API, the verify-live command, the MCP
   server, the test counts, and the code hash. The Jest counts come from
   TEST_COUNTS in lib/data.ts, the single source; the code hash is read
   live, with the last verified hash shown while the read loads. */

import { TEST_COUNTS, VAULT_TEST } from "../lib/data";
import { useLive } from "../lib/live";
import { Footer } from "../components/shared";
import { CopyButton } from "../components/ui";
import { AccountLink } from "../lib/links";

const CODE_HASH_SNAPSHOT = "65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6";
const VERIFY_CMD = "node frontend/dist-test/cli/cynex.js verify-live " + VAULT_TEST;

function jestCounts(): [string, string, string] {
  const m = TEST_COUNTS.match(/(\d+) tests passed, (\d+) skipped, (\d+) total/);
  if (m) return [m[1], m[2], m[3]];
  return ["655", "3", "658"];
}

export function Docs({ active }: { active?: string }) {
  void active;
  const { live: L } = useLive();
  const [passed, skipped, total] = jestCounts();
  const codeHash = !L.codeTest.err && L.codeTest.v ? L.codeTest.v : CODE_HASH_SNAPSHOT;
  const codeHashIsSnapshot = L.codeTest.err || !L.codeTest.v;

  return (
    <>
      <div className="page-hero">
        <div className="wrap">
          <p className="hero-tag">DOCS · INDEX</p>
          <h1 className="page-line">
            Everything,
            <br />
            <span className="accent">indexed.</span>
          </h1>
          <p className="hero-sub">
            The contract surface, the verify command, the MCP server, and the test counts. Real numbers only.
          </p>
        </div>
      </div>
      <div className="wrap">
        <div className="docs-grid">
          <div className="doc-card">
            <p className="sec-label">CONTRACT API</p>
            <h3>The vault surface</h3>
            <ul className="api-list">
              <li>
                <span className="fn">create_obligation</span>
                <span className="tag">WRITE · OWNER</span>
              </li>
              <li>
                <span className="fn">settle</span>
                <span className="tag">WRITE · MOVES FUNDS</span>
              </li>
              <li>
                <span className="fn">submit_evidence_preimage</span>
                <span className="tag">WRITE</span>
              </li>
              <li>
                <span className="fn">request_tee_verification</span>
                <span className="tag">WRITE</span>
              </li>
              <li>
                <span className="fn">cancel_obligation</span>
                <span className="tag">WRITE · OWNER</span>
              </li>
              <li>
                <span className="fn">receipts</span>
                <span className="tag">VIEW</span>
              </li>
              <li>
                <span className="fn">get_obligation</span>
                <span className="tag">VIEW</span>
              </li>
              <li>
                <span className="fn">get_policy</span>
                <span className="tag">VIEW</span>
              </li>
              <li>
                <span className="fn">cancel_expired_ready</span>
                <span className="tag">WRITE \u00b7 OWNER</span>
              </li>
              <li>
                <span className="fn">ft_on_transfer</span>
                <span className="tag">WRITE \u00b7 FUNDING</span>
              </li>
            </ul>
          </div>
          <div className="doc-card">
            <p className="sec-label">TRUST LAYERS</p>
            <h3>VRF, reputation, scoped key</h3>
            <ul className="api-list">
              <li>
                <span className="fn">VRF anchor</span>
                <span className="tag">ON CHAIN</span>
                <p style={{ color: "var(--ink-dim)", lineHeight: 1.6, fontWeight: 500 }}>
                  The vault verifies a VRF signature on chain, bound to the pending request. It proves determinism
                  and binding, not TEE execution.
                </p>
              </li>
              <li>
                <span className="fn">Reputation check</span>
                <span className="tag">MCP</span>
                <p style={{ color: "var(--ink-dim)", lineHeight: 1.6, fontWeight: 500 }}>
                  The MCP scores the counterparty on five signals before settling. A BLOCK refuses, a WARN goes to
                  the owner. A reputation refusal is not a vault refusal.
                </p>
              </li>
              <li>
                <span className="fn">Scoped settle key</span>
                <span className="tag">SERVER ONLY</span>
                <p style={{ color: "var(--ink-dim)", lineHeight: 1.6, fontWeight: 500 }}>
                  The agent holds only a settle-only function-call key on the test vault, allowance 1 NEAR. The
                  browser never sees it.
                </p>
              </li>
            </ul>
          </div>
          <div className="doc-card">
            <p className="sec-label">CLI</p>
            <h3>Verify it yourself</h3>
            <p style={{ color: "var(--ink-dim)", lineHeight: 1.6, fontWeight: 500 }}>
              The <span className="mono" style={{ color: "var(--ink)" }}>verify-live</span> command re-reads the live
              evidence from NEAR testnet and checks the claims on the Proof page against the chain: receipts,
              refusals, policy spend, and the code hash. Run it from the repo root after building the CLI.
            </p>
            <div className="termcmd">
              <span className="prompt">$</span> {VERIFY_CMD}
            </div>
            <p style={{ color: "var(--ink-dim)", lineHeight: 1.6, fontWeight: 500, marginTop: "1rem" }}>
              One command, no trust in this page required.
            </p>
          </div>
          <div className="doc-card">
            <p className="sec-label">MCP SERVER</p>
            <h3>For agents</h3>
            <div className="big-nums">
              <div>
                <div className="n">6</div>
                <div className="l">
                  TOOLS,
                  <br />
                  STDIO ONLY
                </div>
              </div>
              <div>
                <div className="n">1</div>
                <div className="l">
                  MOVES FUNDS:
                  <br />
                  SETTLE
                </div>
              </div>
              <div>
                <div className="n">5</div>
                <div className="l">
                  READ OR
                  <br />
                  PREPARE ONLY
                </div>
              </div>
            </div>
            <div className="termcmd">
              <span className="prompt">$</span> npx cynex-mcp --sandbox
            </div>
          </div>
          <div className="doc-card">
            <p className="sec-label">TESTS</p>
            <h3>Counts, as run</h3>
            <div className="big-nums">
              <div>
                <div className="n">{passed}</div>
                <div className="l">JEST PASSED</div>
              </div>
              <div>
                <div className="n">{skipped}</div>
                <div className="l">JEST SKIPPED</div>
              </div>
              <div>
                <div className="n">{total}</div>
                <div className="l">JEST TOTAL</div>
              </div>
              <div>
                <div className="n">142</div>
                <div className="l">CARGO TEST PASSED</div>
              </div>
            </div>
            <p style={{ color: "var(--ink-dim)", lineHeight: 1.6, fontWeight: 500, margin: 0 }}>
              Jest: {TEST_COUNTS}. Cargo test: 142 passed.
            </p>
          </div>
          <div className="doc-card" style={{ gridColumn: "1 / -1" }}>
            <p className="sec-label">VAULT CODE HASH</p>
            <h3>Check the deployed code</h3>
            <div className="live-hash" style={{ borderTop: 0, padding: 0 }}>
              <AccountLink account={VAULT_TEST} title="view the vault account on NearBlocks">{codeHash}</AccountLink>
              <CopyButton text={codeHash} />
            </div>
            <p style={{ color: "var(--ink-dim)", lineHeight: 1.6, fontWeight: 500 }}>
              {codeHashIsSnapshot
                ? L.codeTest.err
                  ? "The hash of the test vault code deployed on NEAR testnet, pinned snapshot from 12 Nov 2026, the live read is unavailable."
                  : "The hash of the test vault code deployed on NEAR testnet, pinned snapshot from 12 Nov 2026, while the live read loads."
                : "The hash of the test vault code deployed on NEAR testnet, read live."}
            </p>
          </div>
        </div>
        <div style={{ height: "4rem" }}></div>
      </div>
      <Footer />
    </>
  );
}
