/**
 * cynex-verify tests. The chain check is the
 * frozen receipt hash: each receipt's
 * prev_hash must equal the recomputed hash of the previous
 * receipt, and the index must be the next one. A tamper in a
 * receipt is therefore detected at the NEXT receipt, whose
 * prev_hash no longer matches the recomputed hash of the
 * tampered row. The last receipt has no next row, so in file
 * mode a tamper there is reported unanchored, not verified;
 * live mode anchors it against state() last_receipt_hash
 * (audit finding 6-1), so a tampered final receipt fails
 * there. That boundary is documented here, not hidden.
 *
 * Receipts carry no evidence_type, so the chain check and the
 * CSV cover PREIMAGE and TEE settlements exactly like the
 * verifier path; the last test proves it with the real
 *  proof obligation ids.
 */
import { GENESIS_PREV_HASH, receiptHash } from "../../frontend/src/cynex/receipt.js";
import type { Receipt } from "../../frontend/src/cynex/schema.js";
import {
  CSV_COLUMNS,
  assertReceiptCount,
  parseVaultState,
  toCsvRows,
  verifyLiveChain,
  verifyReceiptChain,
} from "../../cli/cynex.js";

function makeReceipt(
  index: bigint,
  prevHash: string,
  obligationId: string,
  amount: bigint,
): Receipt {
  return {
    index,
    prev_hash: prevHash,
    obligation_id: obligationId,
    recipient: "cynex-agent.cynexmaster.testnet",
    amount,
    token_id: "usdc.fakes.testnet",
    timestamp: 1793943022611540000n,
    tx_ref: "tx-" + index.toString(),
  };
}

function makeChain(ids: string[]): Receipt[] {
  const out: Receipt[] = [];
  let prev = GENESIS_PREV_HASH;
  for (let i = 0; i < ids.length; i++) {
    const receipt = makeReceipt(BigInt(i), prev, ids[i], 100n + BigInt(i));
    out.push(receipt);
    prev = receiptHash(receipt);
  }
  return out;
}

function toFileRows(receipts: Receipt[]): {
  index: string;
  prev_hash: string;
  obligation_id: string;
  recipient: string;
  amount: string;
  token_id: string;
  timestamp: string;
  tx_ref: string;
}[] {
  return receipts.map((r) => ({
    index: r.index.toString(),
    prev_hash: r.prev_hash,
    obligation_id: r.obligation_id,
    recipient: r.recipient,
    amount: r.amount.toString(),
    token_id: r.token_id,
    timestamp: r.timestamp.toString(),
    tx_ref: r.tx_ref,
  }));
}

describe("cynex-verify chain", () => {
  test("a correct chain verifies every row", () => {
    const chain = makeChain(["obl-a", "obl-b", "obl-c"]);
    const results = verifyLiveChain(chain);
    expect(results.map((r) => r.verified_ok)).toEqual([true, true, true]);
    expect(results.map((r) => r.receipt.obligation_id)).toEqual(["obl-a", "obl-b", "obl-c"]);
  });

  test("a tampered middle receipt is detected at the next receipt", () => {
    const chain = makeChain(["obl-a", "obl-b", "obl-c"]);
    const tampered = chain.map((r) => ({ ...r }));
    tampered[1] = { ...tampered[1], amount: 999n };
    const results = verifyLiveChain(tampered);
    // Receipt 1 still passes its own link check (its prev_hash
    // matches the hash of receipt 0); the tamper breaks the link
    // into receipt 2, which no longer matches the recomputed
    // hash of the tampered receipt 1.
    expect(results.map((r) => r.verified_ok)).toEqual([true, true, false]);
  });

  test("a tampered last receipt is not anchored until the next receipt arrives", () => {
    const chain = makeChain(["obl-a", "obl-b", "obl-c"]);
    const tampered = chain.map((r) => ({ ...r }));
    tampered[2] = { ...tampered[2], amount: 999n };
    const results = verifyLiveChain(tampered);
    // No next receipt exists to anchor receipt 2, so the link
    // checks pass. This is the hash-chain tip property, not a
    // missed detection: the tamper is caught as soon as the
    // next receipt is appended.
    expect(results.map((r) => r.verified_ok)).toEqual([true, true, true]);
  });

  test("an index gap is detected", () => {
    const chain = makeChain(["obl-a", "obl-b", "obl-c"]);
    const gapped = chain.map((r) => ({ ...r }));
    gapped[1] = { ...gapped[1], index: 5n };
    const results = verifyLiveChain(gapped);
    expect(results.map((r) => r.verified_ok)).toEqual([true, false, false]);
  });

  test("a wrong prev_hash is detected", () => {
    const chain = makeChain(["obl-a", "obl-b", "obl-c"]);
    const wrong = chain.map((r) => ({ ...r }));
    wrong[1] = { ...wrong[1], prev_hash: "11".repeat(32) };
    const results = verifyLiveChain(wrong);
    expect(results.map((r) => r.verified_ok)).toEqual([true, false, false]);
  });

  test("the file replay detects the same tamper", () => {
    const chain = makeChain(["obl-a", "obl-b", "obl-c"]);
    const tampered = chain.map((r) => ({ ...r }));
    tampered[1] = { ...tampered[1], amount: 999n };
    const results = verifyReceiptChain(toFileRows(tampered));
    expect(results.map((r) => r.verified_ok)).toEqual([true, true, false]);
  });
});

