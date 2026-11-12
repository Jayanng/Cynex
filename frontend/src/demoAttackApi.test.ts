/* Tests for the /api/demo-attack handler: validation, rate limit, key
 * scope, and the live refusal contract. The handler is exercised with
 * a mocked chain so no testnet call is made. The contract under test:
 * a tampered settle the vault refuses returns the vault ERR_ code
 * with the REAL tx hash from the failed settle; a transport error
 * with no whitelisted code is SETTLE_UNCONFIRMED, never a refusal;
 * a timeout is SETTLE_TIMEOUT; a successful settle is only reported
 * once the obligation reads PAID and its receipt is found. */

import { KeyPair } from "near-api-js";
import {
  ATTACK_KINDS,
  DEMO_NOEVIDENCE_ID,
  USECASE_REPLAY_ID,
  checkAttackRateLimit,
  handleDemoAttack,
  isValidAttackAmount,
  isValidNearAccountId,
  parseAttackBody,
  peekAttackRateLimit,
  recordAttackRateLimit,
  txHashFromSettleError,
} from "../../web/api/demo-attack.js";
import type {
  DemoAttackHandlerDeps,
  DemoAttackRequest,
} from "../../web/api/demo-attack.js";
import { createRateLimitStore } from "../../web/api/demo-settle.js";
import type {
  DemoChain,
  DemoResponse,
  ObligationRow,
} from "../../web/api/demo-settle.js";

const VAULT_TEST = "cynex-testvault.cynexmaster.testnet";
const AGENT = "cynex-agent.cynexmaster.testnet";
const AGENT2 = "cynex-agent2.cynexmaster.testnet";
const TARGET = "demo-live-007";
const OTHER_READY = "demo-live-008";
const NOEVIDENCE = DEMO_NOEVIDENCE_ID;
const USECASE = USECASE_REPLAY_ID;
const ATTACKER = "someone-else.testnet";
const U128_MAX = "340282366920938463463374607431768211455";

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

function mockReq(ip: string, body: unknown, method = "POST"): DemoAttackRequest {
  return { method, headers: {}, socket: { remoteAddress: ip }, body };
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    obligation_id: TARGET,
    proposed_recipient: "cynexmaster.testnet",
    proposed_amount: "100",
    ...overrides,
  };
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
              allowance: "1000000000000000000000000",
            },
          },
        },
      },
    ],
  };
}

interface ChainOpts {
  targetExists?: boolean;
  otherReady?: boolean;
}

type TestChain = DemoChain & {
  settled: () => boolean;
  settleArgs: () => Array<{ obligationId: string; recipient: string; amount: string }>;
};

function makeChain(overrides: Partial<DemoChain> = {}, opts: ChainOpts = {}): TestChain {
  const targetExists = opts.targetExists ?? true;
  const otherReady = opts.otherReady ?? true;
  let settled = false;
  const args: Array<{ obligationId: string; recipient: string; amount: string }> = [];
  const base: DemoChain = {
    viewAccessKeyList: async () => ({}),
    getObligation: async (id: string) => {
      if (id === TARGET) {
        if (!targetExists) return null;
        const row: ObligationRow = {
          obligation_id: TARGET,
          recipient: AGENT,
          amount: "100",
          state: settled ? "PAID" : "READY",
        };
        return row;
      }
      if (id === OTHER_READY && otherReady) {
        return { obligation_id: OTHER_READY, recipient: AGENT, amount: "100", state: "READY" };
      }
      if (id === NOEVIDENCE) {
        return { obligation_id: NOEVIDENCE, recipient: AGENT2, amount: "100", state: "CREATED" };
      }
      if (id === USECASE) {
        return { obligation_id: USECASE, recipient: AGENT, amount: "100", state: "PAID" };
      }
      return null;
    },
    getPolicy: async () => ({ spent: 5900 }),
    getReceiptCount: async () => 36,
    getReceipt: async (index: number) => {
      if (index === 35) return { obligation_id: TARGET };
      return { obligation_id: "demo-live-001" };
    },
    settle: async (obligationId: string, recipient: string, amount: string) => {
      args.push({ obligationId, recipient, amount });
      settled = true;
      return "attacktx123";
    },
  };
  return { ...base, ...overrides, settled: () => settled, settleArgs: () => args };
}

