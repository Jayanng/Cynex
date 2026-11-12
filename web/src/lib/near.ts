/* Cynex web, typed NEAR client.
   Chain reads go through near-api-js (JsonRpcProvider, callFunction /
   viewContractCode), the same major version the repo uses (near-api-js 7).
   One exception used to be receipts: near-api-js parses JSON with
   JSON.parse, which rounds u64 timestamps over 2^53, and a rounded
   timestamp recomputes to a different receipt hash, so a browser replay
   would falsely fail. The browser solved that by fetching the receipts
   view raw and quoting the index, amount, and timestamp numbers before
   parsing. That quoting now lives on the server, in
   web/api/live-receipts.ts, which fetches the receipts view raw from
   the RPC, quotes the numbers the same way, and serves the exact rows
   CDN cached. The browser calls that endpoint instead of the raw RPC,
   so no quoting code remains here. The CLI solves the same problem the
   same way (cli/cynex.ts:365-380, parseReceiptsRaw). */

/* ---------- receipts: served by /api/live-receipts ---------- */
/* Bounded reads for the receipts endpoint. This read used to have no
   timeout and no abort signal, so a stalled RPC connection never
   resolved or rejected. That hung fetchReceipts, and with it the whole
   live refresh in live.tsx: Promise.allSettled never settled, the
   refreshing guard stayed set, the 5s interval ticks were no-ops, and
   the 8s retry timer (which is only armed after allSettled) never
   fired, so every live stat sat on "Unavailable, retrying" even
   though the near-api-js reads in the same refresh had succeeded.
   Every receipts read is now bounded. One attempt shares a single
   RECEIPT_FETCH_TIMEOUT_MS (4s, shorter than both the 5s refresh
   interval and the 8s retry window, and far above the usual 0.5s
   response) across the headers and the body read, so one attempt can
   never take more than 4s, and a transient failure is retried at most
   twice with 500ms then 1000ms backoff. The whole fetchReceipts call
   is bounded too: the call rejects once RECEIPT_FETCH_TOTAL_TIMEOUT_MS
   (20s) has passed, so retries can never stack up past the budget.
   Every attempt is clamped to the time left in the budget, backoff
   sleeps are clamped the same way, and a response that returns after
   the deadline is rejected, so the worst case for the whole call is
   about 20s, after which the read rejects, the live store marks the
   field failed, and the retry timer fires. The endpoint returns the
   full rows in one response, so the client no longer pages the RPC
   (limit 50, up to 10 pages): that pagination now lives on the server.
   The four near-api-js reads in the same refresh (viewCode twice,
   fetchPolicy, agentBalance) are raced against the same 4s timeout
   with withTimeout below, so no job in a refresh is unbounded. A read
   can be slow and it can fail, but it can no longer hang forever. */
export const RECEIPT_FETCH_TIMEOUT_MS = 4000;
export const RECEIPT_FETCH_MAX_ATTEMPTS = 3;
export const RECEIPT_FETCH_RETRY_BASE_DELAY_MS = 500;
export const RECEIPT_FETCH_TOTAL_TIMEOUT_MS = 20000;

/* A fetch that always settles: the AbortController cancels the real
   request on timeout, and the racing timeout promise rejects even if
   the fetch implementation ignores the signal, so a hung read can
   never block the caller past timeoutMs. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("fetch timed out after " + timeoutMs + "ms"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetch(url, { ...init, signal: controller.signal }), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/* Race any promise against a timeout rejection, for reads that do not
   go through fetch and so cannot take an AbortSignal: the near-api-js
   JsonRpcProvider calls and the receipts response body read. The
   underlying promise keeps running if it loses the race, but the
   caller is never blocked past timeoutMs. The error message matches
   the "timed out after Nms" shape isTransientReceiptError treats
   as transient. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(label + " timed out after " + timeoutMs + "ms"));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* Transient receipts failures are worth one more try: a timeout, an
   abort, a network failure, a body that is not JSON (an HTML error
   page, a truncated body), or an HTTP 5xx from the RPC. A
   deterministic failure is not: the RPC answered with an error, or
   an HTTP 4xx, so retrying would just fail the same way. An HTTP
   status in the message decides: 5xx is transient, 4xx is not. */
