/* Cynex live receipts endpoint, serverless backend.
 *
 * One GET to /api/live-receipts?vault=<vault> returns the receipts for
 * one vault, in the same shape the browser used to build itself from
 * the raw RPC: { rows, block }. Only the two Cynex vaults are accepted.
 * The response is CDN cached for 10 seconds with stale-while-revalidate
 * for 60 seconds, so the live refresh every 5 seconds mostly reads the
 * CDN instead of the RPC, and a transient RPC failure is covered by a
 * stale cached copy instead of an error page.
 *
 * Why this endpoint exists: near-api-js parses JSON with JSON.parse,
 * which rounds u64 timestamps over 2^53, and a rounded timestamp
 * recomputes to a different receipt hash, so a browser replay would
 * falsely fail. The browser used to fetch the receipts view raw and
 * quote the index, amount, and timestamp numbers before parsing,
 * keeping them exact as strings end to end. That quoting now lives
 * here, on the server, so the browser calls this endpoint instead of
 * the raw RPC. The CLI solves the same problem the same way
 * (cli/cynex.ts, parseReceiptsRaw).
 *
 * No secrets, no keys, no auth: a read-only public endpoint returning
 * public chain data. On RPC failure it answers 502, never an empty
 * success: a 200 with no rows would present a failure as chain truth.
 */

import { VAULT_TEST } from "./demo-settle.js";
import type { DemoRequest, DemoResponse } from "./demo-settle.js";

export const config = { maxDuration: 30 };

export const VAULT_PROD = "cynex-vault.cynexmaster.testnet";
const ALLOWED_VAULTS: readonly string[] = [VAULT_TEST, VAULT_PROD];

const RPC_URL = "https://test.rpc.fastnear.com";
export const LIVE_RECEIPTS_CACHE_CONTROL =
  "s-maxage=10, stale-while-revalidate=60";
const RECEIPT_PAGE_LIMIT = 50;
const RECEIPT_MAX_PAGES = 10;
const RECEIPT_FETCH_TIMEOUT_MS = 4000;
const RECEIPT_FETCH_MAX_ATTEMPTS = 3;
const RECEIPT_FETCH_RETRY_BASE_DELAY_MS = 500;
const RECEIPT_FETCH_TOTAL_TIMEOUT_MS = 20000;

export interface Receipt {
  index: number | string;
  prev_hash: number[] | string;
  obligation_id: string;
  recipient: string;
  amount: number | string;
  token_id: string;
  timestamp: number | string;
  tx_ref: string;
  hash?: string;
}

export interface LiveReceiptsRequest extends DemoRequest {
  query?: Record<string, string | string[] | undefined>;
}

export interface LiveReceiptsHandlerDeps {
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  totalTimeoutMs?: number;
}

export interface LiveReceiptsResponse {
  rows: Receipt[];
  block: number | null;
}

export interface LiveReceiptsErrorBody {
  success: false;
  code: string;
  error: string;
}

function fail(code: string, error: string): LiveReceiptsErrorBody {
  return { success: false, code, error };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* A fetch that always settles: the AbortController cancels the real
   request on timeout, and the racing timeout promise rejects even if
   the fetch implementation ignores the signal, so a hung read can
   never block the caller past timeoutMs. The controller is returned
   to the caller and stays alive past the headers, so the caller can
   abort the body stream if the body read times out. */
async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; controller: AbortController }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("fetch timed out after " + timeoutMs + "ms"));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }),
      timeout,
    ]);
    return { response, controller };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/* Race any promise against a timeout rejection, for reads that do not
   go through fetch and so cannot take an AbortSignal: the receipts
   response body read. The underlying promise keeps running if it loses
   the race, but the caller is never blocked past timeoutMs. */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
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
   a retry never sleeps past the deadline. */
async function withReceiptRetries<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  baseDelayMs: number,
  deadlineMs?: number,
): Promise<T> {
  if (maxAttempts < 1)
    throw new Error(
      "withReceiptRetries needs maxAttempts of at least 1, got " + maxAttempts,
    );
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isTransientReceiptError(error))
        throw error;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await sleep(
        deadlineMs === undefined
          ? delay
          : Math.max(0, Math.min(delay, deadlineMs - Date.now())),
      );
    }
  }
  throw lastError;
}

/* A decoded receipt entry must carry every receipt field, with the
   exact-integer fields as numbers or numeric strings: the quoting
   below turns large raw numbers into strings, small ones stay
   numbers. prev_hash arrives as a 32-byte array or a hex string,
   and tx_ref is a string that may be empty on chain. */
