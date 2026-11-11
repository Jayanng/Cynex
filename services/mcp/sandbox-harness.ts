/**
 * Near-sandbox integration harness for the Cynex MCP server.
 *
 * This spins up a real local near-sandbox chain, deploys the real
 * vault wasm and a real minimal fungible token (contract/ft-test-token),
 * and runs the real MCP server against them, in process over an
 * in-memory MCP transport. Nothing here is mocked: the chain is a
 * local NEAR node, the vault is the compiled contract, the token is
 * a compiled NEP-141 contract, and the server is the same code that
 * serves testnet, pointed at the sandbox through its explicit
 * sandbox mode (CYNEX_SANDBOX_RPC_URL, loopback only).
 *
 * The flow, in order:
 *
 * 1. Start near-sandbox (binary downloaded once to ~/.near, the same
 *    place the near-sandbox Rust crate puts it) and wait for /status.
 * 2. Build the vault and token wasms with cargo-near when they are
 *    missing, and hash the vault wasm for the sandbox code-hash check.
 * 3. Create owner, vault, token, agent, and two recipient accounts
 *    under test.near, deploy both contracts, fund a policy with the
 *    token through ft_transfer_call, and drive four PREIMAGE
 *    obligations to READY through the real evidence flow.
 * 4. Give the agent a settle-only function-call key on the vault and
 *    verify its scope on chain, exactly as the server startup check does.
 * 5. Reputation bootstrap, mirroring the testnet matrix one-time
 *    setup: settle twice directly with the agent key (bypassing MCP
 *    and the reputation gate), so both recipients hold a prior receipt
 *    and the gate can ALLOW them. Without this the gate correctly
 *    WARNs on a fresh account and no MCP settle could ever succeed.
 * 6. Start the MCP server in process, and run all six tools through
 *    it: counterparty check, policy read, receipts list, obligation
 *    read, prepare, and settlement. The happy path must settle PAID
 *    with the exact balance delta and receipt; a changed recipient
 *    must be refused by the vault on chain with
 *    ERR_RECIPIENT_SUBSTITUTION and a transaction hash; a replay must
 *    be refused by the server as not READY.
 *
 * The harness throws on the first failed expectation, naming the
 * exact on-chain values it saw. A failure is a failure, never a skip.
 *
 * provisionSandbox() factors steps 1 to 5 out of runSandboxMcpSuite, so the
 * demo mode (services/mcp/demo.ts) seeds its own obligations on the same
 * provisioning instead of duplicating it.
 */
import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CynexClient } from "../../frontend/src/cynex/client.js";
import { txHashOf } from "../../agent/console.js";
import { buildContext, buildServer } from "./server.js";

const execFileAsync = promisify(execFile);

/** near-sandbox release, the same default the Rust crate uses. */
export const SANDBOX_VERSION = "2.13.4";


/**
 * Genesis account of a near-sandbox chain. near-sandbox generates a
 * fresh genesis key on every init, so the suite reads the secret
 * from the node's own validator_key.json after init instead of
 * assuming any well-known key. That key is ephemeral, local-only,
 * and never leaves the machine.
 */
const GENESIS_ACCOUNT = "test.near";

// Code hash of the deployed testnet vaults. The sandbox suite
// deploys a local build of the same source and refuses to run
// unless it hashes to exactly this.
export const EXPECTED_VAULT_CODE_HASH = "65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6";

const POLICY_ID = "sandbox-policy-001";
const POLICY_LIMIT = 10_000n;
const OBLIGATION_AMOUNT = "100";
const PREIMAGE = Buffer.from("cynex-sandbox-report-v1", "utf-8");
const FT_TOTAL_SUPPLY = "1000000000";
const AGENT_ALLOWANCE_YOCTO = 250_000_000_000_000_000_000_000n;
const ACCOUNT_FUNDING_YOCTO = 10_000_000_000_000_000_000_000_000n;
// Registration costs 0.0025 NEAR: two map entries at the
// conventional 0.00125 NEAR each. Must match STORAGE_COST in
// contract/ft-test-token/src/lib.rs.
const STORAGE_COST_YOCTO = 2_500_000_000_000_000_000_000n;
const GAS_30_TGAS = 30_000_000_000_000n;
const GAS_100_TGAS = 100_000_000_000_000n;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Scratch base for sandbox homes and wasm builds. Prefers the repo build tmp dir on this machine, tmpdir elsewhere. */
function scratchBase(): string {
  const fromEnv = (process.env.CYNEX_BUILD_TMP ?? "").trim();
  if (fromEnv !== "" && existsSync(fromEnv)) {
    return fromEnv;
  }
  if (existsSync("/data/workspace/cynex-build-tmp")) {
    return "/data/workspace/cynex-build-tmp";
  }
  return tmpdir();
}

// ---------------------------------------------------------------------------
// Base58, for the vault code hash: NEAR stores a code hash as the
// base58 encoding of the sha256 of the wasm.
// ---------------------------------------------------------------------------

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let zeroes = 0;
  while (zeroes < bytes.length && bytes[zeroes] === 0) {
    zeroes++;
  }
  // The numeric part starts empty: when every byte is zero the
  // result is one "1" per zero byte and nothing else. Seeding the
  // digits with a zero would emit a spurious extra "1".
  const digits: number[] = [];
  for (let i = zeroes; i < bytes.length; i++) {
    let carry = bytes[i] as number;
    for (let j = 0; j < digits.length; j++) {
      carry += (digits[j] as number) * 256;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeroes);
  for (let i = digits.length - 1; i >= 0; i--) {
    out += BASE58_ALPHABET[digits[i] as number];
  }
  return out;
}

/** Code hash of a wasm file, as the chain reports it. */
export function codeHashOfWasm(wasm: Uint8Array): string {
  return base58Encode(createHash("sha256").update(wasm).digest());
}

/**
 * An access-key nonce as a bigint, for exact comparison. The RPC
 * returns a JSON number and near-api-js also has an AccessKeyView
 * shape whose nonce is a bigint; either way the comparison must
 * be exact, so a number is accepted only when it is a safe
 * integer, and anything else throws instead of comparing lossy.
 */
