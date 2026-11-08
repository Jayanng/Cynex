/**
 * Per-settle runtime checks for the Cynex MCP server.
 *
 * These checks run on every cynex_request_settlement call, before
 * submitting, and they verify the integrity of the server and the
 * on-chain state. They are pure functions over a RuntimeState
 * snapshot: the live reads happen in server.ts (buildContext),
 * which fills the snapshot from the RPC, and the checks here
 * decide pass or fail. Nothing here is mocked or hardcoded to a
 * passing value: every field must be read from the chain, and a
 * missing or inconsistent field fails closed.
 *
 * What these checks do NOT do, on purpose: they do not pre-refuse
 * mismatched terms (a changed recipient or a changed amount).
 * The server passes the caller exact typed values through
 * unchanged, and the vault enforces the match on chain. A
 * cooperative refusal by the server is not proof the vault
 * withstands a compromised agent; the vault rejection is. See
 * services/mcp/SECURITY.md for the layering decision.
 */
import { SETTLE_CALL_GAS } from "../../agent/console.js";
import {
  EXPECTED_VAULT_CODE_HASH,
  SANDBOX_CHAIN_ID,
  TESTNET_CHAIN_ID,
  isSandboxRpcUrl,
  isTestnetRpcUrl,
  verifyKeyScope,
} from "./config.js";

export { EXPECTED_VAULT_CODE_HASH, SANDBOX_CHAIN_ID, TESTNET_CHAIN_ID };

/**
 * Live state read for one settle attempt. A null field means the
 * read failed or the value was absent, and the checks below treat
 * that as a failure, never as a pass.
 */
export interface RuntimeState {
  chainId: string | null;
  vaultExists: boolean;
  vaultCodeHash: string | null;
  accessKey: unknown;
  gasPrice: bigint | null;
}

export interface RuntimeCheckResult {
  ok: boolean;
  reason: string;
}

function failed(reason: string): RuntimeCheckResult {
  return { ok: false, reason };
}

function passed(reason: string): RuntimeCheckResult {
  return { ok: true, reason };
}

/** Estimated cost of one settle call at the given gas price. */
export function settleGasCostYocto(gasPrice: bigint): bigint {
  return SETTLE_CALL_GAS * gasPrice;
}

/**
 * Parse a live gas price read from the RPC. The provider returns the
 * gas price as a decimal string; a bigint is accepted as read, and a
 * JSON number only when it is a safe non-negative integer, so an
 * unsafe or negative value can never be read as a passing price. Any
 * other shape returns null, and the runtime checks fail closed on it.
 */
export function parseGasPrice(raw: unknown): bigint | null {
  if (typeof raw === "bigint") {
    return raw >= 0n ? raw : null;
  }
  if (typeof raw === "string" && /^[0-9]+$/.test(raw)) {
    return BigInt(raw);
  }
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) {
    return BigInt(raw);
  }
  return null;
}

/**
 * Read a chain integer that may arrive as a JSON number, a decimal
 * string, or a bigint. Anything else throws, so a malformed policy
 * figure can never be read as a passing value. A JSON number is
 * accepted only when it is a safe integer: money and identity
 * figures must be exact, and a value above 2^53 cannot be read
 * exactly from a JSON number. Nanosecond timestamps are the
 * exception, and they must not use this helper: every realistic
 * ns timestamp is above 2^53. Use parseChainTimestampNs for those.
 */
export function toChainBigInt(value: unknown, name: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error("policy field " + name + " is negative: " + value.toString());
    }
    return value;
  }
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    return BigInt(value);
  }
  throw new Error(
    "policy field " + name + " is not a readable integer: " + JSON.stringify(value),
  );
}

/**
 * Read a nanosecond timestamp from the chain, as a JSON number, a
 * decimal string, or a bigint. The chain returns expires_at_ns as
 * a JSON number, and every realistic ns timestamp is above 2^53,
 * so the safe-integer strictness of toChainBigInt can never pass
 * for one: this is the same split agent/console.ts already makes
 * for create_obligation inputs (audit finding 6-2). A JSON number
 * is read with BigInt(value), the exact integer the double holds;
 * the rounding JSON.parse applies is at most half a Number spacing,
 * 128 ns at a realistic timestamp, far below the 60 second skew
 * tolerance the expiry check allows and far below block production
 * granularity, so it cannot change whether a settlement at any real
 * block timestamp is before or after expiry. Floats, negatives,
 * non-numeric strings, and values outside the u64 range still
 * throw, so a malformed expiry can never be read as a passing
 * value, and the contract stays the authority on the exact
 * boundary with ERR_OBLIGATION_EXPIRED.
 */
