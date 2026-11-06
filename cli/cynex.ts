/**
 * Cynex CLI, Phase 1 scaffold plus Phase 2 live verification plus Phase 3 playground plus Phase 4 budget plus Phase 5 verifier.
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
 *   verify-artifact <vaultId> <obligationId> <artifactFile>
 *     Reads the obligation live from the contract (exact u64
 *     values via raw RPC, same pattern as verify-live), reads
 *     the artifact bytes from the file, computes a real SHA-256
 *     and compares it to the hash on chain, bound to the
 *     settlement digest and the pending request. Prints the
 *     trust mode with every result. Exit 0 on ALLOWED, 1 on
 *     BLOCK or an unreadable chain row, 2 on usage or an
 *     unreadable artifact file.
 *   attack-one <vaultId> <obligationId> <proposedRecipient> <proposedAmount> <evidenceRef> [--dry-run]
 *     Fires one real settle against the live vault with the
 *     agent key (CYNEX_AGENT, CYNEX_AGENT_KEY_FILE), at 100 TGas
 *     prepaid, with the proposed amount as a JSON string (a U128
 *     number would fail deserialization before any contract
 *     check). Prints the tx hash, the reason code from the
 *     chain, the obligation state read live after the call, and
 *     the recipient balance before and after, then a RESULT JSON
 *     line for the executor to parse. Exit 0 when the call
 *     executed (success or a rejection with a tx hash), 1 when
 *     it could not execute, 2 on usage, validation, or dry-run.
 *   attack <vaultId> <scenariosFile> [--only <scenario>] [--dry-run] [--allow-production-settle] [--transcript <file>]
 *     Runs the four attack scenarios as real transactions:
 *     recipient substitution, terms mismatch, nonce replay, and
 *     budget exceeded. Each scenario reads its obligation and
 *     policy live, derives the attack parameters from the
 *     recorded terms, fires the settle, and checks the reason
 *     code and that zero tokens moved. The nonce scenario
 *     settles its obligation correctly first, then replays it;
 *     an already-PAID obligation replays directly. A happy-path
 *     settle on the production vault needs
 *     --allow-production-settle, otherwise the run refuses.
 *     Appends the run to the transcript file (default
 *     docs/phase6-attack-transcript.md). Exit 0 when every
 *     scenario produced its expected code, 1 otherwise.
 *   reputation <vaultId> <accountId> [--snapshots <dir>] [--blocklist-url <url>]
 *     Reads the counterparty's reputation live (services/reputation):
 *     account existence plus current code hash from the RPC, first
 *     seen from the snapshot files in <dir> (default
 *     demo/reputation-snapshots), prior vault interactions from the
 *     contract receipts view, and a blocklist only when
 *     --blocklist-url names one. Every line shows a real source and
 *     timestamp; a signal that cannot be sourced is shown as
 *     unavailable, never fabricated. Exit 0 when the check ran and
 *     printed a report (any verdict); 1 when the check itself failed.
 *   reputation-snapshot <accountId...> [--snapshots <dir>] [--rpc <url>]
 *     Takes a reputation snapshot of each listed account: a live
 *     view_account read plus the final block height and timestamp,
 *     written to <dir>/<UTC time>.json (default
 *     demo/reputation-snapshots). The snapshot is the provenance
 *     for the account-age signal. Exit 0 on success, 1 on an RPC
 *     failure, 2 on usage.
 */