export function nonceAsBigInt(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  throw new Error("access key nonce is not a readable nonce: " + JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// near-sandbox binary and node
// ---------------------------------------------------------------------------

function sandboxPlatform(): "Linux-x86_64" | "Linux-aarch64" | null {
  if (process.platform !== "linux") {
    return null;
  }
  if (process.arch === "x64") {
    return "Linux-x86_64";
  }
  if (process.arch === "arm64") {
    return "Linux-aarch64";
  }
  return null;
}

/** Binary path, honouring CYNEX_SANDBOX_BIN_PATH like the Rust crate. */
export function sandboxBinaryPath(version: string = SANDBOX_VERSION): string {
  const fromEnv = (process.env.CYNEX_SANDBOX_BIN_PATH ?? "").trim();
  if (fromEnv !== "") {
    return fromEnv;
  }
  return join(homedir(), ".near", "near-sandbox-" + version, "near-sandbox");
}

/**
 * Ensure the near-sandbox binary exists, downloading it once from
 * the same S3 URL the near-sandbox Rust crate uses, into the same
 * ~/.near cache, so the Rust tests and this suite share it.
 */
export async function ensureSandboxBinary(version: string = SANDBOX_VERSION): Promise<string> {
  const path = sandboxBinaryPath(version);
  if (existsSync(path)) {
    return path;
  }
  const platform = sandboxPlatform();
  if (platform === null) {
    throw new Error(
      "near-sandbox has no prebuilt binary for " +
        process.platform +
        "/" +
        process.arch +
        ", set CYNEX_SANDBOX_BIN_PATH to a local build",
    );
  }
  const url =
    "https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/" +
    platform +
    "/" +
    version +
    "/near-sandbox.tar.gz";
  console.log("downloading near-sandbox " + version + " from " + url);
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok) {
    throw new Error(
      "near-sandbox download failed with HTTP " +
        response.status +
        " from " +
        url +
        ", set CYNEX_SANDBOX_BIN_PATH to a local binary",
    );
  }
  const dlDir = mkdtempSync(join(tmpdir(), "cynex-sandbox-dl-"));
  try {
    const archive = join(dlDir, "near-sandbox.tar.gz");
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    await execFileAsync("tar", ["-xzf", archive, "-C", dlDir]);
    // The binary sits under a platform directory in the archive
    // (Linux-x86_64/near-sandbox), so search for it by name, the
    // same way the near-sandbox Rust crate does, instead of
    // assuming it lands at the top level.
    const extracted = findFileNamed(dlDir, "near-sandbox");
    if (extracted === null) {
      throw new Error("near-sandbox archive did not contain a near-sandbox binary");
    }
    mkdirSync(dirname(path), { recursive: true });
    const tmpDest = path + ".tmp";
    copyFileSync(extracted, tmpDest);
    chmodSync(tmpDest, 0o755);
    renameSync(tmpDest, path);
    return path;
  } finally {
    rmSync(dlDir, { recursive: true, force: true });
  }
}

/** Find a file by name anywhere under a directory, or null. */
function findFileNamed(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileNamed(full, name);
      if (found !== null) {
        return found;
      }
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

export interface RunningSandbox {
  rpcUrl: string;
  chainId: string;
  homeDir: string;
  /** FullAccess secret key for test.near, read from the node's own validator_key.json. */
  masterSecretKey: string;
  stop(): Promise<void>;
}

/**
 * Read the genesis account's FullAccess secret key from the
 * validator key file near-sandbox writes at init. The key is
 * generated fresh on every init, so the well-known key from the
 * near-sandbox crate's docs does not match the running node.
 */
export function readMasterSecretKey(homeDir: string): string {
  const keyPath = join(homeDir, "validator_key.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(keyPath, "utf-8"));
  } catch {
    throw new Error("near-sandbox did not write a validator key at " + keyPath);
  }
  const record = parsed as { account_id?: unknown; secret_key?: unknown };
  if (record.account_id !== GENESIS_ACCOUNT || typeof record.secret_key !== "string") {
    throw new Error("validator key at " + keyPath + " is not a " + GENESIS_ACCOUNT + " key");
  }
  if (!record.secret_key.startsWith("ed25519:")) {
    throw new Error("validator key at " + keyPath + " is not an ed25519 secret key");
  }
  return record.secret_key;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Last lines of a file, for an error message that outlives the
 * file: stop() removes the sandbox home, including its log, so a
 * "see the log" error must carry the tail with it.
 */
function readLogTail(logPath: string, lines = 30): string {
  try {
    return readFileSync(logPath, "utf-8").split("\n").slice(-lines).join("\n");
  } catch {
    return "(sandbox log unreadable)";
  }
}

/** Start a sandbox node and wait for /status to answer with a chain id. */
export async function startSandbox(opts: {
  version?: string;
  timeoutMs?: number;
} = {}): Promise<RunningSandbox> {
  const bin = await ensureSandboxBinary(opts.version ?? SANDBOX_VERSION);
  const homeDir = mkdtempSync(join(scratchBase(), "cynex-sandbox-home-"));
  const rpcPort = await freePort();
  const netPort = await freePort();
  // Init runs before the stop closure exists, so a failure here
  // would leak the temporary home. Remove it and rethrow.
  let masterSecretKey: string;
  try {
    await execFileAsync(bin, ["--home", homeDir, "init", "--fast"], { timeout: 120_000 });
    masterSecretKey = readMasterSecretKey(homeDir);
  } catch (error) {
    rmSync(homeDir, { recursive: true, force: true });
    throw error;
  }
  const rpcUrl = "http://127.0.0.1:" + rpcPort;
  const logPath = join(homeDir, "sandbox.log");
  const logFd = openSync(logPath, "a");
  const child: ChildProcess = spawn(
    bin,
    [
      "--home",
      homeDir,
      "run",
      "--rpc-addr",
      "127.0.0.1:" + rpcPort,
      "--network-addr",
      "127.0.0.1:" + netPort,
    ],
    { stdio: ["ignore", logFd, logFd] },
  );
  const stop = async (): Promise<void> => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await sleepMs(2000);
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }
    try {
      closeSync(logFd);
    } catch {
      // already closed
    }
    rmSync(homeDir, { recursive: true, force: true });
  };
  const deadline = Date.now() + (opts.timeoutMs ?? 180_000);
  let chainId = "";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const tail = readLogTail(logPath);
      await stop();
      throw new Error(
        "near-sandbox exited early with code " + child.exitCode + ", log tail:\n" + tail,
      );
    }
    try {
      const res = await fetch(rpcUrl + "/status", { signal: AbortSignal.timeout(5_000) });
      const body = (await res.json()) as { chain_id?: unknown };
      if (typeof body.chain_id === "string" && body.chain_id !== "") {
        chainId = body.chain_id;
        break;
      }
    } catch {
      // not up yet
    }
    await sleepMs(1000);
  }
  if (chainId === "") {
    const tail = readLogTail(logPath);
    await stop();
    throw new Error(
      "near-sandbox did not answer /status within the timeout, log tail:\n" + tail,
    );
  }
  return { rpcUrl, chainId, homeDir, masterSecretKey, stop };
}

// ---------------------------------------------------------------------------
// Contract wasms
// ---------------------------------------------------------------------------

/**
 * Build one contract wasm with cargo-near. The target dir reuses the
 * existing build tmp dirs on this machine when they exist, so a
 * rebuild is incremental instead of recompiling near-sdk from scratch.
 */
