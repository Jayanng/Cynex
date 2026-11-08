/**
 * MCP server configuration, Cynex survival plan item 2.
 *
 * The server reads the same CYNEX_* environment variables as the
 * console (agent/console.ts). It holds exactly one key, the agent
 * scoped settle-only key, read from the file named in
 * CYNEX_AGENT_KEY_FILE. It never holds the owner key, never a
 * full-access key, and the key is never printed, logged, or
 * returned in any tool output.
 *
 * At startup the server verifies the key scope on chain (see
 * verifyKeyScope): the key must be a function-call key, its
 * receiver must equal the configured vault, its methods must
 * be exactly ["settle"], and its allowance must be finite and
 * positive. Anything else refuses to start.
 *
 * Local sandbox mode: when CYNEX_SANDBOX_RPC_URL names a loopback
 * near-sandbox RPC (http://127.0.0.1:<port>), the server runs
 * against that local chain instead of testnet. The expected vault
 * code hash comes from CYNEX_SANDBOX_VAULT_CODE_HASH, the hash of
 * the wasm actually deployed to the sandbox vault, so a replaced
 * vault still fails the per-settle check. The expected chain id
 * comes from CYNEX_SANDBOX_CHAIN_ID, because near-sandbox
 * randomizes its chain id on every init (test-chain-XXXXX); the
 * default is "sandbox". Sandbox mode never applies to a remote
 * URL: only loopback http URLs are accepted, and CYNEX_RPC_URL
 * must be unset while sandbox mode is on. The testnet path is
 * unchanged when the sandbox variables are absent.
 */
import { readFileSync } from "node:fs";
import { KeyPair } from "near-api-js";

export const TESTNET_RPC_URL = "https://rpc.testnet.fastnear.com";

/** Chain id a local near-sandbox reports. */
export const TESTNET_CHAIN_ID = "testnet";

/**
 * Chain id a local near-sandbox reports. The sandbox is a real
 * local chain, not testnet, so the runtime checks expect this
 * chain id in sandbox mode instead of the testnet one.
 */
export const SANDBOX_CHAIN_ID = "sandbox";

/**
 * Code hash of the deployed vault on both vaults, verified live
 * 2026-11-08 (test vault and production vault both report this
 * hash). The per-settle runtime check requires the configured
 * vault account code_hash to equal this value, and fails closed
 * on any difference, so a redeployed or replaced vault can never
 * be settled through this server silently.
 */
export const EXPECTED_VAULT_CODE_HASH =
  "65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6";

/**
 * Testnet RPC endpoints the server accepts. The server is testnet
 * only: loadConfig refuses any other RPC URL at startup, and the
 * per-settle runtime check proves the endpoint actually serves
 * testnet by reading its chain id live. A different endpoint
 * needs a restart with a new CYNEX_RPC_URL, it is never picked
 * up from a running server.
 */
export const TESTNET_RPC_HOSTS = [
  "rpc.testnet.fastnear.com",
  "test.rpc.fastnear.com",
  "rpc.testnet.near.org",
] as const;

export function isTestnetRpcUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (TESTNET_RPC_HOSTS as readonly string[]).includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * A sandbox RPC URL is a plain-http URL on the literal loopback
 * address 127.0.0.1 with an explicit port. Only the literal address
 * is accepted, never a hostname: a hostname is never resolved here,
 * and `localhost` could resolve elsewhere in a hostile environment.
 * Nothing remote is ever a sandbox URL: a remote host would let a
 * test run point at a chain the operator does not control.
 */
export function isSandboxRpcUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "http:" &&
      parsed.hostname === "127.0.0.1" &&
      parsed.port !== ""
    );
  } catch {
    return false;
  }
}

