/* Tests for the BreakIt free-form evaluation: proposed terms are judged
 * against the authorized terms fixed on chain. The refusal shown is the
 * recorded one from the test vault, not a fresh live attempt. */

import { AUTHORIZED_TERMS } from "../../web/src/lib/data.js";
import { evaluateBreakItForm } from "../../web/src/lib/breakItForm.js";

const agent = AUTHORIZED_TERMS.recipient;

describe("evaluateBreakItForm", () => {
  it("rejects an empty recipient as invalid input", () => {
    const out = evaluateBreakItForm("", "100", "terms");
    expect(out.kind).toBe("invalid");
  });

  it("rejects an empty amount as invalid input", () => {
    const out = evaluateBreakItForm(agent, "", "terms");
    expect(out.kind).toBe("invalid");
  });

  it("rejects a non-numeric amount as invalid input, not a refusal", () => {
    const out = evaluateBreakItForm(agent, "abc", "terms");
    expect(out.kind).toBe("invalid");
    expect(out.code).toBeUndefined();
  });

  it("refuses a changed recipient with the recorded tx", () => {
    const out = evaluateBreakItForm("someone-else.testnet", "100", "terms");
    expect(out.kind).toBe("refused");
    expect(out.code).toBe("ERR_RECIPIENT_SUBSTITUTION");
    expect(out.tx).toBe("EiBHjMBqZfBLZB33H4odbBfskGbVCX1Jor422t5S1cpX");
  });

  it("refuses a changed amount with ERR_TERMS_MISMATCH", () => {
    const out = evaluateBreakItForm(agent, "200", "terms");
    expect(out.kind).toBe("refused");
    expect(out.code).toBe("ERR_TERMS_MISMATCH");
  });

  it("treats 0100 as the same 100 base units, no attack", () => {
    const out = evaluateBreakItForm(agent, "0100", "terms");
    expect(out.kind).toBe("none");
  });

  it("finds no attack when the terms match the authorized terms", () => {
    const out = evaluateBreakItForm(agent, "100", "terms");
    expect(out.kind).toBe("none");
  });

  it("refuses a replay with the consumed nonce", () => {
    const out = evaluateBreakItForm(agent, "100", "replay");
    expect(out.kind).toBe("refused");
    expect(out.code).toBe("ERR_NONCE_ALREADY_CONSUMED");
    expect(out.text).toContain(String(AUTHORIZED_TERMS.nonce));
  });

  it("refuses a settle before evidence with ERR_INVALID_STATE", () => {
    const out = evaluateBreakItForm(agent, "100", "evidence");
    expect(out.kind).toBe("refused");
    expect(out.code).toBe("ERR_INVALID_STATE");
  });
});
