/**
 * Cynex executor backend, Phase 6 Lane B. Plan section 3.1.11.
 *
 * A small local backend that runs the CLI and submits the
 * agent's settle transactions. The agent's scoped function-call
 * key stays on this host (never in the browser, never in the
 * repo); the executor never reads the key file and never logs
 * it. The CLI inherits the executor's environment, so the key
 * file path comes from CYNEX_AGENT_KEY_FILE on the host, the
 * same as a manual console run.
 *
 * Security, all acceptance criteria from the plan:
 *   - Authenticated frontend to executor calls. There is no
 *     unauthenticated shell endpoint: POST /settle requires a
 *     session cookie issued by POST /auth with the operator
 *     token from CYNEX_EXECUTOR_TOKEN. The server refuses to
 *     start without a token configured, so it can never run
 *     open by accident.
 *   - Input validation on every parameter, server side, before
 *     anything is executed: payee must be a valid account id,
 *     amount must be a positive u128 in base units, no shell
 *     metacharacters anywhere in any parameter. The browser
 *     is never trusted; the executor re-validates everything.
 *   - A per-action rate limit: 5 settle calls per session per
 *     rolling 60 seconds, then 429 with Retry-After.
 *   - Shell execution is allow-listed to cynex commands only:
 *     the one spawn site in this file runs `node <cliPath>
 *     attack-one ...` with an argv array and no shell. There
 *     is no other spawn site, and no parameter can change the
 *     command, only the validated arguments.
 *   - Owner actions never go through this backend: the owner
 *     key is never on the executor host. Owner actions in the
 *     UI go through a wallet adapter, not through /settle.
 *
 * Reads (GET /read, GET /receipts) are public view calls:
 * they need no key
 * and no session. The page itself (GET /) contains no secret;
 * only /settle is protected.
 *
 * Run from the repo root, after compiling the CLI to a temp
 * outDir with node_modules symlinked into it (see the Phase 6
 * Lane B doc): node <outDir>/services/executor/executor.js
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider } from "near-api-js";
import { TESTNET_RPC_URL } from "../../frontend/src/cynex/client.js";
import {
  containsShellMeta,
  isValidAccountId,
  validateSettleParams,
} from "../attacks/attacks.js";

export const EXECUTOR_SESSION_COOKIE = "cynex-executor-session";
export const SESSION_TTL_MS = 60 * 60 * 1000;
export const RATE_LIMIT_CALLS = 5;
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface ExecutorConfig {
  token: string;
  host: string;
  port: number;
  cliPath: string;
  repoRoot: string;
}

export function configFromEnv(): ExecutorConfig {
  const token = process.env.CYNEX_EXECUTOR_TOKEN ?? "";
  if (token === "") {
    throw new Error("CYNEX_EXECUTOR_TOKEN is not set, the executor refuses to start unauthenticated");
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const cliPath =
    process.env.CYNEX_CLI_PATH ?? join(here, "..", "..", "cli", "cynex.js");
  return {
    token,
    host: process.env.CYNEX_EXECUTOR_HOST ?? "127.0.0.1",
    port: Number(process.env.CYNEX_EXECUTOR_PORT ?? "8787"),
    cliPath,
    repoRoot: process.env.CYNEX_REPO_ROOT ?? process.cwd(),
  };
}

export interface SettleRequest {
  vaultId: string;
  obligationId: string;
  proposedRecipient: string;
  proposedAmount: string;
  evidenceRef: string;
}

/**
 * Validate a settle request body. Returns the list of
 * rejection reasons; empty means the request may be executed.
 * The vault id must be a valid account id, the obligation id
 * is a free-form record id (1 to 128 characters, no shell
 * metacharacters, no whitespace), and the settle parameters
 * go through the shared validator.
 */
