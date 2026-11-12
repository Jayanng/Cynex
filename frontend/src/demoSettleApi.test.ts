/* Tests for the /api/demo-settle handler: key scope, rate limit, and
 * the settle contract. The handler is exercised with a mocked chain so
 * no testnet call is made. The contract under test: a confirmed settle
 * whose receipt cannot be read is SETTLE_UNCONFIRMED, never a success
 * with a null receipt; only a definitive ERR_* refusal is
 * SETTLE_FAILED; any other settle error is unconfirmed, never a retry. */

import { KeyPair } from "near-api-js";
import {
  checkRateLimit,
  createRateLimitStore,
  handleDemoSettle,
  verifyKeyScope,
} from "../../web/api/demo-settle.js";
import type {
  DemoChain,
  DemoHandlerDeps,
  DemoRequest,
  DemoResponse,
  ObligationRow,
} from "../../web/api/demo-settle.js";

const VAULT_TEST = "cynex-testvault.cynexmaster.testnet";
const AGENT = "cynex-agent.cynexmaster.testnet";

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

function mockReq(ip: string): DemoRequest {
  return { method: "POST", headers: {}, socket: { remoteAddress: ip } };
}

function scopedKeyList(publicKey: string): unknown {
  return {
    keys: [
      {
        public_key: publicKey,
        access_key: {
          permission: {
            FunctionCall: {
              receiver_id: VAULT_TEST,
              method_names: ["settle"],
              allowance: "250000000000000000000000",
            },
          },
        },
      },
    ],
  };
}

function makeChain(overrides: Partial<DemoChain> = {}): DemoChain & { settled: () => boolean } {
  let settled = false;
  const readyRow: ObligationRow = {
    obligation_id: "demo-live-005",
    recipient: AGENT,
    amount: "100",
    state: "READY",
  };
  const base: DemoChain = {
    viewAccessKeyList: async () => ({}),
    getObligation: async (id: string) => {
      if (id === "demo-live-005") {
        return { ...readyRow, state: settled ? "PAID" : "READY" };
      }
      return null;
    },
    getPolicy: async () => ({ spent: 5800 }),
    getReceiptCount: async () => 36,
    getReceipt: async (index: number) => {
      if (index === 35) return { obligation_id: "demo-live-005" };
      return { obligation_id: "demo-live-001" };
    },
    settle: async () => {
      settled = true;
      return "txhash123";
    },
  };
  return { ...base, ...overrides, settled: () => settled };
}

function makeDeps(chain: DemoChain, secretKey: string, ip: string): DemoHandlerDeps {
  return {
    env: { CYNEX_DEMO_KEY: secretKey },
    createChain: () => chain,
    rateLimitStore: createRateLimitStore(),
    settleTimeoutMs: 5000,
    confirmTimeoutMs: 2000,
    confirmIntervalMs: 10,
    confirmReadsTimeoutMs: 2000,
    handlerDeadlineMs: 30000,
    scopeTimeoutMs: 1000,
    scanTimeoutMs: 1000,
  };
}

function makeKey(): { secret: string; publicKey: string } {
  const kp = KeyPair.fromRandom("ed25519");
  return { secret: kp.toString(), publicKey: kp.getPublicKey().toString() };
}

describe("verifyKeyScope", () => {
  it("accepts a settle-only key scoped to the test vault", () => {
    const { publicKey } = makeKey();
    const out = verifyKeyScope(scopedKeyList(publicKey), publicKey, VAULT_TEST);
    expect(out.ok).toBe(true);
  });

  it("rejects a key that is not on the account", () => {
    const { publicKey } = makeKey();
    const other = makeKey().publicKey;
    const out = verifyKeyScope(scopedKeyList(other), publicKey, VAULT_TEST);
    expect(out.ok).toBe(false);
  });

  it("rejects a full-access key", () => {
    const { publicKey } = makeKey();
    const out = verifyKeyScope(
      { keys: [{ public_key: publicKey, access_key: { permission: "FullAccess" } }] },
      publicKey,
      VAULT_TEST,
    );
    expect(out.ok).toBe(false);
  });

  it("rejects a key scoped to the wrong receiver", () => {
    const { publicKey } = makeKey();
    const list = scopedKeyList(publicKey) as { keys: Array<Record<string, unknown>> };
    const entry = list.keys[0] as { access_key: { permission: { FunctionCall: { receiver_id: string } } } };
    entry.access_key.permission.FunctionCall.receiver_id = "someone-else.testnet";
    const out = verifyKeyScope(list, publicKey, VAULT_TEST);
    expect(out.ok).toBe(false);
  });

  it("rejects a key that allows more than settle", () => {
    const { publicKey } = makeKey();
    const list = scopedKeyList(publicKey) as { keys: Array<Record<string, unknown>> };
    const entry = list.keys[0] as { access_key: { permission: { FunctionCall: { method_names: string[] } } } };
    entry.access_key.permission.FunctionCall.method_names = ["settle", "create_obligation"];
    const out = verifyKeyScope(list, publicKey, VAULT_TEST);
    expect(out.ok).toBe(false);
  });

  it("rejects a key list with no keys array", () => {
    const { publicKey } = makeKey();
    expect(verifyKeyScope({}, publicKey, VAULT_TEST).ok).toBe(false);
    expect(verifyKeyScope(null, publicKey, VAULT_TEST).ok).toBe(false);
  });
});

