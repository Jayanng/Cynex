/**
 * Tests for the playground client. Pure functions only: the
 * DOM wiring runs in the browser, where the executor is the
 * authority and re-validates everything this client checks.
 */
import { buildSettleRequest, formatReadResult, formatSettleResult } from "./playground-client.js";

describe("buildSettleRequest", function () {
  it("builds the request the executor expects", function () {
    expect(
      buildSettleRequest(
        "cynex-testvault.cynexmaster.testnet",
        "p6-obl-002",
        "acme-supplies.testnet",
        "1001",
        "phase6-demo",
      ),
    ).toEqual({
      vaultId: "cynex-testvault.cynexmaster.testnet",
      obligationId: "p6-obl-002",
      proposedRecipient: "acme-supplies.testnet",
      proposedAmount: "1001",
      evidenceRef: "phase6-demo",
    });
  });
  it("trims the free-form fields and rejects empty or non-numeric input", function () {
    expect(function () {
      buildSettleRequest("v", "o", "", "1000", "phase6-demo");
    }).toThrow();
    expect(function () {
      buildSettleRequest("v", "o", "acme-supplies.testnet", "1.5", "phase6-demo");
    }).toThrow();
    expect(function () {
      buildSettleRequest("v", "o", "acme-supplies.testnet", "1000", "");
    }).toThrow();
    expect(buildSettleRequest("v", "o", "  acme-supplies.testnet  ", "1000", "phase6-demo").proposedRecipient).toBe(
      "acme-supplies.testnet",
    );
  });
});

describe("formatSettleResult", function () {
  it("says BLOCKED with the reason code and prints the tx hash and balances", function () {
    const lines = formatSettleResult({
      txHash: "abc123",
      reasonCode: "ERR_TERMS_MISMATCH",
      stateAfter: "READY",
      balanceBefore: "977004100",
      balanceAfter: "977004100",
      moved: "0",
    });
    expect(lines[0]).toBe("BLOCKED: ERR_TERMS_MISMATCH");
    expect(lines).toContain("tx hash: abc123");
    expect(lines).toContain("moved: 0");
  });
  it("says SETTLED on a real settlement", function () {
    const lines = formatSettleResult({
      txHash: "def456",
      settled: true,
      stateAfter: "PAID",
      balanceBefore: "977004100",
      balanceAfter: "977005100",
      moved: "1000",
    });
    expect(lines[0]).toBe("SETTLED");
    expect(lines).toContain("moved: 1000");
  });
});

describe("formatReadResult", function () {
  it("renders the live obligation and policy rows", function () {
    const lines = formatReadResult({
      obligation: { obligation_id: "p6-obl-002", state: "READY", recipient: "acme-supplies.testnet", amount: 1000, policy_id: "p6-001" },
      policy: { limit: 10000, spent: 1000, reserved: 0, funded: 10000, frozen: false },
      recipientBalance: "977004100",
    });
    expect(lines[0]).toContain("p6-obl-002: READY");
    expect(lines[1]).toContain("acme-supplies.testnet");
    expect(lines[4]).toContain("977004100");
  });
});
