/**
 * Cynex CLI scaffold, Phase 1 Lane B.
 *
 * Command: verify-receipts <receipts.json>
 *
 * Replays a receipts JSON file from genesis, recomputing each
 * prev_hash link with the frozen receipt hash formula. A
 * receipt whose recomputed hash does not match its prev_hash
 * chain, or whose index is out of order, is reported as failed
 * and the command exits non-zero. No receipt is trusted from
 * its own verified_ok field; that field is output, not input.
 */
import { readFileSync } from "node:fs";
import { receiptHash, GENESIS_PREV_HASH } from "../frontend/src/cynex/receipt.js";
import type { Receipt } from "../frontend/src/cynex/schema.js";

interface ReceiptJson {
  index: string;
  prev_hash: string;
  obligation_id: string;
  recipient: string;
  amount: string;
  token_id: string;
  timestamp: string;
  tx_ref: string;
}

function parseReceipt(row: ReceiptJson): Receipt {
  return {
    index: BigInt(row.index),
    prev_hash: row.prev_hash,
    obligation_id: row.obligation_id,
    recipient: row.recipient,
    amount: BigInt(row.amount),
    token_id: row.token_id,
    timestamp: BigInt(row.timestamp),
    tx_ref: row.tx_ref,
  };
}

export function verifyReceiptChain(rows: ReceiptJson[]): { index: bigint; verified_ok: boolean }[] {
  let prev = GENESIS_PREV_HASH;
  const out: { index: bigint; verified_ok: boolean }[] = [];
  for (const [i, row] of rows.entries()) {
    const receipt = parseReceipt(row);
    const ok = receipt.index === BigInt(i) && receipt.prev_hash === prev;
    out.push({ index: receipt.index, verified_ok: ok });
    prev = receiptHash(receipt);
  }
  return out;
}

function main(argv: string[]): number {
  const [command, file] = argv;
  if (command !== "verify-receipts" || !file) {
    console.log("usage: cynex verify-receipts <receipts.json>");
    return 2;
  }
  const rows = JSON.parse(readFileSync(file, "utf-8")) as ReceiptJson[];
  const results = verifyReceiptChain(rows);
  for (const r of results) {
    console.log(r.index.toString() + " verified_ok=" + r.verified_ok);
  }
  return results.every((r) => r.verified_ok) ? 0 : 1;
}

if (import.meta.url === "file://" + process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
