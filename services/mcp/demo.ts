/**
 * Cynex MCP demo mode: a local sandbox demo, not testnet, not production.
 *
 * This starts a real near-sandbox chain on the local machine, deploys
 * the real vault wasm and the real test token, funds a policy, and
 * seeds five obligations on it, then serves the real MCP server over
 * stdio against that chain. Nothing here is mocked: the chain is a
 * local NEAR node, the vault is the compiled contract, and the server
 * is the same code that serves testnet, pointed at the sandbox through
 * its explicit sandbox mode (loopback RPC URL only).
 *
 * The five seeded obligations, all amount 100 on sandbox-policy-001
 * with PREIMAGE evidence for the bytes "cynex-sandbox-report-v1":
 *
 *   demo-bootstrap-001  recipient.test.near   READY, settled in provisioning (receipt 0)
 *   demo-bootstrap-002  recipient2.test.near  READY, settled in provisioning (receipt 1)
 *   demo-ready-001      recipient.test.near   READY, for the judge to settle
 *   demo-ready-002      recipient2.test.near  READY, for the changed-recipient attempt
 *   demo-created-001    recipient.test.near   CREATED, no evidence submitted
 *
 * The two bootstrap settles exist so both recipients hold a prior
 * receipt and the reputation gate can ALLOW them. Without them the
 * gate correctly WARNs on a fresh account and no MCP settle could
 * ever succeed. The bootstrap settles run directly with the agent
 * key, bypassing MCP and the gate, exactly like the sandbox suite.
 *
 * The demo never touches testnet: CYNEX_RPC_URL is deleted, the
 * sandbox RPC URL is loopback only, snapshots and the blocklist are
 * empty, and the NearBlocks indexer is pointed at a closed loopback
 * port (see DEMO_NEARBLOCKS_URL) so the deployment check fails closed
 * as unavailable instead of reaching the testnet indexer. The
 * recipients hold no contract, so that signal is neutral either way
 * and the ALLOW verdict comes from the prior receipts.
 *
 * The agent key file lives in the sandbox home directory, outside the
 * repo, and is removed with the sandbox on exit. No secret key is
 * ever printed: the ready summary carries account ids and public
 * keys only. Stdout is the MCP JSON-RPC transport, so every log and
 * the ready summary go to stderr.
 *
 * Run, from frontend/ after npm run mcp:build:
 *
 *   npm run mcp:demo
 *
 * Or, once published: npx cynex-mcp --sandbox. The demo keeps running
 * until it is killed (SIGINT, SIGTERM, or the client disconnecting),
 * then it closes the server, stops the sandbox, and exits.
 */
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildContext, buildServer } from "./server.js";
import {
  SANDBOX_RECIPIENT_ID,
  SANDBOX_SECOND_RECIPIENT_ID,
  provisionSandbox,
  type ProvisionedSandbox,
  type SandboxSeedSpec,
} from "./sandbox-harness.js";

export const DEMO_BOOTSTRAP_001 = "demo-bootstrap-001";
export const DEMO_BOOTSTRAP_002 = "demo-bootstrap-002";
export const DEMO_READY_001 = "demo-ready-001";
export const DEMO_READY_002 = "demo-ready-002";
export const DEMO_CREATED_001 = "demo-created-001";
export const DEMO_OBLIGATION_AMOUNT = "100";

/**
 * The NearBlocks base URL the demo uses. An empty value would fall
 * back to the testnet indexer inside makeLiveSources, which is
 * exactly what demo mode must not do, so the demo points it at a
 * closed loopback port instead: the connection is refused at once,
 * the deployment check reports unavailable, and no request ever
 * leaves the machine. The seeded recipients hold no contract, so
 * the code-change signal is neutral with or without the indexer,
 * and the ALLOW verdict comes from the prior bootstrap receipts.
 */
export const DEMO_NEARBLOCKS_URL = "http://127.0.0.1:1";

/** The obligations the demo seeds, with the states the judge will find. */
export function demoSeedSpecs(): {
  bootstrap: SandboxSeedSpec[];
  ready: SandboxSeedSpec[];
  created: SandboxSeedSpec[];
} {
  return {
    bootstrap: [
      { id: DEMO_BOOTSTRAP_001, recipient: SANDBOX_RECIPIENT_ID },
      { id: DEMO_BOOTSTRAP_002, recipient: SANDBOX_SECOND_RECIPIENT_ID },
    ],
    ready: [
      { id: DEMO_READY_001, recipient: SANDBOX_RECIPIENT_ID },
      { id: DEMO_READY_002, recipient: SANDBOX_SECOND_RECIPIENT_ID },
    ],
    created: [{ id: DEMO_CREATED_001, recipient: SANDBOX_RECIPIENT_ID }],
  };
}

