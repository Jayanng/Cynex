/* Cynex web, typed NEAR client.
   Chain reads go through near-api-js (JsonRpcProvider, callFunction /
   viewContractCode), the same major version the repo uses (near-api-js 7).
   One exception: receipts. near-api-js parses JSON with JSON.parse, which
   rounds u64 timestamps over 2^53, and a rounded timestamp recomputes to
   a different receipt hash, so a browser replay would falsely fail. The
   CLI solves this the same way (cli/cynex.ts:365-380, parseReceiptsRaw):
   fetch the receipts view raw and quote the index, amount, and timestamp
   numbers before parsing, keeping them exact as BigInt end to end. */

/* ---------- receipts: raw fetch, exact u64 values ---------- */
async function fetchReceiptPage(vault: string, start: number, limit: number): Promise<{ rows: Receipt[]; block: number | null }> {
  const argsBase64 = btoa(JSON.stringify({ start, limit }));
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "cynex-receipts",
      method: "query",
      params: {
        request_type: "call_function",
        account_id: vault,
        method_name: "receipts",
        args_base64: argsBase64,
        finality: "final",
      },
    }),
  });
  const data = (await response.json()) as { error?: unknown; result?: { result?: number[]; block_height?: number } };
  if (data.error) throw new Error("receipts view failed: " + JSON.stringify(data.error));
  const raw = new TextDecoder().decode(new Uint8Array(data.result?.result ?? []));
  const quoted = raw.replace(/"(index|amount|timestamp)":\s*(-?\d+)/g, '"$1":"$2"');
  const rows = JSON.parse(quoted) as Receipt[];
  return { rows: Array.isArray(rows) ? rows : [], block: data.result?.block_height ?? null };
}

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
  let block: number | null = null;
  for (let i = 0; i < 10; i++) {
    const page = await fetchReceiptPage(vault, start, limit);
    if (page.rows.length === 0) break;
    if (block === null) block = page.block;
    out.push(...page.rows);
    if (page.rows.length < limit) break;
    start += limit;
  }
  return { rows: out, block };
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

/* Fetch a single receipt by index, for the per-step chain reads.
   Same raw fetch as fetchReceipts, so the timestamp stays exact. */
export async function readReceipt(index: number): Promise<{ rec: Receipt | null; block: number | null }> {
  const page = await fetchReceiptPage(VAULT_TEST, index, 1);
  return { rec: page.rows[0] ?? null, block: page.block };
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
  if (!hex) return "-";
  return hex.length > a + b + 1 ? hex.slice(0, a) + "…" + hex.slice(-b) : hex;
}

export function trunc(h: string, a = 8, b = 6): string {
  if (!h) return "-";
  return h.length > a + b + 1 ? h.slice(0, a) + "…" + h.slice(-b) : h;
}

/* In-browser receipt hash: the frozen binary formula from
   frontend/src/cynex/receipt.ts (mirroring contract/src/lib.rs:351-377).
   SHA-256 over index as u64 big-endian, prev_hash as 32 raw bytes,
   length-prefixed UTF-8 strings (u32 big-endian length plus bytes),
   amount as u128 big-endian, timestamp as u64 big-endian.
   Verified against live receipts: hash of receipt 0 is
   b58ca0f15967f41f74b75dd4fe069588d8bb225814427dff8949eb9fb91b6d8e, which
   equals the on-chain prev_hash of receipt 1, and all 30 links verify.
   The canonical verifier is the CLI verify-live command. */
function u64be(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, false);
  return b;
}
function u128be(v: bigint): Uint8Array {
  const b = new Uint8Array(16);
  let x = v;
  for (let i = 15; i >= 0; i--) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}
function lenPrefixed(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, false);
  out.set(bytes, 4);
  return out;
}
export function prevHashBytes(v: number[] | string | null | undefined): Uint8Array {
  if (v == null) return new Uint8Array(32);
  if (typeof v === "string") {
    const hex = v.length === 64 ? v : v.padStart(64, "0");
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  return new Uint8Array(v);
}
function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
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
  const encoded = concat([
    u64be(BigInt(r.index)),
    prevHashBytes(r.prev_hash),
    lenPrefixed(r.obligation_id),
    lenPrefixed(r.recipient),
    u128be(BigInt(r.amount)),
    lenPrefixed(r.token_id),
    u64be(BigInt(r.timestamp)),
    lenPrefixed(r.tx_ref),
  ]);
  const buf = await crypto.subtle.digest("SHA-256", encoded as unknown as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* Hash-link verification, decoded bytes compared to bytes: recompute the
   hash of receipt i-1 with the frozen formula and compare it to the
   prev_hash stored in receipt i. The receipts view returns no hash field,
   so this is the only way the browser can check the links. */
export async function verifyHashLinks(rows: Receipt[]): Promise<{ allOk: boolean; perRow: boolean[] }> {
  const perRow: boolean[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (i === 0) {
      perRow.push(true);
      continue;
    }
    const h = await receiptHash(rows[i - 1]);
    perRow.push(bytesToHex(rows[i].prev_hash) === h);
  }
  return { allOk: perRow.every(Boolean), perRow };
}

/* Linkage shown in the live table: index contiguity only. The Receipt
   struct has no hash field (contract/src/lib.rs:203-212), so the receipts
   view returns no hash to compare a prev_hash against. Only the CLI
   recomputes the hash links. */
export function computeLinkage(rows: Receipt[] | null | undefined): { allOk: boolean | null; perRow: boolean[] } {
  if (!rows || !rows.length) return { allOk: null, perRow: [] };
  const perRow = rows.map((r, i) => {
    if (i === 0) return true;
    const p = rows[i - 1];
    return Number(r.index) === Number(p.index) + 1;
  });
  return { allOk: perRow.every(Boolean), perRow };
}

export { VAULT_PROD, VAULT_TEST };
