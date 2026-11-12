/* Tests for the receipts read in web/src/lib/near.ts, now served by
 * /api/live-receipts: a fetch that never resolves must fail within the
 * timeout instead of hanging, a slow read that then succeeds must
 * return its rows, retries happen only for transient failures, and an
 * invalid row is an error, never silently accepted. The endpoint
 * returns the full rows in one response, so there is no client
 * pagination any more: the server pages the RPC and quotes the exact
 * integers, the client only validates what comes back. An endpoint
 * 502 and a non-JSON body are transient and retried, a 400 is not, a
 * 200 with no rows array is an error rather than zero rows, and the
 * whole call has a total budget. The real RPC and the real endpoint
 * are never hit here; the global fetch is mocked and fake timers
 * drive the timeouts. */

import { jest } from "@jest/globals";

import {
  RECEIPT_FETCH_MAX_ATTEMPTS,
  RECEIPT_FETCH_TIMEOUT_MS,
  fetchReceipts,
  fetchWithTimeout,
  isTransientReceiptError,
  readReceipt,
  withReceiptRetries,
} from "../../web/src/lib/near.js";

const VAULT = "cynex-testvault.cynexmaster.testnet";
const BLOCK_HEIGHT = 277362593;

/* A timestamp over 2^53 and an amount over 2^53, as raw JSON numbers.
 * Plain JSON.parse would round both, so the receipts quoting must
 * turn them into exact strings. */
const BIG_TIMESTAMP = "1762951234567890123";
const BIG_AMOUNT = "123456789012345678901234567890";
const BIG_INDEX = "9007199254740993";

/* Rows as the endpoint returns them: exact-integer fields already
 * exact strings, because the server did the quoting. The client only
 * has to pass them through and validate them. */
const ROW_35 = {
  index: 35,
  prev_hash: [],
  obligation_id: "demo-live-005",
  recipient: "cynex-agent.cynexmaster.testnet",
  amount: BIG_AMOUNT,
  token_id: "usdc.fakes.testnet",
  timestamp: BIG_TIMESTAMP,
  tx_ref: "abc123",
};

/* A synthetic row with an index above 2^53, only to prove the client
 * keeps the index exact: no such receipt exists on chain, the largest
 * real index is 38. */
const ROW_BIG_INDEX = {
  ...ROW_35,
  index: BIG_INDEX,
  obligation_id: "exactness-fixture",
};

function endpointResponse(rows: unknown[]): Response {
  return mockResponse({ rows, block: BLOCK_HEIGHT });
}

const fetchMock = jest.fn();

function mockResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

/* An HTTP error page: not ok, and the body is HTML, so json() throws. */
function htmlErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async (): Promise<never> => {
      throw new SyntaxError("Unexpected token < in JSON at position 0");
    },
  } as unknown as Response;
}

function neverResolves(): Promise<Response> {
  return new Promise<Response>(() => {});
}

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("receipt fetch bounds", () => {
  it("keeps the per-attempt timeout shorter than the 5s refresh and the 8s retry window", () => {
    expect(RECEIPT_FETCH_TIMEOUT_MS).toBeLessThan(5000);
    expect(RECEIPT_FETCH_TIMEOUT_MS).toBeLessThan(8000);
    expect(RECEIPT_FETCH_MAX_ATTEMPTS).toBe(3);
  });
});

describe("fetchWithTimeout", () => {
  it("rejects when fetch never resolves, within the bounded wait, and aborts the request", async () => {
    fetchMock.mockImplementation(neverResolves);
    const promise = fetchWithTimeout("https://example.invalid", { method: "POST" }, 4000);
    const assertion = expect(promise).rejects.toThrow("fetch timed out after 4000ms");
    await jest.advanceTimersByTimeAsync(4000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal?.aborted).toBe(true);
  });

  it("returns the response when fetch resolves before the timeout", async () => {
    const response = mockResponse({ hello: "world" });
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(response), 100)),
    );
    const promise = fetchWithTimeout("https://example.invalid", {}, 4000);
    await jest.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBe(response);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal?.aborted).toBe(false);
  });
});

