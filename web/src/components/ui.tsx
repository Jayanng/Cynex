/* Shared dossier primitives: grades, stamps, chips, figures, commands,
   errata notes, states. Small, typed, no decoration without a job. */

import { useState, type ReactNode } from "react";
import { GRADE_LABEL, GRADE_TITLE, type Grade } from "../lib/grades";
import { copyText, shortHash, explorerTx } from "../lib/format";

export function Grade({ g }: { g: Grade }) {
  return (
    <span className={`grade grade-${g}`} title={GRADE_TITLE[g]}>
      {GRADE_LABEL[g]}
    </span>
  );
}

export function Figure({
  grade,
  caption,
  children,
}: {
  grade: Grade;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <figure className="fig">
      {children}
      <figcaption>
        <Grade g={grade} />
        {caption && <span>{caption}</span>}
      </figcaption>
    </figure>
  );
}

export function HashChip({ value, href, label }: { value: string; href?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const inner = (
    <button
      type="button"
      className="hashchip"
      onClick={async (e) => {
        e.stopPropagation();
        await copyText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      title={value}
    >
      <span>{shortHash(value)}</span>
      {copied && <span className="copied">COPIED</span>}
    </button>
  );
  return (
    <span>
      {label && <span className="mono small"> {label}</span>}{" "}
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
          {inner}
        </a>
      ) : (
        inner
      )}
    </span>
  );
}

export function VerdictStamp({
  verdict,
  code,
  landed = true,
}: {
  verdict: "REFUSED" | "PAID" | "OK";
  code?: string;
  landed?: boolean;
}) {
  const cls = verdict === "PAID" ? "paid" : verdict === "OK" ? "ok" : "";
  return (
    <div className={`stamp ${cls} ${landed ? "stamp-land" : ""}`}>
      <span className="stamp-v">{verdict}</span>
      {code && <span className="stamp-c">{code}</span>}
    </div>
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
      <pre>{command}</pre>
      {expected && <span className="cmd-exp">Expected: {expected}</span>}
    </div>
  );
}

export function ErrataNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="errata">
      <span className="errata-tag">Errata, {title}</span>
      <div>{children}</div>
    </aside>
  );
}

export function Marginalia({ children }: { children: ReactNode }) {
  return <aside className="marginalia">{children}</aside>;
}

export function Unavailable({ what = "data" }: { what?: string }) {
  return (
    <span className="state-unavailable" role="status">
      Unavailable, retrying. No cached {what} shown.
    </span>
  );
}

export function Skel({ w = 64 }: { w?: number }) {
  return <span className="skel" style={{ width: w }} aria-hidden="true" />;
}

export function TxLink({ tx, verdict }: { tx: string; verdict: string }) {
  return (
    <span className="ex-tx">
      <Grade g="historical" />
      <HashChip value={tx} href={explorerTx(tx)} />
      <span className="small mono">{verdict}</span>
    </span>
  );
}
