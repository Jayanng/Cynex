/* Tests for the "Run it live" button state machine and response parser.
 * The parser is the contract between /api/demo-settle and the button:
 * a success needs an obligation id, a tx hash, and a numeric receipt
 * index, and anything unconfirmed must never offer a retry. */

import {
  createInFlightGuard,
  DEMO_BUTTON_PROVEN_LINE,
  demoButtonCanRun,
  demoButtonReducer,
  initialDemoButtonState,
  parseDemoSettleResponse,
} from "../../web/src/lib/demoSettle.js";
import type { DemoSettleResult } from "../../web/src/lib/demoSettle.js";

const successResult: DemoSettleResult = {
  success: true,
  obligationId: "demo-live-005",
  receiptIndex: 35,
  txHash: "txhash123",
  recipient: "cynex-agent.cynexmaster.testnet",
  amount: "100",
  policySpent: "5900",
  remaining: 5,
};

describe("parseDemoSettleResponse", () => {
  it("accepts a full success with a numeric receipt index", () => {
    const out = parseDemoSettleResponse({ ...successResult });
    expect(out.outcome).toBe("success");
    if (out.outcome === "success") {
      expect(out.result.receiptIndex).toBe(35);
      expect(out.result.obligationId).toBe("demo-live-005");
    }
  });

  it("rejects a success with a null receipt index as unconfirmed, never a success", () => {
    // B2: the server confirmed PAID but could not read the receipt.
    // The client must not show it as proven, and must not offer a retry.
    const out = parseDemoSettleResponse({ ...successResult, receiptIndex: null });
    expect(out.outcome).toBe("unconfirmed");
  });

  it("rejects a success missing the tx hash as unconfirmed", () => {
    const out = parseDemoSettleResponse({ ...successResult, txHash: null });
    expect(out.outcome).toBe("unconfirmed");
  });

  it("rejects a success missing the obligation id as unconfirmed", () => {
    const out = parseDemoSettleResponse({ ...successResult, obligationId: null });
    expect(out.outcome).toBe("unconfirmed");
  });

  it("maps SETTLE_UNCONFIRMED to unconfirmed with the tx hash kept", () => {
    const out = parseDemoSettleResponse({
      success: false,
      code: "SETTLE_UNCONFIRMED",
      error: "The settle could not be confirmed.",
      txHash: "abc123",
      obligationId: "demo-live-005",
    });
    expect(out.outcome).toBe("unconfirmed");
    if (out.outcome === "unconfirmed") {
      expect(out.txHash).toBe("abc123");
      expect(out.obligationId).toBe("demo-live-005");
    }
  });

  it("maps SETTLE_TIMEOUT to unconfirmed", () => {
    const out = parseDemoSettleResponse({
      success: false,
      code: "SETTLE_TIMEOUT",
      error: "Confirmation timed out.",
    });
    expect(out.outcome).toBe("unconfirmed");
  });

  it("maps DEMO_USED_UP to usedUp with the fallback", () => {
    const out = parseDemoSettleResponse({
      success: false,
      code: "DEMO_USED_UP",
      error: "All 10 demo settles are used up.",
      fallback: "Use the sandbox.",
    });
    expect(out.outcome).toBe("usedUp");
    if (out.outcome === "usedUp") expect(out.fallback).toBe("Use the sandbox.");
  });

  it("treats a malformed body as unconfirmed, never a success", () => {
    expect(parseDemoSettleResponse(null).outcome).toBe("unconfirmed");
    expect(parseDemoSettleResponse("ok").outcome).toBe("unconfirmed");
    expect(parseDemoSettleResponse(42).outcome).toBe("unconfirmed");
  });

  it("treats a plain failure code as an error", () => {
    const out = parseDemoSettleResponse({
      success: false,
      code: "SETTLE_FAILED",
      error: "The settle failed: ERR_TERMS_MISMATCH.",
    });
    expect(out.outcome).toBe("error");
  });
});

