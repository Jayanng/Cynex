/* Cynex "Run it live" button, serverless backend.
 *
 * One POST to /api/demo-settle settles the next pre-seeded READY demo
 * obligation on the test vault, with its exact authorized terms read
 * from the chain. The endpoint takes no parameters: any body or query
 * string the client sends is ignored entirely, never read into the
 * settle call, so a client-supplied recipient or amount has no effect.
 *
 * The function holds only one key, a fresh scoped settle-only key for
 * the test vault, read from the CYNEX_DEMO_KEY environment variable.
 * The key is never logged, never returned, and never appears in an
 * error message. On every invocation the key scope is re-verified on
 * chain (function-call key, receiver exactly the test vault, methods
 * exactly ["settle"], finite positive allowance), following the same
 * pattern as the MCP server startup check in services/mcp/config.ts.
 * The function cannot create obligations, cancel them, or move funds
 * except by settling a pre-seeded READY demo obligation with its
 * recorded terms, because the key only allows the settle method on
 * the test vault and the vault enforces the terms on chain.
 *
 * Rate limit: 1 settle per minute per IP, max 5 per hour per IP, in a
 * simple in-memory map keyed by the client IP (x-forwarded-for, first
 * entry) on one warm serverless instance. Vercel reuses warm instances
 * so this holds approximately, per instance, and a cold start resets
 * the counter; it is an abuse control, not a safety control. The hard
 * backstop is the chain: 10 pre-seeded obligations, each settles once
 * by nonce, and the key only allows settle on the test vault. A
 * limited call gets HTTP 429 with retry-after seconds. Vercel
 * overwrites x-forwarded-for with the client public IP and does not
 * forward external values, so a client cannot spoof the bucket by
 * sending its own header (Vercel request-headers docs).
 *
 * Timeout: a settle takes a few seconds and the function allows 30
 * seconds (exported config below). The settle call races a 20 second
 * soft timeout, the confirmation poll that follows gets at most
 * 5 seconds, and the post-confirmation reads get at most 5 seconds.
 * Every stage races the time left to a 28 second deadline set when
 * the handler starts, inside the 30 second function budget, so a
 * hung RPC cannot push the call past it: every async stage has a
 * bounded answer, so the handler replies SETTLE_UNCONFIRMED or a
 * 502 instead of letting the function time out.
 * A returned transaction outcome proves the vault accepted the settle
 * call, not that the tokens moved: the NEP-141 transfer and its
 * callback run asynchronously, and a failed transfer rolls the
 * obligation back to READY. So after the settle resolves, the
 * handler polls get_obligation until the obligation reads PAID, then
 * reads the receipt and the policy spent. Only then does it answer
 * success. If payment cannot be confirmed in the window, it answers
 * SETTLE_UNCONFIRMED with the obligation id and the tx hash, and
 * never retries: a retry would waste a second obligation, and the
 * nonce protects the first one.
 */

import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "near-api-js";
import type { KeyPairString } from "near-api-js";

export const config = { maxDuration: 30 };

const RPC_URL = "https://rpc.testnet.fastnear.com";
const VAULT_TEST = "cynex-testvault.cynexmaster.testnet";
const DEMO_AGENT = "cynex-agent.cynexmaster.testnet";
const DEMO_POLICY_ID = "p6-001";
const DEMO_EVIDENCE_REF = "live-demo-button";
const SETTLE_GAS = 100000000000000n;
const SETTLE_SOFT_TIMEOUT_MS = 20000;
const CONFIRM_TIMEOUT_MS = 5000;
const CONFIRM_POLL_MS = 1000;
const CONFIRM_READS_TIMEOUT_MS = 5000;
const HANDLER_DEADLINE_MS = 28000;
const SCOPE_TIMEOUT_MS = 5000;
const SCAN_TIMEOUT_MS = 10000;
const RECEIPT_SCAN_BACK = 10;