export function validateSettleRequest(body: unknown): string[] {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return ["request body must be a JSON object"];
  }
  const row = body as Record<string, unknown>;
  const problems: string[] = [];
  const vaultId = row.vaultId;
  if (typeof vaultId !== "string" || !isValidAccountId(vaultId)) {
    problems.push("vaultId is not a valid account id");
  }
  const obligationId = row.obligationId;
  if (typeof obligationId !== "string" || obligationId.length === 0 || obligationId.length > 128) {
    problems.push("obligationId must be 1 to 128 characters");
  } else if (containsShellMeta(obligationId)) {
    problems.push("obligationId contains a shell metacharacter");
  }
  const recipient = row.proposedRecipient;
  const amount = row.proposedAmount;
  const evidenceRef = row.evidenceRef;
  if (typeof recipient !== "string" || typeof amount !== "string" || typeof evidenceRef !== "string") {
    problems.push("proposedRecipient, proposedAmount, and evidenceRef must all be strings");
    return problems;
  }
  problems.push(...validateSettleParams(recipient, amount, evidenceRef));
  return problems;
}

/**
 * The one allow-listed command this backend can ever run: the
 * repo CLI, attack-one, with five validated arguments. The
 * argv array is passed to execFile with no shell, so no
 * argument can be interpreted as a command, a redirect, or a
 * substitution, even if validation missed something.
 */
export function buildSettleArgv(cliPath: string, request: SettleRequest): string[] {
  return [
    cliPath,
    "attack-one",
    request.vaultId,
    request.obligationId,
    request.proposedRecipient,
    request.proposedAmount,
    request.evidenceRef,
  ];
}

export function isAllowedCommand(argv: string[], cliPath: string): boolean {
  return argv.length === 7 && argv[0] === cliPath && argv[1] === "attack-one";
}

/** Sliding-window rate limiter, per session id. */
export function createRateLimiter(limit: number, windowMs: number): {
  allow: (sessionId: string) => boolean;
  retryAfterMs: (sessionId: string) => number;
} {
  const calls = new Map<string, number[]>();
  function prune(sessionId: string, now: number): number[] {
    const kept = (calls.get(sessionId) ?? []).filter(function (t) {
      return now - t < windowMs;
    });
    calls.set(sessionId, kept);
    return kept;
  }
  return {
    allow: function (sessionId: string): boolean {
      const now = Date.now();
      const kept = prune(sessionId, now);
      if (kept.length >= limit) {
        return false;
      }
      kept.push(now);
      return true;
    },
    retryAfterMs: function (sessionId: string): number {
      const kept = prune(sessionId, Date.now());
      if (kept.length === 0) {
        return 0;
      }
      return windowMs - (Date.now() - kept[0]);
    },
  };
}

export interface SessionStore {
  create: () => string;
  valid: (sessionId: string) => boolean;
}

export function createSessionStore(ttlMs: number): SessionStore {
  const sessions = new Map<string, number>();
  return {
    create: function (): string {
      const id = randomBytes(32).toString("hex");
      sessions.set(id, Date.now() + ttlMs);
      return id;
    },
    valid: function (sessionId: string): boolean {
      const expiresAt = sessions.get(sessionId);
      if (expiresAt === undefined) {
        return false;
      }
      if (Date.now() > expiresAt) {
        sessions.delete(sessionId);
        return false;
      }
      return true;
    },
  };
}

