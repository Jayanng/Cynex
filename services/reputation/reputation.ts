/**
 * Reputation service, Phase 7 Lane B, fifth signal added by the
 * scorecard brief (code-change recency).
 *
 * Real counterparty signals, scoped to what we can actually source
 * (plan 3.1.9). Five signals:
 *
 *   1. account_existence: does the account exist right now, and what
 *      is its current code hash (RPC view_account, current state
 *      only). Never a past code hash; we only have the current one.
 *   2. account_age: first seen, from snapshots we take and document.
 *      The age is only as old as the earliest snapshot that shows
 *      the account existing, and the output says that plainly.
 *   3. prior_vault_interactions: our own receipts, paginated from
 *      genesis through the contract receipts view. A counterparty
 *      in our receipts has a real history; one that is not has
 *      none from us, which is not the same as a bad history.
 *   4. blocklist: a real blocklist with a named source and
 *      provenance. If no suitable public source exists for the
 *      accounts we check, this signal is unavailable, never
 *      invented.
 *   5. code_change_recency: whether the receiver's contract code
 *      changed since the last snapshot, and how recently. The
 *      current code hash comes from the RPC view_account read; the
 *      previous hash comes from the latest snapshot for the
 *      account; the exact age of the current code comes from the
 *      NearBlocks v3 deployments endpoint when it answers, and
 *      the snapshot window is used when it does not. An account
 *      with no contract, and a first observation with no baseline,
 *      are neutral, never a penalty.
 *
 * Honesty rules (acceptance criteria, plan 3.1.9):
 * - Unknown maps to WARN (insufficient history), never to a
 *   guessed score. Score is null unless the verdict is ALLOW.
 * - A signal that cannot be sourced is shown as "unavailable",
 *   not fabricated. A signal without a source is rejected.
 * - Code-change recency is claimed only as far as it is sourced:
 *   the change itself is the live RPC code hash against the
 *   latest snapshot, and the age is the NearBlocks v3 deployment
 *   timestamp when that endpoint answers, otherwise the snapshot
 *   window (the change happened between the last observation and
 *   now). A wide window is reported as a window, never as a false
 *   precise age. An indexer timestamp older than the previous
 *   snapshot is stale (the indexer is missing the latest
 *   deployment) and is ignored in favour of the window.
 * - Defense in depth only. A good reputation score never overrides
 *   a terms mismatch, a budget excess, or a frozen policy; the
 *   vault terms are the prevention.
 *
 * Verdict rules, stated exactly so they can be audited:
 * - BLOCK: the blocklist signal is sourced and lists the account,
 *   or the code_change_recency signal fires BLOCK (the code
 *   changed very recently, or it changed and the receiver has no
 *   other history). The refusal names the signal and its source.
 * - ALLOW: account existence is sourced and the account exists,
 *   prior vault interactions are sourced with at least one
 *   receipt, at least two signals are sourced, and the
 *   code_change_recency signal is not WARN or BLOCK. Score is the
 *   fraction of sourced signals that are positive.
 * - WARN: everything else. The reasons list every failing
 *   condition. Score is null.
 */

export interface ReputationSignal {
  source: string;
  value: number;
}

export interface ReputationOutcome {
  score: number | null;
  warnInsufficientHistory: boolean;
}

export function evaluateReputation(signals: ReputationSignal[]): ReputationOutcome {
  const sourced = signals.filter((s) => s.source.trim().length > 0);
  if (sourced.length === 0) {
    return { score: null, warnInsufficientHistory: true };
  }
  const total = sourced.reduce((sum, s) => sum + s.value, 0);
  return { score: total / sourced.length, warnInsufficientHistory: false };
}

export type ReputationVerdict = "ALLOW" | "WARN" | "BLOCK";

export type SignalStatus = "sourced" | "unavailable";

export interface SignalLine {
  name: string;
  status: SignalStatus;
  source: string;
  timestamp: string | null;
  value: string;
  note: string;
}

export interface ReputationReport {
  accountId: string;
  verdict: ReputationVerdict;
  score: number | null;
  reasons: string[];
  signals: SignalLine[];
  checkedAt: string;
}

export interface AccountView {
  exists: boolean;
  codeHash: string | null;
  blockHeight: number;
  blockTimestamp: number;
  fetchedAt: string;
  source: string;
}

export interface ReceiptsSummary {
  count: number;
  firstIndex: number | null;
  firstTimestamp: bigint | null;
  lastIndex: number | null;
  fetchedAt: string;
  source: string;
}

