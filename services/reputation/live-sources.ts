/**
 * Live reputation sources, Phase 7 Lane B.
 *
 * Builds the ReputationSources object from real reads: the RPC
 * view_account call, the contract receipts view paginated from
 * genesis, the snapshot files on disk, an optional blocklist
 * URL, and the NearBlocks v3 deployments endpoint for the exact
 * age of the current contract code. Used by the CLI reputation
 * command and by the console reputation gate, so both read the
 * same way.
 *
 * Error handling is deliberate and differs per signal:
 * - view_account: an UNKNOWN_ACCOUNT error is a sourced fact
 *   (the account does not exist), not a failure. Any other RPC
 *   error is a check failure and throws.
 * - receipts: an RPC error is a check failure and throws.
 * - snapshots: a missing directory means no snapshots on record;
 *   the age signal is unavailable, not a failure.
 * - blocklist: no URL configured means unavailable (no suitable
 *   public source; see docs/phase7-lane-b.md). A fetch or parse
 *   failure also means unavailable, with the reason recorded.
 *   A blocklist URL is only ever used when one is configured;
 *   nothing is fetched silently.
 * - code deployments: the NearBlocks v3 endpoint returns the
 *   deployment history for the account; an empty list means no
 *   deployments on record (no contract). A fetch or parse failure
 *   means unavailable, with the reason recorded, and the signal
 *   falls back to the snapshot window. The indexer timestamp is
 *   only trusted by the signal when it is after the previous
 *   snapshot; an older timestamp means the indexer is missing
 *   the latest deployment.
 *
 * The blocklist format accepted here is a JSON array of NEAR
 * account ids, or a newline-delimited text list of account ids.
 * Anything else is rejected as unavailable with the reason.
 */
import {
  NO_BLOCKLIST_REASON,
  type AccountView,
  type BlocklistCheck,
  type CodeDeploymentCheck,
  type ReceiptsSummary,
  type ReputationSources,
  type SnapshotEntry,
} from "./reputation.js";
import { readSnapshots } from "./snapshot.js";

export const NEARBLOCKS_TESTNET_API = "https://api-testnet.nearblocks.io";

export interface LiveSourcesOptions {
  vaultId: string;
  rpcUrl: string;
  snapshotDir: string;
  blocklistUrl?: string;
  nearblocksBaseUrl?: string;
  fetchFn?: typeof fetch;
}

interface RpcEnvelope {
  error?: { cause?: { name?: string }; message?: string };
  result?: unknown;
}

