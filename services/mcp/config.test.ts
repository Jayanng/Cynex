/**
 * MCP config tests: the startup scope check must refuse a
 * full-access key, a wrong receiver, or broader methods, and
 * accept exactly a settle-only key on the configured vault.
 * The key material is never in a refusal reason.
 */
import { loadConfig, readAgentKey, verifyKeyScope, type AccessKeyEntry } from "./config.js";
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
