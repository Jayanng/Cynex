/* Cynex web, live status strip (on every page).
   Five live stats, all read from the chain at runtime: receipts on both
   vaults, demo policy spent, agent balance, and the code hash. Nothing
   here is hardcoded: a failed read shows "Unavailable, retrying", never
   a stale or cached number.
   Amounts are shown in base units so the numbers match the demo labels
   (100, 2700); the decimal USDC value is in the title attribute. */

import { VAULT_PROD, VAULT_TEST, TOKEN, RPC_URL } from "../lib/data";
import { useLive, type LiveState } from "../lib/live";
import { fmtToken, trunc } from "../lib/near";
import { policySpentPct } from "../lib/policyPct";
import { CopyButton, Unavail, LoadTxt } from "./ui";

/* Spendable headroom is min(limit, funded) minus spent minus reserved:
   the contract checks spent plus reserved plus amount against both limit
   and funded at settle time (contract/src/lib.rs:1538-1543). */
function headroom(p: NonNullable<LiveState["policy"]["v"]>): string | null {
  try {
    const limit = BigInt(p.limit);
    const funded = BigInt(p.funded);
    const spent = BigInt(p.spent);
    const reserved = BigInt(p.reserved);
    const cap = limit < funded ? limit : funded;
    return (cap - spent - reserved).toString();
  } catch {
    return null;
  }
}

function policyTitle(p: NonNullable<LiveState["policy"]["v"]>): string {
  const head = headroom(p);
  try {
    return (
      "spent " +
      fmtToken(p.spent) +
      " USDC · headroom " +
      (head == null ? "?" : fmtToken(head)) +
      " USDC · limit " +
      fmtToken(p.limit) +
      " USDC · funded " +
      fmtToken(p.funded) +
      " USDC · reserved " +
      fmtToken(p.reserved) +
      " USDC · " +
      TOKEN +
      ", 6 decimals"
    );
  } catch {
    return "policy " + p.policy_id;
  }
}

export function Strip() {
  const { live: L } = useLive();
  const f = <T,>(st: { err: boolean; v: T | null }, fn: (v: T) => React.ReactNode) =>
    st.err ? <Unavail /> : st.v == null ? <LoadTxt /> : fn(st.v);

  const policyCell = () => {
    if (L.policy.err) return <Unavail />;
    if (L.policy.v == null) return <LoadTxt />;
    const p = L.policy.v;
    const pct = policySpentPct(p.spent, p.limit);
    return (
      <span className="block w-full" title={policyTitle(p)}>
        <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>
          {p.spent} <small style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)" }}>of {p.limit}</small>
        </span>
        {pct != null ? (
          <span className="statbar">
            <i style={{ width: pct + "%" }}></i>
          </span>
        ) : null}
      </span>
    );
  };

  const codeCell = () => {
    if (L.codeProd.err || L.codeTest.err) return <Unavail />;
    if (L.codeProd.v == null || L.codeTest.v == null) return <LoadTxt />;
    const prod = L.codeProd.v;
    const test = L.codeTest.v;
    if (prod === test) {
      return (
        <span className="inline-flex items-center gap-2 min-w-0">
          <a
            className="hover:text-ink mono"
            href={"https://testnet.nearblocks.io/address/" + VAULT_TEST}
            target="_blank"
            rel="noopener"
            title={test + " (same on both vaults)"}
            style={{ overflowWrap: "anywhere" }}
          >
            {trunc(test, 10, 8)}
          </a>
          <CopyButton text={test} />
          <span className="dim2 text-xs">same on both vaults</span>
        </span>
      );
    }
    return (
      <span className="inline-flex flex-col gap-1 min-w-0">
        <span className="inline-flex items-center gap-2">
          <span className="dim2 text-xs">test</span>
          <a className="hover:text-ink mono" href={"https://testnet.nearblocks.io/address/" + VAULT_TEST} target="_blank" rel="noopener" title={test}>
            {trunc(test, 10, 8)}
          </a>
          <CopyButton text={test} />
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="dim2 text-xs">prod</span>
          <a className="hover:text-ink mono" href={"https://testnet.nearblocks.io/address/" + VAULT_PROD} target="_blank" rel="noopener" title={prod}>
            {trunc(prod, 10, 8)}
          </a>
          <CopyButton text={prod} />
        </span>
      </span>
    );
  };

  const cell = (label: string, inner: React.ReactNode) => (
    <div className="strip-cell" key={label}>
      <div className="strip-label">{label}</div>
      <div className="strip-val">{inner}</div>
    </div>
  );

  return (
    <div className="statgrid">
      {cell("Receipts, test vault", f(L.recTest, (v) => <span style={{ fontSize: 15, fontWeight: 700 }}>{v}</span>))}
      {cell("Receipts, production vault", f(L.recProd, (v) => <span style={{ fontSize: 15, fontWeight: 700 }}>{v}</span>))}
      {cell("Demo policy spent", policyCell())}
      {cell(
        "Agent balance, test USDC",
        f(L.agent, (v) => (
          <span title={"raw: " + String(v) + " · " + fmtToken(v) + " USDC · " + TOKEN + ", 6 decimals"} style={{ fontSize: 15, fontWeight: 700 }}>
            {String(v)}
          </span>
        ))
      )}
      {cell("Code hash, both vaults", codeCell())}
    </div>
  );
}

export function StripSection() {
  const { live: L } = useLive();
  const checked = L.checkedAt ? L.checkedAt.toLocaleTimeString() : null;
  return (
    <div className="wrap mt-8">
      <div data-live-region="strip">
        <Strip />
      </div>
      <div className="mono text-xs dim2 mt-2 flex flex-wrap gap-x-5 gap-y-1">
        <span>live RPC reads · {RPC_URL}</span>
        <span>on failure a field shows “Unavailable, retrying”, never a cached value</span>
        {checked ? (
          <span>
            Last read {checked}
            {L.blockHeight ? " · block " + String(L.blockHeight) : ""}
          </span>
        ) : null}
      </div>
    </div>
  );
}
