/* Cynex web, try to break it, plus demo-token live mode.
   Your pick is a simulation, labelled as one, it is evaluated in the
   browser against the real on-chain obligation terms. The refusal it
   shows is the real on-chain verdict for the first three attacks, which
   were executed on the test vault and link to their real refusal
   transactions. The fourth attack was never executed on chain, so its
   verdict is simulated, not a real on-chain verdict.
   Live mode signs a real settle call with the demo key via the bundled
   near-api-js (not a CDN). Only attacks are offered in live mode, never
   a correct settle. Any failure that is NOT a vault refusal is reported
   plainly and falls back to the simulated panel, never presented as a
   refusal. */

import { useState } from "react";
import { JsonRpcProvider, KeyPairSigner, Account } from "near-api-js";
import { AUTHORIZED_TERMS, BREAK_IT, DEMO_ATTACKER, DEMO_LIVE_LABEL, DEMO_TOKEN, RPC_URL, VAULT_TEST } from "../lib/data";
import { evaluateBreakItForm, type BreakItFormMode, type BreakItFormOut } from "../lib/breakItForm";
import { useLive } from "../lib/live";
import { getObligation, type Obligation } from "../lib/near";
import { Badge, HashChip, TermsGrid } from "./ui";
import { RefusalBreakdown } from "./shared";

function demoKeyConfigured(): boolean {
  return !!(
    DEMO_TOKEN.enabled &&
    DEMO_TOKEN.accountId &&
    DEMO_TOKEN.publicKey &&
    DEMO_TOKEN.privateKey &&
    DEMO_TOKEN.readyObligationId &&
    DEMO_TOKEN.pendingObligationId
  );
}

function liveTargetId(b: (typeof BREAK_IT)[number]): string {
  if (b.live.obligation === "ready") return DEMO_TOKEN.readyObligationId;
  if (b.live.obligation === "pending") return DEMO_TOKEN.pendingObligationId;
  return b.live.obligation;
}

function errCodeFromText(txt: unknown): string | null {
  const m = String(txt ?? "").match(/ERR_[A-Z_]+/);
  return m ? m[0] : null;
}

function txHashFromError(e: unknown): string | null {
  const o = e as Record<string, unknown> | null;
  const cands = [
    o && (o.transaction as Record<string, unknown> | undefined)?.hash,
    o && ((o.context as Record<string, unknown> | undefined)?.transaction as Record<string, unknown> | undefined)?.hash,
    o && ((o.outcome as Record<string, unknown> | undefined)?.transaction as Record<string, unknown> | undefined)?.hash,
    o && o.transactionHash,
  ];
  for (const c of cands) {
    if (typeof c === "string" && c.length >= 40) return c;
  }
  const m = String((o && (o.message as string)) || e || "").match(/[1-9A-HJ-NP-Za-km-z]{43,44}/);
  return m ? m[0] : null;
}

function isKeyExhausted(e: unknown): boolean {
  const o = e as Record<string, unknown> | null;
  const s = String((o && (o.message as string)) || e || "").toLowerCase();
  return (
    s.indexOf("allowance") >= 0 ||
    s.indexOf("not enough balance") >= 0 ||
    s.indexOf("does not have enough") >= 0 ||
    s.indexOf("access key") >= 0 ||
    (s.indexOf("key") >= 0 && s.indexOf("does not exist") >= 0)
  );
}

function errText(e: unknown): string {
  const o = e as Record<string, unknown> | null;
  return String((o && (o.message as string)) || e);
}

interface LiveOut {
  kind: "info" | "warn" | "refused" | "success";
  html: React.ReactNode;
}