export interface DemoEnv {
  set: Record<string, string>;
  unset: string[];
}

/**
 * The environment the server runs under in demo mode. Pure, so the
 * tests can assert it without starting a chain: no testnet RPC URL,
 * no testnet keys, no testnet vault, and no live reputation source.
 */
export function buildDemoEnv(provisioned: ProvisionedSandbox): DemoEnv {
  return {
    set: {
      CYNEX_VAULT: provisioned.vaultId,
      CYNEX_AGENT: provisioned.agentId,
      CYNEX_AGENT_KEY_FILE: provisioned.keyFile,
      CYNEX_SANDBOX_RPC_URL: provisioned.sandbox.rpcUrl,
      CYNEX_SANDBOX_VAULT_CODE_HASH: provisioned.vaultCodeHash,
      CYNEX_SANDBOX_CHAIN_ID: provisioned.sandbox.chainId,
      CYNEX_POLICY: provisioned.policyId,
      CYNEX_SNAPSHOT_DIR: "",
      CYNEX_BLOCKLIST_URL: "",
      CYNEX_NEARBLOCKS_URL: DEMO_NEARBLOCKS_URL,
    },
    unset: ["CYNEX_RPC_URL"],
  };
}

export function applyDemoEnv(provisioned: ProvisionedSandbox): void {
  const env = buildDemoEnv(provisioned);
  for (const [name, value] of Object.entries(env.set)) {
    process.env[name] = value;
  }
  for (const name of env.unset) {
    delete process.env[name];
  }
}

export interface DemoObligationSummary {
  id: string;
  recipient: string;
  amount: string;
  state: string;
}

export interface DemoSummaryInfo {
  vaultId: string;
  rpcUrl: string;
  chainId: string;
  policyId: string;
  policyLimit: string;
  policyFunded: string;
  policySpent: string;
  agentPublicKey: string;
  obligations: DemoObligationSummary[];
  demoPath: string;
}

/** The Claude Code config snippet for the running demo, as JSON text. */
export function claudeCodeConfig(demoPath: string): string {
  // When the demo runs from its own entry point (demo.js), spawning
  // that file starts the demo. When it runs from the published
  // bundle (cynex-mcp.cjs), the same file without --sandbox would
  // start the normal server instead, so the snippet carries the flag.
  const args = demoPath.endsWith("demo.js") ? [demoPath] : [demoPath, "--sandbox"];
  return JSON.stringify(
    {
      mcpServers: {
        cynex: {
          command: "node",
          args,
          env: {},
        },
      },
    },
    null,
    2,
  );
}

/**
 * The ready summary, printed to stderr only. It names the chain, the
 * policy, and the five obligations, and tells the judge what to try.
 * It never contains a secret key: only account ids and the agent
 * public key appear.
 */
export function buildReadySummary(info: DemoSummaryInfo): string {
  const lines: string[] = [
    "Cynex MCP demo: local sandbox demo, not testnet, not production.",
    "Vault " + info.vaultId + " on " + info.rpcUrl + " (chain " + info.chainId + ").",
    "Policy " +
      info.policyId +
      ": limit " +
      info.policyLimit +
      ", funded " +
      info.policyFunded +
      ", spent " +
      info.policySpent +
      ".",
    "Seeded obligations:",
  ];
  for (const obligation of info.obligations) {
    lines.push(
      "  " +
        obligation.id +
        " " +
        obligation.recipient +
        " amount " +
        obligation.amount +
        " " +
        obligation.state,
    );
  }
  lines.push(
    "Agent public key " + info.agentPublicKey + ".",
    "Try it:",
    "  1. Settle " + DEMO_READY_001 + " with cynex_request_settlement (recipient " + SANDBOX_RECIPIENT_ID + ", amount 100).",
    "  2. Settle " + DEMO_READY_002 + " with a changed recipient (" + SANDBOX_RECIPIENT_ID + " instead of " + SANDBOX_SECOND_RECIPIENT_ID + ") and watch the vault refuse with ERR_RECIPIENT_SUBSTITUTION.",
    "  3. Settle " + DEMO_CREATED_001 + " and watch the server refuse it as not READY, with no transaction submitted.",
    "Claude Code config (paste into your MCP settings):",
    claudeCodeConfig(info.demoPath),
    "Limits: sandbox only, no live funds, the agent key is ephemeral and local-only, the sandbox is removed on exit.",
  );
  return lines.join("\n");
}