function makeDeps(chain: DemoChain, secretKey: string): DemoAttackHandlerDeps {
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

async function runAttack(
  chain: DemoChain,
  secretKey: string,
  ip: string,
  body: unknown,
  depsOverride: Partial<DemoAttackHandlerDeps> = {},
): Promise<{ body: () => unknown; status: () => number; headers: () => Record<string, string> }> {
  const { res, body: getBody, status, headers } = mockRes();
  await handleDemoAttack(mockReq(ip, body), res, { ...makeDeps(chain, secretKey), ...depsOverride });
  return { body: getBody, status, headers };
}

describe("isValidNearAccountId", () => {
  it("accepts plain and dotted testnet ids", () => {
    expect(isValidNearAccountId("cynexmaster.testnet")).toBe(true);
    expect(isValidNearAccountId("cynex-agent.cynexmaster.testnet")).toBe(true);
    expect(isValidNearAccountId("ab")).toBe(true);
    expect(isValidNearAccountId("a-b_c.d9")).toBe(true);
  });

  it("rejects ids that are too short, too long, or badly formed", () => {
    expect(isValidNearAccountId("")).toBe(false);
    expect(isValidNearAccountId("a")).toBe(false);
    expect(isValidNearAccountId("x".repeat(65))).toBe(false);
    expect(isValidNearAccountId("UPPER.testnet")).toBe(false);
    expect(isValidNearAccountId(".bad.testnet")).toBe(false);
    expect(isValidNearAccountId("bad.testnet.")).toBe(false);
    expect(isValidNearAccountId("-bad.testnet")).toBe(false);
    expect(isValidNearAccountId("bad.testnet-")).toBe(false);
    expect(isValidNearAccountId("bad..testnet")).toBe(false);
    expect(isValidNearAccountId("bad--testnet")).toBe(false);
    expect(isValidNearAccountId("bad testnet")).toBe(false);
    expect(isValidNearAccountId("bad/testnet")).toBe(false);
  });

  it("accepts a 64 character id", () => {
    expect(isValidNearAccountId("x".repeat(64))).toBe(true);
  });
});

describe("isValidAttackAmount", () => {
  it("accepts positive integers, zero, and the u128 maximum, including leading zeroes", () => {
    expect(isValidAttackAmount("100")).toBe(true);
    expect(isValidAttackAmount("0100")).toBe(true);
    expect(isValidAttackAmount("1")).toBe(true);
    expect(isValidAttackAmount("0")).toBe(true);
    expect(isValidAttackAmount("000")).toBe(true);
    expect(isValidAttackAmount("340282366920938463463374607431768211455")).toBe(true);
  });

  it("rejects negatives, decimals, non-digits, and values above u128", () => {
    expect(isValidAttackAmount("-5")).toBe(false);
    expect(isValidAttackAmount("1.5")).toBe(false);
    expect(isValidAttackAmount("abc")).toBe(false);
    expect(isValidAttackAmount("")).toBe(false);
    expect(isValidAttackAmount("100 ")).toBe(false);
    expect(isValidAttackAmount("340282366920938463463374607431768211456")).toBe(false);
  });
});

describe("parseAttackBody", () => {
  it("accepts a well-formed body and echoes the terms", () => {
    const out = parseAttackBody(validBody());
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.terms).toEqual({
        obligationId: TARGET,
        recipient: "cynexmaster.testnet",
        amount: "100",
      });
    }
  });

  it("rejects a non-object body as INVALID_REQUEST", () => {
    for (const bad of [null, "x", 42, ["demo-live-007"], undefined]) {
      const out = parseAttackBody(bad);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.code).toBe("INVALID_REQUEST");
    }
  });

  it("rejects an unknown or missing obligation id as INVALID_OBLIGATION", () => {
    for (const id of [undefined, 7, "demo-live-011", "demo-live-000", "usecase-report-002", ""]) {
      const out = parseAttackBody(validBody({ obligation_id: id }));
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.code).toBe("INVALID_OBLIGATION");
    }
    const missing = parseAttackBody({ proposed_recipient: "cynexmaster.testnet", proposed_amount: "100" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("INVALID_OBLIGATION");
  });

  it("rejects a malformed recipient as INVALID_RECIPIENT", () => {
    for (const recipient of [undefined, 7, "", "a", "UPPER.testnet", ".bad.testnet", "bad..testnet"]) {
      const out = parseAttackBody(validBody({ proposed_recipient: recipient }));
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.code).toBe("INVALID_RECIPIENT");
    }
  });

  it("rejects a bad amount as INVALID_AMOUNT, including a non-string amount", () => {
    for (const amount of [undefined, 100, "-5", "1.5", "abc", ""]) {
      const out = parseAttackBody(validBody({ proposed_amount: amount }));
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.code).toBe("INVALID_AMOUNT");
    }
  });

  it("checks the obligation first, then the recipient, then the amount", () => {
    const badObligation = parseAttackBody(validBody({ obligation_id: "nope", proposed_recipient: "bad..id" }));
    expect(badObligation.ok).toBe(false);
    if (!badObligation.ok) expect(badObligation.code).toBe("INVALID_OBLIGATION");
    const badRecipient = parseAttackBody(validBody({ proposed_recipient: "bad..id", proposed_amount: "abc" }));
    expect(badRecipient.ok).toBe(false);
    if (!badRecipient.ok) expect(badRecipient.code).toBe("INVALID_RECIPIENT");
  });
});

