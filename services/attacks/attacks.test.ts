/**
 * Tests for the  attack runner core. Pure functions only:
 * no network, no signing, no shell. The live behaviour (real
 * settle transactions, real reason codes) is proven by the
 * runner's audit run, not by these tests.
 */
import {
  ATTACK_SCENARIOS,
  EXPECTED_CODE,
  U128_MAX,
  attackParams,
  containsShellMeta,
  formatTranscriptRow,
  headroomFor,
  isValidAccountId,
  parseAmountU128,
  reasonCodeFromError,
  transcriptHeader,
  validateSettleParams,
} from "./attacks.js";

describe("reasonCodeFromError", function () {
  it("reads the code out of a near-api-js panic message", function () {
    expect(reasonCodeFromError("Smart contract panicked: ERR_RECIPIENT_SUBSTITUTION")).toBe(
      "ERR_RECIPIENT_SUBSTITUTION",
    );
  });
  it("reads the code out of a raw RPC Failure JSON", function () {
    const failure = JSON.stringify({
      Failure: {
        ActionError: {
          kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: ERR_BUDGET_EXCEEDED" } },
        },
      },
    });
    expect(reasonCodeFromError(failure)).toBe("ERR_BUDGET_EXCEEDED");
  });
  it("returns null when no known code appears", function () {
    expect(reasonCodeFromError("Exceeded the prepaid gas")).toBeNull();
    expect(reasonCodeFromError("")).toBeNull();
  });
  it("knows all six codes", function () {
    for (const code of [
      "ERR_RECIPIENT_SUBSTITUTION",
      "ERR_TERMS_MISMATCH",
      "ERR_NONCE_ALREADY_CONSUMED",
      "ERR_BUDGET_EXCEEDED",
      "ERR_OBLIGATION_EXPIRED",
      "ERR_POLICY_FROZEN",
    ]) {
      expect(reasonCodeFromError("panicked: " + code)).toBe(code);
    }
  });
});

describe("isValidAccountId", function () {
  it("accepts named and implicit accounts", function () {
    expect(isValidAccountId("acme-supplies.testnet")).toBe(true);
    expect(isValidAccountId("unregistered-xyz.testnet")).toBe(true);
    expect(isValidAccountId("a".repeat(64))).toBe(true);
  });
  it("rejects the shapes a shell or parser would treat as structure", function () {
    expect(isValidAccountId("")).toBe(false);
    expect(isValidAccountId("a")).toBe(false);
    expect(isValidAccountId("Acme.testnet")).toBe(false);
    expect(isValidAccountId("acme supplies.testnet")).toBe(false);
    expect(isValidAccountId("-acme.testnet")).toBe(false);
    expect(isValidAccountId("acme-.testnet")).toBe(false);
    expect(isValidAccountId("acme..testnet")).toBe(false);
    expect(isValidAccountId("a".repeat(65))).toBe(false);
    expect(isValidAccountId("acme;rm.testnet")).toBe(false);
  });
});

describe("parseAmountU128", function () {
  it("parses a decimal string to bigint", function () {
    expect(parseAmountU128("1000")).toBe(1000n);
    expect(parseAmountU128(((1n << 128n) - 1n).toString())).toBe(U128_MAX);
  });
  it("rejects zero, non-digits, and overflow", function () {
    expect(function () {
      parseAmountU128("0");
    }).toThrow();
    expect(function () {
      parseAmountU128("1.5");
    }).toThrow();
    expect(function () {
      parseAmountU128(" 1000");
    }).toThrow();
    expect(function () {
      parseAmountU128("1000 ");
    }).toThrow();
    expect(function () {
      parseAmountU128((1n << 128n).toString());
    }).toThrow();
    expect(function () {
      parseAmountU128("");
    }).toThrow();
  });
});

describe("containsShellMeta", function () {
  it("catches the metacharacters the executor must never pass through", function () {
    for (const bad of ["a;b", "a$(b)", "a`b`", "a b", "a'b", 'a"b', "a|b", "a\\b", "a<b", "a>b", "a*b", "a?b", "a~b", "a#b"]) {
      expect(containsShellMeta(bad)).toBe(true);
    }
    expect(containsShellMeta("sample-demo")).toBe(false);
    expect(containsShellMeta("acme-supplies.testnet")).toBe(false);
    expect(containsShellMeta("1000")).toBe(false);
  });
});

