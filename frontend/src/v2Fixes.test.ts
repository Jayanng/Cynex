/**
 * Tests for the v2 fix round (reviewers GLM, Argon, DeepSeek, skills check).
 * Pure logic only: the components render these helpers, and the helpers are
 * what Jest can cover without a DOM. Run: NODE_OPTIONS=--experimental-vm-modules
 * npx jest --roots src ../services --runInBand, from frontend/.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateBreakItForm } from "../../web/src/lib/breakItForm.js";
import {
  AGENT,
  ATTACKS,
  AUTHORIZED_TERMS,
  USECASE,
} from "../../web/src/lib/data.js";
import {
  DEMO_BUTTON_UNPROVEN_LINE,
  showUnprovenLine,
} from "../../web/src/lib/demoSettle.js";
import { receiptHash } from "../../web/src/lib/near.js";
import { policySpentPct } from "../../web/src/lib/policyPct.js";
import { normalizeTamperAmount } from "../../web/src/lib/tamperAmount.js";

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../web",
);

function readWeb(rel: string): string {
  return readFileSync(path.join(webRoot, rel), "utf8");
}

/* The authorized terms are one source: the form, the line, and the grid read them. */
describe("AUTHORIZED_TERMS", () => {
  test("names the p10-demo-attack-001 terms", () => {
    expect(AUTHORIZED_TERMS.obligation).toBe("p10-demo-attack-001");
    expect(AUTHORIZED_TERMS.recipient).toBe(AGENT);
    expect(AUTHORIZED_TERMS.recipient).toBe("cynex-agent.cynexmaster.testnet");
    expect(AUTHORIZED_TERMS.amount).toBe("100");
    expect(AUTHORIZED_TERMS.nonce).toBe(1002);
  });
});

/* BreakIt form logic: D1 empty input, D2 replay and remove-evidence buttons. */
describe("evaluateBreakItForm", () => {
  const agent = "cynex-agent.cynexmaster.testnet";

  test("empty recipient is invalid, not no attack", () => {
    const out = evaluateBreakItForm("", "100", "terms");
    expect(out.kind).toBe("invalid");
    expect(out.text).toMatch(/recipient/i);
  });

  test("whitespace-only recipient and amount are invalid", () => {
    expect(evaluateBreakItForm("   ", "100", "terms").kind).toBe("invalid");
    expect(evaluateBreakItForm(agent, "   ", "terms").kind).toBe("invalid");
  });

  test("empty amount is invalid, not no attack", () => {
    const out = evaluateBreakItForm(agent, "", "terms");
    expect(out.kind).toBe("invalid");
    expect(out.text).toMatch(/amount/i);
  });

  test("non-numeric amount is invalid, not a refusal", () => {
    const out = evaluateBreakItForm(agent, "abc", "terms");
    expect(out.kind).toBe("invalid");
    expect(out.code).toBeUndefined();
  });

  test("changed recipient is refused with the recorded tx", () => {
    const out = evaluateBreakItForm("attacker.testnet", "100", "terms");
    expect(out.kind).toBe("refused");
    expect(out.code).toBe("ERR_RECIPIENT_SUBSTITUTION");
    expect(out.tx).toBe("AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S");
  });

  test("changed amount is refused with the recorded tx", () => {
    const out = evaluateBreakItForm(agent, "200", "terms");
    expect(out.kind).toBe("refused");
    expect(out.code).toBe("ERR_TERMS_MISMATCH");
    expect(out.tx).toBe("43YaxJVggxuZ3E25WfjzkgGBsGAqLrj8nwdUU9RLAQRy");
  });

  test("recipient mismatch wins when both fields are wrong", () => {
    const out = evaluateBreakItForm("attacker.testnet", "200", "terms");
    expect(out.code).toBe("ERR_RECIPIENT_SUBSTITUTION");
  });

  test("0100 is the same 100 base units, no attack", () => {
    expect(evaluateBreakItForm(agent, "0100", "terms").kind).toBe("none");
  });

  test("authorized terms are no attack", () => {
    const out = evaluateBreakItForm(agent, "100", "terms");
    expect(out.kind).toBe("none");
    expect(out.text).toMatch(/No attack detected/);
  });

  test("replay mode refuses on the consumed nonce, with authorized fields", () => {
    const out = evaluateBreakItForm(agent, "100", "replay");
    expect(out.kind).toBe("refused");
    expect(out.code).toBe("ERR_NONCE_ALREADY_CONSUMED");
    expect(out.tx).toBe("AwzQS7XsuGSYnPmvd5jFJzPDs3WDc2gRgSbW3smWq1Cs");
  });

  test("remove-evidence mode refuses before evidence, with no tx invented", () => {
    const out = evaluateBreakItForm(agent, "100", "evidence");
    expect(out.kind).toBe("refused");
    expect(out.code).toBe("ERR_INVALID_STATE");
    expect(out.tx).toBeNull();
    expect(out.note).toMatch(/no executed refusal transaction exists/i);
  });
});

