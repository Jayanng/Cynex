/* Cynex web, live status strip.
   The policy cell is wired to the real view method: get_policy with the
   demo policy id p6-001 on the test vault. The old page called get_policy
   with no arguments, which the contract rejects, so the cell showed a
   permanent "Unavailable, retrying". That is fixed here.
   Amounts are shown in base units so the numbers match the demo labels
   (100, 2700); the decimal USDC value is in the title attribute.
   Demo settles left counts the demo-live-* obligations already settled
   in the test receipts, so the number moves with the chain, never a
   hardcoded count. */

import { VAULT_TEST, TOKEN } from "../lib/data";
import { useLive, type LiveState } from "../lib/live";
import { fmtToken, type Receipt } from "../lib/near";
import { CopyButton, Unavail, LoadTxt } from "./ui";
import { AccountLink } from "../lib/links";

function demoSettled(rows: Receipt[] | null | undefined): number | null {
  if (!rows) return null;
  return rows.filter((r) => r.obligation_id.startsWith("demo-live-")).length;
}

function policyPct(p: NonNullable<LiveState["policy"]["v"]>): number | null {
  try {
    const spent = BigInt(p.spent);
    const limit = BigInt(p.limit);
    if (limit <= 0n) return null;
    return Number((spent * 100n) / limit);
  } catch {
    return null;
  }
}

function policyTitle(p: NonNullable<LiveState["policy"]["v"]>): string {
  try {
    return (
      "spent " +
      fmtToken(p.spent) +
      " USDC \u00b7 limit " +
      fmtToken(p.limit) +
      " USDC \u00b7 funded " +
      fmtToken(p.funded) +
      " USDC \u00b7 reserved " +
      fmtToken(p.reserved) +
      " USDC \u00b7 " +
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

  // checkedAt moves only when at least one job in a refresh succeeded,
  // so CHECKED is shown only when at least one read succeeded.
  const allFailed =
    L.codeProd.err && L.codeTest.err && L.recProd.err && L.recTest.err && L.agent.err && L.policy.err;
  const checked = !allFailed && L.checkedAt ? L.checkedAt.toLocaleTimeString() : null;
  const settled = !L.recTest.err ? demoSettled(L.recTest.rows) : null;
  const left = settled == null ? null : Math.max(0, 10 - settled);
  const nextId = settled == null ? null : "demo-live-" + String(settled + 1).padStart(3, "0");
  const pct = !L.policy.err && L.policy.v ? policyPct(L.policy.v) : null;

  return (
    <div className="livestrip">
      <div className="wrap">
        <div className="live-head">
          <span className="dot" aria-hidden="true"></span>
          <span>LIVE STATE · NEAR TESTNET</span>
          {checked ? <span>CHECKED {checked}</span> : L.anyErr ? <Unavail /> : <LoadTxt />}
        </div>
        <div className="live-grid">
          <div className="stat">
            <div className="n">{f(L.recTest, (v) => String(v))}</div>
            <div className="l">
              TEST RECEIPTS
              <br />
              ON THE VAULT
            </div>
          </div>
          <div className="stat">
            <div className="n">{f(L.recProd, (v) => String(v))}</div>
            <div className="l">
              PRODUCTION
              <br />
              RECEIPTS
            </div>
          </div>
          <div className="stat">
            <div className="n">
              {f(L.policy, (v) => (
                <span title={policyTitle(v)}>
                  {String(v.spent)}
                  <small> / {String(v.limit)}</small>
                </span>
              ))}
            </div>
            <div className="l">DEMO POLICY SPENT</div>
            {pct != null ? (
              <div className="bar" aria-hidden="true">
                <i style={{ width: pct + "%" }}></i>
              </div>
            ) : null}
          </div>
          <div className="stat">
            <div className="n">{L.recTest.err ? <Unavail /> : left == null ? <LoadTxt /> : String(left)}</div>
            <div className="l">
              DEMO SETTLES LEFT
              <br />
              {L.recTest.err ? "UNAVAILABLE" : left == null ? "READING THE CHAIN" : left === 0 ? "ALL TEN SETTLED" : (<><AccountLink account={VAULT_TEST} title="view the vault account on NearBlocks">{nextId!.toUpperCase()}</AccountLink> TO 010</>)}
            </div>
          </div>
        </div>
        <div className="live-hash">
          <span className="k">VAULT CODE HASH</span>
          {f(L.codeTest, (v) => (
            <>
              <AccountLink account={VAULT_TEST} title="view the vault account on NearBlocks">
                {v}
              </AccountLink>
              <CopyButton text={v} />
            </>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StripSection() {
  return <Strip />;
}