describe("checkRateLimit", () => {
  it("allows the first settle, blocks the second within a minute, allows after an hour", () => {
    const store = createRateLimitStore();
    expect(checkRateLimit(store, "1.2.3.4", 1000).allowed).toBe(true);
    expect(checkRateLimit(store, "1.2.3.4", 2000).allowed).toBe(false);
    expect(checkRateLimit(store, "1.2.3.4", 1000 + 3600000).allowed).toBe(true);
  });

  it("limits per IP, not globally", () => {
    const store = createRateLimitStore();
    expect(checkRateLimit(store, "1.2.3.4", 1000).allowed).toBe(true);
    expect(checkRateLimit(store, "5.6.7.8", 1000).allowed).toBe(true);
  });

  it("blocks the sixth settle within an hour", () => {
    const store = createRateLimitStore();
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(store, "1.2.3.4", 1000 + i * 61000).allowed).toBe(true);
    }
    expect(checkRateLimit(store, "1.2.3.4", 1000 + 5 * 61000).allowed).toBe(false);
  });
});

describe("handleDemoSettle", () => {
  it("settles the next READY obligation and returns the receipt index", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
    });
    const { res, body } = mockRes();
    await handleDemoSettle(mockReq("9.9.9.9"), res, makeDeps(chain, secret, "9.9.9.9"));
    const b = body() as Record<string, unknown>;
    expect(b.success).toBe(true);
    expect(b.obligationId).toBe("demo-live-005");
    expect(b.receiptIndex).toBe(35);
    expect(b.txHash).toBe("txhash123");
    expect(chain.settled()).toBe(true);
  });

  it("answers SETTLE_UNCONFIRMED, not success, when the receipt cannot be read after a confirmed PAID", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      getReceipt: async () => {
        throw new Error("rpc down");
      },
    });
    const { res, body } = mockRes();
    await handleDemoSettle(mockReq("9.9.9.10"), res, makeDeps(chain, secret, "9.9.9.10"));
    const b = body() as Record<string, unknown>;
    expect(b.success).toBe(false);
    expect(b.code).toBe("SETTLE_UNCONFIRMED");
    expect(b.txHash).toBe("txhash123");
    expect(chain.settled()).toBe(true);
  });

  it("answers SETTLE_FAILED only for a definitive ERR_* refusal", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async () => {
        throw new Error("ERR_TERMS_MISMATCH");
      },
    });
    const { res, body } = mockRes();
    await handleDemoSettle(mockReq("9.9.9.11"), res, makeDeps(chain, secret, "9.9.9.11"));
    const b = body() as Record<string, unknown>;
    expect(b.success).toBe(false);
    expect(b.code).toBe("SETTLE_FAILED");
    expect(String(b.error)).toContain("ERR_TERMS_MISMATCH");
  });

  it("answers SETTLE_UNCONFIRMED for a transport error with no ERR_* code", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    const { res, body } = mockRes();
    await handleDemoSettle(mockReq("9.9.9.12"), res, makeDeps(chain, secret, "9.9.9.12"));
    const b = body() as Record<string, unknown>;
    expect(b.success).toBe(false);
    expect(b.code).toBe("SETTLE_UNCONFIRMED");
  });

  it("answers DEMO_USED_UP when no demo obligation is READY", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      getObligation: async () => null,
    });
    const { res, body } = mockRes();
    await handleDemoSettle(mockReq("9.9.9.13"), res, makeDeps(chain, secret, "9.9.9.13"));
    const b = body() as Record<string, unknown>;
    expect(b.success).toBe(false);
    expect(b.code).toBe("DEMO_USED_UP");
  });

  it("answers DEMO_NOT_CONFIGURED when the demo key is missing", async () => {
    const chain = makeChain();
    const { res, body } = mockRes();
    await handleDemoSettle(mockReq("9.9.9.14"), res, {
      env: {},
      createChain: () => chain,
      rateLimitStore: createRateLimitStore(),
    });
    const b = body() as Record<string, unknown>;
    expect(b.success).toBe(false);
    expect(b.code).toBe("DEMO_NOT_CONFIGURED");
  });

  it("answers SCOPE_CHECK_FAILED when the key is not scoped to the test vault", async () => {
    const { secret, publicKey } = makeKey();
    const other = makeKey().publicKey;
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(other),
    });
    const { res, body } = mockRes();
    await handleDemoSettle(mockReq("9.9.9.15"), res, makeDeps(chain, secret, "9.9.9.15"));
    const b = body() as Record<string, unknown>;
    expect(b.success).toBe(false);
    expect(b.code).toBe("SCOPE_CHECK_FAILED");
    expect(publicKey).toBeTruthy();
  });
});