describe("withReceiptRetries", () => {
  it("retries a transient failure and returns the later success", async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue("ok");
    const promise = withReceiptRetries(fn, 3, 10);
    const assertion = expect(promise).resolves.toBe("ok");
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry a deterministic RPC error", async () => {
    const fn = jest.fn<() => Promise<string>>().mockRejectedValue(new Error("receipts view failed: {\"code\":-32601}"));
    await expect(withReceiptRetries(fn, 3, 10)).rejects.toThrow("receipts view failed");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws a real Error for maxAttempts 0 instead of throwing undefined", async () => {
    const fn = jest.fn<() => Promise<string>>().mockResolvedValue("ok");
    await expect(withReceiptRetries(fn, 0, 10)).rejects.toThrow("maxAttempts");
    expect(fn).toHaveBeenCalledTimes(0);
  });

  it("classifies timeout, abort, network, malformed-JSON and HTTP 5xx errors as transient, and RPC and HTTP 4xx errors as not", () => {
    expect(isTransientReceiptError(new Error("fetch timed out after 4000ms"))).toBe(true);
    expect(isTransientReceiptError(new TypeError("fetch failed"))).toBe(true);
    expect(isTransientReceiptError({ name: "AbortError" })).toBe(true);
    expect(isTransientReceiptError(new Error("receipts view failed: {}"))).toBe(false);
    expect(isTransientReceiptError(new SyntaxError("Unexpected token"))).toBe(true);
    expect(isTransientReceiptError(new Error("receipts view failed: HTTP 500"))).toBe(true);
    expect(isTransientReceiptError(new Error("receipts view failed: HTTP 404"))).toBe(false);
    expect(isTransientReceiptError(null)).toBe(false);
  });
});