export function isTransientReceiptError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "name" in error) {
    if ((error as { name: unknown }).name === "AbortError") return true;
  }
  if (error instanceof Error) {
    if (/timed out after \d+ms/.test(error.message)) return true;
    if (error instanceof SyntaxError) return true;
    const httpStatus = /HTTP (\d{3})/.exec(error.message);
    if (httpStatus) return Number(httpStatus[1]) >= 500;
    if (error.message.startsWith("receipts view failed")) return false;
    if (error instanceof TypeError) return true;
  }
  return false;
}

/* Run fn up to maxAttempts times, retrying only transient failures
   with exponential backoff from baseDelayMs. The last error is
   rethrown, so a failed read is always an error, never a null
   dressed up as a result. An optional deadlineMs (absolute epoch
   ms) clamps each backoff sleep to the time left in the budget, so
   a retry never sleeps past the deadline: the next attempt then
   throws the budget error instead of starting another fetch. */
export async function withReceiptRetries<T>(
  fn: () => Promise<T>,
  maxAttempts: number = RECEIPT_FETCH_MAX_ATTEMPTS,
  baseDelayMs: number = RECEIPT_FETCH_RETRY_BASE_DELAY_MS,
  deadlineMs?: number,
): Promise<T> {
  /* A maxAttempts of 0 used to fall through the loop and throw
     undefined. Callers pass 3, but a bad value must fail loudly
     with a real Error, never with an undefined throw. */
  if (maxAttempts < 1) throw new Error("withReceiptRetries needs maxAttempts of at least 1, got " + maxAttempts);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isTransientReceiptError(error)) throw error;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await sleep(deadlineMs === undefined ? delay : Math.max(0, Math.min(delay, deadlineMs - Date.now())));
    }
  }
  throw lastError;
}

export interface ReceiptReadOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  totalTimeoutMs?: number;
}

function receiptReadSettings(opts?: ReceiptReadOptions): Required<ReceiptReadOptions> {
  return {
    timeoutMs: opts?.timeoutMs ?? RECEIPT_FETCH_TIMEOUT_MS,
    maxAttempts: opts?.maxAttempts ?? RECEIPT_FETCH_MAX_ATTEMPTS,
    retryBaseDelayMs: opts?.retryBaseDelayMs ?? RECEIPT_FETCH_RETRY_BASE_DELAY_MS,
    totalTimeoutMs: opts?.totalTimeoutMs ?? RECEIPT_FETCH_TOTAL_TIMEOUT_MS,
  };
}

/* A decoded receipt entry must carry every receipt field, with the
   exact-integer fields as numbers or numeric strings: the server-side quoting turns large raw numbers into strings, small ones stay
   numbers. prev_hash arrives as a 32-byte array or a hex string,
   and tx_ref is a string that may be empty on chain. */
function isValidReceipt(value: unknown): value is Receipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  const isExactInt = (v: unknown): boolean =>
    (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^-?\d+$/.test(v));
  if (!isExactInt(r.index) || !isExactInt(r.amount) || !isExactInt(r.timestamp)) return false;
  if (typeof r.obligation_id !== "string" || r.obligation_id.length === 0) return false;
  if (typeof r.recipient !== "string" || r.recipient.length === 0) return false;
  if (typeof r.token_id !== "string" || r.token_id.length === 0) return false;
  if (!(Array.isArray(r.prev_hash) || typeof r.prev_hash === "string")) return false;
  if (typeof r.tx_ref !== "string") return false;
  return true;
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
  const result = (await withTimeout(
    providerFor(vaultId).callFunction({
      contractId: vaultId,
      method,
      args,
      blockQuery: { finality: "final" },
    }),
    RECEIPT_FETCH_TIMEOUT_MS,
    "view call " + method,
  )) as T;
  return { data: result, block: null };
}

export async function viewCode(accountId: string): Promise<{ hash: string; block: number | null }> {
  const r = await withTimeout(
    providerFor(accountId).viewContractCode({
      contractId: accountId,
      blockQuery: { finality: "final" },
    }),
    RECEIPT_FETCH_TIMEOUT_MS,
    "view code " + accountId,
  );
  return { hash: r.hash, block: (r as { block_height?: number }).block_height ?? null };
}

export const LIVE_RECEIPTS_ENDPOINT = "/api/live-receipts";

/* One read of the live receipts endpoint: a GET that returns the full
   rows in one response, { rows, block }. The server validates the rows
   too, but the client still validates every row before trusting it.
   An HTTP error is a receipts view failure: a 5xx is transient and
   retried, a 4xx is deterministic. A body that is not { rows, block }
   with valid rows is an error, never zero rows presented as success. */
