/* Tests for the "Break it" live attack client logic: the response
 * parser, the pick of the target obligation, and the whitelist the
 * client shares with the server. The parser is the contract between
 * /api/demo-attack and the BreakIt component: a vault refusal is a
 * successful demonstration with a real tx hash, never an error; a
 * malformed body or an unknown code is unconfirmed, never a retry. */

import {
  ATTACK_KINDS,
  DEMO_ATTACK_ENDPOINT,
  DEMO_ATTACK_RATE_LIMIT_TEXT,
  DEMO_LIVE_IDS,
  DEMO_NOEVIDENCE_ID,
  USECASE_ID,
  lockedTermsForObligation,
  mostRecentPaidDemoObligation,
  nextReadyDemoObligation,
  parseDemoAttackResponse,
  replayChoices,
  settleErrorCode as attackSettleErrorCode,
} from "../../web/src/lib/demoAttack.js";
import type { DemoAttackResult } from "../../web/src/lib/demoAttack.js";
import {
  SETTLE_ERROR_CODES as clientCodes,
  settleErrorCode as clientSettleErrorCode,
} from "../../web/src/lib/demoSettle.js";
import { SETTLE_ERROR_CODES as serverCodes, settleErrorCode as serverSettleErrorCode } from "../../web/api/demo-settle.js";

const paidResult: DemoAttackResult = {
  success: true,
  obligationId: "demo-live-007",
  receiptIndex: 36,
  txHash: "attacktx123",
  recipient: "cynexmaster.testnet",
  amount: "100",
  policySpent: "5900",
  remaining: 3,
};

function rows(ids: string[]): Array<{ obligation_id: string }> {
  return ids.map((obligation_id) => ({ obligation_id }));
}

describe("DEMO_ATTACK_ENDPOINT and DEMO_ATTACK_RATE_LIMIT_TEXT", () => {
  it("points at /api/demo-attack", () => {
    expect(DEMO_ATTACK_ENDPOINT).toBe("/api/demo-attack");
  });

  it("states the live rate limit: 1 attempt every 10 seconds, 30 per hour", () => {
    expect(DEMO_ATTACK_RATE_LIMIT_TEXT).toContain("10 seconds");
    expect(DEMO_ATTACK_RATE_LIMIT_TEXT).toContain("30 per hour");
    expect(DEMO_ATTACK_RATE_LIMIT_TEXT).toContain("per server instance");
    expect(DEMO_ATTACK_RATE_LIMIT_TEXT).toContain("1 NEAR");
  });
});

describe("DEMO_LIVE_IDS", () => {
  it("lists the ten demo-live obligations in order", () => {
    expect(DEMO_LIVE_IDS).toEqual([
      "demo-live-001",
      "demo-live-002",
      "demo-live-003",
      "demo-live-004",
      "demo-live-005",
      "demo-live-006",
      "demo-live-007",
      "demo-live-008",
      "demo-live-009",
      "demo-live-010",
    ]);
  });
});

describe("nextReadyDemoObligation", () => {
  it("returns null when the receipts have not loaded yet", () => {
    expect(nextReadyDemoObligation(null)).toBeNull();
  });

  it("returns the first id when the receipts loaded and none are paid", () => {
    expect(nextReadyDemoObligation([])).toBe("demo-live-001");
  });

  it("returns the first demo-live id with no receipt", () => {
    expect(nextReadyDemoObligation(rows(["demo-live-001"]))).toBe("demo-live-002");
    expect(nextReadyDemoObligation(rows(["demo-live-001", "demo-live-002", "demo-live-004"]))).toBe(
      "demo-live-003",
    );
  });

  it("ignores receipts for obligations outside the demo-live pool", () => {
    expect(nextReadyDemoObligation(rows(["usecase-report-002", "demo-live-001"]))).toBe("demo-live-002");
  });

  it("returns null when every demo-live obligation has a receipt", () => {
    expect(nextReadyDemoObligation(rows([...DEMO_LIVE_IDS]))).toBeNull();
  });
});

describe("mostRecentPaidDemoObligation", () => {
  it("returns null when nothing is known or nothing demo-live is paid", () => {
    expect(mostRecentPaidDemoObligation(null)).toBeNull();
    expect(mostRecentPaidDemoObligation([])).toBeNull();
    expect(mostRecentPaidDemoObligation(rows(["usecase-report-002"]))).toBeNull();
  });

  it("returns the last demo-live id in the receipt rows", () => {
    expect(mostRecentPaidDemoObligation(rows(["demo-live-001"]))).toBe("demo-live-001");
    expect(mostRecentPaidDemoObligation(rows(["demo-live-001", "demo-live-002"]))).toBe("demo-live-002");
    expect(mostRecentPaidDemoObligation(rows(["demo-live-001", "usecase-report-002", "demo-live-002"]))).toBe(
      "demo-live-002",
    );
  });

  it("follows row order, not id order: the last row wins", () => {
    expect(mostRecentPaidDemoObligation(rows(["demo-live-002", "demo-live-001"]))).toBe("demo-live-001");
  });
});

