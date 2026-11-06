/**
 * Tests for the Phase 6 executor backend. The pure guards
 * (auth comparison, validation, rate limit, allow-list) are
 * tested directly. The HTTP layer is tested against a stub
 * CLI process: the stub stands in for the CLI's process
 * plumbing only, so these tests prove the executor's auth,
 * validation, rate limiting, and allow-list, not the
 * contract. Contract behaviour is proven by the runner's
 * live audit run, never by a stub.
 */
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSettleArgv,
  createExecutorServer,
  createRateLimiter,
  createSessionStore,
  isAllowedCommand,
  resultFromCliOutput,
  tokensEqual,
  validateSettleRequest,
} from "./executor.js";

const VALID_BODY = {
  vaultId: "cynex-testvault.cynexmaster.testnet",
  obligationId: "p6-obl-002",
  proposedRecipient: "acme-supplies.testnet",
  proposedAmount: "1001",
  evidenceRef: "phase6-demo",
};

describe("tokensEqual", function () {
  it("compares without leaking the length difference as a match", function () {
    expect(tokensEqual("secret", "secret")).toBe(true);
    expect(tokensEqual("secret", "secrex")).toBe(false);
    expect(tokensEqual("secret", "short")).toBe(false);
    expect(tokensEqual("", "secret")).toBe(false);
  });
});

describe("validateSettleRequest", function () {
  it("accepts a clean request", function () {
    expect(validateSettleRequest(VALID_BODY)).toEqual([]);
  });
  it("rejects a non-object body", function () {
    expect(validateSettleRequest("nope").length).toBeGreaterThan(0);
    expect(validateSettleRequest(null).length).toBeGreaterThan(0);
  });
  it("rejects a bad vault, a bad obligation id, and bad settle params", function () {
    expect(validateSettleRequest({ ...VALID_BODY, vaultId: "Bad Vault!" }).length).toBeGreaterThan(0);
    expect(validateSettleRequest({ ...VALID_BODY, obligationId: "p6;rm" }).length).toBeGreaterThan(0);
    expect(validateSettleRequest({ ...VALID_BODY, proposedAmount: "0" }).length).toBeGreaterThan(0);
    expect(validateSettleRequest({ ...VALID_BODY, proposedRecipient: "not an account!" }).length).toBeGreaterThan(0);
    expect(validateSettleRequest({ ...VALID_BODY, evidenceRef: "a;b" }).length).toBeGreaterThan(0);
  });
  it("rejects non-string parameters outright", function () {
    expect(validateSettleRequest({ ...VALID_BODY, proposedAmount: 1001 }).length).toBeGreaterThan(0);
  });
});

describe("allow-list", function () {
  it("builds exactly the one command the executor may run", function () {
    const argv = buildSettleArgv("/repo/cli/cynex.js", VALID_BODY);
    expect(argv).toEqual([
      "/repo/cli/cynex.js",
      "attack-one",
      "cynex-testvault.cynexmaster.testnet",
      "p6-obl-002",
      "acme-supplies.testnet",
      "1001",
      "phase6-demo",
    ]);
    expect(isAllowedCommand(argv, "/repo/cli/cynex.js")).toBe(true);
  });
  it("refuses anything that is not that command", function () {
    expect(isAllowedCommand(["/repo/cli/cynex.js", "attack-one"], "/repo/cli/cynex.js")).toBe(false);
    expect(isAllowedCommand(["/bin/sh", "attack-one", "a", "b", "c", "d", "e"], "/repo/cli/cynex.js")).toBe(false);
    expect(isAllowedCommand(["/repo/cli/cynex.js", "attack", "a", "b", "c", "d", "e"], "/repo/cli/cynex.js")).toBe(false);
    expect(isAllowedCommand(["/other/cli.js", "attack-one", "a", "b", "c", "d", "e"], "/repo/cli/cynex.js")).toBe(false);
  });
});

describe("rate limiter", function () {
  it("allows five calls per window, then refuses", function () {
    const limiter = createRateLimiter(5, 60 * 1000);
    for (let i = 0; i < 5; i++) {
      expect(limiter.allow("session-1")).toBe(true);
    }
    expect(limiter.allow("session-1")).toBe(false);
    expect(limiter.retryAfterMs("session-1")).toBeGreaterThan(0);
    expect(limiter.allow("session-2")).toBe(true);
  });
});

describe("session store", function () {
  it("issues sessions that validate until they expire", function () {
    const store = createSessionStore(60 * 60 * 1000);
    const id = store.create();
    expect(store.valid(id)).toBe(true);
    expect(store.valid("no-such-session")).toBe(false);
    const dead = createSessionStore(-1);
    expect(dead.valid(dead.create())).toBe(false);
  });
});

describe("resultFromCliOutput", function () {
  it("extracts the RESULT line and ignores the human lines", function () {
    const out = "attack terms p6-obl-002: tx abc code ERR_TERMS_MISMATCH\nRESULT {\"txHash\":\"abc\",\"reasonCode\":\"ERR_TERMS_MISMATCH\"}\n";
    expect(resultFromCliOutput(out)).toEqual({ txHash: "abc", reasonCode: "ERR_TERMS_MISMATCH" });
    expect(resultFromCliOutput("no result here\n")).toBeNull();
    expect(resultFromCliOutput("RESULT {not json\n")).toBeNull();
  });
});

