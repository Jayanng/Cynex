/* Unit tests: the evidence-grade contract and the citation ledger invariants.
   If a fact can be rendered without a grade, or a payload can claim a
   historical refusal without a transaction, these tests fail. */

import { describe, it, expect } from "vitest";
import { GRADE_LABEL, GRADE_TITLE, type Grade } from "../src/lib/grades";
import { RECORD, PAYLOADS, event } from "../src/lib/record";
import { shortHash, baseUnits, nsToUtc } from "../src/lib/format";
import claims from "../src/claims.json";

const ALL_GRADES: Grade[] = ["chain-read", "historical", "simulated", "attested", "repo", "errata"];

describe("evidence grade contract", () => {
  it("labels and titles exist for every grade", () => {
    for (const g of ALL_GRADES) {
      expect(GRADE_LABEL[g], `label for ${g}`).toBeTruthy();
      expect(GRADE_TITLE[g], `title for ${g}`).toBeTruthy();
    }
  });

  it("has no grades outside the enum", () => {
    expect(Object.keys(GRADE_LABEL).sort()).toEqual([...ALL_GRADES].sort());
  });
});

describe("citation ledger", () => {
  it("every historical payload cites a real event id", () => {
    for (const p of PAYLOADS) {
      if (p.grade === "historical") {
        expect(p.eventId, `payload ${p.id} needs an event`).toBeTruthy();
        expect(() => event(p.eventId!)).not.toThrow();
      }
    }
  });

  it("every historical payload has a real transaction hash", () => {
    for (const e of claims.events) {
      expect(e.tx, `event ${e.id}`).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    }
  });

  it("refused events all declare an error code", () => {
    for (const e of claims.events) {
      if (e.verdict === "REFUSED") {
        expect(e.errCode, `event ${e.id}`).toMatch(/^ERR_[A-Z_]+$/);
      }
    }
  });

  it("simulated payloads never claim an on-chain event", () => {
    for (const p of PAYLOADS) {
      if (p.grade === "simulated") {
        expect(p.eventId, `payload ${p.id} must not cite an event`).toBeUndefined();
      }
    }
  });

  it("record counts agree with claims.json", () => {
    expect(RECORD.expectedReceipts).toEqual(claims.expectedReceipts);
    expect(RECORD.events.length).toBe(claims.events.length);
    expect(RECORD.attestations.length).toBe(claims.attestations.length);
    expect(RECORD.obligation.amount).toBe("100");
  });

  it("verify commands point at the repo's own tools", () => {
    expect(RECORD.commands.verifyTest).toContain("verify-live");
    expect(RECORD.commands.verifyTest).toContain(RECORD.vaults.test);
    expect(RECORD.commands.verifyProd).toContain(RECORD.vaults.prod);
  });
});

describe("format helpers", () => {
  it("truncates hashes without touching the full value elsewhere", () => {
    const h = "AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S";
    expect(shortHash(h)).toBe("AFYAq8…pa7S");
    expect(shortHash(h).length).toBeLessThan(h.length);
  });

  it("formats base units with 6 decimals", () => {
    expect(baseUnits("100")).toBe("0.0001");
    expect(baseUnits("5400000")).toBe("5.4");
    expect(baseUnits("1000000")).toBe("1");
  });

  it("renders UTC timestamps from nanoseconds", () => {
    const ns = "1794208542703771980";
    expect(nsToUtc(ns)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}Z$/);
  });
});
