/* Cynex web — per-step chain read hook.
   "Read receipt #N from chain — now" buttons use this. State is kept per
   receipt index so several reads can live on one page. */

import { useState } from "react";
import { readReceipt, type Receipt } from "./near";

export type ChainReadState = {
  status: "idle" | "loading" | "ok" | "error";
  rec: Receipt | null;
  block: number | null;
  error?: string;
};

export function useChainRead() {
  const [states, setStates] = useState<Record<number, ChainReadState>>({});
  const run = async (idx: number) => {
    setStates((prev) => ({ ...prev, [idx]: { status: "loading", rec: null, block: null } }));
    try {
      const { rec, block } = await readReceipt(idx);
      setStates((prev) => ({ ...prev, [idx]: { status: "ok", rec, block } }));
    } catch (e) {
      setStates((prev) => ({
        ...prev,
        [idx]: { status: "error", rec: null, block: null, error: String((e as Error)?.message || e) },
      }));
    }
  };
  return { states, run };
}