export interface SnapshotEntry {
  accountId: string;
  exists: boolean;
  codeHash: string | null;
  blockHeight: number;
  blockTimestamp: number;
  fetchedAt: string;
  file: string;
}

export interface BlocklistCheck {
  status: "listed" | "not_listed" | "unavailable";
  source: string;
  fetchedAt: string | null;
  reason: string;
}

export interface CodeDeploymentCheck {
  status: "deployed" | "no_contract" | "unavailable";
  latestDeploymentTimestampNs: string | null;
  latestDeploymentTx: string | null;
  source: string;
  fetchedAt: string | null;
  reason: string;
}

export interface ReputationSources {
  viewAccount(accountId: string): Promise<AccountView>;
  listReceipts(accountId: string): Promise<ReceiptsSummary>;
  readSnapshots(accountId: string): Promise<SnapshotEntry[]>;
  checkBlocklist(accountId: string): Promise<BlocklistCheck>;
  checkCodeDeployment(accountId: string): Promise<CodeDeploymentCheck>;
}

export const DEFAULT_CODE_HASH = "11111111111111111111111111111111";
export const CODE_CHANGE_WARN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const CODE_CHANGE_BLOCK_WINDOW_MS = 24 * 60 * 60 * 1000;

export const NO_BLOCKLIST_REASON =
  "no suitable public blocklist source for NEAR account ids; see docs/phase7-lane-b.md";

export function isoOfNs(timestampNs: bigint): string {
  const ms = timestampNs / 1000000n;
  return new Date(Number(ms)).toISOString();
}

function formatAge(ms: number): string {
  if (ms < 60 * 1000) {
    return Math.round(ms / 1000) + "s";
  }
  if (ms < 60 * 60 * 1000) {
    return Math.round(ms / (60 * 1000)) + "m";
  }
  if (ms < 24 * 60 * 60 * 1000) {
    return (ms / (60 * 60 * 1000)).toFixed(1) + "h";
  }
  return (ms / (24 * 60 * 60 * 1000)).toFixed(1) + "d";
}

export type CodeChangeVerdict = "ALLOW" | "WARN" | "BLOCK" | "NEUTRAL";

export interface CodeChangeOutcome {
  verdict: CodeChangeVerdict;
  line: SignalLine;
  reason: string;
}

