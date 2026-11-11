/**
 * Tests for the "Run it live" button logic: the state machine and the
 * response parser in web/src/lib/demoSettle.ts (pure, no React, no
 * network). The component renders these states; this test covers the
 * logic the component runs.
 * Run: NODE_OPTIONS=--experimental-vm-modules npx jest --roots src
 *   ../services --runInBand, from frontend/.
 */
import {
  DEMO_SETTLE_FALLBACK,
  demoButtonCanRun,
  demoButtonReducer,
  initialDemoButtonState,
  parseDemoSettleResponse,
  type DemoButtonState,
  type DemoSettleResult,
} from "../../web/src/lib/demoSettle.js";

function successResult(remaining: number): DemoSettleResult {
  return {
    success: true,
    obligationId: "demo-live-002",
    receiptIndex: 31,
    txHash: "ABCDEF1234",
    recipient: "cynex-agent2.cynexmaster.testnet",
    amount: "100",
    policySpent: "5500",
    remaining,
  };
}

describe("demoButtonReducer", () => {
  test("idle starts a settle and clears any old result", () => {
    const state = demoButtonReducer(initialDemoButtonState, { type: "start" });
    expect(state.status).toBe("loading");
    expect(state.result).toBeNull();
    expect(state.error).toBeNull();
  });

  test("loading ignores a second start, so a double click cannot double settle", () => {
    const loading: DemoButtonState = {
      status: "loading",
      result: null,
      error: null,
      fallback: null,
    };
    expect(demoButtonReducer(loading, { type: "start" })).toBe(loading);
  });

  test("loading moves to success with the receipt kept", () => {
    const loading: DemoButtonState = {
      status: "loading",
      result: null,
      error: null,
      fallback: null,
    };
    const next = demoButtonReducer(loading, {
      type: "succeeded",
      result: successResult(8),
    });
    expect(next.status).toBe("success");
    expect(next.result?.obligationId).toBe("demo-live-002");
    expect(next.result?.receiptIndex).toBe(31);
    expect(next.result?.txHash).toBe("ABCDEF1234");
    expect(next.result?.remaining).toBe(8);
  });

  test("loading moves to error with the message and the fallback", () => {
    const loading: DemoButtonState = {
      status: "loading",
      result: null,
      error: null,
      fallback: null,
    };
    const next = demoButtonReducer(loading, {
      type: "failed",
      error: "The settle failed.",
      fallback: "Try the sandbox.",
    });
    expect(next.status).toBe("error");
    expect(next.error).toBe("The settle failed.");
    expect(next.fallback).toBe("Try the sandbox.");
  });

  test("loading moves to usedUp and the fallback defaults to the sandbox text", () => {
    const loading: DemoButtonState = {
      status: "loading",
      result: null,
      error: null,
      fallback: null,
    };
    const next = demoButtonReducer(loading, {
      type: "usedUp",
      error: "All 10 demo settles are used up.",
    });
    expect(next.status).toBe("usedUp");
    expect(next.fallback).toBe(DEMO_SETTLE_FALLBACK);
  });

  test("usedUp ignores start, the button never runs again", () => {
    const usedUp: DemoButtonState = {
      status: "usedUp",
      result: null,
      error: "All 10 demo settles are used up.",
      fallback: DEMO_SETTLE_FALLBACK,
    };
    expect(demoButtonReducer(usedUp, { type: "start" })).toBe(usedUp);
  });

  test("success starts again, which settles the next READY obligation", () => {
    const done: DemoButtonState = {
      status: "success",
      result: successResult(8),
      error: null,
      fallback: null,
    };
    const next = demoButtonReducer(done, { type: "start" });
    expect(next.status).toBe("loading");
    expect(next.result).toBeNull();
  });

  test("reset returns to idle", () => {
    const done: DemoButtonState = {
      status: "success",
      result: successResult(8),
      error: null,
      fallback: null,
    };
    expect(demoButtonReducer(done, { type: "reset" })).toEqual(
      initialDemoButtonState,
    );
  });
});

describe("demoButtonCanRun", () => {
  test("idle, success, and error can run; loading and usedUp cannot", () => {
    expect(demoButtonCanRun(initialDemoButtonState)).toBe(true);
    expect(
      demoButtonCanRun({
        status: "loading",
        result: null,
        error: null,
        fallback: null,
      }),
    ).toBe(false);
    expect(
      demoButtonCanRun({
        status: "success",
        result: successResult(8),
        error: null,
        fallback: null,
      }),
    ).toBe(true);
    expect(
      demoButtonCanRun({
        status: "error",
        result: null,
        error: "boom",
        fallback: null,
      }),
    ).toBe(true);
    expect(
      demoButtonCanRun({
        status: "usedUp",
        result: null,
        error: "used up",
        fallback: DEMO_SETTLE_FALLBACK,
      }),
    ).toBe(false);
  });

  test("success with no settles left cannot run, and neither can unconfirmed", () => {
    expect(
      demoButtonCanRun({
        status: "success",
        result: successResult(0),
        error: null,
        fallback: null,
      }),
    ).toBe(false);
    expect(
      demoButtonCanRun({
        status: "unconfirmed",
        result: null,
        error: "The settle could not be confirmed on chain.",
        fallback: null,
        txHash: "ABCDEF1234",
        obligationId: "demo-live-002",
      }),
    ).toBe(false);
  });

  test("success with no settles left ignores start, and unconfirmed does too", () => {
    const done: DemoButtonState = {
      status: "success",
      result: successResult(0),
      error: null,
      fallback: null,
    };
    expect(demoButtonReducer(done, { type: "start" })).toBe(done);
    const uncertain: DemoButtonState = {
      status: "unconfirmed",
      result: null,
      error: "The settle could not be confirmed on chain.",
      fallback: null,
      txHash: "ABCDEF1234",
      obligationId: "demo-live-002",
    };
    expect(demoButtonReducer(uncertain, { type: "start" })).toBe(uncertain);
  });
});