describe("txHashFromSettleError", () => {
  it("takes the hash from .txHash", () => {
    const err = new Error("ERR_RECIPIENT_SUBSTITUTION") as Error & { txHash: string };
    err.txHash = "refusaltx123";
    expect(txHashFromSettleError(err)).toBe("refusaltx123");
  });

  it("falls back to .transactionResult.transaction_outcome.id", () => {
    const err = new Error("ERR_TERMS_MISMATCH") as Error & {
      transactionResult: { transaction_outcome: { id: string } };
    };
    err.transactionResult = { transaction_outcome: { id: "resulttx456" } };
    expect(txHashFromSettleError(err)).toBe("resulttx456");
  });

  it("falls back to .transactionResult.transaction.hash", () => {
    const err = new Error("ERR_TERMS_MISMATCH") as Error & {
      transactionResult: { transaction: { hash: string } };
    };
    err.transactionResult = { transaction: { hash: "viatx789" } };
    expect(txHashFromSettleError(err)).toBe("viatx789");
  });

  it("ignores a placeholder txHash of unknown and uses the outcome instead", () => {
    const err = new Error("ERR_TERMS_MISMATCH") as Error & {
      txHash: string;
      transactionResult: { transaction_outcome: { id: string } };
    };
    err.txHash = "unknown";
    err.transactionResult = { transaction_outcome: { id: "fallbacktx" } };
    expect(txHashFromSettleError(err)).toBe("fallbacktx");
  });

  it("returns null when the error carries no usable hash", () => {
    expect(txHashFromSettleError(new Error("boom"))).toBeNull();
    expect(txHashFromSettleError({})).toBeNull();
    expect(txHashFromSettleError({ txHash: "unknown" })).toBeNull();
    expect(txHashFromSettleError({ txHash: "" })).toBeNull();
    expect(txHashFromSettleError({ transactionResult: {} })).toBeNull();
    expect(txHashFromSettleError(null)).toBeNull();
    expect(txHashFromSettleError(undefined)).toBeNull();
    expect(txHashFromSettleError("ERR_RECIPIENT_SUBSTITUTION")).toBeNull();
  });
});

