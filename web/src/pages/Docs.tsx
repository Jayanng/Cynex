/* Cynex web, Docs page.
   A summary of the repo's own README and docs, with links to the real
   files. This page is not the docs as-is: each section condenses its
   source, names its source path and that file's last-updated commit, and
   keeps the material caveats in view. Claims link to their proof.
   Design fix: the layout grid uses minmax(0,1fr) with min-w-0 on the
   content column, so the page cannot scroll sideways. */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AGENT, CLI_COMMANDS, MASTER_TIP, CONSOLE_FACTS, CONSOLE_RUN, CP, DOC_COMMITS, MCP_FACTS, MCP_RUN, MCP_TOOLS, RPC_URL, SETTLE_CODES, TEST_COUNTS, TOKEN, USECASE, VAULT_PROD, VAULT_TEST } from "../lib/data";
import { useLive } from "../lib/live";
import { StripSection } from "../components/Strip";
import { Badge, CmdBlock, CopyButton, HashChip, Icon, LoadTxt, Unavail } from "../components/ui";
import { Footer } from "../components/shared";

/* Extract plain text from a React tree, for the docs search. */
function reactText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactText).join(" ");
  if (typeof node === "object" && "props" in (node as object)) {
    const p = (node as { props?: { children?: ReactNode } }).props;
    return reactText(p?.children);
  }
  return "";
}

interface DocSection {
  id: string;
  title: string;
  path: string;
  commit: string;
  group: "start" | "reference";
  body: ReactNode;
}

function P10Step({
  t,
  sub,
  tx,
  verdict,
  bad,
}: {
  t: string;
  sub: string;
  tx: string;
  verdict: string;
  bad?: boolean;
}) {
  const badge = verdict.indexOf("REFUSED") === 0 ? (
    <Badge value="REFUSED" extra={verdict.split("· ")[1]} />
  ) : verdict.indexOf("PAID") === 0 ? (
    <Badge value="PAID" />
  ) : (
    <Badge value="OK" />
  );
  return (
    <div className="attempt">
      <div className="min-w-0">
        <div className="att-label">{t}</div>
        <div className="mono text-xs dim2 mt-0.5">{sub}</div>
      </div>
      <span className={bad ? "" : ""}>{badge}</span>
      <HashChip hash={tx} />
      <span className="mono text-xs dim2">{verdict}</span>
    </div>
  );
}

/* Live code hash for one vault, read from the chain, never hardcoded.
   On a failed read the cell shows "Unavailable, retrying". */
function LiveCodeHash({ which }: { which: "test" | "prod" }) {
  const { live: L } = useLive();
  const f = which === "test" ? L.codeTest : L.codeProd;
  if (f.err) return <Unavail />;
  if (f.v == null) return <LoadTxt />;
  return (
    <span className="mono" style={{ overflowWrap: "anywhere" }} title={f.v}>
      {f.v}
    </span>
  );
}

/* Live receipt count expectation line for the demo proof section. */
function LiveReceiptExpectation() {
  const { live: L } = useLive();
  const count = L.recTest.v;
  if (L.recTest.err) return <Unavail />;
  if (count == null) return <LoadTxt />;
  return (
    <span>
      Live now: every row verified_ok = true, {count} receipts on the test vault, all ok.
    </span>
  );
}

/* The use case run, fed by USECASE data: one report, four refusals,
   then paid. The display text is the spec wording, the txs are data. */
const USECASE_RUN: Record<string, string> = {
  "settle before evidence": "Settle before evidence: refused, invalid state.",
  "changed recipient": "Changed recipient: refused, ERR_RECIPIENT_SUBSTITUTION.",
  "changed amount": "Changed amount, 200: refused, ERR_TERMS_MISMATCH.",
  "correct settle": "Correct settle: PAID, receipt 24, agent 2100 to 2200, policy spent 4700 to 4800.",
  replay: "Replay: refused, ERR_NONCE_ALREADY_CONSUMED.",
};

const SIGNALS: [string, string][] = [
  ["account_existence", "does the counterparty account exist on chain, and its current code hash"],
  ["account_age", "a lower bound from snapshots: only as old as the earliest snapshot that shows the account"],
  ["prior_vault_interactions", "history of prior interactions with this vault, from our own receipts"],
  ["blocklist", "a shared blocklist when one is configured; unavailable by default, never invented"],
  ["code_change_recency", "on-chain code hash vs latest snapshot, rule below"],
];

