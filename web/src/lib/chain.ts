/* Minimal NEAR RPC client over plain JSON-RPC fetch. One place where the
   endpoint lives. Every call is read-only. Failures are loud and honest:
   callers get null and show an Unavailable state. Nothing here caches a
   value as if it were live. */

export const RPC_URL = "https://test.rpc.fastnear.com";
export const VAULT_TEST = "cynex-testvault.cynexmaster.testnet";
export const VAULT_PROD = "cynex-vault.cynexmaster.testnet";

let rpcId = 1;

async function rpc<T>(method: string, params: unknown): Promise<T | null> {
  try {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
    });
    const body = (await res.json()) as { result?: T; error?: unknown };
    if (body.error !== undefined || body.result === undefined) return null;
    return body.result;
  } catch {
    return null;
  }
}

function b64(obj: unknown): string {
  return btoa(JSON.stringify(obj));
}

function fromB64Bytes(s: string): string {
  const bin = atob(s);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export interface AccountView {
  code_hash: string;
  amount: string;
  storage_usage: number;
}

export async function viewAccount(account: string): Promise<AccountView | null> {
  return rpc<AccountView>("query", {
    request_type: "view_account",
    finality: "final",
    account_id: account,
  });
}

export async function viewCall<T>(account: string, methodName: string, args: unknown): Promise<T | null> {
  const raw = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: account,
    method_name: methodName,
    args_base64: b64(args),
  });
  if (!raw || !raw.result) return null;
  try {
    const text = new TextDecoder().decode(Uint8Array.from(raw.result));
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function blockHeight(): Promise<number | null> {
  const raw = await rpc<{ header: { height: number } }>("block", { finality: "final" });
  return raw?.header?.height ?? null;
}

export interface ReceiptRow {
  index: string;
  prev_hash: number[] | string;
  obligation_id: string;
  recipient: string;
  amount: string;
  token_id: string;
  timestamp: string;
  tx_ref: string;
}

export async function fetchReceipts(vault: string): Promise<ReceiptRow[]> {
  const rows: ReceiptRow[] = [];
  let start = 0;
  for (;;) {
    const batch = await viewCall<ReceiptRow[]>(vault, "receipts", { start, limit: 50 });
    if (!batch || batch.length === 0) break;
    rows.push(...batch);
    start += batch.length;
    if (batch.length < 50) break;
    if (rows.length > 500) break;
  }
  return rows;
}

export interface ObligationView {
  obligation_id: string;
  policy_id: string;
  policy_version: number;
  recipient: string;
  amount: string;
  evidence_type: string;
  evidence_hash: number[];
  expires_at_ns: string;
  nonce: number;
  state: string;
  in_flight: boolean;
  transfer_attempt: number;
}

export async function getObligation(vault: string, id: string): Promise<ObligationView | null> {
  return viewCall<ObligationView | null>(vault, "get_obligation", { obligation_id: id });
}

export interface BalanceView {
  spent: string;
  reserved: string;
  limit: string;
  funded: string;
  native_headroom: string;
}

export async function getBalances(vault: string, policyId: string): Promise<BalanceView | null> {
  return viewCall<BalanceView | null>(vault, "balances", { policy_id: policyId });
}

export async function ftBalanceOf(token: string, account: string): Promise<string | null> {
  return viewCall<string>(token, "ft_balance_of", { account_id: account });
}

/** prev_hash arrives as a byte array from borsh-JSON views. Normalize to hex. */
export function hashToHex(h: number[] | string): string {
  if (typeof h === "string") return h;
  return Array.from(h)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