import { readFileSync, appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { receiptHash, GENESIS_PREV_HASH } from "../frontend/src/cynex/receipt.js";
import { toHex } from "../frontend/src/cynex/api.js";
import { CynexClient, TESTNET_RPC_URL } from "../frontend/src/cynex/client.js";
import { describeState, OBLIGATION_STATES } from "../frontend/src/cynex/states.js";
import { describeBudget, type BalancesRow } from "../frontend/src/cynex/budget.js";
import { verifyArtifact, TRUST_MODE } from "../services/verifier/verifier.js";
import type { Receipt, Obligation } from "../frontend/src/cynex/schema.js";
import { JsonRpcProvider, Account, KeyPairSigner } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import { SETTLE_CALL_GAS, txHashOf, txHashFromError } from "../agent/console.js";
import { buildSettle } from "../agent/wrapper.js";
import { evaluateCounterparty, formatReport } from "../services/reputation/reputation.js";
import { makeLiveSources, takeLiveSnapshot } from "../services/reputation/live-sources.js";
import { takeSnapshot, snapshotFileName } from "../services/reputation/snapshot.js";
import type { SnapshotAccount } from "../services/reputation/snapshot.js";
import {
  ATTACK_EVIDENCE_REF,
  ATTACK_SCENARIOS,
  SCENARIO_LABELS,
  attackParams,
  formatTranscriptRow,
  isValidAccountId,
  parseAmountU128,
  reasonCodeFromError,
  transcriptHeader,
  validateSettleParams,
} from "../services/attacks/attacks.js";
import type {
  AttackObligation,
  AttackParams,
  AttackPolicy,
  AttackScenario,
  TranscriptRow,
} from "../services/attacks/attacks.js";


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


async function fetchObligationExact(vaultId: string, obligationId: string): Promise<Obligation | null> {
  const argsBase64 = Buffer.from(JSON.stringify({ obligation_id: obligationId })).toString("base64");
  const response = await fetch(TESTNET_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "cynex-verify-artifact",
      method: "query",
      params: {
        request_type: "call_function",
        account_id: vaultId,
        method_name: "get_obligation",
        args_base64: argsBase64,
        finality: "final",
      },
    }),
  });
  const data = (await response.json()) as { error?: unknown; result?: { result?: number[] } };
  if (data.error) {
    throw new Error("get_obligation view failed: " + JSON.stringify(data.error));
  }
  const raw = Buffer.from(data.result?.result ?? []).toString("utf-8");
  if (raw === "null") {
    return null;
  }
  const quoted = raw.replace(/"(amount|expires_at_ns|nonce|transfer_attempt|transfer_dispatched_at_ns|evidence_requested_at_ns)":\s*(-?\d+)/g, "\"$1\":\"$2\"");
  const row = JSON.parse(quoted) as Record<string, unknown>;
  function hexField(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (Array.isArray(value)) {
      return Buffer.from(value as number[]).toString("hex");
    }
    return String(value);
  }
  const evidenceHash = hexField(row.evidence_hash);
  if (evidenceHash === null) {
    throw new Error("obligation row has no evidence_hash");
  }
  return {
    obligation_id: String(row.obligation_id),
    policy_id: String(row.policy_id),
    policy_version: BigInt(String(row.policy_version)),
    recipient: String(row.recipient),
    amount: BigInt(String(row.amount)),
    evidence_type: String(row.evidence_type),
    evidence_hash: evidenceHash,
    expires_at_ns: BigInt(String(row.expires_at_ns)),
    nonce: BigInt(String(row.nonce)),
    state: String(row.state) as Obligation["state"],
    in_flight: Boolean(row.in_flight),
    transfer_attempt: BigInt(String(row.transfer_attempt)),
    transfer_dispatched_at_ns: row.transfer_dispatched_at_ns === null || row.transfer_dispatched_at_ns === undefined ? null : BigInt(String(row.transfer_dispatched_at_ns)),
    pending_request_id: row.pending_request_id === null || row.pending_request_id === undefined ? null : String(row.pending_request_id),
    pending_digest: hexField(row.pending_digest),
    evidence_requested_at_ns: row.evidence_requested_at_ns === null || row.evidence_requested_at_ns === undefined ? null : BigInt(String(row.evidence_requested_at_ns)),
  };
}

