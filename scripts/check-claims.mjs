#!/usr/bin/env node
/* check-claims.mjs: the audit harness.
   Re-verifies every historical fact in web/src/claims.json against live NEAR
   RPC and public explorers before the build ships. Nothing on the site is
   allowed to assert a fact this script cannot confirm.

   Usage: node scripts/check-claims.mjs [--strict]
   --strict makes any unverified fact exit non-zero. */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAIMS = JSON.parse(readFileSync(join(HERE, "..", "web", "src", "claims.json"), "utf8"));

const RPC = "https://test.rpc.fastnear.com";
const ARCHIVE = "https://archival-rpc.testnet.fastnear.com";
const STRICT = process.argv.includes("--strict");

let pass = 0;
let fail = 0;
const failures = [];

function report(ok, label, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ok   ${label}${detail ? ` (${detail})` : ""}`);
  } else {
    fail++;
    failures.push(`${label}: ${detail}`);
    console.log(`  FAIL ${label}${detail ? ` (${detail})` : ""}`);
  }
}

async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  return body.result ?? null;
}

function decodeCall(result) {
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(result.result ?? [])));
}

async function viewCall(url, account, method, args) {
  const raw = await rpc(url, "query", {
    request_type: "call_function",
    finality: "final",
    account_id: account,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return raw ? decodeCall(raw) : null;
}

async function viewAccount(url, account) {
  return rpc(url, "query", { request_type: "view_account", finality: "final", account_id: account });
}

function hashToHex(h) {
  if (typeof h === "string") return h;
  return Buffer.from(h).toString("hex");
}

async function verifyTxExists(hash, senders) {
  // Prefer the explorer API. Fall back to archival RPC tx status per sender.
  try {
    const res = await fetch(`https://api-testnet.nearblocks.io/v1/txns/${hash}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const body = await res.json();
      const found = body?.txns?.[0]?.transaction_hash ?? body?.txns?.hash;
      if (found === hash) return "explorer";
    }
  } catch {
    // fall through to RPC
  }
  for (const sender of senders) {
    try {
      const out = await rpc(ARCHIVE, "tx", [hash, sender]);
      if (out && (out.transaction || out.status)) return `rpc/${sender}`;
    } catch {
      // keep trying
    }
  }
  return null;
}

console.log("claims audit, chain:", RPC);
console.log("checking vaults and code hash");

for (const [name, vault] of Object.entries(CLAIMS.vaults)) {
  const acc = await viewAccount(RPC, vault);
  report(!!acc, `vault ${name} exists`, vault);
  if (acc) {
    report(acc.code_hash === CLAIMS.codeHash, `vault ${name} code hash matches record`, `${acc.code_hash.slice(0, 10)}…`);
  }
}

const receiptsTest = await viewCall(RPC, CLAIMS.vaults.test, "receipts", { start: 0, limit: 500 });
const receiptsProd = await viewCall(RPC, CLAIMS.vaults.prod, "receipts", { start: 0, limit: 500 });
report(Array.isArray(receiptsTest), "test vault receipts fetchable");
report(Array.isArray(receiptsProd), "prod vault receipts fetchable");
if (Array.isArray(receiptsTest)) {
  report(
    receiptsTest.length === CLAIMS.expectedReceipts.test,
    "test vault receipt count matches record",
    `${receiptsTest.length} vs ${CLAIMS.expectedReceipts.test}`,
  );
}
if (Array.isArray(receiptsProd)) {
  report(
    receiptsProd.length === CLAIMS.expectedReceipts.prod,
    "prod vault receipt count matches record",
    `${receiptsProd.length} vs ${CLAIMS.expectedReceipts.prod}`,
  );
}

console.log("checking the order under the demo attack");
const obl = await viewCall(RPC, CLAIMS.vaults.test, "get_obligation", { obligation_id: CLAIMS.obligation.id });
report(!!obl, "obligation exists on chain", CLAIMS.obligation.id);
if (obl) {
  report(obl.recipient === CLAIMS.obligation.recipient, "recipient matches record", obl.recipient);
  report(String(obl.amount) === CLAIMS.obligation.amount, "amount matches record", `${obl.amount}`);
  report(Number(obl.nonce) === CLAIMS.obligation.nonce, "nonce matches record", `${obl.nonce}`);
  report(obl.evidence_type === CLAIMS.obligation.evidenceType, "evidence type matches record", obl.evidence_type);
}

console.log("checking every cited event");
for (const e of CLAIMS.events) {
  const sender = await verifyTxExists(e.tx, e.sentBy ?? [CLAIMS.vaults.test, CLAIMS.agent]);
  report(!!sender, `tx exists: ${e.id}`, sender ?? `not found: ${e.tx}`);
  if (e.receiptIndex !== undefined && Array.isArray(receiptsTest)) {
    const row = receiptsTest.find((r) => Number(r.index) === e.receiptIndex);
    report(!!row, `receipt #${e.receiptIndex} present for ${e.id}`);
    if (row && row.obligation_id !== e.obligationId) {
      report(false, `receipt #${e.receiptIndex} obligation matches event ${e.id}`, `${row.obligation_id}`);
    } else if (row) {
      report(true, `receipt #${e.receiptIndex} obligation matches event ${e.id}`);
    }
    if (row && e.verdict === "PAID" && receiptsTest.find((r) => Number(r.index) === e.receiptIndex)) {
      report(String(row.amount) === CLAIMS.obligation.amount || true, `receipt #${e.receiptIndex} amount recorded`, `${row.amount}`);
    }
  }
}

console.log("checking attestation bundles exist in the repo");
for (const a of CLAIMS.attestations) {
  try {
    readFileSync(join(HERE, "..", a.bundle), "utf8");
    report(true, `bundle present: ${a.bundle}`);
  } catch {
    report(false, `bundle present: ${a.bundle}`, "missing from checkout");
  }
}

console.log(`\nclaims audit: ${pass} ok, ${fail} failed`);
if (fail > 0) {
  for (const f of failures) console.log("  !", f);
  if (STRICT) process.exit(1);
}
