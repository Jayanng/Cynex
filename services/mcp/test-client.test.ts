/**
 * Vault guard and budget line tests for the SDK test client.
 * The guard is the client side protection for live runs:
 * production is for the clean happy path and at most one
 * carefully selected security failure, never exploratory testing.
 */
import { budgetLine, guardSettle } from "./test-client.js";

const TEST_VAULT = "cynex-testvault.cynexmaster.testnet";
const PROD_VAULT = "cynex-vault.cynexmaster.testnet";
const AGENT = "cynex-agent.cynexmaster.testnet";

describe("guardSettle", () => {
  test("matching terms are allowed on both vaults", () => {
    const obligation = { recipient: AGENT, amount: "100" };
    expect(guardSettle(TEST_VAULT, obligation, AGENT, "100", false).allowed).toBe(true);
    expect(guardSettle(PROD_VAULT, obligation, AGENT, "100", false).allowed).toBe(true);
  });

  test("mismatched terms are refused on production without the explicit flag", () => {
    const obligation = { recipient: AGENT, amount: "100" };
    const out = guardSettle(PROD_VAULT, obligation, "cynexmaster.testnet", "100", false);
    expect(out.allowed).toBe(false);
    expect(out.termsMatch).toBe(false);
    expect(out.reason).toMatch(/production vault guard/);
  });

  test("mismatched terms are allowed on production only with the explicit flag", () => {
    const obligation = { recipient: AGENT, amount: "100" };
    const out = guardSettle(PROD_VAULT, obligation, "cynexmaster.testnet", "100", true);
    expect(out.allowed).toBe(true);
    expect(out.reason).toMatch(/--allow-production-negative/);
  });

  test("mismatched terms are allowed on the test vault, the vault must see the attempt", () => {
    const obligation = { recipient: AGENT, amount: "100" };
    const out = guardSettle(TEST_VAULT, obligation, "cynexmaster.testnet", "100", false);
    expect(out.allowed).toBe(true);
    expect(out.reason).toMatch(/test vault/);
  });

  test("an unreadable obligation never matches", () => {
    const out = guardSettle(PROD_VAULT, {}, AGENT, "100", false);
    expect(out.allowed).toBe(false);
    expect(out.termsMatch).toBe(false);
    expect(out.reason).toMatch(/cannot be verified/);
  });

  test("a leading-zero proposed amount matches the recorded amount numerically", () => {
    const obligation = { recipient: AGENT, amount: "100" };
    const out = guardSettle(PROD_VAULT, obligation, AGENT, "0100", false);
    expect(out.allowed).toBe(true);
    expect(out.termsMatch).toBe(true);
  });

  test("an unparseable recorded amount refuses on the test vault too", () => {
    const obligation = { recipient: AGENT, amount: "abc" };
    const out = guardSettle(TEST_VAULT, obligation, AGENT, "100", false);
    expect(out.allowed).toBe(false);
    expect(out.reason).toMatch(/cannot be verified/);
  });

  test("an unparseable proposed amount refuses", () => {
    const obligation = { recipient: AGENT, amount: "100" };
    const out = guardSettle(TEST_VAULT, obligation, AGENT, "1e2", false);
    expect(out.allowed).toBe(false);
    expect(out.reason).toMatch(/cannot be verified/);
  });
});

describe("budgetLine", () => {
  test("prints the exact remaining budget from string figures", () => {
    const line = budgetLine({ policy_id: "p6-001", spent: "4800", reserved: "0", limit: "10000", funded: "10000" });
    expect(line).toMatch(/spent 4800/);
    expect(line).toMatch(/remaining by limit 5200/);
    expect(line).toMatch(/remaining by funded 5200/);
  });

  test("reads JSON numbers as the chain returns them", () => {
    const line = budgetLine({ policy_id: "p6-001", spent: 4800, reserved: 0, limit: 10000, funded: 10000 });
    expect(line).toMatch(/remaining by limit 5200/);
  });
});
