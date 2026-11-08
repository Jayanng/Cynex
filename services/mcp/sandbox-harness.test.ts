/**
 * Unit tests for the sandbox harness helpers. The live chain behavior
 * is proven by sandbox.test.ts; these pin the small pure functions
 * the suite depends on, so a broken base58 encoder fails here first
 * instead of deep inside a sandbox run.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  base58Encode,
  codeHashOfWasm,
  readMasterSecretKey,
  sandboxBinaryPath,
} from "./sandbox-harness.js";

describe("base58Encode", () => {
  test("matches the known vectors", () => {
    expect(base58Encode(new Uint8Array([]))).toBe("");
    expect(base58Encode(new Uint8Array([0]))).toBe("1");
    expect(base58Encode(new Uint8Array([0, 0, 1]))).toBe("112");
    expect(base58Encode(Buffer.from("Hello World!", "utf-8"))).toBe("2NEpo7TZRRrLZSi2U");
  });

  test("codeHashOfWasm is the sha256 of the wasm in base58", () => {
    expect(codeHashOfWasm(new Uint8Array([]))).toBe(
      "GKot5hBsd81kMupNCXHaqbhv3huEbxAFMLnpcX2hniwn",
    );
  });
});

describe("readMasterSecretKey", () => {
  test("reads the node's own validator key", () => {
    const dir = mkdtempSync(join(tmpdir(), "cynex-validator-key-"));
    try {
      const key =
        "ed25519:2u89XHQt8rdBWNKMTXug4rRxE6dERws9neto3tgdR8hmbZe2awHk61sS2gqsrwXpavzSbyWNLCYSSRb2qa1HXNPu";
      writeFileSync(
        join(dir, "validator_key.json"),
        JSON.stringify({
          account_id: "test.near",
          public_key: "ed25519:7ugyx6cRP5SmtvYtdngmdq8vomA7mq1Gz49NBphpB1kP",
          secret_key: key,
        }),
      );
      expect(readMasterSecretKey(dir)).toBe(key);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses a missing or wrong-account key file", () => {
    const dir = mkdtempSync(join(tmpdir(), "cynex-validator-key-"));
    try {
      expect(() => readMasterSecretKey(dir)).toThrow("did not write a validator key");
      writeFileSync(
        join(dir, "validator_key.json"),
        JSON.stringify({ account_id: "near", secret_key: "ed25519:xxx" }),
      );
      expect(() => readMasterSecretKey(dir)).toThrow("is not a test.near key");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sandboxBinaryPath", () => {
  test("honours CYNEX_SANDBOX_BIN_PATH", () => {
    const saved = process.env.CYNEX_SANDBOX_BIN_PATH;
    process.env.CYNEX_SANDBOX_BIN_PATH = "/tmp/near-sandbox";
    try {
      expect(sandboxBinaryPath()).toBe("/tmp/near-sandbox");
    } finally {
      if (saved === undefined) {
        delete process.env.CYNEX_SANDBOX_BIN_PATH;
      } else {
        process.env.CYNEX_SANDBOX_BIN_PATH = saved;
      }
    }
  });

  test("defaults to the shared ~/.near cache", () => {
    const saved = process.env.CYNEX_SANDBOX_BIN_PATH;
    delete process.env.CYNEX_SANDBOX_BIN_PATH;
    try {
      expect(sandboxBinaryPath()).toMatch(/\.near\/near-sandbox-2\.13\.4\/near-sandbox$/);
    } finally {
      if (saved !== undefined) {
        process.env.CYNEX_SANDBOX_BIN_PATH = saved;
      }
    }
  });
});
