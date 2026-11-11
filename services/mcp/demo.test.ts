/**
 * Tests for the demo mode (services/mcp/demo.ts) and the cynex-mcp
 * command line (services/mcp/cli.ts).
 *
 * The live tests are gated by CYNEX_SANDBOX_TESTS=1, like
 * sandbox.test.ts: they start a real chain and spawn the built demo
 * over stdio. The default run skips them with a note instead of
 * failing on a machine that never asked for it. Run them with:
 *
 *   npm run mcp:build && CYNEX_SANDBOX_TESTS=1 npm run jest:sandbox
 *
 * The secret-key check below looks for an ed25519 secret, not for
 * the string "ed25519:" on its own: the ready summary prints the
 * agent public key, which is an ed25519 key too, and that is allowed.
 * A secret key is 88 base58 characters after the prefix, a public
 * key is 44, so the check refuses any ed25519 value of 50 characters
 * or more.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseCliArgs } from "./cli.js";
import {
  DEMO_BOOTSTRAP_001,
  DEMO_BOOTSTRAP_002,
  DEMO_CREATED_001,
  DEMO_READY_001,
  DEMO_READY_002,
  buildDemoEnv,
  buildReadySummary,
  claudeCodeConfig,
  demoSeedSpecs,
  type DemoSummaryInfo,
  type ProvisionedSandbox,
} from "./demo.js";
import {
  SANDBOX_RECIPIENT_ID,
  SANDBOX_SECOND_RECIPIENT_ID,
} from "./sandbox-harness.js";

const SECRET_KEY_PATTERN = /ed25519:[1-9A-HJ-NP-Za-km-z]{50,}/;

const SIX_TOOLS = [
  "cynex_check_counterparty",
  "cynex_get_obligation",
  "cynex_get_policy",
  "cynex_list_receipts",
  "cynex_prepare_obligation",
  "cynex_request_settlement",
];

const VAULT_ID = "vault.test.near";
const TOKEN_ID = "token.test.near";
const AGENT_ID = "agent.test.near";
const POLICY_ID = "sandbox-policy-001";

function fakeProvisioned(): ProvisionedSandbox {
  return {
    vaultId: "vault.test.near",
    agentId: "agent.test.near",
    keyFile: "/tmp/cynex-demo-test/agent-key.txt",
    sandbox: {
      rpcUrl: "http://127.0.0.1:34567",
      chainId: "test-chain-abc",
    },
    vaultCodeHash: "65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6",
    policyId: "sandbox-policy-001",
  } as unknown as ProvisionedSandbox;
}

function fakeSummaryInfo(): DemoSummaryInfo {
  return {
    vaultId: "vault.test.near",
    rpcUrl: "http://127.0.0.1:34567",
    chainId: "test-chain-abc",
    policyId: "sandbox-policy-001",
    policyLimit: "10000",
    policyFunded: "10000",
    policySpent: "200",
    agentPublicKey: "ed25519:7ugyx6cRP5SmtvYtdngmdq8vomA7mq1Gz49NBphpB1kP",
    obligations: [
      { id: DEMO_BOOTSTRAP_001, recipient: SANDBOX_RECIPIENT_ID, amount: "100", state: "PAID" },
      { id: DEMO_BOOTSTRAP_002, recipient: SANDBOX_SECOND_RECIPIENT_ID, amount: "100", state: "PAID" },
      { id: DEMO_READY_001, recipient: SANDBOX_RECIPIENT_ID, amount: "100", state: "READY" },
      { id: DEMO_READY_002, recipient: SANDBOX_SECOND_RECIPIENT_ID, amount: "100", state: "READY" },
      { id: DEMO_CREATED_001, recipient: SANDBOX_RECIPIENT_ID, amount: "100", state: "CREATED" },
    ],
    demoPath: "/data/workspace/Cynex-mcp-demo/frontend/dist-test/services/mcp/demo.js",
  };
}

/**
 * Read the sandbox chain directly over raw JSON-RPC, the way the
 * proof script does, so the live test verifies the tool answers
 * against the chain instead of trusting them.
 */
async function rpcQuery(rpcUrl: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "cynex-demo-test", method: "query", params }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as { error?: unknown; result?: unknown };
  if (body.error !== undefined) {
    throw new Error("RPC query failed: " + JSON.stringify(body.error));
  }
  return body.result;
}

