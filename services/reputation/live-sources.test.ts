/**
 * Live sources tests, Phase 7 Lane B.
 *
 * The stub fetch stands in for the RPC endpoint and the blocklist
 * URL so the parsing and error handling can be tested without the
 * network. It is a test double for those endpoints only; the live
 * behavior is proven by the real CLI runs recorded in
 * docs/phase7-lane-b.md.
 */
import { evaluateCounterparty } from "./reputation.js";
import { makeLiveSources } from "./live-sources.js";

const RPC_URL = "https://test.rpc.fastnear.com";
const VAULT = "cynex-vault.cynexmaster.testnet";

type StubResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

function stubFetchFactory(blocklistBody: string | null, blocklistStatus = 200): typeof fetch {
  const receiptsPage = [
    { index: "0", recipient: "acme-supplies.testnet", timestamp: "1793751483012073148" },
    { index: "1", recipient: "someone-else.testnet", timestamp: "1793752000000000000" },
    { index: "2", recipient: "acme-supplies.testnet", timestamp: "1793753000000000000" },
  ];
  const asResponse = (payload: unknown, ok = true, status = 200): StubResponse => ({
    ok,
    status,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(typeof payload === "string" ? payload : JSON.stringify(payload)),
  });
  return ((input: unknown, init?: { body?: string }) => {
    const url = String(input);
    if (url.startsWith("https://example.invalid/blocklist")) {
      if (blocklistBody === null) {
        return Promise.resolve(asResponse("not found", false, 404));
      }
      return Promise.resolve(asResponse(blocklistBody, blocklistStatus === 200, blocklistStatus));
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      method?: string;
      params?: { request_type?: string; account_id?: string; method_name?: string; args_base64?: string };
    };
    if (body.method === "block") {
      return Promise.resolve(
        asResponse({ result: { header: { height: 276444189, timestamp: 1793890000000000000 } } }),
      );
    }
    if (body.params?.request_type === "view_account") {
      if (body.params.account_id === "acme-supplies.testnet") {
        return Promise.resolve(
          asResponse({ error: { cause: { name: "UNKNOWN_ACCOUNT" }, message: "Account does not exist" } }),
        );
      }
      return Promise.resolve(
        asResponse({
          result: {
            amount: "1986901427025334000000000",
            code_hash: "11111111111111111111111111111111",
            block_height: 276444189,
          },
        }),
      );
    }
    if (body.params?.method_name === "receipts") {
      const args = JSON.parse(
        Buffer.from(String(body.params.args_base64 ?? ""), "base64").toString("utf-8"),
      ) as { start?: number };
      const page = (args.start ?? 0) === 0 ? receiptsPage : [];
      const bytes = Array.from(Buffer.from(JSON.stringify(page), "utf-8"));
      return Promise.resolve(asResponse({ result: { result: bytes } }));
    }
    return Promise.reject(new Error("unexpected stub request: " + url));
  }) as unknown as typeof fetch;
}

describe("live sources with a stub RPC", () => {
  it("an existing account reads exists with its code hash", async () => {
    const sources = makeLiveSources({
      vaultId: VAULT,
      rpcUrl: RPC_URL,
      snapshotDir: "/nonexistent",
      fetchFn: stubFetchFactory(null),
    });
    const view = await sources.viewAccount("cynex-agent.cynexmaster.testnet");
    expect(view.exists).toBe(true);
    expect(view.codeHash).toBe("11111111111111111111111111111111");
    expect(view.blockHeight).toBe(276444189);
    expect(view.source).toBe(RPC_URL);
  });

  it("an UNKNOWN_ACCOUNT error is a sourced not-found, not a failure", async () => {
    const sources = makeLiveSources({
      vaultId: VAULT,
      rpcUrl: RPC_URL,
      snapshotDir: "/nonexistent",
      fetchFn: stubFetchFactory(null),
    });
    const view = await sources.viewAccount("acme-supplies.testnet");
    expect(view.exists).toBe(false);
    expect(view.codeHash).toBeNull();
    expect(view.blockHeight).toBe(276444189);
  });

  it("receipts are counted per recipient with the first index and timestamp", async () => {
    const sources = makeLiveSources({
      vaultId: VAULT,
      rpcUrl: RPC_URL,
      snapshotDir: "/nonexistent",
      fetchFn: stubFetchFactory(null),
    });
    const summary = await sources.listReceipts("acme-supplies.testnet");
    expect(summary.count).toBe(2);
    expect(summary.firstIndex).toBe(0);
    expect(summary.firstTimestamp).toBe(1793751483012073148n);
    expect(summary.lastIndex).toBe(2);
  });

  it("no blocklist URL means the signal is unavailable, never invented", async () => {
    const sources = makeLiveSources({
      vaultId: VAULT,
      rpcUrl: RPC_URL,
      snapshotDir: "/nonexistent",
      fetchFn: stubFetchFactory(null),
    });
    const check = await sources.checkBlocklist("acme-supplies.testnet");
    expect(check.status).toBe("unavailable");
    expect(check.reason).toContain("no suitable public blocklist source");
  });

  it("a blocklist URL lists and clears accounts from its JSON array", async () => {
    const sources = makeLiveSources({
      vaultId: VAULT,
      rpcUrl: RPC_URL,
      snapshotDir: "/nonexistent",
      blocklistUrl: "https://example.invalid/blocklist.json",
      fetchFn: stubFetchFactory(JSON.stringify(["bad-actor.testnet"])),
    });
    const listed = await sources.checkBlocklist("bad-actor.testnet");
    expect(listed.status).toBe("listed");
    expect(listed.source).toBe("https://example.invalid/blocklist.json");
    const clear = await sources.checkBlocklist("acme-supplies.testnet");
    expect(clear.status).toBe("not_listed");
  });

  it("a blocklist URL that fails is unavailable with the reason", async () => {
    const sources = makeLiveSources({
      vaultId: VAULT,
      rpcUrl: RPC_URL,
      snapshotDir: "/nonexistent",
      blocklistUrl: "https://example.invalid/blocklist.json",
      fetchFn: stubFetchFactory(null),
    });
    const check = await sources.checkBlocklist("acme-supplies.testnet");
    expect(check.status).toBe("unavailable");
    expect(check.reason).toContain("HTTP 404");
  });

  it("end to end: a missing account with receipts is WARN through the live sources", async () => {
    const sources = makeLiveSources({
      vaultId: VAULT,
      rpcUrl: RPC_URL,
      snapshotDir: "/nonexistent",
      fetchFn: stubFetchFactory(null),
    });
    const report = await evaluateCounterparty("acme-supplies.testnet", sources);
    expect(report.verdict).toBe("WARN");
    expect(report.score).toBeNull();
    expect(report.reasons).toContain("account does not exist at the current block");
  });
});