async function rpcQuery(
  rpcUrl: string,
  body: Record<string, unknown>,
  fetchFn: typeof fetch,
): Promise<RpcEnvelope> {
  const response = await fetchFn(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as RpcEnvelope;
}

function rpcBody(method: string, params: Record<string, unknown>): Record<string, unknown> {
  return { jsonrpc: "2.0", id: "cynex-reputation", method, params };
}

async function viewAccountLive(
  rpcUrl: string,
  accountId: string,
  fetchFn: typeof fetch,
): Promise<AccountView> {
  const fetchedAt = new Date().toISOString();
  const data = await rpcQuery(
    rpcUrl,
    rpcBody("query", { request_type: "view_account", account_id: accountId, finality: "final" }),
    fetchFn,
  );
  if (data.error !== undefined) {
    const causeName = String(data.error.cause?.name ?? "");
    const message = String(data.error.message ?? "");
    if (causeName === "UNKNOWN_ACCOUNT" || /unknown account/i.test(message)) {
      const block = await latestBlock(rpcUrl, fetchFn);
      return {
        exists: false,
        codeHash: null,
        blockHeight: block.height,
        blockTimestamp: block.timestamp,
        fetchedAt,
        source: rpcUrl,
      };
    }
    throw new Error("view_account failed: " + JSON.stringify(data.error));
  }
  const result = data.result as {
    amount?: string;
    code_hash?: string;
    block_height?: number;
  };
  if (typeof result.code_hash !== "string" || typeof result.block_height !== "number") {
    throw new Error("view_account returned an unexpected shape for " + accountId);
  }
  const block = await latestBlock(rpcUrl, fetchFn);
  return {
    exists: true,
    codeHash: result.code_hash,
    blockHeight: result.block_height,
    blockTimestamp: block.timestamp,
    fetchedAt,
    source: rpcUrl,
  };
}

async function latestBlock(rpcUrl: string, fetchFn: typeof fetch): Promise<{ height: number; timestamp: number }> {
  const data = await rpcQuery(rpcUrl, rpcBody("block", { finality: "final" }), fetchFn);
  if (data.error !== undefined) {
    throw new Error("block query failed: " + JSON.stringify(data.error));
  }
  const header = (data.result as { header?: { height?: number; timestamp?: number } } | undefined)
    ?.header ?? {};
  if (typeof header.height !== "number" || typeof header.timestamp !== "number") {
    throw new Error("block query returned an unexpected shape");
  }
  return { height: header.height, timestamp: header.timestamp };
}

interface ReceiptRow {
  index: string;
  recipient: string;
  timestamp: string;
}

async function listReceiptsLive(
  rpcUrl: string,
  vaultId: string,
  accountId: string,
  fetchFn: typeof fetch,
): Promise<ReceiptsSummary> {
  const fetchedAt = new Date().toISOString();
  const source = vaultId + " receipts view";
  let start = 0;
  let count = 0;
  let firstIndex: number | null = null;
  let firstTimestamp: bigint | null = null;
  let lastIndex: number | null = null;
  for (;;) {
    const argsBase64 = Buffer.from(JSON.stringify({ start, limit: 100 })).toString("base64");
    const data = await rpcQuery(
      rpcUrl,
      rpcBody("query", {
        request_type: "call_function",
        account_id: vaultId,
        method_name: "receipts",
        args_base64: argsBase64,
        finality: "final",
      }),
      fetchFn,
    );
    if (data.error !== undefined) {
      throw new Error("receipts view failed: " + JSON.stringify(data.error));
    }
    const raw = Buffer.from((data.result as { result?: number[] } | undefined)?.result ?? []).toString("utf-8");
    const page = JSON.parse(raw) as ReceiptRow[];
    if (page.length === 0) {
      break;
    }
    for (const row of page) {
      if (row.recipient === accountId) {
        const index = Number(row.index);
        if (firstIndex === null) {
          firstIndex = index;
          firstTimestamp = BigInt(row.timestamp);
        }
        lastIndex = index;
        count += 1;
      }
    }
    start += page.length;
    if (page.length < 100) {
      break;
    }
  }
  return { count, firstIndex, firstTimestamp, lastIndex, fetchedAt, source };
}

function parseBlocklist(text: string): string[] | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed as string[];
    }
    return null;
  } catch {
    const lines = trimmed
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    return lines;
  }
}

async function checkBlocklistLive(
  accountId: string,
  blocklistUrl: string | undefined,
  fetchFn: typeof fetch,
): Promise<BlocklistCheck> {
  if (blocklistUrl === undefined || blocklistUrl.trim().length === 0) {
    return { status: "unavailable", source: "", fetchedAt: null, reason: NO_BLOCKLIST_REASON };
  }
  const fetchedAt = new Date().toISOString();
  try {
    const response = await fetchFn(blocklistUrl, { method: "GET" });
    if (!response.ok) {
      return {
        status: "unavailable",
        source: blocklistUrl,
        fetchedAt,
        reason: "blocklist fetch failed: HTTP " + response.status,
      };
    }
    const entries = parseBlocklist(await response.text());
    if (entries === null) {
      return {
        status: "unavailable",
        source: blocklistUrl,
        fetchedAt,
        reason: "blocklist at " + blocklistUrl + " is not a JSON array or line list of account ids",
      };
    }
    return {
      status: entries.includes(accountId) ? "listed" : "not_listed",
      source: blocklistUrl,
      fetchedAt,
      reason: "",
    };
  } catch (error) {
    return {
      status: "unavailable",
      source: blocklistUrl,
      fetchedAt,
      reason: "blocklist fetch failed: " + (error instanceof Error ? error.message : String(error)),
    };
  }
}

