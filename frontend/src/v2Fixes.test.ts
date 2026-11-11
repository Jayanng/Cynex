/**
 * Tests for the v2 fix round (reviewers GLM, Argon, DeepSeek, skills check).
 * Pure logic only: the components render these helpers, and the helpers are
 * what Jest can cover without a DOM. Tests named source check assert an
 * invariant on component source, because this suite has no DOM; the rest
 * drive pure functions and assert outputs. Run: NODE_OPTIONS=--experimental-vm-modules
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
import { bytesToHex, receiptHash } from "../../web/src/lib/near.js";
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
    expect(out.text).toMatch(/Nonce 1002 was already consumed by receipt 12/);
    expect(out.text).toContain(String(AUTHORIZED_TERMS.nonce));
  });

  test("remove-evidence mode is a verdict by terms, not an executed settle", () => {
    const out = evaluateBreakItForm(agent, "100", "evidence");
    expect(out.kind).toBe("refused");
    expect(out.code).toBe("ERR_INVALID_STATE");
    expect(out.tx).toBeNull();
    expect(out.text).toMatch(/verdict by terms/i);
    expect(out.text).toMatch(/hypothetical CREATED or EVIDENCE_PENDING/);
    expect(out.text).not.toMatch(/Settle was called/);
    expect(out.note).toMatch(/ERR_NONCE_ALREADY_CONSUMED/);
    expect(out.note).toMatch(/BRXXhezVxYvze3imNHkrShnS8ujUvsShy4f3GtgwpCgQ/);
    expect(out.note).toMatch(/usecase-report-002/);
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

/* Tamper recompute: the fixture is the real receipt 24, usecase-report-002,
 * with every field read live from the test vault
 * cynex-testvault.cynexmaster.testnet on 11 Nov 2026, receipts view, in
 * two separate RPC calls to https://rpc.testnet.fastnear.com with finality
 * final, one with start 24 limit 1 and one with start 25 limit 1, both at
 * block height 277234489, cross checked with start 24 limit 2. The
 * timestamp is a string so the u64 nanosecond value stays exact: JSON
 * numbers would round it. The recomputed hash equals receipt 25 prev_hash
 * as read independently from the chain in the second call, not computed
 * from this fixture: the expected hex below is the hex encoding of the
 * receipt 25 prev_hash byte array read in that call, and the test below
 * asserts that encoding directly. So this test checks the frozen formula
 * against the live record, not just against itself.
 * tx_ref is empty on chain, and that is the live value, not a gap.
 * Callback booked receipts store an empty tx_ref because a NEP-141
 * callback carries no transaction hash (contract/src/lib.rs,
 * append_receipt). The settle transaction hash
 * 2VLL134m83x5fWZLr2qBbPkjJ7gL9YR7V7U9eur7qoVC is the NEAR transaction
 * hash of the settle call, recorded in the project live proof record,
 * not the stored tx_ref field. Putting that hash into tx_ref would
 * recompute to 8ea5de556152c1d3d832e69ec8ae2f2cb4d38faf128bf6cbdb87ec83af40f15f,
 * which does not match receipt 25 prev_hash, so the test below locks
 * that in as a regression guard. */
