/**
 * Cynex CLI, Phase 1 scaffold plus Phase 2 live verification plus Phase 3 playground plus Phase 4 budget.
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
 *   playground <vaultId> <obligationId...>
 *     Reads each listed obligation and its policy live from the
 *     contract (no signing, no transactions) and prints the Phase 3
 *     state display for it: label, meaning, next action, and the
 *     frozen note when the policy is frozen. An obligation that is
 *     not found on chain, or a state the display does not know,
 *     fails the command instead of rendering a guess. Amounts in
 *     this output are display only; verify-live and balances are
 *     authoritative for exact amounts. The recommended demo set is
 *     recorded in demo/playground-obligations.json.
 *   budget <vaultId> <policyId>
 *     Reads the policy and its balances live from the contract
 *     (no signing, no transactions) and prints the real per-token
 *     budget and limit, the headroom for new settlements, and the
 *     invariant result. Token units and native NEAR are never mixed:
 *     native headroom is printed separately in yoctoNEAR. A broken
 *     invariant exits non-zero. Token figures must be exact; an
 *     inexact figure fails the command instead of rendering a
 *     rounded budget.
 */
import { readFileSync } from "node:fs";
import { receiptHash, GENESIS_PREV_HASH } from "../frontend/src/cynex/receipt.js";
import { toHex } from "../frontend/src/cynex/api.js";
import { CynexClient, TESTNET_RPC_URL } from "../frontend/src/cynex/client.js";
import { describeState, OBLIGATION_STATES } from "../frontend/src/cynex/states.js";
import { describeBudget, type BalancesRow } from "../frontend/src/cynex/budget.js";
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


/**
 * Parse a raw receipts JSON string with exact u64 values.
 * near-api-js parses JSON with JSON.parse, which rounds
 * u64 timestamps over 2^53 (live receipt timestamp
 * 1793751483012073148 reads back as ...3200). The rounded
 * timestamp recomputes to a different receipt hash, so a
 * second receipt would falsely fail its link check. Quoting
 * the index, amount, and timestamp numbers before parsing
 * keeps them exact as BigInt end to end.
 */
export function parseReceiptsRaw(raw: string): Receipt[] {
  const quoted = raw.replace(/"(index|amount|timestamp)":\s*(-?\d+)/g, "\"$1\":\"$2\"");
  const rows = JSON.parse(quoted) as Record<string, unknown>[];
  return rows.map(parseLiveReceipt);
}

async function fetchReceiptPage(vaultId: string, start: bigint, limit: bigint): Promise<Receipt[]> {
  const argsBase64 = Buffer.from(JSON.stringify({ start: Number(start), limit: Number(limit) })).toString("base64");
  const response = await fetch(TESTNET_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "cynex-verify-live",
      method: "query",
      params: {
        request_type: "call_function",
        account_id: vaultId,
        method_name: "receipts",
        args_base64: argsBase64,
        finality: "final",
      },
    }),
  });
  const data = (await response.json()) as { error?: unknown; result?: { result?: number[] } };
  if (data.error) {
    throw new Error("receipts view failed: " + JSON.stringify(data.error));
  }
  const raw = Buffer.from(data.result?.result ?? []).toString("utf-8");
  return parseReceiptsRaw(raw);
}