async function rpcCallFunction(
  rpcUrl: string,
  contractId: string,
  methodName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const envelope = (await rpcQuery(rpcUrl, {
    request_type: "call_function",
    account_id: contractId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args), "utf-8").toString("base64"),
    finality: "final",
  })) as { result?: number[] };
  // The query envelope carries the return bytes in its own result
  // field, alongside the block hash and height.
  return JSON.parse(Buffer.from(envelope.result ?? []).toString("utf-8")) as unknown;
}

async function tokenBalance(rpcUrl: string, accountId: string): Promise<bigint> {
  const raw = await rpcCallFunction(rpcUrl, TOKEN_ID, "ft_balance_of", {
    account_id: accountId,
  });
  return BigInt(String(raw));
}

async function readObligationRpc(
  rpcUrl: string,
  obligationId: string,
): Promise<Record<string, unknown>> {
  return (await rpcCallFunction(rpcUrl, VAULT_ID, "get_obligation", {
    obligation_id: obligationId,
  })) as Record<string, unknown>;
}

async function readPolicyRpc(rpcUrl: string): Promise<Record<string, unknown>> {
  return (await rpcCallFunction(rpcUrl, VAULT_ID, "get_policy", {
    policy_id: POLICY_ID,
  })) as Record<string, unknown>;
}

async function agentNonce(rpcUrl: string, publicKey: string): Promise<bigint> {
  const result = (await rpcQuery(rpcUrl, {
    request_type: "view_access_key",
    account_id: AGENT_ID,
    public_key: publicKey,
    finality: "final",
  })) as { nonce?: unknown };
  if (typeof result.nonce !== "number" || !Number.isSafeInteger(result.nonce)) {
    throw new Error("agent nonce is not a readable number: " + JSON.stringify(result.nonce));
  }
  return BigInt(result.nonce);
}

function parseRpcUrl(stderr: string): string {
  const match = /on (http:\/\/127\.0\.0\.1:\d+)/.exec(stderr);
  if (match === null) {
    throw new Error("demo stderr did not print a sandbox RPC URL");
  }
  return match[1];
}

function parseAgentPublicKey(stderr: string): string {
  const match = /Agent public key (ed25519:[1-9A-HJ-NP-Za-km-z]+)/.exec(stderr);
  if (match === null) {
    throw new Error("demo stderr did not print the agent public key");
  }
  return match[1];
}

/**
 * Where startSandbox puts its homes, mirroring scratchBase() in the
 * harness: CYNEX_BUILD_TMP when set, the shared build tmp dir on
 * this machine when it exists, the OS temp dir otherwise.
 */
function sandboxScratchBase(): string {
  const fromEnv = (process.env.CYNEX_BUILD_TMP ?? "").trim();
  if (fromEnv !== "" && existsSync(fromEnv)) {
    return fromEnv;
  }
  if (existsSync("/data/workspace/cynex-build-tmp")) {
    return "/data/workspace/cynex-build-tmp";
  }
  return tmpdir();
}

function sandboxHomes(): string[] {
  return readdirSync(sandboxScratchBase()).filter((name) =>
    name.startsWith("cynex-sandbox-home-"),
  );
}

async function rpcIsDead(rpcUrl: string): Promise<boolean> {
  try {
    await fetch(rpcUrl + "/status", { signal: AbortSignal.timeout(3_000) });
    return false;
  } catch {
    return true;
  }
}

async function waitForTest<T>(
  label: string,
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    "timed out waiting for " + label + ": last value " + JSON.stringify(last),
  );
}

function builtDemoPath(): string {
  const demoPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "frontend",
    "dist-test",
    "services",
    "mcp",
    "demo.js",
  );
  if (!existsSync(demoPath)) {
    throw new Error(
      "built demo not found at " + demoPath + ", run npm run mcp:build from frontend/ first",
    );
  }
  return demoPath;
}

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

function timeoutRace<T>(label: string, ms: number): Promise<T> {
  return new Promise<T>((resolve) => {
    // Unref so a resolved race does not keep Jest alive for 30s.
    const timer = setTimeout(() => resolve(label as T), ms);
    timer.unref();
  });
}