describe("handleDemoSettle, untested paths", () => {
  it("answers SETTLE_TIMEOUT when the settle call times out", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async () => {
        throw new Error("settle confirmation timed out");
      },
    });
    const { res, body } = mockRes();
    await handleDemoSettle(mockReq("9.9.9.20"), res, makeDeps(chain, secret, "9.9.9.20"));
    const b = body() as Record<string, unknown>;
    expect(b.success).toBe(false);
    expect(b.code).toBe("SETTLE_TIMEOUT");
  });

  it("answers SETTLE_UNCONFIRMED when the settle returns an unknown tx hash", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async () => "unknown",
    });
    const { res, body } = mockRes();
    await handleDemoSettle(mockReq("9.9.9.21"), res, makeDeps(chain, secret, "9.9.9.21"));
    const b = body() as Record<string, unknown>;
    expect(b.success).toBe(false);
    expect(b.code).toBe("SETTLE_UNCONFIRMED");
  });

  it("answers 429 with a Retry-After header on the second settle within a minute", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
    });
    const store = createRateLimitStore();
    const deps = makeDeps(chain, secret, "9.9.9.22");
    deps.rateLimitStore = store;
    const first = mockRes();
    await handleDemoSettle(mockReq("9.9.9.22"), first.res, deps);
    expect((first.body() as Record<string, unknown>).success).toBe(true);
    const second = mockRes();
    await handleDemoSettle(mockReq("9.9.9.22"), second.res, deps);
    expect(second.status()).toBe(429);
    expect(second.headers()["Retry-After"]).toBeDefined();
    expect((second.body() as Record<string, unknown>).code).toBe("RATE_LIMITED");
  });

  it("rate limits by the forwarded-for IP, not the socket address", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
    });
    const store = createRateLimitStore();
    const deps = makeDeps(chain, secret, "9.9.9.23");
    deps.rateLimitStore = store;
    const req1: DemoRequest = {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.7" },
      socket: { remoteAddress: "10.0.0.1" },
    };
    const first = mockRes();
    await handleDemoSettle(req1, first.res, deps);
    expect((first.body() as Record<string, unknown>).success).toBe(true);
    const req2: DemoRequest = {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
      socket: { remoteAddress: "10.0.0.2" },
    };
    const second = mockRes();
    await handleDemoSettle(req2, second.res, deps);
    expect(second.status()).toBe(429);
  });

  it("answers SETTLE_UNCONFIRMED for a transport error carrying an ERR_ substring", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async () => {
        throw new Error("socket hang up: ERR_SOCKET_CLOSED");
      },
    });
    const { res, body } = mockRes();
    await handleDemoSettle(mockReq("9.9.9.24"), res, makeDeps(chain, secret, "9.9.9.24"));
    const b = body() as Record<string, unknown>;
    expect(b.success).toBe(false);
    expect(b.code).toBe("SETTLE_UNCONFIRMED");
  });
});