function codeChangeLine(
  existence: AccountView | null,
  snapshotEntries: SnapshotEntry[],
  receipts: ReceiptsSummary | null,
  deployment: CodeDeploymentCheck,
  checkedAt: string,
): CodeChangeOutcome {
  const name = "code_change_recency";
  const neutral = (
    value: string,
    note: string,
    source: string,
    timestamp: string | null,
    status: SignalStatus = "sourced",
  ): CodeChangeOutcome => ({
    verdict: "NEUTRAL",
    line: { name, status, source, timestamp, value, note },
    reason: "",
  });
  if (existence === null) {
    return neutral(
      "unavailable",
      "the account view could not be read; the code-change signal does not apply",
      "",
      null,
      "unavailable",
    );
  }
  if (!existence.exists) {
    return neutral(
      "account does not exist",
      "no account on chain at the current block; the code-change signal does not apply (the account_existence signal already reports this)",
      existence.source,
      existence.fetchedAt,
    );
  }
  const current = existence.codeHash;
  if (current === null) {
    return neutral(
      "unavailable",
      "the account view returned no code hash; the code-change signal does not apply",
      existence.source,
      existence.fetchedAt,
      "unavailable",
    );
  }
  if (current === DEFAULT_CODE_HASH) {
    return neutral(
      "no contract deployed",
      "code_hash is the default (no contract); an account with no contract cannot have changed its code, so this signal does not penalise it",
      existence.source,
      existence.fetchedAt,
    );
  }
  const withHash = snapshotEntries.filter((e) => e.exists && e.codeHash !== null);
  if (withHash.length === 0) {
    return neutral(
      "first observation",
      "no snapshot on record for this account, so there is no baseline to compare against; the current code_hash is recorded as the baseline by the reputation-snapshot command and the signal works from the second check onward",
      existence.source,
      existence.fetchedAt,
    );
  }
  const latest = withHash.reduce((a, b) => (a.fetchedAt >= b.fetchedAt ? a : b));
  const previous = latest.codeHash as string;
  if (previous === current) {
    return {
      verdict: "ALLOW",
      line: {
        name,
        status: "sourced",
        source: latest.file,
        timestamp: latest.fetchedAt,
        value: "no change since " + latest.fetchedAt,
        note: "code_hash matches the latest snapshot; the code has not changed since the last observation",
      },
      reason: "",
    };
  }
  const nowMs = Date.parse(checkedAt);
  const prevMs = Date.parse(latest.fetchedAt);
  const windowMs = nowMs - prevMs;
  let exactAgeMs: number | null = null;
  let indexerNote = "";
  if (deployment.status === "deployed" && deployment.latestDeploymentTimestampNs !== null) {
    const deployedMs = Number(BigInt(deployment.latestDeploymentTimestampNs) / 1000000n);
    if (deployedMs > prevMs) {
      exactAgeMs = nowMs - deployedMs;
      indexerNote =
        " NearBlocks v3 records the current code deployed at " +
        isoOfNs(BigInt(deployment.latestDeploymentTimestampNs)) +
        (deployment.latestDeploymentTx === null ? "" : " (tx " + deployment.latestDeploymentTx + ")") +
        ", age " + formatAge(exactAgeMs) + ".";
    } else {
      indexerNote =
        " NearBlocks v3 latest deployment predates the previous snapshot, so the indexer is missing the latest deployment and the snapshot window is used instead.";
    }
  } else if (deployment.status === "unavailable") {
    indexerNote =
      " NearBlocks v3 deployment history was unavailable (" + deployment.reason + "), so recency is the snapshot window.";
  } else if (deployment.status === "no_contract") {
    indexerNote = " NearBlocks v3 has no deployments on record for this account, so recency is the snapshot window.";
  }
  const firstSeen = withHash.reduce((a, b) => (a.fetchedAt <= b.fetchedAt ? a : b));
  const noOtherHistory =
    receipts !== null && receipts.count === 0 && firstSeen.fetchedAt === latest.fetchedAt;
  const changeNote =
    "code changed since the latest snapshot " +
    latest.file +
    " at " +
    latest.fetchedAt +
    " (old " +
    previous +
    " -> new " +
    current +
    "); the change happened in the window of " +
    formatAge(windowMs) +
    " between that snapshot and now." +
    indexerNote;
  const changeReason =
    "code changed (old " +
    previous +
    " -> new " +
    current +
    ") in a " +
    formatAge(windowMs) +
    " window" +
    (exactAgeMs === null ? "" : ", current code age " + formatAge(exactAgeMs));
  if (exactAgeMs !== null && exactAgeMs > CODE_CHANGE_WARN_WINDOW_MS) {
    return {
      verdict: "ALLOW",
      line: {
        name,
        status: "sourced",
        source: deployment.source,
        timestamp: deployment.fetchedAt,
        value: "changed, current code stable " + formatAge(exactAgeMs),
        note:
          changeNote +
          " The current code has been deployed and stable for longer than the " +
          formatAge(CODE_CHANGE_WARN_WINDOW_MS) +
          " recency window.",
      },
      reason: "",
    };
  }
  const veryRecent =
    (exactAgeMs !== null && exactAgeMs <= CODE_CHANGE_BLOCK_WINDOW_MS) ||
    (exactAgeMs === null && windowMs <= CODE_CHANGE_BLOCK_WINDOW_MS);
  if (veryRecent || noOtherHistory) {
    const why = veryRecent
      ? "the code changed within the last " + formatAge(CODE_CHANGE_BLOCK_WINDOW_MS)
      : "the code changed and the receiver has no other history (no prior vault interactions, and the account was first seen at the baseline snapshot)";
    return {
      verdict: "BLOCK",
      line: {
        name,
        status: "sourced",
        source: latest.file,
        timestamp: latest.fetchedAt,
        value: "changed " + formatAge(windowMs) + " window",
        note: changeNote + " BLOCK: " + why + ".",
      },
      reason: "code_change_recency: " + changeReason + "; " + why,
    };
  }
  return {
    verdict: "WARN",
    line: {
      name,
      status: "sourced",
      source: latest.file,
      timestamp: latest.fetchedAt,
      value: "changed " + formatAge(windowMs) + " window",
      note:
        changeNote +
        " WARN: the code changed within the " +
        formatAge(CODE_CHANGE_WARN_WINDOW_MS) +
        " recency window, or the observation window is too wide to pin down when.",
    },
    reason: "code_change_recency: " + changeReason,
  };
}

