/**
 * Vault guard and budget line tests for the SDK test client.
 * The guard is the client side protection for live runs:
 * production is for the clean happy path and at most one
 * carefully selected security failure, never exploratory testing.
 */
import {
  budgetLine,
  claimProductionNegativeUse,
  flagValue,
  firstValidFlagIndex,
  guardSettle,
  matrixArgs,
  matrixFixturesInArgvOrder,
  pickMatrixResolverObligationId,
  pickResolverObligationId,
  resolvePolicyId,
  verifyReceiptRow,
  verifySpentDelta,
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
    expect(flagValue(["--policy", "p6-001"], "--policy")).toBe("p6-001");
  });

  test("a flag followed by another flag yields nothing", () => {
    expect(flagValue(["--policy", "--matrix-settle", "x"], "--policy")).toBeUndefined();
    expect(flagValue(["--matrix-obligation", "--matrix-settle", "x"], "--matrix-obligation")).toBeUndefined();
  });

  test("a flag last on the command line yields nothing", () => {
    expect(flagValue(["--policy"], "--policy")).toBeUndefined();
  });

  test("a missing flag yields nothing", () => {
    expect(flagValue([], "--policy")).toBeUndefined();
  });

  test("a malformed first occurrence does not shadow a later valid one", () => {
    expect(
      flagValue(["--policy", "--matrix-settle", "x", "--policy", "p6-001"], "--policy"),
    ).toBe("p6-001");
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

  test("matrix fixtures resolve the policy from the first fixture on the command line", () => {
    const settle = ["settle-001", "a", "100", "ref"];
    const blocked = ["blocked-001", "a", "100", "ref"];
    const blockedFirst = matrixFixturesInArgvOrder(
      ["--matrix", "--matrix-blocked", ...blocked, "--matrix-settle", ...settle],
      [
        { flag: "--matrix-settle", count: 4, fixture: settle },
        { flag: "--matrix-blocked", count: 4, fixture: blocked },
      ],
    );
    expect(pickMatrixResolverObligationId(undefined, blockedFirst)).toBe("blocked-001");
    const settleFirst = matrixFixturesInArgvOrder(
      ["--matrix", "--matrix-settle", ...settle, "--matrix-blocked", ...blocked],
      [
        { flag: "--matrix-settle", count: 4, fixture: settle },
        { flag: "--matrix-blocked", count: 4, fixture: blocked },
      ],
    );
    expect(pickMatrixResolverObligationId(undefined, settleFirst)).toBe("settle-001");
  });

  test("a malformed first fixture occurrence does not reorder the fixtures", () => {
    const settle = ["settle-001", "a", "100", "ref"];
    const blocked = ["blocked-001", "a", "100", "ref"];
    const ordered = matrixFixturesInArgvOrder(
      ["--matrix", "--matrix-settle", "--matrix-blocked", ...blocked, "--matrix-settle", ...settle],
      [
        { flag: "--matrix-settle", count: 4, fixture: settle },
        { flag: "--matrix-blocked", count: 4, fixture: blocked },
      ],
    );
    expect(pickMatrixResolverObligationId(undefined, ordered)).toBe("blocked-001");
    expect(firstValidFlagIndex(["--matrix-settle", "--matrix-blocked"], "--matrix-settle", 4)).toBe(-1);
  });

  test("matrixArgs skips a malformed first occurrence for a later valid one", () => {
    expect(
      matrixArgs(
        ["--matrix-settle", "--matrix-blocked", "b", "100", "ref", "--matrix-settle", "s", "a", "100", "ref"],
        "--matrix-settle",
        4,
      ),
    ).toEqual(["s", "a", "100", "ref"]);
    expect(matrixArgs(["--matrix-settle", "--matrix-blocked"], "--matrix-settle", 4)).toBeUndefined();
  });

  test("refuses when the obligation on chain has no policy id", async () => {
    const reader = async (): Promise<Record<string, unknown>> => ({ obligation_id: "obl-001" });
    await expect(resolvePolicyId(reader, { obligationId: "obl-001" })).rejects.toThrow(
      /has no policy id on chain/,
    );
  });
});

