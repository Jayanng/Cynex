/* Cynex "Break it" live attack endpoint, serverless backend.
 *
 * One POST to /api/demo-attack submits a settle attempt to the test
 * vault with the judge's terms, using the same scoped settle-only demo
 * key as /api/demo-settle. Unlike demo-settle, which settles the next
 * READY obligation with its recorded terms, this endpoint takes the
 * judge's terms and submits them as-is: obligation id, proposed
 * recipient, proposed amount, plus an attack kind that says which of
 * the six live options this is. The vault checks the terms on chain
 * and refuses a tampered attempt with a real error code, and the
 * transaction that carries the refusal is a real on-chain transaction
 * with a real hash the judge can open on the explorer. Nothing here
 * is simulated: the error code and the tx hash both come from the
 * chain, from the attempt the judge just made. When the SDK returns
 * no usable hash for a refusal, the response says so plainly instead
 * of claiming a transaction link.
 *
 * The endpoint accepts four fields: obligation_id, proposed_recipient
 * (a NEAR account id), proposed_amount (a whole number as a string,
 * from 0 to the u128 maximum, in the token's smallest unit,
 * 6 decimals), and the optional attack_kind, one of
 * change_recipient, change_amount, replay, settle_before_evidence,
 * prompt_injection, freeform, defaulting to change_recipient.
 * Anything else is rejected with a 400. For replay and
 * settle_before_evidence the client terms are ignored: the handler
 * reads the obligation from the chain and submits its locked terms,
 * so the vault really refuses on ERR_NONCE_ALREADY_CONSUMED or
 * ERR_INVALID_STATE.
 * The key is never logged, never returned, and never appears in an
 * error message. No private key or credential is accepted from the
 * client.
 *
 * A failed settle does not consume the obligation: the nonce is only
 * consumed on a successful settle, so the same READY obligation can
 * be attacked repeatedly. If the judge enters the correct terms, the
 * settle genuinely succeeds and pays; that is the honest outcome, and
 * the response says PAID with the receipt. If the judge targets an
 * already PAID obligation, the vault returns
 * ERR_NONCE_ALREADY_CONSUMED with a real tx hash: a real replay
 * refusal.
 *
 * Rate limit: 1 attempt every 10 seconds, max 30 per hour, per IP,
 * in a simple in-memory map keyed by the client IP, the same pattern
 * as demo-settle. It is best effort per serverless instance, not a
 * global limit: a cold start resets it and separate instances do not
 * share it. It is an abuse control, not a safety control: the hard
 * backstop is the chain (10 pre-seeded obligations, each settles once
 * by nonce) and the demo key allowance (1 NEAR, about 1,270 failed
 * settles). A limited call gets HTTP 429 with retry-after seconds.
 * Quota is only recorded when a request is about to submit a settle:
 * failures before submission never consume one of the caller's 30
 * hourly attempts.
 *
 * Timeout: the same budget as demo-settle (30 seconds, 28 second
 * handler deadline). A tampered settle that the vault refuses resolves
 * fast, because the contract returns the error; the refusal path is
 * quick. The same timeout and unconfirmed handling as demo-settle
 * applies.
 */

import { KeyPair, type KeyPairString } from "near-api-js";
import {
  createRateLimitStore,
  DEMO_AGENT,
  DEMO_NEUTRAL_FALLBACK,
  DEMO_OBLIGATION_IDS,
  DEMO_POLICY_ID,
  DEMO_USED_UP_FALLBACK,
  findReady,
  findReceiptIndex,
  getClientIp,
  NearDemoChain,
  SETTLE_ERROR_CODES,
  settleErrorCode,
  txHashOf,
  VAULT_TEST,
  verifyKeyScope,
  waitForPaid,
  withTimeout,
} from "./demo-settle.js";
import type {
  DemoChain,
  DemoHandlerDeps,
  DemoRequest,
  DemoResponse,
  ObligationRow,
  RateLimitStore,
} from "./demo-settle.js";

export const config = { maxDuration: 30 };

// Re-exported so the client and the tests can assert the three
// settle error-code lists (demo-settle server, demo-attack server,
// demoSettle client) are the same list, not three copies that drift.
export { SETTLE_ERROR_CODES };