describe("demoSeedSpecs", () => {
  test("seeds five obligations with the right ids, recipients, and states", () => {
    const seeds = demoSeedSpecs();
    expect(seeds.bootstrap).toEqual([
      { id: DEMO_BOOTSTRAP_001, recipient: SANDBOX_RECIPIENT_ID },
      { id: DEMO_BOOTSTRAP_002, recipient: SANDBOX_SECOND_RECIPIENT_ID },
    ]);
    expect(seeds.ready).toEqual([
      { id: DEMO_READY_001, recipient: SANDBOX_RECIPIENT_ID },
      { id: DEMO_READY_002, recipient: SANDBOX_SECOND_RECIPIENT_ID },
    ]);
    expect(seeds.created).toEqual([
      { id: DEMO_CREATED_001, recipient: SANDBOX_RECIPIENT_ID },
    ]);
    const ids = [...seeds.bootstrap, ...seeds.ready, ...seeds.created].map((s) => s.id);
    expect(new Set(ids).size).toBe(5);
  });
});

describe("buildReadySummary", () => {
  test("names the chain, the policy, the five obligations, and the three tries", () => {
    const summary = buildReadySummary(fakeSummaryInfo());
    expect(summary).toContain("local sandbox demo, not testnet, not production");
    expect(summary).toContain("vault.test.near");
    expect(summary).toContain("http://127.0.0.1:34567");
    expect(summary).toContain("sandbox-policy-001");
    expect(summary).toContain("limit 10000, funded 10000, spent 200");
    for (const id of [
      DEMO_BOOTSTRAP_001,
      DEMO_BOOTSTRAP_002,
      DEMO_READY_001,
      DEMO_READY_002,
      DEMO_CREATED_001,
    ]) {
      expect(summary).toContain(id);
    }
    expect(summary).toContain("demo-ready-001 recipient.test.near amount 100 READY");
    expect(summary).toContain("demo-created-001 recipient.test.near amount 100 CREATED");
    expect(summary).toContain("ERR_RECIPIENT_SUBSTITUTION");
    expect(summary).toContain("not READY");
    expect(summary).toContain("mcpServers");
    expect(summary).toContain("demo.js");
    expect(summary).toContain("sandbox only, no live funds");
  });

  test("prints the agent public key but no secret key", () => {
    const summary = buildReadySummary(fakeSummaryInfo());
    expect(summary).toContain("ed25519:7ugyx6cRP5SmtvYtdngmdq8vomA7mq1Gz49NBphpB1kP");
    expect(summary).not.toMatch(SECRET_KEY_PATTERN);
  });

  test("the bundled demo carries --sandbox in the config snippet", () => {
    expect(claudeCodeConfig("/usr/local/lib/cynex-mcp/dist/cynex-mcp.mjs")).toContain(
      "--sandbox",
    );
    expect(claudeCodeConfig("/data/workspace/Cynex-mcp-demo/frontend/dist-test/services/mcp/demo.js")).not.toContain(
      "--sandbox",
    );
  });
});

describe("buildDemoEnv", () => {
  test("sets sandbox variables and never a testnet one", () => {
    const env = buildDemoEnv(fakeProvisioned());
    expect(env.set.CYNEX_VAULT).toBe("vault.test.near");
    expect(env.set.CYNEX_AGENT).toBe("agent.test.near");
    expect(env.set.CYNEX_AGENT_KEY_FILE).toBe("/tmp/cynex-demo-test/agent-key.txt");
    expect(env.set.CYNEX_SANDBOX_RPC_URL).toBe("http://127.0.0.1:34567");
    expect(env.set.CYNEX_SANDBOX_VAULT_CODE_HASH).toBe(
      "65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6",
    );
    expect(env.set.CYNEX_SANDBOX_CHAIN_ID).toBe("test-chain-abc");
    expect(env.set.CYNEX_POLICY).toBe("sandbox-policy-001");
    expect(env.set.CYNEX_SNAPSHOT_DIR).toBe("");
    expect(env.set.CYNEX_BLOCKLIST_URL).toBe("");
    // The indexer must not be the testnet one, and must not be
    // empty either: empty falls back to the testnet indexer.
    expect(env.set.CYNEX_NEARBLOCKS_URL).toBe("http://127.0.0.1:1");
    expect(env.unset).toContain("CYNEX_RPC_URL");
    expect("CYNEX_RPC_URL" in env.set).toBe(false);
    for (const value of Object.values(env.set)) {
      expect(value).not.toContain("testnet");
      expect(value).not.toContain("nearblocks.io");
      expect(value).not.toContain("fastnear");
    }
  });
});

