/**
 * Cynex CLI, Phase 1 scaffold plus Phase 2 live verification.
 *
 * Commands:
 *   verify-receipts <receipts.json>
 *     Replays a receipts JSON file from genesis, recomputing each
 *     prev_hash link with the frozen receipt hash formula. A
 *     receipt whose index is out of order, or whose prev_hash
 *     does not match the recomputed previous hash, is reported
 *     as failed and the command exits non-zero. No receipt is
 *     trusted from its own verified_ok field; that field is
 *     output, not input.
 *   verify-live <vaultId>
 *     Reads real receipts through the paginated receipts view
 *     (0, 100 at a time until empty), verifies the same chain,
 *     and prints CSV rows with the frozen cynex-verify columns:
 *     index, prev_hash, obligation_id, recipient, amount,
 *     token_id, timestamp, tx_ref, verified_ok. Exits non-zero
 *     on any chain break. This reads the live chain; it does
 *     not sign, fund, or settle anything.
 */
import { readFileSync } from "node:fs";
import { receiptHash, GENESIS_PREV_HASH } from "../frontend/src/cynex/receipt.js";
import { toHex } from "../frontend/src/cynex/api.js";
import { CynexClient } from "../frontend/src/cynex/client.js";
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

function hexOfPrevHash(value: unknown): string {
  if (typeof value === "string") {
    return value.toLowerCase();
  }
  if (Array.isArray(value)) {
    return toHex(new Uint8Array(value as number[]));
  }
  throw new Error("receipt prev_hash is neither a hex string nor a byte array");
}

function parseLiveReceipt(row: Record<string, unknown>): Receipt {
  return {
    index: BigInt(String(row.index)),
    prev_hash: hexOfPrevHash(row.prev_hash),
    obligation_id: String(row.obligation_id),
    recipient: String(row.recipient),
    amount: BigInt(String(row.amount)),
    token_id: String(row.token_id),
    timestamp: BigInt(String(row.timestamp)),
    tx_ref: String(row.tx_ref ?? ""),
  };
}

export function verifyLiveChain(receipts: Receipt[]): { receipt: Receipt; verified_ok: boolean }[] {
  let prev = GENESIS_PREV_HASH;
  let expected = 0n;
  const out: { receipt: Receipt; verified_ok: boolean }[] = [];
  for (const receipt of receipts) {
    const ok = receipt.index === expected && receipt.prev_hash === prev;
    out.push({ receipt, verified_ok: ok });
    prev = receiptHash(receipt);
    expected += 1n;
  }
  return out;
}

async function verifyLive(vaultId: string): Promise<number> {
  const client = new CynexClient(vaultId);
  const all: Receipt[] = [];
  let start = 0n;
  for (;;) {
    const page = (await client.receipts(start, 100n)) as unknown;
    if (!Array.isArray(page) || page.length === 0) {
      break;
    }
    for (const row of page as Record<string, unknown>[]) {
      all.push(parseLiveReceipt(row));
    }
    start += BigInt(page.length);
    if (page.length < 100) {
      break;
    }
  }
  const results = verifyLiveChain(all);
  console.log("index,prev_hash,obligation_id,recipient,amount,token_id,timestamp,tx_ref,verified_ok");
  for (const r of results) {
    const x = r.receipt;
    console.log(
      [
        x.index.toString(),
        x.prev_hash,
        x.obligation_id,
        x.recipient,
        x.amount.toString(),
        x.token_id,
        x.timestamp.toString(),
        x.tx_ref,
        r.verified_ok,
      ].join(","),
    );
  }
  return results.every((r) => r.verified_ok) ? 0 : 1;
}

function verifyFile(file: string): number {
  const rows = JSON.parse(readFileSync(file, "utf-8")) as ReceiptJson[];
  const results = verifyReceiptChain(rows);
  for (const r of results) {
    console.log(r.index.toString() + " verified_ok=" + r.verified_ok);
  }
  return results.every((r) => r.verified_ok) ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const [command, arg] = argv;
  if (command === "verify-receipts" && arg) {
    return verifyFile(arg);
  }
  if (command === "verify-live" && arg) {
    return verifyLive(arg);
  }
  console.log("usage: cynex verify-receipts <receipts.json>");
  console.log("usage: cynex verify-live <vaultId>");
  return 2;
}

if (import.meta.url === "file://" + process.argv[1]) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
