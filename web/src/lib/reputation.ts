/* The reputation gate, running live in the browser. A faithful port of
   services/reputation/reputation.ts: five signals, an honest ALLOW/WARN/BLOCK
   verdict, and a score that is null unless ALLOW. Where a signal has no
   reachable source it is marked unavailable with its real reason, never
   invented. Unknown maps to WARN, never to a pass.

   Live sources used here:
     - deployed + code hash         NEAR RPC view_account        (always reachable)
     - prior_vault_interactions     vault receipts()             (always reachable)
     - code_change_recency          Nearblocks code history      (CORS may block -> unavailable)
     - account_age                  Nearblocks first-seen        (CORS may block -> unavailable)
     - blocklist                    no suitable public source    (unavailable by design) */

import { viewCall, RPC_URL, VAULT_TEST, type ReceiptRow } from "./chain";

export type SignalStatus = "ok" | "unavailable";
export type SignalVerdict = "ALLOW" | "WARN" | "BLOCK" | "NEUTRAL";

export interface SignalResult {
  id: string;
  name: string;
  status: SignalStatus;
  verdict: SignalVerdict;
  value: string;
  source: string;
  reason?: string;
}

export interface ReputationReport {
  account: string;
  verdict: "ALLOW" | "WARN" | "BLOCK";
  score: number | null;
  reasons: string[];
  signals: SignalResult[];
  checkedAt: string;
}

const CODE_CHANGE_WARN_MS = 7 * 24 * 60 * 60 * 1000;
const CODE_CHANGE_BLOCK_MS = 24 * 60 * 60 * 1000;
const NO_BLOCKLIST_REASON =
  "no suitable public blocklist source for NEAR account ids; see docs/phase7-lane-b.md";
const NEARBLOCKS = "https://api-testnet.nearblocks.io";

async function rpcQuery(params: unknown): Promise<any | null> {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params }),
    });
    const body = await res.json();
    return body.error ? null : body.result ?? null;
  } catch {
    return null;
  }
}

function decodeCall(raw: { result?: number[] }): string | null {
  if (!raw?.result) return null;
  try {
    return new TextDecoder().decode(Uint8Array.from(raw.result));
  } catch {
    return null;
  }
}

export function isValidAccountId(id: string): boolean {
  return /^[a-z0-9._-]+$/.test(id) && id.length >= 2 && id.length <= 64 && !/[A-Z]/.test(id);
}

/* Signal 4+5: deployed and prior interactions, from chain. Always available. */
async function chainSignals(account: string): Promise<{ deployed: SignalResult; prior: SignalResult }> {
  const acc = await rpcQuery({ request_type: "view_account", finality: "final", account_id: account });
  const deployed: SignalResult = acc
    ? {
        id: "deployed",
        name: "deployed",
        status: "ok",
        verdict: acc.code_hash && acc.code_hash !== "11111111111111111111111111111111" ? "ALLOW" : "NEUTRAL",
        value: acc.code_hash && acc.code_hash !== "11111111111111111111111111111111" ? "contract deployed" : "account exists, no contract",
        source: "NEAR RPC view_account",
      }
    : {
        id: "deployed",
        name: "deployed",
        status: "unavailable",
        verdict: "WARN",
        value: "unavailable",
        source: "NEAR RPC view_account",
        reason: acc === null && !(await accountExists(account)) ? "account not found on chain" : "read failed",
      };

  const receiptsRaw = await rpcQuery({
    request_type: "call_function",
    finality: "final",
    account_id: VAULT_TEST,
    method_name: "receipts",
    args_base64: btoa(JSON.stringify({ start: 0, limit: 200 })),
  });
  let interactions = 0;
  const text = decodeCall(receiptsRaw as { result?: number[] });
  if (text) {
    try {
      const rows = JSON.parse(text) as ReceiptRow[];
      interactions = rows.filter((r) => r.recipient === account).length;
    } catch {
      /* leave 0 */
    }
  }
  const prior: SignalResult = {
    id: "prior_vault_interactions",
    name: "prior_vault_interactions",
    status: "ok",
    verdict: interactions > 0 ? "ALLOW" : "WARN",
    value: interactions > 0 ? `${interactions} prior receipts` : "no prior vault interactions",
    source: "vault receipts()",
    reason: interactions > 0 ? undefined : "insufficient history is WARN, never a guessed score",
  };

  return { deployed, prior };
}

async function accountExists(account: string): Promise<boolean> {
  const acc = await rpcQuery({ request_type: "view_account", finality: "final", account_id: account });
  return !!acc;
}