describe("tamper recompute", () => {
  const receipt = {
    index: 24,
    prev_hash: [180, 82, 185, 45, 183, 104, 94, 5, 63, 18, 183, 87, 4, 59, 22, 232, 214, 14, 55, 162, 161, 236, 78, 30, 173, 1, 58, 228, 42, 104, 241, 43],
    obligation_id: "usecase-report-002",
    recipient: "cynex-agent.cynexmaster.testnet",
    amount: "100",
    token_id: "usdc.fakes.testnet",
    timestamp: "1794147610217529108",
    tx_ref: "",
  };

  /* Receipt 25 prev_hash, read independently from the chain on 11 Nov 2026
   * (receipts view, start 25, limit 1, block 277234489), as raw bytes. */
  const RECEIPT_25_PREV_HASH_BYTES = [43, 98, 221, 20, 193, 97, 112, 40, 17, 149, 96, 180, 205, 9, 152, 75, 98, 162, 129, 169, 10, 212, 225, 76, 221, 242, 99, 8, 149, 22, 59, 23];
  const RECEIPT_25_PREV_HASH_HEX =
    "2b62dd14c1617028119560b4cd09984b62a281a90ad4e14cddf2630895163b17";
  const SETTLE_TX_HASH = "2VLL134m83x5fWZLr2qBbPkjJ7gL9YR7V7U9eur7qoVC";

  test("the frozen formula is deterministic", async () => {
    await expect(receiptHash(receipt)).resolves.toBe(await receiptHash(receipt));
  });

  test("receipt 25 prev_hash bytes read live encode to the expected hex", () => {
    expect(bytesToHex(RECEIPT_25_PREV_HASH_BYTES)).toBe(RECEIPT_25_PREV_HASH_HEX);
  });

  test("recomputing receipt 24 matches receipt 25 prev_hash on chain", async () => {
    await expect(receiptHash(receipt)).resolves.toBe(RECEIPT_25_PREV_HASH_HEX);
  });

  test("receipt 24 tx_ref is empty on chain by design, and the settle tx hash is not the stored tx_ref", async () => {
    expect(receipt.tx_ref).toBe("");
    await expect(
      receiptHash({ ...receipt, tx_ref: SETTLE_TX_HASH }),
    ).resolves.not.toBe(RECEIPT_25_PREV_HASH_HEX);
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

  /* Source check, not a behaviour test: this suite runs in node with no DOM,
     so the no-delay invariant is asserted on the runner source. */
  test("source check: the runner shows the verdict immediately, with no delay", () => {
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

  /* Source check, not a behaviour test: this suite runs in node with no DOM,
     so the call-site invariant is asserted on the component source. */
  test("source check: both call sites use the helper, not Number(BigInt())", () => {
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

  /* Source check, not a behaviour test: this suite runs in node with no DOM,
     so the fallback invariant is asserted on the component source. */
  test("source check: a row without a tx renders a No tx fallback, not a broken chip", () => {
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

/* Final fix round, component invariants that need a DOM to test as behaviour,
 * so they are asserted here as labelled source checks. */
describe("source checks: final fix round", () => {
  test("source check: TamperPanel doVerify cleans up in finally and reports a failed hash", () => {
    const src = readWeb("src/components/TamperPanel.tsx");
    const start = src.indexOf("const doVerify = async () => {");
    const end = src.indexOf("const logClass", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fn = src.slice(start, end);
    expect(fn).toMatch(/try \{/);
    expect(fn).toMatch(/finally \{/);
    expect(fn).toMatch(/setBusy\(false\)/);
    expect(fn).toMatch(/hash recompute failed/);
  });

  test("source check: the header offset follows the measured height, with no hardcoded 64px fallback", () => {
    const app = readWeb("src/App.tsx");
    expect(app).not.toMatch(/useState\(64\)/);
    expect(app).toMatch(/useState<number \| null>\(null\)/);
    expect(app).toMatch(/useLayoutEffect/);
    expect(app).toMatch(/ResizeObserver/);
    expect(readWeb("src/components/LiveDemoButton.tsx")).not.toMatch(/top = 64/);
  });

  test("source check: the expected sentence is replaced by the proven line after success, with no receipt question mark", () => {
    const src = readWeb("src/components/LiveDemoButton.tsx");
    const start = src.indexOf("const expectedBox = () => {");
    const end = src.indexOf("if (variant === \"nav\")", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fn = src.slice(start, end);
    expect(fn).toMatch(/if \(!showUnprovenLine\(state\.status\) && result\)/);
    expect(fn).not.toMatch(/receipt \{result\.receiptIndex \?\? "\?"\}/);
  });
});
