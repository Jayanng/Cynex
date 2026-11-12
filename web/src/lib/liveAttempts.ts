/* Live Break it attempts, persisted in this browser.
 * The on-chain attempts list used to be React state only, so it
 * vanished when the judge left #/attack. These helpers store the
 * same list in localStorage under a versioned key, so it survives
 * navigation and reloads and keeps accumulating across the session.
 * Only attempts that reached the chain are ever stored (paid,
 * refused, unconfirmed); the caller filters before adding, exactly
 * as the list already did. The list is capped at the most recent
 * 20 attempts. Corrupt or stale stored JSON falls back to an empty
 * list and never throws, so a bad value cannot break the page.
 * Storage access is guarded: server rendering or a browser that
 * blocks storage just behaves like an empty list. Entries are
 * validated strictly on load: a positive safe-integer id below
 * Number.MAX_SAFE_INTEGER, so the next id stays a safe integer,
 * non-empty strings, a safe-integer receipt index, and only the
 * known fields are kept, so extra keys in stored data never leak
 * into state. Duplicate ids are dropped on load, keeping the first
 * occurrence, so two entries can never share a React key.
 */

import type { AttackKind } from "./demoAttack";

export type LiveAttemptOutcome = "refused" | "paid" | "unconfirmed";

export interface LiveAttempt {
  id: number;
  kind: AttackKind;
  obligationId: string;
  recipient: string;
  amount: string;
  outcome: LiveAttemptOutcome;
  code: string | null;
  txHash: string | null;
  receiptIndex: number | null;
  error: string | null;
  at: string;
}

export const LIVE_ATTEMPTS_STORAGE_KEY = "cynex-live-attempts-v1";
export const MAX_LIVE_ATTEMPTS = 20;

const ATTACK_KINDS: readonly string[] = [
  "change_recipient",
  "change_amount",
  "replay",
  "settle_before_evidence",
  "prompt_injection",
  "freeform",
];

const OUTCOMES: readonly string[] = ["refused", "paid", "unconfirmed"];

function defaultStorage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

function isValidAttempt(value: unknown): value is LiveAttempt {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "number" || !Number.isSafeInteger(value.id) || value.id <= 0 || value.id >= Number.MAX_SAFE_INTEGER) return false;
  if (typeof value.kind !== "string" || !ATTACK_KINDS.includes(value.kind)) return false;
  if (!isNonEmptyString(value.obligationId)) return false;
  if (!isNonEmptyString(value.recipient)) return false;
  if (!isNonEmptyString(value.amount)) return false;
  if (typeof value.outcome !== "string" || !OUTCOMES.includes(value.outcome)) return false;
  if (!isStringOrNull(value.code)) return false;
  if (!isStringOrNull(value.txHash)) return false;
  if (
    !(
      value.receiptIndex === null ||
      (typeof value.receiptIndex === "number" &&
        Number.isSafeInteger(value.receiptIndex) &&
        value.receiptIndex >= 0)
    )
  )
    return false;
  if (!isStringOrNull(value.error)) return false;
  if (!isNonEmptyString(value.at)) return false;
  return true;
}

/** Copy only the known fields, so extra keys in stored data never leak into state. */
function copyLiveAttempt(a: LiveAttempt): LiveAttempt {
  return {
    id: a.id,
    kind: a.kind,
    obligationId: a.obligationId,
    recipient: a.recipient,
    amount: a.amount,
    outcome: a.outcome,
    code: a.code,
    txHash: a.txHash,
    receiptIndex: a.receiptIndex,
    error: a.error,
    at: a.at,
  };
}

/** Read the stored attempts. Corrupt, stale or missing data yields []. */
export function loadLiveAttempts(storage: Storage | null = defaultStorage()): LiveAttempt[] {
  if (storage === null) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(LIVE_ATTEMPTS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null || raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  /* Duplicate ids in stored data would share a React key, so keep
     the first occurrence of each id and drop later duplicates. */
  const seen = new Set<number>();
  const out: LiveAttempt[] = [];
  for (const entry of parsed) {
    if (!isValidAttempt(entry)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(copyLiveAttempt(entry));
    if (out.length >= MAX_LIVE_ATTEMPTS) break;
  }
  return out;
}

/** Store the attempts, capped at the most recent MAX_LIVE_ATTEMPTS. Never throws.
 * An empty list removes the key instead of writing "[]", so a cleared
 * list leaves no stale value behind. */
export function saveLiveAttempts(
  attempts: LiveAttempt[],
  storage: Storage | null = defaultStorage(),
): void {
  if (storage === null) return;
  try {
    if (attempts.length === 0) {
      storage.removeItem(LIVE_ATTEMPTS_STORAGE_KEY);
      return;
    }
    storage.setItem(LIVE_ATTEMPTS_STORAGE_KEY, JSON.stringify(attempts.slice(0, MAX_LIVE_ATTEMPTS)));
  } catch {
    return;
  }
}

/** Prepend one attempt, keeping the most recent MAX_LIVE_ATTEMPTS. Pure. */
export function addLiveAttempt(prev: LiveAttempt[], attempt: LiveAttempt): LiveAttempt[] {
  return [attempt, ...prev].slice(0, MAX_LIVE_ATTEMPTS);
}

/** Remove the stored attempts. Never throws. */
export function clearLiveAttempts(storage: Storage | null = defaultStorage()): void {
  if (storage === null) return;
  try {
    storage.removeItem(LIVE_ATTEMPTS_STORAGE_KEY);
  } catch {
    return;
  }
}

/** Next free attempt id, so restored attempts never collide with new ones.
 * Ids are validated below Number.MAX_SAFE_INTEGER on load, so max + 1 is
 * always a safe integer and incrementing it again cannot repeat. */
export function nextAttemptId(attempts: LiveAttempt[]): number {
  let max = 0;
  for (const a of attempts) {
    if (a.id > max) max = a.id;
  }
  return max + 1;
}