export function BreakIt() {
  const { live, refreshLive } = useLive();
  const [selected, setSelected] = useState(0);
  const [formRecipient, setFormRecipient] = useState(DEMO_ATTACKER);
  const [formAmount, setFormAmount] = useState<string>(AUTHORIZED_TERMS.amount); // string, not the as-const literal type
  const [formMode, setFormMode] = useState<BreakItFormMode>("terms");
  const [formOut, setFormOut] = useState<BreakItFormOut | null>(null);
  const [liveStatus, setLiveStatus] = useState<{ text: string; cls: string }>({ text: "not configured", cls: "b-dim" });
  const [liveOut, setLiveOut] = useState<LiveOut | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);

  const b = BREAK_IT[selected];

  const renderBreak = (i: number) => {
    setSelected(i);
    setLiveOut(null);
    setFormOut(null);
    /* The buttons are the fast path to each named attack; they set the
       form to that attack's tampered values, so Run attack shows the
       matching refusal. Recipient and amount attacks change a field;
       replay resubmits the consumed nonce and remove-evidence submits
       with no evidence, both keeping the authorized recipient and amount. */
    const sc = BREAK_IT[i];
    setFormMode(sc.key === "replay" ? "replay" : sc.key === "evidence" ? "evidence" : "terms");
    setFormRecipient(sc.key === "recipient" ? DEMO_ATTACKER : AUTHORIZED_TERMS.recipient);
    /* The inflated amount is twice the authorized amount, so it follows AUTHORIZED_TERMS. */
    setFormAmount(sc.key === "amount" ? String(BigInt(AUTHORIZED_TERMS.amount) * 2n) : AUTHORIZED_TERMS.amount);
  };

  /* Free-form path: evaluate the proposed terms in the browser against
     the fixed on-chain terms. The logic lives in lib/breakItForm so Jest
     can cover it; the refusal shown is the recorded one from the test
     vault, not a fresh live attempt from this click. */
  const runFormAttack = () => {
    setFormOut(evaluateBreakItForm(formRecipient, formAmount, formMode));
  };

  const tryLiveAttack = async (i: number) => {
    const sc = BREAK_IT[i];
    setLiveBusy(true);
    setLiveStatus({ text: "checking…", cls: "b-warn" });
    const fail = (text: string, status: string) => {
      setLiveStatus({ text: status, cls: "b-warn" });
      setLiveOut({ kind: "warn", html: <div className="callout mono text-[13px]">{text}</div> });
      setLiveBusy(false);
    };
    if (!demoKeyConfigured()) {
      fail(
        "Live mode is not configured yet, the demo key has not been supplied by Johnson. Showing the simulated refusal instead.",
        "not configured"
      );
      return;
    }
    const targetId = liveTargetId(sc);
    setLiveOut({
      kind: "info",
      html: (
        <div className="mt-1">
          <span className="loadtxt">
            <span className="spin g"></span>Loading live data…
          </span>{" "}
          <span className="dim text-xs">reading target obligation {targetId} from the test vault…</span>
        </div>
      ),
    });
    let before: Obligation | null;
    try {
      before = await getObligation(VAULT_TEST, targetId);
    } catch (e) {
      fail(
        "Live mode unavailable: could not read the target obligation from the chain (" + errText(e) + "). Showing the simulated refusal instead.",
        "unavailable"
      );
      return;
    }
    if (!before) {
      fail(
        "Live mode unavailable: obligation " + targetId + " was not found on the test vault. Showing the simulated refusal instead.",
        "unavailable"
      );
      return;
    }
    const need = sc.live.expectState;
    const stateOk =
      need === "READY"
        ? before.state === "READY" && !before.in_flight
        : need === "PAID"
          ? before.state === "PAID"
          : before.state !== "READY" && before.state !== "PAID" && !before.in_flight;
    if (!stateOk) {
      fail(
        "Live mode unavailable for this attack right now: obligation " +
          targetId +
          " is " +
          before.state +
          (before.in_flight ? " (in flight)" : "") +
          ", but this attack needs it " +
          (need === "NOT_READY" ? "not READY and not PAID" : need) +
          ". The obligation may have been settled or its state may have moved, Johnson needs to supply a fresh demo obligation. Showing the simulated refusal instead.",
        "unavailable"
      );
      return;
    }
    const receiptsBefore = live.recTest && live.recTest.rows ? live.recTest.rows.length : null;
    setLiveOut({
      kind: "info",
      html: (
        <div className="mt-1">
          <span className="loadtxt">
            <span className="spin g"></span>Loading live data…
          </span>{" "}
          <span className="dim text-xs">signing a real settle call with the demo key…</span>
        </div>
      ),
    });
    let txHash: string | null = null;
    let code: string | null = null;
    let threw: unknown = null;
    try {
      const provider = new JsonRpcProvider({ url: RPC_URL });
      const signer = KeyPairSigner.fromSecretKey(
        DEMO_TOKEN.privateKey as unknown as Parameters<typeof KeyPairSigner.fromSecretKey>[0]
      );
      const account = new Account(DEMO_TOKEN.accountId, provider, signer);
      const outcome = await account.callFunctionRaw({
        contractId: VAULT_TEST,
        methodName: "settle",
        args: {
          obligation_id: targetId,
          proposed_recipient: sc.live.recipient,
          proposed_amount: sc.live.amount,
          evidence_ref: "",
        },
        gas: 100000000000000n,
      });
      txHash = outcome && outcome.transaction ? outcome.transaction.hash : null;
    } catch (e) {
      threw = e;
      txHash = txHashFromError(e);
      code = errCodeFromText(e);
      if (!code) code = errCodeFromText(errText(e));
    }
    if (!threw) {
      // An attack must never succeed. If it did, say so loudly, do not present a pay-out as a refusal.
      setLiveStatus({ text: "unexpected success", cls: "b-warn" });
      setLiveOut({
        kind: "warn",
        html: (
          <div className="callout red mono text-[13px]">
            Unexpected: the live settle attempt succeeded (tx {txHash || "unknown"}). This attack was supposed to be refused. Do not trust
            this panel, the demo obligation may have been consumed. Showing the simulated refusal instead.
          </div>
        ),
      });
      setLiveBusy(false);
      return;
    }
    if (!txHash) {
      fail(
        "The live attempt failed, but no transaction hash could be recovered, so it is NOT shown as a refusal. Error: " +
          errText(threw) +
          ". Showing the simulated refusal instead.",
        "unavailable"
      );
      return;
    }
    if (isKeyExhausted(threw)) {
      fail(
        "The demo key is exhausted (allowance used up) or its key is no longer valid. Live mode is off until Johnson supplies a fresh demo key. Showing the simulated refusal instead.",
        "key exhausted"
      );
      return;
    }
    if (!code) {
      fail(
        "The live attempt failed, but the vault refusal code could not be read from the error, so it is NOT shown as a refusal. Tx " +
          txHash +
          ". Error: " +
          errText(threw) +
          ". Showing the simulated refusal instead.",
        "unavailable"
      );
      return;
    }
    // Confirm nothing moved: obligation state unchanged and no new receipt.
    let after: Obligation | null = null;
    let moved = false;
    try {
      after = await getObligation(VAULT_TEST, targetId);
      moved = !!(after && after.state !== before.state);
    } catch {
      /* state re-read failed; the tx hash itself is the proof, say so below */
    }
    await refreshLive();
    const receiptsAfter = live.recTest && live.recTest.rows ? live.recTest.rows.length : null;
    if (receiptsBefore != null && receiptsAfter != null && receiptsAfter !== receiptsBefore) moved = true;
    setLiveStatus({ text: "live refusal", cls: "b-refused" });
    setLiveOut({
      kind: "refused",
      html: (
        <div className="fadein">
          <div className="attempt mb-3">
            <span className="att-label">
              live settle attempt · {sc.label.toLowerCase()} · obligation {targetId}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <Badge value="REFUSED" extra={code} />
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="mono text-xs dim2 ">real refusal tx</span>
            <HashChip hash={txHash} />
            <a className="btn btn-primary sm" href={"https://testnet.nearblocks.io/txns/" + txHash} target="_blank" rel="noopener">
              Read it from the chain
            </a>
            <span className="mono text-xs text-ink">0 tokens moved</span>
          </div>
          <div className="mono text-xs dim2 mt-3">
            Checked after the refusal: obligation is still {after ? after.state : before.state}
            {moved ? ", warning: state moved, see above." : " · no new receipt · nothing paid"}. Attempt was your choice (simulation);
            the refusal is a real on-chain verdict.
          </div>
        </div>
      ),
    });
    setLiveBusy(false);
  };

  return (
    <section className="wrap mt-24">
      <div className="panel p-6">
        <div className="kicker mb-2">01&nbsp;&nbsp;BreakIt</div>
        <h2 className="text-2xl md:text-3xl mb-2">Try to pay a different recipient and the vault must refuse.</h2>
        <p className="dim text-sm max-w-3xl leading-relaxed mb-5">
          The obligation on chain names one recipient and one amount. Change either one and submit. The refusal below is the recorded one
          from the test vault, not a fresh live attempt from your click.
        </p>
        <div className="mb-5">
          <div className="grid gap-4 md:grid-cols-2 mb-4">
            <div>
              <label className="mono text-xs dim2 block mb-2" htmlFor="bi-recipient">
                Proposed recipient
              </label>
              <input
                id="bi-recipient"
                className="input w-full mono"
                value={formRecipient}
                onChange={(e) => {
                  setFormRecipient(e.target.value);
                  setFormMode("terms");
                }}
              />
            </div>
            <div>
              <label className="mono text-xs dim2 block mb-2" htmlFor="bi-amount">
                Proposed amount, base units
              </label>
              <input
                id="bi-amount"
                className="input w-full mono"
                value={formAmount}
                onChange={(e) => {
                  setFormAmount(e.target.value);
                  setFormMode("terms");
                }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary sm" onClick={runFormAttack}>
              Run attack
            </button>
            <span className="mono text-xs dim2">
              Authorized: <span className="text-ink">{AUTHORIZED_TERMS.recipient}</span>, {AUTHORIZED_TERMS.amount} base units, nonce {AUTHORIZED_TERMS.nonce}.
            </span>
          </div>
          {formMode === "replay" ? (
            <p className="mono text-xs dim2 mt-3">Replay selected: resubmits nonce {AUTHORIZED_TERMS.nonce}, already consumed by receipt 12.</p>
          ) : formMode === "evidence" ? (
            <p className="mono text-xs dim2 mt-3">Remove the evidence selected: submits with no evidence presented.</p>
          ) : null}
          {formOut ? (
            <div className="mt-4 border-t pt-4 fadein" style={{ borderColor: "var(--line2)" }}>
              {formOut.kind === "refused" ? (
                <>
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <Badge value="REFUSED" extra={formOut.code} />
                  </div>
                  <p className="dim text-sm leading-relaxed mb-3">{formOut.text}</p>
                  {formOut.tx ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="mono text-xs dim2">recorded refusal tx</span>
                      <HashChip hash={formOut.tx} />
                      <span className="mono text-xs text-ink">0 tokens moved</span>
                    </div>
                  ) : null}
                  <p className="mono text-xs dim2 mt-3">
                    {formOut.note ??
                      "Recorded refusal from the test vault. A live attempt from this panel needs the demo key, which the live site supplies through the Run it live button."}
                  </p>
                </>
              ) : formOut.kind === "invalid" ? (
                <>
                  <p className="dim text-sm leading-relaxed">{formOut.text}</p>
                  <p className="mono text-xs dim2 mt-3">
                    Nothing was submitted, and no live attempt was made from this panel.
                  </p>
                </>
              ) : (
                <>
                  <p className="dim text-sm leading-relaxed">{formOut.text}</p>
                  <p className="mono text-xs dim2 mt-3">
                    Nothing was refused, because the proposed terms match the authorized terms.
                  </p>
                  <p className="mono text-xs dim2 mt-3">
                    No live attempt was made from this panel. A live attempt needs the demo key, which the live site supplies through the Run it live button.
                  </p>
                </>
              )}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 mb-5">
          {BREAK_IT.map((sc, i) => (
            <button key={sc.key} className={"btn sm " + (i === selected ? "btn-primary" : "")} onClick={() => renderBreak(i)}>
              {sc.label}
            </button>
          ))}
        </div>
        <div>
          <div className="fadein">
            <div className="terms-grid mb-4">
              <TermsGrid
                terms={[
                  ["obligation", AUTHORIZED_TERMS.obligation],
                  ["recipient (fixed)", AUTHORIZED_TERMS.recipient],
                  ["amount (fixed)", AUTHORIZED_TERMS.amount + " base units (0.0001 USDC)"],
                  ["nonce", String(AUTHORIZED_TERMS.nonce)],
                  ["evidence", "PREIMAGE"],
                ]}
              />
            </div>
            <div className="attempt mb-3">
              <span className="att-label">{b.attempt}</span>
              <span className="flex flex-wrap items-center gap-2">
                <Badge value="REFUSED" extra={b.code} />
              </span>
            </div>
            <p className="dim text-sm leading-relaxed mb-4">{b.why}</p>
            {b.tx ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="mono text-xs dim2 ">real refusal tx</span>
                <HashChip hash={b.tx} />
                <span className="mono text-xs dim2">0 tokens moved</span>
              </div>
            ) : (
              <div className="mono text-xs" style={{ color: "var(--warn-text)" }}>
                No executed refusal transaction exists for this case in the demo run, simulation only, no tx invented.
              </div>
            )}
          </div>
        </div>
        <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--line2)" }}>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <span className="kicker">Live mode, try it on chain</span>
            <span id="live-status" className={"badge " + liveStatus.cls}>
              <span className="bdot"></span>
              {liveStatus.text}
            </span>
          </div>
          <p className="dim text-[13px] leading-relaxed mb-3">
            {DEMO_LIVE_LABEL} Only attacks are offered in live mode, never a correct settle, because a correct settle would pay the
            authorized recipient and consume a demo obligation. Your pick is a simulation of your choice; a live refusal it produces is a real
            on-chain verdict, while the simulated fourth attack has no live verdict.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary sm" disabled={liveBusy} onClick={() => void tryLiveAttack(selected)}>
              Try this attack live on chain
            </button>
            {demoKeyConfigured() ? (
              <span className="mono text-xs dim2">signs a real settle call with the demo key · test vault only</span>
            ) : (
              <span className="mono text-xs dim2">
                live mode not configured, the demo key has not been supplied by Johnson; the simulated refusal above is the real on-chain
                verdict for the first three attacks
              </span>
            )}
          </div>
          <div id="live-out" className="mt-4">{liveOut ? liveOut.html : null}</div>
        </div>
        <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--line2)" }}>
          <h3 className="text-lg mb-2 text-ink">Why the vault refused, item by item</h3>
          <p className="dim text-sm leading-relaxed mb-4 max-w-3xl">
            The same four checks as on Home, with the live refusal transaction next to the recipient row. Every row ends with 0 tokens moved.
          </p>
          <RefusalBreakdown />
        </div>
      </div>
    </section>
  );
}

export { DEMO_ATTACKER };