async function verifyArtifactCmd(vaultId: string, obligationId: string, artifactFile: string): Promise<number> {
  let obligation: Obligation | null;
  try {
    obligation = await fetchObligationExact(vaultId, obligationId);
  } catch (e) {
    console.log(obligationId + ": obligation read failed, nothing verified: " + String(e));
    return 1;
  }
  if (obligation === null) {
    console.log(obligationId + ": not found on chain, nothing verified.");
    return 1;
  }
  const policy = (await new CynexClient(vaultId).getPolicy(obligation.policy_id)) as Record<string, unknown> | null;
  if (policy === null || policy === undefined || typeof policy.token_id !== "string") {
    console.log(obligation.policy_id + ": policy row unreadable, nothing verified.");
    return 1;
  }
  let artifact: Buffer;
  try {
    artifact = readFileSync(artifactFile);
  } catch (e) {
    console.log("artifact file unreadable: " + String(e));
    return 2;
  }
  const nowNs = BigInt(Date.now()) * 1000000n;
  const check = verifyArtifact(artifact, obligation, policy.token_id, vaultId, nowNs);
  console.log("trust mode: " + TRUST_MODE);
  console.log("obligation " + obligation.obligation_id + " (" + obligation.policy_id + ") state " + obligation.state);
  console.log("result: " + check.result + " reasons=" + check.reasons.join(","));
  console.log("evidence hash (computed SHA-256 over " + artifact.length + " bytes): " + check.evidenceHash);
  console.log("settlement digest: " + check.digest);
  console.log("request_id: " + String(check.requestId));
  return check.result === "ALLOWED" ? 0 : 1;
}


const PRODUCTION_VAULT_ID = "cynex-vault.cynexmaster.testnet";

interface AttackOneResult {
  scenario: string;
  obligationId: string;
  proposedRecipient: string;
  proposedAmount: string;
  txHash: string;
  reasonCode: string | null;
  settled: boolean;
  stateAfter: string;
  balanceBefore: string;
  balanceAfter: string;
  moved: string;
}

async function tokenBalanceOf(provider: JsonRpcProvider, tokenId: string, recipient: string): Promise<bigint> {
  const result = await provider.callFunction({
    contractId: tokenId,
    method: "ft_balance_of",
    args: { account_id: recipient },
    blockQuery: { finality: "final" },
  });
  return BigInt(String(result as unknown));
}

async function readObligationRow(
  client: CynexClient,
  obligationId: string,
  want: string | null,
  label: string,
): Promise<Record<string, unknown> | null> {
  for (let attempt = 1; attempt <= 30; attempt++) {
    const row = (await client.getObligation(obligationId)) as Record<string, unknown> | null;
    if (row !== null && row !== undefined) {
      if (want === null || String(row.state) === want) {
        return row;
      }
      console.log("poll " + label + " attempt " + String(attempt) + ": state=" + String(row.state));
    } else {
      console.log("poll " + label + " attempt " + String(attempt) + ": row not visible yet");
    }
    if (attempt < 30) {
      await new Promise(function (resolve) {
        setTimeout(resolve, 2000);
      });
    }
  }
  console.log("poll timeout for " + label + " after 30 attempts.");
  return null;
}

function agentAccount(provider: JsonRpcProvider): Account | null {
  const agentId = process.env.CYNEX_AGENT ?? "";
  const agentKeyFile = process.env.CYNEX_AGENT_KEY_FILE ?? "";
  if (agentId === "" || agentKeyFile === "") {
    return null;
  }
  const agentKey = readFileSync(agentKeyFile, "utf-8").trim();
  return new Account(agentId, provider, KeyPairSigner.fromSecretKey(agentKey as KeyPairString));
}