export interface McpConfig {
  vaultId: string;
  agentId: string;
  agentKeyFile: string;
  rpcUrl: string;
  /** True only in local sandbox mode, never on testnet. */
  sandbox: boolean;
  /** Chain id the per-settle runtime checks expect: testnet, or sandbox. */
  expectedChainId: string;
  /** Vault code hash the per-settle runtime checks expect. */
  expectedVaultCodeHash: string;
  snapshotDir: string;
  blocklistUrl?: string;
  nearblocksUrl?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const vaultId = (env.CYNEX_VAULT ?? "").trim();
  const agentId = (env.CYNEX_AGENT ?? "").trim();
  const agentKeyFile = (env.CYNEX_AGENT_KEY_FILE ?? "").trim();
  if (vaultId === "") {
    throw new Error("MCP config: CYNEX_VAULT is not set");
  }
  if (agentId === "") {
    throw new Error("MCP config: CYNEX_AGENT is not set");
  }
  if (agentKeyFile === "") {
    throw new Error("MCP config: CYNEX_AGENT_KEY_FILE is not set");
  }
  const sandboxRpcUrl = (env.CYNEX_SANDBOX_RPC_URL ?? "").trim();
  // A partial sandbox configuration is a mistake, not a testnet
  // run: the sandbox hash or chain id set without the sandbox RPC
  // URL would be silently ignored and the server would run against
  // testnet. Refuse it instead.
  const sandboxHashSet = (env.CYNEX_SANDBOX_VAULT_CODE_HASH ?? "").trim() !== "";
  const sandboxChainIdSet = (env.CYNEX_SANDBOX_CHAIN_ID ?? "").trim() !== "";
  if (sandboxRpcUrl === "" && (sandboxHashSet || sandboxChainIdSet)) {
    throw new Error(
      "MCP config: CYNEX_SANDBOX_VAULT_CODE_HASH or CYNEX_SANDBOX_CHAIN_ID is set " +
        "without CYNEX_SANDBOX_RPC_URL, set the RPC URL or remove the sandbox variables",
    );
  }
  if (sandboxRpcUrl !== "") {
    if ((env.CYNEX_RPC_URL ?? "").trim() !== "") {
      throw new Error(
        "MCP config: CYNEX_SANDBOX_RPC_URL and CYNEX_RPC_URL are both set, set exactly one",
      );
    }
    if (!isSandboxRpcUrl(sandboxRpcUrl)) {
      throw new Error(
        "MCP config: CYNEX_SANDBOX_RPC_URL is not a loopback sandbox RPC URL: " + sandboxRpcUrl,
      );
    }
    const sandboxCodeHash = (env.CYNEX_SANDBOX_VAULT_CODE_HASH ?? "").trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(sandboxCodeHash)) {
      throw new Error(
        "MCP config: CYNEX_SANDBOX_VAULT_CODE_HASH is not a base58 vault code hash, "
        + "it must be the hash of the wasm deployed to the sandbox vault",
      );
    }
    // near-sandbox randomizes its chain id on every init
    // (test-chain-XXXXX), so the expected id cannot be a constant.
    // The suite reads the id live from the node it started and
    // passes it in here; the default covers older sandbox builds
    // that still report "sandbox". The check still refuses any
    // other network, it just takes the expected id from the local
    // node instead of assuming it.
    const sandboxChainId = (env.CYNEX_SANDBOX_CHAIN_ID ?? "").trim() || SANDBOX_CHAIN_ID;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(sandboxChainId)) {
      throw new Error(
        "MCP config: CYNEX_SANDBOX_CHAIN_ID is not a valid chain id: " + sandboxChainId,
      );
    }
    return {
      vaultId,
      agentId,
      agentKeyFile,
      rpcUrl: sandboxRpcUrl,
      sandbox: true,
      expectedChainId: sandboxChainId,
      expectedVaultCodeHash: sandboxCodeHash,
      snapshotDir: (env.CYNEX_SNAPSHOT_DIR ?? "").trim(),
      blocklistUrl: (env.CYNEX_BLOCKLIST_URL ?? "").trim() || undefined,
      nearblocksUrl: (env.CYNEX_NEARBLOCKS_URL ?? "").trim() || undefined,
    };
  }
  const rpcUrl = (env.CYNEX_RPC_URL ?? TESTNET_RPC_URL).trim() || TESTNET_RPC_URL;
  if (!isTestnetRpcUrl(rpcUrl)) {
    throw new Error(
      "MCP config: CYNEX_RPC_URL is not a testnet RPC URL: " + rpcUrl,
    );
  }
  return {
    vaultId,
    agentId,
    agentKeyFile,
    rpcUrl,
    sandbox: false,
    expectedChainId: TESTNET_CHAIN_ID,
    expectedVaultCodeHash: EXPECTED_VAULT_CODE_HASH,
    snapshotDir: (env.CYNEX_SNAPSHOT_DIR ?? "").trim(),
    blocklistUrl: (env.CYNEX_BLOCKLIST_URL ?? "").trim() || undefined,
    nearblocksUrl: (env.CYNEX_NEARBLOCKS_URL ?? "").trim() || undefined,
  };
}

export interface AgentKey {
  secretKey: string;
  publicKey: string;
}

/**
 * Read the agent key file. Two formats are accepted, both already
 * used by the console and near-cli in this repo: a bare secret key
 * string (one line, ed25519:...), or a near credentials JSON file
 * with account_id, public_key, and private_key. The public key is
 * taken from the JSON when present, otherwise derived from the
 * secret key. Only the public key ever leaves this module in a
 * log or a report; the secret key is returned here for the signer
 * only and is never printed by any caller.
 */