describe("checkAttackRateLimit", () => {
  it("allows the first attempt, blocks the second within 10 seconds, allows after the window", () => {
    const store = createRateLimitStore();
    expect(checkAttackRateLimit(store, "1.2.3.4", 1000).allowed).toBe(true);
    const blocked = checkAttackRateLimit(store, "1.2.3.4", 2000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(9);
    expect(checkAttackRateLimit(store, "1.2.3.4", 12000).allowed).toBe(true);
  });

  it("limits per IP, not globally", () => {
    const store = createRateLimitStore();
    expect(checkAttackRateLimit(store, "1.2.3.4", 1000).allowed).toBe(true);
    expect(checkAttackRateLimit(store, "5.6.7.8", 1000).allowed).toBe(true);
  });

  it("blocks the 31st attempt within an hour and allows again after the hour", () => {
    const store = createRateLimitStore();
    for (let i = 0; i < 30; i++) {
      expect(checkAttackRateLimit(store, "1.2.3.4", 1000 + i * 11000).allowed).toBe(true);
    }
    const blocked = checkAttackRateLimit(store, "1.2.3.4", 1000 + 30 * 11000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(checkAttackRateLimit(store, "1.2.3.4", 1000 + 3600000).allowed).toBe(true);
  });
});

describe("handleDemoAttack", () => {
  it("answers 405 for a non-POST method and never settles", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({ viewAccessKeyList: async () => scopedKeyList(publicKey) });
    const { res, body, status } = mockRes();
    await handleDemoAttack(mockReq("9.9.9.1", validBody(), "GET"), res, makeDeps(chain, secret));
    expect(status()).toBe(405);
    expect((body() as Record<string, unknown>).code).toBe("METHOD_NOT_ALLOWED");
    expect(chain.settled()).toBe(false);
  });

  it("answers DEMO_NOT_CONFIGURED when the demo key is missing or blank, before body validation", async () => {
    const chain = makeChain();
    const missing = await runAttack(chain, "", "9.9.9.2", validBody(), { env: {} });
    expect((missing.body() as Record<string, unknown>).code).toBe("DEMO_NOT_CONFIGURED");
    expect(missing.status()).toBe(503);
    expect((missing.body() as Record<string, unknown>).fallback).toBeDefined();
    const blank = await runAttack(chain, "   ", "9.9.9.2", { nonsense: true }, { env: { CYNEX_DEMO_KEY: "   " } });
    expect((blank.body() as Record<string, unknown>).code).toBe("DEMO_NOT_CONFIGURED");
  });

  it("answers DEMO_KEY_INVALID for a key that is not a key pair", async () => {
    const chain = makeChain();
    const out = await runAttack(chain, "not-a-key", "9.9.9.3", validBody());
    expect(out.status()).toBe(500);
    expect((out.body() as Record<string, unknown>).code).toBe("DEMO_KEY_INVALID");
    expect(chain.settled()).toBe(false);
  });

  it("answers 400 INVALID_OBLIGATION, INVALID_RECIPIENT, INVALID_AMOUNT, and INVALID_REQUEST", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({ viewAccessKeyList: async () => scopedKeyList(publicKey) });
    const cases: Array<[unknown, string]> = [
      [validBody({ obligation_id: "demo-live-011" }), "INVALID_OBLIGATION"],
      [validBody({ proposed_recipient: "bad..id" }), "INVALID_RECIPIENT"],
      [null, "INVALID_REQUEST"],
      ["nope", "INVALID_REQUEST"],
    ];
    for (let i = 0; i < cases.length; i++) {
      const out = await runAttack(chain, secret, `9.9.9.1${i}`, cases[i][0]);
      expect(out.status()).toBe(400);
      expect((out.body() as Record<string, unknown>).code).toBe(cases[i][1]);
      expect((out.body() as Record<string, unknown>).success).toBe(false);
    }
    expect(chain.settled()).toBe(false);
  });

  it("does not spend a rate-limit attempt on a malformed request", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({ viewAccessKeyList: async () => scopedKeyList(publicKey) });
    const deps = makeDeps(chain, secret);
    const bad = mockRes();
    await handleDemoAttack(mockReq("9.9.9.20", validBody({ proposed_amount: "abc" })), bad.res, deps);
    expect(bad.status()).toBe(400);
    const good = mockRes();
    await handleDemoAttack(mockReq("9.9.9.20", validBody()), good.res, deps);
    expect((good.body() as Record<string, unknown>).success).toBe(true);
  });

  it("answers 429 with a Retry-After header on the second rapid attempt from the same IP", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({ viewAccessKeyList: async () => scopedKeyList(publicKey) });
    const deps = makeDeps(chain, secret);
    const first = mockRes();
    await handleDemoAttack(mockReq("9.9.9.21", validBody()), first.res, deps);
    expect((first.body() as Record<string, unknown>).success).toBe(true);
    const second = mockRes();
    await handleDemoAttack(mockReq("9.9.9.21", validBody()), second.res, deps);
    expect(second.status()).toBe(429);
    expect(second.headers()["Retry-After"]).toBeDefined();
    expect((second.body() as Record<string, unknown>).code).toBe("RATE_LIMITED");
    expect(chain.settleArgs()).toHaveLength(1);
    const otherIp = mockRes();
    await handleDemoAttack(mockReq("9.9.9.22", validBody()), otherIp.res, deps);
    expect(otherIp.status()).not.toBe(429);
  });

  it("answers SCOPE_CHECK_FAILED when the key is not scoped to the test vault", async () => {
    const { secret } = makeKey();
    const other = makeKey().publicKey;
    const chain = makeChain({ viewAccessKeyList: async () => scopedKeyList(other) });
    const out = await runAttack(chain, secret, "9.9.9.23", validBody());
    expect(out.status()).toBe(500);
    expect((out.body() as Record<string, unknown>).code).toBe("SCOPE_CHECK_FAILED");
    expect(chain.settled()).toBe(false);
  });

  it("answers CHAIN_UNREADABLE when the key list cannot be read in time", async () => {
    const { secret } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => new Promise<unknown>(() => {}),
    });
    const out = await runAttack(chain, secret, "9.9.9.24", validBody(), { scopeTimeoutMs: 50 });
    expect(out.status()).toBe(502);
    expect((out.body() as Record<string, unknown>).code).toBe("CHAIN_UNREADABLE");
    expect(chain.settled()).toBe(false);
  });

  it("refuses a tampered recipient with ERR_RECIPIENT_SUBSTITUTION and the real tx hash from .transactionResult", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async () => {
        // near-api-js 7.4.0 throws a ContractExecutionError on a
        // contract panic: no .txHash, only .transactionResult.
        const err = new Error("Smart contract panicked: ERR_RECIPIENT_SUBSTITUTION") as Error & {
          transactionResult: { transaction_outcome: { id: string } };
        };
        err.transactionResult = { transaction_outcome: { id: "refusaltx123" } };
        throw err;
      },
    });
    const out = await runAttack(
      chain,
      secret,
      "9.9.9.25",
      validBody({ proposed_recipient: ATTACKER, proposed_amount: "200" }),
    );
    const b = out.body() as Record<string, unknown>;
    expect(out.status()).toBe(200);
    expect(b.success).toBe(false);
    expect(b.code).toBe("ERR_RECIPIENT_SUBSTITUTION");
    expect(b.txHash).toBe("refusaltx123");
    expect(b.obligationId).toBe(TARGET);
    expect(b.recipient).toBe(ATTACKER);
    expect(b.amount).toBe("200");
    expect(b.fallback).toBeDefined();
  });

  it("takes the refusal tx hash from .transactionResult when .txHash is absent", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async () => {
        const err = new Error("ERR_TERMS_MISMATCH") as Error & {
          transactionResult: { transaction_outcome: { id: string } };
        };
        err.transactionResult = { transaction_outcome: { id: "resulttx456" } };
        throw err;
      },
    });
    const out = await runAttack(chain, secret, "9.9.9.26", validBody({ proposed_amount: "200" }));
    const b = out.body() as Record<string, unknown>;
    expect(b.code).toBe("ERR_TERMS_MISMATCH");
    expect(b.txHash).toBe("resulttx456");
    expect(b.obligationId).toBe(TARGET);
  });

  it("reports a replay refusal with ERR_NONCE_ALREADY_CONSUMED and a null hash when the error carries none", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async () => {
        throw new Error("ERR_NONCE_ALREADY_CONSUMED");
      },
    });
    const out = await runAttack(chain, secret, "9.9.9.27", validBody());
    const b = out.body() as Record<string, unknown>;
    expect(b.code).toBe("ERR_NONCE_ALREADY_CONSUMED");
    expect(b.txHash).toBeNull();
    expect(b.success).toBe(false);
  });

  it("answers SETTLE_UNCONFIRMED for a transport error with no whitelisted code", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    });
    const out = await runAttack(chain, secret, "9.9.9.28", validBody());
    const b = out.body() as Record<string, unknown>;
    expect(b.code).toBe("SETTLE_UNCONFIRMED");
    expect(b.txHash).toBeNull();
  });

  it("answers SETTLE_UNCONFIRMED, not a refusal, for a non-whitelisted ERR_ substring", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async () => {
        throw new Error("socket hang up: ERR_SOCKET_CLOSED");
      },
    });
    const out = await runAttack(chain, secret, "9.9.9.29", validBody());
    expect((out.body() as Record<string, unknown>).code).toBe("SETTLE_UNCONFIRMED");
  });

  it("keeps the tx hash on SETTLE_UNCONFIRMED when the failed error carried one", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async () => {
        const err = new Error("socket hang up") as Error & { txHash: string };
        err.txHash = "maybelanded999";
        throw err;
      },
    });
    const out = await runAttack(chain, secret, "9.9.9.30", validBody());
    const b = out.body() as Record<string, unknown>;
    expect(b.code).toBe("SETTLE_UNCONFIRMED");
    expect(b.txHash).toBe("maybelanded999");
  });

  it("answers SETTLE_TIMEOUT when the settle call times out", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async () => {
        throw new Error("settle confirmation timed out");
      },
    });
    const out = await runAttack(chain, secret, "9.9.9.31", validBody());
    const b = out.body() as Record<string, unknown>;
    expect(b.code).toBe("SETTLE_TIMEOUT");
    expect(b.success).toBe(false);
    expect(b.obligationId).toBe(TARGET);
  });

  it("settles with the exact terms the judge entered and returns success with the receipt index and tx hash", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({ viewAccessKeyList: async () => scopedKeyList(publicKey) });
    const out = await runAttack(chain, secret, "9.9.9.32", validBody());
    const b = out.body() as Record<string, unknown>;
    expect(b.success).toBe(true);
    expect(b.obligationId).toBe(TARGET);
    expect(b.receiptIndex).toBe(35);
    expect(b.txHash).toBe("attacktx123");
    expect(b.recipient).toBe("cynexmaster.testnet");
    expect(b.amount).toBe("100");
    expect(b.policySpent).toBe("5900");
    expect(b.remaining).toBe(1);
    expect(chain.settled()).toBe(true);
    expect(chain.settleArgs()).toEqual([
      { obligationId: TARGET, recipient: "cynexmaster.testnet", amount: "100" },
    ]);
  });

  it("answers SETTLE_UNCONFIRMED, not success, when the receipt cannot be read after a confirmed PAID", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      getReceipt: async () => {
        throw new Error("rpc down");
      },
    });
    const out = await runAttack(chain, secret, "9.9.9.33", validBody());
    const b = out.body() as Record<string, unknown>;
    expect(b.success).toBe(false);
    expect(b.code).toBe("SETTLE_UNCONFIRMED");
    expect(b.txHash).toBe("attacktx123");
    expect(chain.settled()).toBe(true);
  });

  it("answers SETTLE_UNCONFIRMED when the settle resolves but the obligation never reads PAID", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async () => "attacktx123",
    });
    const out = await runAttack(chain, secret, "9.9.9.34", validBody(), { confirmTimeoutMs: 200 });
    const b = out.body() as Record<string, unknown>;
    expect(b.success).toBe(false);
    expect(b.code).toBe("SETTLE_UNCONFIRMED");
    expect(b.txHash).toBe("attacktx123");
  });

  it("answers DEMO_USED_UP when no demo-live obligation is READY", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain(
      { viewAccessKeyList: async () => scopedKeyList(publicKey) },
      { targetExists: false, otherReady: false },
    );
    const out = await runAttack(chain, secret, "9.9.9.35", validBody());
    const b = out.body() as Record<string, unknown>;
    expect(out.status()).toBe(200);
    expect(b.success).toBe(false);
    expect(b.code).toBe("DEMO_USED_UP");
    expect(b.fallback).toBeDefined();
    expect(chain.settled()).toBe(false);
  });

  it("answers OBLIGATION_MISSING when the target is gone but other demo obligations are READY", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain(
      { viewAccessKeyList: async () => scopedKeyList(publicKey) },
      { targetExists: false, otherReady: true },
    );
    const out = await runAttack(chain, secret, "9.9.9.36", validBody());
    const b = out.body() as Record<string, unknown>;
    expect(b.success).toBe(false);
    expect(b.code).toBe("OBLIGATION_MISSING");
    expect(b.obligationId).toBe(TARGET);
    expect(chain.settled()).toBe(false);
  });
});

