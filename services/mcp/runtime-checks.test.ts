/**
 * Runtime checks tests: the per-settle integrity checks must pass
 * on live-shaped state and fail closed on every missing or
 * inconsistent field. The fakes here stand in for the RPC reads
 * so each check can be tested in isolation; the live reads are
 * proven by the SDK test client run against testnet.
 */
import {
  assertSettleTarget,
  checkBudget,
  parseGasPrice,
  settleGasCostYocto,
  toChainBigInt,
  verifyEcho,
  verifyRuntimeState,
  type RuntimeState,
} from "./runtime-checks.js";

const VAULT = "cynex-testvault.cynexmaster.testnet";
const PUBKEY = "ed25519:2MBdiB9ayS1SREqAvZFC6ZuzdA9TuAjEFHV8HYPjZKgn";
const RPC_URL = "https://rpc.testnet.fastnear.com";
const CODE_HASH = "65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6";

function passingState(): RuntimeState {
  return {
    chainId: "testnet",
    vaultExists: true,
    vaultCodeHash: CODE_HASH,
    accessKey: {
      permission: {
        FunctionCall: {
          allowance: "250000000000000000000000",
          method_names: ["settle"],
          receiver_id: VAULT,
        },
      },
    },
    gasPrice: 100000000n,
  };
}

function check(state: RuntimeState) {
  return verifyRuntimeState(state, { rpcUrl: RPC_URL, vaultId: VAULT, agentPublicKey: PUBKEY });
}

describe("verifyRuntimeState", () => {
  test("passes on live-shaped state", () => {
    const out = check(passingState());
    expect(out.ok).toBe(true);
    expect(out.reason).toMatch(/runtime checks passed/);
  });

  test("refuses a non-testnet RPC URL", () => {
    const out = verifyRuntimeState(passingState(), {
      rpcUrl: "https://rpc.mainnet.fastnear.com",
      vaultId: VAULT,
      agentPublicKey: PUBKEY,
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/not a testnet RPC URL/);
  });

  test("refuses when the network id could not be read", () => {
    const out = check({ ...passingState(), chainId: null });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/network id could not be read/);
  });

  test("refuses when the RPC serves another network", () => {
    const out = check({ ...passingState(), chainId: "mainnet" });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/serves network mainnet/);
  });

  test("refuses when the vault account does not exist", () => {
    const out = check({ ...passingState(), vaultExists: false });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/does not exist/);
  });

  test("refuses when the vault code hash could not be read", () => {
    const out = check({ ...passingState(), vaultCodeHash: null });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/code hash could not be read/);
  });

  test("refuses when the vault code hash differs from the deployed hash", () => {
    const out = check({ ...passingState(), vaultCodeHash: "1111111111111111111111111111111111111111111111111111" });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/does not equal the expected deployed hash/);
  });

  test("refuses when the signing key could not be read", () => {
    const out = check({ ...passingState(), accessKey: null });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/could not be read from the agent account/);
  });

  test("refuses when the signing key is scoped to another vault", () => {
    const state = passingState();
    state.accessKey = {
      permission: {
        FunctionCall: {
          allowance: "250000000000000000000000",
          method_names: ["settle"],
          receiver_id: "cynex-vault.cynexmaster.testnet",
        },
      },
    };
    expect(check(state).ok).toBe(false);
    expect(check(state).reason).toMatch(/not the configured vault/);
  });

  test("refuses broader methods and a full-access key", () => {
    const broad = passingState();
    broad.accessKey = {
      permission: {
        FunctionCall: {
          allowance: "250000000000000000000000",
          method_names: ["settle", "create_obligation"],
          receiver_id: VAULT,
        },
      },
    };
    expect(check(broad).ok).toBe(false);
    expect(check(broad).reason).toMatch(/exactly \[settle\]/);
    const full = passingState();
    full.accessKey = { permission: "FullAccess" };
    expect(check(full).ok).toBe(false);
    expect(check(full).reason).toMatch(/full-access/);
  });

  test("refuses unlimited and zero allowance", () => {
    const unlimited = passingState();
    unlimited.accessKey = {
      permission: {
        FunctionCall: { allowance: null, method_names: ["settle"], receiver_id: VAULT },
      },
    };
    expect(check(unlimited).ok).toBe(false);
    expect(check(unlimited).reason).toMatch(/finite, positive allowance/);
    const zero = passingState();
    zero.accessKey = {
      permission: {
        FunctionCall: { allowance: "0", method_names: ["settle"], receiver_id: VAULT },
      },
    };
    expect(check(zero).ok).toBe(false);
    expect(check(zero).reason).toMatch(/finite, positive allowance/);
  });

  test("refuses an allowance below the settle gas cost, accepts exactly the cost", () => {
    const low = passingState();
    low.accessKey = {
      permission: {
        FunctionCall: {
          allowance: "1000000000000000000000",
          method_names: ["settle"],
          receiver_id: VAULT,
        },
      },
    };
    const lowOut = check(low);
    expect(lowOut.ok).toBe(false);
    expect(lowOut.reason).toMatch(/below the estimated settle gas cost/);
    const exact = passingState();
    exact.accessKey = {
      permission: {
        FunctionCall: {
          allowance: "10000000000000000000000",
          method_names: ["settle"],
          receiver_id: VAULT,
        },
      },
    };
    expect(check(exact).ok).toBe(true);
  });

  test("refuses when the gas price could not be read", () => {
    const out = check({ ...passingState(), gasPrice: null });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/gas price could not be read/);
  });

  test("refuses a negative gas price", () => {
    const out = check({ ...passingState(), gasPrice: -1n });
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/gas price is negative/);
  });

  test("accepts the access key list shape as well as the single key shape", () => {
    const state = passingState();
    state.accessKey = {
      access_key: {
        permission: {
          FunctionCall: {
            allowance: "250000000000000000000000",
            method_names: ["settle"],
            receiver_id: VAULT,
          },
        },
      },
    };
    expect(check(state).ok).toBe(true);
  });
});

