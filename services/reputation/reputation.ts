/**
 * Reputation service, Phase 7 Lane B.
 *
 * Real counterparty signals, scoped to what we can actually source
 * (plan 3.1.9). Four signals only:
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
 *
 * Honesty rules (acceptance criteria, plan 3.1.9):
 * - Unknown maps to WARN (insufficient history), never to a
 *   guessed score. Score is null unless the verdict is ALLOW.
 * - A signal that cannot be sourced is shown as "unavailable",
 *   not fabricated. A signal without a source is rejected.
 * - No code-change history claim. Historical code-change tracking
 *   needs an archival source or indexer we are not building, and
 *   is not claimed anywhere here.
 * - Defense in depth only. A good reputation score never overrides
 *   a terms mismatch, a budget excess, or a frozen policy; the
 *   vault terms are the prevention.
 *
 * Verdict rules, stated exactly so they can be audited:
 * - BLOCK: the blocklist signal is sourced and lists the account.
 *   The refusal names the signal and its source.
 * - ALLOW: account existence is sourced and the account exists,
 *   prior vault interactions are sourced with at least one
 *   receipt, and at least two signals are sourced. Score is the
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

export interface ReputationSources {
  viewAccount(accountId: string): Promise<AccountView>;
  listReceipts(accountId: string): Promise<ReceiptsSummary>;
  readSnapshots(accountId: string): Promise<SnapshotEntry[]>;
  checkBlocklist(accountId: string): Promise<BlocklistCheck>;
}

export const NO_BLOCKLIST_REASON =
  "no suitable public blocklist source for NEAR account ids; see docs/phase7-lane-b.md";

export function isoOfNs(timestampNs: bigint): string {
  const ms = timestampNs / 1000000n;
  return new Date(Number(ms)).toISOString();
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

  const sourced = signals.filter((s) => s.status === "sourced");
  const reasons: string[] = [];
  if (blocklist.status === "listed") {
    reasons.push("blocklist " + blocklist.source + " lists " + accountId);
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
  if (sourced.length < 2) {
    reasons.push("only " + sourced.length + " of 4 signals sourced");
  }
  const allow =
    existence !== null &&
    existence.exists &&
    receipts !== null &&
    receipts.count > 0 &&
    sourced.length >= 2;
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
  return buildReport(accountId, existence, snapshotEntries, receipts, blocklist, checkedAt);
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