describe("fetchReceipts", () => {
  it("calls the live receipts endpoint with the vault, as a GET", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(endpointResponse([ROW_35])));
    const out = await fetchReceipts(VAULT, { timeoutMs: 1000, maxAttempts: 1, retryBaseDelayMs: 10 });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].obligation_id).toBe("demo-live-005");
    expect(out.block).toBe(BLOCK_HEIGHT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/live-receipts?vault=" + encodeURIComponent(VAULT),
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("GET");
  });

  it("a hung first attempt that then succeeds returns its rows", async () => {
    fetchMock
      .mockImplementationOnce(neverResolves)
      .mockImplementation(() => Promise.resolve(endpointResponse([ROW_35])));
    const promise = fetchReceipts(VAULT, { timeoutMs: 100, maxAttempts: 3, retryBaseDelayMs: 10 });
    await jest.advanceTimersByTimeAsync(500);
    const out = await promise;
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].obligation_id).toBe("demo-live-005");
    expect(out.block).toBe(BLOCK_HEIGHT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects within a bounded wait when every attempt hangs, calling fetch exactly maxAttempts times", async () => {
    fetchMock.mockImplementation(neverResolves);
    const promise = fetchReceipts(VAULT, { timeoutMs: 100, maxAttempts: 2, retryBaseDelayMs: 10 });
    const assertion = expect(promise).rejects.toThrow("timed out");
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a large u128 amount, and an index and timestamp above 2^53, exact", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(endpointResponse([ROW_BIG_INDEX])));
    const out = await fetchReceipts(VAULT, { timeoutMs: 1000, maxAttempts: 1, retryBaseDelayMs: 10 });
    expect(out.rows).toHaveLength(1);
    expect(String(out.rows[0].index)).toBe(BIG_INDEX);
    expect(BigInt(String(out.rows[0].index))).toBe(9007199254740993n);
    expect(out.rows[0].timestamp).toBe(BIG_TIMESTAMP);
    expect(out.rows[0].amount).toBe(BIG_AMOUNT);
    expect(BigInt(out.rows[0].timestamp as string)).toBe(1762951234567890123n);
    expect(BigInt(out.rows[0].amount as string)).toBe(123456789012345678901234567890n);
    expect(String(Number(BIG_TIMESTAMP))).not.toBe(BIG_TIMESTAMP);
  });

  it("does not retry a deterministic endpoint 400", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 400, json: async () => ({}) } as unknown as Response),
    );
    await expect(
      fetchReceipts(VAULT, { timeoutMs: 1000, maxAttempts: 3, retryBaseDelayMs: 10 }),
    ).rejects.toThrow("receipts view failed: HTTP 400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats an endpoint 502 as transient and retries it", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(htmlErrorResponse(502)));
    const promise = fetchReceipts(VAULT, { timeoutMs: 1000, maxAttempts: 3, retryBaseDelayMs: 10 });
    const assertion = expect(promise).rejects.toThrow("receipts view failed: HTTP 502");
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("treats a 200 with an HTML body as transient and retries it", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async (): Promise<never> => {
          throw new SyntaxError("Unexpected token < in JSON at position 0");
        },
      } as unknown as Response),
    );
    const promise = fetchReceipts(VAULT, { timeoutMs: 1000, maxAttempts: 3, retryBaseDelayMs: 10 });
    const assertion = expect(promise).rejects.toThrow("Unexpected token");
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws instead of returning zero rows when the body has no rows array", async () => {
    for (const body of [{ block: BLOCK_HEIGHT }, { rows: {}, block: BLOCK_HEIGHT }, { rows: null, block: BLOCK_HEIGHT }]) {
      fetchMock.mockImplementation(() => Promise.resolve(mockResponse(body)));
      await expect(
        fetchReceipts(VAULT, { timeoutMs: 1000, maxAttempts: 1, retryBaseDelayMs: 10 }),
      ).rejects.toThrow("receipts view failed");
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid row instead of accepting it silently", async () => {
    const bad = { ...ROW_35 };
    delete (bad as Record<string, unknown>).amount;
    fetchMock.mockImplementation(() => Promise.resolve(endpointResponse([bad])));
    await expect(
      fetchReceipts(VAULT, { timeoutMs: 1000, maxAttempts: 1, retryBaseDelayMs: 10 }),
    ).rejects.toThrow("receipts view failed: invalid receipt entry");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects once the whole call exceeds its total budget instead of retrying past it", async () => {
    fetchMock.mockImplementation(neverResolves);
    const promise = fetchReceipts(VAULT, {
      timeoutMs: 100,
      maxAttempts: 3,
      retryBaseDelayMs: 10,
      totalTimeoutMs: 150,
    });
    const assertion = expect(promise).rejects.toThrow("exceeded total budget");
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("readReceipt", () => {
  it("rejects instead of hanging when fetch never resolves", async () => {
    fetchMock.mockImplementation(neverResolves);
    const promise = readReceipt(35, { timeoutMs: 100, maxAttempts: 1, retryBaseDelayMs: 10 });
    const assertion = expect(promise).rejects.toThrow("timed out");
    await jest.advanceTimersByTimeAsync(500);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the single row on success, with the timestamp exact", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(endpointResponse([ROW_35])));
    const out = await readReceipt(35, { timeoutMs: 1000, maxAttempts: 1, retryBaseDelayMs: 10 });
    expect(out.rec?.obligation_id).toBe("demo-live-005");
    expect(out.rec?.timestamp).toBe(BIG_TIMESTAMP);
    expect(out.block).toBe(BLOCK_HEIGHT);
  });

  it("returns null when the index is not in the rows", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(endpointResponse([ROW_35])));
    const out = await readReceipt(99, { timeoutMs: 1000, maxAttempts: 1, retryBaseDelayMs: 10 });
    expect(out.rec).toBeNull();
    expect(out.block).toBe(BLOCK_HEIGHT);
  });
});
