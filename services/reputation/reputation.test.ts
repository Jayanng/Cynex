/**
 * Reputation engine tests,  frontend.
 *
 * The stub sources here stand in for external reads (RPC, the
 * receipts view, snapshot files, a blocklist fetch) so the verdict
 * rules can be tested without the chain. They are test doubles for
 * those reads only; they do not mock the contract, and the live
 * behavior is proven by the real CLI runs recorded in
 * docs/reputation-engine.md.
 */
import {
  buildReport,
  evaluateCounterparty,
  evaluateReputation,
  formatReport,
  type AccountView,
  type BlocklistCheck,
  type CodeDeploymentCheck,
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

const OLD_HASH = "G3Mt2gKs94C61Se4oLWvMUgR2Bfv2djdFQLz4TVrDH3E";
const NEW_HASH = "7PBw1x6HbH3Eu2dWrTKjEEfxdJnAfFPwPJS5vZMM5zRC";
const CHECKED_AT = "2026-11-06T12:00:00.000Z";

function deployment(
  status: CodeDeploymentCheck["status"],
  deployedAtIso: string | null = null,
): CodeDeploymentCheck {
  if (status === "unavailable") {
    return {
      status,
      latestDeploymentTimestampNs: null,
      latestDeploymentTx: null,
      source: "",
      fetchedAt: null,
      reason: "indexer unreachable in the test",
    };
  }
  if (status === "no_contract") {
    return {
      status,
      latestDeploymentTimestampNs: null,
      latestDeploymentTx: null,
      source: "https://api-testnet.nearblocks.io/v3/accounts/x/contract/deployments?limit=5",
      fetchedAt: CHECKED_AT,
      reason: "no deployments on record for this account",
    };
  }
  const ns = (BigInt(Date.parse(deployedAtIso as string)) * 1000000n).toString();
  return {
    status,
    latestDeploymentTimestampNs: ns,
    latestDeploymentTx: "deadbeef",
    source: "https://api-testnet.nearblocks.io/v3/accounts/x/contract/deployments?limit=5",
    fetchedAt: CHECKED_AT,
    reason: "",
  };
}

function codeView(codeHash: string): AccountView {
  return {
    exists: true,
    codeHash,
    blockHeight: 276444189,
    blockTimestamp: 1793890000000000000,
    fetchedAt: CHECKED_AT,
    source: "https://test.rpc.fastnear.com",
  };
}

function codeSnapshot(codeHash: string, fetchedAt: string): SnapshotEntry[] {
  return [
    {
      accountId: "counterparty.testnet",
      exists: true,
      codeHash,
      blockHeight: 276444189,
      blockTimestamp: 1793890000000000000,
      fetchedAt,
      file: "demo/reputation-snapshots/2026-11-05-120000Z.json",
    },
  ];
}

function sourcesWithSnapshots(
  existence: AccountView,
  receiptCount: number,
  entries: SnapshotEntry[],
  blocklistStatus: BlocklistCheck["status"],
  deploymentCheck: CodeDeploymentCheck,
): ReputationSources {
  return {
    viewAccount: () => Promise.resolve(existence),
    listReceipts: () => Promise.resolve(receipts(receiptCount)),
    readSnapshots: () => Promise.resolve(entries),
    checkBlocklist: () => Promise.resolve(blocklist(blocklistStatus)),
    checkCodeDeployment: () => Promise.resolve(deploymentCheck),
  };
}

function codeReport(
  codeHash: string,
  entries: SnapshotEntry[],
  receiptCount: number,
  deploymentCheck: CodeDeploymentCheck,
) {
  return buildReport(
    "counterparty.testnet",
    codeView(codeHash),
    entries,
    receipts(receiptCount),
    blocklist("not_listed"),
    deploymentCheck,
    CHECKED_AT,
  );
}

function sourcesFor(
  existence: AccountView,
  receiptCount: number,
  firstSeen: string | null,
  blocklistStatus: BlocklistCheck["status"],
  deploymentCheck: CodeDeploymentCheck = deployment("unavailable"),
): ReputationSources {
  return {
    viewAccount: () => Promise.resolve(existence),
    listReceipts: () => Promise.resolve(receipts(receiptCount)),
    readSnapshots: () => Promise.resolve(snapshot(firstSeen)),
    checkBlocklist: () => Promise.resolve(blocklist(blocklistStatus)),
    checkCodeDeployment: () => Promise.resolve(deploymentCheck),
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
      deployment("unavailable"),
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

describe("code_change_recency signal", () => {
  it("no change since the last snapshot is ALLOW on this signal and overall ALLOW", () => {
    const report = codeReport(NEW_HASH, codeSnapshot(NEW_HASH, "2026-11-05T12:00:00.000Z"), 2, deployment("unavailable"));
    expect(report.verdict).toBe("ALLOW");
    expect(report.score).toBe(1);
    const line = report.signals.find((s) => s.name === "code_change_recency");
    expect(line?.status).toBe("sourced");
    expect(line?.value).toContain("no change");
  });

  it("a recent change inside the 7-day window is WARN with the window reported", () => {
    const report = codeReport(NEW_HASH, codeSnapshot(OLD_HASH, "2026-11-03T12:00:00.000Z"), 2, deployment("unavailable"));
    expect(report.verdict).toBe("WARN");
    expect(report.score).toBeNull();
    expect(report.reasons.some((r) => r.startsWith("code_change_recency"))).toBe(true);
    const line = report.signals.find((s) => s.name === "code_change_recency");
    expect(line?.value).toContain("3.0d window");
    expect(line?.note).toContain(OLD_HASH);
    expect(line?.note).toContain(NEW_HASH);
  });

  it("a very recent change inside the 24-hour window is BLOCK", () => {
    const report = codeReport(NEW_HASH, codeSnapshot(OLD_HASH, "2026-11-06T06:00:00.000Z"), 2, deployment("unavailable"));
    expect(report.verdict).toBe("BLOCK");
    expect(report.score).toBeNull();
    expect(report.reasons.some((r) => r.startsWith("code_change_recency"))).toBe(true);
    const line = report.signals.find((s) => s.name === "code_change_recency");
    expect(line?.note).toContain("BLOCK");
  });

  it("a very recent change by the indexer age is BLOCK even when the snapshot window is wide", () => {
    const report = codeReport(
      NEW_HASH,
      codeSnapshot(OLD_HASH, "2026-10-20T12:00:00.000Z"),
      2,
      deployment("deployed", "2026-11-06T06:00:00.000Z"),
    );
    expect(report.verdict).toBe("BLOCK");
    const line = report.signals.find((s) => s.name === "code_change_recency");
    expect(line?.note).toContain("age 6.0h");
  });

  it("a change with no other history is BLOCK", () => {
    const report = codeReport(NEW_HASH, codeSnapshot(OLD_HASH, "2026-11-03T12:00:00.000Z"), 0, deployment("unavailable"));
    expect(report.verdict).toBe("BLOCK");
    expect(report.reasons.some((r) => r.includes("no other history"))).toBe(true);
  });

  it("a change whose current code is stable longer than 7 days is ALLOW", () => {
    const report = codeReport(
      NEW_HASH,
      codeSnapshot(OLD_HASH, "2026-10-20T12:00:00.000Z"),
      2,
      deployment("deployed", "2026-10-25T12:00:00.000Z"),
    );
    expect(report.verdict).toBe("ALLOW");
    const line = report.signals.find((s) => s.name === "code_change_recency");
    expect(line?.value).toContain("stable 12.0d");
  });

  it("an account with no contract is neutral and does not block ALLOW", () => {
    const report = codeReport(
      "11111111111111111111111111111111",
      codeSnapshot("11111111111111111111111111111111", "2026-11-05T12:00:00.000Z"),
      2,
      deployment("no_contract"),
    );
    expect(report.verdict).toBe("ALLOW");
    const line = report.signals.find((s) => s.name === "code_change_recency");
    expect(line?.value).toBe("no contract deployed");
  });

  it("a first observation is neutral and does not block ALLOW", () => {
    const report = codeReport(NEW_HASH, [], 2, deployment("deployed", "2026-11-06T06:00:00.000Z"));
    expect(report.verdict).toBe("ALLOW");
    const line = report.signals.find((s) => s.name === "code_change_recency");
    expect(line?.value).toBe("first observation");
  });

  it("a change with a wide window is WARN with the window reported, not a false precise age", () => {
    const report = codeReport(NEW_HASH, codeSnapshot(OLD_HASH, "2026-10-01T12:00:00.000Z"), 2, deployment("unavailable"));
    expect(report.verdict).toBe("WARN");
    const line = report.signals.find((s) => s.name === "code_change_recency");
    expect(line?.value).toContain("36.0d window");
    expect(line?.note).toContain("window of 36.0d");
    expect(line?.note).not.toContain("age ");
  });

  it("a stale indexer timestamp older than the snapshot falls back to the window", () => {
    const report = codeReport(
      NEW_HASH,
      codeSnapshot(OLD_HASH, "2026-11-04T12:00:00.000Z"),
      2,
      deployment("deployed", "2026-11-01T12:00:00.000Z"),
    );
    expect(report.verdict).toBe("WARN");
    const line = report.signals.find((s) => s.name === "code_change_recency");
    expect(line?.note).toContain("indexer is missing the latest deployment");
  });

  it("a change with no receipts but account-age history is WARN, not BLOCK", () => {
    const entries = [
      ...codeSnapshot(OLD_HASH, "2026-10-20T12:00:00.000Z"),
      ...codeSnapshot(OLD_HASH, "2026-11-03T12:00:00.000Z"),
    ];
    const report = codeReport(NEW_HASH, entries, 0, deployment("unavailable"));
    expect(report.verdict).toBe("WARN");
    expect(report.reasons.some((r) => r.includes("no other history"))).toBe(false);
  });
});

describe("wrapper gate on the code-change signal", () => {
  it("a code-change BLOCK refuses and names the signal", () => {
    const report = codeReport(NEW_HASH, codeSnapshot(OLD_HASH, "2026-11-06T06:00:00.000Z"), 2, deployment("unavailable"));
    const gate = gateSettleOnReputation(report, { approveWarn: false });
    expect(gate.decision).toBe("refuse");
    expect(gate.reason).toContain("BLOCK");
    expect(gate.reason).toContain("code_change_recency");
  });

  it("a code-change WARN escalates without approval and proceeds with it", () => {
    const report = codeReport(NEW_HASH, codeSnapshot(OLD_HASH, "2026-11-03T12:00:00.000Z"), 2, deployment("unavailable"));
    const escalated = gateSettleOnReputation(report, { approveWarn: false });
    expect(escalated.decision).toBe("escalate");
    expect(escalated.reason).toContain("code_change_recency");
    const approved = gateSettleOnReputation(report, { approveWarn: true });
    expect(approved.decision).toBe("proceed");
    expect(approved.reason).toContain("owner approved");
  });
});