describe("demoButtonReducer", () => {
  it("starts loading from idle and keeps the receipt on success", () => {
    const loading = demoButtonReducer(initialDemoButtonState, { type: "start" });
    expect(loading.status).toBe("loading");
    const done = demoButtonReducer(loading, { type: "succeeded", result: successResult });
    expect(done.status).toBe("success");
    expect(done.result?.receiptIndex).toBe(35);
  });

  it("never starts from loading, usedUp, or unconfirmed", () => {
    const loading = demoButtonReducer(initialDemoButtonState, { type: "start" });
    expect(demoButtonReducer(loading, { type: "start" })).toBe(loading);
    const usedUp = demoButtonReducer(initialDemoButtonState, { type: "usedUp", error: "used up" });
    expect(demoButtonReducer(usedUp, { type: "start" })).toBe(usedUp);
    const unconfirmed = demoButtonReducer(initialDemoButtonState, { type: "unconfirmed", error: "unconfirmed" });
    expect(demoButtonReducer(unconfirmed, { type: "start" })).toBe(unconfirmed);
  });

  it("does not start again when the last settle is used up", () => {
    const loading = demoButtonReducer(initialDemoButtonState, { type: "start" });
    const done = demoButtonReducer(loading, {
      type: "succeeded",
      result: { ...successResult, remaining: 0 },
    });
    expect(demoButtonReducer(done, { type: "start" })).toBe(done);
  });

  it("keeps the tx hash and obligation id on unconfirmed", () => {
    const s = demoButtonReducer(initialDemoButtonState, {
      type: "unconfirmed",
      error: "unconfirmed",
      txHash: "abc",
      obligationId: "demo-live-005",
    });
    expect(s.status).toBe("unconfirmed");
    expect(s.txHash).toBe("abc");
    expect(s.obligationId).toBe("demo-live-005");
  });
});

describe("demoButtonCanRun", () => {
  it("runs from idle and error, not from loading, usedUp, or unconfirmed", () => {
    expect(demoButtonCanRun(initialDemoButtonState)).toBe(true);
    const err = demoButtonReducer(initialDemoButtonState, { type: "failed", error: "x" });
    expect(demoButtonCanRun(err)).toBe(true);
    const loading = demoButtonReducer(initialDemoButtonState, { type: "start" });
    expect(demoButtonCanRun(loading)).toBe(false);
    const usedUp = demoButtonReducer(initialDemoButtonState, { type: "usedUp", error: "x" });
    expect(demoButtonCanRun(usedUp)).toBe(false);
    const unconfirmed = demoButtonReducer(initialDemoButtonState, { type: "unconfirmed", error: "x" });
    expect(demoButtonCanRun(unconfirmed)).toBe(false);
  });

  it("runs again after a success while settles remain, not when none remain", () => {
    const loading = demoButtonReducer(initialDemoButtonState, { type: "start" });
    const done = demoButtonReducer(loading, { type: "succeeded", result: successResult });
    expect(demoButtonCanRun(done)).toBe(true);
    const last = demoButtonReducer(loading, {
      type: "succeeded",
      result: { ...successResult, remaining: 0 },
    });
    expect(demoButtonCanRun(last)).toBe(false);
  });
});

describe("DEMO_BUTTON_PROVEN_LINE", () => {
  it("names the real proof: demo-live-008, receipt 38, the live tx", () => {
    expect(DEMO_BUTTON_PROVEN_LINE).toContain("demo-live-008");
    expect(DEMO_BUTTON_PROVEN_LINE).toContain("receipt 38");
    expect(DEMO_BUTTON_PROVEN_LINE).toContain("BgvVNfX7CL2FoqR9dS6HLjdHRgedKXfsAUeLp2jhLvM2");
    expect(DEMO_BUTTON_PROVEN_LINE).toContain("277403330");
  });
});

describe("parseDemoSettleResponse, unconfirmed contract", () => {
  it("maps a malformed body to unconfirmed, never a retryable error", () => {
    const out = parseDemoSettleResponse(null);
    expect(out.outcome).toBe("unconfirmed");
    const out2 = parseDemoSettleResponse("<html>error</html>");
    expect(out2.outcome).toBe("unconfirmed");
  });

  it("maps a success missing the receipt index to unconfirmed, keeping the tx hash", () => {
    const out = parseDemoSettleResponse({
      success: true,
      obligationId: "demo-live-005",
      txHash: "txhash123",
      receiptIndex: null,
    });
    expect(out.outcome).toBe("unconfirmed");
    if (out.outcome === "unconfirmed") {
      expect(out.txHash).toBe("txhash123");
      expect(out.obligationId).toBe("demo-live-005");
    }
  });

  it("maps an unrecognized code to unconfirmed, not a retryable error", () => {
    const out = parseDemoSettleResponse({
      success: false,
      code: "SOMETHING_NEW",
      error: "Something unexpected happened.",
    });
    expect(out.outcome).toBe("unconfirmed");
  });

  it("maps a definitive whitelisted refusal to a retryable error", () => {
    const out = parseDemoSettleResponse({
      success: false,
      code: "SETTLE_FAILED",
      error: "The settle failed: ERR_TERMS_MISMATCH.",
    });
    expect(out.outcome).toBe("error");
  });

  it("maps a transport ERR_ code to unconfirmed, not a failure", () => {
    // ERR_SOCKET_CLOSED is a Node transport error, not a contract
    // refusal. It must not be treated as a definitive failure.
    const out = parseDemoSettleResponse({
      success: false,
      code: "SETTLE_FAILED",
      error: "socket hang up: ERR_SOCKET_CLOSED",
    });
    expect(out.outcome).toBe("unconfirmed");
  });

  it("maps DEMO_NOT_CONFIGURED to a retryable error, since no settle could have happened", () => {
    const out = parseDemoSettleResponse({
      success: false,
      code: "DEMO_NOT_CONFIGURED",
      error: "The demo key is missing on the server.",
    });
    expect(out.outcome).toBe("error");
  });
});