describe("parseDemoAttackResponse, paid", () => {
  it("accepts a full success with a numeric receipt index", () => {
    const out = parseDemoAttackResponse({ ...paidResult });
    expect(out.outcome).toBe("paid");
    if (out.outcome === "paid") {
      expect(out.result.receiptIndex).toBe(36);
      expect(out.result.obligationId).toBe("demo-live-007");
      expect(out.result.txHash).toBe("attacktx123");
      expect(out.result.recipient).toBe("cynexmaster.testnet");
      expect(out.result.amount).toBe("100");
    }
  });

  it("rejects a success missing the receipt index as unconfirmed, never paid", () => {
    const out = parseDemoAttackResponse({ ...paidResult, receiptIndex: null });
    expect(out.outcome).toBe("unconfirmed");
    if (out.outcome === "unconfirmed") {
      expect(out.txHash).toBe("attacktx123");
      expect(out.obligationId).toBe("demo-live-007");
    }
  });

  it("rejects a success missing the tx hash as unconfirmed", () => {
    expect(parseDemoAttackResponse({ ...paidResult, txHash: null }).outcome).toBe("unconfirmed");
    expect(parseDemoAttackResponse({ ...paidResult, txHash: "" }).outcome).toBe("unconfirmed");
  });

  it("rejects a success missing the obligation id as unconfirmed", () => {
    expect(parseDemoAttackResponse({ ...paidResult, obligationId: null }).outcome).toBe("unconfirmed");
    expect(parseDemoAttackResponse({ ...paidResult, obligationId: "" }).outcome).toBe("unconfirmed");
  });

  it("rejects a success with a non-numeric receipt index as unconfirmed", () => {
    expect(parseDemoAttackResponse({ ...paidResult, receiptIndex: "36" }).outcome).toBe("unconfirmed");
  });
});

describe("parseDemoAttackResponse, refused", () => {
  it("maps a whitelisted refusal code to refused with the real tx hash and the terms", () => {
    const out = parseDemoAttackResponse({
      success: false,
      code: "ERR_RECIPIENT_SUBSTITUTION",
      error: "The vault refused this attempt on chain: ERR_RECIPIENT_SUBSTITUTION. No tokens moved.",
      txHash: "refusaltx123",
      obligationId: "demo-live-007",
      recipient: "someone-else.testnet",
      amount: "200",
    });
    expect(out.outcome).toBe("refused");
    if (out.outcome === "refused") {
      expect(out.code).toBe("ERR_RECIPIENT_SUBSTITUTION");
      expect(out.txHash).toBe("refusaltx123");
      expect(out.obligationId).toBe("demo-live-007");
      expect(out.recipient).toBe("someone-else.testnet");
      expect(out.amount).toBe("200");
    }
  });

  it("maps a replay refusal to refused", () => {
    const out = parseDemoAttackResponse({
      success: false,
      code: "ERR_NONCE_ALREADY_CONSUMED",
      error: "The vault refused this attempt on chain: ERR_NONCE_ALREADY_CONSUMED. No tokens moved.",
      txHash: "replaytx999",
      obligationId: "demo-live-005",
    });
    expect(out.outcome).toBe("refused");
    if (out.outcome === "refused") expect(out.code).toBe("ERR_NONCE_ALREADY_CONSUMED");
  });

  it("maps every whitelisted settle code to refused", () => {
    for (const code of [...clientCodes]) {
      const out = parseDemoAttackResponse({
        success: false,
        code,
        error: "The vault refused this attempt on chain: " + code + ".",
        txHash: "sometx",
        obligationId: "demo-live-007",
      });
      expect(out.outcome).toBe("refused");
    }
  });

  it("still reports refused when the refusal carries no tx hash", () => {
    const out = parseDemoAttackResponse({
      success: false,
      code: "ERR_TERMS_MISMATCH",
      error: "The vault refused this attempt on chain: ERR_TERMS_MISMATCH.",
      txHash: null,
      obligationId: "demo-live-007",
    });
    expect(out.outcome).toBe("refused");
    if (out.outcome === "refused") expect(out.txHash).toBeNull();
  });
});

