/**
 * Cynex console, Phase 2 Lane B.
 *
 * Wires the console to the real contract: create an obligation
 * (owner) and settle it (agent, scoped settle key), then read
 * back the live chain state. This is the Lane B console flow
 * from Phase 2, implemented with near-api-js v7 Account
 * callFunction. No keys are stored in this file or in the repo:
 * key material comes only from files named in environment
 * variables at run time, and is never printed.
 *
 * Dry run (no keys): prints the exact calls that would be
 * made, in order, and exits 2. A dry run is not a settlement
 * and must never be reported as one.
 *
 * Live run: set CYNEX_VAULT, CYNEX_OWNER, CYNEX_AGENT,
 * CYNEX_OWNER_KEY_FILE, CYNEX_AGENT_KEY_FILE, and
 * CYNEX_OBLIGATION_FILE (JSON with obligation_id, policy_id,
 * recipient, amount as a decimal string, evidence_type,
 * evidence_hash as 64 hex characters, expires_at_ns as a
 * decimal string, nonce as a decimal string, and evidence_ref).
 * The console then prints the live transaction outcome and
 * the chain read that follows it for every action, as the
 * plan requires. A console line without either is not proof.
 */
import { readFileSync } from "node:fs";
import { JsonRpcProvider, Account, KeyPairSigner } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import { buildSettle } from "./wrapper.js";
import { CynexClient, TESTNET_RPC_URL } from "../frontend/src/cynex/client.js";

/**
 * Deployed-contract create_obligation arguments. Note a
 * divergence for Lane A audit: the frozen contract-api.md
 * signature has no nonce (nonce is generated at creation),
 * while the deployed contract takes nonce as an input
 * argument. The console follows the deployed contract, and
 * this divergence is flagged here rather than hidden.
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
  // NEAR JSON u64/u128 inputs are numbers. Demo values are
  // chosen to be exact in a JS number (amount 250000000);
  // expires_at_ns above 2^53 rounds to the nearest
  // representable value, which is immaterial for an expiry
  // date, but large amounts or exact timestamps need an
  // encoding confirmed with Lane A before use.
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
    { account: "agent", contractId: vaultId, methodName: "settle", args: { ...settle, proposed_amount: settle.proposed_amount.toString() } },
    { account: "reader", contractId: vaultId, methodName: "receipts", args: { start: 0, limit: 10 } },
  ];
}

async function liveRun(): Promise<number> {
  const vaultId = process.env.CYNEX_VAULT ?? "";
  const ownerId = process.env.CYNEX_OWNER ?? "";
  const agentId = process.env.CYNEX_AGENT ?? "";
  const ownerKeyFile = process.env.CYNEX_OWNER_KEY_FILE ?? "";
  const agentKeyFile = process.env.CYNEX_AGENT_KEY_FILE ?? "";
  const obligationFile = process.env.CYNEX_OBLIGATION_FILE ?? "";
  if (!vaultId || !ownerId || !agentId || !ownerKeyFile || !agentKeyFile || !obligationFile) {
    if (!obligationFile) {
      console.log("usage: set CYNEX_VAULT, CYNEX_OWNER, CYNEX_AGENT, CYNEX_OWNER_KEY_FILE, CYNEX_AGENT_KEY_FILE, CYNEX_OBLIGATION_FILE");
      return 2;
    }
    const input = JSON.parse(readFileSync(obligationFile, "utf-8")) as ObligationFile;
    console.log("DRY-RUN: no keys supplied, no transaction was sent.");
    for (const call of consoleCalls(vaultId || "<vault>", input)) {
      console.log(JSON.stringify(call));
    }
    return 2;
  }
  const input = JSON.parse(readFileSync(obligationFile, "utf-8")) as ObligationFile;
  const provider = new JsonRpcProvider({ url: TESTNET_RPC_URL });
  const ownerKey = readFileSync(ownerKeyFile, "utf-8").trim();
  const agentKey = readFileSync(agentKeyFile, "utf-8").trim();
  const owner = new Account(ownerId, provider, KeyPairSigner.fromSecretKey(ownerKey as KeyPairString));
  const create = createObligationArgs(input);
  const createOutcome = await owner.callFunction({
    contractId: vaultId,
    methodName: "create_obligation",
    args: create,
  });
  console.log("create_obligation outcome: " + JSON.stringify(createOutcome));
  const agent = new Account(agentId, provider, KeyPairSigner.fromSecretKey(agentKey as KeyPairString));
  const settle = buildSettle({
    obligation_id: input.obligation_id,
    proposed_recipient: input.recipient,
    proposed_amount: BigInt(input.amount),
    evidence_ref: input.evidence_ref,
  });
  const settleOutcome = await agent.callFunction({
    contractId: vaultId,
    methodName: "settle",
    args: { ...settle, proposed_amount: settle.proposed_amount.toString() },
  });
  console.log("settle outcome: " + JSON.stringify(settleOutcome));
  const client = new CynexClient(vaultId);
  console.log("obligation after settle: " + JSON.stringify(await client.getObligation(input.obligation_id)));
  console.log("receipts after settle: " + JSON.stringify(await client.receipts(0n, 10n)));
  return 0;
}

if (import.meta.url === "file://" + process.argv[1]) {
  liveRun().then((code) => {
    process.exitCode = code;
  });
}
