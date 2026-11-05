/**
 * Cynex console, Phase 2 Lane B, audit fixes applied.
 *
 * Wires the console to the real contract, end to end, in
 * this order, because a fresh obligation is CREATED and
 * settle requires READY:
 *   1. owner create_obligation
 *   2. owner request_evidence
 *   3. read the obligation back, take pending_request_id
 *      from chain, never from a local computation
 *   4. real verifier check: SHA-256 over the artifact bytes
 *      from CYNEX_ARTIFACT_FILE, compared to the hash on
 *      chain, bound to the settlement digest and the pending
 *      request; abort on BLOCK, do not submit
 *   5. verifier submit_evidence with request_id equal to
 *      pending_request_id, result ALLOWED, proof equal to
 *      the obligation evidence_hash hex
 *   6. read the obligation back; abort before settle
 *      unless the state is READY
 *   7. read the recipient ft_balance_of before settle
 *   8. agent settle (scoped settle key)
 *   9. read the obligation back; it must be PAID
 *  10. read the recipient ft_balance_of after settle; the
 *      increase must equal the obligation amount, else
 *      this is an accounting break and the run fails
 *
 * The settle transaction outcome print is not proof. The
 * obligation PAID read and the balance delta are the proof.
 *
 * Preconditions for a live run, held by Lane A, not here:
 * the verifier account must already be allowlisted with
 * add_verifier, the vault and the recipient must be
 * storage registered on the token, and the policy must be
 * funded. Keys come only from files named in environment
 * variables and are never printed.
 *
 * Dry run (no keys): prints the exact calls that would be
 * made, in order, and exits 2. A dry run is not a
 * settlement and must never be reported as one.
 *
 * Live run: set CYNEX_VAULT, CYNEX_OWNER, CYNEX_AGENT,
 * CYNEX_VERIFIER, CYNEX_OWNER_KEY_FILE,
 * CYNEX_AGENT_KEY_FILE, CYNEX_VERIFIER_KEY_FILE, and
 * CYNEX_OBLIGATION_FILE (JSON with obligation_id,
 * policy_id, recipient, amount as a decimal string,
 * evidence_type, evidence_hash as 64 hex characters,
 * expires_at_ns as a decimal string, nonce as a decimal
 * string, and evidence_ref). The artifact bytes come from
 * CYNEX_ARTIFACT_FILE; without it the live run aborts before
 * submit_evidence (fail closed, no READY by default).
 *
 * Deployed-contract note, flagged for audit, not hidden:
 * the frozen contract-api.md create_obligation signature
 * has no nonce (nonce generated at creation), while the
 * deployed contract takes nonce as an input argument.
 * The console follows the deployed contract.
 */
import { readFileSync } from "node:fs";
import { JsonRpcProvider, Account, KeyPairSigner } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import { buildSettle } from "./wrapper.js";
import { verifyArtifact, TRUST_MODE } from "../services/verifier/verifier.js";
import { CynexClient, TESTNET_RPC_URL } from "../frontend/src/cynex/client.js";
import type { Obligation } from "../frontend/src/cynex/schema.js";

/**
 * Deployed-contract create_obligation arguments.
 */
export interface DeployCreateObligationArgs {
  policy_id: string;
  obligation_id: string;
  recipient: string;
  amount: number;
  evidence_type: string;
  evidence_hash: number[];
  expires_at_ns: number;
  nonce: number;
}

export interface ObligationFile {
  obligation_id: string;
  policy_id: string;
  recipient: string;
  amount: string;
  evidence_type: string;
  evidence_hash: string;
  expires_at_ns: string;
  nonce: string;
  evidence_ref: string;
}