describe("parseDemoAttackResponse, usedUp", () => {
  it("maps DEMO_USED_UP to usedUp with the fallback", () => {
    const out = parseDemoAttackResponse({
      success: false,
      code: "DEMO_USED_UP",
      error: "All 10 demo settles are used up.",
      fallback: "Use the sandbox.",
    });
    expect(out.outcome).toBe("usedUp");
    if (out.outcome === "usedUp") {
      expect(out.error).toBe("All 10 demo settles are used up.");
      expect(out.fallback).toBe("Use the sandbox.");
    }
  });

  it("does not map a used-up message to usedUp without the code", () => {
    const out = parseDemoAttackResponse({
      success: false,
      error: "All 10 demo settles are used up.",
    });
    expect(out.outcome).toBe("unconfirmed");
  });
});

describe("parseDemoAttackResponse, unconfirmed", () => {
  it("maps SETTLE_TIMEOUT and SETTLE_UNCONFIRMED to unconfirmed with the tx hash kept", () => {
    const timeout = parseDemoAttackResponse({
      success: false,
      code: "SETTLE_TIMEOUT",
      error: "Confirmation timed out.",
      obligationId: "demo-live-007",
    });
    expect(timeout.outcome).toBe("unconfirmed");
    const unconfirmed = parseDemoAttackResponse({
      success: false,
      code: "SETTLE_UNCONFIRMED",
      error: "The attempt could not be confirmed.",
      txHash: "abc123",
      obligationId: "demo-live-007",
    });
    expect(unconfirmed.outcome).toBe("unconfirmed");
    if (unconfirmed.outcome === "unconfirmed") {
      expect(unconfirmed.txHash).toBe("abc123");
      expect(unconfirmed.obligationId).toBe("demo-live-007");
    }
  });

  it("treats a malformed body as unconfirmed, never a retryable error", () => {
    expect(parseDemoAttackResponse(null).outcome).toBe("unconfirmed");
    expect(parseDemoAttackResponse("ok").outcome).toBe("unconfirmed");
    expect(parseDemoAttackResponse(42).outcome).toBe("unconfirmed");
    expect(parseDemoAttackResponse(["x"]).outcome).toBe("unconfirmed");
  });

  it("maps an unrecognized code to unconfirmed, not a retryable error", () => {
    const out = parseDemoAttackResponse({
      success: false,
      code: "SOMETHING_NEW",
      error: "Something unexpected happened.",
    });
    expect(out.outcome).toBe("unconfirmed");
  });

  it("maps a transport ERR_ code to unconfirmed, not a refusal", () => {
    const out = parseDemoAttackResponse({
      success: false,
      code: "SETTLE_UNCONFIRMED",
      error: "socket hang up: ERR_SOCKET_CLOSED",
    });
    expect(out.outcome).toBe("unconfirmed");
    const failed = parseDemoAttackResponse({
      success: false,
      code: "SETTLE_FAILED",
      error: "socket hang up: ERR_SOCKET_CLOSED",
    });
    expect(failed.outcome).toBe("unconfirmed");
  });
});

describe("parseDemoAttackResponse, error", () => {
  it("maps each validation, rate-limit, config, and missing-obligation code to error", () => {
    for (const code of [
      "INVALID_REQUEST",
      "INVALID_OBLIGATION",
      "INVALID_RECIPIENT",
      "INVALID_AMOUNT",
      "INVALID_ATTACK_KIND",
      "RATE_LIMITED",
      "DEMO_NOT_CONFIGURED",
      "OBLIGATION_MISSING",
      "METHOD_NOT_ALLOWED",
      "DEMO_KEY_INVALID",
      "CHAIN_UNREADABLE",
      "SCOPE_CHECK_FAILED",
      "NOT_REPLAYABLE",
      "WRONG_STATE",
    ]) {
      const out = parseDemoAttackResponse({ success: false, code, error: "Failed: " + code + "." });
      expect(out.outcome).toBe("error");
      if (out.outcome === "error") {
        expect(out.error).toBe("Failed: " + code + ".");
        expect(out.fallback).toBeNull();
      }
    }
  });

  it("keeps the fallback when the error carries one", () => {
    const out = parseDemoAttackResponse({
      success: false,
      code: "DEMO_NOT_CONFIGURED",
      error: "The live demo is not configured yet.",
      fallback: "Use the sandbox.",
    });
    expect(out.outcome).toBe("error");
    if (out.outcome === "error") expect(out.fallback).toBe("Use the sandbox.");
  });
});