describe("verifyReceiptRow", () => {
  const expected = { obligationId: "mcp-obl-001", recipient: AGENT, amount: "100", tokenId: "usdc.fakes.testnet", index: "24" };
  const goodRow = { obligation_id: "mcp-obl-001", recipient: AGENT, amount: "100", token_id: "usdc.fakes.testnet", index: "24", timestamp: "1794000000000000000", tx_ref: "settle-tx-hash" };

  test("a row matching the settled obligation passes", () => {
    expect(verifyReceiptRow(goodRow, expected).ok).toBe(true);
  });

  test("a missing row fails, it is not treated as a receipt", () => {
    expect(verifyReceiptRow(undefined, expected).ok).toBe(false);
  });

  test("a row with the right id and index but a different recipient fails", () => {
    expect(verifyReceiptRow({ ...goodRow, recipient: "cynexmaster.testnet" }, expected).ok).toBe(false);
  });

  test("a row with the right id and index but a different amount fails", () => {
    expect(verifyReceiptRow({ ...goodRow, amount: "200" }, expected).ok).toBe(false);
  });

  test("a row with the right id and index but a different token fails", () => {
    expect(verifyReceiptRow({ ...goodRow, token_id: "usdc.other.testnet" }, expected).ok).toBe(false);
  });

  test("a row with a different index fails", () => {
    expect(verifyReceiptRow({ ...goodRow, index: "23" }, expected).ok).toBe(false);
  });

  test("a row with no timestamp fails", () => {
    expect(verifyReceiptRow({ ...goodRow, timestamp: undefined }, expected).ok).toBe(false);
  });
});

describe("verifySpentDelta", () => {
  test("a spent rise equal to the settled amount passes", () => {
    const out = verifySpentDelta({ policy_id: "p6-001", spent: "5000" }, { policy_id: "p6-001", spent: "5100" }, "p6-001", "100");
    expect(out.ok).toBe(true);
  });

  test("a missing spent field fails, it is not treated as zero", () => {
    const out = verifySpentDelta({ policy_id: "p6-001" }, { policy_id: "p6-001", spent: "5100" }, "p6-001", "100");
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/missing/);
  });

  test("a policy row for a different policy fails", () => {
    const out = verifySpentDelta({ policy_id: "p6-001", spent: "5000" }, { policy_id: "p6-002", spent: "5100" }, "p6-001", "100");
    expect(out.ok).toBe(false);
  });

  test("a spent rise different from the settled amount fails", () => {
    const out = verifySpentDelta({ policy_id: "p6-001", spent: "5000" }, { policy_id: "p6-001", spent: "5050" }, "p6-001", "100");
    expect(out.ok).toBe(false);
  });

  test("an unreadable spent figure fails", () => {
    const out = verifySpentDelta({ policy_id: "p6-001", spent: "abc" }, { policy_id: "p6-001", spent: "5100" }, "p6-001", "100");
    expect(out.ok).toBe(false);
  });

  test("a malformed settled amount fails instead of throwing", () => {
    const out = verifySpentDelta({ policy_id: "p6-001", spent: "5000" }, { policy_id: "p6-001", spent: "5100" }, "p6-001", "abc");
    expect(out.ok).toBe(false);
  });
});

describe("claimProductionNegativeUse", () => {
  test("the first claim is allowed and the count rises", () => {
    const out = claimProductionNegativeUse(0);
    expect(out.allowed).toBe(true);
    expect(out.used).toBe(1);
  });

  test("a second claim is refused and the count does not rise", () => {
    const out = claimProductionNegativeUse(1);
    expect(out.allowed).toBe(false);
    expect(out.used).toBe(1);
  });
});