export function parseChainTimestampNs(value: unknown, name: string): bigint {
  const U64_MAX = (1n << 64n) - 1n;
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new Error("policy field " + name + " is negative: " + value.toString());
    }
    if (value > U64_MAX) {
      throw new Error("policy field " + name + " is outside the u64 range: " + value.toString());
    }
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    const parsed = BigInt(value);
    if (parsed > U64_MAX) {
      throw new Error("policy field " + name + " is outside the u64 range: " + JSON.stringify(value));
    }
    return parsed;
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    const parsed = BigInt(value);
    if (parsed > U64_MAX) {
      throw new Error("policy field " + name + " is outside the u64 range: " + JSON.stringify(value));
    }
    return parsed;
  }
  throw new Error(
    "policy field " + name + " is not a readable timestamp: " + JSON.stringify(value),
  );
}

/**
 * Verify the network, the vault account, its deployed code, and
 * the signing key, all re-read for this settle attempt. Order:
 * RPC URL, live chain id, vault existence, code hash, key scope
 * (function-call, receiver, exactly [settle], finite positive
 * allowance), then allowance sufficiency against the live gas
 * price. The first failure stops the check and refuses the settle.
 *
 * In sandbox mode (opts.sandbox) the RPC URL must be a loopback
 * sandbox URL, the chain id must be the sandbox chain id, and the
 * code hash must equal opts.expectedVaultCodeHash, the hash of the
 * wasm deployed to the sandbox vault. A sandbox run without an
 * expected hash fails closed. The testnet path is unchanged when
 * opts.sandbox is absent or false.
 */
export function verifyRuntimeState(
  state: RuntimeState,
  opts: {
    rpcUrl: string;
    vaultId: string;
    agentPublicKey: string;
    sandbox?: boolean;
    expectedChainId?: string;
    expectedVaultCodeHash?: string;
  },
): RuntimeCheckResult {
  const sandbox = opts.sandbox === true;
  const expectedChainId =
    opts.expectedChainId ?? (sandbox ? SANDBOX_CHAIN_ID : TESTNET_CHAIN_ID);
  const expectedCodeHash = sandbox ? opts.expectedVaultCodeHash : EXPECTED_VAULT_CODE_HASH;
  if (sandbox) {
    if (!isSandboxRpcUrl(opts.rpcUrl)) {
      return failed(
        "runtime check failed: the configured RPC URL is not a loopback sandbox RPC URL: " + opts.rpcUrl,
      );
    }
    if (expectedCodeHash === undefined || expectedCodeHash === "") {
      return failed(
        "runtime check failed: no expected vault code hash is configured for sandbox mode, failing closed",
      );
    }
  } else if (!isTestnetRpcUrl(opts.rpcUrl)) {
    return failed(
      "runtime check failed: the configured RPC URL is not a testnet RPC URL: " + opts.rpcUrl,
    );
  }
  if (state.chainId === null) {
    return failed(
      "runtime check failed: the network id could not be read from the RPC, failing closed",
    );
  }
  if (state.chainId !== expectedChainId) {
    return failed(
      "runtime check failed: the RPC serves network " +
        state.chainId +
        ", expected " +
        expectedChainId,
    );
  }
  if (!state.vaultExists) {
    return failed(
      "runtime check failed: the vault account " +
        opts.vaultId +
        " does not exist on " +
        expectedChainId,
    );
  }
  if (state.vaultCodeHash === null) {
    return failed(
      "runtime check failed: the vault code hash could not be read for " + opts.vaultId,
    );
  }
  if (state.vaultCodeHash !== expectedCodeHash) {
    return failed(
      "runtime check failed: the vault code hash " +
        state.vaultCodeHash +
        " does not equal the expected deployed hash " +
        expectedCodeHash +
        ", the vault code may have changed",
    );
  }
  if (state.accessKey === null || state.accessKey === undefined) {
    return failed(
      "runtime check failed: the signing key " +
        opts.agentPublicKey +
        " could not be read from the agent account, it may have been removed",
    );
  }
  const keyRecord = state.accessKey as Record<string, unknown>;
  const permission =
    (keyRecord.permission as unknown) ??
    (keyRecord.access_key as Record<string, unknown> | undefined)?.permission;
  if (permission === undefined) {
    return failed(
      "runtime check failed: the signing key read has no permission shape, failing closed",
    );
  }
  // The access key above was read with a query keyed by the agent
  // public key (buildContext reads viewAccessKey for exactly
  // opts.agentPublicKey), so the permission checked here is the
  // permission of that key, not of any key on the account. The
  // public-key binding comes from that keyed read, not from this
  // function.
  const scope = verifyKeyScope(
    {
      keys: [
        {
          public_key: opts.agentPublicKey,
          access_key: { permission: permission as never },
        },
      ],
    },
    opts.agentPublicKey,
    opts.vaultId,
  );
  if (!scope.ok) {
    return failed(
      "runtime check failed: the signing key no longer passes the scope check: " + scope.reason,
    );
  }
  if (state.gasPrice === null) {
    return failed(
      "runtime check failed: the gas price could not be read, so allowance sufficiency cannot be proven",
    );
  }
  if (state.gasPrice < 0n) {
    return failed(
      "runtime check failed: the gas price is negative, so allowance sufficiency cannot be proven",
    );
  }
  const call = (permission as { FunctionCall?: { allowance?: string | null } }).FunctionCall;
  const allowance = call === undefined ? undefined : call.allowance;
  if (typeof allowance !== "string") {
    return failed(
      "runtime check failed: the signing key allowance is not a finite decimal string",
    );
  }
  const cost = settleGasCostYocto(state.gasPrice);
  if (BigInt(allowance) < cost) {
    return failed(
      "runtime check failed: the signing key allowance " +
        allowance +
        " yoctoNEAR is below the estimated settle gas cost " +
        cost.toString() +
        " yoctoNEAR at the current gas price " +
        state.gasPrice.toString(),
    );
  }
  return passed(
    "runtime checks passed: " +
      (sandbox ? "sandbox" : "testnet") +
      " RPC, chain " +
      expectedChainId +
      ", vault code hash matches the deployed hash, signing key is settle-only on the vault with allowance covering the settle gas cost",
  );
}