describe("parseCliArgs", () => {
  test("no arguments runs the normal server", () => {
    expect(parseCliArgs([])).toBe("server");
  });

  test("--sandbox runs the demo", () => {
    expect(parseCliArgs(["--sandbox"])).toBe("sandbox");
  });

  test("--help shows usage", () => {
    expect(parseCliArgs(["--help"])).toBe("help");
    expect(parseCliArgs(["-h"])).toBe("help");
  });

  test("unknown arguments are an error, never silently ignored", () => {
    expect(() => parseCliArgs(["--bogus"])).toThrow(/unknown arguments/);
    expect(() => parseCliArgs(["--sandbox", "--bogus"])).toThrow(/unknown arguments/);
  });

  test("--help combined with anything else is an error, not usage", () => {
    expect(() => parseCliArgs(["--bogus", "--help"])).toThrow(/unknown arguments/);
    expect(() => parseCliArgs(["--sandbox", "--help"])).toThrow(/unknown arguments/);
    expect(() => parseCliArgs(["--help", "-h"])).toThrow(/unknown arguments/);
  });

  test("a repeated flag is an error", () => {
    expect(() => parseCliArgs(["--sandbox", "--sandbox"])).toThrow(/unknown arguments/);
  });
});

const SANDBOX_TESTS = process.env.CYNEX_SANDBOX_TESTS === "1";