function ageLine(entries: SnapshotEntry[]): SignalLine {
  const existing = entries.filter((e) => e.exists);
  if (existing.length === 0) {
    if (entries.length === 0) {
      return {
        name: "account_age",
        status: "unavailable",
        source: "",
        timestamp: null,
        value: "unavailable",
        note: "no snapshot on record for this account; age is unknown, not zero",
      };
    }
    const latest = entries.reduce((a, b) => (a.fetchedAt >= b.fetchedAt ? a : b));
    return {
      name: "account_age",
      status: "sourced",
      source: latest.file,
      timestamp: latest.fetchedAt,
      value: "no snapshot shows this account existing",
      note:
        "latest snapshot " +
        latest.file +
        " at " +
        latest.fetchedAt +
        " records it as not found; first seen is unknown",
    };
  }
  const first = existing.reduce((a, b) => (a.fetchedAt <= b.fetchedAt ? a : b));
  return {
    name: "account_age",
    status: "sourced",
    source: first.file,
    timestamp: first.fetchedAt,
    value: "first seen " + first.fetchedAt,
    note:
      "age is only as old as the earliest snapshot that shows the account; " +
      "no earlier history on record. Snapshot block " +
      first.blockHeight +
      " at " +
      isoOfNs(BigInt(first.blockTimestamp)),
  };
}

export function buildReport(
  accountId: string,
  existence: AccountView | null,
  snapshotEntries: SnapshotEntry[],
  receipts: ReceiptsSummary | null,
  blocklist: BlocklistCheck,
  deployment: CodeDeploymentCheck,
  checkedAt: string,
): ReputationReport {
  const signals: SignalLine[] = [];
  if (existence === null) {
    signals.push({
      name: "account_existence",
      status: "unavailable",
      source: "",
      timestamp: null,
      value: "unavailable",
      note: "the account view could not be read; existence is unknown, not assumed",
    });
  } else if (existence.exists) {
    signals.push({
      name: "account_existence",
      status: "sourced",
      source: existence.source,
      timestamp: existence.fetchedAt,
      value: "exists, code_hash " + String(existence.codeHash),
      note:
        "current state only, read at block " +
        existence.blockHeight +
        "; no past code hash is claimed",
    });
  } else {
    signals.push({
      name: "account_existence",
      status: "sourced",
      source: existence.source,
      timestamp: existence.fetchedAt,
      value: "not found",
      note:
        "no account on chain at the current block, read at block " +
        existence.blockHeight +
        "; a token balance for this id, if any, is the token contract's own record, not proof the account exists",
    });
  }
  signals.push(ageLine(snapshotEntries));
  if (receipts === null) {
    signals.push({
      name: "prior_vault_interactions",
      status: "unavailable",
      source: "",
      timestamp: null,
      value: "unavailable",
      note: "the receipts view could not be read; history is unknown, not zero",
    });
  } else if (receipts.count === 0) {
    signals.push({
      name: "prior_vault_interactions",
      status: "sourced",
      source: receipts.source,
      timestamp: receipts.fetchedAt,
      value: "0 receipts",
      note: "no prior vault interactions; no history from us, which is not the same as a bad history",
    });
  } else {
    signals.push({
      name: "prior_vault_interactions",
      status: "sourced",
      source: receipts.source,
      timestamp: receipts.fetchedAt,
      value:
        receipts.count +
        " receipt" +
        (receipts.count === 1 ? "" : "s") +
        ", first index " +
        String(receipts.firstIndex) +
        (receipts.firstTimestamp === null
          ? ""
          : " at " + isoOfNs(receipts.firstTimestamp)),
      note: "first receipt is the earliest sourced evidence of this counterparty with our vault",
    });
  }
  if (blocklist.status === "unavailable") {
    signals.push({
      name: "blocklist",
      status: "unavailable",
      source: "",
      timestamp: null,
      value: "unavailable",
      note: blocklist.reason,
    });
  } else if (blocklist.status === "listed") {
    signals.push({
      name: "blocklist",
      status: "sourced",
      source: blocklist.source,
      timestamp: blocklist.fetchedAt,
      value: "listed",
      note: "this account is on the named blocklist; see the provenance record",
    });
  } else {
    signals.push({
      name: "blocklist",
      status: "sourced",
      source: blocklist.source,
      timestamp: blocklist.fetchedAt,
      value: "not listed",
      note: "checked against the named blocklist at the fetch time shown",
    });
  }
  const codeChange = codeChangeLine(existence, snapshotEntries, receipts, deployment, checkedAt);
  signals.push(codeChange.line);

  const sourced = signals.filter((s) => s.status === "sourced");
  const reasons: string[] = [];
  if (blocklist.status === "listed") {
    reasons.push("blocklist " + blocklist.source + " lists " + accountId);
    return { accountId, verdict: "BLOCK", score: null, reasons, signals, checkedAt };
  }
  if (codeChange.verdict === "BLOCK") {
    reasons.push(codeChange.reason);
    return { accountId, verdict: "BLOCK", score: null, reasons, signals, checkedAt };
  }
  if (existence === null) {
    reasons.push("account existence could not be read");
  } else if (!existence.exists) {
    reasons.push("account does not exist at the current block");
  }
  if (receipts === null) {
    reasons.push("prior vault interactions could not be read");
  } else if (receipts.count === 0) {
    reasons.push("no prior vault interactions in our receipts");
  }
  if (codeChange.verdict === "WARN") {
    reasons.push(codeChange.reason);
  }
  if (sourced.length < 2) {
    reasons.push("only " + sourced.length + " of 5 signals sourced");
  }
  const allow =
    existence !== null &&
    existence.exists &&
    receipts !== null &&
    receipts.count > 0 &&
    sourced.length >= 2 &&
    codeChange.verdict !== "WARN";
  if (!allow) {
    if (reasons.length === 0) {
      reasons.push("insufficient history");
    }
    return { accountId, verdict: "WARN", score: null, reasons, signals, checkedAt };
  }
  const firstSeen = snapshotEntries.some((e) => e.exists);
  const scored: ReputationSignal[] = [];
  scored.push({ source: "account_existence", value: 1 });
  if (snapshotEntries.length > 0) {
    scored.push({ source: "account_age", value: firstSeen ? 1 : 0 });
  }
  scored.push({ source: "prior_vault_interactions", value: 1 });
  if (blocklist.status !== "unavailable") {
    scored.push({ source: "blocklist", value: blocklist.status === "not_listed" ? 1 : 0 });
  }
  if (codeChange.verdict === "ALLOW") {
    scored.push({ source: "code_change_recency", value: 1 });
  }
  const outcome = evaluateReputation(scored);
  return {
    accountId,
    verdict: "ALLOW",
    score: outcome.score,
    reasons: [],
    signals,
    checkedAt,
  };
}