describe("settleGasCostYocto", () => {
  test("100 TGas at the live gas price costs 0.01 NEAR", () => {
    expect(settleGasCostYocto(100000000n)).toBe(10000000000000000000000n);
  });
});

describe("verifyEcho", () => {
  test("passes when the row echoes the requested id", () => {
    expect(verifyEcho({ obligation_id: "mcp-obl-001" }, "obligation_id", "mcp-obl-001").ok).toBe(true);
  });

  test("refuses a response for a different id", () => {
    const out = verifyEcho({ obligation_id: "other-001" }, "obligation_id", "mcp-obl-001");
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/not the requested mcp-obl-001/);
  });

  test("refuses a response with the id field missing", () => {
    const out = verifyEcho({ state: "READY" }, "obligation_id", "mcp-obl-001");
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/carries no obligation_id/);
  });

  test("refuses a missing row", () => {
    expect(verifyEcho(null, "obligation_id", "mcp-obl-001").ok).toBe(false);
  });
});

describe("checkBudget", () => {
  test("passes with headroom, reading JSON numbers as the chain returns them", () => {
    const out = checkBudget({ spent: 4800, reserved: 0, limit: 10000, funded: 10000 }, 100n);
    expect(out.ok).toBe(true);
  });

  test("passes exactly at the limit and the funded amount", () => {
    const out = checkBudget({ spent: "4600", reserved: "0", limit: "10000", funded: "10000" }, 5400n);
    expect(out.ok).toBe(true);
  });

  test("refuses when spent plus reserved plus amount exceeds the limit", () => {
    const out = checkBudget({ spent: "9900", reserved: "0", limit: "10000", funded: "10000" }, 200n);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/exceeds the policy limit/);
    expect(out.reason).toMatch(/ERR_BUDGET_EXCEEDED/);
  });

  test("refuses when the total exceeds the funded amount but not the limit", () => {
    const out = checkBudget({ spent: "9900", reserved: "0", limit: "20000", funded: "10000" }, 200n);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/exceeds the funded amount/);
  });

  test("throws on a malformed policy figure instead of passing it", () => {
    expect(() => checkBudget({ spent: "abc", reserved: "0", limit: "10000", funded: "10000" }, 100n)).toThrow(
      /not a readable integer/,
    );
  });
});

describe("toChainBigInt", () => {
  test("reads decimal strings, JSON numbers, and bigints", () => {
    expect(toChainBigInt("4600", "spent")).toBe(4600n);
    expect(toChainBigInt(4800, "spent")).toBe(4800n);
    expect(toChainBigInt(0n, "spent")).toBe(0n);
  });

  test("throws on floats, negatives, and non-numeric strings", () => {
    expect(() => toChainBigInt(1.5, "spent")).toThrow(/not a readable integer/);
    expect(() => toChainBigInt(-1, "spent")).toThrow(/not a readable integer/);
    expect(() => toChainBigInt("10.5", "spent")).toThrow(/not a readable integer/);
  });

  test("throws on unsafe JSON numbers, which lose precision above 2^53", () => {
    expect(() => toChainBigInt(2 ** 53, "spent")).toThrow(/not a readable integer/);
    expect(toChainBigInt(2 ** 53 - 1, "spent")).toBe(9007199254740991n);
  });
});

describe("assertSettleTarget", () => {
  test("passes for the configured vault and settle", () => {
    expect(assertSettleTarget(VAULT, VAULT, "settle").ok).toBe(true);
  });

  test("refuses a different receiver", () => {
    const out = assertSettleTarget(VAULT, "cynex-vault.cynexmaster.testnet", "settle");
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/is not the configured vault/);
  });

  test("refuses an unsupported method name", () => {
    const out = assertSettleTarget(VAULT, VAULT, "transfer");
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/is not settle/);
  });
});

describe("parseGasPrice", () => {
  test("reads decimal strings, bigints, and safe non-negative numbers", () => {
    expect(parseGasPrice("100000000")).toBe(100000000n);
    expect(parseGasPrice(100000000n)).toBe(100000000n);
    expect(parseGasPrice(100000000)).toBe(100000000n);
    expect(parseGasPrice("0")).toBe(0n);
  });

  test("returns null for negative, unsafe, float, and malformed values", () => {
    expect(parseGasPrice(-1)).toBe(null);
    expect(parseGasPrice(-1n)).toBe(null);
    expect(parseGasPrice(2 ** 53)).toBe(null);
    expect(parseGasPrice(1.5)).toBe(null);
    expect(parseGasPrice("10.5")).toBe(null);
    expect(parseGasPrice("")).toBe(null);
    expect(parseGasPrice(null)).toBe(null);
    expect(parseGasPrice({})).toBe(null);
  });
});