function log(message: string): void {
  console.error("[cynex-mcp-demo] " + message);
}

/**
 * Provision the sandbox, seed the demo obligations, and serve the
 * real MCP server over stdio until killed. Returns 0 on a clean
 * shutdown (SIGINT, SIGTERM, or client disconnect), 1 on a startup
 * failure. The sandbox is stopped on every exit path.
 */
export async function runDemo(): Promise<number> {
  let provisioned: ProvisionedSandbox | undefined;
  let server: ReturnType<typeof buildServer> | undefined;
  let resolveStopped: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (server !== undefined) {
      try {
        await server.close();
      } catch {
        // closing a failed server must not hide the shutdown
      }
    }
    if (provisioned !== undefined) {
      try {
        await provisioned.stop();
      } catch {
        // stopping must not hide the shutdown
      }
    }
    resolveStopped();
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  // Provisioning logs to stderr, never stdout: stdout is the MCP
  // transport. The redirect covers the sandbox binary download and
  // wasm build paths, which log with console.log; the provisioning
  // checks already go through the log option below.
  const originalLog = console.log;
  console.log = (...args: unknown[]): void => {
    console.error(...args);
  };
  try {
    const seeds = demoSeedSpecs();
    provisioned = await provisionSandbox({
      bootstrap: seeds.bootstrap,
      ready: seeds.ready,
      created: seeds.created,
      log: (message: string) => console.error(message),
    });
  } catch (error) {
    if (shuttingDown) {
      return 0;
    }
    throw error;
  } finally {
    console.log = originalLog;
  }
  if (shuttingDown || provisioned === undefined) {
    return 0;
  }

  applyDemoEnv(provisioned);
  let ctx: Awaited<ReturnType<typeof buildContext>>;
  try {
    ctx = await buildContext();
  } catch (error) {
    if (shuttingDown) {
      return 0;
    }
    log("refusing to start: " + (error instanceof Error ? error.message : String(error)));
    try {
      await provisioned.stop();
    } catch {
      // stopping must not hide the startup failure
    }
    return 1;
  }
  server = buildServer(ctx);
  const transport = new StdioServerTransport();
  transport.onclose = () => {
    void shutdown();
  };

  // Read the seeded obligations live, so the summary states what the
  // chain actually holds, not what provisioning intended.
  const summaries: DemoObligationSummary[] = [];
  for (const spec of [
    ...demoSeedSpecs().bootstrap,
    ...demoSeedSpecs().ready,
    ...demoSeedSpecs().created,
  ]) {
    const row = await provisioned.readObligation(spec.id);
    summaries.push({
      id: spec.id,
      recipient: spec.recipient,
      amount: DEMO_OBLIGATION_AMOUNT,
      state: String(row.state ?? "unknown"),
    });
  }
  const policy = await provisioned.readPolicy();
  console.error(
    buildReadySummary({
      vaultId: provisioned.vaultId,
      rpcUrl: provisioned.sandbox.rpcUrl,
      chainId: provisioned.sandbox.chainId,
      policyId: provisioned.policyId,
      policyLimit: String(provisioned.policyLimit),
      policyFunded: String(policy.funded ?? "unknown"),
      policySpent: String(policy.spent ?? "unknown"),
      agentPublicKey: ctx.agentPublicKey,
      obligations: summaries,
      demoPath: fileURLToPath(import.meta.url),
    }),
  );
  await server.connect(transport);
  log("serving six tools over stdio on sandbox vault " + provisioned.vaultId);
  await stopped;
  return 0;
}

async function main(): Promise<number> {
  try {
    return await runDemo();
  } catch (error) {
    log("demo failed: " + (error instanceof Error ? error.message : String(error)));
    return 1;
  }
}

if (
  fileURLToPath(import.meta.url) === process.argv[1] &&
  process.argv[1].endsWith("demo.js")
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      log("demo failed: " + (error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    });
}
