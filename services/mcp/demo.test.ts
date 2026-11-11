/**
 * Tests for the demo mode (services/mcp/demo.ts) and the cynex-mcp
 * command line (services/mcp/cli.ts).
 *
 * The live test is gated by CYNEX_SANDBOX_TESTS=1, like
 * sandbox.test.ts: it starts a real chain and spawns the built demo
 * over stdio. The default run skips it with a note instead of
 * failing on a machine that never asked for it. Run it with:
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
import { existsSync } from "node:fs";
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
    expect(claudeCodeConfig("/usr/local/lib/cynex-mcp/dist/cynex-mcp.cjs")).toContain(
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
});

const SANDBOX_TESTS = process.env.CYNEX_SANDBOX_TESTS === "1";

describe("demo over stdio", () => {
  // A skipped test, not a passing one: when the flag is absent Jest
  // reports 1 skipped, so the default run never implies demo
  // coverage that did not execute.
  (SANDBOX_TESTS ? test : test.skip)(
    "spawns the built demo, lists six tools, and seeds the five obligations",
    async () => {
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
      const env: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          env[key] = value;
        }
      }
      let stderr = "";
      const transport = new StdioClientTransport({
        command: "node",
        args: [demoPath],
        env,
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
      // process directly, right after connect.
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
        for (const [id, state] of [
          [DEMO_BOOTSTRAP_001, "PAID"],
          [DEMO_BOOTSTRAP_002, "PAID"],
          [DEMO_READY_001, "READY"],
          [DEMO_READY_002, "READY"],
          [DEMO_CREATED_001, "CREATED"],
        ] as const) {
          const out = await callTool("cynex_get_obligation", { obligation_id: id });
          expect(out.ok).toBe(true);
          expect(String((out.data as Record<string, unknown>).state ?? "")).toBe(state);
        }
        const policyOut = await callTool("cynex_get_policy", {
          policy_id: "sandbox-policy-001",
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
        const pid = transport.pid;
        expect(pid).not.toBeNull();
        process.kill(pid as number, "SIGTERM");
        const code = await Promise.race([
          closed,
          new Promise<string>((resolve) => {
            // Unref so a resolved race does not keep Jest alive for 30s.
            const timer = setTimeout(() => resolve("timeout"), 30_000);
            timer.unref();
          }),
        ]);
        expect(code).toBe(0);
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
});