describe("demo over stdio", () => {
  // A skipped test, not a passing one: when the flag is absent Jest
  // reports 1 skipped, so the default run never implies demo
  // coverage that did not execute.
  (SANDBOX_TESTS ? test : test.skip)(
    "spawns the built demo, drives the three judge tries, and cleans up on SIGTERM",
    async () => {
      const demoPath = builtDemoPath();
      const homesBefore = new Set(sandboxHomes());
      let stderr = "";
      const transport = new StdioClientTransport({
        command: "node",
        args: [demoPath],
        env: childEnv(),
        stderr: "pipe",
      });
      transport.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });
      const client = new Client(
        { name: "cynex-demo-test", version: "0.1.0" },
        { capabilities: {} },
      );
      // The transport clears its child handle before calling
      // onclose, so the exit code is captured from the child
      // process directly, right after connect. _process is a
      // private field of @modelcontextprotocol/sdk, verified
      // against 1.32.2: a future SDK bump that renames it breaks
      // this capture, not the demo.
      let resolveClosed: (code: number | null) => void = () => {};
      const closed = new Promise<number | null>((resolve) => {
        resolveClosed = resolve;
      });
      async function callTool(
        name: string,
        args: Record<string, unknown>,
      ): Promise<Record<string, unknown>> {
        const result = await client.callTool({ name, arguments: args });
        const text = (result.content as Array<{ text?: string }> | undefined)
          ?.map((c) => c.text ?? "")
          .join("\n");
        return JSON.parse(text ?? "{}") as Record<string, unknown>;
      }
      try {
        await client.connect(transport);
        const child = (
          transport as unknown as {
            _process?: { once: (event: string, fn: (code: number | null) => void) => void };
          }
        )._process;
        child?.once("close", (code: number | null) => resolveClosed(code));
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name).sort()).toEqual([...SIX_TOOLS].sort());
        for (const [id, state, recipient] of [
          [DEMO_BOOTSTRAP_001, "PAID", SANDBOX_RECIPIENT_ID],
          [DEMO_BOOTSTRAP_002, "PAID", SANDBOX_SECOND_RECIPIENT_ID],
          [DEMO_READY_001, "READY", SANDBOX_RECIPIENT_ID],
          [DEMO_READY_002, "READY", SANDBOX_SECOND_RECIPIENT_ID],
          [DEMO_CREATED_001, "CREATED", SANDBOX_RECIPIENT_ID],
        ] as const) {
          const out = await callTool("cynex_get_obligation", { obligation_id: id });
          expect(out.ok).toBe(true);
          const data = out.data as Record<string, unknown>;
          expect(String(data.state ?? "")).toBe(state);
          expect(String(data.recipient ?? "")).toBe(recipient);
          expect(BigInt(String(data.amount ?? ""))).toBe(100n);
        }
        const policyOut = await callTool("cynex_get_policy", {
          policy_id: POLICY_ID,
        });
        expect(policyOut.ok).toBe(true);
        const policy = (policyOut.data as Record<string, unknown>).policy as Record<
          string,
          unknown
        >;
        expect(BigInt(String(policy.spent ?? ""))).toBe(200n);
        expect(BigInt(String(policy.funded ?? ""))).toBe(10000n);
        expect(stderr).toContain("local sandbox demo, not testnet, not production");
        expect(stderr).toContain(DEMO_READY_001);
        expect(stderr).not.toMatch(SECRET_KEY_PATTERN);
        const rpcUrl = parseRpcUrl(stderr);
        const agentPublicKey = parseAgentPublicKey(stderr);
        const homesNow = sandboxHomes().filter((home) => !homesBefore.has(home));
        expect(homesNow).toHaveLength(1);
        const homeDir = join(sandboxScratchBase(), homesNow[0]);
        const keyFile = join(homeDir, "agent-key.txt");
        expect(existsSync(keyFile)).toBe(true);

        // Try 1: settle demo-ready-001 through MCP. PAID, receipt 2,
        // balance delta exactly 100, verified against the chain, not
        // just the tool answer.
        const balanceBefore = await tokenBalance(rpcUrl, SANDBOX_RECIPIENT_ID);
        const settleOut = await callTool("cynex_request_settlement", {
          obligation_id: DEMO_READY_001,
          proposed_recipient: SANDBOX_RECIPIENT_ID,
          proposed_amount: "100",
          evidence_ref: "demo-test-v1",
        });
        expect(settleOut.ok).toBe(true);
        const settleData = settleOut.data as Record<string, unknown>;
        expect(settleData.state).toBe("PAID");
        expect(String(settleData.receipt_index ?? "")).toBe("2");
        expect(BigInt(String(settleData.balance_delta ?? ""))).toBe(100n);
        expect(String(settleData.settle_tx_hash ?? "")).toMatch(/^[A-Za-z0-9]{43,44}$/);
        const paidRow = await waitForTest(
          "demo-ready-001 PAID on chain",
          () => readObligationRpc(rpcUrl, DEMO_READY_001),
          (row) => row.state === "PAID",
        );
        expect(paidRow.state).toBe("PAID");
        const receipts = await waitForTest(
          "three receipts on chain",
          () =>
            rpcCallFunction(rpcUrl, VAULT_ID, "receipts", {
              start: 0,
              limit: 10,
            }) as Promise<Array<Record<string, unknown>>>,
          (rows) => rows.length === 3 && rows[2]?.obligation_id === DEMO_READY_001,
        );
        expect(receipts[2]?.obligation_id).toBe(DEMO_READY_001);
        const balanceAfter = await waitForTest(
          "recipient balance delta 100 on chain",
          () => tokenBalance(rpcUrl, SANDBOX_RECIPIENT_ID),
          (balance) => balance - balanceBefore === 100n,
        );
        expect(balanceAfter - balanceBefore).toBe(100n);

        // Try 2: settle demo-ready-002 with a changed recipient. The
        // vault refuses on chain, no funds move, the obligation stays
        // READY.
        const secondBefore = await tokenBalance(rpcUrl, SANDBOX_SECOND_RECIPIENT_ID);
        const negativeOut = await callTool("cynex_request_settlement", {
          obligation_id: DEMO_READY_002,
          proposed_recipient: SANDBOX_RECIPIENT_ID,
          proposed_amount: "100",
          evidence_ref: "demo-test-v1",
        });
        expect(negativeOut.ok).toBe(false);
        expect(String(negativeOut.reason ?? "")).toContain("ERR_RECIPIENT_SUBSTITUTION");
        expect(String(negativeOut.reason ?? "")).toMatch(
          /settle transaction hash [A-Za-z0-9]+/,
        );
        const stillReady = await callTool("cynex_get_obligation", {
          obligation_id: DEMO_READY_002,
        });
        expect(String((stillReady.data as Record<string, unknown>).state ?? "")).toBe(
          "READY",
        );
        expect(await tokenBalance(rpcUrl, SANDBOX_SECOND_RECIPIENT_ID)).toBe(secondBefore);

        // Try 3: settle demo-created-001. The server refuses it as
        // not READY and submits no transaction, so the agent nonce
        // does not move and the obligation stays CREATED.
        const nonceBefore = await agentNonce(rpcUrl, agentPublicKey);
        const createdOut = await callTool("cynex_request_settlement", {
          obligation_id: DEMO_CREATED_001,
          proposed_recipient: SANDBOX_RECIPIENT_ID,
          proposed_amount: "100",
          evidence_ref: "demo-test-v1",
        });
        expect(createdOut.ok).toBe(false);
        expect(String(createdOut.reason ?? "")).toContain("not READY");
        const nonceAfter = await agentNonce(rpcUrl, agentPublicKey);
        expect(nonceAfter).toBe(nonceBefore);
        const stillCreated = await callTool("cynex_get_obligation", {
          obligation_id: DEMO_CREATED_001,
        });
        expect(String((stillCreated.data as Record<string, unknown>).state ?? "")).toBe(
          "CREATED",
        );
        const finalPolicy = await waitForTest(
          "final policy spent 300 on chain",
          () => readPolicyRpc(rpcUrl),
          (row) => BigInt(String(row.spent ?? "")) === 300n,
        );
        expect(BigInt(String(finalPolicy.spent ?? ""))).toBe(300n);

        const pid = transport.pid;
        expect(pid).not.toBeNull();
        process.kill(pid as number, "SIGTERM");
        const code = await Promise.race([
          closed,
          timeoutRace<string>("timeout", 30_000),
        ]);
        expect(code).toBe(0);
        // Cleanup, not just exit code: the sandbox RPC must stop
        // answering and the sandbox home, with the agent key file
        // inside it, must be gone.
        await waitForTest(
          "sandbox RPC to stop answering",
          () => rpcIsDead(rpcUrl),
          (dead) => dead === true,
          30_000,
        );
        expect(existsSync(homeDir)).toBe(false);
        expect(existsSync(keyFile)).toBe(false);
      } finally {
        try {
          await client.close();
        } catch {
          // closing a stopped demo must not hide the test result
        }
      }
    },
    600_000,
  );

  (SANDBOX_TESTS ? test : test.skip)(
    "SIGTERM during provisioning still stops the sandbox and exits 0",
    async () => {
      const demoPath = builtDemoPath();
      const homesBefore = new Set(sandboxHomes());
      let stderr = "";
      // Spawned directly, not through the SDK client: the client
      // handshake only completes once the demo is serving, which is
      // after provisioning, so a client connect cannot catch the
      // provisioning window this test is about.
      const child: ChildProcess = spawn("node", [demoPath], {
        env: childEnv(),
        stdio: ["ignore", "ignore", "pipe"],
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });
      let resolveClosed: (code: number | null) => void = () => {};
      const closed = new Promise<number | null>((resolve) => {
        resolveClosed = resolve;
      });
      child.once("close", (code: number | null) => resolveClosed(code));
      try {
        // The sandbox node is up within the first seconds, while
        // seeding takes about twenty more, so a new sandbox home
        // means provisioning is still running.
        const homes = await waitForTest(
          "a sandbox home to appear",
          async () => sandboxHomes().filter((home) => !homesBefore.has(home)),
          (found) => found.length === 1,
          120_000,
        );
        const homeDir = join(sandboxScratchBase(), homes[0]);
        expect(child.pid).not.toBeUndefined();
        child.kill("SIGTERM");
        const code = await Promise.race([
          closed,
          timeoutRace<string>("timeout", 120_000),
        ]);
        expect(code).toBe(0);
        // The "sandbox up" check prints the RPC URL during
        // provisioning, so it is in stderr even though the ready
        // summary never printed.
        const rpcUrl = parseRpcUrl(stderr);
        await waitForTest(
          "sandbox RPC to stop answering",
          () => rpcIsDead(rpcUrl),
          (dead) => dead === true,
          30_000,
        );
        expect(existsSync(homeDir)).toBe(false);
        expect(existsSync(join(homeDir, "agent-key.txt"))).toBe(false);
      } finally {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
      }
    },
    600_000,
  );
});
