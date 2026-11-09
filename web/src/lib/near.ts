/* Cynex web — typed NEAR client.
   One typed client for everything: all chain reads go through near-api-js
   (JsonRpcProvider, callFunction / viewContractCode), the same major
   version the repo uses (near-api-js 7). No raw JSON-RPC fetch, no CDN.
   Live reads only. On failure: unavailable, retry. */

import { JsonRpcProvider } from "near-api-js";
import { RPC_URL, VAULT_PROD, VAULT_TEST, TOKEN, AGENT, DEMO_POLICY_ID } from "./data";

/* ---------- types ---------- */
export interface Receipt {
  index: number;
  prev_hash: number[] | string;
  obligation_id: string;
  recipient: string;
  amount: number | string;
  token_id: string;
  timestamp: number | string;
  tx_ref: string;
  hash?: string;
}

export interface Policy {
  policy_id: string;
  token_id: string;
  limit: number | string;
  spent: number | string;
  reserved: number | string;
  funded: number | string;
  frozen: boolean;
  version: number;
  reconciler: string | null;
}

export interface Obligation {
  obligation_id: string;
  policy_id: string;
  policy_version: number;
  recipient: string;
  amount: number | string;
  evidence_type: string;
  evidence_hash: number[] | string;
  expires_at_ns: number | string;
  nonce: number;
  state: string;
  in_flight: boolean;
  transfer_attempt: number;
  transfer_dispatched_at_ns?: number | string | null;
  pending_request_id?: string | null;
  pending_digest?: number[] | string | null;
  evidence_requested_at_ns?: number | string | null;
}

/* ---------- provider (singleton per vault) ---------- */
const providers = new Map<string, JsonRpcProvider>();
function providerFor(vaultId: string): JsonRpcProvider {
  let p = providers.get(vaultId);
  if (!p) {
    p = new JsonRpcProvider({ url: RPC_URL });
    providers.set(vaultId, p);
  }
  return p;
}
const tokenProvider = new JsonRpcProvider({ url: RPC_URL });

async function viewCall<T>(vaultId: string, method: string, args: Record<string, unknown>): Promise<{ data: T; block: number | null }> {
  const result = (await providerFor(vaultId).callFunction({
    contractId: vaultId,
    method,
    args,
    blockQuery: { finality: "final" },
  })) as T;
  return { data: result, block: null };
}

export async function viewCode(accountId: string): Promise<{ hash: string; block: number | null }> {
  const r = await providerFor(accountId).viewContractCode({
    contractId: accountId,
    blockQuery: { finality: "final" },
  });
  return { hash: r.hash, block: (r as { block_height?: number }).block_height ?? null };
}

export async function fetchReceipts(vault: string): Promise<{ rows: Receipt[]; block: number | null }> {
  const out: Receipt[] = [];
  let start = 0;
  const limit = 50;
  for (let i = 0; i < 10; i++) {
    const r = await viewCall<Receipt[] | { receipts: Receipt[] }>(vault, "receipts", { start, limit });
    const page = Array.isArray(r.data) ? r.data : r.data && Array.isArray(r.data.receipts) ? r.data.receipts : [];
    if (page.length === 0) break;
    out.push(...page);
    if (page.length < limit) break;
    start += limit;
  }
  return { rows: out, block: null };
}

/* The demo policy on the test vault is p6-001. The old page called
   get_policy with no arguments, which the contract rejects, so the cell
   never resolved. The fix is to pass the policy id. */
export async function fetchPolicy(): Promise<{ raw: Policy; block: number | null }> {
  const r = await viewCall<Policy>(VAULT_TEST, "get_policy", { policy_id: DEMO_POLICY_ID });
  if (r.data == null) throw new Error("no policy view");
  return { raw: r.data, block: r.block };
}

export async function getObligation(vault: string, obligationId: string): Promise<Obligation | null> {
  const r = await viewCall<Obligation | null>(vault, "get_obligation", { obligation_id: obligationId });
  return r.data;
}

export async function agentBalance(): Promise<string> {
  const v = (await tokenProvider.callFunction({
    contractId: TOKEN,
    method: "ft_balance_of",
    args: { account_id: AGENT },
    blockQuery: { finality: "final" },
  })) as string;
  return String(v);
}

/* Fetch a single receipt by index, for the per-step chain reads. */
export async function readReceipt(index: number): Promise<{ rec: Receipt | null; block: number | null }> {
  const r = await viewCall<Receipt[] | { receipts: Receipt[] }>(VAULT_TEST, "receipts", { start: index, limit: 1 });
  const rec = Array.isArray(r.data) ? r.data[0] : r.data && Array.isArray(r.data.receipts) ? r.data.receipts[0] : null;
  return { rec: rec ?? null, block: r.block };
}

/* ---------- formatting ---------- */
/* The token has 6 decimals. Live reads are shown in base units so the
   numbers match the demo labels (100, 2700), with the decimal value in
   the title attribute. The demo obligations really are 100 base units. */
export function fmtToken(raw: number | string | bigint): string {
  try {
    const b = BigInt(raw);
    const w = b / 1000000n;
    let f = (b % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
    return f ? w + "." + f : "" + w;
  } catch {
    return String(raw);
  }
}

export function fmtTs(t: number | string): string {
  const s = String(t);
  const n = Number(s);
  if (!isFinite(n)) return s;
  const ms = s.length > 13 ? n / 1e6 : n;
  try {
    return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + "Z";
  } catch {
    return s;
  }
}

/* prev_hash arrives from the contract as a 32-byte array. Render it as
   hex, never as a decimal list. Accepts an already-hex string too. */
export function bytesToHex(v: number[] | string | null | undefined): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((b) => Number(b).toString(16).padStart(2, "0")).join("");
  return String(v);
}

export function shortHex(hex: string, a = 8, b = 6): string {
  if (!hex) return "—";
  return hex.length > a + b + 1 ? hex.slice(0, a) + "…" + hex.slice(-b) : hex;
}

export function trunc(h: string, a = 8, b = 6): string {
  if (!h) return "—";
  return h.length > a + b + 1 ? h.slice(0, a) + "…" + h.slice(-b) : h;
}

/* In-browser receipt hash, the same formula the showcase uses for the
   tamper-and-detect working copy. The canonical verifier is cynex-verify. */
export async function receiptHash(r: {
  index: number | string;
  prev_hash: number[] | string;
  obligation_id: string;
  recipient: string;
  amount: number | string;
  token_id: string;
  timestamp: number | string;
  tx_ref: string;
}): Promise<string> {
  /* Same stringification as the showcase: a byte array stringifies to its
     comma-separated decimal list. The tamper panel only compares hashes
     inside its own working copy, so the formula is self-consistent. */
  const s =
    "" + r.index + String(r.prev_hash) + r.obligation_id + r.recipient + r.amount + r.token_id + r.timestamp + r.tx_ref;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* Linkage: index contiguity, plus prev_hash linkage when a hash field is
   present on the receipts. The receipts view returns no hash field, so in
   practice this is the contiguity check. */
export function computeLinkage(rows: Receipt[] | null | undefined): { allOk: boolean | null; perRow: boolean[] } {
  if (!rows || !rows.length) return { allOk: null, perRow: [] };
  const perRow = rows.map((r, i) => {
    if (i === 0) return true;
    const p = rows[i - 1];
    const contig = Number(r.index) === Number(p.index) + 1;
    if (p.hash && r.prev_hash) return contig && bytesToHex(r.prev_hash) === p.hash;
    return contig;
  });
  return { allOk: perRow.every(Boolean), perRow };
}

export { VAULT_PROD, VAULT_TEST };