/* TamperPanel custom amount: validation, normalization, and recompute. */
describe("normalizeTamperAmount", () => {
  test("accepts whole numbers and normalizes through BigInt", () => {
    expect(normalizeTamperAmount("200")).toBe("200");
    expect(normalizeTamperAmount("0100")).toBe("100");
    expect(normalizeTamperAmount("  500  ")).toBe("500");
  });

  test("rejects empty, decimal, negative, and non-numeric input", () => {
    expect(normalizeTamperAmount("")).toBeNull();
    expect(normalizeTamperAmount("10.5")).toBeNull();
    expect(normalizeTamperAmount("-5")).toBeNull();
    expect(normalizeTamperAmount("abc")).toBeNull();
  });
});

describe("tamper recompute", () => {
  const receipt = {
    index: 2,
    prev_hash: new Array(32).fill(0),
    obligation_id: "usecase-report-002",
    recipient: "cynex-agent.cynexmaster.testnet",
    amount: "100",
    token_id: "usdc.fakes.testnet",
    timestamp: "1794166153578831400",
    tx_ref: "2VLL134m83x5fWZLr2qBbPkjJ7gL9YR7V7U9eur7qoVC",
  };

  test("the frozen formula is deterministic", async () => {
    await expect(receiptHash(receipt)).resolves.toBe(await receiptHash(receipt));
  });

  test("changing the amount changes the recomputed hash", async () => {
    const before = await receiptHash(receipt);
    const after = await receiptHash({ ...receipt, amount: "200" });
    expect(after).not.toBe(before);
  });
});