describe("parseAttackBody, attack kinds and unknown fields", () => {
  it("defaults attack_kind to change_recipient", () => {
    const out = parseAttackBody(validBody());
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.attackKind).toBe("change_recipient");
  });

  it("accepts each of the six attack kinds with a fitting obligation", () => {
    const cases: Array<Record<string, unknown>> = [
      { attack_kind: "change_recipient" },
      { attack_kind: "change_amount" },
      { attack_kind: "prompt_injection" },
      { attack_kind: "freeform" },
      { attack_kind: "replay", obligation_id: USECASE },
      { attack_kind: "settle_before_evidence", obligation_id: NOEVIDENCE },
    ];
    for (const c of cases) {
      const out = parseAttackBody(validBody(c));
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.attackKind).toBe(c.attack_kind);
    }
    expect(ATTACK_KINDS).toHaveLength(6);
  });

  it("rejects an unknown attack_kind as INVALID_ATTACK_KIND", () => {
    const out = parseAttackBody(validBody({ attack_kind: "explode" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("INVALID_ATTACK_KIND");
  });

  it("rejects unknown extra fields as INVALID_REQUEST", () => {
    for (const body of [validBody({ surprise: true }), validBody({ note: "x" }), validBody({ attack_kind: "replay", obligation_id: USECASE, extra: 1 })]) {
      const out = parseAttackBody(body);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.code).toBe("INVALID_REQUEST");
    }
  });

  it("replay accepts a paid obligation without client terms and ignores client terms", () => {
    const bare = parseAttackBody({ obligation_id: USECASE, attack_kind: "replay" });
    expect(bare.ok).toBe(true);
    if (bare.ok) {
      expect(bare.attackKind).toBe("replay");
      expect(bare.terms.obligationId).toBe(USECASE);
    }
    const withTerms = parseAttackBody(
      validBody({ obligation_id: USECASE, attack_kind: "replay", proposed_recipient: ATTACKER, proposed_amount: "999" }),
    );
    expect(withTerms.ok).toBe(true);
  });

  it("replay rejects the no-evidence obligation and settle-before-evidence accepts only it", () => {
    const replayNoEvidence = parseAttackBody(validBody({ obligation_id: NOEVIDENCE, attack_kind: "replay" }));
    expect(replayNoEvidence.ok).toBe(false);
    if (!replayNoEvidence.ok) expect(replayNoEvidence.code).toBe("INVALID_OBLIGATION");
    const sbeTarget = parseAttackBody(validBody({ obligation_id: TARGET, attack_kind: "settle_before_evidence" }));
    expect(sbeTarget.ok).toBe(false);
    if (!sbeTarget.ok) expect(sbeTarget.code).toBe("INVALID_OBLIGATION");
    const sbeOk = parseAttackBody({ obligation_id: NOEVIDENCE, attack_kind: "settle_before_evidence" });
    expect(sbeOk.ok).toBe(true);
  });

  it("change kinds reject the use-case and no-evidence obligations", () => {
    for (const id of [USECASE, NOEVIDENCE]) {
      const out = parseAttackBody(validBody({ obligation_id: id }));
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.code).toBe("INVALID_OBLIGATION");
    }
  });
});