async function buildWasm(crateDir: string, wasmName: string, targetDir: string): Promise<string> {
  const outPath = join(targetDir, "near", wasmName + ".wasm");
  console.log("building " + wasmName + " with cargo-near in " + crateDir);
  try {
    await execFileAsync("cargo", ["near", "build", "non-reproducible-wasm"], {
      cwd: crateDir,
      timeout: 900_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, RUSTUP_TOOLCHAIN: "1.93.0", CARGO_TARGET_DIR: targetDir },
    });
  } catch (error) {
    throw new Error(
      "cargo near build failed for " +
        wasmName +
        " in " +
        crateDir +
        ": " +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  if (existsSync(outPath)) {
    return outPath;
  }
  const fallback = join(crateDir, "target", "near", wasmName + ".wasm");
  if (existsSync(fallback)) {
    return fallback;
  }
  throw new Error(
    "cargo near build finished but no wasm was found at " + outPath + " or " + fallback,
  );
}

function wasmTargetDir(envName: string, existing: string, fresh: string): string {
  const fromEnv = (process.env[envName] ?? "").trim();
  if (fromEnv !== "") {
    return fromEnv;
  }
  if (existsSync(existing)) {
    return existing;
  }
  return join(scratchBase(), fresh);
}


/**
 * A wasm bundled with the MCP package (services/mcp/wasms/) or next to
 * the bundled server (dist/../wasms/). Checked before the build
 * directories, so a packaged demo runs with no Rust and no cargo-near.
 */
function bundledWasmPath(name: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "wasms", name), join(here, "..", "wasms", name)]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/** Vault wasm, built on demand when it is missing. */
export async function ensureVaultWasm(): Promise<string> {
  const fromEnv = (process.env.CYNEX_WASM_PATH ?? "").trim();
  const targetDir = wasmTargetDir(
    "CYNEX_VAULT_TARGET_DIR",
    "/data/workspace/cynex-build-tmp/cynex-phase5",
    "cynex_vault-build",
  );
  const bundled = bundledWasmPath("cynex_vault.wasm");
  const candidates =
    fromEnv !== ""
      ? [fromEnv]
      : [
          ...(bundled === null ? [] : [bundled]),
          join(repoRoot(), "contract", "target", "near", "cynex_vault.wasm"),
          join(targetDir, "near", "cynex_vault.wasm"),
        ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return buildWasm(join(repoRoot(), "contract"), "cynex_vault", targetDir);
}

/** Test token wasm, built on demand when it is missing. */
export async function ensureFtWasm(): Promise<string> {
  const fromEnv = (process.env.CYNEX_FT_WASM_PATH ?? "").trim();
  const targetDir = wasmTargetDir(
    "CYNEX_FT_TARGET_DIR",
    "/data/workspace/cynex-build-tmp/ft-test-token",
    "ft_test_token-build",
  );
  const bundled = bundledWasmPath("ft_test_token.wasm");
  const candidates =
    fromEnv !== ""
      ? [fromEnv]
      : [
          ...(bundled === null ? [] : [bundled]),
          join(repoRoot(), "contract", "ft-test-token", "target", "near", "ft_test_token.wasm"),
          join(targetDir, "near", "ft_test_token.wasm"),
        ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return buildWasm(join(repoRoot(), "contract", "ft-test-token"), "ft_test_token", targetDir);
}

// ---------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------

function accountFor(provider: JsonRpcProvider, accountId: string, keyPair: KeyPair): Account {
  return new Account(
    accountId,
    provider,
    KeyPairSigner.fromSecretKey(keyPair.toString() as KeyPairString),
  );
}

interface NamedAccount {
  accountId: string;
  account: Account;
  keyPair: KeyPair;
}

/**
 * Wait until an account is visible at finality. On a fresh sandbox
 * the final block lags the head by a couple of blocks, so a single
 * read right after the creation transaction can still report the
 * account as missing even though the transaction succeeded.
 */
async function waitForAccount(
  provider: JsonRpcProvider,
  accountId: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await provider.viewAccount({ accountId, blockQuery: { finality: "final" } });
      return;
    } catch (error) {
      lastError = error;
      await sleepMs(500);
    }
  }
  throw new Error(
    "account " + accountId + " never appeared at finality: " + String(lastError),
  );
}

async function createNamedAccount(
  master: Account,
  provider: JsonRpcProvider,
  accountId: string,
): Promise<NamedAccount> {
  const keyPair = KeyPair.fromRandom("ed25519");
  await master.createAccount({
    newAccountId: accountId,
    publicKey: keyPair.getPublicKey(),
    nearToTransfer: ACCOUNT_FUNDING_YOCTO,
  });
  await waitForAccount(provider, accountId);
  return { accountId, account: accountFor(provider, accountId, keyPair), keyPair };
}

async function tokenBalance(
  provider: JsonRpcProvider,
  tokenId: string,
  accountId: string,
): Promise<bigint> {
  const result = await provider.callFunction({
    contractId: tokenId,
    method: "ft_balance_of",
    args: { account_id: accountId },
    blockQuery: { finality: "final" },
  });
  return BigInt(String(result as unknown));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined || typeof value !== "object") {
    throw new Error("chain returned no row, expected an object, got " + JSON.stringify(value));
  }
  return value as Record<string, unknown>;
}

function asBigInt(value: unknown, name: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" || typeof value === "string") {
    return BigInt(String(value));
  }
  throw new Error("chain value " + name + " is not a readable integer: " + JSON.stringify(value));
}

async function readPolicy(vault: CynexClient, policyId: string): Promise<Record<string, unknown>> {
  return asRecord(await vault.getPolicy(policyId));
}

async function readObligation(
  vault: CynexClient,
  obligationId: string,
): Promise<Record<string, unknown>> {
  return asRecord(await vault.getObligation(obligationId));
}

/**
 * Poll a read until it returns an acceptable value. Every read in
 * this suite follows a transaction, and on a fresh sandbox the
 * final block lags the head by a couple of blocks, so a single
 * read can still show the pre-transaction state even though the
 * transaction succeeded. Polling is the fix, not a weaker read.
 */
async function waitForValue<T>(
  label: string,
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      last = await read();
      if (accept(last)) {
        return last;
      }
    } catch (error) {
      lastError = error;
    }
    await sleepMs(500);
  }
  throw new Error(
    "timed out waiting for " + label + ": last value " + JSON.stringify(last) +
      (lastError === undefined ? "" : ", last error " + String(lastError)),
  );
}

async function pollObligationState(
  vault: CynexClient,
  obligationId: string,
  want: string,
  attempts: number,
  intervalMs: number,
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const row = await readObligation(vault, obligationId);
    if (String(row.state ?? "") === want) {
      return true;
    }
    await sleepMs(intervalMs);
  }
  return false;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  console.log("CALL " + name + " " + JSON.stringify(args));
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ text?: string }> | undefined)
    ?.map((c) => c.text ?? "")
    .join("\n");
  console.log("RESPONSE " + name + " isError=" + String(result.isError) + " " + (text ?? ""));
  try {
    return JSON.parse(text ?? "{}") as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}