const DOCS: DocSection[] = [
  {
    id: "readme",
    group: "start",
    title: "README",
    path: "README.md",
    commit: DOC_COMMITS.readme,
    body: (
      <>
        <p className="dim leading-relaxed mb-4">
          Cynex is a purpose-bound settlement vault for AI agents on NEAR. <b className="text-ink">“Pay the obligation. Not the prompt.”</b>{" "}
          A prompt-injected agent can be talked into paying the wrong recipient, the wrong amount, or the same bill twice, so the payment
          decision is moved out of the model and onto the chain.
        </p>
        <p className="dim leading-relaxed mb-4">
          An obligation is created on-chain with fixed terms: recipient, token, amount, evidence requirement, and budget. Funding enters only
          via <span className="mono text-[13px] text-ink">ft_transfer_call</span>. Three layers prove a payment is right, and no layer
          trusts another: Layer 1, on-chain integrity, the vault hashes the evidence bytes itself and compares them to the committed digest;
          Layer 2, TEE provenance, a guest fetches the evidence inside an Intel TDX enclave; Layer 3, VRF anchor, the guest requests VRF
          randomness and the vault verifies the signature on chain, bound to the pending request. Reputation is detection, not prevention: it
          informs the owner before settlement, it does not replace the on-chain checks. Every settle writes a hash-chained receipt (NEP-297
          event).
        </p>
        <h3 className="text-ink text-[15px] mt-6 mb-3">Cold run (README Reproduce it, frontend and verify-live steps)</h3>
        <pre className="codeblock">
          {CP.coldrun}
          <button className="icbtn copyfloat" title="Copy">
            <CopyButton text={CP.coldrun} />
          </button>
        </pre>
        <div className="mt-3">
          <CmdBlock cmdKey="verify" />
        </div>
        <p className="dim text-[13px] mt-4">
          The console tsc line exits 2 with 5 known near-api-js type errors, but the emitted dist-test/ is working JavaScript; the errors
          are expected (README.md:506-509). The web typecheck above it is clean. The verifier is read-only, no keys, no wallet. Current
          receipt counts are live on the{" "}
          <a href="#/proof">Proof page</a>.
        </p>
        <p className="dim text-[13px] mt-3">
          Implementation note: this showcase is a React + TypeScript app that reads the chain via near-api-js, the same major version the
          repo uses. Live behaviour is identical: live reads only, no cached values, read-only, no wallet, no writes.
        </p>
      </>
    ),
  },
  {
    id: "security",
    group: "start",
    title: "Security model",
    path: "README.md:223-250 and docs/threat-model.md",
    commit: DOC_COMMITS.security,
    body: (
      <>
        <p className="dim leading-relaxed mb-4">
          Threat model: the agent is untrusted. It may be prompt-injected through any content it reads, invoices, web pages, emails, tool
          output. Cynex assumes the agent will eventually be told to pay the wrong party, and makes that instruction worthless. The
          attacker model: the agent cannot sign as the owner and cannot add keys. What we protect: the authorized terms, the budget, and the
          receipt history.
        </p>
        <h3 className="text-ink text-[15px] mt-6 mb-3">
          What function-call keys do not prevent
        </h3>
        <p className="dim leading-relaxed mb-4">
          NEAR function-call access keys restrict <b className="text-ink">which methods</b> a key may call, on which contract, within an
          allowance. They do <b className="text-ink">not</b> restrict the arguments. An injected agent holding a key for{" "}
          <span className="mono text-[13px] text-ink">settle</span> can still be talked into calling it with a different recipient, an
          inflated amount, or a duplicate settle, and the call is perfectly authorized at the key layer. That is why the terms live on-chain,
          fixed at obligation creation. The key does not prevent the owner from authorizing a bad obligation, and a TEE attestation does not
          prove a real-world delivery happened.
        </p>
        <p className="dim leading-relaxed mb-4">
          The three a judge meets most are recipient substitution, terms mismatch, and replay.
        </p>
        <h3 className="text-ink text-[15px] mt-6 mb-3">Settle refusal codes (all eleven)</h3>
        <div className="overflow-x-auto mb-4">
          <table className="tbl">
            <thead>
              <tr>
                <th>code</th>
                <th>the vault refused because</th>
              </tr>
            </thead>
            <tbody>
              {SETTLE_CODES.map(([c, why]) => (
                <tr key={c}>
                  <td>
                    <span className="codechip">{c}</span>
                  </td>
                  <td className="dim">{why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dim text-[13px] mb-4">
          The contract defines 25 error codes in total; these eleven are the ones settle can return. ERR_TERMS_MISMATCH covers an amount
          mismatch or a policy version mismatch only. Settle has no token argument, and an unknown obligation id is
          ERR_OBLIGATION_MISSING. A bad VRF returns no error code at all: the obligation simply never becomes READY.
        </p>
        <h3 className="text-ink text-[15px] mt-6 mb-3">Evidence</h3>
        <p className="dim leading-relaxed mb-3">
          <b className="text-ink">PREIMAGE</b>, the vault hashes the delivery artifact bytes itself and compares them to the digest
          committed at creation, capped at 64 KiB (MAX_PREIMAGE_BYTES 65536, ERR_EVIDENCE_TOO_LARGE above it).{" "}
          <b className="text-ink">TEE</b>, verification via OutLayer, with a VRF signature bound to the pending request so it cannot be
          replayed against a different obligation. <b className="text-ink">delivery-note</b>, the allowlisted verifier path
          (submit_evidence, TRUSTED_RELAYER), the fallback for oversized evidence. The vault does not verify the TDX quote on chain; quote
          verification is off chain and the VRF signature is the on-chain anchor.
        </p>
        <div className="callout mono text-[13px]">
          The VRF signature does not prove TEE execution.
        </div>
        <h3 className="text-ink text-[15px] mt-6 mb-3">Reputation gate</h3>
        <p className="dim leading-relaxed mb-3">
          Five signals are scored before any settle by the off-chain console gate, never by the vault, see{" "}
          <a href="#/docs/reputation">Reputation signals</a>. BLOCK refusals name the signal and its source; WARN escalates to a human
          unless <span className="mono text-[13px] text-ink">CYNEX_APPROVE_WARN=1</span>.
        </p>
        <h3 className="text-ink text-[15px] mt-6 mb-3">Also in the threat model</h3>
        <p className="dim leading-relaxed">
          Callback failure and reconciliation: a failed transfer is retried up to 3 times, then goes to RECONCILIATION_REQUIRED for a human.
          Funding only by ft_transfer_call. Receipt tampering: genesis prev_hash is 32 zero bytes, and each receipt commits to its
          predecessor. Key theft: a stolen agent key can only call settle, and the vault still enforces the fixed terms. Out of scope:
          the human authorizing a bad obligation, and the meaning of the delivered bytes. TEE requirements: request_tee_verification
          is owner only, with a 0.01 NEAR deposit, 100 TGas for the request plus 50 TGas for the callback. The 300 TGas in the demo is the
          console caller gas, not a contract constant.
        </p>
      </>
    ),
  },
  {
    id: "deployment",
    group: "start",
    title: "Deployment & verification",
    path: "docs/deployment.md",
    commit: DOC_COMMITS.deployment,
    body: (
      <>
        <p className="dim leading-relaxed mb-4">Two testnet vaults, same code. Every id links to the explorer.</p>
        <div className="overflow-x-auto mb-5">
          <table className="tbl">
            <thead>
              <tr>
                <th>vault</th>
                <th>account</th>
                <th>code hash</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Production", VAULT_PROD],
                ["Test / demo", VAULT_TEST],
              ].map(([role, acct]) => (
                <tr key={role}>
                  <td className="dim">{role}</td>
                  <td>
                    <a className="mono" style={{ overflowWrap: "anywhere" }} href={"https://testnet.nearblocks.io/address/" + acct} target="_blank" rel="noopener">
                      {acct}
                    </a>
                  </td>
                  <td>
                    <LiveCodeHash which={role === "Production" ? "prod" : "test"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dim leading-relaxed mb-3">
          Last verified 2026-11-11 @ master <span className="mono text-[13px] text-ink">{MASTER_TIP}</span> (docs/deployment.md last updated d9cdf40): both vaults ran
          the same code hash, read live in the table above.{" "}
          <b className="text-ink">This will have moved</b>, re-read it live (the status strip on Home/Demo does exactly that). Snapshot, 11 Nov 2026: test policy p6-001 funded 10,000, spent 5,400, 31 receipts; agent balance 2,700; production policy
          p5-prod-001 funded 1,000, spent 500, 13 receipts.
        </p>
        <h3 className="text-ink text-[15px] mt-6 mb-3">How to verify (docs/deployment.md:19-38)</h3>
        <pre className="codeblock dimc">
          {`near state cynex-vault.cynexmaster.testnet --networkId testnet
near view cynex-vault.cynexmaster.testnet get_policy '{"policy_id":"p5-prod-001"}' --networkId testnet
node frontend/dist-test/cli/cynex.js verify-live cynex-vault.cynexmaster.testnet`}
        </pre>
        <p className="dim text-[13px] mt-3">
          The doc writes the last command as <span className="mono text-[13px] text-ink">cynex verify-live</span> from frontend/; the
          full invocation is the node form above. TEE guest version <span className="mono text-[13px] text-ink">8abfe08b</span>, VRF
          public key (testnet){" "}
          <span className="mono text-[13px] text-ink" style={{ overflowWrap: "anywhere" }}>
            c0c5aeae1688c2f7cc2350aae1ee3ce96eddc0de84d678db873de48268f8cfa8
          </span>
          .
        </p>
        <h3 className="text-ink text-[15px] mt-6 mb-3">Direct RPC check (not a doc command)</h3>
        <pre className="codeblock dimc">
          {CP.curlProd}
          <button className="icbtn copyfloat" title="Copy">
            <CopyButton text={CP.curlProd} />
          </button>
        </pre>
        <p className="dim text-[13px] mt-4">
          RPC endpoint: <span className="mono text-[13px] text-ink">{RPC_URL}</span> · verify receipts end-to-end on the{" "}
          <a href="#/proof">Proof page</a>.
        </p>
      </>
    ),
  },
  {
    id: "p10demo",
    group: "start",
    title: "Demo run",
    path: "",
    commit: DOC_COMMITS.p10demo,
    body: (
      <>
        <p className="dim leading-relaxed mb-5">
          Executed on the test vault. Walk it interactively in the <a href="#/demo/guided">Guided demo</a>; every tx below links to the
          explorer. All test-vault calls were signed with the owner key cynexmaster.testnet, because the agent&apos;s scoped function-call key
          is bound to the production vault as its receiver and cannot settle on the test vault. The recipient is the agent account, never
          acme-supplies.testnet, which does not exist on chain.
        </p>
        <div className="space-y-3">
          <P10Step t="1 · Happy path, PREIMAGE" sub="p10-demo-preimage-001 · 100 base units (0.0001 test USDC) · nonce 1001 · artifact: delivery note demo-delivery-note-001:p10-demo-preimage-001:100" tx="3Gp3J2zZCKrne1PamDVf6PgXHk4qGc3a58GBvoFcNhrZ" verdict="PAID · receipt #11 · agent 700 → 800" />
          <P10Step t="2a · Attack, wrong recipient" sub="p10-demo-attack-001 · nonce 1002 · proposed recipient was the owner account, cynexmaster.testnet" tx="AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S" verdict="REFUSED · ERR_RECIPIENT_SUBSTITUTION" bad />
          <P10Step t="2b · Attack, wrong amount (200 base units)" sub="p10-demo-attack-001 · nonce 1002" tx="43YaxJVggxuZ3E25WfjzkgGBsGAqLrj8nwdUU9RLAQRy" verdict="REFUSED · ERR_TERMS_MISMATCH" bad />
          <P10Step t="2c · Correct settle" sub="p10-demo-attack-001 · 100 base units (0.0001 test USDC) · nonce 1002" tx="Ho97UjQEDDfe7Go66uHrVSJvbF8narZJ2YBH3hWarxi" verdict="PAID · receipt #12 · agent 800 → 900" />
          <P10Step t="2d · Replay" sub="nonce 1002 reused" tx="AwzQS7XsuGSYnPmvd5jFJzPDs3WDc2gRgSbW3smWq1Cs" verdict="REFUSED · ERR_NONCE_ALREADY_CONSUMED" bad />
          <P10Step t="3a · TEE request" sub="p10-demo-tee-001 · nonce 1003 · OutLayer 11912 · 300 TGas console caller gas" tx="5Xvu78qxd9NfgJzRBeyvdQXnqK8sLfSmzrfVC5dgDK68" verdict="OK" />
          <P10Step t="3b · TEE settle" sub="VRF bound to the pending request" tx="3QV2aCRSiJ8ZYqLECCpK6ZkXpYE4AdxJzmyP3JTaDqWB" verdict="PAID · receipt #13 · agent 900 → 1000" />
        </div>
        <h3 className="text-ink text-[15px] mt-6 mb-3">Use case run: one report, four refusals, then paid</h3>
        <div className="space-y-3 mb-5">
          {USECASE.attacks.map((a) => (
            <div className="attempt" key={a.label}>
              <div className="min-w-0">
                <div className="att-label">{USECASE_RUN[a.label]}</div>
                <div className="mono text-xs dim2 mt-0.5">usecase-report-002 · nonce 30002</div>
              </div>
              {a.code === "PAID" ? <Badge value="PAID" /> : <Badge value="REFUSED" extra={a.code} />}
              <HashChip hash={a.tx} />
            </div>
          ))}
        </div>
        <p className="dim text-[13px] mb-5">
          The correct settle for the attack obligation is receipt 12, transaction Ho97UjQEDDfe7Go66uHrVSJvbF8narZJ2YBH3hWarxi, agent 800 to
          900.
        </p>
        <p className="dim text-[13px] mt-5">
          Final state at demo time (2026-11-08): test policy p6-001 spent 3,700, agent balance 1,000. Live state now is on the status strip. Step 4, verification:{" "}
          <span className="mono text-[13px]" style={{ color: "var(--accent-text)" }}>
            node frontend/dist-test/cli/cynex.js verify-live cynex-testvault.cynexmaster.testnet
          </span>
          , all rows verified_ok=true. See <a href="#/docs/p10proof">Demo proof</a>.
        </p>
      </>
    ),
  },
  {
    id: "p10proof",
    group: "start",
    title: "Demo proof",
    path: "",
    commit: DOC_COMMITS.p10proof,
    body: (
      <>
        <p className="dim leading-relaxed mb-4">Receipts written by the demo run:</p>
        <div className="overflow-x-auto mb-5">
          <table className="tbl">
            <thead>
              <tr>
                <th>receipt</th>
                <th>obligation</th>
                <th>settle tx</th>
              </tr>
            </thead>
            <tbody>
              {[
                [11, "p10-demo-preimage-001", "3Gp3J2zZCKrne1PamDVf6PgXHk4qGc3a58GBvoFcNhrZ"],
                [12, "p10-demo-attack-001", "Ho97UjQEDDfe7Go66uHrVSJvbF8narZJ2YBH3hWarxi"],
                [13, "p10-demo-tee-001", "3QV2aCRSiJ8ZYqLECCpK6ZkXpYE4AdxJzmyP3JTaDqWB"],
              ].map(([n, ob, tx]) => (
                <tr key={String(n)}>
                  <td className="dim">#{n}</td>
                  <td style={{ color: "var(--txt)" }}>{ob}</td>
                  <td>
                    <HashChip hash={tx as string} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="text-ink text-[15px] mb-3">Verifier output at time of run</h3>
        <pre className="codeblock dimc">
          {`$ node frontend/dist-test/cli/cynex.js verify-live ${VAULT_TEST}
index,prev_hash,obligation_id,recipient,amount,token_id,timestamp,tx_ref,verified_ok
... CSV rows, every row verified_ok=true`}
        </pre>
        <p className="dim text-[13px] mt-4">
          The proof doc records 14 receipts, indices 0 to 13, at demo time. Counts move as the vaults are used, the current numbers are read
          live on the <a href="#/proof">Proof page</a>.
        </p>
        <p className="dim text-[13px] mt-3">
          <LiveReceiptExpectation />
        </p>
      </>
    ),
  },
  {
    id: "reputation",
    group: "reference",
    title: "Reputation signals",
    path: "README.md:378-394, docs/scorecard-code-change-recency.md",
    commit: DOC_COMMITS.reputation,
    body: (
      <>
        <p className="dim leading-relaxed mb-4">
          Five signals, scored before any settle by the off-chain console gate, never by the vault. A BLOCK refusal names the signal and its
          source. A WARN escalates to a human unless{" "}
          <span className="mono text-[13px] text-ink">CYNEX_APPROVE_WARN=1</span> is set. Signals show as unavailable when they cannot
          be sourced, and ALLOW needs at least one prior receipt.
        </p>
        <p className="dim text-[13px] mt-3">
          Neutral is not ALLOW: an account with no contract cannot have changed its code, and a first observation with no baseline snapshot is neutral; the signal works from the second check onward.
        </p>
        <div className="overflow-x-auto mb-5">
          <table className="tbl">
            <thead>
              <tr>
                <th>signal</th>
                <th>what it reads</th>
              </tr>
            </thead>
            <tbody>
              {SIGNALS.map(([s, what]) => (
                <tr key={s}>
                  <td className="mono text-xs" style={{ color: "var(--txt)" }}>
                    {s}
                  </td>
                  <td className="dim">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="text-ink text-[15px] mb-3">code_change_recency, thresholds</h3>
        <pre className="codeblock dimc">
          {`source : on-chain code hash vs latest snapshot
ALLOW : no change, or last change > 7 days ago
BLOCK : change within 24h, or any change with no history
WARN  : otherwise, escalates unless CYNEX_APPROVE_WARN=1
neutral: no contract, or first observation, not a penalty`}
        </pre>
        <p className="dim text-[13px] mt-4">
          Blocklist caveat: no suitable shared blocklist for NEAR account ids was found, so the blocklist signal is unavailable unless a URL
          is configured (README.md:613-617). A live gate refusal naming this signal and its source is shown in the{" "}
          <a href="#/demo/guided/gate">Guided demo</a>.
        </p>
      </>
    ),
  },
  {
    id: "receipts",
    group: "reference",
    title: "Receipts & verification",
    path: "docs/contract-api.md",
    commit: DOC_COMMITS.receipts,
    body: (
      <>
        <p className="dim leading-relaxed mb-4">
          Every settle writes a receipt as a NEP-297 event. Receipts form a hash chain: each commits to its predecessor, so history cannot
          be edited, reordered, or truncated without breaking a link. The final receipt is anchored against state() last_receipt_hash.
        </p>
        <h3 className="text-ink text-[15px] mb-3">Frozen receipt hash</h3>
        <pre className="codeblock">
          {`receipt_hash = SHA-256(
  index as u64 big-endian, prev_hash as 32 raw bytes,
  obligation_id as u32 big-endian length-prefixed UTF-8,
  recipient as u32 big-endian length-prefixed UTF-8,
  amount as u128 big-endian,
  token_id as u32 big-endian length-prefixed UTF-8,
  timestamp as u64 big-endian,
  tx_ref as u32 big-endian length-prefixed UTF-8, last
)`}
        </pre>
        <h3 className="text-ink text-[15px] mt-6 mb-3">verify-live</h3>
        <p className="dim leading-relaxed mb-3">
          Replays from genesis via paginated <span className="mono text-[13px] text-ink">receipts(start, limit)</span>, recomputes every
          link, and detects gaps and mismatches. <b className="text-ink">A tamper in receipt i is detected at receipt i+1</b>, because
          receipt i+1 stores the hash of the original receipt i as its prev_hash; no per-receipt hash is stored on chain, only prev_hash in
          the next receipt and last_receipt_hash in state. The in-browser table checks index contiguity only; only the CLI recomputes the
          hash links.
        </p>
        <div className="space-y-2 mb-4">
          <CmdBlock cmdKey="verify" />
          <CmdBlock cmdKey="verifyCsv" />
        </div>
        <h3 className="text-ink text-[15px] mb-3">--csv columns (frozen)</h3>
        <pre className="codeblock dimc">index, prev_hash, obligation_id, recipient, amount, token_id, timestamp, tx_ref, verified_ok</pre>
        <p className="dim text-[13px] mt-4">
          The live table with exactly these columns, plus a tamper-and-detect simulation, is on the{" "}
          <a href="#/proof">Proof page</a>.
        </p>
      </>
    ),
  },
  {
    id: "scorecard",
    group: "reference",
    title: "Scorecard addendum",
    path: "docs/scorecard-code-change-recency.md",
    commit: DOC_COMMITS.scorecard,
    body: (
      <>
        <p className="dim leading-relaxed mb-5">
          Repository health gates that must stay green. Reproduce any of them with the cold run in the <a href="#/docs/readme">README</a>.
        </p>
        <div className="panel p-6 mb-5">
          <div className="flex flex-col">
            {[
              ["Typecheck (web build, tsc -b)", "clean"],
              ["Jest", TEST_COUNTS],
              ["Conformance", "6 / 6"],
              ["Contract tests", "142", "contract/src/lib.rs, #[test] count"],
            ].map(([k, v, src], i, arr) => (
              <div
                key={k}
                className={
                  "flex flex-wrap items-center justify-between gap-2 py-3" +
                  (i === 0 ? " pt-0" : "") +
                  (i === arr.length - 1 ? " pb-0" : " border-b")
                }
                style={{ borderColor: "var(--line2)" }}
              >
                <span className="mono text-xs dim">{k}</span>
                <span className="text-sm font-medium text-ink">
                  {v}
                  {src ? <span className="mono text-xs dim2 block text-right">source: {src}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </div>
        <p className="dim text-[13px] leading-relaxed">
          Typecheck, qualified: the React web build (tsc -b) is clean. The console build tsc invocation is a different typecheck and exits
          2 with 5 known near-api-js type errors (README.md:506-509). Testnet. The contract is frozen, no new signals, evidence types, or
          chain changes.
        </p>
      </>
    ),
  },
  {
    id: "mcp",
    group: "reference",
    title: "MCP server",
    path: "services/mcp/README.md and services/mcp/SECURITY.md",
    commit: DOC_COMMITS.mcp,
    body: (
      <>
        <p className="dim leading-relaxed mb-4">{MCP_FACTS}</p>
        <div className="overflow-x-auto mb-5">
          <table className="tbl">
            <thead>
              <tr>
                <th>tool</th>
                <th>what it does</th>
                <th>moves funds</th>
              </tr>
            </thead>
            <tbody>
              {MCP_TOOLS.map(([name, what, moves]) => (
                <tr key={name}>
                  <td className="mono text-xs" style={{ color: "var(--txt)" }}>
                    {name}
                  </td>
                  <td className="dim">{what}</td>
                  <td>{moves ? <span className="mono text-xs" style={{ color: "var(--amber)" }}>yes, the only one</span> : <span className="mono text-xs dim2">no</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dim text-[13px] leading-relaxed">
          Run it from <span className="mono text-[13px] text-ink">frontend/</span>:{" "}
          <span className="mono text-[13px]" style={{ color: "var(--accent-text)" }}>
            {MCP_RUN}
          </span>
          . Live proof: test matrix 16 pass, 0 fail, 2 skipped (M10/M11 TEE, by design); production happy path mcp-prod-001 PAID.
        </p>
        <h3 className="text-ink text-[15px] mt-6 mb-3">Try it with no funds at stake</h3>
        <div className="mb-4">
          <CmdBlock cmdKey="mcpdemo" />
        </div>
        <p className="dim text-[13px] leading-relaxed">
          The local demo starts a sandbox with the real vault and token contracts, seeds five obligations, and serves the same six tools.
          Nothing is mocked, nothing touches testnet.
        </p>
      </>
    ),
  },
  {
    id: "consoleCli",
    group: "reference",
    title: "Console & CLI",
    path: "agent/console.ts and cli/cynex.ts",
    commit: DOC_COMMITS.consoleCli,
    body: (
      <>
        <p className="dim leading-relaxed mb-4">{CONSOLE_FACTS}</p>
        <p className="dim leading-relaxed mb-4">
          Run it from <span className="mono text-[13px] text-ink">frontend/</span>:{" "}
          <span className="mono text-[13px]" style={{ color: "var(--accent-text)" }}>
            {CONSOLE_RUN}
          </span>
        </p>
        <h3 className="text-ink text-[15px] mt-6 mb-3">CLI commands (node frontend/dist-test/cli/cynex.js &lt;command&gt;)</h3>
        <div className="overflow-x-auto mb-4">
          <table className="tbl">
            <thead>
              <tr>
                <th>command</th>
                <th>invocation</th>
              </tr>
            </thead>
            <tbody>
              {CLI_COMMANDS.map(([name, cmd]) => (
                <tr key={name}>
                  <td className="mono text-xs" style={{ color: "var(--txt)" }}>
                    {name}
                  </td>
                  <td className="dim" style={{ overflowWrap: "anywhere" }}>
                    {cmd}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dim text-[13px] leading-relaxed">
          The CLI is compiled TypeScript; build it with the tsc line in the README cold run first. Cancel and reconciliation also live in
          the contract: cancel_obligation and cancel_expired_ready are owner only (ERR_NOT_EXPIRED while live), the transfer timeout is 10
          minutes, the evidence timeout is 1 hour, and a stuck transfer goes to RECONCILIATION_REQUIRED for a human.
        </p>
      </>
    ),
  },
];

export function Docs({ active }: { active?: string }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const matches = useMemo(() => {
    return DOCS.map((d) => {
      if (!q) return true;
      const hay = (d.title + " " + reactText(d.body)).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }, [q]);
  const matchCount = matches.filter(Boolean).length;

  useEffect(() => {
    if (active) {
      const t = setTimeout(() => {
        const el = document.getElementById("doc-" + active);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
      return () => clearTimeout(t);
    }
  }, [active]);

  return (
    <>
      <StripSection />
      <section className="wrap pt-12">
        <a
          href="#/"
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium mb-4"
          style={{ borderColor: "var(--line)", background: "var(--raised)", color: "var(--secondary)" }}
        >
          ← Home
        </a>
        <div className="kicker mb-2">Docs</div>
        <h1 className="text-3xl md:text-4xl mb-2">Read the record.</h1>
        <p className="dim text-sm max-w-2xl mb-8">
          A summary of the repo&apos;s own README and docs, with links to the real files. Each section condenses its file; the file itself
          is the source of truth.
        </p>
        {/* Grid fix: minmax(0,1fr) keeps the 1fr track from expanding to the
            content width, and min-w-0 on the content column lets it shrink.
            The static page used lg:grid-cols-[250px,1fr] and scrolled to
            2201px at a 1440px viewport. */}
        <div className="grid lg:grid-cols-[250px_minmax(0,1fr)] gap-8 items-start">
          <aside className="lg:sticky lg:top-24 min-w-0">
            <input
              className="input w-full mb-4"
              id="docsearch"
              aria-label="Search docs"
              placeholder="Search"

              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <nav className="docside space-y-0.5" id="docnav">
              {(() => {
                const out: ReactNode[] = [];
                let lastGroup = "";
                DOCS.forEach((d, i) => {
                  if (d.group !== lastGroup) {
                    lastGroup = d.group;
                    out.push(
                      <div key={"g-" + d.group} className="mono text-xs dim2 pt-3 pb-1">
                        {d.group === "start" ? "Start here" : "Reference"}
                      </div>,
                    );
                  }
                  out.push(
                    <a
                      key={d.id}
                      href={"#/docs/" + d.id}
                      data-doc={d.id}
                      className={active === d.id ? "active" : ""}
                      style={{ opacity: matches[i] ? undefined : 0.35 }}
                    >
                      {d.title}
                    </a>,
                  );
                });
                return out;
              })()}
            </nav>
            <div className="mono text-xs dim2 mt-4" id="doccount">
              {q ? matchCount + " of " + DOCS.length + " sections match" : ""}
            </div>
          </aside>
          <div className="space-y-10 min-w-0" id="docbody">
            {DOCS.map((d, i) => (
              <section
                key={d.id}
                className="docsec panel p-6"
                id={"doc-" + d.id}
                data-title={d.title.toLowerCase()}
                style={{ display: matches[i] ? undefined : "none" }}
              >
                <div className="flex flex-wrap items-center gap-3 mb-5">
                  <h2 className="text-xl md:text-2xl">{d.title}</h2>
                  {d.path ? (
                    <span className="hashchip" title={d.path}>
                      <span>{d.path}</span>
                    </span>
                  ) : null}
                  <span className="badge b-dim">
                    <span className="bdot"></span>master {MASTER_TIP}
                  </span>
                  <span className="badge b-dim">
                    <span className="bdot"></span>source updated {d.commit}
                  </span>
                </div>
                <div className="doc-text">{d.body}</div>
                {!q && (
                  <div className="flex flex-wrap justify-between gap-3 border-t pt-4 mt-6" style={{ borderColor: "var(--line2)" }}>
                    {i > 0 ? (
                      <a className="mono text-xs inline-flex items-center gap-2" style={{ color: "var(--accent-text)" }} href={"#/docs/" + DOCS[i - 1].id}>
                        ← {DOCS[i - 1].title}
                      </a>
                    ) : (
                      <span />
                    )}
                    {i < DOCS.length - 1 ? (
                      <a className="mono text-xs inline-flex items-center gap-2" style={{ color: "var(--accent-text)" }} href={"#/docs/" + DOCS[i + 1].id}>
                        {DOCS[i + 1].title} →
                      </a>
                    ) : (
                      <span />
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}

export { Icon };
