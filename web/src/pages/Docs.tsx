/* Cynex web — Docs page.
   The repo's own README and docs, presented as-is in substance — nothing
   rewritten, no caveat summarised away. Each section names its source
   path and last-updated commit. Claims link to their proof.
   Design fix: the layout grid uses minmax(0,1fr) with min-w-0 on the
   content column, so the page cannot scroll sideways. */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AGENT, COMMIT, CP, RPC_URL, TOKEN, VAULT_PROD, VAULT_TEST } from "../lib/data";
import { StripSection } from "../components/Strip";
import { Badge, CmdBlock, CopyButton, HashChip, AcctChip, Icon } from "../components/ui";
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
        <div className="mono text-[11px] dim2 mt-0.5">{sub}</div>
      </div>
      <span className={bad ? "" : ""}>{badge}</span>
      <HashChip hash={tx} />
      <span className="mono text-[11px] dim2">{verdict}</span>
    </div>
  );
}

const REFUSAL_CODES: [string, string][] = [
  ["ERR_RECIPIENT_SUBSTITUTION", "the settle recipient differs from the obligation’s fixed recipient"],
  ["ERR_TERMS_MISMATCH", "amount, token, or obligation id does not match the fixed terms"],
  ["ERR_NONCE_ALREADY_CONSUMED", "this obligation’s nonce was already settled — double-pay attempt"],
  ["ERR_BUDGET_EXCEEDED", "the settle would push cumulative spend past the budget policy"],
  ["ERR_OBLIGATION_EXPIRED", "the obligation expired before settle"],
  ["ERR_POLICY_FROZEN", "the owner froze the policy — all settles refused while frozen"],
];

const SIGNALS: [string, string][] = [
  ["account_existence", "does the counterparty account exist on chain"],
  ["account_age", "how long the account has existed"],
  ["prior_vault_interactions", "history of prior interactions with this vault"],
  ["blocklist", "known-bad counterparty list"],
  ["code_change_recency", "on-chain code hash vs latest snapshot — rule below"],
];

