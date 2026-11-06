/**
 * Reputation engine tests, Phase 7 Lane B.
 *
 * The stub sources here stand in for external reads (RPC, the
 * receipts view, snapshot files, a blocklist fetch) so the verdict
 * rules can be tested without the chain. They are test doubles for
 * those reads only; they do not mock the contract, and the live
 * behavior is proven by the real CLI runs recorded in
 * docs/phase7-lane-b.md.
 */
import {
  buildReport,
  evaluateCounterparty,
  evaluateReputation,
  formatReport,
  type AccountView,
  type BlocklistCheck,
  type ReceiptsSummary,
  type ReputationSources,
  type SnapshotEntry,
} from "./reputation.js";
import { gateSettleOnReputation } from "../../agent/wrapper.js";

function view(
  exists: boolean,
  codeHash: string | null = "11111111111111111111111111111111",
): AccountView {
  return {
    exists,
    codeHash,
    blockHeight: 276444189,
    blockTimestamp: 1793890000000000000,
    fetchedAt: "2026-11-06T06:00:00.000Z",
    source: "https://test.rpc.fastnear.com",
  };
}

function receipts(count: number): ReceiptsSummary {
  return {
    count,
    firstIndex: count > 0 ? 0 : null,
    firstTimestamp: count > 0 ? 1793751483012073148n : null,
    lastIndex: count > 0 ? count - 1 : null,
    fetchedAt: "2026-11-06T06:00:00.000Z",
    source: "cynex-vault.cynexmaster.testnet receipts view",
  };
}

function snapshot(firstSeen: string | null, exists = true): SnapshotEntry[] {
  if (firstSeen === null) {
    return [];
  }
  return [
    {
      accountId: "acme-supplies.testnet",
      exists,
      codeHash: exists ? "11111111111111111111111111111111" : null,
      blockHeight: 276444189,
      blockTimestamp: 1793890000000000000,
      fetchedAt: firstSeen,
      file: "demo/reputation-snapshots/2026-11-06-060000Z.json",
    },
  ];
}

function blocklist(status: BlocklistCheck["status"]): BlocklistCheck {
  if (status === "unavailable") {
    return {
      status,
      source: "",
      fetchedAt: null,
      reason: "no suitable public blocklist source for NEAR account ids",
    };
  }
  return {
    status,
    source: "https://example.invalid/blocklist.json",
    fetchedAt: "2026-11-06T06:00:00.000Z",
    reason: "",
  };
}

function sourcesFor(
  existence: AccountView,
  receiptCount: number,
  firstSeen: string | null,
  blocklistStatus: BlocklistCheck["status"],
): ReputationSources {
  return {
    viewAccount: () => Promise.resolve(existence),
    listReceipts: () => Promise.resolve(receipts(receiptCount)),
    readSnapshots: () => Promise.resolve(snapshot(firstSeen)),
    checkBlocklist: () => Promise.resolve(blocklist(blocklistStatus)),
  };
}

describe("scaffold evaluateReputation", () => {
  it("returns WARN with a null score when no signal is sourced", () => {
    const out = evaluateReputation([{ source: "", value: 1 }]);
    expect(out.score).toBeNull();
    expect(out.warnInsufficientHistory).toBe(true);
  });

  it("averages sourced signals and does not warn", () => {
    const out = evaluateReputation([
      { source: "rpc", value: 1 },
      { source: "receipts", value: 0 },
    ]);
    expect(out.score).toBe(0.5);
    expect(out.warnInsufficientHistory).toBe(false);
  });
});

