/**
 * Tests for the "Run it live" serverless backend in
 * web/api/demo-settle.ts: the key scope check, the rate limit, the
 * client IP read, and the handler itself with a stubbed chain, so no
 * test here submits a transaction. The live chain behaviour (scope
 * re-check, READY scan, settle with chain terms) is exercised by the
 * stub through the same code path the real chain takes.
 * Run: NODE_OPTIONS=--experimental-vm-modules npx jest --roots src
 *   ../services --runInBand, from frontend/.
 */
import { KeyPair } from "near-api-js";
import {
  checkRateLimit,
  createRateLimitStore,
  getClientIp,
  handleDemoSettle,
  verifyKeyScope,
  type DemoChain,
  type DemoRequest,
  type DemoResponse,
  type ObligationRow,
} from "../../web/api/demo-settle.js";

const VAULT_TEST = "cynex-testvault.cynexmaster.testnet";
const AGENT2 = "cynex-agent2.cynexmaster.testnet";

function mockRes(): {
  res: DemoResponse;
  sent: {
    status: number;
    body: unknown;
    headers: Record<string, string | string[]>;
  };
} {
  const sent: {
    status: number;
    body: unknown;
    headers: Record<string, string | string[]>;
  } = { status: 0, body: null, headers: {} };
  const res: DemoResponse = {
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
    },
    setHeader(name: string, value: string | string[]) {
      sent.headers[name] = value;
    },
  };
  return { res, sent };
}

function postReq(
  ip = "203.0.113.7",
  headers: Record<string, string> = {},
): DemoRequest {
  return {
    method: "POST",
    headers: { "x-forwarded-for": ip, ...headers },
    socket: { remoteAddress: ip },
  };
}

function keyListFor(publicKey: string): unknown {
  return {
    keys: [
      {
        public_key: publicKey,
        access_key: {
          permission: {
            FunctionCall: {
              allowance: "250000000000000000000000",
              receiver_id: VAULT_TEST,
              method_names: ["settle"],
            },
          },
        },
      },
    ],
  };
}

interface StubOptions {
  readyIds?: string[];
  settleTx?: string;
  settleError?: Error | null;
  settleHangs?: boolean;
  keyList?: unknown;
  keyListError?: Error | null;
}

function stubChain(opts: StubOptions = {}): {
  chain: DemoChain;
  settleCalls: { id: string; recipient: string; amount: string }[];
} {
  const ready = new Set(opts.readyIds ?? ["demo-live-002"]);
  const settleCalls: { id: string; recipient: string; amount: string }[] = [];
  const chain: DemoChain = {
    viewAccessKeyList: async () => {
      if (opts.keyListError) throw opts.keyListError;
      return opts.keyList ?? { keys: [] };
    },
    getObligation: async (id: string): Promise<ObligationRow | null> => {
      if (ready.has(id)) {
        return {
          obligation_id: id,
          recipient: AGENT2,
          amount: 100,
          state: "READY",
        };
      }
      return {
        obligation_id: id,
        recipient: AGENT2,
        amount: 100,
        state: "PAID",
      };
    },
    getPolicy: async () => ({ spent: 5500 }),
    getReceiptCount: async () => 32,
    getReceipt: async (index: number) => {
      if (index === 31) return { obligation_id: "demo-live-002" };
      return null;
    },
    settle: async (id: string, recipient: string, amount: string) => {
      settleCalls.push({ id, recipient, amount });
      if (opts.settleHangs) return new Promise<string>(() => undefined);
      if (opts.settleError) throw opts.settleError;
      return opts.settleTx ?? "FAKESETTLETXHASH";
    },
  };
  return { chain, settleCalls };
}

function freshKey(): { secret: string; publicKey: string } {
  const pair = KeyPair.fromRandom("ed25519");
  return {
    secret: pair.toString(),
    publicKey: pair.getPublicKey().toString(),
  };
}