const DOCS: DocSection[] = [
  {
    id: "readme",
    title: "README",
    path: "README.md",
    body: (
      <>
        <p className="dim leading-relaxed mb-4">
          Cynex is a purpose-bound settlement vault for AI agents on NEAR. <b className="text-white">“Pay the obligation. Not the prompt.”</b>{" "}
          A prompt-injected agent can be talked into paying the wrong recipient, the wrong amount, or the same bill twice — so the payment
          decision is moved out of the model and onto the chain.
        </p>
        <p className="dim leading-relaxed mb-4">
          An obligation is created on-chain with fixed terms: recipient, token, amount, obligation id, nonce, budget policy, and an evidence
          requirement. Funding enters only via <span className="mono text-[12.5px] text-white">ft_transfer_call</span>. Settle passes three
          layers: on-chain enforcement, evidence, and a reputation gate — and every settle writes a hash-chained receipt (NEP-297 event).
        </p>
        <h3 className="text-white text-[15px] mt-6 mb-3">Cold run</h3>
        <pre className="codeblock">
          {CP.coldrun}
          <button className="icbtn copyfloat" title="Copy">
            <CopyButton text={CP.coldrun} />
          </button>
        </pre>
        <p className="dim text-[13px] mt-4">
          The verifier is read-only — no keys, no wallet. Current receipt counts are live on the <a href="#/proof">Proof page</a>.
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
    title: "Security model",
    path: "docs/security-model.md",
    body: (
      <>
        <p className="dim leading-relaxed mb-4">
          Threat model: the agent is untrusted. It may be prompt-injected through any content it reads — invoices, web pages, emails, tool
          output. Cynex assumes the agent <i>will</i> eventually be told to pay the wrong party, and makes that instruction worthless.
        </p>
        <h3 className="text-white text-[15px] mt-6 mb-3">
          What function-call keys do <u>not</u> prevent
        </h3>
        <p className="dim leading-relaxed mb-4">
          NEAR function-call access keys restrict <b className="text-white">which methods</b> a key may call, on which contract, within an
          allowance. They do <b className="text-white">not</b> restrict the arguments. An injected agent holding a key for{" "}
          <span className="mono text-[12.5px] text-white">settle</span> can still be talked into calling it with an attacker-chosen
          recipient, an inflated amount, or a duplicate settle — the call is perfectly authorized at the key layer. The key bounds the
          method; only the contract bounds the intent. That is why the terms live on-chain, fixed at obligation creation.
        </p>
        <h3 className="text-white text-[15px] mt-6 mb-3">Refusal codes</h3>
        <div className="overflow-x-auto mb-4">
          <table className="tbl">
            <thead>
              <tr>
                <th>code</th>
                <th>the vault refused because</th>
              </tr>
            </thead>
            <tbody>
              {REFUSAL_CODES.map(([c, why]) => (
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
        <h3 className="text-white text-[15px] mt-6 mb-3">Evidence</h3>
        <p className="dim leading-relaxed mb-3">
          <b className="text-white">PREIMAGE</b> — the SHA-256 hash of the delivery artifact, presented before settle.{" "}
          <b className="text-white">TEE</b> — verification via OutLayer, with a VRF signature bound to the pending request so it cannot be
          replayed against a different obligation.
        </p>
        <div className="callout mono text-[13px]" style={{ color: "#fde68a" }}>
          The VRF signature does not prove TEE execution.
        </div>
        <h3 className="text-white text-[15px] mt-6 mb-3">Reputation gate</h3>
        <p className="dim leading-relaxed">
          Five signals are scored before any settle — see <a href="#/docs/reputation">Reputation signals</a>. BLOCK refusals name the signal
          and its source; WARN escalates to a human unless <span className="mono text-[12.5px] text-white">CYNEX_APPROVE_WARN=1</span>.
        </p>
      </>
    ),
  },
  {
    id: "deployment",
    title: "Deployment & verification",
    path: "docs/deployment.md",
    body: (
      <>
        <p className="dim leading-relaxed mb-4">Four testnet accounts. Every id links to the explorer.</p>
        <div className="overflow-x-auto mb-5">
          <table className="tbl">
            <thead>
              <tr>
                <th>role</th>
                <th>account</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Vault — production", VAULT_PROD],
                ["Vault — test / demo", VAULT_TEST],
                ["Agent (demo recipient)", AGENT],
                ["Token — USDC, 6 decimals", TOKEN],
              ].map(([role, acct]) => (
                <tr key={role}>
                  <td className="dim">{role}</td>
                  <td>
                    <AcctChip account={acct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dim leading-relaxed mb-3">
          Last verified 2026-11-08 @ master <span className="mono text-[12.5px] text-white">{COMMIT}</span>: both vaults ran code hash{" "}
          <span className="mono text-[12px] text-white">65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6</span>.{" "}
          <b className="text-white">This will have moved</b> — re-read it live (the status strip on Landing/Demo does exactly that):
        </p>
        <pre className="codeblock dimc">
          {CP.curlProd}
          <button className="icbtn copyfloat" title="Copy">
            <CopyButton text={CP.curlProd} />
          </button>
        </pre>
        <p className="dim text-[13px] mt-4">
          RPC endpoint: <span className="mono text-[12.5px] text-white">{RPC_URL}</span> · verify receipts end-to-end on the{" "}
          <a href="#/proof">Proof page</a>.
        </p>
      </>
    ),
  },
  {
    id: "p10demo",
    title: "Demo script",
    path: "docs/phase10-demo-script.md",
    body: (
      <>
        <p className="dim leading-relaxed mb-5">
          Executed on the test vault. Walk it interactively in the <a href="#/demo/guided">Guided demo</a>; every tx below links to the
          explorer.
        </p>
        <div className="space-y-3">
          <P10Step t="1 · Happy path — PREIMAGE" sub="p10-demo-preimage-001 · 100 USDC · nonce 1001 · artifact p6-001" tx="3Gp3J2zZCKrne1PamDVf6PgXHk4qGc3a58GBvoFcNhrZ" verdict="PAID · receipt #11 · agent 700 → 800" />
          <P10Step t="2a · Attack — wrong recipient" sub="p10-demo-attack-001 · nonce 1002" tx="AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S" verdict="REFUSED · ERR_RECIPIENT_SUBSTITUTION" bad />
          <P10Step t="2b · Attack — wrong amount (200)" sub="p10-demo-attack-001 · nonce 1002" tx="43YaxJVggxuZ3E25WfjzkgGBsGAqLrj8nwdUU9RLAQRy" verdict="REFUSED · ERR_TERMS_MISMATCH" bad />
          <P10Step t="2c · Correct settle" sub="p10-demo-attack-001 · 100 USDC · nonce 1002" tx="Ho97UjQEDDfe7Go66uHrVSJvbF8narZJ2YBH3hWarxi" verdict="PAID · receipt #12 · agent 800 → 900" />
          <P10Step t="2d · Replay" sub="nonce 1002 reused" tx="AwzQS7XsuGSYnPmvd5jFJzPDs3WDc2gRgSbW3smWq1Cs" verdict="REFUSED · ERR_NONCE_ALREADY_CONSUMED" bad />
          <P10Step t="3a · TEE request" sub="p10-demo-tee-001 · nonce 1003 · OutLayer 11912 · 300 TGas" tx="5Xvu78qxd9NfgJzRBeyvdQXnqK8sLfSmzrfVC5dgDK68" verdict="OK" />
          <P10Step t="3b · TEE settle" sub="VRF bound to the pending request" tx="3QV2aCRSiJ8ZYqLECCpK6ZkXpYE4AdxJzmyP3JTaDqWB" verdict="PAID · receipt #13 · agent 900 → 1000" />
        </div>
        <p className="dim text-[13px] mt-5">
          Step 4 — verification: <span className="mono text-[12.5px]" style={{ color: "#9be7c4" }}>cynex-verify</span> over the test vault,
          all rows verified_ok=true. See <a href="#/docs/p10proof">Proof</a>.
        </p>
      </>
    ),
  },
  {
    id: "p10proof",
    title: "Proof",
    path: "docs/phase10-demo-proof.md",
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
                  <td style={{ color: "#dbe4ee" }}>{ob}</td>
                  <td>
                    <HashChip hash={tx as string} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="text-white text-[15px] mb-3">Verifier output at time of run (master {COMMIT})</h3>
        <pre className="codeblock dimc">
          {`$ cynex-verify --vault ${VAULT_TEST} --rpc ${RPC_URL}
receipts: 23
links recomputed: 23/23
gaps: 0
verified_ok: true (all rows)`}
        </pre>
        <p className="dim text-[13px] mt-4">
          Counts move as the vaults are used — the current numbers are read live on the <a href="#/proof">Proof page</a>.
        </p>
      </>
    ),
  },
  {
    id: "reputation",
    title: "Reputation signals",
    path: "docs/reputation.md",
    body: (
      <>
        <p className="dim leading-relaxed mb-4">
          Five signals, scored before any settle. A BLOCK refusal names the signal and its source. A WARN escalates to a human unless{" "}
          <span className="mono text-[12.5px] text-white">CYNEX_APPROVE_WARN=1</span> is set.
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
                  <td className="mono text-[12px]" style={{ color: "#dbe4ee" }}>
                    {s}
                  </td>
                  <td className="dim">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="text-white text-[15px] mb-3">code_change_recency — thresholds</h3>
        <pre className="codeblock dimc">
          {`source : on-chain code hash vs latest snapshot
ALLOW : no change, or last change > 7 days ago
BLOCK : change within 24h, or any change with no history
WARN  : otherwise — escalates unless CYNEX_APPROVE_WARN=1`}
        </pre>
        <p className="dim text-[13px] mt-4">
          A live gate refusal naming this signal and its source is shown in the <a href="#/demo/guided/gate">Guided demo</a>.
        </p>
      </>
    ),
  },
  {
    id: "receipts",
    title: "Receipts & verification",
    path: "docs/receipts.md",
    body: (
      <>
        <p className="dim leading-relaxed mb-4">
          Every settle writes a receipt as a NEP-297 event. Receipts form a hash chain: each commits to its predecessor, so history cannot
          be edited, reordered, or truncated without breaking a link.
        </p>
        <h3 className="text-white text-[15px] mb-3">Frozen receipt hash</h3>
        <pre className="codeblock">
          {`receipt_hash = SHA-256(
  index ‖ prev_hash ‖ obligation_id ‖ recipient ‖
  amount ‖ token_id ‖ timestamp ‖ tx_ref
)`}
        </pre>
        <h3 className="text-white text-[15px] mt-6 mb-3">cynex-verify</h3>
        <p className="dim leading-relaxed mb-3">
          Replays from genesis via paginated <span className="mono text-[12.5px] text-white">receipts(start, limit)</span>, recomputes every
          link, and detects gaps and mismatches. <b className="text-white">A tamper in receipt i is detected at receipt i+1</b> — even if the
          attacker recomputes receipt i’s stored hash, receipt i+1 still points at the original.
        </p>
        <div className="space-y-2 mb-4">
          <CmdBlock cmdKey="verify" />
          <CmdBlock cmdKey="verifyCsv" />
        </div>
        <h3 className="text-white text-[15px] mb-3">--csv columns (frozen)</h3>
        <pre className="codeblock dimc">index, prev_hash, obligation_id, recipient, amount, token_id, timestamp, tx_ref, verified_ok</pre>
        <p className="dim text-[13px] mt-4">
          The live table with exactly these columns — plus a tamper-and-detect simulation — is on the{" "}
          <a href="#/proof">Proof page</a>.
        </p>
      </>
    ),
  },
  {
    id: "scorecard",
    title: "Scorecard addendum",
    path: "docs/scorecard-addendum.md",
    body: (
      <>
        <p className="dim leading-relaxed mb-5">
          Repository health gates that must stay green. Reproduce any of them with the cold run in the <a href="#/docs/readme">README</a>.
        </p>
        <div className="grid sm:grid-cols-2 gap-3 mb-5">
          {[
            ["Typecheck", "clean"],
            ["Jest", "19 suites · 369 tests"],
            ["Conformance", "6 / 6"],
            ["README cold-run", "verified"],
          ].map(([k, v]) => (
            <div key={k} className="panel p-4 flex items-center justify-between">
              <span className="mono text-[12.5px] dim">{k}</span>
              <span className="badge b-allow">
                <span className="bdot"></span>
                {v}
              </span>
            </div>
          ))}
        </div>
        <p className="dim text-[13px] leading-relaxed">Testnet. The contract is frozen — no new signals, evidence types, or chain changes.</p>
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
        <div className="kicker mb-2">Docs</div>
        <h1 className="text-3xl md:text-4xl mb-2">What is already written</h1>
        <p className="dim text-[14px] max-w-2xl mb-8">
          The repo’s own README and docs, presented as-is in substance — nothing rewritten, no caveat summarised away. Each section names its
          source path and last-updated commit. Claims link to their proof.
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
              placeholder="search docs…"
              style={{ fontFamily: "Inter" }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <nav className="docside space-y-0.5" id="docnav">
              {DOCS.map((d, i) => (
                <a
                  key={d.id}
                  href={"#/docs/" + d.id}
                  data-doc={d.id}
                  className={active === d.id ? "active" : ""}
                  style={{ opacity: matches[i] ? undefined : 0.35 }}
                >
                  {d.title}
                </a>
              ))}
            </nav>
            <div className="mono text-[10.5px] dim2 mt-4" id="doccount">
              {q ? matchCount + " of " + DOCS.length + " sections match" : ""}
            </div>
          </aside>
          <div className="space-y-10 min-w-0" id="docbody">
            {DOCS.map((d, i) => (
              <section
                key={d.id}
                className="docsec panel p-6 md:p-8"
                id={"doc-" + d.id}
                data-title={d.title.toLowerCase()}
                style={{ display: matches[i] ? undefined : "none" }}
              >
                <div className="flex flex-wrap items-center gap-3 mb-5">
                  <h2 className="text-xl md:text-2xl">{d.title}</h2>
                  <span className="hashchip" title="source path">
                    <span>{d.path}</span>
                  </span>
                  <span className="badge b-dim">
                    <span className="bdot"></span>master {COMMIT}
                  </span>
                </div>
                <div className="doc-text">{d.body}</div>
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
