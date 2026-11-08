/**
 * MCP server wiring tests: buildServer registers the six tools with
 * the SDK, and a real in-process MCP client can list and call them.
 * The unit tests in tools.test.ts call dispatchTool directly; these
 * tests prove the SDK layer (registration, Zod schema parsing,
 * isError mapping, JSON serialization) is wired the same way.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { jest } from "@jest/globals";
import type { ReputationReport } from "../reputation/reputation.js";
import { buildServer, createSettleWithKey } from "./server.js";
import type { ChainClient, McpContext } from "./tools.js";
import type { RuntimeState } from "./runtime-checks.js";
import type { Account } from "near-api-js";

const VAULT = "cynex-testvault.cynexmaster.testnet";
const AGENT = "cynex-agent.cynexmaster.testnet";

function fakeContext(): McpContext {
  const client: ChainClient = {
    getPolicy: jest.fn(async () => ({
      policy_id: "p6-001",
      token_id: "usdc.fakes.testnet",
      frozen: false,
    })),
    getObligation: jest.fn(async () => ({
      obligation_id: "mcp-obl-001",
      policy_id: "p6-001",
      recipient: AGENT,
      amount: "100",
      evidence_type: "PREIMAGE",
      evidence_hash: "f23aeaa4efc068df8a05ef97c1ade88022575ad5ea52dbe9af218028462d4e27",
      expires_at_ns: "1794000000000000000",
      nonce: "90001",
      state: "READY",
      in_flight: false,
      pending_request_id: null,
      pending_digest: null,
    })),
    balances: jest.fn(async () => ({
      spent: "4600",
      reserved: "0",
      limit: "10000",
      funded: "10000",
      native_headroom: "1",
    })),
    receipts: jest.fn(async () => []),
    state: jest.fn(async () => ({ owner: "cynexmaster.testnet", tee_counter: "0", state_hash: "00" })),
    viewAccessKeyList: jest.fn(async () => ({ keys: [] })),
  };
  const report: ReputationReport = {
    accountId: AGENT,
    verdict: "ALLOW",
    score: 1,
    reasons: [],
    signals: [],
    checkedAt: "2026-11-08T00:00:00.000Z",
  };
  return {
    config: {
      vaultId: VAULT,
      agentId: AGENT,
      agentKeyFile: "/tmp/agent-key.json",
      rpcUrl: "https://rpc.testnet.fastnear.com",
      snapshotDir: "",
    },
    client,
    checkCounterparty: jest.fn(async () => report),
    settleWithKey: jest.fn(async () => "settle-tx-hash"),
    tokenBalance: jest.fn(async () => 1900n),
    agentPublicKey: "ed25519:2MBdiB9ayS1SREqAvZFC6ZuzdA9TuAjEFHV8HYPjZKgn",
    runtimeState: jest.fn(async (): Promise<RuntimeState> => ({
      chainId: "testnet",
      vaultExists: true,
      vaultCodeHash: "65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6",
      accessKey: {
        permission: {
          FunctionCall: {
            allowance: "250000000000000000000000",
            method_names: ["settle"],
            receiver_id: VAULT,
          },
        },
      },
      gasPrice: 100000000n,
    })),
  };
}

describe("MCP server wiring over an in-memory transport", () => {
  test("lists six tools and calls cynex_get_obligation through the SDK", async () => {
    const ctx = fakeContext();
    const server = buildServer(ctx);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "cynex-server-test", version: "0.1.0" }, { capabilities: {} });
    // Server first: the client connect sends initialize and waits for the
    // server response, so connecting the client first deadlocks.
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name).sort()).toEqual([
        "cynex_check_counterparty",
        "cynex_get_obligation",
        "cynex_get_policy",
        "cynex_list_receipts",
        "cynex_prepare_obligation",
        "cynex_request_settlement",
      ]);
      const out = await client.callTool({
        name: "cynex_get_obligation",
        arguments: { obligation_id: "mcp-obl-001" },
      });
      expect(out.isError).toBe(false);
      const text = (out.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("");
      const parsed = JSON.parse(text) as { ok: boolean; data: { state: string } };
      expect(parsed.ok).toBe(true);
      expect(parsed.data.state).toBe("READY");
      const bad = await client.callTool({
        name: "cynex_get_obligation",
        arguments: { obligation_id: "" },
      });
      expect(bad.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  }, 30000);
});

describe("createSettleWithKey", () => {
  test("submits settle to the configured vault and returns the transaction hash", async () => {
    const callFunctionRaw = jest.fn(async () => ({ transaction: { hash: "abc-hash" } }));
    const agent = { callFunctionRaw } as unknown as Pick<Account, "callFunctionRaw">;
    const submit = createSettleWithKey(agent, VAULT);
    const hash = await submit({
      obligation_id: "mcp-obl-001",
      proposed_recipient: AGENT,
      proposed_amount: 100n,
      evidence_ref: "ref-001",
    });
    expect(hash).toBe("abc-hash");
    expect(callFunctionRaw).toHaveBeenCalledTimes(1);
    const call = callFunctionRaw.mock.calls[0][0] as Record<string, unknown>;
    expect(call.contractId).toBe(VAULT);
    expect(call.methodName).toBe("settle");
    expect((call.args as Record<string, unknown>).proposed_amount).toBe("100");
    expect(call.gas).toBe(100000000000000n);
    expect(call.deposit).toBe(0n);
    const args = call.args as Record<string, unknown>;
    expect(args.obligation_id).toBe("mcp-obl-001");
    expect(args.proposed_recipient).toBe(AGENT);
    expect(args.proposed_amount).toBe("100");
    expect(args.evidence_ref).toBe("ref-001");
  });
});
