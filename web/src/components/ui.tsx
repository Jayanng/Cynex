/* Cynex web, shared UI pieces.
   Ported from the showcase helpers. Two changes from the static page:
   hashes render as short hex with copy and expand (never decimal byte
   lists), and account chips keep the distinguishing middle visible. */

import { useState, type ReactNode } from "react";
import { ICON_PATHS, CP, EX_TX, EX_ADDR } from "../lib/data";
import { bytesToHex, shortHex, trunc } from "../lib/near";

/* ---------- icons ---------- */
export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const d = ICON_PATHS[name] ?? "";
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}

/* ---------- copy ---------- */
export function CopyButton({ text, title }: { text: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={"icbtn" + (copied ? " copied" : "")}
      title={title ?? "Copy"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1100);
        } catch {
          /* clipboard unavailable; nothing to do */
        }
      }}
    >
      <Icon name={copied ? "check" : "copy"} />
    </button>
  );
}

/* ---------- hash / account chips ---------- */
export function HashChip({ hash, type = "tx" }: { hash: string; type?: "tx" | "acct" }) {
  if (!hash) return <span className="dim mono">-</span>;
  const href = type === "acct" ? EX_ADDR(hash) : EX_TX(hash);
  return (
    <span className="hashchip" title={hash}>
      <span>{trunc(hash)}</span>
      <CopyButton text={hash} title="Copy full hash" />
      <a className="icbtn" href={href} target="_blank" rel="noopener" title="Open in explorer">
        <Icon name="ext" />
      </a>
    </span>
  );
}

/* Account chips keep the distinguishing middle: the static page truncated
   both vaults to near-identical "cynex-va…estnet" / "cynex-te…estnet".
   Showing the first 13 characters keeps "vault" vs "testvault" visible. */
export function AcctChip({ account }: { account: string }) {
  if (!account) return <span className="dim mono">-</span>;
  const shown = account.length > 14 ? account.slice(0, 13) + "…" : account;
  return (
    <span className="hashchip" title={account}>
      <span>{shown}</span>
      <CopyButton text={account} title="Copy full account" />
      <a className="icbtn" href={EX_ADDR(account)} target="_blank" rel="noopener" title="Open in explorer">
        <Icon name="ext" />
      </a>
    </span>
  );
}

/* Short hex with copy and full-hex expand. Used for prev_hash and any
   other byte-array hash. Never renders a decimal byte list. */
export function HexHash({ value }: { value: number[] | string | null | undefined }) {
  const hex = bytesToHex(value);
  const [expanded, setExpanded] = useState(false);
  if (!hex) return <span className="dim">-</span>;
  return (
    <span className="inline-flex items-center gap-1" title={hex}>
      <button
        className="mono text-xs hover:text-ink transition-colors"
        style={{ color: "var(--secondary)" }}
        onClick={() => setExpanded((e) => !e)}
        title={expanded ? "Show short hash" : "Show full hash"}
      >
        {expanded ? hex : shortHex(hex)}
      </button>
      <CopyButton text={hex} title="Copy full hash" />
    </span>
  );
}

/* ---------- badges ---------- */
const BADGE_CLASS: Record<string, string> = {
  PAID: "b-paid",
  ALLOW: "b-allow",
  OK: "b-ok",
  REFUSED: "b-refused",
  BLOCKED: "b-blocked",
  BLOCK: "b-blocked",
  WARN: "b-warn",
};
export function Badge({ value, extra }: { value: string; extra?: string | null }) {
  const cls = BADGE_CLASS[value] ?? "b-dim";
  return (
    <>
      <span className={"badge " + cls}>
        <span className="bdot"></span>
        {value}
      </span>
      {extra ? <span className="codechip">{extra}</span> : null}
    </>
  );
}

/* Neutral read-only badge. ALLOW is a reputation verdict, not a verify
   status, so the verify headings no longer carry it. */
export function ReadOnlyBadge() {
  return (
    <span className="badge b-dim">
      <span className="bdot"></span>Read-only
    </span>
  );
}

/* ---------- command block ---------- */
export function CmdBlock({ cmdKey, label }: { cmdKey: string; label?: string }) {
  const txt = CP[cmdKey] ?? "";
  const first = txt.split("\n")[0];
  return (
    <div className="cmd">
      <code>{label || first}</code>
      <CopyButton text={txt} title="Copy command" />
    </div>
  );
}

/* ---------- status ---------- */
export function Unavail() {
  return (
    <span className="unavail">
      <span className="spin"></span>Unavailable, retrying
    </span>
  );
}
export function LoadTxt() {
  return (
    <span className="loadtxt">
      <span className="spin g"></span>Loading live data…
    </span>
  );
}

/* ---------- terms grid / attempt row ---------- */
export function TermsGrid({ terms }: { terms: [string, string][] }) {
  return (
    <div className="terms-grid">
      {terms.map(([k, v]) => (
        <div className="term" key={k}>
          <div className="tl">{k}</div>
          <div className="tv">{v}</div>
        </div>
      ))}
    </div>
  );
}

export function AttemptRow({
  label,
  verdict,
  code,
  tx,
  note,
}: {
  label: string;
  verdict: string;
  code?: string | null;
  tx: string;
  note?: string | null;
}) {
  return (
    <div className="attempt">
      <span className="att-label">{label}</span>
      <span className="flex flex-wrap items-center gap-2">
        <Badge value={verdict} extra={code ?? null} />
      </span>
      <HashChip hash={tx} />
      {note ? <span className="mono text-xs dim2">{note}</span> : null}
    </div>
  );
}

/* ---------- chain-read output (per-step "Read receipt from chain") ---------- */
export function ChainReadOut({
  state,
}: {
  state: { status: "idle" | "loading" | "ok" | "error"; rec: unknown; block: number | null; error?: string } | null;
}) {
  if (!state || state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <div className="mt-3">
        <LoadTxt />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="mt-3 flex items-center gap-3">
        <Unavail />
        <span className="mono text-xs dim2">{state.error ?? ""}</span>
      </div>
    );
  }
  return (
    <div
      className="mt-3 rounded-lg border p-3 fadein"
      style={{ borderColor: "var(--line)", background: "var(--raised)" }}
    >
      <div className="mono text-xs mb-2 flex flex-wrap gap-x-4 gap-y-1" style={{ color: "var(--pos-text)" }}>
        <span>chain read · cynex-testvault.cynexmaster.testnet · receipts</span>
        <span className="dim2">
          {new Date().toLocaleTimeString()}
          {state.block ? " · block " + String(state.block) : ""}
        </span>
      </div>
      <ReceiptJson rec={state.rec} />
    </div>
  );
}

/* Receipt JSON with prev_hash shown as hex, not a decimal byte list,
   and collapsed behind a toggle so it does not eat forty lines. */
export function ReceiptJson({ rec }: { rec: unknown }) {
  const [show, setShow] = useState(false);
  if (rec == null || typeof rec !== "object") return null;
  const r = rec as Record<string, unknown>;
  const display: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === "prev_hash") display[k] = bytesToHex(v as number[] | string);
    else display[k] = v;
  }
  const json = JSON.stringify(display, null, 2);
  return (
    <div>
      <button className="btn sm ghost mb-2" onClick={() => setShow((s) => !s)}>
        {show ? "Hide raw receipt JSON" : "Show raw receipt JSON"}
      </button>
      {show ? (
        <pre className="mono text-xs leading-relaxed overflow-x-auto" style={{ color: "var(--secondary)" }}>
          {json}
        </pre>
      ) : null}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
