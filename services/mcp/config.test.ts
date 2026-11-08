/**
 * MCP config tests: the startup scope check must refuse a
 * full-access key, a wrong receiver, or broader methods, and
 * accept exactly a settle-only key on the configured vault.
 * The key material is never in a refusal reason.
 */
import {
  isSandboxRpcUrl,
  loadConfig,
  readAgentKey,
  verifyKeyScope,
  type AccessKeyEntry,
} from "./config.js";
import { KeyPair } from "near-api-js";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function entry(publicKey: string, permission: AccessKeyEntry["access_key"]["permission"]): AccessKeyEntry {
  return { public_key: publicKey, access_key: { nonce: 1, permission } };
}

const PUB = "ed25519:TESTPUBKEY";
const VAULT = "cynex-testvault.cynexmaster.testnet";

function list(...entries: AccessKeyEntry[]): { keys: AccessKeyEntry[] } {
  return { keys: entries };
}

describe("loadConfig", () => {
  test("refuses when a required variable is missing", () => {
    expect(() => loadConfig({})).toThrow(/CYNEX_VAULT/);
    expect(() => loadConfig({ CYNEX_VAULT: VAULT })).toThrow(/CYNEX_AGENT/);
    expect(() => loadConfig({ CYNEX_VAULT: VAULT, CYNEX_AGENT: "cynex-agent.cynexmaster.testnet" })).toThrow(
      /CYNEX_AGENT_KEY_FILE/,
    );
  });

  test("reads the console CYNEX_* pattern, with the testnet RPC default", () => {
    const config = loadConfig({
      CYNEX_VAULT: VAULT,
      CYNEX_AGENT: "cynex-agent.cynexmaster.testnet",
      CYNEX_AGENT_KEY_FILE: "/tmp/agent-key.json",
      CYNEX_SNAPSHOT_DIR: "/tmp/snaps",
    });
    expect(config.vaultId).toBe(VAULT);
    expect(config.rpcUrl).toBe("https://rpc.testnet.fastnear.com");
    expect(config.snapshotDir).toBe("/tmp/snaps");
    expect(config.blocklistUrl).toBeUndefined();
  });

  test("refuses a non-testnet RPC URL", () => {
    const base = {
      CYNEX_VAULT: VAULT,
      CYNEX_AGENT: "cynex-agent.cynexmaster.testnet",
      CYNEX_AGENT_KEY_FILE: "/tmp/agent-key.json",
    };
    expect(() =>
      loadConfig({ ...base, CYNEX_RPC_URL: "https://rpc.mainnet.fastnear.com" }),
    ).toThrow(/not a testnet RPC URL/);
    expect(() => loadConfig({ ...base, CYNEX_RPC_URL: "http://localhost:3030" })).toThrow(
      /not a testnet RPC URL/,
    );
  });

  test("accepts the known testnet RPC hosts", () => {
    const base = {
      CYNEX_VAULT: VAULT,
      CYNEX_AGENT: "cynex-agent.cynexmaster.testnet",
      CYNEX_AGENT_KEY_FILE: "/tmp/agent-key.json",
    };
    expect(loadConfig({ ...base, CYNEX_RPC_URL: "https://test.rpc.fastnear.com" }).rpcUrl).toBe(
      "https://test.rpc.fastnear.com",
    );
    expect(loadConfig({ ...base, CYNEX_RPC_URL: "https://rpc.testnet.near.org" }).rpcUrl).toBe(
      "https://rpc.testnet.near.org",
    );
  });

  test("the testnet path is not sandbox mode", () => {
    const config = loadConfig({
      CYNEX_VAULT: VAULT,
      CYNEX_AGENT: "cynex-agent.cynexmaster.testnet",
      CYNEX_AGENT_KEY_FILE: "/tmp/agent-key.json",
    });
    expect(config.sandbox).toBe(false);
    expect(config.expectedChainId).toBe("testnet");
    expect(config.expectedVaultCodeHash).toBe("65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6");
  });

  test("sandbox mode accepts a loopback RPC with the deployed wasm hash", () => {
    const config = loadConfig({
      CYNEX_VAULT: VAULT,
      CYNEX_AGENT: "cynex-agent.cynexmaster.testnet",
      CYNEX_AGENT_KEY_FILE: "/tmp/agent-key.json",
      CYNEX_SANDBOX_RPC_URL: "http://127.0.0.1:3030",
      CYNEX_SANDBOX_VAULT_CODE_HASH: "65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6",
    });
    expect(config.sandbox).toBe(true);
    expect(config.rpcUrl).toBe("http://127.0.0.1:3030");
    expect(config.expectedChainId).toBe("sandbox");
    expect(config.expectedVaultCodeHash).toBe("65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6");
  });

  test("sandbox mode takes the expected chain id from CYNEX_SANDBOX_CHAIN_ID", () => {
    const config = loadConfig({
      CYNEX_VAULT: VAULT,
      CYNEX_AGENT: "cynex-agent.cynexmaster.testnet",
      CYNEX_AGENT_KEY_FILE: "/tmp/agent-key.json",
      CYNEX_SANDBOX_RPC_URL: "http://127.0.0.1:3030",
      CYNEX_SANDBOX_VAULT_CODE_HASH: "65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6",
      CYNEX_SANDBOX_CHAIN_ID: "test-chain-AJwDw",
    });
    expect(config.sandbox).toBe(true);
    expect(config.expectedChainId).toBe("test-chain-AJwDw");
  });

  test("sandbox mode refuses a chain id that names a real network", () => {
    for (const chainId of ["testnet", "mainnet"]) {
      expect(() =>
        loadConfig({
          CYNEX_VAULT: VAULT,
          CYNEX_AGENT: "cynex-agent.cynexmaster.testnet",
          CYNEX_AGENT_KEY_FILE: "/tmp/agent-key.json",
          CYNEX_SANDBOX_RPC_URL: "http://127.0.0.1:3030",
          CYNEX_SANDBOX_VAULT_CODE_HASH: "65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6",
          CYNEX_SANDBOX_CHAIN_ID: chainId,
        }),
      ).toThrow(/must not name a real network/);
    }
  });

  test("isSandboxRpcUrl accepts only the literal loopback address with a port", () => {
    expect(isSandboxRpcUrl("http://127.0.0.1:3030")).toBe(true);
    expect(isSandboxRpcUrl("http://localhost:3030")).toBe(false);
    expect(isSandboxRpcUrl("http://127.0.0.1")).toBe(false);
    expect(isSandboxRpcUrl("https://127.0.0.1:3030")).toBe(false);
    expect(isSandboxRpcUrl("http://127.0.0.1.evil.com:3030")).toBe(false);
    expect(isSandboxRpcUrl("not a url")).toBe(false);
  });

  test("a partial sandbox configuration is refused instead of falling back to testnet", () => {
    const base = {
      CYNEX_VAULT: VAULT,
      CYNEX_AGENT: "cynex-agent.cynexmaster.testnet",
      CYNEX_AGENT_KEY_FILE: "/tmp/agent-key.json",
    };
    expect(() =>
      loadConfig({
        ...base,
        CYNEX_SANDBOX_VAULT_CODE_HASH:
          "65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6",
      }),
    ).toThrow(/without CYNEX_SANDBOX_RPC_URL/);
    expect(() => loadConfig({ ...base, CYNEX_SANDBOX_CHAIN_ID: "test-chain-AJwDw" })).toThrow(
      /without CYNEX_SANDBOX_RPC_URL/,
    );
  });

  test("sandbox mode refuses a localhost RPC URL, it is never resolved", () => {
    const base = {
      CYNEX_VAULT: VAULT,
      CYNEX_AGENT: "cynex-agent.cynexmaster.testnet",
      CYNEX_AGENT_KEY_FILE: "/tmp/agent-key.json",
      CYNEX_SANDBOX_VAULT_CODE_HASH: "65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6",
    };
    expect(() =>
      loadConfig({ ...base, CYNEX_SANDBOX_RPC_URL: "http://localhost:3030" }),
    ).toThrow();
  });

  test("sandbox mode refuses a remote URL, a missing hash, and both RPC variables", () => {
    const base = {
      CYNEX_VAULT: VAULT,
      CYNEX_AGENT: "cynex-agent.cynexmaster.testnet",
      CYNEX_AGENT_KEY_FILE: "/tmp/agent-key.json",
    };
    expect(() =>
      loadConfig({
        ...base,
        CYNEX_SANDBOX_RPC_URL: "https://rpc.testnet.fastnear.com",
        CYNEX_SANDBOX_VAULT_CODE_HASH: "65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6",
      }),
    ).toThrow(/not a loopback sandbox RPC URL/);
    expect(() =>
      loadConfig({
        ...base,
        CYNEX_SANDBOX_RPC_URL: "http://127.0.0.1:3030",
      }),
    ).toThrow(/not a base58 vault code hash/);
    expect(() =>
      loadConfig({
        ...base,
        CYNEX_SANDBOX_RPC_URL: "http://127.0.0.1:3030",
        CYNEX_SANDBOX_VAULT_CODE_HASH: "65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6",
        CYNEX_RPC_URL: "https://rpc.testnet.fastnear.com",
      }),
    ).toThrow(/both set/);
  });
});