describe("cynex-verify --csv", () => {
  test("the header is exactly the frozen columns", () => {
    expect(CSV_COLUMNS).toBe(
      "index,prev_hash,obligation_id,recipient,amount,token_id,timestamp,tx_ref,verified_ok",
    );
  });

  test("rows render the frozen columns with the recomputed verdict", () => {
    const chain = makeChain(["obl-a", "obl-b"]);
    const lines = toCsvRows(verifyLiveChain(chain));
    expect(lines[0]).toBe(CSV_COLUMNS);
    expect(lines[1]).toMatch(/^0,00+?,obl-a,cynex-agent\.cynexmaster\.testnet,100,usdc\.fakes\.testnet,1793943022611540000,tx-0,true$/);
    expect(lines[2]).toMatch(/,obl-b,cynex-agent\.cynexmaster\.testnet,101,usdc\.fakes\.testnet,1793943022611540000,tx-1,true$/);
  });

  test("a tampered row renders verified_ok=false in the CSV", () => {
    const chain = makeChain(["obl-a", "obl-b", "obl-c"]);
    const tampered = chain.map((r) => ({ ...r }));
    tampered[1] = { ...tampered[1], amount: 999n };
    const lines = toCsvRows(verifyLiveChain(tampered));
    expect(lines[3]).toMatch(/,false$/);
  });

  test("the CSV covers PREIMAGE and TEE proof obligations", () => {
    const chain = makeChain([
      "p9-prod-preimage-001",
      "p9-prod-tee-001",
      "p9-prod-preimage-002",
    ]);
    const lines = toCsvRows(verifyLiveChain(chain));
    expect(lines[1]).toContain("p9-prod-preimage-001");
    expect(lines[2]).toContain("p9-prod-tee-001");
    expect(lines[3]).toContain("p9-prod-preimage-002");
    expect(lines.slice(1).every((line) => line.endsWith(",true"))).toBe(true);
  });
});

