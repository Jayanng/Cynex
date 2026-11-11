/* Cynex web, live status strip (on every page).
   The policy cell is wired to the real view method: get_policy with the
   demo policy id p6-001 on the test vault. The old page called get_policy
   with no arguments, which the contract rejects, so the cell showed a
   permanent "Unavailable, retrying". That is fixed here.
   Amounts are shown in base units so the numbers match the demo labels
   (100, 2700); the decimal USDC value is in the title attribute. */

import { VAULT_PROD, VAULT_TEST, TOKEN, RPC_URL } from "../lib/data";
import { useLive, type LiveState } from "../lib/live";
import { fmtToken, fmtTs, trunc } from "../lib/near";
import { Icon, CopyButton, Unavail, LoadTxt } from "./ui";

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

function policyText(p: NonNullable<LiveState["policy"]["v"]>): string {
  const head = headroom(p);
  if (head != null) return "spent " + p.spent + " · headroom " + head + " units";
  return "policy " + p.policy_id;
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
  const cell = (label: string, inner: React.ReactNode) => (
    <div className="strip-cell" key={label}>
      <div className="strip-label">{label}</div>
      <div className="strip-val">{inner}</div>
    </div>
  );
  const f = <T,>(st: { err: boolean; v: T | null }, fn: (v: T) => React.ReactNode) =>
    st.err ? <Unavail /> : st.v == null ? <LoadTxt /> : fn(st.v);

  const recCell = () => {
    if (L.recProd.err || L.recTest.err) return <Unavail />;
    if (L.recProd.v == null || L.recTest.v == null) return <LoadTxt />;
    const ok = L.recProd.link?.allOk && L.recTest.link?.allOk;
    const icon = ok ? (
      <span style={{ color: "var(--pos-text)", width: 16, height: 16, display: "inline-grid", placeItems: "center" }}>
        <Icon name="check" />
      </span>
    ) : (
      <span style={{ color: "var(--warn-text)", width: 16, height: 16, display: "inline-grid", placeItems: "center" }}>
        <Icon name="warn" />
      </span>
    );
    return (
      <>
        {icon} prod {L.recProd.v} · test {L.recTest.v}{" "}
        <span className="dim2 text-xs">
          index contiguity only
        </span>
      </>
    );
  };

  const checked = L.checkedAt ? L.checkedAt.toLocaleTimeString() : null;
  const lastSettle = () => {
    if (L.recTest.err) return <Unavail />;
    if (!L.recTest.rows || !L.recTest.rows.length) return <LoadTxt />;
    const r = L.recTest.rows[L.recTest.rows.length - 1];
    const when = fmtTs(r.timestamp);
    const ref = r.tx_ref ? (
      <a href={"https://testnet.nearblocks.io/txns/" + r.tx_ref} target="_blank" rel="noopener" title={r.tx_ref}>
        {when}
      </a>
    ) : (
      <span title="tx_ref is empty on chain for this receipt">{when}</span>
    );
    return (
      <>
        {ref} <span className="dim2">· #{r.index}</span>
      </>
    );
  };

  return (
    <div className="strip">
      {cell(
        "Last checked",
        checked == null && !L.anyErr ? (
          <LoadTxt />
        ) : L.anyErr && !checked ? (
          <Unavail />
        ) : (
          <>
            <span className={"livedot" + (L.anyErr ? " err" : "")}></span>
            {checked || "-"}
            {L.blockHeight ? <span className="dim2"> · block {String(L.blockHeight)}</span> : null}
          </>
        )
      )}
      {cell(
        "Code hash, prod",
        f(L.codeProd, (v) => (
          <>
            <a
              className="hover:text-ink"
              href={"https://testnet.nearblocks.io/address/" + VAULT_PROD}
              target="_blank"
              rel="noopener"
              title={v}
            >
              {trunc(v, 10, 8)}
            </a>
            <CopyButton text={v} />
          </>
        ))
      )}
      {cell(
        "Code hash, test",
        f(L.codeTest, (v) => (
          <>
            <a
              className="hover:text-ink"
              href={"https://testnet.nearblocks.io/address/" + VAULT_TEST}
              target="_blank"
              rel="noopener"
              title={v}
            >
              {trunc(v, 10, 8)}
            </a>
            <CopyButton text={v} />
          </>
        ))
      )}
      {cell("Receipts, link-check", recCell())}
      {cell(
        "Agent balance",
        f(L.agent, (v) => (
          <span title={"raw: " + String(v) + " · " + fmtToken(v) + " USDC · " + TOKEN + ", 6 decimals"}>
            {String(v)} units
          </span>
        ))
      )}
      {cell(
        "Demo policy, spent and headroom",
        f(L.policy, (v) => <span title={policyTitle(v)}>{policyText(v)}</span>)
      )}
      {cell("Last settle", lastSettle())}
    </div>
  );
}

export function StripSection() {
  return (
    <div className="wrap mt-8">
      <div data-live-region="strip">
        <Strip />
      </div>
      <div className="mono text-xs dim2 mt-2 flex flex-wrap gap-x-5 gap-y-1">
        <span>live RPC reads · {RPC_URL}</span>
        <span>on failure a field shows “Unavailable, retrying”, never a cached value</span>
      </div>
    </div>
  );
}