/* The six live attack kinds. change_recipient and change_amount
 * submit the judge's terms; replay and settle_before_evidence submit
 * the obligation's locked terms read from the chain; prompt_injection
 * and freeform submit terms the judge extracted from free text. */
export const ATTACK_KINDS = [
  "change_recipient",
  "change_amount",
  "replay",
  "settle_before_evidence",
  "prompt_injection",
  "freeform",
] as const;
export type AttackKind = (typeof ATTACK_KINDS)[number];

/* The no-evidence obligation: created on the test vault 2026-11-12,
 * state CREATED, recipient cynex-agent2.cynexmaster.testnet, amount
 * 100, policy p6-001, evidence type PREIMAGE, digest never submitted.
 * A settle against it is refused on chain with ERR_INVALID_STATE. */
export const DEMO_NOEVIDENCE_ID = "demo-live-noevidence-001";
/* The use-case obligation, PAID on the test vault, offered as a
 * replay target: recipient cynex-agent.cynexmaster.testnet, amount
 * 100, receipt 24, verified live on chain 2026-11-12. */
export const USECASE_REPLAY_ID = "usecase-report-002";
export const REPLAYABLE_IDS = [...DEMO_OBLIGATION_IDS, USECASE_REPLAY_ID];

const SETTLE_SOFT_TIMEOUT_MS = 20000;
const CONFIRM_TIMEOUT_MS = 5000;
const CONFIRM_POLL_MS = 1000;
const CONFIRM_READS_TIMEOUT_MS = 5000;
const HANDLER_DEADLINE_MS = 28000;
const SCOPE_TIMEOUT_MS = 5000;
const SCAN_TIMEOUT_MS = 10000;
/* ---------- response shape ---------- */

export interface DemoAttackResponse {
  success: boolean;
  obligationId: string | null;
  receiptIndex: number | null;
  // The real transaction hash for a refusal and for a PAID settle.
  // Present whenever a transaction reached the chain; null when no
  // usable hash came back.
  txHash: string | null;
  recipient: string | null;
  amount: string | null;
  policySpent: string | null;
  remaining: number | null;
  // For a vault refusal this is the vault error code itself, for
  // example ERR_RECIPIENT_SUBSTITUTION. For a handler error it is a
  // handler code such as RATE_LIMITED or INVALID_RECIPIENT.
  code?: string;
  error?: string;
  fallback?: string;
}

function fail(
  code: string,
  error: string,
  extra?: Partial<DemoAttackResponse>,
): DemoAttackResponse {
  return {
    success: false,
    obligationId: null,
    receiptIndex: null,
    txHash: null,
    recipient: null,
    amount: null,
    policySpent: null,
    remaining: null,
    code,
    error,
    ...extra,
  };
}

/* ---------- rate limit: 1 per 10 seconds, 30 per hour, per IP ----------
 * Best effort per serverless instance, not a global limit: the store
 * is an in-memory map, so a cold start resets it and separate
 * instances do not share it. The hard spend cap is the 1 NEAR
 * allowance on the demo key, about 1,270 failed settles. The check
 * and the record are split on purpose: the handler checks early to
 * reject over-limit callers, but records the hit only when the
 * request is about to submit a settle, so failures before submission
 * never consume quota. checkAttackRateLimit keeps the old
 * check-and-record behaviour for the tests that pin it. */
export function peekAttackRateLimit(
  store: RateLimitStore,
  ip: string,
  nowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const HOUR_MS = 3600000;
  const WINDOW_MS = 10000;
  let hits = store.hits.get(ip) ?? [];
  hits = hits.filter((t) => nowMs - t < HOUR_MS);
  const windowHits = hits.filter((t) => nowMs - t < WINDOW_MS);
  if (windowHits.length >= 1) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((windowHits[0] + WINDOW_MS - nowMs) / 1000),
      ),
    };
  }
  if (hits.length >= 30) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((hits[0] + HOUR_MS - nowMs) / 1000),
      ),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordAttackRateLimit(
  store: RateLimitStore,
  ip: string,
  nowMs: number,
): void {
  const HOUR_MS = 3600000;
  const hits = (store.hits.get(ip) ?? []).filter((t) => nowMs - t < HOUR_MS);
  hits.push(nowMs);
  store.hits.set(ip, hits);
}

