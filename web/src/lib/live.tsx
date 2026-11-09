/* Cynex web — live store.
   Replaces the static page's global `live` object and renderLiveRegions.
   One refresh reads all live values in parallel; components re-render
   from this context. On any failure the affected field shows
   "Unavailable — retrying", never a cached value, and a retry is
   scheduled after 8 seconds. A refresh also runs every 5 seconds while
   a live region is mounted, as in the showcase. */

import { createContext, useContext, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { VAULT_PROD, VAULT_TEST } from "./data";
import { viewCode, fetchReceipts, fetchPolicy, agentBalance, computeLinkage, type Receipt, type Policy } from "./near";

export interface LiveField<T> {
  v: T | null;
  err: boolean;
}
export interface LiveReceipts extends LiveField<number> {
  rows: Receipt[] | null;
  link: { allOk: boolean | null; perRow: boolean[] } | null;
}
export interface LiveState {
  anyErr: boolean;
  blockHeight: number | null;
  checkedAt: Date | null;
  codeProd: LiveField<string>;
  codeTest: LiveField<string>;
  recProd: LiveReceipts;
  recTest: LiveReceipts;
  agent: LiveField<string>;
  policy: LiveField<Policy>;
}

const empty = (): LiveState => ({
  anyErr: false,
  blockHeight: null,
  checkedAt: null,
  codeProd: { v: null, err: false },
  codeTest: { v: null, err: false },
  recProd: { v: null, err: false, rows: null, link: null },
  recTest: { v: null, err: false, rows: null, link: null },
  agent: { v: null, err: false },
  policy: { v: null, err: false },
});

interface LiveContextValue {
  live: LiveState;
  refreshLive: () => Promise<void>;
}

const LiveContext = createContext<LiveContextValue>({ live: empty(), refreshLive: async () => {} });

export function useLive(): LiveContextValue {
  return useContext(LiveContext);
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const [live, setLive] = useState<LiveState>(empty);
  const refreshing = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshLive = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const jobs: [
      Promise<{ hash: string; block: number | null }>,
      Promise<{ hash: string; block: number | null }>,
      Promise<{ rows: Receipt[]; block: number | null }>,
      Promise<{ rows: Receipt[]; block: number | null }>,
      Promise<string>,
      Promise<{ raw: Policy; block: number | null }>,
    ] = [
      viewCode(VAULT_PROD),
      viewCode(VAULT_TEST),
      fetchReceipts(VAULT_PROD),
      fetchReceipts(VAULT_TEST),
      agentBalance(),
      fetchPolicy(),
    ];
    const settled = await Promise.allSettled(jobs);
    let anyErr = false;
    let block: number | null = null;
    setLive((prev) => {
      const next: LiveState = { ...prev, anyErr: false };
      const [codeProd, codeTest, recProd, recTest, agent, policy] = settled;
      if (codeProd.status === "fulfilled") {
        next.codeProd = { v: codeProd.value.hash, err: false };
        block = block ?? codeProd.value.block;
      } else {
        next.codeProd = { ...prev.codeProd, err: true };
        anyErr = true;
      }
      if (codeTest.status === "fulfilled") {
        next.codeTest = { v: codeTest.value.hash, err: false };
        block = block ?? codeTest.value.block;
      } else {
        next.codeTest = { ...prev.codeTest, err: true };
        anyErr = true;
      }
      if (recProd.status === "fulfilled") {
        next.recProd = { v: recProd.value.rows.length, err: false, rows: recProd.value.rows, link: computeLinkage(recProd.value.rows) };
      } else {
        next.recProd = { ...prev.recProd, err: true };
        anyErr = true;
      }
      if (recTest.status === "fulfilled") {
        next.recTest = { v: recTest.value.rows.length, err: false, rows: recTest.value.rows, link: computeLinkage(recTest.value.rows) };
      } else {
        next.recTest = { ...prev.recTest, err: true };
        anyErr = true;
      }
      if (agent.status === "fulfilled") {
        next.agent = { v: agent.value, err: false };
      } else {
        next.agent = { ...prev.agent, err: true };
        anyErr = true;
      }
      if (policy.status === "fulfilled") {
        next.policy = { v: policy.value.raw, err: false };
      } else {
        next.policy = { ...prev.policy, err: true };
        anyErr = true;
      }
      next.anyErr = anyErr;
      if (block) next.blockHeight = block;
      next.checkedAt = new Date();
      return next;
    });
    refreshing.current = false;
    if (anyErr) {
      retryTimer.current = setTimeout(() => {
        void refreshLive();
      }, 8000);
    }
  }, []);

  useEffect(() => {
    void refreshLive();
    const id = setInterval(() => {
      void refreshLive();
    }, 5000);
    return () => {
      clearInterval(id);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [refreshLive]);

  return <LiveContext.Provider value={{ live, refreshLive }}>{children}</LiveContext.Provider>;
}