/**
 * Echo verification: a getPolicy or getObligation response must
 * carry the id that was requested. A response for a different id,
 * or with the id field missing, is refused rather than trusted.
 */
export function verifyEcho(
  row: unknown,
  field: string,
  expected: string,
): RuntimeCheckResult {
  if (row === null || row === undefined || typeof row !== "object") {
    return failed(
      "echo check failed: the " + field + " response is missing, cannot confirm it is for " + expected,
    );
  }
  const value = (row as Record<string, unknown>)[field];
  if (value === undefined) {
    return failed(
      "echo check failed: the response carries no " +
        field +
        ", cannot confirm it is for " +
        expected,
    );
  }
  if (String(value) !== expected) {
    return failed(
      "echo check failed: the response is for " +
        field +
        " " +
        String(value) +
        ", not the requested " +
        expected,
    );
  }
  return passed("echo check passed: the response is for " + field + " " + expected);
}

/**
 * Off-chain budget refusal: spent plus reserved plus the
 * obligation amount must fit inside both the policy limit and the
 * funded amount. The vault enforces the same check on chain; this
 * refusal saves gas on a settle that is doomed to fail there.
 */
export function checkBudget(
  policy: Record<string, unknown>,
  amount: bigint,
): RuntimeCheckResult {
  const spent = toChainBigInt(policy.spent, "spent");
  const reserved = toChainBigInt(policy.reserved, "reserved");
  const limit = toChainBigInt(policy.limit, "limit");
  const funded = toChainBigInt(policy.funded, "funded");
  if (amount < 0n) {
    return failed("budget check failed: the amount " + amount.toString() + " is negative");
  }
  const total = spent + reserved + amount;
  if (total > limit) {
    return failed(
      "budget check failed: spent " +
        spent.toString() +
        " plus reserved " +
        reserved.toString() +
        " plus amount " +
        amount.toString() +
        " exceeds the policy limit " +
        limit.toString() +
        ", the vault would refuse with ERR_BUDGET_EXCEEDED",
    );
  }
  if (total > funded) {
    return failed(
      "budget check failed: spent " +
        spent.toString() +
        " plus reserved " +
        reserved.toString() +
        " plus amount " +
        amount.toString() +
        " exceeds the funded amount " +
        funded.toString() +
        ", the vault would refuse with ERR_BUDGET_EXCEEDED",
    );
  }
  return passed(
    "budget check passed: spent plus reserved plus amount is " +
      total.toString() +
      " against limit " +
      limit.toString() +
      " and funded " +
      funded.toString(),
  );
}

/**
 * Assert the submitted transaction targets the configured vault
 * with method settle, before signing. The only method this server
 * ever submits is settle, and the only receiver is the configured
 * vault; anything else is a programming error and must never
 * reach the signer.
 */
export function assertSettleTarget(
  vaultId: string,
  contractId: string,
  methodName: string,
): RuntimeCheckResult {
  if (contractId !== vaultId) {
    return failed(
      "settle target check failed: the transaction receiver " +
        contractId +
        " is not the configured vault " +
        vaultId,
    );
  }
  if (methodName !== "settle") {
    return failed(
      "settle target check failed: the transaction method " +
        methodName +
        " is not settle, the server only ever submits settle",
    );
  }
  return passed("settle target check passed: " + vaultId + " settle");
}