async function checkCodeDeploymentLive(
  accountId: string,
  nearblocksBaseUrl: string,
  fetchFn: typeof fetch,
): Promise<CodeDeploymentCheck> {
  const url =
    nearblocksBaseUrl + "/v3/accounts/" + accountId + "/contract/deployments?limit=5";
  const fetchedAt = new Date().toISOString();
  const unavailable = (reason: string): CodeDeploymentCheck => ({
    status: "unavailable",
    latestDeploymentTimestampNs: null,
    latestDeploymentTx: null,
    source: url,
    fetchedAt,
    reason,
  });
  try {
    const response = await fetchFn(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return unavailable("NearBlocks deployments fetch failed: HTTP " + response.status);
    }
    const body = (await response.json()) as { data?: unknown };
    if (!Array.isArray(body.data)) {
      return unavailable("NearBlocks deployments returned an unexpected shape");
    }
    const rows = body.data as {
      block?: { block_timestamp?: string };
      transaction_hash?: string;
    }[];
    if (rows.length === 0) {
      return {
        status: "no_contract",
        latestDeploymentTimestampNs: null,
        latestDeploymentTx: null,
        source: url,
        fetchedAt,
        reason: "no deployments on record for this account",
      };
    }
    let latest: { blockTimestamp: string; tx: string | null } | null = null;
    for (const row of rows) {
      const ts = row.block?.block_timestamp;
      if (typeof ts !== "string") {
        continue;
      }
      if (latest === null || BigInt(ts) > BigInt(latest.blockTimestamp)) {
        latest = {
          blockTimestamp: ts,
          tx: typeof row.transaction_hash === "string" ? row.transaction_hash : null,
        };
      }
    }
    if (latest === null) {
      return unavailable("NearBlocks deployments had no block timestamp");
    }
    return {
      status: "deployed",
      latestDeploymentTimestampNs: latest.blockTimestamp,
      latestDeploymentTx: latest.tx,
      source: url,
      fetchedAt,
      reason: "",
    };
  } catch (error) {
    return unavailable(
      "NearBlocks deployments fetch failed: " + (error instanceof Error ? error.message : String(error)),
    );
  }
}

export function makeLiveSources(options: LiveSourcesOptions): ReputationSources {
  const fetchFn = options.fetchFn ?? fetch;
  return {
    viewAccount: (accountId: string) => viewAccountLive(options.rpcUrl, accountId, fetchFn),
    listReceipts: (accountId: string) => listReceiptsLive(options.rpcUrl, options.vaultId, accountId, fetchFn),
    readSnapshots: (accountId: string): Promise<SnapshotEntry[]> =>
      Promise.resolve(readSnapshots(options.snapshotDir, accountId)),
    checkBlocklist: (accountId: string) => checkBlocklistLive(accountId, options.blocklistUrl, fetchFn),
    checkCodeDeployment: (accountId: string) =>
      checkCodeDeploymentLive(accountId, options.nearblocksBaseUrl ?? NEARBLOCKS_TESTNET_API, fetchFn),
  };
}

export async function takeLiveSnapshot(
  rpcUrl: string,
  accountId: string,
  fetchFn: typeof fetch,
): Promise<{ exists: boolean; codeHash: string | null; blockHeight: number; blockTimestamp: number }> {
  const view = await viewAccountLive(rpcUrl, accountId, fetchFn);
  const block = await latestBlock(rpcUrl, fetchFn);
  return {
    exists: view.exists,
    codeHash: view.codeHash,
    blockHeight: block.height,
    blockTimestamp: block.timestamp,
  };
}