describe("parseDemoSettleResponse", () => {
  test("a success body parses with every field", () => {
    const parsed = parseDemoSettleResponse({
      success: true,
      obligationId: "demo-live-002",
      receiptIndex: 31,
      txHash: "ABCDEF1234",
      recipient: "cynex-agent2.cynexmaster.testnet",
      amount: "100",
      policySpent: "5500",
      remaining: 8,
    });
    expect(parsed.outcome).toBe("success");
    if (parsed.outcome === "success") {
      expect(parsed.result.obligationId).toBe("demo-live-002");
      expect(parsed.result.receiptIndex).toBe(31);
      expect(parsed.result.remaining).toBe(8);
    }
  });

  test("a success body without a receipt index is an error, never a proven settle", () => {
    const parsed = parseDemoSettleResponse({
      success: true,
      obligationId: "demo-live-002",
      txHash: "ABCDEF1234",
      recipient: "cynex-agent2.cynexmaster.testnet",
      amount: "100",
      policySpent: "5500",
      remaining: 8,
    });
    expect(parsed.outcome).toBe("error");
    if (parsed.outcome === "error") {
      expect(parsed.error).toMatch(/receipt index/);
    }
  });

  test("a success body with a non-numeric receipt index is an error", () => {
    const parsed = parseDemoSettleResponse({
      success: true,
      obligationId: "demo-live-002",
      receiptIndex: "31",
      txHash: "ABCDEF1234",
    });
    expect(parsed.outcome).toBe("error");
  });

  test("a used-up body is recognised by its code", () => {
    const parsed = parseDemoSettleResponse({
      success: false,
      code: "DEMO_USED_UP",
      error: "All 10 demo settles are used up.",
      fallback: "Run the sandbox instead.",
    });
    expect(parsed.outcome).toBe("usedUp");
    if (parsed.outcome === "usedUp") {
      expect(parsed.fallback).toBe("Run the sandbox instead.");
    }
  });

  test("a used-up body is recognised by its message when the code is missing", () => {
    const parsed = parseDemoSettleResponse({
      success: false,
      error: "All 10 demo settles are used up.",
    });
    expect(parsed.outcome).toBe("usedUp");
    if (parsed.outcome === "usedUp") {
      expect(parsed.fallback).toBe(DEMO_SETTLE_FALLBACK);
    }
  });

  test("a timeout answer parses as unconfirmed, never as an error to retry", () => {
    const parsed = parseDemoSettleResponse({
      success: false,
      code: "SETTLE_TIMEOUT",
      error: "Confirmation timed out.",
      obligationId: "demo-live-002",
      txHash: null,
    });
    expect(parsed.outcome).toBe("unconfirmed");
    if (parsed.outcome === "unconfirmed") {
      expect(parsed.obligationId).toBe("demo-live-002");
    }
  });

  test("an unconfirmed answer parses as unconfirmed with the tx hash kept", () => {
    const parsed = parseDemoSettleResponse({
      success: false,
      code: "SETTLE_UNCONFIRMED",
      error: "The settle could not be confirmed on chain.",
      obligationId: "demo-live-002",
      txHash: "ABCDEF1234",
    });
    expect(parsed.outcome).toBe("unconfirmed");
    if (parsed.outcome === "unconfirmed") {
      expect(parsed.txHash).toBe("ABCDEF1234");
      expect(parsed.obligationId).toBe("demo-live-002");
    }
  });

  test("a plain failure parses as an error with the fallback when present", () => {
    const parsed = parseDemoSettleResponse({
      success: false,
      code: "SETTLE_FAILED",
      error: "The settle failed: ERR_TERMS_MISMATCH.",
      fallback: "Try the sandbox.",
    });
    expect(parsed.outcome).toBe("error");
    if (parsed.outcome === "error") {
      expect(parsed.error).toContain("ERR_TERMS_MISMATCH");
      expect(parsed.fallback).toBe("Try the sandbox.");
    }
  });

  test("a malformed body is an error, never a success", () => {
    expect(parseDemoSettleResponse(null).outcome).toBe("error");
    expect(parseDemoSettleResponse("ok").outcome).toBe("error");
    expect(parseDemoSettleResponse({}).outcome).toBe("error");
    expect(parseDemoSettleResponse({ success: true }).outcome).toBe("error");
  });
});
