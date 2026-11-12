/* Tests for the /api/live-receipts handler: the vault allow list, the
 * cache headers, the exact-integer quoting on the server, server-side
 * pagination of the RPC, and the 502 on RPC failure instead of an
 * empty success. The RPC is mocked; no testnet call is made. */

import { jest } from "@jest/globals";

import {
  LIVE_RECEIPTS_CACHE_CONTROL,
  VAULT_PROD,
  handleLiveReceipts,
} from "../../web/api/live-receipts.js";
import type {
  LiveReceiptsHandlerDeps,
  LiveReceiptsRequest,
} from "../../web/api/live-receipts.js";
import { VAULT_TEST } from "../../web/api/demo-settle.js";
import type { DemoResponse } from "../../web/api/demo-settle.js";

const BLOCK_HEIGHT = 277362593;
const BLOCK_HASH = "test-pinned-block-hash";

/* A timestamp over 2^53 and an amount over 2^53, as raw JSON numbers.
 * Plain JSON.parse would round both, so the server quoting must turn
 * them into exact strings. */
const BIG_TIMESTAMP = "1762951234567890123";
const BIG_AMOUNT = "123456789012345678901234567890";
const ONE_ROW =
  '[{"index":35,"prev_hash":[],"obligation_id":"demo-live-005",'
  + '"recipient":"cynex-agent.cynexmaster.testnet","amount":'
  + BIG_AMOUNT
  + ',"token_id":"usdc.fakes.testnet","timestamp":'
  + BIG_TIMESTAMP
  + ',"tx_ref":"abc123"}]';

/* A synthetic full page of 50 rows, only to force pagination onto a
 * second page: no 50-row page exists on chain, the vault holds 39
 * receipts. Every row carries all receipt fields. */
const FIFTY_ROWS =
  "["
  + Array.from(
      { length: 50 },
      (_, i) =>
        '{"index":' + i + ',"prev_hash":[],"obligation_id":"pagination-fixture",'
        + '"recipient":"cynex-agent.cynexmaster.testnet","amount":"100",'
        + '"token_id":"usdc.fakes.testnet","timestamp":' + BIG_TIMESTAMP
        + ',"tx_ref":""}',
    ).join(",")
  + "]";

const fetchMock = jest.fn();

function mockRes(): {
  res: DemoResponse;
  body: () => unknown;
  status: () => number;
  headers: () => Record<string, string>;
} {
  let code = 200;
  let payload: unknown = null;
  const headers: Record<string, string> = {};
  const res: DemoResponse = {
    status(c: number) {
      code = c;
      return res;
    },
    json(b: unknown) {
      payload = b;
    },
    setHeader(name: string, value: string | string[]) {
      headers[name] = Array.isArray(value) ? value.join(", ") : value;
    },
  };
  return { res, body: () => payload, status: () => code, headers: () => headers };
}

function mockReq(
  vault: string | undefined,
  method = "GET",
): LiveReceiptsRequest {
  return {
    method,
    headers: {},
    query: vault === undefined ? {} : { vault },
  };
}

function rpcResponse(rowsJson: string, blockHash?: string): Response {
  const bytes = [...new TextEncoder().encode(rowsJson)];
  return {
    ok: true,
    status: 200,
    json: async () => ({
      result: {
        result: bytes,
        block_height: BLOCK_HEIGHT,
        ...(blockHash === undefined ? {} : { block_hash: blockHash }),
      },
    }),
  } as unknown as Response;
}

function rpcErrorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response;
}

function deps(): LiveReceiptsHandlerDeps {
  return {
    fetchImpl: fetchMock as unknown as typeof fetch,
    retryBaseDelayMs: 10,
    timeoutMs: 1000,
    totalTimeoutMs: 5000,
  };
}