describe("executor HTTP layer", function () {
  it("authenticates, validates, rate-limits, and only runs the allow-listed command", async function () {
    const dir = mkdtempSync(join(tmpdir(), "cynex-executor-test-"));
    mkdirSync(join(dir, "frontend"), { recursive: true });
    mkdirSync(join(dir, "demo"), { recursive: true });
    writeFileSync(join(dir, "frontend", "playground.html"), "<html>playground</html>");
    writeFileSync(join(dir, "demo", "playground-obligations.json"), JSON.stringify({ obligations: [] }));
    const stub = join(dir, "stub-cli.mjs");
    writeFileSync(
      stub,
      "console.log(\"stub tx hash: stub-hash\");\n" +
        "console.log(\"RESULT \" + JSON.stringify({ txHash: \"stub-hash\", reasonCode: \"ERR_TERMS_MISMATCH\", argv: process.argv.slice(2) }));\n",
    );
    const server = createExecutorServer({
      token: "test-token",
      host: "127.0.0.1",
      port: 0,
      cliPath: stub,
      repoRoot: dir,
    });
    await new Promise<void>(function (resolve) {
      server.listen(0, "127.0.0.1", function () {
        resolve();
      });
    });
    const port = (server.address() as { port: number }).port;
    const base = "http://127.0.0.1:" + String(port);
    try {
      const page = await fetch(base + "/");
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("playground");
      const unauth = await fetch(base + "/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(VALID_BODY),
      });
      expect(unauth.status).toBe(401);
      const badAuth = await fetch(base + "/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "wrong" }),
      });
      expect(badAuth.status).toBe(401);
      const auth = await fetch(base + "/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "test-token" }),
      });
      expect(auth.status).toBe(200);
      const cookie = (auth.headers.get("set-cookie") ?? "").split(";")[0];
      expect(cookie).toContain("cynex-executor-session=");
      const badBody = await fetch(base + "/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ ...VALID_BODY, proposedAmount: "0" }),
      });
      expect(badBody.status).toBe(400);
      const ok = await fetch(base + "/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(VALID_BODY),
      });
      expect(ok.status).toBe(200);
      const result = (await ok.json()) as { txHash: string; argv: string[] };
      expect(result.txHash).toBe("stub-hash");
      expect(result.argv).toEqual([
        "attack-one",
        "cynex-testvault.cynexmaster.testnet",
        "p6-obl-002",
        "acme-supplies.testnet",
        "1001",
        "phase6-demo",
      ]);
      for (let i = 0; i < 3; i++) {
        const extra = await fetch(base + "/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify(VALID_BODY),
        });
        expect(extra.status).toBe(200);
      }
      const limited = await fetch(base + "/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(VALID_BODY),
      });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).not.toBeNull();
    } finally {
      await new Promise<void>(function (resolve) {
        server.close(function () {
          resolve();
        });
      });
    }
  }, 30000);
});

describe("executor GET /receipts", function () {
  it("returns the live receipts with exact u64 fields as strings", async function () {
    const dir = mkdtempSync(join(tmpdir(), "cynex-executor-receipts-"));
    mkdirSync(join(dir, "frontend"), { recursive: true });
    mkdirSync(join(dir, "demo"), { recursive: true });
    writeFileSync(join(dir, "frontend", "playground.html"), "<html>playground</html>");
    writeFileSync(join(dir, "demo", "playground-obligations.json"), JSON.stringify({ obligations: [] }));
    const stub = join(dir, "stub-cli.mjs");
    writeFileSync(stub, "console.log('stub');\n");
    const server = createExecutorServer({
      token: "test-token",
      host: "127.0.0.1",
      port: 0,
      cliPath: stub,
      repoRoot: dir,
    });
    await new Promise<void>(function (resolve) {
      server.listen(0, "127.0.0.1", function () {
        resolve();
      });
    });
    const port = (server.address() as { port: number }).port;
    const base = "http://127.0.0.1:" + String(port);
    try {
      const bad = await fetch(base + "/receipts?vaultId=Bad Vault!");
      expect(bad.status).toBe(400);
      const res = await fetch(base + "/receipts?vaultId=cynex-vault.cynexmaster.testnet");
      expect(res.status).toBe(200);
      const data = (await res.json()) as { receipts: Record<string, unknown>[] };
      expect(Array.isArray(data.receipts)).toBe(true);
      expect(data.receipts.length).toBeGreaterThanOrEqual(8);
      for (const [i, row] of data.receipts.entries()) {
        expect(row.index).toBe(String(i));
        expect(typeof row.amount).toBe("string");
        expect(typeof row.timestamp).toBe("string");
        expect(typeof row.prev_hash).toBe("string");
        expect(String(row.prev_hash)).toMatch(/^[0-9a-f]{64}$/);
        expect(typeof row.obligation_id).toBe("string");
        expect(typeof row.recipient).toBe("string");
        expect(typeof row.token_id).toBe("string");
        expect(typeof row.tx_ref).toBe("string");
        expect(BigInt(String(row.timestamp))).toBeGreaterThan(2n ** 53n);
      }
      expect(data.receipts[0]?.prev_hash).toBe("00".repeat(32));
    } finally {
      await new Promise<void>(function (resolve) {
        server.close(function () {
          resolve();
        });
      });
    }
  }, 30000);
});