async function fireSettle(
  provider: JsonRpcProvider,
  client: CynexClient,
  agent: Account,
  vaultId: string,
  obligationId: string,
  proposedRecipient: string,
  proposedAmount: bigint,
  evidenceRef: string,
  scenario: string,
): Promise<AttackOneResult> {
  const obligation = await fetchObligationExact(vaultId, obligationId);
  if (obligation === null) {
    throw new Error(obligationId + ": not found on chain, settle not attempted");
  }
  const policy = (await client.getPolicy(obligation.policy_id)) as Record<string, unknown> | null;
  if (policy === null || policy === undefined || typeof policy.token_id !== "string") {
    throw new Error(obligation.policy_id + ": policy row unreadable, settle not attempted");
  }
  const tokenId = String(policy.token_id);
  const balanceBefore = await tokenBalanceOf(provider, tokenId, obligation.recipient);
  const settle = buildSettle({
    obligation_id: obligationId,
    proposed_recipient: proposedRecipient,
    proposed_amount: proposedAmount,
    evidence_ref: evidenceRef,
  });
  let txHash = "unknown";
  let reasonCode: string | null = null;
  let settled = false;
  try {
    const outcome = await agent.callFunctionRaw({
      contractId: vaultId,
      methodName: "settle",
      args: { ...settle, proposed_amount: settle.proposed_amount.toString() },
      gas: SETTLE_CALL_GAS,
    });
    txHash = txHashOf(outcome);
    settled = true;
  } catch (e) {
    txHash = txHashFromError(e);
    reasonCode = reasonCodeFromError(e instanceof Error ? e.message : String(e));
    console.log("settle rejected on chain: tx hash: " + txHash + " reason: " + String(reasonCode));
  }
  const after = await readObligationRow(client, obligationId, settled ? "PAID" : null, "obligation after settle " + obligationId);
  const stateAfter = after === null ? "unknown" : String(after.state);
  const balanceAfter = await tokenBalanceOf(provider, tokenId, obligation.recipient);
  const moved = balanceAfter - balanceBefore;
  return {
    scenario,
    obligationId,
    proposedRecipient,
    proposedAmount: proposedAmount.toString(),
    txHash,
    reasonCode,
    settled,
    stateAfter,
    balanceBefore: balanceBefore.toString(),
    balanceAfter: balanceAfter.toString(),
    moved: moved.toString(),
  };
}

function printAttackResult(result: AttackOneResult): void {
  if (result.settled) {
    console.log(
      "attack " + result.scenario + " " + result.obligationId + ": SETTLED tx " + result.txHash + " state " + result.stateAfter + " balance " + result.balanceBefore + " -> " + result.balanceAfter + " (moved " + result.moved + ")",
    );
  } else {
    console.log(
      "attack " + result.scenario + " " + result.obligationId + ": tx " + result.txHash + " code " + String(result.reasonCode) + " state " + result.stateAfter + " balance " + result.balanceBefore + " -> " + result.balanceAfter + " (moved " + result.moved + ")",
    );
  }
  console.log("RESULT " + JSON.stringify(result));
}

function toTranscriptRow(label: string, result: AttackOneResult): TranscriptRow {
  return {
    scenario: label,
    obligationId: result.obligationId,
    proposedRecipient: result.proposedRecipient,
    proposedAmount: result.proposedAmount,
    txHash: result.txHash,
    reasonCode: result.settled ? "SETTLED" : String(result.reasonCode),
    stateAfter: result.stateAfter,
    balanceBefore: result.balanceBefore,
    balanceAfter: result.balanceAfter,
    moved: result.moved,
  };
}

async function attackOneCmd(argv: string[]): Promise<number> {
  const [vaultId, obligationId, proposedRecipient, proposedAmount, evidenceRef, flag] = argv;
  if (vaultId === undefined || obligationId === undefined || proposedRecipient === undefined || proposedAmount === undefined || evidenceRef === undefined) {
    console.log("usage: cynex attack-one <vaultId> <obligationId> <proposedRecipient> <proposedAmount> <evidenceRef> [--dry-run]");
    return 2;
  }
  const problems = validateSettleParams(proposedRecipient, proposedAmount, evidenceRef);
  if (!isValidAccountId(vaultId)) {
    problems.push("vaultId is not a valid account id: " + vaultId);
  }
  if (problems.length > 0) {
    console.log("attack-one refused before execution: " + problems.join("; "));
    return 2;
  }
  const amount = parseAmountU128(proposedAmount);
  const provider = new JsonRpcProvider({ url: TESTNET_RPC_URL });
  const client = new CynexClient(vaultId);
  if (flag === "--dry-run") {
    const obligation = await fetchObligationExact(vaultId, obligationId);
    console.log("DRY-RUN: no transaction was sent.");
    console.log(
      JSON.stringify({
        account: "agent",
        contractId: vaultId,
        methodName: "settle",
        args: { obligation_id: obligationId, proposed_recipient: proposedRecipient, proposed_amount: proposedAmount, evidence_ref: evidenceRef },
        gas: "100000000000000",
        obligation: obligation === null ? null : { state: obligation.state, recipient: obligation.recipient, amount: obligation.amount.toString() },
      }),
    );
    return 2;
  }
  const agent = agentAccount(provider);
  if (agent === null) {
    console.log("attack-one needs the agent key: set CYNEX_AGENT and CYNEX_AGENT_KEY_FILE (bare private key file, outside the repo). No transaction was sent.");
    return 2;
  }
  let result: AttackOneResult;
  try {
    result = await fireSettle(provider, client, agent, vaultId, obligationId, proposedRecipient, amount, evidenceRef, "single");
  } catch (e) {
    console.log("attack-one failed before the settle call: " + String(e instanceof Error ? e.message : e));
    return 1;
  }
  printAttackResult(result);
  if (result.txHash === "unknown") {
    return 1;
  }
  return 0;
}