async function run(
  vault: string | undefined,
  method = "GET",
  d: LiveReceiptsHandlerDeps = deps(),
): Promise<{
  body: () => unknown;
  status: () => number;
  headers: () => Record<string, string>;
}> {
  const { res, body, status, headers } = mockRes();
  await handleLiveReceipts(mockReq(vault, method), res, d);
  return { body, status, headers };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("handleLiveReceipts", () => {
  it("returns the receipts for the test vault, with exact integers and the cache header", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(rpcResponse(ONE_ROW)));
    const out = await run(VAULT_TEST);
    expect(out.status()).toBe(200);
    const b = out.body() as { rows: Record<string, unknown>[]; block: number };
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0].obligation_id).toBe("demo-live-005");
    expect(b.rows[0].timestamp).toBe(BIG_TIMESTAMP);
    expect(b.rows[0].amount).toBe(BIG_AMOUNT);
    expect(BigInt(String(b.rows[0].timestamp))).toBe(1762951234567890123n);
    expect(BigInt(String(b.rows[0].amount))).toBe(
      123456789012345678901234567890n,
    );
    expect(b.block).toBe(BLOCK_HEIGHT);
    expect(out.headers()["Cache-Control"]).toBe(LIVE_RECEIPTS_CACHE_CONTROL);
    expect(out.headers()["Cache-Control"]).toBe(
      "s-maxage=10, stale-while-revalidate=60",
    );
    expect(out.headers()["CDN-Cache-Control"]).toBe(
      LIVE_RECEIPTS_CACHE_CONTROL,
    );
    expect(out.headers()["CDN-Cache-Control"]).toBe(
      "s-maxage=10, stale-while-revalidate=60",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://test.rpc.fastnear.com");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    const sent = JSON.parse(String(init.body)) as {
      method: string;
      params: { method_name: string; account_id: string };
    };
    expect(sent.method).toBe("query");
    expect(sent.params.method_name).toBe("receipts");
    expect(sent.params.account_id).toBe(VAULT_TEST);
  });

  it("returns the receipts for the production vault", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(rpcResponse(ONE_ROW)));
    const out = await run(VAULT_PROD);
    expect(out.status()).toBe(200);
    const b = out.body() as { rows: unknown[] };
    expect(b.rows).toHaveLength(1);
    const sent = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    ) as { params: { account_id: string } };
    expect(sent.params.account_id).toBe(VAULT_PROD);
  });

  it("pages the RPC until a short page and returns all rows", async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(rpcResponse(FIFTY_ROWS)))
      .mockImplementation(() => Promise.resolve(rpcResponse(ONE_ROW)));
    const out = await run(VAULT_TEST);
    expect(out.status()).toBe(200);
    const b = out.body() as { rows: unknown[] };
    expect(b.rows).toHaveLength(51);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    ) as { params: { args_base64: string } };
    expect(
      JSON.parse(
        Buffer.from(second.params.args_base64, "base64").toString("utf-8"),
      ),
    ).toEqual({ start: 50, limit: 50 });
  });

  it("rejects an unknown vault with 400 and never calls the RPC", async () => {
    const out = await run("evil.testnet");
    expect(out.status()).toBe(400);
    const b = out.body() as { success: boolean; code: string; error: string };
    expect(b.success).toBe(false);
    expect(b.code).toBe("INVALID_VAULT");
    expect(b.error).toContain("evil.testnet");
    expect(out.headers()["Cache-Control"]).toBe("no-store");
    expect(out.headers()["CDN-Cache-Control"]).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing vault with 400 and never calls the RPC", async () => {
    const out = await run(undefined);
    expect(out.status()).toBe(400);
    const b = out.body() as { success: boolean; code: string };
    expect(b.success).toBe(false);
    expect(b.code).toBe("INVALID_VAULT");
    expect(out.headers()["Cache-Control"]).toBe("no-store");
    expect(out.headers()["CDN-Cache-Control"]).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-GET method with 405 and never calls the RPC", async () => {
    const out = await run(VAULT_TEST, "POST");
    expect(out.status()).toBe(405);
    const b = out.body() as { success: boolean; code: string };
    expect(b.success).toBe(false);
    expect(b.code).toBe("METHOD_NOT_ALLOWED");
    expect(out.headers()["Cache-Control"]).toBe("no-store");
    expect(out.headers()["CDN-Cache-Control"]).toBe("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the RPC request fails, after retrying transient failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const out = await run(VAULT_TEST);
    expect(out.status()).toBe(502);
    const b = out.body() as { success: boolean; code: string; error: string };
    expect(b.success).toBe(false);
    expect(b.code).toBe("RECEIPTS_UNAVAILABLE");
    expect(b.error).toContain("fetch failed");
    expect(out.headers()["Cache-Control"]).toBe("no-store");
    expect(out.headers()["CDN-Cache-Control"]).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns 502 when the RPC answers with an error, without retrying", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ error: { code: -32601, message: "Method not found" } }),
      } as unknown as Response),
    );
    const out = await run(VAULT_TEST);
    expect(out.status()).toBe(502);
    const b = out.body() as { success: boolean; code: string };
    expect(b.success).toBe(false);
    expect(b.code).toBe("RECEIPTS_UNAVAILABLE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when the receipt payload is not an array, never zero rows as success", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(rpcResponse("{}")));
    const out = await run(VAULT_TEST);
    expect(out.status()).toBe(502);
    const b = out.body() as { success: boolean; code: string };
    expect(b.success).toBe(false);
    expect(b.code).toBe("RECEIPTS_UNAVAILABLE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when a receipt entry is invalid", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(rpcResponse('[{"index":35}]')));
    const out = await run(VAULT_TEST);
    expect(out.status()).toBe(502);
    const b = out.body() as { success: boolean; code: string };
    expect(b.success).toBe(false);
    expect(b.code).toBe("RECEIPTS_UNAVAILABLE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient RPC 500 and then succeeds", async () => {
    fetchMock
      .mockImplementationOnce(() => Promise.resolve(rpcErrorResponse(500)))
      .mockImplementation(() => Promise.resolve(rpcResponse(ONE_ROW)));
    const out = await run(VAULT_TEST);
    expect(out.status()).toBe(200);
    const b = out.body() as { rows: unknown[] };
    expect(b.rows).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns 502 when the RPC never resolves, within the total budget", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const startedAt = Date.now();
    const out = await run(VAULT_TEST, "GET", {
      ...deps(),
      timeoutMs: 50,
      totalTimeoutMs: 300,
      retryBaseDelayMs: 10,
    });
    expect(out.status()).toBe(502);
    const b = out.body() as { success: boolean; code: string };
    expect(b.success).toBe(false);
    expect(b.code).toBe("RECEIPTS_UNAVAILABLE");
    expect(out.headers()["Cache-Control"]).toBe("no-store");
    expect(out.headers()["CDN-Cache-Control"]).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it("returns 502 once the total budget is spent, instead of retrying forever", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const startedAt = Date.now();
    const out = await run(VAULT_TEST, "GET", {
      ...deps(),
      timeoutMs: 50,
      totalTimeoutMs: 200,
      retryBaseDelayMs: 10,
      maxAttempts: 10,
    });
    expect(out.status()).toBe(502);
    const b = out.body() as { success: boolean; code: string; error: string };
    expect(b.success).toBe(false);
    expect(b.code).toBe("RECEIPTS_UNAVAILABLE");
    expect(b.error).toContain("total budget");
    expect(out.headers()["Cache-Control"]).toBe("no-store");
    expect(out.headers()["CDN-Cache-Control"]).toBe("no-store");
    expect(fetchMock.mock.calls.length).toBeLessThan(10);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it("returns 502 when ten full pages arrive, instead of silently truncating", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(rpcResponse(FIFTY_ROWS)));
    const out = await run(VAULT_TEST);
    expect(out.status()).toBe(502);
    const b = out.body() as { success: boolean; code: string; error: string };
    expect(b.success).toBe(false);
    expect(b.code).toBe("RECEIPTS_UNAVAILABLE");
    expect(b.error).toContain("read cap");
    expect(out.headers()["Cache-Control"]).toBe("no-store");
    expect(out.headers()["CDN-Cache-Control"]).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("pins later pages and their retries to the first page block hash", async () => {
    fetchMock
      .mockImplementationOnce(() =>
        Promise.resolve(rpcResponse(FIFTY_ROWS, BLOCK_HASH)),
      )
      .mockImplementationOnce(() =>
        Promise.reject(new TypeError("fetch failed")),
      )
      .mockImplementation(() => Promise.resolve(rpcResponse(ONE_ROW, BLOCK_HASH)));
    const out = await run(VAULT_TEST);
    expect(out.status()).toBe(200);
    const b = out.body() as { rows: unknown[]; block: number };
    expect(b.rows).toHaveLength(51);
    expect(b.block).toBe(BLOCK_HEIGHT);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const paramsOf = (call: number) => {
      const init = fetchMock.mock.calls[call][1] as RequestInit;
      return JSON.parse(String(init.body)) as {
        params: {
          finality?: string;
          block_id?: string;
          args_base64: string;
        };
      };
    };
    expect(paramsOf(0).params.finality).toBe("final");
    expect(paramsOf(0).params.block_id).toBeUndefined();
    expect(paramsOf(1).params.block_id).toBe(BLOCK_HASH);
    expect(paramsOf(1).params.finality).toBeUndefined();
    expect(paramsOf(2).params.block_id).toBe(BLOCK_HASH);
    expect(paramsOf(2).params.finality).toBeUndefined();
    for (const call of [1, 2]) {
      expect(
        JSON.parse(
          Buffer.from(paramsOf(call).params.args_base64, "base64").toString(
            "utf-8",
          ),
        ),
      ).toEqual({ start: 50, limit: 50 });
    }
  });

  it("aborts the body stream when the body read times out", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url: unknown, init?: RequestInit) => {
      if (init?.signal !== undefined) signals.push(init.signal);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => new Promise(() => {}),
      } as unknown as Response);
    });
    const out = await run(VAULT_TEST, "GET", {
      ...deps(),
      timeoutMs: 50,
      totalTimeoutMs: 5000,
      retryBaseDelayMs: 10,
    });
    expect(out.status()).toBe(502);
    const b = out.body() as { success: boolean; code: string };
    expect(b.success).toBe(false);
    expect(b.code).toBe("RECEIPTS_UNAVAILABLE");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(signals).toHaveLength(3);
    for (const signal of signals) expect(signal.aborted).toBe(true);
  });
});