export function createObligationArgs(input: ObligationFile): DeployCreateObligationArgs {
  // NEAR JSON u64/u128 inputs are numbers, so a value that is
  // not exactly representable as a JS number must never be
  // silently rounded. Check each u64/u128 input against its
  // BigInt form and throw if it does not round-trip exactly.
  // Live Phase 2 values pass this check: amounts 250000000 and
  // 100000000, nonces 1 to 8, and expiry 1893456000000000000 are
  // all exactly representable. A future value that fails here
  // is a hard error, not a rounded expiry or amount.
  for (const [name, value] of [
    ["amount", input.amount],
    ["expires_at_ns", input.expires_at_ns],
    ["nonce", input.nonce],
  ] as const) {
    if (BigInt(Number(value)).toString() !== BigInt(value).toString()) {
      throw new Error(
        "obligation input " + name + " is not exactly representable as a JS number: " + value,
      );
    }
  }
  const hashBytes: number[] = [];
  for (let i = 0; i < input.evidence_hash.length; i += 2) {
    hashBytes.push(parseInt(input.evidence_hash.slice(i, i + 2), 16));
  }
  return {
    policy_id: input.policy_id,
    obligation_id: input.obligation_id,
    recipient: input.recipient,
    amount: Number(input.amount),
    evidence_type: input.evidence_type,
    evidence_hash: hashBytes,
    expires_at_ns: Number(input.expires_at_ns),
    nonce: Number(input.nonce),
  };
}

export function consoleCalls(vaultId: string, input: ObligationFile): Record<string, unknown>[] {
  const create = createObligationArgs(input);
  const settle = buildSettle({
    obligation_id: input.obligation_id,
    proposed_recipient: input.recipient,
    proposed_amount: BigInt(input.amount),
    evidence_ref: input.evidence_ref,
  });
  return [
    { account: "owner", contractId: vaultId, methodName: "create_obligation", args: create },
    { account: "owner", contractId: vaultId, methodName: "request_evidence", args: { obligation_id: input.obligation_id } },
    { account: "reader", contractId: vaultId, methodName: "get_obligation", args: { obligation_id: input.obligation_id } },
    { account: "verifier", contractId: vaultId, methodName: "submit_evidence", args: { request_id: "<pending_request_id read from chain>", obligation_id: input.obligation_id, result: "ALLOWED", proof: input.evidence_hash } },
    { account: "reader", contractId: vaultId, methodName: "get_obligation", args: { obligation_id: input.obligation_id } },
    { account: "reader", contractId: "<token from policy>", methodName: "ft_balance_of", args: { account_id: input.recipient } },
    { account: "agent", contractId: vaultId, methodName: "settle", args: { ...settle, proposed_amount: settle.proposed_amount.toString() } },
    { account: "reader", contractId: vaultId, methodName: "get_obligation", args: { obligation_id: input.obligation_id } },
    { account: "reader", contractId: "<token from policy>", methodName: "ft_balance_of", args: { account_id: input.recipient } },
  ];
}

function obligationState(row: unknown): string {
  return String((row as Record<string, unknown>).state);
}

function hexOfBytes(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (Array.isArray(value)) {
    return Buffer.from(value as number[]).toString("hex");
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function obligationPendingRequestId(row: unknown): string | null {
  if (row === null || row === undefined) {
    return null;
  }
  const value = (row as Record<string, unknown>).pending_request_id;
  return value === null || value === undefined ? null : String(value);
}

async function tokenBalance(provider: JsonRpcProvider, tokenId: string, recipient: string): Promise<bigint> {
  const result = await provider.callFunction({
    contractId: tokenId,
    method: "ft_balance_of",
    args: { account_id: recipient },
    blockQuery: { finality: "final" },
  });
  return BigInt(String(result as unknown));
}


export async function sleepMs(ms: number): Promise<void> {
  await new Promise(function (resolve) { setTimeout(resolve, ms); });
}

export async function pollObligation(
  client: CynexClient,
  obligationId: string,
  label: string,
  want: string,
  maxAttempts = 60,
  intervalMs = 2000,
): Promise<unknown | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const row = await client.getObligation(obligationId);
    if (row === null || row === undefined) {
      console.log("poll " + label + " attempt " + attempt + ": row not visible yet");
    } else {
      const state = obligationState(row);
      const pending = obligationPendingRequestId(row);
      console.log("poll " + label + " attempt " + attempt + ": state=" + state + " pending_request_id=" + String(pending));
      if (want === "pending" ? pending !== null : state === want) {
        return row;
      }
    }
    if (attempt < maxAttempts) {
      await sleepMs(intervalMs);
    }
  }
  console.log("poll timeout for " + label + " after " + maxAttempts + " attempts.");
  return null;
}