describe("validateSettleParams", function () {
  it("accepts a clean call", function () {
    expect(validateSettleParams("acme-supplies.testnet", "1000", "sample-demo")).toEqual([]);
  });
  it("lists every problem instead of failing on the first", function () {
    const problems = validateSettleParams("Bad Recipient!", "0", "");
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
  it("rejects a metacharacter in any parameter", function () {
    expect(validateSettleParams("acme-supplies.testnet", "1000", "sample;demo").length).toBeGreaterThan(0);
    expect(validateSettleParams("acme-supplies.testnet", "1000;echo", "sample-demo").length).toBeGreaterThan(0);
  });
});

describe("headroomFor", function () {
  it("caps at the smaller of limit and funded", function () {
    expect(headroomFor({ limit: 1000n, funded: 10000n, spent: 0n, reserved: 0n })).toBe(1000n);
    expect(headroomFor({ limit: 10000n, funded: 1000n, spent: 0n, reserved: 0n })).toBe(1000n);
    expect(headroomFor({ limit: 10000n, funded: 10000n, spent: 1000n, reserved: 0n })).toBe(9000n);
    expect(headroomFor({ limit: 10000n, funded: 10000n, spent: 9000n, reserved: 1000n })).toBe(0n);
    expect(headroomFor({ limit: 10000n, funded: 10000n, spent: 10000n, reserved: 0n })).toBe(0n);
  });
});

describe("attackParams", function () {
  const obligation = { obligation_id: "p6-obl-001", recipient: "acme-supplies.testnet", amount: 1000n, state: "READY" };
  const policy = { limit: 10000n, funded: 10000n, spent: 1000n, reserved: 0n };
  it("covers all four scenarios with the frozen expected codes", function () {
    expect(ATTACK_SCENARIOS).toEqual(["recipient", "terms", "nonce", "budget"]);
    expect(EXPECTED_CODE.recipient).toBe("ERR_RECIPIENT_SUBSTITUTION");
    expect(EXPECTED_CODE.terms).toBe("ERR_TERMS_MISMATCH");
    expect(EXPECTED_CODE.nonce).toBe("ERR_NONCE_ALREADY_CONSUMED");
    expect(EXPECTED_CODE.budget).toBe("ERR_BUDGET_EXCEEDED");
  });
  it("recipient proposes a different payee and the recorded amount", function () {
    const params = attackParams("recipient", obligation, policy);
    expect(params.proposedRecipient).toBe("unregistered-xyz.testnet");
    expect(params.proposedAmount).toBe(1000n);
    expect(params.expectedCode).toBe("ERR_RECIPIENT_SUBSTITUTION");
  });
  it("recipient falls back when the recorded payee is already the wrong one", function () {
    const params = attackParams("recipient", { ...obligation, recipient: "unregistered-xyz.testnet" }, policy);
    expect(params.proposedRecipient).toBe("wrong-payee.testnet");
  });
  it("terms proposes one base unit more than recorded", function () {
    const params = attackParams("terms", obligation, policy);
    expect(params.proposedRecipient).toBe("acme-supplies.testnet");
    expect(params.proposedAmount).toBe(1001n);
    expect(params.expectedCode).toBe("ERR_TERMS_MISMATCH");
  });
  it("nonce replays the exact recorded terms", function () {
    const params = attackParams("nonce", obligation, policy);
    expect(params.proposedRecipient).toBe("acme-supplies.testnet");
    expect(params.proposedAmount).toBe(1000n);
    expect(params.expectedCode).toBe("ERR_NONCE_ALREADY_CONSUMED");
  });
  it("budget proposes the recorded amount when it exceeds headroom", function () {
    const big = { ...obligation, obligation_id: "p6-obl-004", amount: 9001n };
    const params = attackParams("budget", big, policy);
    expect(params.proposedAmount).toBe(9001n);
    expect(params.expectedCode).toBe("ERR_BUDGET_EXCEEDED");
  });
  it("budget refuses when the recorded amount fits the headroom", function () {
    expect(function () {
      attackParams("budget", obligation, policy);
    }).toThrow("headroom");
  });
});

describe("transcript formatting", function () {
  it("renders a markdown row with every required field", function () {
    const row = formatTranscriptRow({
      scenario: "recipient substitution",
      obligationId: "p6-obl-001",
      proposedRecipient: "unregistered-xyz.testnet",
      proposedAmount: "1000",
      txHash: "hsas9c1Esn1n5S8Gqo3zCTJyvTsioQcpPcQVrAsER3z",
      reasonCode: "ERR_RECIPIENT_SUBSTITUTION",
      stateAfter: "READY",
      balanceBefore: "977004100",
      balanceAfter: "977004100",
      moved: "0",
    });
    expect(row).toContain("hsas9c1Esn1n5S8Gqo3zCTJyvTsioQcpPcQVrAsER3z");
    expect(row).toContain("ERR_RECIPIENT_SUBSTITUTION");
    expect(transcriptHeader()).toContain("tx hash");
    expect(transcriptHeader()).toContain("balance before");
  });
});