describe("readAgentKey", () => {
  function writeKeyFile(content: string): string {
    const file = join(
      tmpdir(),
      "cynex-mcp-test-key-" + Date.now() + "-" + Math.floor(Math.random() * 1000000) + ".txt",
    );
    writeFileSync(file, content);
    return file;
  }

  test("accepts a JSON key file whose public_key matches its private_key", () => {
    const pair = KeyPair.fromRandom("ed25519");
    const file = writeKeyFile(
      JSON.stringify({
        account_id: "cynex-agent.cynexmaster.testnet",
        public_key: pair.getPublicKey().toString(),
        private_key: pair.toString(),
      }),
    );
    try {
      const key = readAgentKey(file);
      expect(key.publicKey).toBe(pair.getPublicKey().toString());
      expect(key.secretKey).toBe(pair.toString());
    } finally {
      unlinkSync(file);
    }
  });

  test("refuses a JSON key file whose public_key does not match its private_key", () => {
    const pair = KeyPair.fromRandom("ed25519");
    const other = KeyPair.fromRandom("ed25519");
    const file = writeKeyFile(
      JSON.stringify({
        account_id: "cynex-agent.cynexmaster.testnet",
        public_key: other.getPublicKey().toString(),
        private_key: pair.toString(),
      }),
    );
    try {
      expect(() => readAgentKey(file)).toThrow(/does not match/);
    } finally {
      unlinkSync(file);
    }
  });

  test("derives the public key for a bare secret key file", () => {
    const pair = KeyPair.fromRandom("ed25519");
    const file = writeKeyFile(pair.toString());
    try {
      const key = readAgentKey(file);
      expect(key.publicKey).toBe(pair.getPublicKey().toString());
    } finally {
      unlinkSync(file);
    }
  });
});