export async function evaluateCounterparty(
  accountId: string,
  sources: ReputationSources,
): Promise<ReputationReport> {
  const checkedAt = new Date().toISOString();
  const existence = await sources.viewAccount(accountId);
  const receipts = await sources.listReceipts(accountId);
  const snapshotEntries = await sources.readSnapshots(accountId).catch(() => []);
  const blocklist = await sources
    .checkBlocklist(accountId)
    .catch((error: unknown) => ({
      status: "unavailable" as const,
      source: "",
      fetchedAt: null,
      reason: error instanceof Error ? error.message : String(error),
    }));
  const deployment = await sources
    .checkCodeDeployment(accountId)
    .catch((error: unknown) => ({
      status: "unavailable" as const,
      latestDeploymentTimestampNs: null,
      latestDeploymentTx: null,
      source: "",
      fetchedAt: null,
      reason: error instanceof Error ? error.message : String(error),
    }));
  return buildReport(accountId, existence, snapshotEntries, receipts, blocklist, deployment, checkedAt);
}

export function formatReport(report: ReputationReport): string[] {
  const lines: string[] = [];
  lines.push(
    "reputation " +
      report.accountId +
      ": " +
      report.verdict +
      (report.verdict === "WARN" ? " (insufficient history)" : "") +
      (report.score === null ? "" : " score=" + report.score.toFixed(3)),
  );
  for (const s of report.signals) {
    lines.push(
      "  " +
        s.name +
        ": " +
        s.value +
        " | source: " +
        (s.source === "" ? "none" : s.source) +
        " | at: " +
        (s.timestamp === null ? "none" : s.timestamp) +
        " | " +
        s.note,
    );
  }
  if (report.reasons.length > 0) {
    lines.push("  reasons: " + report.reasons.join("; "));
  }
  lines.push(
    "  score: " +
      (report.score === null
        ? "none (" + report.verdict + ", no guessed score)"
        : report.score.toFixed(3) + " (fraction of sourced signals positive)"),
  );
  return lines;
}