export function checkAttackRateLimit(
  store: RateLimitStore,
  ip: string,
  nowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const peeked = peekAttackRateLimit(store, ip, nowMs);
  if (!peeked.allowed) return peeked;
  recordAttackRateLimit(store, ip, nowMs);
  return { allowed: true, retryAfterSeconds: 0 };
}

/* ---------- request validation ---------- */

// A NEAR account id: 2 to 64 characters, lowercase letters, digits,
// hyphen, underscore, dot. It must not start or end with a separator
// and must not contain two separators in a row. This is a shape check
// only: the vault is the authority on whether an account exists, and
// a well-formed id that does not exist is still refused on chain.
export function isValidNearAccountId(id: string): boolean {
  if (id.length < 2 || id.length > 64) return false;
  if (!/^[a-z0-9._-]+$/.test(id)) return false;
  if (/^[._-]|[._-]$/.test(id)) return false;
  if (/[._-]{2}/.test(id)) return false;
  return true;
}

// A whole number as a string, from 0 to the u128 maximum inclusive.
// The vault takes the amount as a JSON string, so the client sends it
// that way and the server passes it through unchanged. Zero is
// accepted on purpose: the vault refuses it with ERR_TERMS_MISMATCH,
// since the amount check runs before any transfer, so a zero-amount
// attack is a real on-chain refusal, not a validation error.
export function isValidAttackAmount(amount: string): boolean {
  if (!/^[0-9]+$/.test(amount)) return false;
  const value = BigInt(amount);
  if (value > (1n << 128n) - 1n) return false;
  return true;
}

export interface AttackTerms {
  obligationId: string;
  recipient: string;
  amount: string;
}
export type AttackBodyError =
  | { ok: false; code: string; error: string }
  | { ok: true; terms: AttackTerms; attackKind: AttackKind };

/* Only these four fields are accepted. Anything else is rejected
 * with a 400, so the "anything else is rejected" rule in the header
 * is true, not just a comment. For replay and settle_before_evidence
 * the recipient and amount in terms are placeholders: the handler
 * replaces them with the obligation's locked terms read from the
 * chain before submitting. */
const ATTACK_BODY_FIELDS = new Set([
  "obligation_id",
  "proposed_recipient",
  "proposed_amount",
  "attack_kind",
]);

export function parseAttackBody(body: unknown): AttackBodyError {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      error: "Send a JSON object with obligation_id, proposed_recipient, and proposed_amount.",
    };
  }
  const b = body as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    if (!ATTACK_BODY_FIELDS.has(key)) {
      return {
        ok: false,
        code: "INVALID_REQUEST",
        error:
          "Unknown field " +
          key +
          ": only obligation_id, proposed_recipient, proposed_amount and attack_kind are accepted.",
      };
    }
  }
  const kindRaw = b.attack_kind;
  let attackKind: AttackKind = "change_recipient";
  if (kindRaw !== undefined) {
    if (
      typeof kindRaw !== "string" ||
      !(ATTACK_KINDS as readonly string[]).includes(kindRaw)
    ) {
      return {
        ok: false,
        code: "INVALID_ATTACK_KIND",
        error:
          "attack_kind must be one of: change_recipient, change_amount, replay, settle_before_evidence, prompt_injection, freeform.",
      };
    }
    attackKind = kindRaw as AttackKind;
  }
  const allowedIds =
    attackKind === "replay"
      ? REPLAYABLE_IDS
      : attackKind === "settle_before_evidence"
        ? [DEMO_NOEVIDENCE_ID]
        : DEMO_OBLIGATION_IDS;
  const obligationId = b.obligation_id;
  if (typeof obligationId !== "string" || !allowedIds.includes(obligationId)) {
    return {
      ok: false,
      code: "INVALID_OBLIGATION",
      error:
        attackKind === "replay"
          ? "obligation_id must be an already PAID obligation for a replay: one of demo-live-001 to demo-live-010, or usecase-report-002."
          : attackKind === "settle_before_evidence"
            ? "obligation_id must be demo-live-noevidence-001 for a settle-before-evidence attempt."
            : "obligation_id must be one of the demo-live obligations, demo-live-001 to demo-live-010.",
    };
  }
  // Replay and settle-before-evidence submit the obligation's locked
  // terms from the chain, never the client's: any client recipient
  // or amount is ignored, and neither is required.
  if (attackKind === "replay" || attackKind === "settle_before_evidence") {
    return {
      ok: true,
      terms: { obligationId, recipient: "", amount: "" },
      attackKind,
    };
  }
  const recipient = b.proposed_recipient;
  if (typeof recipient !== "string" || !isValidNearAccountId(recipient)) {
    return {
      ok: false,
      code: "INVALID_RECIPIENT",
      error: "proposed_recipient must be a valid NEAR account id, for example cynexmaster.testnet.",
    };
  }
  const amount = b.proposed_amount;
  if (typeof amount !== "string" || !isValidAttackAmount(amount)) {
    return {
      ok: false,
      code: "INVALID_AMOUNT",
      error: "proposed_amount must be a whole number of base units from 0 to the u128 maximum, as a string.",
    };
  }
  return { ok: true, terms: { obligationId, recipient, amount }, attackKind };
}