export function tokensEqual(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) {
    return out;
  }
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }
    out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise(function (resolve, reject) {
    const chunks: Buffer[] = [];
    request.on("data", function (chunk: Buffer) {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 65536) {
        reject(new Error("request body too large"));
      }
    });
    request.on("end", function () {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function serveFile(response: ServerResponse, path: string, contentType: string): void {
  if (!existsSync(path)) {
    sendJson(response, 404, { error: "not found" });
    return;
  }
  response.writeHead(200, { "Content-Type": contentType });
  response.end(readFileSync(path));
}

/** Extract the RESULT JSON line the CLI prints after a settle attempt. */
export function resultFromCliOutput(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.split("\n")) {
    if (line.startsWith("RESULT ")) {
      try {
        return JSON.parse(line.slice("RESULT ".length)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function createExecutorServer(config: ExecutorConfig): ReturnType<typeof createServer> {
  const sessions = createSessionStore(SESSION_TTL_MS);
  const limiter = createRateLimiter(RATE_LIMIT_CALLS, RATE_LIMIT_WINDOW_MS);
  const provider = new JsonRpcProvider({ url: TESTNET_RPC_URL });
  const server = createServer(function (request: IncomingMessage, response: ServerResponse) {
    void handle(request, response).catch(function (error: unknown) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  /**
   * One page of receipts through the raw RPC, keeping the
   * u64/u128 fields exact. The contract returns prev_hash
   * as a byte array; it is hexed here, and index, amount,
   * and timestamp are returned as decimal strings so the
   * browser never rounds them (see the CLI parseReceiptsRaw
   * comment for why the quoting step exists).
   */
  async function fetchReceiptsPage(
    vaultId: string,
    start: number,
    limit: number,
  ): Promise<Record<string, unknown>[]> {
    const argsBase64 = Buffer.from(JSON.stringify({ start, limit })).toString("base64");
    const res = await fetch(TESTNET_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "cynex-executor-receipts",
        method: "query",
        params: {
          request_type: "call_function",
          account_id: vaultId,
          method_name: "receipts",
          args_base64: argsBase64,
          finality: "final",
        },
      }),
    });
    const data = (await res.json()) as { error?: unknown; result?: { result?: number[] } };
    if (data.error) {
      throw new Error("receipts view failed: " + JSON.stringify(data.error));
    }
    const raw = Buffer.from(data.result?.result ?? []).toString("utf-8");
    const quoted = raw.replace(/"(index|amount|timestamp)":\s*(-?\d+)/g, '"$1":"$2"');
    const rows = JSON.parse(quoted) as Record<string, unknown>[];
    return rows.map((row) => {
      const prevHash = row.prev_hash;
      const prevHex =
        typeof prevHash === "string"
          ? String(prevHash).toLowerCase()
          : Buffer.from(prevHash as number[]).toString("hex");
      return {
        index: String(row.index),
        prev_hash: prevHex,
        obligation_id: String(row.obligation_id),
        recipient: String(row.recipient),
        amount: String(row.amount),
        token_id: String(row.token_id),
        timestamp: String(row.timestamp),
        tx_ref: String(row.tx_ref ?? ""),
      };
    });
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/") {
      serveFile(response, join(config.repoRoot, "frontend", "playground.html"), "text/html");
      return;
    }
    if (request.method === "GET" && url.pathname === "/playground-client.js") {
      const here = dirname(fileURLToPath(import.meta.url));
      serveFile(response, join(here, "..", "..", "frontend", "src", "playground-client.js"), "text/javascript");
      return;
    }
    if (request.method === "GET" && url.pathname === "/demo-obligations") {
      serveFile(response, join(config.repoRoot, "demo", "playground-obligations.json"), "application/json");
      return;
    }
    if (request.method === "GET" && url.pathname === "/read") {
      const vaultId = url.searchParams.get("vaultId") ?? "";
      const obligationId = url.searchParams.get("obligationId") ?? "";
      if (!isValidAccountId(vaultId) || obligationId === "" || obligationId.length > 128 || containsShellMeta(obligationId)) {
        sendJson(response, 400, { error: "vaultId and obligationId are required and must be clean" });
        return;
      }
      const obligation = (await provider.callFunction({
        contractId: vaultId,
        method: "get_obligation",
        args: { obligation_id: obligationId },
        blockQuery: { finality: "final" },
      })) as Record<string, unknown> | null;
      if (obligation === null || obligation === undefined) {
        sendJson(response, 404, { error: "obligation not found on chain" });
        return;
      }
      const policy = (await provider.callFunction({
        contractId: vaultId,
        method: "get_policy",
        args: { policy_id: String(obligation.policy_id) },
        blockQuery: { finality: "final" },
      })) as Record<string, unknown> | null;
      let balance: string | null = null;
      if (policy !== null && policy !== undefined && typeof policy.token_id === "string") {
        const value = (await provider.callFunction({
          contractId: String(policy.token_id),
          method: "ft_balance_of",
          args: { account_id: String(obligation.recipient) },
          blockQuery: { finality: "final" },
        })) as unknown;
        balance = String(value);
      }
      sendJson(response, 200, { obligation, policy, recipientBalance: balance });
      return;
    }
    if (request.method === "GET" && url.pathname === "/receipts") {
      const vaultId = url.searchParams.get("vaultId") ?? "";
      if (!isValidAccountId(vaultId)) {
        sendJson(response, 400, { error: "vaultId is required and must be a valid account id" });
        return;
      }
      const all: Record<string, unknown>[] = [];
      let start = 0;
      for (;;) {
        const page = await fetchReceiptsPage(vaultId, start, 100);
        if (page.length === 0) {
          break;
        }
        all.push(...page);
        start += page.length;
        if (page.length < 100) {
          break;
        }
      }
      sendJson(response, 200, { receipts: all });
      return;
    }
    if (request.method === "POST" && url.pathname === "/auth") {
      let body: unknown;
      try {
        body = JSON.parse(await readBody(request));
      } catch {
        sendJson(response, 400, { error: "request body must be JSON" });
        return;
      }
      const presented = (body as Record<string, unknown>).token;
      if (typeof presented !== "string" || !tokensEqual(presented, config.token)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      const sessionId = sessions.create();
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie":
          EXECUTOR_SESSION_COOKIE +
          "=" +
          sessionId +
          "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" +
          Math.floor(SESSION_TTL_MS / 1000),
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/settle") {
      const sessionId = parseCookies(request.headers.cookie)[EXECUTOR_SESSION_COOKIE] ?? "";
      if (!sessions.valid(sessionId)) {
        sendJson(response, 401, { error: "unauthorized: authenticate first" });
        return;
      }
      if (!limiter.allow(sessionId)) {
        response.writeHead(429, {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(limiter.retryAfterMs(sessionId) / 1000)),
        });
        response.end(JSON.stringify({ error: "rate limited: at most 5 settle calls per session per 60 seconds" }));
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse(await readBody(request));
      } catch {
        sendJson(response, 400, { error: "request body must be JSON" });
        return;
      }
      const problems = validateSettleRequest(body);
      if (problems.length > 0) {
        sendJson(response, 400, { error: "invalid settle request", problems });
        return;
      }
      const settled = body as unknown as SettleRequest;
      const argv = buildSettleArgv(config.cliPath, settled);
      if (!isAllowedCommand(argv, config.cliPath)) {
        sendJson(response, 500, { error: "command not allow-listed, refusing to execute" });
        return;
      }
      const outcome = await new Promise<{ stdout: string; stderr: string; code: number | null }>(function (resolve) {
        execFile("node", argv, { shell: false, timeout: 180000 }, function (error, stdout, stderr) {
          resolve({ stdout: String(stdout), stderr: String(stderr), code: error === null ? 0 : (typeof error.code === "number" ? error.code : 1) });
        });
      });
      const result = resultFromCliOutput(outcome.stdout);
      if (result === null) {
        sendJson(response, 502, { error: "the CLI did not return a RESULT line", stdout: outcome.stdout, code: outcome.code });
        return;
      }
      sendJson(response, 200, result);
      return;
    }
    sendJson(response, 404, { error: "not found" });
  }

  return server;
}

if (import.meta.url === "file://" + process.argv[1]) {
  const config = configFromEnv();
  const server = createExecutorServer(config);
  server.listen(config.port, config.host, function () {
    console.log("cynex executor listening on " + config.host + ":" + String(config.port) + " (localhost only by default)");
    console.log("playground: http://" + config.host + ":" + String(config.port) + "/");
    console.log("the agent key stays on this host; the owner key is never here");
  });
}