describe("verifyKeyScope", () => {
  test("a settle-only key on the test vault with a finite allowance passes", () => {
    const key = freshKey();
    const check = verifyKeyScope(keyListFor(key.publicKey), key.publicKey, VAULT_TEST);
    expect(check.ok).toBe(true);
  });

  test("a key list with no keys array fails", () => {
    expect(verifyKeyScope({}, "ed25519:abc", VAULT_TEST).ok).toBe(false);
    expect(verifyKeyScope(null, "ed25519:abc", VAULT_TEST).ok).toBe(false);
  });

  test("a public key that is not on the account fails", () => {
    const key = freshKey();
    const other = freshKey();
    expect(
      verifyKeyScope(keyListFor(key.publicKey), other.publicKey, VAULT_TEST).ok,
    ).toBe(false);
  });

  test("a full-access key fails", () => {
    const key = freshKey();
    const list = {
      keys: [
        {
          public_key: key.publicKey,
          access_key: { permission: "FullAccess" },
        },
      ],
    };
    expect(verifyKeyScope(list, key.publicKey, VAULT_TEST).ok).toBe(false);
  });

  test("a wrong receiver fails", () => {
    const key = freshKey();
    const list = {
      keys: [
        {
          public_key: key.publicKey,
          access_key: {
            permission: {
              FunctionCall: {
                allowance: "1000",
                receiver_id: "someone-else.testnet",
                method_names: ["settle"],
              },
            },
          },
        },
      ],
    };
    expect(verifyKeyScope(list, key.publicKey, VAULT_TEST).ok).toBe(false);
  });

  test("broader methods fail, even with settle included", () => {
    const key = freshKey();
    const list = {
      keys: [
        {
          public_key: key.publicKey,
          access_key: {
            permission: {
              FunctionCall: {
                allowance: "1000",
                receiver_id: VAULT_TEST,
                method_names: ["settle", "create_obligation"],
              },
            },
          },
        },
      ],
    };
    expect(verifyKeyScope(list, key.publicKey, VAULT_TEST).ok).toBe(false);
  });

  test("an unlimited allowance, a zero allowance, and a non-numeric allowance all fail", () => {
    const key = freshKey();
    for (const allowance of [null, "0", "not-a-number"]) {
      const list = {
        keys: [
          {
            public_key: key.publicKey,
            access_key: {
              permission: {
                FunctionCall: {
                  allowance,
                  receiver_id: VAULT_TEST,
                  method_names: ["settle"],
                },
              },
            },
          },
        ],
      };
      expect(verifyKeyScope(list, key.publicKey, VAULT_TEST).ok).toBe(false);
    }
  });
});

describe("checkRateLimit", () => {
  test("the first click is allowed and the second inside a minute is not", () => {
    const store = createRateLimitStore();
    expect(checkRateLimit(store, "203.0.113.7", 1000000).allowed).toBe(true);
    const second = checkRateLimit(store, "203.0.113.7", 1000030);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterSeconds).toBe(60);
  });

  test("a click a minute later is allowed again", () => {
    const store = createRateLimitStore();
    checkRateLimit(store, "203.0.113.7", 1000000);
    expect(checkRateLimit(store, "203.0.113.7", 1060001).allowed).toBe(true);
  });

  test("the sixth click inside an hour is refused even spread over minutes", () => {
    const store = createRateLimitStore();
    const ip = "203.0.113.7";
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(store, ip, 1000000 + i * 61000).allowed).toBe(true);
    }
    const sixth = checkRateLimit(store, ip, 1000000 + 5 * 61000);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("different IPs have separate limits", () => {
    const store = createRateLimitStore();
    checkRateLimit(store, "203.0.113.7", 1000000);
    expect(checkRateLimit(store, "198.51.100.9", 1000001).allowed).toBe(true);
  });
});

describe("getClientIp", () => {
  test("takes the first entry of x-forwarded-for", () => {
    expect(
      getClientIp({ headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } }),
    ).toBe("1.2.3.4");
  });

  test("accepts an array header and falls back to the socket, then unknown", () => {
    expect(
      getClientIp({ headers: { "x-forwarded-for": ["9.9.9.9"] } }),
    ).toBe("9.9.9.9");
    expect(
      getClientIp({
        headers: {},
        socket: { remoteAddress: "10.0.0.1" },
      }),
    ).toBe("10.0.0.1");
    expect(getClientIp({ headers: {} })).toBe("unknown");
  });
});