export function readAgentKey(keyFile: string): AgentKey {
  const text = readFileSync(keyFile, "utf-8").trim();
  if (text === "") {
    throw new Error("MCP config: agent key file is empty: " + keyFile);
  }
  if (text.startsWith("{")) {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const secretKey = parsed.private_key;
    const publicKey = parsed.public_key;
    if (typeof secretKey !== "string" || typeof publicKey !== "string") {
      throw new Error(
        "MCP config: agent key file is JSON but has no private_key and public_key strings: " + keyFile,
      );
    }
    // The public key is never trusted from the file on its own: the
    // signer uses the secret, so the scope check must verify the key
    // the secret actually signs with. Derive it and require the file
    // label to match exactly, or a file could pair a scoped key label
    // with a full-access secret and pass the startup check.
    const derived = KeyPair.fromString(secretKey as never).getPublicKey().toString();
    if (derived !== publicKey) {
      throw new Error(
        "MCP config: agent key file public_key does not match the public key derived from private_key: " + keyFile,
      );
    }
    return { secretKey, publicKey: derived };
  }
  const secretKey = text.split(/\s+/)[0] as string;
  const publicKey = KeyPair.fromString(secretKey as never).getPublicKey().toString();
  return { secretKey, publicKey };
}

export type AccessKeyPermission =
  | "FullAccess"
  | {
      FunctionCall: {
        allowance?: string | null;
        receiver_id: string;
        method_names: string[];
      };
    };

export interface AccessKeyEntry {
  public_key: string;
  access_key: {
    nonce?: unknown;
    permission: AccessKeyPermission;
  };
}

export interface KeyScopeCheck {
  ok: boolean;
  reason: string;
}

/**
 * Check one public key against the access key list read from the
 * chain with CynexClient.viewAccessKeyList. The key must exist, be
 * a function-call key, receive on exactly the configured vault,
 * allow exactly the settle method, and carry a finite, positive
 * allowance. A full-access key, a wrong receiver, broader methods,
 * an unlimited allowance, or an exhausted allowance all refuse,
 * with the reason naming what was wrong. The key material itself
 * is never in the reason.
 */
export function verifyKeyScope(
  entries: unknown,
  publicKey: string,
  vaultId: string,
): KeyScopeCheck {
  const list = (entries as { keys?: unknown } | null | undefined)?.keys;
  if (!Array.isArray(list)) {
    return {
      ok: false,
      reason: "startup scope check failed: access key list has no keys array for the agent account",
    };
  }
  const found = list.find(
    (entry) =>
      (entry as AccessKeyEntry)?.public_key === publicKey,
  ) as AccessKeyEntry | undefined;
  if (found === undefined) {
    return {
      ok: false,
      reason:
        "startup scope check failed: public key " +
        publicKey +
        " is not on the agent account, the server cannot start with a key the account does not hold",
    };
  }
  const permission = found.access_key?.permission;
  if (permission === "FullAccess") {
    return {
      ok: false,
      reason:
        "startup scope check failed: the configured key is a full-access key, the server only ever holds a settle-only function-call key",
    };
  }
  if (permission === undefined || typeof permission !== "object" || permission.FunctionCall === undefined) {
    return {
      ok: false,
      reason: "startup scope check failed: the configured key has an unrecognised permission shape",
    };
  }
  const call = permission.FunctionCall;
  if (call.receiver_id !== vaultId) {
    return {
      ok: false,
      reason:
        "startup scope check failed: the configured key is scoped to receiver " +
        call.receiver_id +
        ", not the configured vault " +
        vaultId,
    };
  }
  if (!Array.isArray(call.method_names)) {
    return {
      ok: false,
      reason:
        "startup scope check failed: the configured key has a malformed method_names list",
    };
  }
  const methods = [...call.method_names].sort();
  if (methods.length !== 1 || methods[0] !== "settle") {
    return {
      ok: false,
      reason:
        "startup scope check failed: the configured key allows methods [" +
        call.method_names.join(", ") +
        "], the server only ever holds a key that allows exactly [settle]",
    };
  }
  // The frozen rule requires a finite allowance: allowance null means
  // unlimited on NEAR, and "0" means the key cannot pay gas. The check
  // is finite and positive, not a ceiling, so a key created with a
  // different allowance still starts.
  if (
    typeof call.allowance !== "string" ||
    !/^[0-9]+$/.test(call.allowance) ||
    BigInt(call.allowance) <= 0n
  ) {
    return {
      ok: false,
      reason:
        "startup scope check failed: the configured key must have a finite, positive allowance, got " +
        JSON.stringify(call.allowance),
    };
  }
  return { ok: true, reason: "key scope verified: function-call key, receiver " + vaultId + ", methods [settle]" };
}