const DEMO_OBLIGATION_IDS = [
  "demo-live-001",
  "demo-live-002",
  "demo-live-003",
  "demo-live-004",
  "demo-live-005",
  "demo-live-006",
  "demo-live-007",
  "demo-live-008",
  "demo-live-009",
  "demo-live-010",
];

export const DEMO_USED_UP_FALLBACK =
  "The 10 demo settles are used up. Run the same flow locally with the sandbox demo (npx cynex-mcp --sandbox) or the MCP demo, both documented in services/mcp/README.md.";

// Fallback for failures that do NOT mean the settles are used up
// (missing key, failed settle). It must not claim exhaustion.
export const DEMO_NEUTRAL_FALLBACK =
  "You can run the same flow locally with the sandbox demo (npx cynex-mcp --sandbox) or the MCP demo, both documented in services/mcp/README.md.";

/* ---------- response shape ---------- */

export interface DemoSettleResponse {
  success: boolean;
  obligationId: string | null;
  receiptIndex: number | null;
  // Present on SETTLE_UNCONFIRMED so the user can check the explorer;
  // null when no usable hash came back from the settle call.
  txHash: string | null;
  recipient: string | null;
  amount: string | null;
  policySpent: string | null;
  remaining: number | null;
  code?: string;
  error?: string;
  fallback?: string;
}

function fail(
  code: string,
  error: string,
  extra?: Partial<DemoSettleResponse>,
): DemoSettleResponse {
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

/* ---------- key scope, same rule as the MCP server ---------- */

export interface KeyScopeCheck {
  ok: boolean;
  reason: string;
}

export interface AccessKeyEntry {
  public_key: string;
  access_key: {
    permission:
      | "FullAccess"
      | {
          FunctionCall: {
            allowance?: string | null;
            receiver_id: string;
            method_names: string[];
          };
        };
  };
}

/* Check one public key against the access key list read from the
 * chain. The key must exist, be a function-call key, receive on
 * exactly the test vault, allow exactly the settle method, and carry
 * a finite, positive allowance. A full-access key, a wrong receiver,
 * broader methods, an unlimited allowance, or an exhausted allowance
 * all refuse, with the reason naming what was wrong. The key
 * material itself is never in the reason. */
export function verifyKeyScope(
  entries: unknown,
  publicKey: string,
  vaultId: string,
): KeyScopeCheck {
  const list = (entries as { keys?: unknown } | null | undefined)?.keys;
  if (!Array.isArray(list)) {
    return {
      ok: false,
      reason:
        "demo scope check failed: access key list has no keys array for the agent account",
    };
  }
  const found = list.find(
    (entry) => (entry as AccessKeyEntry)?.public_key === publicKey,
  ) as AccessKeyEntry | undefined;
  if (found === undefined) {
    return {
      ok: false,
      reason:
        "demo scope check failed: public key " +
        publicKey +
        " is not on the agent account, the demo key is not installed where the backend expects it",
    };
  }
  const permission = found.access_key?.permission;
  if (permission === "FullAccess") {
    return {
      ok: false,
      reason:
        "demo scope check failed: the configured key is a full-access key, the backend only ever holds a settle-only function-call key",
    };
  }
  if (
    permission === undefined ||
    typeof permission !== "object" ||
    permission.FunctionCall === undefined
  ) {
    return {
      ok: false,
      reason:
        "demo scope check failed: the configured key has an unrecognised permission shape",
    };
  }
  const call = permission.FunctionCall;
  if (call.receiver_id !== vaultId) {
    return {
      ok: false,
      reason:
        "demo scope check failed: the configured key is scoped to receiver " +
        call.receiver_id +
        ", not the test vault " +
        vaultId,
    };
  }
  if (!Array.isArray(call.method_names)) {
    return {
      ok: false,
      reason:
        "demo scope check failed: the configured key has a malformed method_names list",
    };
  }
  const methods = [...call.method_names].sort();
  if (methods.length !== 1 || methods[0] !== "settle") {
    return {
      ok: false,
      reason:
        "demo scope check failed: the configured key allows methods [" +
        call.method_names.join(", ") +
        "], the backend only ever holds a key that allows exactly [settle]",
    };
  }
  // Allowance null means unlimited on NEAR, and "0" means the key
  // cannot pay gas. The check is finite and positive, not a ceiling,
  // so a key created with a different allowance still works.
  if (
    typeof call.allowance !== "string" ||
    !/^[0-9]+$/.test(call.allowance) ||
    BigInt(call.allowance) <= 0n
  ) {
    return {
      ok: false,
      reason:
        "demo scope check failed: the configured key must have a finite, positive allowance, got " +
        JSON.stringify(call.allowance),
    };
  }
  return {
    ok: true,
    reason:
      "key scope verified: function-call key, receiver " +
      vaultId +
      ", methods [settle]",
  };
}

/* ---------- rate limit: 1 per minute, 5 per hour, per IP ---------- */

export interface RateLimitStore {
  hits: Map<string, number[]>;
}

export function createRateLimitStore(): RateLimitStore {
  return { hits: new Map() };
}

export function checkRateLimit(
  store: RateLimitStore,
  ip: string,
  nowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const HOUR_MS = 3600000;
  const MINUTE_MS = 60000;
  let hits = store.hits.get(ip) ?? [];
  hits = hits.filter((t) => nowMs - t < HOUR_MS);
  const minuteHits = hits.filter((t) => nowMs - t < MINUTE_MS);
  if (minuteHits.length >= 1) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((minuteHits[0] + MINUTE_MS - nowMs) / 1000),
      ),
    };
  }
  if (hits.length >= 5) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((hits[0] + HOUR_MS - nowMs) / 1000),
      ),
    };
  }
  hits.push(nowMs);
  store.hits.set(ip, hits);
  return { allowed: true, retryAfterSeconds: 0 };
}

