/* Live data hook. Every number the site shows as CHAIN READ flows through
   here. Failures return null, and the UI shows Unavailable. A stale block
   height freezes visibly rather than pretending freshness. */

import { useEffect, useState } from "react";
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

export function useLive(): LiveState {
  const [s, setS] = useState<LiveState>({
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
  });

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
    return () => {
      alive = false;
    };
  }, []);

  return s;
}

export function codeHashMatches(h: string | null): boolean {
  return h === RECORD.codeHash;
}

export { hashToHex };