describe("peekAttackRateLimit and recordAttackRateLimit", () => {
  it("a peek does not record a hit, a record does", () => {
    const store = createRateLimitStore();
    expect(peekAttackRateLimit(store, "1.2.3.4", 1000).allowed).toBe(true);
    expect(peekAttackRateLimit(store, "1.2.3.4", 2000).allowed).toBe(true);
    recordAttackRateLimit(store, "1.2.3.4", 2000);
    expect(peekAttackRateLimit(store, "1.2.3.4", 3000).allowed).toBe(false);
    expect(peekAttackRateLimit(store, "1.2.3.4", 13000).allowed).toBe(true);
  });

  it("records per IP only", () => {
    const store = createRateLimitStore();
    recordAttackRateLimit(store, "1.2.3.4", 1000);
    expect(peekAttackRateLimit(store, "5.6.7.8", 1000).allowed).toBe(true);
  });
});

describe("handleDemoAttack, replay and settle-before-evidence", () => {
  function refusalError(code: string, tx: string): Error & { transactionResult: { transaction_outcome: { id: string } } } {
    const err = new Error("Smart contract panicked: " + code) as Error & {
      transactionResult: { transaction_outcome: { id: string } };
    };
    err.transactionResult = { transaction_outcome: { id: tx } };
    return err;
  }

  it("replay submits the locked terms from the chain and returns the vault nonce refusal", async () => {
    const { secret, publicKey } = makeKey();
    const seen: Array<{ obligationId: string; recipient: string; amount: string }> = [];
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async (obligationId: string, recipient: string, amount: string) => {
        seen.push({ obligationId, recipient, amount });
        throw refusalError("ERR_NONCE_ALREADY_CONSUMED", "replaytx111");
      },
    });
    const out = await runAttack(
      chain,
      secret,
      "9.9.9.40",
      validBody({ obligation_id: USECASE, attack_kind: "replay", proposed_recipient: ATTACKER, proposed_amount: "999" }),
    );
    const b = out.body() as Record<string, unknown>;
    expect(b.code).toBe("ERR_NONCE_ALREADY_CONSUMED");
    expect(b.txHash).toBe("replaytx111");
    expect(seen).toEqual([{ obligationId: USECASE, recipient: AGENT, amount: "100" }]);
  });

  it("replay of a READY obligation is refused as NOT_REPLAYABLE before any settle", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({ viewAccessKeyList: async () => scopedKeyList(publicKey) });
    const out = await runAttack(chain, secret, "9.9.9.41", validBody({ obligation_id: TARGET, attack_kind: "replay" }));
    const b = out.body() as Record<string, unknown>;
    expect(out.status()).toBe(400);
    expect(b.code).toBe("NOT_REPLAYABLE");
    expect(chain.settled()).toBe(false);
  });

  it("settle-before-evidence submits the locked terms and returns ERR_INVALID_STATE", async () => {
    const { secret, publicKey } = makeKey();
    const seen: Array<{ obligationId: string; recipient: string; amount: string }> = [];
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async (obligationId: string, recipient: string, amount: string) => {
        seen.push({ obligationId, recipient, amount });
        throw refusalError("ERR_INVALID_STATE", "noevidencetx222");
      },
    });
    const out = await runAttack(
      chain,
      secret,
      "9.9.9.42",
      validBody({ obligation_id: NOEVIDENCE, attack_kind: "settle_before_evidence", proposed_recipient: ATTACKER, proposed_amount: "999" }),
    );
    const b = out.body() as Record<string, unknown>;
    expect(b.code).toBe("ERR_INVALID_STATE");
    expect(b.txHash).toBe("noevidencetx222");
    expect(seen).toEqual([{ obligationId: NOEVIDENCE, recipient: AGENT2, amount: "100" }]);
  });

  it("settle-before-evidence on an already READY obligation is refused as WRONG_STATE", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      getObligation: async (id: string) => {
        if (id === NOEVIDENCE) {
          return { obligation_id: NOEVIDENCE, recipient: AGENT2, amount: "100", state: "READY" };
        }
        return null;
      },
    });
    const out = await runAttack(chain, secret, "9.9.9.43", validBody({ obligation_id: NOEVIDENCE, attack_kind: "settle_before_evidence" }));
    const b = out.body() as Record<string, unknown>;
    expect(out.status()).toBe(400);
    expect(b.code).toBe("WRONG_STATE");
    expect(chain.settled()).toBe(false);
  });

  it("answers 502 CHAIN_UNREADABLE when the obligation read times out, never OBLIGATION_MISSING", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      getObligation: async () => new Promise<ObligationRow | null>(() => {}),
    });
    const out = await runAttack(chain, secret, "9.9.9.44", validBody(), { scanTimeoutMs: 50 });
    const b = out.body() as Record<string, unknown>;
    expect(out.status()).toBe(502);
    expect(b.code).toBe("CHAIN_UNREADABLE");
    expect(chain.settled()).toBe(false);
  });

  it("answers 502 CHAIN_UNREADABLE when the obligation read rejects", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      getObligation: async () => {
        throw new Error("rpc down");
      },
    });
    const out = await runAttack(chain, secret, "9.9.9.45", validBody());
    const b = out.body() as Record<string, unknown>;
    expect(out.status()).toBe(502);
    expect(b.code).toBe("CHAIN_UNREADABLE");
    expect(chain.settled()).toBe(false);
  });

  it("answers 400 for an unknown attack kind and for an unknown body field, without settling", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({ viewAccessKeyList: async () => scopedKeyList(publicKey) });
    const badKind = await runAttack(chain, secret, "9.9.9.46", validBody({ attack_kind: "explode" }));
    expect(badKind.status()).toBe(400);
    expect((badKind.body() as Record<string, unknown>).code).toBe("INVALID_ATTACK_KIND");
    const badField = await runAttack(chain, secret, "9.9.9.47", validBody({ surprise: true }));
    expect(badField.status()).toBe(400);
    expect((badField.body() as Record<string, unknown>).code).toBe("INVALID_REQUEST");
    expect(chain.settled()).toBe(false);
  });

  it("does not consume rate-limit quota on a scope failure", async () => {
    const { secret, publicKey } = makeKey();
    const other = makeKey().publicKey;
    const store = createRateLimitStore();
    const badChain = makeChain({ viewAccessKeyList: async () => scopedKeyList(other) });
    const bad = mockRes();
    await handleDemoAttack(mockReq("9.9.9.48", validBody()), bad.res, { ...makeDeps(badChain, secret), rateLimitStore: store });
    expect(bad.status()).toBe(500);
    expect((bad.body() as Record<string, unknown>).code).toBe("SCOPE_CHECK_FAILED");
    const goodChain = makeChain({ viewAccessKeyList: async () => scopedKeyList(publicKey) });
    const good = mockRes();
    await handleDemoAttack(mockReq("9.9.9.48", validBody()), good.res, { ...makeDeps(goodChain, secret), rateLimitStore: store });
    expect((good.body() as Record<string, unknown>).success).toBe(true);
  });

  it("returns the vault code, not SETTLE_TIMEOUT, when the refusal message contains timed out", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async () => {
        const err = new Error(
          "Smart contract panicked: ERR_RECIPIENT_SUBSTITUTION after the call timed out",
        ) as Error & { transactionResult: { transaction_outcome: { id: string } } };
        err.transactionResult = { transaction_outcome: { id: "refusaltx777" } };
        throw err;
      },
    });
    const out = await runAttack(chain, secret, "9.9.9.49", validBody({ proposed_recipient: ATTACKER }));
    const b = out.body() as Record<string, unknown>;
    expect(b.code).toBe("ERR_RECIPIENT_SUBSTITUTION");
    expect(b.txHash).toBe("refusaltx777");
  });

  it("a refusal with no usable tx hash says so in the error text", async () => {
    const { secret, publicKey } = makeKey();
    const chain = makeChain({
      viewAccessKeyList: async () => scopedKeyList(publicKey),
      settle: async () => {
        throw new Error("ERR_TERMS_MISMATCH");
      },
    });
    const out = await runAttack(chain, secret, "9.9.9.50", validBody({ proposed_amount: "200" }));
    const b = out.body() as Record<string, unknown>;
    expect(b.code).toBe("ERR_TERMS_MISMATCH");
    expect(b.txHash).toBeNull();
    expect(String(b.error)).toContain("No transaction hash came back");
  });

  it("a zero amount and the u128 maximum both reach the chain and are refused with ERR_TERMS_MISMATCH", async () => {
    const { secret, publicKey } = makeKey();
    for (let i = 0; i < 2; i++) {
      const amount = i === 0 ? "0" : U128_MAX;
      const seen: Array<{ obligationId: string; recipient: string; amount: string }> = [];
      const chain = makeChain({
        viewAccessKeyList: async () => scopedKeyList(publicKey),
        settle: async (obligationId: string, recipient: string, amt: string) => {
          seen.push({ obligationId, recipient, amount: amt });
          throw refusalError("ERR_TERMS_MISMATCH", "amounttx" + i);
        },
      });
      const out = await runAttack(chain, secret, "9.9.9.5" + (1 + i), validBody({ proposed_amount: amount }));
      const b = out.body() as Record<string, unknown>;
      expect(b.code).toBe("ERR_TERMS_MISMATCH");
      expect(seen).toEqual([{ obligationId: TARGET, recipient: "cynexmaster.testnet", amount }]);
    }
  });
});