export async function pollBalance(
  provider: JsonRpcProvider,
  tokenId: string,
  recipient: string,
  expected: bigint,
  label: string,
  maxAttempts = 60,
  intervalMs = 2000,
): Promise<bigint | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const value = await tokenBalance(provider, tokenId, recipient);
    console.log("poll " + label + " attempt " + attempt + ": balance=" + value.toString());
    if (value === expected) {
      return value;
    }
    if (attempt < maxAttempts) {
      await sleepMs(intervalMs);
    }
  }
  console.log("poll timeout for " + label + " after " + maxAttempts + " attempts.");
  return null;
}

// Gas for console change calls. near-api-js defaults to 30 TGas prepaid.
// Settle attaches 30 TGas for ft_transfer plus 30 TGas for the callback,
// plus about 2.6 TGas of its own execution measured in Phase 2, so 30 TGas
// prepaid can never cover it and fails with Exceeded the prepaid gas.
// Lane A live settlements used 100 TGas for settle and succeeded.
export const DEFAULT_CALL_GAS = 30000000000000n;
export const SETTLE_CALL_GAS = 100000000000000n;

export function txHashOf(outcome: unknown): string {
  const root = outcome as Record<string, unknown>;
  const tx = root.transaction as Record<string, unknown> | undefined;
  if (tx && typeof tx.hash === "string") {
    return tx.hash;
  }
  const txOutcome = root.transaction_outcome as Record<string, unknown> | undefined;
  if (txOutcome && typeof txOutcome.id === "string") {
    return txOutcome.id;
  }
  return "unknown";
}

export function txHashFromError(error: unknown): string {
  const root = error as Record<string, unknown>;
  const direct = root.transaction as Record<string, unknown> | undefined;
  if (direct && typeof direct.hash === "string") {
    return direct.hash;
  }
  const result = root.transactionResult as Record<string, unknown> | undefined;
  if (result) {
    const tx = result.transaction as Record<string, unknown> | undefined;
    if (tx && typeof tx.hash === "string") {
      return tx.hash;
    }
    const outcome = result.transaction_outcome as Record<string, unknown> | undefined;
    if (outcome && typeof outcome.id === "string") {
      return outcome.id;
    }
  }
  return txHashOf(error);
}