describe("settle error code whitelist, client and server", () => {
  it("holds the same eleven codes on the client and on the server", () => {
    expect([...clientCodes].sort()).toEqual([...serverCodes].sort());
    expect(clientCodes.size).toBe(11);
    expect(serverCodes.size).toBe(11);
  });

  it("recognises every whitelisted code and rejects transport codes, on both sides", () => {
    for (const code of [...serverCodes]) {
      const message = "The settle failed: " + code + ".";
      expect(clientSettleErrorCode(message)).toBe(code);
      expect(serverSettleErrorCode(message)).toBe(code);
      expect(attackSettleErrorCode(message)).toBe(code);
    }
    for (const message of ["socket hang up: ERR_SOCKET_CLOSED", "no code here", ""]) {
      expect(clientSettleErrorCode(message)).toBeNull();
      expect(serverSettleErrorCode(message)).toBeNull();
      expect(attackSettleErrorCode(message)).toBeNull();
    }
  });

  it("uses the same whitelist for the attack endpoint as for the settle endpoint", () => {
    // demoAttack.ts re-exports settleErrorCode from demoSettle.ts, and
    // demo-attack.ts imports settleErrorCode from demo-settle.ts, so a
    // refusal the attack endpoint recognises is one the client
    // recognises too. The behaviour above pins that agreement for
    // every whitelisted code instead of comparing module objects.
    expect(attackSettleErrorCode("ERR_RECIPIENT_SUBSTITUTION")).toBe("ERR_RECIPIENT_SUBSTITUTION");
    expect(serverSettleErrorCode("ERR_RECIPIENT_SUBSTITUTION")).toBe("ERR_RECIPIENT_SUBSTITUTION");
    expect(attackSettleErrorCode("ERR_NONCE_ALREADY_CONSUMED")).toBe("ERR_NONCE_ALREADY_CONSUMED");
    expect(serverSettleErrorCode("ERR_NONCE_ALREADY_CONSUMED")).toBe("ERR_NONCE_ALREADY_CONSUMED");
  });
});

describe("ATTACK_KINDS", () => {
  it("lists the six live attack kinds", () => {
    expect([...ATTACK_KINDS]).toEqual([
      "change_recipient",
      "change_amount",
      "replay",
      "settle_before_evidence",
      "prompt_injection",
      "freeform",
    ]);
  });
});

describe("replayChoices", () => {
  it("returns null when the receipts have not loaded yet", () => {
    expect(replayChoices(null)).toBeNull();
  });

  it("returns an empty list when nothing is PAID yet", () => {
    expect(replayChoices([])).toEqual([]);
    expect(replayChoices(rows(["demo-live-007"]))).toEqual(["demo-live-007"]);
  });

  it("lists paid demo-live obligations and the use-case obligation in receipt order", () => {
    expect(
      replayChoices(rows(["demo-live-001", "usecase-report-002", "demo-live-002"])),
    ).toEqual(["demo-live-001", "usecase-report-002", "demo-live-002"]);
  });

  it("ignores receipts for obligations outside the replay pool and dedupes", () => {
    expect(
      replayChoices(rows(["demo-live-001", "some-other-obligation", "demo-live-001"])),
    ).toEqual(["demo-live-001"]);
  });
});

describe("lockedTermsForObligation", () => {
  it("returns the locked terms for demo-live, no-evidence, and use-case obligations", () => {
    expect(lockedTermsForObligation("demo-live-007")).toEqual({
      recipient: "cynex-agent2.cynexmaster.testnet",
      amount: "100",
    });
    expect(lockedTermsForObligation(DEMO_NOEVIDENCE_ID)).toEqual({
      recipient: "cynex-agent2.cynexmaster.testnet",
      amount: "100",
    });
    expect(lockedTermsForObligation(USECASE_ID)).toEqual({
      recipient: "cynex-agent.cynexmaster.testnet",
      amount: "100",
    });
  });

  it("returns null for an unknown obligation", () => {
    expect(lockedTermsForObligation("demo-live-011")).toBeNull();
    expect(lockedTermsForObligation("nope")).toBeNull();
  });
});

describe("parseDemoAttackResponse, pre-chain failures map to error", () => {
  it("maps METHOD_NOT_ALLOWED, DEMO_KEY_INVALID, CHAIN_UNREADABLE and SCOPE_CHECK_FAILED to error, never unconfirmed", () => {
    for (const code of ["METHOD_NOT_ALLOWED", "DEMO_KEY_INVALID", "CHAIN_UNREADABLE", "SCOPE_CHECK_FAILED"]) {
      const out = parseDemoAttackResponse({ success: false, code, error: "Failed: " + code + "." });
      expect(out.outcome).toBe("error");
    }
  });
});
