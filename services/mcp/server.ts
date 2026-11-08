/**
 * Cynex MCP server, survival plan item 2. Stdio only for v1.
 *
 * The MCP server lets an agent request settlement using only a
 * scoped settle key, while the NEAR vault enforces the
 * human-authorized terms even if the agent is compromised.
 *
 * Transport is stdio only: the MCP client spawns this server as
 * a subprocess and talks JSON-RPC over stdin and stdout. That is
 * why nothing here ever writes to stdout except the transport
 * itself; all server logs go to stderr.
 *
 * Three-way separation, documented here and in services/mcp/
 * README.md: the hosted website is public inspection and
 * demonstration; this local MCP server is agent integration
 * using a scoped settle-only key; the vault is the final
 * enforcement of settlement terms.
 *
 * The server holds exactly one key, the agent scoped settle-only
 * key from CYNEX_AGENT_KEY_FILE. At startup it verifies that
 * key scope on chain (see config.ts verifyKeyScope) and refuses
 * to start on a full-access key, a wrong receiver, or broader
 * methods. The key is never printed, logged, or returned in any
 * tool output.
 *
 * Run: node dist-test/services/mcp/server.js, with the CYNEX_*
 * environment set. Build: npm run mcp:build, from frontend/.
 */
import { JsonRpcProvider, Account, KeyPairSigner } from "near-api-js";
import { fileURLToPath } from "node:url";
import type { SettleArgs } from "../../frontend/src/cynex/api.js";
import type { KeyPairString } from "near-api-js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CynexClient } from "../../frontend/src/cynex/client.js";
import { SETTLE_CALL_GAS, txHashOf } from "../../agent/console.js";
import { evaluateCounterparty } from "../reputation/reputation.js";
import { makeLiveSources } from "../reputation/live-sources.js";
import { loadConfig, readAgentKey, verifyKeyScope } from "./config.js";
import {
  assertSettleTarget,
  parseGasPrice,
  type RuntimeState,
} from "./runtime-checks.js";
import {
  TOOL_DESCRIPTIONS,
  TOOL_SCHEMAS,
  createDefaultRateLimiter,
  dispatchTool,
  type McpContext,
} from "./tools.js";

function log(message: string): void {
  console.error("[cynex-mcp] " + message);
}

/**
 * Build the settle submitter for one vault. This is the single
 * choke point where a transaction is signed: the contract id and
 * the method name are chosen here, and nowhere else, and the
 * target assertion runs on every call. The only receiver is the
 * configured vault and the only method is settle, so a future
 * code path cannot quietly submit a different call with the
 * scoped key. The test asserts the captured call, not just the
 * assertion result.
 */
export function createSettleWithKey(
  agent: Pick<Account, "callFunctionRaw">,
  vaultId: string,
): (args: SettleArgs) => Promise<string> {
  return async (args: SettleArgs) => {
    const contractId = vaultId;
    const methodName = "settle";
    const target = assertSettleTarget(vaultId, contractId, methodName);
    if (!target.ok) {
      throw new Error(target.reason);
    }
    // Settle attaches no deposit: the vault attaches the 1 yoctoNEAR
    // for its own ft_transfer. Stating 0n keeps the call from
    // silently inheriting a default.
    const outcome = await agent.callFunctionRaw({
      contractId,
      methodName,
      args: { ...args, proposed_amount: args.proposed_amount.toString() },
      gas: SETTLE_CALL_GAS,
      deposit: 0n,
    });
    return txHashOf(outcome);
  };
}

export async function buildContext(): Promise<McpContext> {
  const config = loadConfig();
  const agentKey = readAgentKey(config.agentKeyFile);
  const client = new CynexClient(config.vaultId, config.rpcUrl);
  const keyList = await client.viewAccessKeyList(config.agentId);
  const scope = verifyKeyScope(keyList, agentKey.publicKey, config.vaultId);
  if (!scope.ok) {
    throw new Error(scope.reason);
  }
  log("startup scope check passed for public key " + agentKey.publicKey + ": " + scope.reason);
  const provider = new JsonRpcProvider({ url: config.rpcUrl });
  const agent = new Account(
    config.agentId,
    provider,
    KeyPairSigner.fromSecretKey(agentKey.secretKey as KeyPairString),
  );
  return {
    config,
    client,
    checkCounterparty: async (accountId: string) => {
      const sources = makeLiveSources({
        vaultId: config.vaultId,
        rpcUrl: config.rpcUrl,
        snapshotDir: config.snapshotDir,
        blocklistUrl: config.blocklistUrl,
        nearblocksBaseUrl: config.nearblocksUrl,
      });
      return evaluateCounterparty(accountId, sources);
    },
    settleWithKey: createSettleWithKey(agent, config.vaultId),
    tokenBalance: async (tokenId: string, accountId: string) => {
      const result = await provider.callFunction({
        contractId: tokenId,
        method: "ft_balance_of",
        args: { account_id: accountId },
        blockQuery: { finality: "final" },
      });
      return BigInt(String(result as unknown));
    },
    agentPublicKey: agentKey.publicKey,
    // Live runtime state, re-read for every settle attempt. Each
    // read is caught on its own: a failed read leaves its field
    // null, and the runtime checks fail closed on a null field
    // rather than treating an unreadable value as a pass.
    runtimeState: async (): Promise<RuntimeState> => {
      let chainId: string | null = null;
      try {
        const status = await provider.viewNodeStatus();
        chainId = typeof status.chain_id === "string" ? status.chain_id : null;
      } catch {
        chainId = null;
      }
      let vaultExists = false;
      let vaultCodeHash: string | null = null;
      try {
        const account = await provider.viewAccount({
          accountId: config.vaultId,
          blockQuery: { finality: "final" },
        });
        vaultExists = true;
        vaultCodeHash = typeof account.code_hash === "string" ? account.code_hash : null;
      } catch {
        vaultExists = false;
        vaultCodeHash = null;
      }
      let accessKey: unknown = null;
      try {
        accessKey = await provider.viewAccessKey({
          accountId: config.agentId,
          publicKey: agentKey.publicKey,
          finalityQuery: { finality: "final" },
        });
      } catch {
        accessKey = null;
      }
      let gasPrice: bigint | null = null;
      try {
        const gas = await provider.viewGasPrice();
        const raw = (gas as { gas_price?: unknown }).gas_price;
        gasPrice = parseGasPrice(raw);
      } catch {
        gasPrice = null;
      }
      return { chainId, vaultExists, vaultCodeHash, accessKey, gasPrice };
    },
  };
}

export function buildServer(ctx: McpContext): McpServer {
  const limiter = createDefaultRateLimiter();
  const server = new McpServer({
    name: "cynex",
    version: "0.1.0",
  });
  for (const name of Object.keys(TOOL_SCHEMAS) as (keyof typeof TOOL_SCHEMAS)[]) {
    server.tool(name, TOOL_DESCRIPTIONS[name] as string, TOOL_SCHEMAS[name], async (args: Record<string, unknown>) => {
      const result = await dispatchTool(ctx, limiter, name, args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        isError: !result.ok,
      };
    });
  }
  return server;
}

async function main(): Promise<number> {
  let ctx: McpContext;
  try {
    ctx = await buildContext();
  } catch (error) {
    log("refusing to start: " + (error instanceof Error ? error.message : String(error)));
    return 1;
  }
  const server = buildServer(ctx);
  log("serving six tools over stdio on vault " + ctx.config.vaultId);
  await server.connect(new StdioServerTransport());
  return 0;
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      log("server failed: " + (error instanceof Error ? error.message : String(error)));
      process.exitCode = 1;
    });
}
