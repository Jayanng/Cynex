/**
 * Tests for the Phase 4 per-token budget display.
 * Token units and native NEAR are never mixed, the invariant mirrors
 * the contract assert, and inexact token figures throw instead of
 * rendering a rounded budget.
 */
import { describeBudget } from "./budget.js";

describe("describeBudget", function () {
  test("live policy-001 shape gives 25000000 headroom", function () {
    const d = describeBudget({
      spent: 975000000,
      reserved: 0,
      limit: 1000000000,
      funded: 1000000000,
      native_headroom: 1106409701021703399999993,
    });
    expect(d.headroom).toBe(25000000n);
    expect(d.invariantOk).toBe(true);
    expect(d.invariantDetail).toContain("spent + reserved");
  });

  test("exactly at the limit settles to zero headroom, invariant holds", function () {
    const d = describeBudget({
      spent: 1000000000,
      reserved: 0,
      limit: 1000000000,
      funded: 1000000000,
    });
    expect(d.headroom).toBe(0n);
    expect(d.invariantOk).toBe(true);
  });

  test("limit plus one breaks the invariant and headroom is zero, not negative", function () {
    const d = describeBudget({
      spent: 1000000001,
      reserved: 0,
      limit: 1000000000,
      funded: 1000000000,
    });
    expect(d.invariantOk).toBe(false);
    expect(d.headroom).toBe(0n);
  });

  test("funded below limit binds headroom, not limit", function () {
    const d = describeBudget({
      spent: 900000000,
      reserved: 0,
      limit: 2000000000,
      funded: 1000000000,
    });
    expect(d.headroom).toBe(100000000n);
    expect(d.invariantOk).toBe(true);
  });

  test("native headroom never changes token headroom", function () {
    const plain = describeBudget({
      spent: 975000000,
      reserved: 0,
      limit: 1000000000,
      funded: 1000000000,
    });
    const withNative = describeBudget({
      spent: 975000000,
      reserved: 0,
      limit: 1000000000,
      funded: 1000000000,
      native_headroom: 1106409701021703399999993,
    });
    expect(withNative.headroom).toBe(plain.headroom);
    expect(withNative.nativeHeadroom).not.toBeNull();
    expect(plain.nativeHeadroom).toBeNull();
  });

  test("string token figures parse exactly", function () {
    const d = describeBudget({
      spent: "975000000",
      reserved: "0",
      limit: "1000000000",
      funded: "1000000000",
    });
    expect(d.headroom).toBe(25000000n);
    expect(d.invariantOk).toBe(true);
  });

  test("unsafe token figure throws instead of rounding", function () {
    expect(function () {
      describeBudget({
        spent: 9750000000000000000,
        reserved: 0,
        limit: 1000000000,
        funded: 1000000000,
      });
    }).toThrow("not exactly representable");
  });
});
