/**
 * Tests for the  obligation state display.
 * Every frozen ObligationState must have a label, a meaning, and a
 * next action; unknown states must throw, never render as a guess.
 */
import { describeState, OBLIGATION_STATES } from "./states.js";

describe("describeState", function () {
  test("covers all nine frozen states", function () {
    expect(OBLIGATION_STATES).toHaveLength(9);
    for (const state of OBLIGATION_STATES) {
      const d = describeState(state, false);
      expect(d.state).toBe(state);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.meaning.length).toBeGreaterThan(0);
      expect(d.next.length).toBeGreaterThan(0);
      expect(d.frozenNote).toBeNull();
    }
  });

  test("terminal states are exactly PAID, CANCELLED, BLOCKED", function () {
    const terminal: string[] = [];
    for (const s of OBLIGATION_STATES) {
      if (describeState(s, false).terminal) {
        terminal.push(s);
      }
    }
    expect(terminal.sort()).toEqual(["BLOCKED", "CANCELLED", "PAID"]);
  });

  test("frozen policy adds the frozen note without changing the state", function () {
    const d = describeState("READY", true);
    expect(d.state).toBe("READY");
    expect(d.frozenNote).toContain("frozen");
    expect(d.frozenNote).toContain("in-flight callback");
  });

  test("unknown state throws", function () {
    expect(function () {
      describeState("SETTLED", false);
    }).toThrow("unknown obligation state");
    expect(function () {
      describeState("", false);
    }).toThrow("unknown obligation state");
  });

  test("reconciliation state names the resolution paths", function () {
    const d = describeState("RECONCILIATION_REQUIRED", false);
    expect(d.next).toContain("resolve_settlement");
    expect(d.next).toContain("cancel_obligation");
    expect(d.meaning).toContain("locked");
  });

  test("warning pending names approve_warning to READY", function () {
    const d = describeState("WARN_PENDING", false);
    expect(d.next).toContain("approve_warning");
    expect(d.next).toContain("READY");
    expect(d.terminal).toBe(false);
  });

  test("transfer pending never implies paid", function () {
    const d = describeState("TRANSFER_PENDING", false);
    expect(d.meaning).toContain("Never assume paid");
    expect(d.terminal).toBe(false);
  });
});