/* ---------- tx hash off a failed settle ---------- */

// near-api-js 7.4.0 throws a ContractExecutionError for a settle the
// contract refused. That error has NO .txHash: it carries only
// .blockHash and .blockHeight, and parseTransactionExecutionError
// attaches the full outcome as .transactionResult, which is where
// the real transaction hash comes from. A TransactionExecutionError
// on other execution failures does carry .txHash, so that is checked
// first and the .transactionResult fallback second. Either one gives
// the hash the judge needs to verify the refusal on the explorer.
// A transport error carries neither, so it returns null.
export function txHashFromSettleError(err: unknown): string | null {
  const e = err as Record<string, unknown> | null | undefined;
  if (e === null || e === undefined || typeof e !== "object") return null;
  if (
    typeof e.txHash === "string" &&
    e.txHash !== "" &&
    e.txHash !== "unknown"
  ) {
    return e.txHash;
  }
  if (e.transactionResult !== undefined && e.transactionResult !== null) {
    const h = txHashOf(e.transactionResult);
    if (h !== "unknown") return h;
  }
  return null;
}

/* A timed chain read that distinguishes its outcomes. withTimeout
 * returns null for a timeout, a rejection, and a genuinely missing
 * row alike, so it cannot tell a read failure from a missing
 * obligation. This helper reports the read itself: ok with the value
 * (which may itself be null when the row does not exist), or
 * unreadable when the read timed out or rejected. The caller answers
 * a missing row with OBLIGATION_MISSING or DEMO_USED_UP, and an
 * unreadable chain with 502 CHAIN_UNREADABLE, never the other way
 * round. */