interface AttackScenariosFile {
  vaults: Array<{
    vaultId: string;
    label: string;
    production: boolean;
    recipient: string;
    terms: string;
    nonce: string;
    budget: string;
  }>;
}

async function attackCmd(argv: string[]): Promise<number> {
  const [vaultId, scenariosFile] = argv;
  const onlyIndex = argv.indexOf("--only");
  const only = onlyIndex !== -1 ? argv[onlyIndex + 1] : undefined;
  const dryRun = argv.indexOf("--dry-run") !== -1;
  const allowProductionSettle = argv.indexOf("--allow-production-settle") !== -1;
  const transcriptIndex = argv.indexOf("--transcript");
  const transcriptFile = transcriptIndex !== -1 && argv[transcriptIndex + 1] !== undefined ? argv[transcriptIndex + 1] : "docs/phase6-attack-transcript.md";
  if (vaultId === undefined || scenariosFile === undefined) {
    console.log("usage: cynex attack <vaultId> <scenariosFile> [--only <scenario>] [--dry-run] [--allow-production-settle] [--transcript <file>]");
    return 2;
  }
  if (only !== undefined && (ATTACK_SCENARIOS as readonly string[]).indexOf(only) === -1) {
    console.log("unknown scenario: " + only + ", expected one of " + ATTACK_SCENARIOS.join(", "));
    return 2;
  }
  let parsed: AttackScenariosFile;
  try {
    parsed = JSON.parse(readFileSync(scenariosFile, "utf-8")) as AttackScenariosFile;
  } catch (e) {
    console.log("scenarios file unreadable: " + String(e instanceof Error ? e.message : e));
    return 2;
  }
  const section = (parsed.vaults ?? []).find(function (v) {
    return v.vaultId === vaultId;
  });
  if (section === undefined) {
    console.log("no scenario section for vault " + vaultId + " in " + scenariosFile);
    return 2;
  }
  const scenarios = (only === undefined ? ATTACK_SCENARIOS : [only as AttackScenario]) as AttackScenario[];
  const provider = new JsonRpcProvider({ url: TESTNET_RPC_URL });
  const client = new CynexClient(vaultId);
  const agent = dryRun ? null : agentAccount(provider);
  if (!dryRun && agent === null) {
    console.log("attack needs the agent key: set CYNEX_AGENT and CYNEX_AGENT_KEY_FILE (bare private key file, outside the repo). No transaction was sent.");
    return 2;
  }
  const rows: TranscriptRow[] = [];
  let allOk = true;
  for (const scenario of scenarios) {
    const obligationId = section[scenario];
    const obligation = await fetchObligationExact(vaultId, obligationId);
    if (obligation === null) {
      console.log(scenario + " " + obligationId + ": not found on chain, scenario failed.");
      allOk = false;
      continue;
    }
    const policyRow = (await client.getPolicy(obligation.policy_id)) as Record<string, unknown> | null;
    if (policyRow === null || policyRow === undefined || typeof policyRow.token_id !== "string") {
      console.log(scenario + " " + obligationId + ": policy row unreadable, scenario failed.");
      allOk = false;
      continue;
    }
    const policy: AttackPolicy = {
      limit: BigInt(String(policyRow.limit)),
      funded: BigInt(String(policyRow.funded)),
      spent: BigInt(String(policyRow.spent)),
      reserved: BigInt(String(policyRow.reserved)),
    };
    const attackObligation: AttackObligation = {
      obligation_id: obligation.obligation_id,
      recipient: obligation.recipient,
      amount: obligation.amount,
      state: obligation.state,
    };
    let params: AttackParams;
    try {
      params = attackParams(scenario, attackObligation, policy);
    } catch (e) {
      console.log(scenario + " " + obligationId + ": cannot produce the expected code from this obligation: " + String(e instanceof Error ? e.message : e));
      allOk = false;
      continue;
    }
    if (dryRun) {
      console.log(
        "DRY-RUN " + scenario + " " + obligationId + ": settle " + JSON.stringify({ obligation_id: obligationId, proposed_recipient: params.proposedRecipient, proposed_amount: params.proposedAmount.toString(), evidence_ref: params.evidenceRef }) + " expected " + params.expectedCode,
      );
      continue;
    }
    if (agent === null) {
      console.log("attack needs the agent key: set CYNEX_AGENT and CYNEX_AGENT_KEY_FILE. No transaction was sent.");
      return 2;
    }
    if (scenario === "nonce") {
      if (obligation.state === "READY") {
        if (section.production && !allowProductionSettle) {
          console.log("nonce " + obligationId + ": the production happy-path settle needs --allow-production-settle; refusing to move tokens on production without it. Scenario failed, no transaction was sent.");
          allOk = false;
          continue;
        }
        const settled = await fireSettle(provider, client, agent, vaultId, obligationId, obligation.recipient, obligation.amount, ATTACK_EVIDENCE_REF, "nonce-settle");
        printAttackResult(settled);
        rows.push(toTranscriptRow("nonce-settle (happy path)", settled));
        if (!settled.settled || settled.stateAfter !== "PAID" || settled.moved !== obligation.amount.toString()) {
          console.log("nonce " + obligationId + ": the correct settle did not land PAID with the exact balance increase, the replay is not attempted.");
          allOk = false;
          continue;
        }
      } else if (obligation.state === "PAID") {
        console.log("nonce " + obligationId + ": already PAID on chain, replaying directly without a new happy-path settle.");
      } else {
        console.log("nonce " + obligationId + ": state is " + obligation.state + ", neither READY nor PAID, the replay cannot be demonstrated.");
        allOk = false;
        continue;
      }
    }
    let result: AttackOneResult;
    try {
      result = await fireSettle(provider, client, agent, vaultId, obligationId, params.proposedRecipient, params.proposedAmount, params.evidenceRef, scenario);
    } catch (e) {
      console.log(scenario + " " + obligationId + ": failed before the settle call: " + String(e instanceof Error ? e.message : e));
      allOk = false;
      continue;
    }
    printAttackResult(result);
    rows.push(toTranscriptRow(SCENARIO_LABELS[scenario], result));
    if (result.moved !== "0") {
      console.log("FAILURE: attack " + scenario + " moved tokens (" + result.moved + "). Stopping the run immediately; this is a loud failure, file it.");
      return 1;
    }
    if (result.settled || result.reasonCode !== params.expectedCode) {
      console.log(scenario + " " + obligationId + ": expected " + params.expectedCode + ", got settled=" + String(result.settled) + " code=" + String(result.reasonCode) + ". Scenario failed.");
      allOk = false;
    }
  }
  if (rows.length > 0 && !dryRun) {
    const stamp = new Date().toISOString();
    const sectionText =
      "\n## Run " + stamp + " vault " + vaultId + " (" + section.label + ")\n\n" + transcriptHeader() + "\n" + rows.map(formatTranscriptRow).join("\n") + "\n";
    try {
      appendFileSync(transcriptFile, sectionText);
      console.log("transcript appended to " + transcriptFile);
    } catch (e) {
      console.log("WARNING: transcript could not be appended to " + transcriptFile + ": " + String(e instanceof Error ? e.message : e) + ". The transcript printed above is the record.");
    }
  }
  return allOk ? 0 : 1;
}


