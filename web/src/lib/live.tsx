/* Live data. One shared source for every number the site shows as CHAIN READ.
   A single LiveProvider fetches and polls; nav and pages all read the same
   snapshot, so a block height never disagrees with itself across the page.
   Failures return null and the UI shows Unavailable. A stale reading freezes
   visibly rather than pretending freshness. */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  blockHeight,
  fetchReceipts,
  ftBalanceOf,
  getBalances,
  hashToHex,
  viewAccount,
  type BalanceView,
  type ReceiptRow,
} from "./chain";
import { RECORD } from "./record";

export interface LiveState {
  block: number | null;
  codeHashTest: string | null;
  codeHashProd: string | null;
  receiptsTest: ReceiptRow[];
  receiptsProd: ReceiptRow[];
  balance: BalanceView | null;
  agentUnits: string | null;
  lastSettle: { index: string; ts: string } | null;
  checkedAt: string;
  ok: boolean;
}

const EMPTY: LiveState = {
  block: null,
  codeHashTest: null,
  codeHashProd: null,
  receiptsTest: [],
  receiptsProd: [],
  balance: null,
  agentUnits: null,
  lastSettle: null,
  checkedAt: "",
  ok: false,
};

const LiveContext = createContext<LiveState>(EMPTY);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<LiveState>(EMPTY);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [block, accTest, accProd, rt, rp, bal, units] = await Promise.all([
        blockHeight(),
        viewAccount(RECORD.vaults.test),
        viewAccount(RECORD.vaults.prod),
        fetchReceipts(RECORD.vaults.test),
        fetchReceipts(RECORD.vaults.prod),
        getBalances(RECORD.vaults.test, RECORD.policy),
        ftBalanceOf(RECORD.token, RECORD.agent),
      ]);
      if (!alive) return;
      const last = rt.length ? rt[rt.length - 1] : null;
      setS({
        block,
        codeHashTest: accTest?.code_hash ?? null,
        codeHashProd: accProd?.code_hash ?? null,
        receiptsTest: rt,
        receiptsProd: rp,
        balance: bal,
        agentUnits: units,
        lastSettle: last ? { index: last.index, ts: last.timestamp } : null,
        checkedAt: new Date().toISOString().slice(11, 19),
        ok: block !== null,
      });
    })();

    // The block height keeps ticking so the console reads as running.
    const tick = setInterval(async () => {
      const b = await blockHeight();
      if (alive && b !== null) {
        setS((prev) => ({ ...prev, block: b, checkedAt: new Date().toISOString().slice(11, 19), ok: true }));
      }
    }, 12000);

    return () => {
      alive = false;
      clearInterval(tick);
    };
  }, []);

  return <LiveContext.Provider value={s}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveState {
  return useContext(LiveContext);
}

export function codeHashMatches(h: string | null): boolean {
  return h === RECORD.codeHash;
}

export { hashToHex };