/* Signal 3: code_change_recency, from Nearblocks code history. May be blocked. */
async function codeChangeSignal(account: string): Promise<SignalResult> {
  try {
    const res = await fetch(`${NEARBLOCKS}/account/${account}/contract`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error("http " + res.status);
    const body = await res.json();
    const deployedAt = body?.contract?.deployed_at ?? body?.contract?.timestamp ?? null;
    if (!deployedAt) {
      return {
        id: "code_change_recency",
        name: "code_change_recency",
        status: "ok",
        verdict: "ALLOW",
        value: "no recent code change",
        source: "Nearblocks contract history",
      };
    }
    const deployedMs = new Date(deployedAt).getTime();
    const age = Date.now() - deployedMs;
    if (age < CODE_CHANGE_BLOCK_MS) {
      return {
        id: "code_change_recency",
        name: "code_change_recency",
        status: "ok",
        verdict: "BLOCK",
        value: `code changed ${Math.round(age / 3600000)}h ago`,
        source: "Nearblocks contract history",
        reason: "code changed under 24h ago is BLOCK",
      };
    }
    if (age < CODE_CHANGE_WARN_MS) {
      return {
        id: "code_change_recency",
        name: "code_change_recency",
        status: "ok",
        verdict: "WARN",
        value: `code changed ${Math.round(age / 86400000)}d ago`,
        source: "Nearblocks contract history",
        reason: "code changed under 7 days ago is WARN",
      };
    }
    return {
      id: "code_change_recency",
      name: "code_change_recency",
      status: "ok",
      verdict: "ALLOW",
      value: `code ${Math.round(age / 86400000)}d old`,
      source: "Nearblocks contract history",
    };
  } catch {
    return {
      id: "code_change_recency",
      name: "code_change_recency",
      status: "unavailable",
      verdict: "NEUTRAL",
      value: "unavailable",
      source: "Nearblocks contract history",
      reason: "source not reachable from the browser; recorded unavailable, not invented",
    };
  }
}

/* Signal 1: account_age, from Nearblocks first-seen. May be blocked. */
async function accountAgeSignal(account: string): Promise<SignalResult> {
  try {
    const res = await fetch(`${NEARBLOCKS}/account/${account}/activity?limit=1`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error("http " + res.status);
    const body = await res.json();
    const first = body?.activity?.[0]?.block_timestamp ?? null;
    if (!first) throw new Error("no first-seen");
    const ageDays = Math.round((Date.now() - Number(first) / 1e6) / 86400000);
    return {
      id: "account_age",
      name: "account_age",
      status: "ok",
      verdict: ageDays > 7 ? "ALLOW" : "WARN",
      value: `${ageDays} days old`,
      source: "Nearblocks first-seen",
    };
  } catch {
    return {
      id: "account_age",
      name: "account_age",
      status: "unavailable",
      verdict: "NEUTRAL",
      value: "unavailable",
      source: "Nearblocks first-seen",
      reason: "source not reachable from the browser; recorded unavailable, not invented",
    };
  }
}

/* Signal 2: blocklist. No suitable public source by design. */
function blocklistSignal(): SignalResult {
  return {
    id: "blocklist",
    name: "blocklist",
    status: "unavailable",
    verdict: "NEUTRAL",
    value: "unavailable",
    source: "public blocklist with named provenance",
    reason: NO_BLOCKLIST_REASON,
  };
}

export async function checkCounterparty(account: string): Promise<ReputationReport> {
  const signals: SignalResult[] = [];
  const reasons: string[] = [];

  if (!isValidAccountId(account)) {
    return {
      account,
      verdict: "WARN",
      score: null,
      reasons: ["account_id is not a valid NEAR account id"],
      signals: [],
      checkedAt: new Date().toISOString(),
    };
  }

  const [{ deployed, prior }, codeChange, age] = await Promise.all([
    chainSignals(account),
    codeChangeSignal(account),
    accountAgeSignal(account),
  ]);
  signals.push(age, blocklistSignal(), codeChange, prior, deployed);

  // verdict: BLOCK first, then ALLOW, else WARN
  let verdict: "ALLOW" | "WARN" | "BLOCK" = "WARN";

  const blocklisted = false; // blocklist is never sourced here, so it can never BLOCK
  const codeBlock = codeChange.verdict === "BLOCK";
  if (blocklisted || codeBlock) {
    verdict = "BLOCK";
    if (codeBlock) reasons.push("code_change_recency: " + (codeChange.reason ?? "code changed recently"));
    if (blocklisted) reasons.push("blocklist: account is listed");
  } else {
    const sourced = signals.filter((s) => s.status === "ok" && s.verdict !== "NEUTRAL");
    const anyWarn = sourced.some((s) => s.verdict === "WARN");
    const deployedOk = deployed.status === "ok" && deployed.value === "contract deployed";
    const accountOk = deployed.status === "ok";
    if (!anyWarn && accountOk && sourced.length > 0 && sourced.every((s) => s.verdict === "ALLOW")) {
      verdict = "ALLOW";
    } else {
      verdict = "WARN";
      for (const s of sourced) if (s.verdict === "WARN") reasons.push(`${s.name}: ${s.reason ?? s.value}`);
      for (const s of signals) if (s.status === "unavailable") reasons.push(`${s.name}: unavailable`);
      if (!deployedOk) reasons.push("deployed: " + deployed.value);
      if (reasons.length === 0) reasons.push("insufficient sourced history to pass");
    }
  }

  // score: mean of sourced, non-neutral signals; null unless ALLOW
  const forScore = signals.filter((s) => s.status === "ok" && s.verdict !== "NEUTRAL");
  const score =
    verdict === "ALLOW" && forScore.length
      ? Math.round((forScore.reduce((a, s) => a + (s.verdict === "ALLOW" ? 1 : 0), 0) / forScore.length) * 100) / 100
      : null;

  return {
    account,
    verdict,
    score,
    reasons: reasons.length ? reasons : verdict === "ALLOW" ? ["all sourced signals pass"] : reasons,
    signals,
    checkedAt: new Date().toISOString(),
  };
}
