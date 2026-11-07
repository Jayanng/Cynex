/**
 * CynexClient receipts() pagination tests, audit finding 8-1.
 * The contract expects pagination values as JSON numbers, so a
 * value above the safe integer range cannot be sent exactly.
 * The client must throw instead of silently rounding it, and
 * small values must keep working exactly as before. The
 * small-value live path is proven by cynex-verify on both
 * vaults; the stubbed-provider test below proves the client
 * still passes small values through to the view call.
 */
import { CynexClient, toSafeJsonU64 } from "./client.js";

describe("toSafeJsonU64", () => {
  test("small pagination values pass through unchanged", () => {
    expect(toSafeJsonU64(0n, "start")).toBe(0);
    expect(toSafeJsonU64(100n, "limit")).toBe(100);
  });

  test("Number.MAX_SAFE_INTEGER is the largest accepted value", () => {
    expect(toSafeJsonU64(BigInt(Number.MAX_SAFE_INTEGER), "start")).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  test("a value above 2^53 - 1 throws instead of silently rounding", () => {
    expect(() =>
      toSafeJsonU64(BigInt(Number.MAX_SAFE_INTEGER) + 1n, "start"),
    ).toThrow("safe integer range");
    expect(() => toSafeJsonU64(9007199254740993n, "start")).toThrow(
      "safe integer range",
    );
  });

  test("a negative value throws", () => {
    expect(() => toSafeJsonU64(-1n, "start")).toThrow("safe integer range");
  });
});

describe("CynexClient receipts()", () => {
  test("a start above 2^53 throws before any RPC call", () => {
    const client = new CynexClient("cynex-testvault.cynexmaster.testnet");
    expect(() => client.receipts(9007199254740993n, 100n)).toThrow(
      "safe integer range",
    );
  });

  test("small values still reach the view call", async () => {
    const client = new CynexClient("cynex-testvault.cynexmaster.testnet");
    const seen: Record<string, unknown>[] = [];
    (client as unknown as { provider: unknown }).provider = {
      callFunction: async (args: Record<string, unknown>) => {
        seen.push(args);
        return [];
      },
    };
    const out = await client.receipts(0n, 100n);
    expect(out).toEqual([]);
    expect(seen).toHaveLength(1);
    expect((seen[0]?.args as Record<string, unknown>).start).toBe(0);
    expect((seen[0]?.args as Record<string, unknown>).limit).toBe(100);
  });
});