describe("cynex-verify last-receipt anchor (audit finding 6-1)", () => {
  function anchorOf(chain: Receipt[]): string {
    return receiptHash(chain[chain.length - 1] as Receipt);
  }

  test("a correct chain anchored to state() verifies every row", () => {
    const chain = makeChain(["obl-a", "obl-b", "obl-c"]);
    const results = verifyLiveChain(chain, anchorOf(chain));
    expect(results.map((r) => r.verified_ok)).toEqual([true, true, true]);
    expect(results.map((r) => r.anchored)).toEqual([true, true, true]);
  });

  test("a tampered final receipt fails against the state() anchor", () => {
    const chain = makeChain(["obl-a", "obl-b", "obl-c"]);
    const anchor = anchorOf(chain);
    const tampered = chain.map((r) => ({ ...r }));
    tampered[2] = { ...tampered[2], amount: 999n };
    const results = verifyLiveChain(tampered, anchor);
    expect(results.map((r) => r.verified_ok)).toEqual([true, true, false]);
    expect(results.map((r) => r.anchored)).toEqual([true, true, false]);
  });

  test("a wrong anchor fails the final receipt even on an untampered chain", () => {
    const chain = makeChain(["obl-a", "obl-b", "obl-c"]);
    const results = verifyLiveChain(chain, "11".repeat(32));
    expect(results.map((r) => r.verified_ok)).toEqual([true, true, false]);
    expect(results.map((r) => r.anchored)).toEqual([true, true, false]);
  });

  test("without an anchor the final receipt is reported unanchored, not anchor-verified", () => {
    const chain = makeChain(["obl-a", "obl-b", "obl-c"]);
    const results = verifyLiveChain(chain);
    expect(results.map((r) => r.verified_ok)).toEqual([true, true, true]);
    expect(results.map((r) => r.anchored)).toEqual([true, true, false]);
  });

  test("a single-receipt chain is unanchored without state(), anchored with it", () => {
    const chain = makeChain(["obl-a"]);
    expect(verifyLiveChain(chain).map((r) => r.anchored)).toEqual([false]);
    expect(
      verifyLiveChain(chain, anchorOf(chain)).map((r) => r.verified_ok),
    ).toEqual([true]);
    expect(
      verifyLiveChain(chain, anchorOf(chain)).map((r) => r.anchored),
    ).toEqual([true]);
  });

  test("the file replay marks its final receipt unanchored", () => {
    const chain = makeChain(["obl-a", "obl-b", "obl-c"]);
    const results = verifyReceiptChain(toFileRows(chain));
    expect(results.map((r) => r.verified_ok)).toEqual([true, true, true]);
    expect(results.map((r) => r.anchored)).toEqual([true, true, false]);
    const tampered = chain.map((r) => ({ ...r }));
    tampered[2] = { ...tampered[2], amount: 999n };
    const tamperedResults = verifyReceiptChain(toFileRows(tampered));
    expect(tamperedResults[2]?.verified_ok).toBe(true);
    expect(tamperedResults[2]?.anchored).toBe(false);
  });

  test("an empty chain has no rows to anchor", () => {
    expect(verifyLiveChain([])).toEqual([]);
    expect(verifyReceiptChain([])).toEqual([]);
  });
});

describe("assertReceiptCount", () => {
  test("a complete read matches state() receipt_index", () => {
    const chain = makeChain(["obl-a", "obl-b", "obl-c"]);
    expect(() => assertReceiptCount(chain, 3n)).not.toThrow();
    expect(() => assertReceiptCount([], 0n)).not.toThrow();
  });

  test("an empty or short read against a non-empty state throws", () => {
    const chain = makeChain(["obl-a", "obl-b", "obl-c"]);
    expect(() => assertReceiptCount([], 3n)).toThrow(
      "does not match state() receipt_index",
    );
    expect(() => assertReceiptCount(chain, 2n)).toThrow(
      "does not match state() receipt_index",
    );
    expect(() => assertReceiptCount(chain, 4n)).toThrow(
      "does not match state() receipt_index",
    );
  });
});

describe("parseVaultState", () => {
  test("a state() tuple decodes owner, receipt index, and last receipt hash", () => {
    const hash = receiptHash(makeChain(["obl-a"])[0] as Receipt);
    const bytes = Array.from(Buffer.from(hash, "hex"));
    const parsed = parseVaultState([
      "cynex-testvault.cynexmaster.testnet",
      1,
      bytes,
    ]);
    expect(parsed.owner).toBe("cynex-testvault.cynexmaster.testnet");
    expect(parsed.receiptIndex).toBe(1n);
    expect(parsed.lastReceiptHash).toBe(hash);
    const parsedFromStringIndex = parseVaultState([
      "cynex-testvault.cynexmaster.testnet",
      "1",
      bytes,
    ]);
    expect(parsedFromStringIndex.receiptIndex).toBe(1n);
    expect(parsedFromStringIndex.lastReceiptHash).toBe(hash);
  });

  test("a malformed state() value throws instead of verifying against a guess", () => {
    const badValues: unknown[] = [
      null,
      "x",
      [],
      ["owner"],
      ["owner", 1],
      ["owner", 1, [0]],
      ["owner", 1, Array(31).fill(0)],
      ["owner", 1, Array(32).fill(256)],
    ];
    for (const bad of badValues) {
      expect(() => parseVaultState(bad)).toThrow();
    }
  });
});