async function liveRun(): Promise<number> {
  const vaultId = process.env.CYNEX_VAULT ?? "";
  const ownerId = process.env.CYNEX_OWNER ?? "";
  const agentId = process.env.CYNEX_AGENT ?? "";
  const verifierId = process.env.CYNEX_VERIFIER ?? "";
  const ownerKeyFile = process.env.CYNEX_OWNER_KEY_FILE ?? "";
  const agentKeyFile = process.env.CYNEX_AGENT_KEY_FILE ?? "";
  const verifierKeyFile = process.env.CYNEX_VERIFIER_KEY_FILE ?? "";
  const obligationFile = process.env.CYNEX_OBLIGATION_FILE ?? "";
  const artifactFile = process.env.CYNEX_ARTIFACT_FILE ?? "";
  if (!obligationFile) {
    console.log("usage: set CYNEX_VAULT, CYNEX_OWNER, CYNEX_AGENT, CYNEX_VERIFIER, CYNEX_OWNER_KEY_FILE, CYNEX_AGENT_KEY_FILE, CYNEX_VERIFIER_KEY_FILE, CYNEX_OBLIGATION_FILE, CYNEX_ARTIFACT_FILE");
    return 2;
  }
  const input = JSON.parse(readFileSync(obligationFile, "utf-8")) as ObligationFile;
  if (!vaultId || !ownerId || !agentId || !verifierId || !ownerKeyFile || !agentKeyFile || !verifierKeyFile) {
    console.log("DRY-RUN: no keys supplied, no transaction was sent.");
    console.log("live run polls each chain read until the expected state appears or 120 seconds elapse.");
    for (const call of consoleCalls(vaultId || "<vault>", input)) {
      console.log(JSON.stringify(call));
    }
    return 2;
  }
  const provider = new JsonRpcProvider({ url: TESTNET_RPC_URL });
  const ownerKey = readFileSync(ownerKeyFile, "utf-8").trim();
  const agentKey = readFileSync(agentKeyFile, "utf-8").trim();
  const verifierKey = readFileSync(verifierKeyFile, "utf-8").trim();
  const owner = new Account(ownerId, provider, KeyPairSigner.fromSecretKey(ownerKey as KeyPairString));
  const verifier = new Account(verifierId, provider, KeyPairSigner.fromSecretKey(verifierKey as KeyPairString));
  const agent = new Account(agentId, provider, KeyPairSigner.fromSecretKey(agentKey as KeyPairString));
  const client = new CynexClient(vaultId);
  const create = createObligationArgs(input);
  const createOutcome = await owner.callFunctionRaw({
    contractId: vaultId,
    methodName: "create_obligation",
    args: create,
    gas: DEFAULT_CALL_GAS,
  });
  console.log("create_obligation tx hash: " + txHashOf(createOutcome));
  const created = await pollObligation(client, input.obligation_id, "obligation CREATED after create_obligation", "CREATED");
  if (created === null) {
    console.log("ABORT: obligation did not appear as CREATED after create_obligation, request_evidence is not attempted.");
    return 1;
  }
  console.log("obligation after create_obligation: " + JSON.stringify(created));
  const requestOutcome = await owner.callFunctionRaw({
    contractId: vaultId,
    methodName: "request_evidence",
    args: { obligation_id: input.obligation_id },
    gas: DEFAULT_CALL_GAS,
  });
  console.log("request_evidence tx hash: " + txHashOf(requestOutcome));
  const afterRequest = await pollObligation(client, input.obligation_id, "pending_request_id after request_evidence", "pending");
  if (afterRequest === null) {
    console.log("ABORT: no pending_request_id on chain after request_evidence, settle is not attempted.");
    return 1;
  }
  console.log("obligation after request_evidence: " + JSON.stringify(afterRequest));
  const pendingRequestId = obligationPendingRequestId(afterRequest);
  if (pendingRequestId === null) {
    console.log("ABORT: no pending_request_id on chain after request_evidence, settle is not attempted.");
    return 1;
  }
  const policyForEvidence = (await client.getPolicy(input.policy_id)) as Record<string, unknown>;
  const chainEvidenceHash = hexOfBytes((afterRequest as Record<string, unknown>).evidence_hash);
  const chainPendingDigest = hexOfBytes((afterRequest as Record<string, unknown>).pending_digest);
  if (chainEvidenceHash === null || chainEvidenceHash !== input.evidence_hash.toLowerCase()) {
    console.log("ABORT: evidence_hash on chain does not match the obligation file, submit_evidence is not attempted.");
    return 1;
  }
  if (artifactFile === "") {
    console.log("ABORT: CYNEX_ARTIFACT_FILE is not set, the artifact bytes cannot be read, submit_evidence is not attempted.");
    return 1;
  }
  let artifactBytes: Buffer;
  try {
    artifactBytes = readFileSync(artifactFile);
  } catch (e) {
    console.log("ABORT: artifact file unreadable, submit_evidence is not attempted: " + String(e));
    return 1;
  }
  const evidenceObligation: Obligation = {
    obligation_id: input.obligation_id,
    policy_id: input.policy_id,
    policy_version: BigInt(String(policyForEvidence.version)),
    recipient: input.recipient,
    amount: BigInt(input.amount),
    evidence_type: input.evidence_type,
    evidence_hash: chainEvidenceHash,
    expires_at_ns: BigInt(input.expires_at_ns),
    nonce: BigInt(input.nonce),
    state: obligationState(afterRequest) as Obligation["state"],
    in_flight: false,
    transfer_attempt: BigInt(String((afterRequest as Record<string, unknown>).transfer_attempt)),
    transfer_dispatched_at_ns: null,
    pending_request_id: pendingRequestId,
    pending_digest: chainPendingDigest,
    evidence_requested_at_ns: null,
  };
  const nowNs = BigInt(Date.now()) * 1000000n;
  const check = verifyArtifact(artifactBytes, evidenceObligation, String(policyForEvidence.token_id), vaultId, nowNs);
  console.log("verifier " + TRUST_MODE + ": " + check.result + " reasons=" + check.reasons.join(",") + " digest=" + check.digest + " request_id=" + String(check.requestId));
  if (check.result !== "ALLOWED") {
    console.log("ABORT: verifier did not allow, submit_evidence is not attempted.");
    return 1;
  }
  const submitOutcome = await verifier.callFunctionRaw({
    contractId: vaultId,
    methodName: "submit_evidence",
    args: { request_id: pendingRequestId, obligation_id: input.obligation_id, result: "ALLOWED", proof: check.evidenceHash },
    gas: DEFAULT_CALL_GAS,
  });
  console.log("submit_evidence tx hash: " + txHashOf(submitOutcome));
  const afterEvidence = await pollObligation(client, input.obligation_id, "obligation READY after submit_evidence", "READY");
  if (afterEvidence === null) {
    console.log("ABORT: obligation did not become READY after submit_evidence, settle is not attempted.");
    return 1;
  }
  console.log("obligation after submit_evidence: " + JSON.stringify(afterEvidence));
  if (obligationState(afterEvidence) !== "READY") {
    console.log("ABORT: obligation is not READY after submit_evidence, settle is not attempted. State: " + obligationState(afterEvidence));
    return 1;
  }
  const policyRow = await client.getPolicy(input.policy_id) as Record<string, unknown>;
  const tokenId = String(policyRow.token_id);
  const beforeBalance = await tokenBalance(provider, tokenId, input.recipient);
  console.log("recipient ft_balance_of before settle: " + beforeBalance.toString());
  const settle = buildSettle({
    obligation_id: input.obligation_id,
    proposed_recipient: input.recipient,
    proposed_amount: BigInt(input.amount),
    evidence_ref: input.evidence_ref,
  });
  const settleOutcome = await agent.callFunctionRaw({
    contractId: vaultId,
    methodName: "settle",
    args: { ...settle, proposed_amount: settle.proposed_amount.toString() },
    gas: SETTLE_CALL_GAS,
  });
  console.log("settle tx hash: " + txHashOf(settleOutcome));
  const afterSettle = await pollObligation(client, input.obligation_id, "obligation PAID after settle", "PAID");
  if (afterSettle === null) {
    console.log("FAILURE: obligation did not become PAID after settle.");
    return 1;
  }
  console.log("obligation after settle: " + JSON.stringify(afterSettle));
  if (obligationState(afterSettle) !== "PAID") {
    console.log("FAILURE: obligation is not PAID after settle. State: " + obligationState(afterSettle));
    return 1;
  }
  const afterBalance = await pollBalance(provider, tokenId, input.recipient, beforeBalance + BigInt(input.amount), "recipient ft_balance_of after settle");
  if (afterBalance === null) {
    console.log("FAILURE: recipient balance did not reach the expected value after settle. This is an accounting break, do not report success.");
    return 1;
  }
  console.log("recipient ft_balance_of after settle: " + afterBalance.toString());
  if (afterBalance - beforeBalance !== BigInt(input.amount)) {
    console.log("FAILURE: balance increase does not equal the obligation amount. This is an accounting break, do not report success.");
    return 1;
  }
  const receiptsAfter = (await client.receipts(0n, 10n)) as Array<Record<string, unknown>>;
  console.log(
    "receipts after settle (index, obligation_id, recipient, amount only; timestamps are JS numbers and round above 2^53, use cynex verify-live for exact timestamps): " +
      JSON.stringify(
        receiptsAfter.map((r) => ({
          index: r.index,
          obligation_id: r.obligation_id,
          recipient: r.recipient,
          amount: r.amount,
        })),
      ),
  );
  return 0;
}

if (import.meta.url === "file://" + process.argv[1]) {
  liveRun()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.log("console FAILED: tx hash: " + txHashFromError(error) + " error: " + message);
      process.exitCode = 1;
    });
}