describe("handleDemoSettle", () => {
  test("a non-POST method is refused with 405", async () => {
    const { res, sent } = mockRes();
    const { chain } = stubChain();
    await handleDemoSettle(
      { method: "GET", headers: {} },
      res,
      { env: {}, createChain: () => chain },
    );
    expect(sent.status).toBe(405);
    expect(
      (sent.body as { code?: string }).code,
    ).toBe("METHOD_NOT_ALLOWED");
  });

  test("a missing demo key returns 503 with the fallback, and settles nothing", async () => {
    const { res, sent } = mockRes();
    const { chain, settleCalls } = stubChain();
    await handleDemoSettle(postReq("203.0.113.11"), res, {
      env: {},
      createChain: () => chain,
    });
    expect(sent.status).toBe(503);
    expect((sent.body as { code?: string }).code).toBe("DEMO_NOT_CONFIGURED");
    expect((sent.body as { fallback?: string }).fallback).toContain("sandbox");
    expect(settleCalls).toHaveLength(0);
  });

  test("an invalid demo key returns 500 and settles nothing", async () => {
    const { res, sent } = mockRes();
    const { chain, settleCalls } = stubChain();
    await handleDemoSettle(postReq("203.0.113.12"), res, {
      env: { CYNEX_DEMO_KEY: "not-a-key" },
      createChain: () => chain,
    });
    expect(sent.status).toBe(500);
    expect((sent.body as { code?: string }).code).toBe("DEMO_KEY_INVALID");
    expect(settleCalls).toHaveLength(0);
  });

  test("a key that fails the scope check returns 500 and settles nothing", async () => {
    const { res, sent } = mockRes();
    const key = freshKey();
    const { chain, settleCalls } = stubChain({ keyList: { keys: [] } });
    await handleDemoSettle(postReq("203.0.113.13"), res, {
      env: { CYNEX_DEMO_KEY: key.secret },
      createChain: () => chain,
    });
    expect(sent.status).toBe(500);
    expect((sent.body as { code?: string }).code).toBe("SCOPE_CHECK_FAILED");
    expect(settleCalls).toHaveLength(0);
  });

  test("an unreadable key list returns 502 and settles nothing", async () => {
    const { res, sent } = mockRes();
    const key = freshKey();
    const { chain, settleCalls } = stubChain({
      keyListError: new Error("rpc down"),
    });
    await handleDemoSettle(postReq("203.0.113.14"), res, {
      env: { CYNEX_DEMO_KEY: key.secret },
      createChain: () => chain,
    });
    expect(sent.status).toBe(502);
    expect((sent.body as { code?: string }).code).toBe("CHAIN_UNREADABLE");
    expect(settleCalls).toHaveLength(0);
  });

  test("no READY demo obligation returns the used-up answer with the fallback", async () => {
    const { res, sent } = mockRes();
    const key = freshKey();
    const { chain, settleCalls } = stubChain({
      readyIds: [],
      keyList: keyListFor(key.publicKey),
    });
    await handleDemoSettle(postReq("203.0.113.15"), res, {
      env: { CYNEX_DEMO_KEY: key.secret },
      createChain: () => chain,
    });
    expect(sent.status).toBe(200);
    const body = sent.body as {
      success: boolean;
      code?: string;
      fallback?: string;
    };
    expect(body.success).toBe(false);
    expect(body.code).toBe("DEMO_USED_UP");
    expect(body.fallback).toContain("sandbox");
    expect(settleCalls).toHaveLength(0);
  });

  test("a success settles the first READY obligation with the chain terms, ignoring client parameters", async () => {
    const { res, sent } = mockRes();
    const key = freshKey();
    const { chain, settleCalls } = stubChain({
      readyIds: [
        "demo-live-002",
        "demo-live-003",
        "demo-live-004",
        "demo-live-005",
        "demo-live-006",
        "demo-live-007",
        "demo-live-008",
        "demo-live-009",
        "demo-live-010",
      ],
      keyList: keyListFor(key.publicKey),
    });
    // A hostile body smuggling a different obligation, recipient, and
    // amount. The handler never reads the body, so none of it lands
    // in the settle call.
    const req = postReq("203.0.113.16") as DemoRequest & {
      body: Record<string, unknown>;
      query: Record<string, unknown>;
    };
    req.body = {
      obligation_id: "demo-live-999",
      proposed_recipient: "evil.testnet",
      proposed_amount: "999999",
    };
    req.query = { obligation_id: "demo-live-999", amount: "999999" };
    await handleDemoSettle(req, res, {
      env: { CYNEX_DEMO_KEY: key.secret },
      createChain: () => chain,
    });
    expect(settleCalls).toHaveLength(1);
    expect(settleCalls[0]).toEqual({
      id: "demo-live-002",
      recipient: AGENT2,
      amount: "100",
    });
    expect(sent.status).toBe(200);
    const body = sent.body as {
      success: boolean;
      obligationId: string;
      receiptIndex: number;
      txHash: string;
      recipient: string;
      amount: string;
      policySpent: string;
      remaining: number;
    };
    expect(body.success).toBe(true);
    expect(body.obligationId).toBe("demo-live-002");
    expect(body.receiptIndex).toBe(31);
    expect(body.txHash).toBe("FAKESETTLETXHASH");
    expect(body.recipient).toBe(AGENT2);
    expect(body.amount).toBe("100");
    expect(body.policySpent).toBe("5500");
    expect(body.remaining).toBe(8);
  });

  test("a second click inside a minute is rate limited with 429 and a retry-after", async () => {
    const { res, sent } = mockRes();
    const key = freshKey();
    const { chain } = stubChain({ keyList: keyListFor(key.publicKey) });
    const store = createRateLimitStore();
    checkRateLimit(store, "203.0.113.7", Date.now());
    await handleDemoSettle(postReq(), res, {
      env: { CYNEX_DEMO_KEY: key.secret },
      createChain: () => chain,
      rateLimitStore: store,
    });
    expect(sent.status).toBe(429);
    expect((sent.body as { code?: string }).code).toBe("RATE_LIMITED");
    expect(sent.headers["Retry-After"]).toBeDefined();
  });

  test("a settle that throws a contract refusal returns SETTLE_FAILED with the obligation id", async () => {
    const { res, sent } = mockRes();
    const key = freshKey();
    const { chain, settleCalls } = stubChain({
      keyList: keyListFor(key.publicKey),
      settleError: new Error("ERR_TERMS_MISMATCH: proposed amount differs"),
    });
    await handleDemoSettle(postReq("203.0.113.17"), res, {
      env: { CYNEX_DEMO_KEY: key.secret },
      createChain: () => chain,
    });
    expect(settleCalls).toHaveLength(1);
    expect(sent.status).toBe(200);
    const body = sent.body as {
      success: boolean;
      code?: string;
      error?: string;
      obligationId: string;
    };
    expect(body.success).toBe(false);
    expect(body.code).toBe("SETTLE_FAILED");
    expect(body.error).toContain("ERR_TERMS_MISMATCH");
    expect(body.obligationId).toBe("demo-live-002");
  });

  test("a settle whose confirmation hangs returns the timeout answer and never retries", async () => {
    const { res, sent } = mockRes();
    const key = freshKey();
    const { chain, settleCalls } = stubChain({
      keyList: keyListFor(key.publicKey),
      settleHangs: true,
    });
    await handleDemoSettle(postReq("203.0.113.18"), res, {
      env: { CYNEX_DEMO_KEY: key.secret },
      createChain: () => chain,
      settleTimeoutMs: 20,
    });
    expect(settleCalls).toHaveLength(1);
    const body = sent.body as {
      success: boolean;
      code?: string;
      error?: string;
      obligationId: string;
    };
    expect(body.success).toBe(false);
    expect(body.code).toBe("SETTLE_TIMEOUT");
    expect(body.obligationId).toBe("demo-live-002");
    expect(body.error).toContain("timed out");
  });
});