describe("verifyKeyScope", () => {
  test("accepts exactly a settle-only key on the configured vault", () => {
    const out = verifyKeyScope(
      list(entry(PUB, { FunctionCall: { receiver_id: VAULT, method_names: ["settle"], allowance: "250000000000000000000000" } })),
      PUB,
      VAULT,
    );
    expect(out.ok).toBe(true);
    expect(out.reason).toMatch(/settle/);
  });

  test("refuses a full-access key", () => {
    const out = verifyKeyScope(list(entry(PUB, "FullAccess")), PUB, VAULT);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/full-access/);
  });

  test("refuses a key scoped to another vault", () => {
    const out = verifyKeyScope(
      list(entry(PUB, { FunctionCall: { receiver_id: "cynex-vault.cynexmaster.testnet", method_names: ["settle"], allowance: "250000000000000000000000" } })),
      PUB,
      VAULT,
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/not the configured vault/);
  });

  test("refuses broader methods", () => {
    const out = verifyKeyScope(
      list(entry(PUB, { FunctionCall: { receiver_id: VAULT, method_names: ["settle", "create_obligation"], allowance: "250000000000000000000000" } })),
      PUB,
      VAULT,
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/exactly \[settle\]/);
  });

  test("refuses a malformed method_names list instead of throwing", () => {
    const malformed = { FunctionCall: { receiver_id: VAULT, method_names: "settle", allowance: "250000000000000000000000" } } as unknown as AccessKeyEntry["access_key"]["permission"];
    const asString = verifyKeyScope(list(entry(PUB, malformed)), PUB, VAULT);
    expect(asString.ok).toBe(false);
    expect(asString.reason).toMatch(/malformed method_names/);
    const missing = { FunctionCall: { receiver_id: VAULT, allowance: "250000000000000000000000" } } as unknown as AccessKeyEntry["access_key"]["permission"];
    const noList = verifyKeyScope(list(entry(PUB, missing)), PUB, VAULT);
    expect(noList.ok).toBe(false);
    expect(noList.reason).toMatch(/malformed method_names/);
  });

  test("refuses a key with unlimited allowance", () => {
    const out = verifyKeyScope(
      list(entry(PUB, { FunctionCall: { receiver_id: VAULT, method_names: ["settle"], allowance: null } })),
      PUB,
      VAULT,
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/finite, positive allowance/);
  });

  test("refuses a key with zero allowance", () => {
    const out = verifyKeyScope(
      list(entry(PUB, { FunctionCall: { receiver_id: VAULT, method_names: ["settle"], allowance: "0" } })),
      PUB,
      VAULT,
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/finite, positive allowance/);
  });

  test("refuses a key that is not on the account", () => {
    const out = verifyKeyScope(list(entry("ed25519:OTHER", "FullAccess")), PUB, VAULT);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/is not on the agent account/);
  });

  test("refuses a key list with no keys array", () => {
    const out = verifyKeyScope({}, PUB, VAULT);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/no keys array/);
  });
});