// Vercel overwrites x-forwarded-for with the client public IP and
// does not forward external values, so the first entry is the
// platform-set client IP, not a client-supplied one.
export function getClientIp(req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof first === "string" && first.trim() !== "") {
    return first.split(",")[0].trim();
  }
  if (req.socket?.remoteAddress) return req.socket.remoteAddress;
  return "unknown";
}

/* ---------- chain access (injectable for tests) ---------- */

export interface ObligationRow {
  obligation_id: string;
  recipient: string;
  amount: number | string;
  state: string;
}

export interface DemoChain {
  viewAccessKeyList(accountId: string): Promise<unknown>;
  getObligation(obligationId: string): Promise<ObligationRow | null>;
  getPolicy(policyId: string): Promise<{ spent: number | string }>;
  getReceiptCount(): Promise<number>;
  getReceipt(index: number): Promise<{ obligation_id: string } | null>;
  settle(
    obligationId: string,
    recipient: string,
    amount: string,
  ): Promise<string>;
}

function txHashOf(outcome: unknown): string {
  const root = outcome as Record<string, unknown>;
  const tx = root.transaction as Record<string, unknown> | undefined;
  if (tx && typeof tx.hash === "string") return tx.hash;
  const txOutcome = root.transaction_outcome as
    | Record<string, unknown>
    | undefined;
  if (txOutcome && typeof txOutcome.id === "string") return txOutcome.id;
  return "unknown";
}

export class NearDemoChain implements DemoChain {
  private provider = new JsonRpcProvider({ url: RPC_URL });
  private account: Account | null = null;

  constructor(private secretKey: string) {}

  private signerAccount(): Account {
    if (!this.account) {
      this.account = new Account(
        DEMO_AGENT,
        this.provider,
        KeyPairSigner.fromSecretKey(this.secretKey as KeyPairString),
      );
    }
    return this.account;
  }

  private async viewCall<T>(
    method: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    return (await this.provider.callFunction({
      contractId: VAULT_TEST,
      method,
      args,
      blockQuery: { finality: "final" },
    })) as T;
  }