function txHashFromReason(reason: string): string {
  const match = /settle transaction hash ([A-Za-z0-9]+)/.exec(reason);
  if (match === null) {
    throw new Error("refusal carries no settle transaction hash: " + reason);
  }
  return match[1] as string;
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

export interface SandboxCheck {
  name: string;
  detail: string;
}

export interface SandboxSuiteResult {
  rpcUrl: string;
  chainId: string;
  vaultId: string;
  tokenId: string;
  agentId: string;
  recipientId: string;
  secondRecipientId: string;
  policyId: string;
  vaultCodeHash: string;
  checks: SandboxCheck[];
  txHashes: Record<string, string>;
}

/** One obligation to seed on the sandbox policy. */
export interface SandboxSeedSpec {
  id: string;
  recipient: string;
}

/**
 * Sandbox recipient accounts, fixed so the suite and the demo seed the
 * same accounts. The ids are the account ids, not nicknames, so a
 * caller passes them straight into a seed spec.
 */
export const SANDBOX_RECIPIENT_ID = "recipient.test.near";
export const SANDBOX_SECOND_RECIPIENT_ID = "recipient2.test.near";

export interface ProvisionSandboxOptions {
  /** READY obligations settled directly during provisioning, receipts 0 and up. */
  bootstrap?: SandboxSeedSpec[];
  /** READY obligations left for the caller to settle. */
  ready?: SandboxSeedSpec[];
  /** Obligations left CREATED, with no evidence submitted. */
  created?: SandboxSeedSpec[];
  /** Where provisioning progress goes; defaults to console.log. The demo
   * passes console.error, because in demo mode stdout is the MCP
   * JSON-RPC transport and must carry nothing else. */
  log?: (message: string) => void;
}

export interface ProvisionedSandbox {
  sandbox: RunningSandbox;
  provider: JsonRpcProvider;
  vault: CynexClient;
  ownerId: string;
  vaultId: string;
  tokenId: string;
  agentId: string;
  recipientId: string;
  secondRecipientId: string;
  policyId: string;
  policyLimit: bigint;
  vaultCodeHash: string;
  vaultWasmPath: string;
  ftWasmPath: string;
  agentKeyPair: KeyPair;
  keyFile: string;
  evidenceHashHex: string;
  expiresAtNs: number;
  checks: SandboxCheck[];
  txHashes: Record<string, string>;
  stop(): Promise<void>;
  createReadyObligation(obligationId: string, recipient: string): Promise<void>;
  createCreatedObligation(obligationId: string, recipient: string): Promise<void>;
  settleDirectly(obligationId: string, recipient: string): Promise<string>;
  readObligation(obligationId: string): Promise<Record<string, unknown>>;
  readPolicy(): Promise<Record<string, unknown>>;
  tokenBalance(accountId: string): Promise<bigint>;
}

/**
 * Provision a local sandbox the same way the suite does, and seed it.
 * Steps, in order: start the sandbox, build or verify the wasms (the
 * vault wasm must hash to EXPECTED_VAULT_CODE_HASH), create the
 * accounts, deploy and init both contracts, create and fund the
 * policy, drive the bootstrap and ready obligations to READY through
 * the real evidence flow, leave the created obligations CREATED, give
 * the agent a settle-only function-call key on the vault and verify
 * its scope on chain, write the agent key file into the sandbox home
 * directory (outside the repo, removed when the sandbox stops), then
 * settle the bootstrap obligations directly so both recipients hold
 * a prior receipt and the reputation gate can ALLOW them.
 *
 * The caller owns the sandbox after this returns and must call stop(),
 * even on failure of its own later steps. If provisioning itself
 * fails, the sandbox is stopped here so no node is left running.
 */
export async function provisionSandbox(
  options: ProvisionSandboxOptions = {},
): Promise<ProvisionedSandbox> {
  const checks: SandboxCheck[] = [];
  const txHashes: Record<string, string> = {};
  const log = options.log ?? console.log;
  const check = (name: string, detail: string): void => {
    checks.push({ name, detail });
    log("SANDBOX CHECK " + name + ": " + detail);
  };
  const bootstrapSpecs = options.bootstrap ?? [];
  const readySpecs = options.ready ?? [];
  const createdSpecs = options.created ?? [];
  let obligationNonce = 1;

  const sandbox = await startSandbox();
  try {
    // near-sandbox randomizes its chain id on every init
    // (test-chain-XXXXX), so the suite records the observed id and
    // passes it to the server as the expected chain id, instead of
    // assuming "sandbox". The server still refuses any other network.
    check("sandbox up", "local chain " + sandbox.chainId + " on " + sandbox.rpcUrl);

    const vaultWasmPath = await ensureVaultWasm();
    const ftWasmPath = await ensureFtWasm();
    const vaultWasm = readFileSync(vaultWasmPath);
    const ftWasm = readFileSync(ftWasmPath);
    const vaultCodeHash = codeHashOfWasm(vaultWasm);
    // The suite exercises byte-identical contract code: the local
    // build must hash to the deployed testnet vault hash. Enforced
    // here, not only in the Jest test, so the standalone runner
    // proves it too; a stale or locally modified wasm fails fast.
    if (vaultCodeHash !== EXPECTED_VAULT_CODE_HASH) {
      throw new Error(
        "local vault wasm hash " +
          vaultCodeHash +
          " is not the deployed testnet hash " +
          EXPECTED_VAULT_CODE_HASH,
      );
    }
    check("vault wasm", vaultWasmPath + ", code hash " + vaultCodeHash);

    const provider = new JsonRpcProvider({ url: sandbox.rpcUrl });
    const masterKey = KeyPair.fromString(sandbox.masterSecretKey as never);
    const master = accountFor(provider, GENESIS_ACCOUNT, masterKey);

    const ownerId = "owner.test.near";
    const vaultId = "vault.test.near";
    const tokenId = "token.test.near";
    const agentId = "agent.test.near";
    const recipientId = "recipient.test.near";
    const secondRecipientId = "recipient2.test.near";

    const owner = await createNamedAccount(master, provider, ownerId);
    const vaultAccount = await createNamedAccount(master, provider, vaultId);
    const tokenAccount = await createNamedAccount(master, provider, tokenId);
    const agentAccount = await createNamedAccount(master, provider, agentId);
    await createNamedAccount(master, provider, recipientId);
    await createNamedAccount(master, provider, secondRecipientId);
    check("accounts", "owner, vault, token, agent, and two recipients created under test.near");

    await vaultAccount.account.deployContract(new Uint8Array(vaultWasm));
    const vaultOnChain = await waitForValue(
      "deployed vault code hash",
      async () =>
        (await provider.viewAccount({
          accountId: vaultId,
          blockQuery: { finality: "final" },
        })) as unknown as { code_hash: string },
      (row) => row.code_hash === vaultCodeHash,
    );
    if (vaultOnChain.code_hash !== vaultCodeHash) {
      throw new Error(
        "deployed vault code hash " +
          vaultOnChain.code_hash +
          " does not match the wasm hash " +
          vaultCodeHash,
      );
    }
    check("vault deployed", vaultId + " code hash matches the built wasm");
    await vaultAccount.account.callFunctionRaw({
      contractId: vaultId,
      methodName: "init",
      args: { owner: ownerId },
      gas: GAS_30_TGAS,
      deposit: 0n,
    });

    await tokenAccount.account.deployContract(new Uint8Array(ftWasm));
    await tokenAccount.account.callFunctionRaw({
      contractId: tokenId,
      methodName: "init",
      args: { owner_id: ownerId, total_supply: FT_TOTAL_SUPPLY },
      gas: GAS_30_TGAS,
      deposit: 0n,
    });
    const ownerTokenBalance = await waitForValue(
      "token owner balance",
      () => tokenBalance(provider, tokenId, ownerId),
      (balance) => balance === BigInt(FT_TOTAL_SUPPLY),
    );
    if (ownerTokenBalance !== BigInt(FT_TOTAL_SUPPLY)) {
      throw new Error(
        "token owner balance is " + ownerTokenBalance.toString() + ", expected " + FT_TOTAL_SUPPLY,
      );
    }
    check("token deployed", tokenId + " total supply " + FT_TOTAL_SUPPLY + ", owner holds it all");

    for (const id of [vaultId, recipientId, secondRecipientId]) {
      await owner.account.callFunctionRaw({
        contractId: tokenId,
        methodName: "storage_deposit",
        args: { account_id: id },
        gas: GAS_30_TGAS,
        deposit: STORAGE_COST_YOCTO,
      });
    }

    const vault = new CynexClient(vaultId, sandbox.rpcUrl);
    await owner.account.callFunctionRaw({
      contractId: vaultId,
      methodName: "create_policy",
      // create_policy takes limit as a raw u128, so it must be a
      // JSON number, not a string. A string makes the contract panic
      // with "Failed to deserialize input from JSON".
      args: { policy_id: POLICY_ID, token_id: tokenId, limit: Number(POLICY_LIMIT) },
      gas: GAS_30_TGAS,
      deposit: 0n,
    });
    await owner.account.callFunctionRaw({
      contractId: tokenId,
      methodName: "ft_transfer_call",
      args: {
        receiver_id: vaultId,
        amount: POLICY_LIMIT.toString(),
        memo: null,
        msg: JSON.stringify({ fund_policy: POLICY_ID }),
      },
      gas: GAS_100_TGAS,
      deposit: 1n,
    });
    const policy = await waitForValue(
      "funded policy",
      () => readPolicy(vault, POLICY_ID),
      (row) =>
        asBigInt(row.funded, "funded") === POLICY_LIMIT &&
        asBigInt(row.limit, "limit") === POLICY_LIMIT &&
        asBigInt(row.spent, "spent") === 0n,
    );
    if (
      asBigInt(policy.funded, "funded") !== POLICY_LIMIT ||
      asBigInt(policy.limit, "limit") !== POLICY_LIMIT ||
      asBigInt(policy.spent, "spent") !== 0n
    ) {
      throw new Error("policy did not fund as expected: " + JSON.stringify(policy));
    }
    check(
      "policy funded",
      POLICY_ID + " limit " + POLICY_LIMIT.toString() + " funded " + POLICY_LIMIT.toString(),
    );

    const preimage = [...PREIMAGE];
    const evidenceHash = [...createHash("sha256").update(PREIMAGE).digest()];
    const evidenceHashHex = createHash("sha256").update(PREIMAGE).digest("hex");
    const expiresAtNs = Number(BigInt(Date.now()) * 1000000n + 86400000000000n);
    async function makeReadyObligation(
      obligationId: string,
      recipient: string,
      nonce: string,
    ): Promise<void> {
      await owner.account.callFunctionRaw({
        contractId: vaultId,
        methodName: "create_obligation",
        args: {
          obligation_id: obligationId,
          policy_id: POLICY_ID,
          recipient,
          // amount, expires_at_ns, and nonce are raw u128/u64 in
          // the contract, so they go over as JSON numbers. The
          // settle and token calls keep strings because those
          // methods take U128.
          amount: Number(OBLIGATION_AMOUNT),
          evidence_type: "PREIMAGE",
          evidence_hash: evidenceHash,
          expires_at_ns: expiresAtNs,
          nonce: Number(nonce),
        },
        gas: GAS_30_TGAS,
        deposit: 0n,
      });
      await owner.account.callFunctionRaw({
        contractId: vaultId,
        methodName: "request_evidence",
        args: { obligation_id: obligationId },
        gas: GAS_30_TGAS,
        deposit: 0n,
      });
      const pending = await waitForValue(
        "pending request id for " + obligationId,
        () => readObligation(vault, obligationId),
        (row) => typeof row.pending_request_id === "string",
      );
      if (typeof pending.pending_request_id !== "string") {
        throw new Error(
          "obligation " + obligationId + " has no pending_request_id after request_evidence",
        );
      }
      await owner.account.callFunctionRaw({
        contractId: vaultId,
        methodName: "submit_evidence_preimage",
        args: {
          request_id: pending.pending_request_id,
          obligation_id: obligationId,
          evidence: preimage,
        },
        gas: GAS_30_TGAS,
        deposit: 0n,
      });
      const ready = await waitForValue(
        "READY state for " + obligationId,
        () => readObligation(vault, obligationId),
        (row) => String(row.state ?? "") === "READY",
      );
      if (String(ready.state ?? "") !== "READY") {
        throw new Error(
          "obligation " + obligationId + " is " + String(ready.state ?? "") + ", not READY",
        );
      }
    }
    async function makeCreatedObligation(
      obligationId: string,
      recipient: string,
      nonce: string,
    ): Promise<void> {
      await owner.account.callFunctionRaw({
        contractId: vaultId,
        methodName: "create_obligation",
        args: {
          obligation_id: obligationId,
          policy_id: POLICY_ID,
          recipient,
          amount: Number(OBLIGATION_AMOUNT),
          evidence_type: "PREIMAGE",
          evidence_hash: evidenceHash,
          expires_at_ns: expiresAtNs,
          nonce: Number(nonce),
        },
        gas: GAS_30_TGAS,
        deposit: 0n,
      });
      const created = await waitForValue(
        "CREATED state for " + obligationId,
        () => readObligation(vault, obligationId),
        (row) => String(row.state ?? "") === "CREATED",
      );
      if (String(created.state ?? "") !== "CREATED") {
        throw new Error(
          "obligation " +
            obligationId +
            " is " +
            String(created.state ?? "") +
            ", not CREATED",
        );
      }
    }
    for (const spec of [...bootstrapSpecs, ...readySpecs]) {
      await makeReadyObligation(spec.id, spec.recipient, String(obligationNonce));
      obligationNonce += 1;
    }
    for (const spec of createdSpecs) {
      await makeCreatedObligation(spec.id, spec.recipient, String(obligationNonce));
      obligationNonce += 1;
    }
    check(
      "obligations READY",
      String(bootstrapSpecs.length + readySpecs.length) +
        " PREIMAGE obligations READY on " +
        POLICY_ID +
        (createdSpecs.length === 0 ? "" : ", " + createdSpecs.length + " CREATED"),
    );

    const agentKeyPair = KeyPair.fromRandom("ed25519");
    await agentAccount.account.signAndSendTransaction({
      receiverId: agentId,
      actions: [
        actions.addFunctionCallAccessKey(
          agentKeyPair.getPublicKey(),
          vaultId,
          ["settle"],
          AGENT_ALLOWANCE_YOCTO,
        ),
      ],
    });
    const keyList = await waitForValue(
      "agent key on chain",
      async () =>
        (await vault.viewAccessKeyList(agentId)) as {
          keys?: Array<{
            public_key: string;
            access_key: { permission: unknown };
          }>;
        },
      (list) =>
        (list.keys ?? []).some(
          (entry) => entry.public_key === agentKeyPair.getPublicKey().toString(),
        ),
    );
    const agentEntry = (keyList.keys ?? []).find(
      (entry) => entry.public_key === agentKeyPair.getPublicKey().toString(),
    );
    const agentPermission = agentEntry?.access_key.permission as
      | { FunctionCall?: { receiver_id?: string; method_names?: string[]; allowance?: string } }
      | undefined;
    if (
      agentPermission?.FunctionCall?.receiver_id !== vaultId ||
      JSON.stringify(agentPermission?.FunctionCall?.method_names ?? []) !==
        JSON.stringify(["settle"]) ||
      agentPermission?.FunctionCall?.allowance !== AGENT_ALLOWANCE_YOCTO.toString()
    ) {
      throw new Error(
        "agent key scope on chain is not a settle-only key with the expected finite allowance on the vault: " +
          JSON.stringify(agentPermission),
      );
    }
    check(
      "agent key scoped",
      "settle-only function-call key on " + vaultId + ", allowance " + AGENT_ALLOWANCE_YOCTO.toString(),
    );
    const keyFile = join(sandbox.homeDir, "agent-key.txt");
    writeFileSync(keyFile, agentKeyPair.toString() + "\n", "utf-8");

    const agentSigner = accountFor(provider, agentId, agentKeyPair);
    async function directSettle(obligationId: string, recipient: string): Promise<string> {
      const outcome = await agentSigner.callFunctionRaw({
        contractId: vaultId,
        methodName: "settle",
        args: {
          obligation_id: obligationId,
          proposed_recipient: recipient,
          proposed_amount: OBLIGATION_AMOUNT,
          evidence_ref: "sandbox-bootstrap",
        },
        gas: GAS_100_TGAS,
        deposit: 0n,
      });
      const hash = txHashOf(outcome);
      if (hash === "unknown") {
        throw new Error("direct settle " + obligationId + " returned no transaction hash");
      }
      const paid = await pollObligationState(vault, obligationId, "PAID", 30, 1000);
      if (!paid) {
        throw new Error("direct settle " + obligationId + " did not read PAID");
      }
      return hash;
    }
    for (let i = 0; i < bootstrapSpecs.length; i++) {
      const spec = bootstrapSpecs[i] as SandboxSeedSpec;
      txHashes["bootstrap-00" + (i + 1)] = await directSettle(spec.id, spec.recipient);
    }
    if (bootstrapSpecs.length > 0) {
      const bootstrapIds = bootstrapSpecs.map((spec) => spec.id);
      const receiptsAfterBootstrap = await waitForValue(
        bootstrapIds.length + " bootstrap receipts",
        async () => (await vault.receipts(0n, 10n)) as Array<Record<string, unknown>>,
        (rows) =>
          rows.length === bootstrapIds.length &&
          rows.every((row, i) => row.obligation_id === bootstrapIds[i]),
      );
      if (
        receiptsAfterBootstrap.length !== bootstrapIds.length ||
        !receiptsAfterBootstrap.every((row, i) => row.obligation_id === bootstrapIds[i])
      ) {
        throw new Error(
          "receipts after bootstrap are not the bootstrap receipts: " +
            JSON.stringify(receiptsAfterBootstrap),
        );
      }
      check(
        "reputation bootstrap",
        bootstrapIds.length +
          " direct settles PAID, receipts 0 to " +
          (bootstrapIds.length - 1) +
          ", both recipients hold a prior receipt",
      );
    }
    const provisioned: ProvisionedSandbox = {
      sandbox,
      provider,
      vault,
      ownerId,
      vaultId,
      tokenId,
      agentId,
      recipientId,
      secondRecipientId,
      policyId: POLICY_ID,
      policyLimit: POLICY_LIMIT,
      vaultCodeHash,
      vaultWasmPath,
      ftWasmPath,
      agentKeyPair,
      keyFile,
      evidenceHashHex,
      expiresAtNs,
      checks,
      txHashes,
      stop: () => sandbox.stop(),
      createReadyObligation: async (
        obligationId: string,
        recipient: string,
      ): Promise<void> => {
        await makeReadyObligation(obligationId, recipient, String(obligationNonce));
        obligationNonce += 1;
      },
      createCreatedObligation: async (
        obligationId: string,
        recipient: string,
      ): Promise<void> => {
        await makeCreatedObligation(obligationId, recipient, String(obligationNonce));
        obligationNonce += 1;
      },
      settleDirectly: async (obligationId: string, recipient: string): Promise<string> => {
        return directSettle(obligationId, recipient);
      },
      readObligation: async (obligationId: string): Promise<Record<string, unknown>> => {
        return readObligation(vault, obligationId);
      },
      readPolicy: async (): Promise<Record<string, unknown>> => {
        return readPolicy(vault, POLICY_ID);
      },
      tokenBalance: async (accountId: string): Promise<bigint> => {
        return tokenBalance(provider, tokenId, accountId);
      },
    };
    return provisioned;
  } catch (error) {
    try {
      await sandbox.stop();
    } catch {
      // stopping after a failed provision must not hide the failure
    }
    throw error;
  }
}

/**
 * Run the full sandbox suite and return the checks and transaction
 * hashes. Throws on the first failed expectation, naming the exact
 * on-chain values it saw. The sandbox is stopped even on failure.
 */
export async function runSandboxMcpSuite(): Promise<SandboxSuiteResult> {
  const provisioned = await provisionSandbox({
    bootstrap: [
      { id: "sandbox-bootstrap-001", recipient: SANDBOX_RECIPIENT_ID },
      { id: "sandbox-bootstrap-002", recipient: SANDBOX_SECOND_RECIPIENT_ID },
    ],
    ready: [
      { id: "sandbox-mcp-001", recipient: SANDBOX_RECIPIENT_ID },
      { id: "sandbox-negative-001", recipient: SANDBOX_RECIPIENT_ID },
    ],
  });
  const sandbox = provisioned.sandbox;
  const provider = provisioned.provider;
  const vault = provisioned.vault;
  const agentKeyPair = provisioned.agentKeyPair;
  const keyFile = provisioned.keyFile;
  const vaultCodeHash = provisioned.vaultCodeHash;
  const evidenceHashHex = provisioned.evidenceHashHex;
  const expiresAtNs = provisioned.expiresAtNs;
  const vaultId = provisioned.vaultId;
  const tokenId = provisioned.tokenId;
  const agentId = provisioned.agentId;
  const recipientId = provisioned.recipientId;
  const secondRecipientId = provisioned.secondRecipientId;
  const checks = provisioned.checks;
  const txHashes = provisioned.txHashes;
  const check = (name: string, detail: string): void => {
    checks.push({ name, detail });
    console.log("SANDBOX CHECK " + name + ": " + detail);
  };
  try {
    const savedEnv: Record<string, string | undefined> = {};
    for (const name of [
      "CYNEX_VAULT",
      "CYNEX_AGENT",
      "CYNEX_AGENT_KEY_FILE",
      "CYNEX_SANDBOX_RPC_URL",
      "CYNEX_SANDBOX_VAULT_CODE_HASH",
      "CYNEX_SANDBOX_CHAIN_ID",
      "CYNEX_RPC_URL",
    ]) {
      savedEnv[name] = process.env[name];
    }
    const mcp = await (async (): Promise<{
      counterpartyVerdict: string;
      mcpTxHash: string;
      negativeTxHash: string;
    }> => {
      process.env.CYNEX_VAULT = vaultId;
      process.env.CYNEX_AGENT = agentId;
      process.env.CYNEX_AGENT_KEY_FILE = keyFile;
      process.env.CYNEX_SANDBOX_RPC_URL = sandbox.rpcUrl;
      process.env.CYNEX_SANDBOX_VAULT_CODE_HASH = vaultCodeHash;
      process.env.CYNEX_SANDBOX_CHAIN_ID = sandbox.chainId;
      delete process.env.CYNEX_RPC_URL;
      // buildContext and buildServer run inside the try, so a
      // startup failure still restores the environment. They used
      // to run before the try, and a throw there left the sandbox
      // configuration in the process for whatever ran next.
      let server: ReturnType<typeof buildServer> | undefined;
      let client: Client | undefined;
      try {
        const ctx = await buildContext();
        server = buildServer(ctx);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        client = new Client(
          { name: "cynex-sandbox-suite", version: "0.1.0" },
          { capabilities: {} },
        );
        await server.connect(serverTransport);
        await client.connect(clientTransport);

        const counterparty = await callTool(client, "cynex_check_counterparty", {
          account_id: recipientId,
        });
        if (counterparty.ok !== true) {
          throw new Error("counterparty check failed: " + JSON.stringify(counterparty));
        }
        const counterpartyData = asRecord(counterparty.data);
        const verdict = String(counterpartyData.verdict ?? "");
        if (verdict !== "ALLOW") {
          throw new Error(
            "counterparty check for the recipient is " +
              verdict +
              ", not ALLOW, reasons: " +
              JSON.stringify(counterpartyData.reasons ?? counterparty.reason ?? ""),
          );
        }
        check(
          "counterparty ALLOW",
          recipientId + " verdict ALLOW score " + String(counterpartyData.score ?? ""),
        );

        const policyOut = await callTool(client, "cynex_get_policy", { policy_id: POLICY_ID });
        if (policyOut.ok !== true) {
          throw new Error("MCP policy read failed: " + JSON.stringify(policyOut));
        }
        const policyRow = asRecord(asRecord(policyOut.data).policy);
        if (
          asBigInt(policyRow.spent, "spent") !== 200n ||
          asBigInt(policyRow.funded, "funded") !== POLICY_LIMIT
        ) {
          throw new Error(
            "MCP policy read is not the funded sandbox policy: " + JSON.stringify(policyRow),
          );
        }
        check(
          "MCP policy read",
          POLICY_ID + " spent 200 funded " + POLICY_LIMIT.toString() + " after bootstrap",
        );

        const receiptsOut = await callTool(client, "cynex_list_receipts", { start: 0, limit: 5 });
        if (receiptsOut.ok !== true) {
          throw new Error("MCP receipts list failed: " + JSON.stringify(receiptsOut));
        }
        const receiptRows = (asRecord(receiptsOut.data).receipts ?? []) as Array<
          Record<string, unknown>
        >;
        if (
          receiptRows.length !== 2 ||
          receiptRows[0]?.obligation_id !== "sandbox-bootstrap-001" ||
          receiptRows[1]?.obligation_id !== "sandbox-bootstrap-002"
        ) {
          throw new Error(
            "MCP receipts list is not the two bootstrap receipts: " +
              JSON.stringify(receiptRows),
          );
        }
        check(
          "MCP receipts list",
          "2 receipts read from the sandbox vault: sandbox-bootstrap-001 and sandbox-bootstrap-002",
        );

        const obligationOut = await callTool(client, "cynex_get_obligation", {
          obligation_id: "sandbox-mcp-001",
        });
        if (obligationOut.ok !== true) {
          throw new Error("MCP obligation read failed: " + JSON.stringify(obligationOut));
        }
        const obligationData = asRecord(obligationOut.data);
        if (
          String(obligationData.state ?? "") !== "READY" ||
          String(obligationData.recipient ?? "") !== recipientId ||
          asBigInt(obligationData.amount, "amount") !== 100n
        ) {
          throw new Error(
            "MCP obligation read is not the READY sandbox obligation: " +
              JSON.stringify(obligationData),
          );
        }
        check("MCP obligation read", "sandbox-mcp-001 READY for 100 to " + recipientId);

        const prepareOut = await callTool(client, "cynex_prepare_obligation", {
          policy_id: POLICY_ID,
          obligation_id: "sandbox-prepare-001",
          recipient: recipientId,
          amount: "100",
          evidence_type: "PREIMAGE",
          evidence_hash: evidenceHashHex,
          // The MCP tool takes a decimal string and converts it
          // internally; the contract call above takes a JSON number.
          expires_at_ns: expiresAtNs.toString(),
          nonce: "90001",
        });
        if (prepareOut.ok !== true) {
          throw new Error("MCP prepare failed: " + JSON.stringify(prepareOut));
        }
        const prepareData = asRecord(prepareOut.data);
        if (
          String(prepareData.label ?? "") !== "Prepared, not authorized or submitted"
        ) {
          throw new Error(
            "MCP prepare did not return the prepared label: " + JSON.stringify(prepareOut),
          );
        }
        check("MCP prepare", "sandbox-prepare-001 prepared, nothing submitted");

        const balanceBefore = await tokenBalance(provider, tokenId, recipientId);
        const settleOut = await callTool(client, "cynex_request_settlement", {
          obligation_id: "sandbox-mcp-001",
          proposed_recipient: recipientId,
          proposed_amount: "100",
          evidence_ref: "sandbox-report-v1",
        });
        if (settleOut.ok !== true) {
          throw new Error("MCP settle failed: " + JSON.stringify(settleOut));
        }
        const settleData = asRecord(settleOut.data);
        if (
          String(settleData.state ?? "") !== "PAID" ||
          String(settleData.receipt_index ?? "") !== "2" ||
          asBigInt(settleData.balance_delta, "balance_delta") !== 100n
        ) {
          throw new Error(
            "MCP settle did not return PAID with receipt 2 and delta 100: " +
              JSON.stringify(settleOut),
          );
        }
        const mcpTxHash = String(settleData.settle_tx_hash ?? "");
        if (mcpTxHash === "") {
          throw new Error("MCP settle returned no settle transaction hash");
        }
        txHashes["mcp-001"] = mcpTxHash;
        const balanceAfter = await waitForValue(
          "recipient balance after MCP settle",
          () => tokenBalance(provider, tokenId, recipientId),
          (balance) => balance - balanceBefore === 100n,
        );
        if (balanceAfter - balanceBefore !== 100n) {
          throw new Error(
            "recipient token balance moved by " +
              (balanceAfter - balanceBefore).toString() +
              ", expected exactly 100",
          );
        }
        check(
          "MCP settle PAID",
          "sandbox-mcp-001 PAID receipt 2, balance delta exactly 100, tx " + mcpTxHash,
        );

        const secondBefore = await tokenBalance(provider, tokenId, secondRecipientId);
        const negativeOut = await callTool(client, "cynex_request_settlement", {
          obligation_id: "sandbox-negative-001",
          proposed_recipient: secondRecipientId,
          proposed_amount: "100",
          evidence_ref: "sandbox-report-v1",
        });
        if (
          negativeOut.ok !== false ||
          !String(negativeOut.reason ?? "").includes("ERR_RECIPIENT_SUBSTITUTION")
        ) {
          throw new Error(
            "changed-recipient settle was not refused by the vault with ERR_RECIPIENT_SUBSTITUTION: " +
              JSON.stringify(negativeOut),
          );
        }
        const negativeTxHash = txHashFromReason(String(negativeOut.reason ?? ""));
        txHashes["negative-001"] = negativeTxHash;
        // Poll both reads to finality, like every other
        // post-transaction read in this suite: a read right after
        // the refused transaction can observe pre-transaction
        // state. The refusal itself is already proven by the
        // receipt outcome the MCP tool read to produce the error;
        // these reads are the corroboration that no funds moved
        // and the obligation stayed READY.
        await waitForValue(
          "second recipient balance unchanged after refused settle",
          () => tokenBalance(provider, tokenId, secondRecipientId),
          (balance) => balance === secondBefore,
        );
        await waitForValue(
          "refused obligation still READY",
          () => readObligation(vault, "sandbox-negative-001"),
          (row) => String(row.state ?? "") === "READY",
        );
        check(
          "vault refuses changed recipient",
          "ERR_RECIPIENT_SUBSTITUTION, no funds moved, obligation still READY, tx " +
            negativeTxHash,
        );

        const replayOut = await callTool(client, "cynex_request_settlement", {
          obligation_id: "sandbox-mcp-001",
          proposed_recipient: recipientId,
          proposed_amount: "100",
          evidence_ref: "sandbox-report-v1",
        });
        if (
          replayOut.ok !== false ||
          !String(replayOut.reason ?? "").includes("not READY")
        ) {
          throw new Error(
            "replay was not refused as not READY: " + JSON.stringify(replayOut),
          );
        }
        check("replay refused", "settled obligation refused as not READY, no submit");

        // Prepare submits nothing: the prepared obligation must not
        // exist on chain after the prepare call.
        let prepareCreated = false;
        try {
          await readObligation(vault, "sandbox-prepare-001");
          prepareCreated = true;
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("no row")) {
            throw error;
          }
        }
        if (prepareCreated) {
          throw new Error(
            "prepare created sandbox-prepare-001 on chain, it must submit nothing",
          );
        }
        check("prepare submits nothing", "sandbox-prepare-001 does not exist on chain");

        // The agent access-key nonce, read live: a failed
        // transaction still consumes a nonce on NEAR, so an
        // unchanged nonce is the proof the refused attempt
        // submitted nothing.
        async function agentNonce(): Promise<bigint> {
          const key = (await provider.viewAccessKey({
            accountId: agentId,
            publicKey: agentKeyPair.getPublicKey().toString(),
            finalityQuery: { finality: "final" },
          })) as unknown as { nonce?: unknown };
          return nonceAsBigInt(key.nonce);
        }
        // Negative: a second server configured with the wrong
        // expected vault code hash must refuse the settle at the
        // runtime check, on the same live chain, without submitting
        // anything. sandbox-negative-001 is still READY, so the
        // refusal can only come from the runtime check. The wrong
        // hash is the test token's real hash: valid base58, but not
        // the vault's.
        const nonceBefore = await agentNonce();
        const savedHash = process.env.CYNEX_SANDBOX_VAULT_CODE_HASH;
        process.env.CYNEX_SANDBOX_VAULT_CODE_HASH =
          "bvJCULdyrVfhtZ9Wvk2xEBwVY8aC1vwx3TKb2gniuLM";
        const tamperedCtx = await buildContext();
        const tamperedServer = buildServer(tamperedCtx);
        const [tamperedClientTransport, tamperedServerTransport] =
          InMemoryTransport.createLinkedPair();
        const tamperedClient = new Client(
          { name: "cynex-sandbox-tampered", version: "0.1.0" },
          { capabilities: {} },
        );
        try {
          await tamperedServer.connect(tamperedServerTransport);
          await tamperedClient.connect(tamperedClientTransport);
          const tamperedOut = await callTool(tamperedClient, "cynex_request_settlement", {
            obligation_id: "sandbox-negative-001",
            proposed_recipient: recipientId,
            proposed_amount: "100",
            evidence_ref: "sandbox-report-v1",
          });
          if (
            tamperedOut.ok !== false ||
            !String(tamperedOut.reason ?? "").includes("code hash")
          ) {
            throw new Error(
              "wrong code hash was not refused at the runtime check: " +
                JSON.stringify(tamperedOut),
            );
          }
          const nonceAfter = await agentNonce();
          if (nonceAfter !== nonceBefore) {
            throw new Error(
              "wrong code hash attempt moved the agent nonce from " +
                nonceBefore.toString() +
                " to " +
                nonceAfter.toString() +
                ", a transaction was submitted",
            );
          }
          check(
            "wrong code hash refused",
            "tampered server refused the settle at the runtime check, agent nonce unchanged at " +
              nonceBefore.toString(),
          );
        } finally {
          try {
            await tamperedClient.close();
          } catch {
            // closing must not hide the suite result
          }
          try {
            await tamperedServer.close();
          } catch {
            // same as above
          }
          if (savedHash === undefined) {
            delete process.env.CYNEX_SANDBOX_VAULT_CODE_HASH;
          } else {
            process.env.CYNEX_SANDBOX_VAULT_CODE_HASH = savedHash;
          }
        }

        const finalPolicy = await waitForValue(
          "final policy spent 300",
          () => readPolicy(vault, POLICY_ID),
          (row) => asBigInt(row.spent, "spent") === 300n,
        );
        if (asBigInt(finalPolicy.spent, "spent") !== 300n) {
          throw new Error(
            "final policy spent is " + String(finalPolicy.spent ?? "") + ", expected 300",
          );
        }
        check("final policy spent", "300 after two bootstraps and one MCP settle");

        return { counterpartyVerdict: verdict, mcpTxHash, negativeTxHash };
      } finally {
        try {
          await client?.close();
        } catch {
          // closing a failed client must not hide the suite result
        }
        try {
          await server?.close();
        } catch {
          // same as above
        }
        for (const [name, value] of Object.entries(savedEnv)) {
          if (value === undefined) {
            delete process.env[name];
          } else {
            process.env[name] = value;
          }
        }
      }
    })();
    check("MCP tools over sandbox", "counterparty " + mcp.counterpartyVerdict);
    return {
      rpcUrl: sandbox.rpcUrl,
      chainId: sandbox.chainId,
      vaultId,
      tokenId,
      agentId,
      recipientId,
      secondRecipientId,
      policyId: POLICY_ID,
      vaultCodeHash,
      checks,
      txHashes,
    };
  } finally {
    try {
      await sandbox.stop();
    } catch {
      // stopping must not hide the suite result
    }
  }
}