function isValidReceipt(value: unknown): value is Receipt {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const r = value as Record<string, unknown>;
  const isExactInt = (v: unknown): boolean =>
    (typeof v === "number" && Number.isFinite(v)) ||
    (typeof v === "string" && /^-?\d+$/.test(v));
  if (!isExactInt(r.index) || !isExactInt(r.amount) || !isExactInt(r.timestamp))
    return false;
  if (typeof r.obligation_id !== "string" || r.obligation_id.length === 0)
    return false;
  if (typeof r.recipient !== "string" || r.recipient.length === 0) return false;
  if (typeof r.token_id !== "string" || r.token_id.length === 0) return false;
  if (!(Array.isArray(r.prev_hash) || typeof r.prev_hash === "string"))
    return false;
  if (typeof r.tx_ref !== "string") return false;
  return true;
}

/* Quote the index, amount, and timestamp numbers in the raw receipt
   bytes before parsing, so u64 and u128 values over 2^53 stay exact
   as strings end to end. This is the entire reason the receipts used
   to be fetched raw: plain JSON.parse would round them, and a rounded
   timestamp recomputes to a different receipt hash. */
export function quoteReceiptNumbers(raw: string): string {
  return raw.replace(
    /"(index|amount|timestamp)":\s*(-?\d+)/g,
    '"$1":"$2"',
  );
}

async function fetchReceiptPage(
  fetchImpl: typeof fetch,
  rpcUrl: string,
  vault: string,
  start: number,
  limit: number,
  timeoutMs: number,
  blockHash?: string,
): Promise<{ rows: Receipt[]; block: number | null; blockHash: string | null }> {
  /* One deadline for the whole attempt: the headers and the body
     share timeoutMs, so slow headers leave only the remainder for
     the body instead of a second full timeout. */
  const startedAt = Date.now();
  const argsBase64 = Buffer.from(JSON.stringify({ start, limit })).toString(
    "base64",
  );
  /* A pinned block reads every page at the same block: the first page
     reads at finality and returns its block_hash, later pages pass
     that hash as block_id instead of finality. Without a hash yet
     (the first page, or an RPC that omits it) the page reads at
     finality, as before. */
  const { response, controller } = await fetchWithTimeout(
    fetchImpl,
    rpcUrl,
    {
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
          ...(blockHash === undefined
            ? { finality: "final" }
            : { block_id: blockHash }),
        },
      }),
    },
    timeoutMs,
  );
  /* A 5xx is a transient server failure, so it must throw an error
     the retry can fire on. Without this check a 5xx with a JSON body
     became a deterministic "receipts view failed" and a 5xx with an
     HTML body threw a SyntaxError out of response.json(). The ok
     check is === false so a mocked Response without an ok flag
     still reads as ok. */
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
  let data: {
    error?: unknown;
    result?: { result?: number[]; block_height?: number; block_hash?: string };
  };
  try {
    data = await withTimeout(response.json(), bodyMs, "receipts response body");
  } catch (error) {
    /* The body read timed out: abort the controller, so the underlying
       body stream is cancelled instead of reading on in the background
       after the caller has moved on. */
    controller.abort();
    throw error;
  }
  if (data == null || typeof data !== "object")
    throw new Error("receipts view failed: unexpected response shape");
  if (data.error)
    throw new Error("receipts view failed: " + JSON.stringify(data.error));
  /* A 200 with neither error nor result is an error, not an empty
     success: returning zero rows would present an unexpected shape
     as chain truth. */
  if (data.result == null)
    throw new Error("receipts view failed: missing result");
  const raw = Buffer.from(new Uint8Array(data.result?.result ?? [])).toString(
    "utf-8",
  );
  const parsed: unknown = JSON.parse(quoteReceiptNumbers(raw));
  /* The decoded payload must be an array of receipts: a 200 whose
     result bytes decode to {} or null used to return zero rows as a
     success, and [{}] passed as a receipt with every field
     undefined. Both are deterministic failures, never retried. */
  if (!Array.isArray(parsed))
    throw new Error("receipts view failed: unexpected receipt payload, not an array");
  const rows = parsed as Receipt[];
  for (const row of rows) {
    if (!isValidReceipt(row))
      throw new Error("receipts view failed: invalid receipt entry");
  }
  return {
    rows,
    block: data.result?.block_height ?? null,
    blockHash: data.result?.block_hash ?? null,
  };
}