  async viewAccessKeyList(accountId: string): Promise<unknown> {
    return this.provider.viewAccessKeyList({
      accountId,
      finalityQuery: { finality: "final" },
    });
  }

  async getObligation(obligationId: string): Promise<ObligationRow | null> {
    return this.viewCall<ObligationRow | null>("get_obligation", {
      obligation_id: obligationId,
    });
  }

  async getPolicy(policyId: string): Promise<{ spent: number | string }> {
    return this.viewCall<{ spent: number | string }>("get_policy", {
      policy_id: policyId,
    });
  }

  async getReceiptCount(): Promise<number> {
    const state = await this.viewCall<unknown>("state", {});
    if (Array.isArray(state) && typeof state[1] === "number") return state[1];
    throw new Error("unexpected state() shape from the vault");
  }

  async getReceipt(index: number): Promise<{ obligation_id: string } | null> {
    const rows = await this.viewCall<{ obligation_id: string }[]>(
      "receipts",
      { start: index, limit: 1 },
    );
    return Array.isArray(rows) ? (rows[0] ?? null) : null;
  }

  async settle(
    obligationId: string,
    recipient: string,
    amount: string,
  ): Promise<string> {
    // Settle attaches no deposit: the vault attaches the 1 yoctoNEAR
    // for its own ft_transfer. Stating 0n keeps the call from
    // silently inheriting a default.
    const outcome = await this.signerAccount().callFunctionRaw({
      contractId: VAULT_TEST,
      methodName: "settle",
      args: {
        obligation_id: obligationId,
        proposed_recipient: recipient,
        proposed_amount: amount,
        evidence_ref: DEMO_EVIDENCE_REF,
      },
      gas: SETTLE_GAS,
      deposit: 0n,
    });
    return txHashOf(outcome);
  }
}

/* ---------- handler ---------- */

export interface DemoRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}

export interface DemoResponse {
  status(code: number): DemoResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string | string[]): void;
}

export interface DemoHandlerDeps {
  env: Record<string, string | undefined>;
  createChain: (secretKey: string) => DemoChain;
  rateLimitStore?: RateLimitStore;
  settleTimeoutMs?: number;
  confirmTimeoutMs?: number;
  confirmIntervalMs?: number;
  confirmReadsTimeoutMs?: number;
  handlerDeadlineMs?: number;
  scopeTimeoutMs?: number;
  scanTimeoutMs?: number;
}

const sharedRateLimitStore = createRateLimitStore();

/* Scan the ten demo obligations in order and return the READY rows,
 * with their terms read from the chain. Used before the settle and
 * again after confirmation, so the remaining count is fresh. */
async function findReady(chain: DemoChain): Promise<ObligationRow[]> {
  const ready: ObligationRow[] = [];
  for (const id of DEMO_OBLIGATION_IDS) {
    const row = await chain.getObligation(id);
    if (row !== null && row.state === "READY") ready.push(row);
  }
  return ready;
}

/* Race a promise against a timeout. A hang resolves null, a
 * rejection resolves null too: the caller treats null as "not
 * established", never as a fact. The underlying promise keeps
 * running in the background; there is no abort, only a bounded
 * wait. */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/* Poll get_obligation until the row reads PAID or the window ends.
 * A settled call resolving does not prove the tokens moved: the
 * NEP-141 transfer and its callback run after the vault accepts the
 * call, and a failed transfer rolls the obligation back to READY.
 * Only PAID on chain counts as paid. A read error counts as not yet
 * paid, never as paid. */
async function waitForPaid(
  chain: DemoChain,
  obligationId: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return false;
    // Each poll races the remaining window (at most 4 seconds a
    // call), so a hung RPC cannot hold the handler past the
    // deadline: the poll resolves null and the loop gives up.
    const row = await withTimeout(
      chain.getObligation(obligationId).catch(() => null),
      Math.min(remainingMs, 4000),
    );
    if (row !== null && row.state === "PAID") return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(intervalMs, Math.max(0, deadline - Date.now())),
      ),
    );
  }
}