async function verifyLive(vaultId: string): Promise<number> {
  const all: Receipt[] = [];
  let start = 0n;
  for (;;) {
    const page = await fetchReceiptPage(vaultId, start, 100n);
    if (page.length === 0) {
      break;
    }
    all.push(...page);
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


async function playground(vaultId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) {
    console.log("usage: cynex playground <vaultId> <obligationId...>");
    return 2;
  }
  const client = new CynexClient(vaultId);
  let failed = false;
  const seen: string[] = [];
  for (const id of ids) {
    const row = (await client.getObligation(id)) as Record<string, unknown> | null;
    if (row === null || row === undefined || typeof row["state"] !== "string") {
      console.log(id + ": not found on chain, no state rendered.");
      failed = true;
      continue;
    }
    const policyId = row["policy_id"];
    if (typeof policyId !== "string") {
      console.log(id + ": obligation row has no policy_id, no state rendered.");
      failed = true;
      continue;
    }
    const policy = (await client.getPolicy(policyId)) as Record<string, unknown> | null;
    if (policy === null || policy === undefined || typeof policy["frozen"] !== "boolean") {
      console.log(id + ": policy row unreadable, no state rendered.");
      failed = true;
      continue;
    }
    let display;
    try {
      display = describeState(row["state"], policy["frozen"]);
    } catch (e) {
      console.log(id + ": unknown state on chain, no state rendered: " + String(e));
      failed = true;
      continue;
    }
    seen.push(display.state);
    console.log(id + ": " + display.state + " - " + display.label + ". " + display.meaning);
    console.log("  recipient: " + String(row["recipient"]) + ", amount: " + String(row["amount"]) + ", policy: " + policyId + ", policy frozen: " + String(policy["frozen"]));
    console.log("  next: " + display.next);
    if (display.frozenNote !== null) {
      console.log("  frozen note: " + display.frozenNote);
    }
  }
  const seenUnique: string[] = [];
  for (const s of seen) {
    if (seenUnique.indexOf(s) === -1) {
      seenUnique.push(s);
    }
  }
  const missing: string[] = [];
  for (const s of OBLIGATION_STATES) {
    if (seenUnique.indexOf(s) === -1) {
      missing.push(s);
    }
  }
  console.log("states seen live in this run: " + (seenUnique.length > 0 ? seenUnique.join(", ") : "none"));
  console.log("states with no live example in this run: " + missing.join(", "));
  return failed ? 1 : 0;
}


async function budget(vaultId: string, policyId: string): Promise<number> {
  const client = new CynexClient(vaultId);
  const policy = (await client.getPolicy(policyId)) as Record<string, unknown> | null;
  if (policy === null || policy === undefined || typeof policy["frozen"] !== "boolean" || typeof policy["token_id"] !== "string") {
    console.log(policyId + ": policy row unreadable, no budget rendered.");
    return 1;
  }
  const balances = (await client.balances(policyId)) as Record<string, unknown> | null;
  if (balances === null || balances === undefined) {
    console.log(policyId + ": balances row unreadable, no budget rendered.");
    return 1;
  }
  let display;
  try {
    display = describeBudget(balances as unknown as BalancesRow);
  } catch (e) {
    console.log(policyId + ": budget figures inexact or unreadable, no budget rendered: " + String(e));
    return 1;
  }
  console.log(policyId + " (" + policy["token_id"] + "), frozen: " + String(policy["frozen"]));
  console.log("  token budget, base units: limit " + display.limit.toString() + ", spent " + display.spent.toString() + ", reserved " + display.reserved.toString() + ", funded " + display.funded.toString());
  console.log("  headroom for new settlements: " + display.headroom.toString());
  console.log("  invariant: " + (display.invariantOk ? "ok" : "BROKEN") + " (" + display.invariantDetail + ")");
  if (display.nativeHeadroom !== null) {
    console.log("  native headroom, yoctoNEAR, separate from token units: " + display.nativeHeadroom.yocto.toString() + (display.nativeHeadroom.exact ? " (exact)" : " (approximate, above JS safe integer range)"));
  } else {
    console.log("  native headroom: not reported by the deployed contract");
  }
  return display.invariantOk ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const [command, arg] = argv;
  if (command === "verify-receipts" && arg) {
    return verifyFile(arg);
  }
  if (command === "verify-live" && arg) {
    return verifyLive(arg);
  }
  if (command === "playground" && arg) {
    return playground(arg, argv.slice(2));
  }
  if (command === "budget" && arg) {
    const budgetPolicyId = argv[2];
    if (budgetPolicyId === undefined) {
      console.log("usage: cynex budget <vaultId> <policyId>");
      return 2;
    }
    return budget(arg, budgetPolicyId);
  }
  console.log("usage: cynex verify-receipts <receipts.json>");
  console.log("usage: cynex verify-live <vaultId>");
  console.log("usage: cynex playground <vaultId> <obligationId...>");
  console.log("usage: cynex budget <vaultId> <policyId>");
  return 2;
}

if (import.meta.url === "file://" + process.argv[1]) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
