/**
 * Vault guard and budget line tests for the SDK test client.
 * The guard is the client side protection for live runs:
 * production is for the clean happy path and at most one
 * carefully selected security failure, never exploratory testing.
 */
import {
  budgetLine,
  flagValue,
  guardSettle,
  pickMatrixResolverObligationId,
  pickResolverObligationId,
  resolvePolicyId,
} from "./test-client.js";

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

describe("flagValue", () => {
  test("a flag with a value returns it", () => {
    expect(flagValue(["--policy", "p6-001"], 0)).toBe("p6-001");
  });

  test("a flag followed by another flag yields nothing", () => {
    expect(flagValue(["--policy", "--matrix-settle", "x"], 0)).toBeUndefined();
    expect(flagValue(["--matrix-obligation", "--matrix-settle", "x"], 0)).toBeUndefined();
  });

  test("a flag last on the command line yields nothing", () => {
    expect(flagValue(["--policy"], 0)).toBeUndefined();
  });

  test("a missing flag yields nothing", () => {
    expect(flagValue([], -1)).toBeUndefined();
  });
});

describe("resolvePolicyId", () => {
  const throwingReader = async (): Promise<Record<string, unknown>> => {
    throw new Error("reader must not be called");
  };

  test("an explicit --policy flag wins over the obligation and the environment", async () => {
    const out = await resolvePolicyId(throwingReader, {
      policyFlag: "p5-prod-001",
      obligationId: "obl-001",
      envPolicy: "p6-001",
    });
    expect(out).toBe("p5-prod-001");
  });

  test("the policy id is read from the obligation on chain when no flag is given", async () => {
    const reader = async (id: string): Promise<Record<string, unknown>> => {
      expect(id).toBe("obl-001");
      return { obligation_id: "obl-001", policy_id: "p6-001" };
    };
    const out = await resolvePolicyId(reader, { obligationId: "obl-001" });
    expect(out).toBe("p6-001");
  });

  test("CYNEX_POLICY is the fallback when there is no flag and no obligation", async () => {
    const out = await resolvePolicyId(throwingReader, { envPolicy: "p6-001" });
    expect(out).toBe("p6-001");
  });

  test("refuses with a message naming --policy when nothing resolves", async () => {
    await expect(resolvePolicyId(throwingReader, {})).rejects.toThrow(/--policy/);
  });

  test("a plain settle run resolves the policy from its own obligation", () => {
    expect(pickResolverObligationId(undefined, ["mcp-m2-001", "a", "100", "ref"])).toBe(
      "mcp-m2-001",
    );
    expect(pickResolverObligationId("p6-001-obligation", ["mcp-m2-001"])).toBe(
      "p6-001-obligation",
    );
    expect(pickResolverObligationId(undefined, undefined)).toBeUndefined();
  });

  test("a matrix settle run resolves the policy from its fixture obligation", () => {
    expect(
      pickMatrixResolverObligationId(undefined, [
        undefined,
        ["mcp-m2-001", "a", "100", "ref"],
      ]),
    ).toBe("mcp-m2-001");
    expect(
      pickMatrixResolverObligationId("matrix-obligation", [["mcp-m2-001"]]),
    ).toBe("matrix-obligation");
    expect(pickMatrixResolverObligationId(undefined, [undefined, undefined])).toBeUndefined();
  });

  test("refuses when the obligation on chain has no policy id", async () => {
    const reader = async (): Promise<Record<string, unknown>> => ({ obligation_id: "obl-001" });
    await expect(resolvePolicyId(reader, { obligationId: "obl-001" })).rejects.toThrow(
      /has no policy id on chain/,
    );
  });
});