function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) {
    return undefined;
  }
  return argv[i + 1];
}

async function reputationCmd(vaultId: string, accountId: string, rest: string[]): Promise<number> {
  const sources = makeLiveSources({
    vaultId,
    rpcUrl: TESTNET_RPC_URL,
    snapshotDir: flagValue(rest, "--snapshots") ?? "demo/reputation-snapshots",
    blocklistUrl: flagValue(rest, "--blocklist-url"),
  });
  const report = await evaluateCounterparty(accountId, sources);
  for (const line of formatReport(report)) {
    console.log(line);
  }
  return 0;
}

async function reputationSnapshotCmd(args: string[]): Promise<number> {
  const dir = flagValue(args, "--snapshots") ?? "demo/reputation-snapshots";
  const rpcUrl = flagValue(args, "--rpc") ?? TESTNET_RPC_URL;
  const accountIds: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--snapshots" || a === "--rpc") {
      i += 1;
      continue;
    }
    if (a !== undefined) {
      accountIds.push(a);
    }
  }
  if (accountIds.length === 0) {
    console.log("usage: cynex reputation-snapshot <accountId...> [--snapshots <dir>] [--rpc <url>]");
    return 2;
  }
  const fetchedAt = new Date().toISOString();
  const accounts: SnapshotAccount[] = [];
  for (const accountId of accountIds) {
    const snap = await takeLiveSnapshot(rpcUrl, accountId, fetch);
    accounts.push({
      account_id: accountId,
      exists: snap.exists,
      code_hash: snap.codeHash,
      block_height: snap.blockHeight,
      block_timestamp: snap.blockTimestamp,
      fetched_at: new Date().toISOString(),
    });
    console.log(
      "snapshot " + accountId + ": " + (snap.exists ? "exists" : "not found") + " block " + snap.blockHeight,
    );
  }
  const file = takeSnapshot(accounts, "lane-b", rpcUrl, fetchedAt);
  mkdirSync(dir, { recursive: true });
  const path = dir + "/" + snapshotFileName(fetchedAt);
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
  console.log("snapshot written: " + path);
  return 0;
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
  if (command === "verify-artifact" && arg) {
    const verifyObligationId = argv[2];
    const verifyArtifactFile = argv[3];
    if (verifyObligationId === undefined || verifyArtifactFile === undefined) {
      console.log("usage: cynex verify-artifact <vaultId> <obligationId> <artifactFile>");
      return 2;
    }
    return verifyArtifactCmd(arg, verifyObligationId, verifyArtifactFile);
  }
  if (command === "attack-one" && arg) {
    return attackOneCmd(argv.slice(1));
  }
  if (command === "attack" && arg) {
    return attackCmd(argv.slice(1));
  }
  if (command === "reputation" && arg) {
    const reputationAccountId = argv[2];
    if (reputationAccountId === undefined) {
      console.log("usage: cynex reputation <vaultId> <accountId> [--snapshots <dir>] [--blocklist-url <url>]");
      return 2;
    }
    return reputationCmd(arg, reputationAccountId, argv.slice(3));
  }
  if (command === "reputation-snapshot" && arg) {
    return reputationSnapshotCmd(argv.slice(1));
  }
  console.log("usage: cynex verify-receipts <receipts.json>");
  console.log("usage: cynex verify-live <vaultId>");
  console.log("usage: cynex playground <vaultId> <obligationId...>");
  console.log("usage: cynex budget <vaultId> <policyId>");
  console.log("usage: cynex verify-artifact <vaultId> <obligationId> <artifactFile>");
  console.log("usage: cynex attack-one <vaultId> <obligationId> <proposedRecipient> <proposedAmount> <evidenceRef> [--dry-run]");
  console.log("usage: cynex attack <vaultId> <scenariosFile> [--only <scenario>] [--dry-run] [--allow-production-settle] [--transcript <file>]");
  console.log("usage: cynex reputation <vaultId> <accountId> [--snapshots <dir>] [--blocklist-url <url>]");
  console.log("usage: cynex reputation-snapshot <accountId...> [--snapshots <dir>] [--rpc <url>]");
  return 2;
}

if (import.meta.url === "file://" + process.argv[1]) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
