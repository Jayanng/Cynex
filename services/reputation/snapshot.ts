/**
 * Reputation snapshots,  frontend.
 *
 * A snapshot is a dated, checkable record of what the chain said
 * about an account at one moment. It is the only source for the
 * account-age signal, and its timestamp is proven by the block
 * height and block timestamp recorded in the file at capture time,
 * so a later reader can check both against the chain.
 *
 * Snapshot file contents (every field is required):
 *   account_id, exists, code_hash (null when the account does not
 *   exist), block_height, block_timestamp (nanoseconds, from the
 *   block header), fetched_at (wall-clock ISO time of the read),
 *   plus file-level taken_by and source_rpc.
 *
 * A snapshot that cannot be checked later is not provenance, it is
 * a claim. These helpers keep the format strict: a file missing a
 * field, or with a field of the wrong type, is rejected on read
 * rather than silently trusted.
 */
import { readdirSync, readFileSync } from "node:fs";

export interface SnapshotAccount {
  account_id: string;
  exists: boolean;
  code_hash: string | null;
  block_height: number;
  block_timestamp: number;
  fetched_at: string;
}

export interface SnapshotFile {
  taken_by: string;
  source_rpc: string;
  fetched_at: string;
  accounts: SnapshotAccount[];
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

export function snapshotFileName(fetchedAt: string): string {
  const d = new Date(fetchedAt);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    String(d.getUTCFullYear()) +
    "-" +
    pad(d.getUTCMonth() + 1) +
    "-" +
    pad(d.getUTCDate()) +
    "-" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z.json"
  );
}

export function takeSnapshot(
  accounts: SnapshotAccount[],
  takenBy: string,
  sourceRpc: string,
  fetchedAt: string,
): SnapshotFile {
  for (const a of accounts) {
    if (a.account_id.trim().length === 0) {
      throw new Error("snapshot account id must not be empty");
    }
    if (a.exists && (a.code_hash === null || a.code_hash.trim().length === 0)) {
      throw new Error("snapshot for an existing account must record its code hash");
    }
    if (!a.exists && a.code_hash !== null) {
      throw new Error("snapshot for a missing account must record a null code hash");
    }
    if (!Number.isInteger(a.block_height) || a.block_height < 0) {
      throw new Error("snapshot block height must be a non-negative integer");
    }
    if (!Number.isInteger(a.block_timestamp) || a.block_timestamp < 0) {
      throw new Error("snapshot block timestamp must be a non-negative integer");
    }
  }
  return { taken_by: takenBy, source_rpc: sourceRpc, fetched_at: fetchedAt, accounts };
}

function parseSnapshotFile(text: string, file: string): SnapshotFile {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("snapshot " + file + " is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.taken_by !== "string" || typeof obj.source_rpc !== "string" || typeof obj.fetched_at !== "string") {
    throw new Error("snapshot " + file + " is missing taken_by, source_rpc, or fetched_at");
  }
  if (!Array.isArray(obj.accounts)) {
    throw new Error("snapshot " + file + " has no accounts array");
  }
  for (const a of obj.accounts as unknown[]) {
    if (typeof a !== "object" || a === null) {
      throw new Error("snapshot " + file + " has a non-object account entry");
    }
    const entry = a as Record<string, unknown>;
    if (
      typeof entry.account_id !== "string" ||
      typeof entry.exists !== "boolean" ||
      (entry.code_hash !== null && typeof entry.code_hash !== "string") ||
      typeof entry.block_height !== "number" ||
      typeof entry.block_timestamp !== "number" ||
      typeof entry.fetched_at !== "string"
    ) {
      throw new Error("snapshot " + file + " has an account entry with a missing or mistyped field");
    }
  }
  return parsed as SnapshotFile;
}

export function readSnapshots(dir: string, accountId: string): SnapshotEntry[] {
  let names: string[];
  try {
    names = readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort();
  } catch {
    return [];
  }
  const out: SnapshotEntry[] = [];
  for (const name of names) {
    const file = dir + "/" + name;
    const parsed = parseSnapshotFile(readFileSync(file, "utf-8"), file);
    for (const a of parsed.accounts) {
      if (a.account_id === accountId) {
        out.push({
          accountId: a.account_id,
          exists: a.exists,
          codeHash: a.code_hash,
          blockHeight: a.block_height,
          blockTimestamp: a.block_timestamp,
          fetchedAt: a.fetched_at,
          file,
        });
      }
    }
  }
  out.sort((x, y) => (x.fetchedAt <= y.fetchedAt ? -1 : 1));
  return out;
}

export function earliestFirstSeen(entries: SnapshotEntry[]): SnapshotEntry | null {
  const existing = entries.filter((e) => e.exists);
  if (existing.length === 0) {
    return null;
  }
  return existing.reduce((a, b) => (a.fetchedAt <= b.fetchedAt ? a : b));
}