async function fetchAllReceipts(
  vault: string,
  deps: LiveReceiptsHandlerDeps,
): Promise<{ rows: Receipt[]; block: number | null }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const rpcUrl = deps.rpcUrl ?? RPC_URL;
  const timeoutMs = deps.timeoutMs ?? RECEIPT_FETCH_TIMEOUT_MS;
  const maxAttempts = deps.maxAttempts ?? RECEIPT_FETCH_MAX_ATTEMPTS;
  const retryBaseDelayMs =
    deps.retryBaseDelayMs ?? RECEIPT_FETCH_RETRY_BASE_DELAY_MS;
  const totalTimeoutMs = deps.totalTimeoutMs ?? RECEIPT_FETCH_TOTAL_TIMEOUT_MS;
  /* Total deadline across pages: one page can take 13.5s worst case,
     so ten pages would be about 135s without this. The deadline is
     checked before every attempt and each attempt is clamped to the
     time left, so the call rejects once the budget is spent. */
  const deadline = Date.now() + totalTimeoutMs;
  const out: Receipt[] = [];
  let start = 0;
  let block: number | null = null;
  /* The first page's block_hash pins every later page to that block,
     so a settle landing between page reads cannot slip a newer receipt
     into a list reported at an older block. Until a hash is known the
     pages read at finality, as before. Retries of a page read the same
     pinned hash, because the retry closure reads this variable on
     every attempt. */
  let pinnedBlockHash: string | null = null;
  for (let i = 0; i < RECEIPT_MAX_PAGES; i++) {
    const page = await withReceiptRetries(
      () => {
        const remaining = deadline - Date.now();
        if (remaining <= 0)
          throw new Error(
            "receipts read exceeded total budget of " + totalTimeoutMs + "ms",
          );
        return fetchReceiptPage(
          fetchImpl,
          rpcUrl,
          vault,
          start,
          RECEIPT_PAGE_LIMIT,
          Math.min(timeoutMs, remaining),
          pinnedBlockHash ?? undefined,
        );
      },
      maxAttempts,
      retryBaseDelayMs,
      deadline,
    );
    /* A page that returns after the deadline has its rows rejected,
       not accepted: without this check an over-budget page still
       counted as a success. */
    if (Date.now() > deadline)
      throw new Error(
        "receipts read exceeded total budget of " + totalTimeoutMs + "ms",
      );
    if (page.rows.length === 0) break;
    if (block === null) {
      block = page.block;
      pinnedBlockHash = page.blockHash;
    }
    out.push(...page.rows);
    if (page.rows.length < RECEIPT_PAGE_LIMIT) break;
    /* The last permitted page came back full, so more receipts may
       exist past the cap: returning the rows gathered would present
       an incomplete read as a success. Fail closed instead, so the
       endpoint answers 502 and the caller retries instead of trusting
       a truncated list. */
    if (i === RECEIPT_MAX_PAGES - 1)
      throw new Error(
        "receipts exceed the read cap of " +
          RECEIPT_MAX_PAGES +
          " pages of " +
          RECEIPT_PAGE_LIMIT +
          " rows: more receipts may exist",
      );
    start += RECEIPT_PAGE_LIMIT;
  }
  return { rows: out, block };
}

export async function handleLiveReceipts(
  req: LiveReceiptsRequest,
  res: DemoResponse,
  deps: LiveReceiptsHandlerDeps = {},
): Promise<void> {
  if (req.method !== undefined && req.method !== "GET") {
    res.setHeader("Cache-Control", "no-store");
    res
      .status(405)
      .json(fail("METHOD_NOT_ALLOWED", "Only GET is accepted on this endpoint."));
    return;
  }

  const queryVault = req.query?.vault;
  const vault = Array.isArray(queryVault) ? queryVault[0] : queryVault;
  if (typeof vault !== "string" || !ALLOWED_VAULTS.includes(vault)) {
    res.setHeader("Cache-Control", "no-store");
    res.status(400).json(
      fail(
        "INVALID_VAULT",
        typeof vault === "string"
          ? "Unknown vault \"" +
              vault +
              "\": only " +
              ALLOWED_VAULTS.join(" and ") +
              " are accepted."
          : "A vault query parameter is required: only " +
              ALLOWED_VAULTS.join(" and ") +
              " are accepted.",
      ),
    );
    return;
  }

  let result: LiveReceiptsResponse;
  try {
    result = await fetchAllReceipts(vault, deps);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    res.setHeader("Cache-Control", "no-store");
    res.status(502).json(
      fail(
        "RECEIPTS_UNAVAILABLE",
        "The receipts could not be read from the chain: " + message,
      ),
    );
    return;
  }

  res.setHeader("Cache-Control", LIVE_RECEIPTS_CACHE_CONTROL);
  res.status(200).json({ rows: result.rows, block: result.block });
}

export default async function handler(
  req: LiveReceiptsRequest,
  res: DemoResponse,
): Promise<void> {
  await handleLiveReceipts(req, res, {});
}