describe("buildReport verdicts", () => {
  it("an unknown address returns WARN with no score", async () => {
    const report = await evaluateCounterparty(
      "unregistered-xyz.testnet",
      sourcesFor(view(false), 0, null, "unavailable"),
    );
    expect(report.verdict).toBe("WARN");
    expect(report.score).toBeNull();
    expect(report.reasons).toContain("account does not exist at the current block");
    expect(report.reasons).toContain("no prior vault interactions in our receipts");
    const lines = formatReport(report);
    expect(lines[0]).toContain("WARN");
    for (const line of lines.slice(1, 5)) {
      expect(line).toContain("source:");
      expect(line).toContain("at:");
    }
  });

  it("an account that exists but has no receipts returns WARN, not ALLOW", async () => {
    const report = await evaluateCounterparty(
      "cynex-agent.cynexmaster.testnet",
      sourcesFor(view(true), 0, "2026-11-06T06:00:00.000Z", "unavailable"),
    );
    expect(report.verdict).toBe("WARN");
    expect(report.score).toBeNull();
    expect(report.reasons).toContain("no prior vault interactions in our receipts");
  });

  it("an account with receipts that no longer exists returns WARN", async () => {
    const report = await evaluateCounterparty(
      "acme-supplies.testnet",
      sourcesFor(view(false), 8, null, "unavailable"),
    );
    expect(report.verdict).toBe("WARN");
    expect(report.score).toBeNull();
    expect(report.reasons).toContain("account does not exist at the current block");
    const receiptsLine = report.signals.find((s) => s.name === "prior_vault_interactions");
    expect(receiptsLine?.status).toBe("sourced");
    expect(receiptsLine?.value).toContain("8 receipts");
  });

  it("a signal without a source is rejected as unavailable and never scored", () => {
    const report = buildReport(
      "someone.testnet",
      null,
      [],
      receipts(0),
      blocklist("unavailable"),
      "2026-11-06T06:00:00.000Z",
    );
    const existence = report.signals.find((s) => s.name === "account_existence");
    expect(existence?.status).toBe("unavailable");
    expect(existence?.source).toBe("");
    const blocklistLine = report.signals.find((s) => s.name === "blocklist");
    expect(blocklistLine?.status).toBe("unavailable");
    expect(report.verdict).toBe("WARN");
    expect(report.score).toBeNull();
  });

  it("a listed address returns BLOCK naming the source", async () => {
    const report = await evaluateCounterparty(
      "bad-actor.testnet",
      sourcesFor(view(true), 3, "2026-11-06T06:00:00.000Z", "listed"),
    );
    expect(report.verdict).toBe("BLOCK");
    expect(report.score).toBeNull();
    expect(report.reasons[0]).toContain("https://example.invalid/blocklist.json");
  });

  it("an existing account with receipts and a first-seen snapshot returns ALLOW with a score", async () => {
    const report = await evaluateCounterparty(
      "good-counterparty.testnet",
      sourcesFor(view(true), 2, "2026-11-05T06:00:00.000Z", "not_listed"),
    );
    expect(report.verdict).toBe("ALLOW");
    expect(report.score).toBe(1);
    expect(report.reasons).toEqual([]);
  });

  it("a blocklist that is unavailable does not by itself force WARN", async () => {
    const report = await evaluateCounterparty(
      "good-counterparty.testnet",
      sourcesFor(view(true), 2, "2026-11-05T06:00:00.000Z", "unavailable"),
    );
    expect(report.verdict).toBe("ALLOW");
    const blocklistLine = report.signals.find((s) => s.name === "blocklist");
    expect(blocklistLine?.status).toBe("unavailable");
    expect(blocklistLine?.value).toBe("unavailable");
  });
});

describe("wrapper reputation gate", () => {
  it("a blocked address refuses in the wrapper and names the signal and source", async () => {
    const report = await evaluateCounterparty(
      "bad-actor.testnet",
      sourcesFor(view(true), 3, "2026-11-06T06:00:00.000Z", "listed"),
    );
    const gate = gateSettleOnReputation(report, { approveWarn: false });
    expect(gate.decision).toBe("refuse");
    expect(gate.reason).toContain("BLOCK");
    expect(gate.reason).toContain("blocklist");
    expect(gate.reason).toContain("https://example.invalid/blocklist.json");
  });

  it("a warned address escalates without owner approval and proceeds with it", async () => {
    const report = await evaluateCounterparty(
      "unregistered-xyz.testnet",
      sourcesFor(view(false), 0, null, "unavailable"),
    );
    const escalated = gateSettleOnReputation(report, { approveWarn: false });
    expect(escalated.decision).toBe("escalate");
    expect(escalated.reason).toContain("WARN");
    expect(escalated.reason).toContain("no prior vault interactions");
    const approved = gateSettleOnReputation(report, { approveWarn: true });
    expect(approved.decision).toBe("proceed");
    expect(approved.reason).toContain("owner approved");
  });

  it("an allowed address proceeds", async () => {
    const report = await evaluateCounterparty(
      "good-counterparty.testnet",
      sourcesFor(view(true), 2, "2026-11-05T06:00:00.000Z", "not_listed"),
    );
    const gate = gateSettleOnReputation(report, { approveWarn: false });
    expect(gate.decision).toBe("proceed");
  });
});