/* Six-ways runner: verdicts render immediately from data, labelled recorded. */
describe("six-ways runner", () => {
  test("six attacks, first three executed with a tx, last three verdict by terms", () => {
    expect(ATTACKS).toHaveLength(6);
    expect(ATTACKS.map((a) => a.code)).toEqual([
      "ERR_RECIPIENT_SUBSTITUTION",
      "ERR_TERMS_MISMATCH",
      "ERR_NONCE_ALREADY_CONSUMED",
      "ERR_BUDGET_EXCEEDED",
      "ERR_OBLIGATION_EXPIRED",
      "ERR_POLICY_FROZEN",
    ]);
    expect(ATTACKS.slice(0, 3).every((a) => a.tx !== null)).toBe(true);
    expect(ATTACKS.slice(3).every((a) => a.tx === null)).toBe(true);
  });

  test("the runner shows the verdict immediately, with no delay", () => {
    const src = readWeb("src/pages/Attack.tsx");
    const start = src.indexOf("function AttackRunner()");
    const end = src.indexOf("/* ---------- playground", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const runner = src.slice(start, end);
    expect(runner).not.toMatch(/setTimeout/);
    expect(runner).toMatch(/Recorded verdict, shown immediately\. No fake delay\./);
  });
});

/* Honest unproven label on the Run it live button: D3. */
describe("demo button unproven line", () => {
  test("the line states the button is not yet proven live", () => {
    expect(DEMO_BUTTON_UNPROVEN_LINE).toMatch(/Not yet proven live/);
    expect(DEMO_BUTTON_UNPROVEN_LINE).toMatch(/preview deployment cannot see the demo key/);
  });

  test("the line shows in every state except success", () => {
    expect(showUnprovenLine("idle")).toBe(true);
    expect(showUnprovenLine("loading")).toBe(true);
    expect(showUnprovenLine("error")).toBe(true);
    expect(showUnprovenLine("unconfirmed")).toBe(true);
    expect(showUnprovenLine("usedUp")).toBe(true);
    expect(showUnprovenLine("success")).toBe(false);
  });
});

/* Strip and GateBudget read live numbers: the percentage is BigInt math. */
describe("policySpentPct", () => {
  test("live values from the 11 Nov read", () => {
    expect(policySpentPct(5400, 10000)).toBe(54);
    expect(policySpentPct(500, 1000)).toBe(50);
    expect(policySpentPct("2700", "10000")).toBe(27);
  });

  test("edges: empty, full, and a zero limit", () => {
    expect(policySpentPct(0, 10000)).toBe(0);
    expect(policySpentPct(10000, 10000)).toBe(100);
    expect(policySpentPct(5400, 0)).toBeNull();
  });

  test("u128 extremes do not lose precision through Number", () => {
    const max = "340282366920938463463374607431768211455";
    expect(policySpentPct(max, max)).toBe(100);
    expect(policySpentPct("123456789012345678901234567890", "1234567890123456789012345678900")).toBe(10);
    expect(policySpentPct("not-a-number", 10000)).toBeNull();
  });

  test("both call sites use the helper, not Number(BigInt())", () => {
    expect(readWeb("src/components/Strip.tsx")).toMatch(/policySpentPct\(p\.spent, p\.limit\)/);
    expect(readWeb("src/pages/Attack.tsx")).toMatch(/policySpentPct\(p\.spent, p\.limit\)/);
    expect(readWeb("src/components/Strip.tsx")).not.toMatch(/Number\(BigInt\(/);
    expect(readWeb("src/pages/Attack.tsx")).not.toMatch(/Number\(BigInt\(/);
  });
});

/* RefusalBreakdown: exactly the four receipt 24 refusals, with a No tx fallback. */
describe("RefusalBreakdown rows", () => {
  test("four non-PAID rows with the recorded txs", () => {
    const rows = USECASE.attacks.filter((a) => a.code !== "PAID");
    expect(rows).toHaveLength(4);
    expect(rows.map((a) => a.code)).toEqual([
      "ERR_INVALID_STATE",
      "ERR_RECIPIENT_SUBSTITUTION",
      "ERR_TERMS_MISMATCH",
      "ERR_NONCE_ALREADY_CONSUMED",
    ]);
    expect(rows.map((a) => a.tx)).toEqual([
      "BRXXhezVxYvze3imNHkrShnS8ujUvsShy4f3GtgwpCgQ",
      "EiBHjMBqZfBLZB33H4odbBfskGbVCX1Jor422t5S1cpX",
      "2NaWqCYiUnh9DMhRCR6JVSDQ3R7yD26U8Auf3qEer91f",
      "hG6uhpePR9ZcvCZXZprpXa8rvbAGGQPxD4ZyMpP91F6",
    ]);
  });

  test("a row without a tx renders a No tx fallback, not a broken chip", () => {
    const src = readWeb("src/components/shared.tsx");
    const start = src.indexOf("export function RefusalBreakdown");
    const end = src.indexOf("/* ---------- refusal card", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fn = src.slice(start, end);
    expect(fn).toMatch(/a\.tx \? \(/);
    expect(fn).toMatch(/No tx/);
  });
});