describe("demoButtonReducer, reset guard", () => {
  it("does not reset an unconfirmed state to idle", () => {
    const unconfirmed = demoButtonReducer(initialDemoButtonState, {
      type: "unconfirmed",
      error: "unconfirmed",
      txHash: "abc",
      obligationId: "demo-live-005",
    });
    expect(demoButtonReducer(unconfirmed, { type: "reset" })).toBe(unconfirmed);
    expect(demoButtonCanRun(unconfirmed)).toBe(false);
  });

  it("resets an error state to idle so a retry is offered", () => {
    const err = demoButtonReducer(initialDemoButtonState, { type: "failed", error: "x" });
    const reset = demoButtonReducer(err, { type: "reset" });
    expect(reset.status).toBe("idle");
    expect(demoButtonCanRun(reset)).toBe(true);
  });
});

describe("settleErrorCode whitelist", () => {
  it("accepts the eleven settle error codes and rejects transport codes", async () => {
    const client = await import("../../web/src/lib/demoSettle.js");
    const server = await import("../../web/api/demo-settle.js");
    expect([...client.SETTLE_ERROR_CODES].sort()).toEqual(
      [...server.SETTLE_ERROR_CODES].sort(),
    );
    expect(client.SETTLE_ERROR_CODES.size).toBe(11);
    expect(client.settleErrorCode("The settle failed: ERR_TERMS_MISMATCH.")).toBe(
      "ERR_TERMS_MISMATCH",
    );
    expect(client.settleErrorCode("socket hang up: ERR_SOCKET_CLOSED")).toBeNull();
    expect(client.settleErrorCode("no code here")).toBeNull();
  });
});

describe("demoButtonReducer, exhausted-success reset guard", () => {
  it("does not reset a success with zero remaining to idle", () => {
    const loading = demoButtonReducer(initialDemoButtonState, { type: "start" });
    const exhausted = demoButtonReducer(loading, {
      type: "succeeded",
      result: { ...successResult, remaining: 0 },
    });
    expect(exhausted.status).toBe("success");
    expect(demoButtonReducer(exhausted, { type: "reset" })).toBe(exhausted);
    expect(demoButtonCanRun(exhausted)).toBe(false);
  });

  it("still resets a success with remaining obligations to idle", () => {
    const loading = demoButtonReducer(initialDemoButtonState, { type: "start" });
    const done = demoButtonReducer(loading, { type: "succeeded", result: successResult });
    expect(done.status).toBe("success");
    const reset = demoButtonReducer(done, { type: "reset" });
    expect(reset.status).toBe("idle");
    expect(demoButtonCanRun(reset)).toBe(true);
  });
});

describe("parseDemoSettleResponse, empty strings", () => {
  it("maps a success with an empty obligation id or tx hash to unconfirmed", () => {
    const emptyId = parseDemoSettleResponse({ ...successResult, obligationId: "" });
    expect(emptyId.outcome).toBe("unconfirmed");
    const emptyTx = parseDemoSettleResponse({ ...successResult, txHash: "" });
    expect(emptyTx.outcome).toBe("unconfirmed");
  });
});

describe("createInFlightGuard", () => {
  it("allows the first acquire and blocks a second until release", () => {
    const g = createInFlightGuard();
    expect(g.tryAcquire()).toBe(true);
    expect(g.tryAcquire()).toBe(false);
    g.release();
    expect(g.tryAcquire()).toBe(true);
  });
});