type TimedRead<T> = { ok: true; value: T } | { ok: false };
async function readTimed<T>(
  promise: Promise<T>,
  ms: number,
): Promise<TimedRead<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TimedRead<T>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false }), ms);
  });
  try {
    return await Promise.race([
      promise.then(
        (v): TimedRead<T> => ({ ok: true, value: v }),
        (): TimedRead<T> => ({ ok: false }),
      ),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/* ---------- handler ---------- */

export interface DemoAttackRequest extends DemoRequest {
  body?: unknown;
}

export interface DemoAttackHandlerDeps extends DemoHandlerDeps {
  rateLimitStore?: RateLimitStore;
}

const sharedAttackRateLimitStore = createRateLimitStore();

export async function handleDemoAttack(
  req: DemoAttackRequest,
  res: DemoResponse,
  deps: DemoAttackHandlerDeps,
): Promise<void> {
  const startedAt = Date.now();
  const handlerDeadlineMs = deps.handlerDeadlineMs ?? HANDLER_DEADLINE_MS;
  const deadline = startedAt + handlerDeadlineMs;
  const timeLeft = () => Math.max(0, deadline - Date.now());
  const store = deps.rateLimitStore ?? sharedAttackRateLimitStore;
  const settleTimeoutMs = deps.settleTimeoutMs ?? SETTLE_SOFT_TIMEOUT_MS;

  if (req.method !== undefined && req.method !== "POST") {
    res
      .status(405)
      .json(
        fail("METHOD_NOT_ALLOWED", "Only POST is accepted on this endpoint."),
      );
    return;
  }

  // The key check comes first: a deployment without the key can never
  // settle, so throttling its 503 answers would only hide the real
  // problem. The rate limit still runs before any chain read or
  // settle, so a caller cannot hammer the RPC through us.
  const secretKey = deps.env.CYNEX_DEMO_KEY;
  if (secretKey === undefined || secretKey.trim() === "") {
    res
      .status(503)
      .json(
        fail(
          "DEMO_NOT_CONFIGURED",
          "The live demo is not configured yet: the demo key is missing on the server.",
          { fallback: DEMO_NEUTRAL_FALLBACK },
        ),
      );
    return;
  }

  // The body is validated before the rate limit is spent: a malformed
  // request is the caller's mistake, not an attempt, so it must not
  // consume one of their 30 hourly attempts.
  const parsed = parseAttackBody(req.body);
  if (!parsed.ok) {
    res.status(400).json(fail(parsed.code, parsed.error));
    return;
  }
  let terms = parsed.terms;

  // The limit is checked early so an over-limit caller is rejected
  // before any chain work, but no quota is recorded yet: failures
  // before submission (a bad key, a failed scope check, an unreadable
  // chain, a missing obligation) must not consume one of the caller's
  // 30 hourly attempts. The hit is recorded just before the settle
  // is submitted below.
  const ip = getClientIp(req);
  const limit = peekAttackRateLimit(store, ip, Date.now());
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    res.status(429).json(
      fail(
        "RATE_LIMITED",
        "Too many attack attempts from this address: 1 every 10 seconds, 30 per hour. Try again in " +
          limit.retryAfterSeconds +
          " seconds.",
      ),
    );
    return;
  }

  let publicKey: string;
  try {
    publicKey = KeyPair.fromString(secretKey as KeyPairString)
      .getPublicKey()
      .toString();
  } catch {
    res
      .status(500)
      .json(
        fail(
          "DEMO_KEY_INVALID",
          "The demo key on the server is invalid, so no settle can be signed.",
        ),
      );
    return;
  }

  const chain = deps.createChain(secretKey);

  const scopeTimeoutMs = deps.scopeTimeoutMs ?? SCOPE_TIMEOUT_MS;
  const keyList = await withTimeout(
    chain.viewAccessKeyList(DEMO_AGENT),
    Math.min(timeLeft(), scopeTimeoutMs),
  );
  if (keyList === null) {
    res
      .status(502)
      .json(
        fail(
          "CHAIN_UNREADABLE",
          "The chain could not be read to verify the demo key, so nothing was attempted.",
        ),
      );
    return;
  }
  const scope = verifyKeyScope(keyList, publicKey, VAULT_TEST);
  if (!scope.ok) {
    res.status(500).json(fail("SCOPE_CHECK_FAILED", scope.reason));
    return;
  }

  // Read the requested obligation. A missing obligation has nothing
  // to settle, so the vault would return ERR_OBLIGATION_MISSING; that
  // is answered here without a transaction. A read that times out or
  // fails is NOT a missing obligation: it is answered 502
  // CHAIN_UNREADABLE, never OBLIGATION_MISSING or DEMO_USED_UP.
  // If no demo-live obligation is READY at all, the demo pool is
  // exhausted and the answer is DEMO_USED_UP, pointing at the sandbox.
  const read = await readTimed(
    chain.getObligation(terms.obligationId),
    Math.min(timeLeft(), deps.scanTimeoutMs ?? SCAN_TIMEOUT_MS),
  );
  if (!read.ok) {
    res.status(502).json(
      fail(
        "CHAIN_UNREADABLE",
        "The chain could not be read to check the obligation, so nothing was attempted.",
      ),
    );
    return;
  }
  const target: ObligationRow | null = read.value;
  if (target === null) {
    if (
      parsed.attackKind === "replay" ||
      parsed.attackKind === "settle_before_evidence"
    ) {
      res.status(200).json(
        fail(
          "OBLIGATION_MISSING",
          "The obligation " +
            terms.obligationId +
            " does not exist on the test vault, so there is nothing to attack. The vault would return ERR_OBLIGATION_MISSING.",
          { obligationId: terms.obligationId },
        ),
      );
      return;
    }
    const ready: ObligationRow[] | null = await withTimeout(
      findReady(chain),
      Math.min(timeLeft(), deps.scanTimeoutMs ?? SCAN_TIMEOUT_MS),
    );
    if (ready === null) {
      res.status(502).json(
        fail(
          "CHAIN_UNREADABLE",
          "The chain could not be read to check the demo obligations, so nothing was attempted.",
        ),
      );
      return;
    }
    if (ready.length === 0) {
      res.status(200).json(
        fail("DEMO_USED_UP", "All 10 demo settles are used up.", {
          fallback: DEMO_USED_UP_FALLBACK,
        }),
      );
      return;
    }
    res.status(200).json(
      fail(
        "OBLIGATION_MISSING",
        "The obligation " +
          terms.obligationId +
          " does not exist on the test vault, so there is nothing to attack. The vault would return ERR_OBLIGATION_MISSING.",
        { obligationId: terms.obligationId },
      ),
    );
    return;
  }

  // Replay and settle-before-evidence submit the obligation's locked
  // terms, read from the chain just above, never the client's terms.
  // The state is guarded first: replaying an obligation that is not
  // PAID yet, or settling the no-evidence obligation once it is READY
  // or PAID, would pay it with its own locked terms instead of
  // refusing. Those cases are refused here, before any transaction.
  if (parsed.attackKind === "replay") {
    if (target.state !== "PAID") {
      res.status(400).json(
        fail(
          "NOT_REPLAYABLE",
          "The obligation " +
            terms.obligationId +
            " is " +
            target.state +
            ", not PAID, so there is nothing to replay yet.",
          { obligationId: terms.obligationId },
        ),
      );
      return;
    }
    terms = {
      obligationId: terms.obligationId,
      recipient: target.recipient,
      amount: String(target.amount),
    };
  } else if (parsed.attackKind === "settle_before_evidence") {
    if (target.state === "READY" || target.state === "PAID") {
      res.status(400).json(
        fail(
          "WRONG_STATE",
          "The obligation " +
            terms.obligationId +
            " is already " +
            target.state +
            ", so a settle-before-evidence attempt cannot be made on it.",
          { obligationId: terms.obligationId },
        ),
      );
      return;
    }
    terms = {
      obligationId: terms.obligationId,
      recipient: target.recipient,
      amount: String(target.amount),
    };
  }

  // The settle gets what is left of the budget minus a reserve for
  // confirmation, reads, and the response. If the pre-settle reads
  // already ate the budget, refuse instead of starting a settle the
  // handler could not confirm or report.
  const settleBudgetMs = Math.min(
    settleTimeoutMs,
    Math.max(0, timeLeft() - 10000),
  );
  if (settleBudgetMs <= 0) {
    res.status(502).json(
      fail(
        "CHAIN_UNREADABLE",
        "The chain is responding too slowly to attempt the settle safely within the function budget, so nothing was attempted.",
      ),
    );
    return;
  }

  // Submit the terms: the judge's terms for a tamper, the locked
  // terms from the chain for a replay or a settle-before-evidence
  // attempt. The vault decides.
  // The quota is recorded here, and only here: the request is about
  // to submit a settle, so this is the attempt the limit counts.
  recordAttackRateLimit(store, ip, Date.now());
  let txHash: string;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("settle confirmation timed out")),
        settleBudgetMs,
      );
    });
    const settlePromise = chain.settle(
      terms.obligationId,
      terms.recipient,
      terms.amount,
    );
    // If the timeout wins the race, the settle promise may still reject
    // later. Give it a no-op handler now so a late refusal is not an
    // unhandled rejection on the warm instance. This changes nothing
    // about the race: when the settle loses first, the race still
    // rejects with the settle error.
    settlePromise.catch(() => {});
    txHash = await Promise.race([settlePromise, timeout]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    // The whitelisted vault code is checked BEFORE the timeout
    // check: a vault error message that happens to contain the words
    // "timed out" is still a definitive refusal, not a timeout.
    const vaultCode = settleErrorCode(message);
    if (vaultCode !== null) {
      // A definitive contract refusal: the vault refused this attempt
      // on chain, so it did not land as a payment and a retry is safe.
      // The hash is the proof, when the SDK returned one: a refusal
      // with no usable hash is reported honestly as having no hash,
      // never as a transaction the judge can open.
      const refusedTx = txHashFromSettleError(err);
      const refusalError =
        refusedTx !== null
          ? "The vault refused this attempt on chain: " + vaultCode + ". No tokens moved."
          : "The vault refused this attempt: " +
            vaultCode +
            ". No tokens moved. No transaction hash came back with the refusal, so check the explorer for " +
            terms.obligationId +
            " to confirm it.";
      res.status(200).json(
        fail(vaultCode, refusalError, {
          obligationId: terms.obligationId,
          txHash: refusedTx,
          recipient: terms.recipient,
          amount: terms.amount,
          fallback: DEMO_NEUTRAL_FALLBACK,
        }),
      );
      return;
    }
    if (/timed out/i.test(message)) {
      // The timer races the whole settle call, so a timeout proves
      // neither submission nor failure. The attempt may still land
      // on chain: the nonce protects the obligation, so there is no
      // retry here, only a pointer at the explorer.
      res.status(200).json(
        fail(
          "SETTLE_TIMEOUT",
          "Confirmation timed out, and it could not be established whether the attempt was submitted. Do not try again yet: each obligation settles at most once, check the explorer for " +
            terms.obligationId +
            " and the receipt list on the test vault.",
          { obligationId: terms.obligationId },
        ),
      );
      return;
    }
    // Any other error proves neither submission nor failure, so the
    // tx may still land: answer SETTLE_UNCONFIRMED and never offer a
    // retry. The hash is included when the error carried one.
    res.status(200).json(
      fail(
        "SETTLE_UNCONFIRMED",
        "The attempt could not be confirmed: the request failed before a result came back. Do not try again yet: check the explorer for " +
          terms.obligationId +
          " and the receipt list on the test vault.",
        {
          obligationId: terms.obligationId,
          txHash: txHashFromSettleError(err),
        },
      ),
    );
    return;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  // The settle call resolved, which only proves the vault accepted
  // the call. Confirm the obligation reads PAID on chain before
  // reporting success: a failed transfer rolls it back to READY.
  // This is the path the judge takes when they enter the correct
  // terms: the vault pays, and the response says so with the receipt.
  const confirmTimeoutMs = Math.min(
    deps.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS,
    Math.max(0, timeLeft() - 5000),
  );
  const confirmIntervalMs = deps.confirmIntervalMs ?? CONFIRM_POLL_MS;
  const paid = await waitForPaid(
    chain,
    terms.obligationId,
    confirmTimeoutMs,
    confirmIntervalMs,
  );
  if (!paid || txHash === "unknown") {
    res.status(200).json({
      ...fail(
        "SETTLE_UNCONFIRMED",
        "The settle could not be confirmed on chain. Do not run it again: check the explorer for " +
          terms.obligationId +
          " and the receipt list on the test vault.",
        { obligationId: terms.obligationId },
      ),
      txHash: txHash === "unknown" ? null : txHash,
    });
    return;
  }

  const readsTimeoutMs = Math.min(
    deps.confirmReadsTimeoutMs ?? CONFIRM_READS_TIMEOUT_MS,
    Math.max(0, timeLeft() - 1000),
  );
  const [foundReceipt, policy, stillReady] = await Promise.all([
    withTimeout(findReceiptIndex(chain, terms.obligationId), readsTimeoutMs),
    withTimeout(chain.getPolicy(DEMO_POLICY_ID), readsTimeoutMs),
    withTimeout(findReady(chain), readsTimeoutMs),
  ]);
  const receiptIndex: number | null = foundReceipt;
  const policySpent: string | null =
    policy !== null ? String(policy.spent) : null;
  const remaining: number | null =
    stillReady !== null ? stillReady.length : null;
  if (receiptIndex === null) {
    res.status(200).json({
      ...fail(
        "SETTLE_UNCONFIRMED",
        "The settle is confirmed PAID on chain, but the receipt could not be read. Do not run it again: check the explorer for " +
          txHash +
          " and the receipt list on the test vault.",
        { obligationId: terms.obligationId },
      ),
      txHash: txHash,
    });
    return;
  }
  console.log(
    "demo-attack " +
      terms.obligationId +
      " tx " +
      txHash +
      " receipt " +
      String(receiptIndex),
  );
  res.status(200).json({
    success: true,
    obligationId: terms.obligationId,
    receiptIndex,
    txHash,
    recipient: terms.recipient,
    amount: terms.amount,
    policySpent,
    remaining,
  });
}

export default async function handler(
  req: DemoAttackRequest,
  res: DemoResponse,
): Promise<void> {
  await handleDemoAttack(req, res, {
    env: process.env,
    createChain: (secretKey: string) => new NearDemoChain(secretKey),
  });
}
