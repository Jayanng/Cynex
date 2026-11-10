/* Shared console primitives: verdicts, badges, chips, panels, terminal blocks,
   signals, states. Dark, precise, every claim carrying its provenance. */

import { useState, type ReactNode, type CSSProperties } from "react";
import { copyText, shortHash, explorerTx, explorerAccount } from "../lib/format";
import { GRADE_LABEL, GRADE_TITLE, type Grade } from "../lib/grades";

export function GradeBadge({ g }: { g: Grade }) {
  const cls =
    g === "chain-read" ? "badge-pos" : g === "historical" ? "badge-accent" : g === "errata" ? "badge-warn" : "badge-info";
  return (
    <span className={`badge ${cls}`} title={GRADE_TITLE[g]}>
      {GRADE_LABEL[g]}
    </span>
  );
}

export function Verdict({
  kind,
  code,
  land = true,
  style,
}: {
  kind: "REFUSED" | "PAID" | "BLOCK" | "ALLOW" | "WARN" | "OK";
  code?: string;
  land?: boolean;
  style?: CSSProperties;
}) {
  const cls =
    kind === "PAID" || kind === "ALLOW" ? "paid" : kind === "WARN" ? "warn" : kind === "OK" ? "info" : "";
  return (
    <div className={`verdict ${cls} ${land ? "verdict-land" : ""}`} style={style}>
      <span className="v-main">{kind}</span>
      {code && <span className="v-code">{code}</span>}
    </div>
  );
}

export function Chip({ value, href, label }: { value: string; href?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const btn = (
    <button
      type="button"
      className="chip"
      title={value}
      onClick={async (e) => {
        e.stopPropagation();
        await copyText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      <span>{shortHash(value)}</span>
      {copied && <span className="copied">COPIED</span>}
    </button>
  );
  return (
    <span className="row" style={{ gap: 8 }}>
      {label && <span className="mono muted" style={{ fontSize: 12 }}>{label}</span>}
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {btn}
        </a>
      ) : (
        btn
      )}
    </span>
  );
}

export function Panel({
  title,
  right,
  children,
  style,
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section className="panel" style={style}>
      {(title || right) && (
        <header className="panel-head">
          {title && <h3 className="panel-title">{title}</h3>}
          {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function CommandBlock({
  label,
  command,
  expected,
}: {
  label: string;
  command: string;
  expected?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cmd">
      <div className="cmd-bar">
        <div className="lights" aria-hidden="true">
          <i /> <i /> <i />
        </div>
        <span className="cmd-label">{label}</span>
        <button
          type="button"
          className="cmd-copy"
          onClick={async () => {
            await copyText(command);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <span className="tok-cmd">$</span> {command}
      </pre>
      {expected && (
        <span className="expect">
          Expected: <b>{expected}</b>
        </span>
      )}
    </div>
  );
}

export function Errata({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="errata">
      <span className="errata-tag">Errata · {title}</span>
      <div>{children}</div>
    </aside>
  );
}

export function Stat({ value, label, tone }: { value: ReactNode; label: string; tone?: string }) {
  return (
    <div>
      <div className="big-num" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function Unavailable({ what = "data" }: { what?: string }) {
  return (
    <span className="state-unavail" role="status">
      unavailable · no cached {what}
    </span>
  );
}

export function Skel({ w = 64 }: { w?: number }) {
  return <span className="skel" style={{ width: w }} aria-hidden="true" />;
}

export function AccountChip({ account }: { account: string }) {
  return <Chip value={account} href={explorerAccount(account)} />;
}

export function TxChip({ tx }: { tx: string }) {
  return <Chip value={tx} href={explorerTx(tx)} />;
}