/* Find the receipt for one obligation among the newest receipts.
 * The latest receipt is not necessarily this settle: another settle
 * could have landed between reads. Scan back a few entries and match
 * on obligation_id. */
async function findReceiptIndex(
  chain: DemoChain,
  obligationId: string,
): Promise<number | null> {
  const count = await chain.getReceiptCount();
  const start = Math.max(0, count - RECEIPT_SCAN_BACK);
  for (let i = count - 1; i >= start; i--) {
    const receipt = await chain.getReceipt(i).catch(() => null);
    if (receipt !== null && receipt.obligation_id === obligationId) return i;
  }
  return null;
}

/* A failed settle reports a fixed message plus the contract error
 * code when the failure carries one (ERR_TERMS_MISMATCH and the like).
 * Raw SDK or RPC error text is never passed through: it is unbounded
 * and the backend promises the key never appears in an error, so only
 * a known code is echoed. */
function settleFailureMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : "unknown error";
  const code = /ERR_[A-Z_]+/.exec(message)?.[0];
  if (code !== undefined) return "The settle failed: " + code + ".";
  return "The settle failed. Check the obligation on the test vault before running again.";
}

export async function handleDemoSettle(
  req: DemoRequest,
  res: DemoResponse,
  deps: DemoHandlerDeps,
): Promise<void> {
  // Overall budget: the function allows 30 seconds. Every stage
  // below races the time left to this deadline, set when the
  // handler starts, so a hung RPC can never hold the call past it.
  const startedAt = Date.now();
  const handlerDeadlineMs = deps.handlerDeadlineMs ?? HANDLER_DEADLINE_MS;
  const deadline = startedAt + handlerDeadlineMs;
  const timeLeft = () => Math.max(0, deadline - Date.now());
  const store = deps.rateLimitStore ?? sharedRateLimitStore;
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
  // problem for a minute. The rate limit still runs before any chain
  // read or settle, so a caller cannot hammer the RPC through us.
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

  const ip = getClientIp(req);
  const limit = checkRateLimit(store, ip, Date.now());
  if (!limit.allowed) {
    res.setHeader("Retry-After", String(limit.retryAfterSeconds));
    res.status(429).json(
      fail(
        "RATE_LIMITED",
        "Too many demo settles from this address: 1 per minute, 5 per hour. Try again in " +
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

  // A hung key-list read answers 502 instead of holding the handler:
  // nothing has settled yet, so the caller can safely retry.
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
          "The chain could not be read to verify the demo key, so nothing was settled.",
        ),
      );
    return;
  }
  const scope = verifyKeyScope(keyList, publicKey, VAULT_TEST);
  if (!scope.ok) {
    res.status(500).json(fail("SCOPE_CHECK_FAILED", scope.reason));
    return;
  }

  // A hung obligation scan answers 502 instead of holding the
  // handler: nothing has settled yet, so the caller can safely retry.
  const ready: ObligationRow[] | null = await withTimeout(
    findReady(chain),
    Math.min(timeLeft(), deps.scanTimeoutMs ?? SCAN_TIMEOUT_MS),
  );
  if (ready === null) {
    res
      .status(502)
      .json(
        fail(
          "CHAIN_UNREADABLE",
          "The demo obligations could not be read from the chain, so nothing was settled.",
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

  const target = ready[0];
  const recipient = target.recipient;
  const amount = String(target.amount);

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
        "The chain is responding too slowly to settle safely within the function budget, so nothing was settled.",
      ),
    );
    return;
  }

  let txHash: string;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("settle confirmation timed out")),
        settleBudgetMs,
      );
    });
    txHash = await Promise.race([
      chain.settle(target.obligation_id, recipient, amount),
      timeout,
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    if (/timed out/i.test(message)) {
      // The timer races the whole settle call, including signing and
      // submission, so a timeout proves neither submission nor
      // failure. The settle may still land on chain: the nonce
      // protects the obligation, so there is no retry here, only a
      // pointer at the explorer. The obligation id is the lookup key.
      res.status(200).json(
        fail(
          "SETTLE_TIMEOUT",
          "Confirmation timed out, and it could not be established whether the settle was submitted. Do not click again: the obligation can only settle once, check the explorer for " +
            target.obligation_id +
            " and the receipt list on the test vault.",
          { obligationId: target.obligation_id },
        ),
      );
      return;
    }
    res.status(200).json(
      fail("SETTLE_FAILED", settleFailureMessage(err), {
        obligationId: target.obligation_id,
        fallback: DEMO_NEUTRAL_FALLBACK,
      }),
    );
    return;
  } finally {
    // The soft-timeout timer must not outlive the call: on a fast
    // settle it would otherwise sit pending for 25 seconds.
    if (timer !== undefined) clearTimeout(timer);
  }

  // The settle call resolved, which only proves the vault accepted
  // the call. Confirm the obligation reads PAID on chain before
  // reporting success: a failed transfer rolls it back to READY.
  // A missing tx hash cannot be linked to the explorer, so it counts
  // as unconfirmed even when the obligation reads PAID.
  const confirmTimeoutMs = Math.min(
    deps.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS,
    Math.max(0, timeLeft() - 5000),
  );
  const confirmIntervalMs = deps.confirmIntervalMs ?? CONFIRM_POLL_MS;
  const paid = await waitForPaid(
    chain,
    target.obligation_id,
    confirmTimeoutMs,
    confirmIntervalMs,
  );
  if (!paid || txHash === "unknown") {
    res.status(200).json({
      ...fail(
        "SETTLE_UNCONFIRMED",
        "The settle could not be confirmed on chain. Do not run it again: check the explorer for " +
          target.obligation_id +
          " and the receipt list on the test vault.",
        { obligationId: target.obligation_id },
      ),
      txHash: txHash === "unknown" ? null : txHash,
    });
    return;
  }

  // Payment is confirmed. Read the receipt for this obligation, the
  // updated policy spent, and a fresh READY count for the remaining
  // settles. If those reads fail, the settle still happened: report
  // it with the tx hash and nulls, not an error.
  let receiptIndex: number | null = null;
  let policySpent: string | null = null;
  let remaining: number | null = null;
  // The reads race a 5 second cap, so a hung RPC cannot hold the
  // handler past the function budget. On a timeout the settle is
  // still confirmed (the obligation reads PAID above): the response
  // reports it with the tx hash and nulls, not an error.
  const readsTimeoutMs = Math.min(
    deps.confirmReadsTimeoutMs ?? CONFIRM_READS_TIMEOUT_MS,
    Math.max(0, timeLeft() - 1000),
  );
  const reads = await withTimeout(
    (async () => {
      const found = await findReceiptIndex(chain, target.obligation_id);
      const policy = await chain.getPolicy(DEMO_POLICY_ID);
      const stillReady = await findReady(chain);
      return {
        receiptIndex: found,
        policySpent: String(policy.spent),
        remaining: stillReady.length,
      };
    })(),
    readsTimeoutMs,
  );
  if (reads !== null) {
    receiptIndex = reads.receiptIndex;
    policySpent = reads.policySpent;
    remaining = reads.remaining;
  }
  if (remaining === null) remaining = ready.length - 1;

  console.log(
    "demo-settle " +
      target.obligation_id +
      " tx " +
      txHash +
      " receipt " +
      String(receiptIndex),
  );
  res.status(200).json({
    success: true,
    obligationId: target.obligation_id,
    receiptIndex,
    txHash,
    recipient,
    amount,
    policySpent,
    remaining,
  });
}

export default async function handler(
  req: DemoRequest,
  res: DemoResponse,
): Promise<void> {
  await handleDemoSettle(req, res, {
    env: process.env,
    createChain: (secretKey: string) => new NearDemoChain(secretKey),
  });
}