async function fetchReceiptsOnce(
  vault: string,
  timeoutMs: number,
): Promise<{ rows: Receipt[]; block: number | null }> {
  const startedAt = Date.now();
  const url = LIVE_RECEIPTS_ENDPOINT + "?vault=" + encodeURIComponent(vault);
  const response = await fetchWithTimeout(url, { method: "GET" }, timeoutMs);
  /* A 5xx is a transient server failure, so it must throw an error
     the retry can fire on. The ok check is === false so a mocked
     Response without an ok flag still reads as ok. */
  if (response.ok === false) {
    throw new Error("receipts view failed: HTTP " + (response.status ?? "unknown"));
  }
  /* The body read is raced too, against only the time left in the
     attempt budget: fetchWithTimeout bounds the headers, and a
     stalled body must not get a second full timeoutMs on top of
     slow headers. A SyntaxError here means the body was not JSON
     (an HTML error page, a truncated body), which
     isTransientReceiptError treats as transient. */
  const bodyMs = timeoutMs - (Date.now() - startedAt);
  if (bodyMs <= 0)
    throw new Error("receipts response body timed out after " + timeoutMs + "ms");
  const data = (await withTimeout(
    response.json(),
    bodyMs,
    "receipts response body",
  )) as unknown;
  if (data == null || typeof data !== "object" || Array.isArray(data))
    throw new Error("receipts view failed: unexpected response shape");
  const rows = (data as { rows?: unknown }).rows;
  /* The decoded payload must be an array of receipts: a 200 whose
     body has no rows array used to return zero rows as a success,
     and [{}] passed as a receipt with every field undefined. Both
     are deterministic failures, never retried. */
  if (!Array.isArray(rows))
    throw new Error("receipts view failed: unexpected receipt payload, not an array");
  for (const row of rows) {
    if (!isValidReceipt(row))
      throw new Error("receipts view failed: invalid receipt entry");
  }
  const block = (data as { block?: unknown }).block;
  if (block !== null && block !== undefined && typeof block !== "number")
    throw new Error("receipts view failed: unexpected block value");
  return { rows: rows as Receipt[], block: block ?? null };
}

export async function fetchReceipts(vault: string, opts?: ReceiptReadOptions): Promise<{ rows: Receipt[]; block: number | null }> {
  const settings = receiptReadSettings(opts);
  /* Total deadline for the whole call: retries can never stack up
     past RECEIPT_FETCH_TOTAL_TIMEOUT_MS. The deadline is checked
     before every attempt and each attempt is clamped to the time
     left, so the call rejects once the budget is spent. */
  const deadline = Date.now() + settings.totalTimeoutMs;
  const out = await withReceiptRetries(
    () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("receipts read exceeded total budget of " + settings.totalTimeoutMs + "ms");
      return fetchReceiptsOnce(vault, Math.min(settings.timeoutMs, remaining));
    },
    settings.maxAttempts,
    settings.retryBaseDelayMs,
    deadline,
  );
  /* A response that returns after the deadline is rejected, not
     accepted: without this check an over-budget read still counted
     as a success. */
  if (Date.now() > deadline) throw new Error("receipts read exceeded total budget of " + settings.totalTimeoutMs + "ms");
  return out;
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
  const v = (await withTimeout(
    tokenProvider.callFunction({
      contractId: TOKEN,
      method: "ft_balance_of",
      args: { account_id: AGENT },
      blockQuery: { finality: "final" },
    }),
    RECEIPT_FETCH_TIMEOUT_MS,
    "agent balance",
  )) as string;
  return String(v);
}

/* Fetch a single receipt by index, for the per-step chain reads.
   The endpoint returns the full rows in one cached response, so this
   reads that list and picks the row out instead of paging the raw RPC.
   A null rec here means the vault returned no row for that index, not a
   failed read. A failed read throws, so the caller can never mistake a
   timeout for an empty receipt. The rows come from the CDN-cached
   endpoint, up to 10 seconds fresh, then up to 60 seconds stale while the cache revalidates, so up to about 70 seconds stale in total. A null rec for a very recent
   index means not yet in the cached rows, retry in a moment, not that
   it does not exist on chain. */
export async function readReceipt(index: number, opts?: ReceiptReadOptions): Promise<{ rec: Receipt | null; block: number | null }> {
  const { rows, block } = await fetchReceipts(VAULT_TEST, opts);
  const rec = rows.find((r) => Number(r.index) === index) ?? null;
  return { rec, block };
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
