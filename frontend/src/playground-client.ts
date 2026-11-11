/**
 * Cynex playground client,  frontend. Browser only, fetch
 * and DOM, no near-api-js, no keys: the browser holds no key
 * and makes no chain calls itself. Every settle goes through
 * the executor (POST /settle), which validates, rate-limits,
 * and runs the CLI on the host; every chain read goes through
 * the executor (GET /read), which is a live RPC view call.
 * The server is authoritative: this client checks only that
 * the form is filled in, so the user gets immediate feedback,
 * and the executor re-validates everything before executing.
 *
 * Rendering uses textContent only, never innerHTML, so a
 * transaction hash or reason code can never become markup.
 */

export interface SettleRequestBody {
  vaultId: string;
  obligationId: string;
  proposedRecipient: string;
  proposedAmount: string;
  evidenceRef: string;
}

export interface SettleResult {
  txHash?: string;
  reasonCode?: string;
  stateAfter?: string;
  balanceBefore?: string;
  balanceAfter?: string;
  moved?: string;
  settled?: boolean;
}

export function buildSettleRequest(
  vaultId: string,
  obligationId: string,
  payee: string,
  amount: string,
  evidenceRef: string,
): SettleRequestBody {
  const trimmedPayee = payee.trim();
  const trimmedAmount = amount.trim();
  const trimmedRef = evidenceRef.trim();
  if (vaultId === "" || obligationId === "" || trimmedPayee === "" || trimmedAmount === "" || trimmedRef === "") {
    throw new Error("fill in the vault, obligation, payee, amount, and evidence ref first");
  }
  if (!/^[0-9]+$/.test(trimmedAmount)) {
    throw new Error("amount must be a decimal string of digits only");
  }
  return {
    vaultId,
    obligationId,
    proposedRecipient: trimmedPayee,
    proposedAmount: trimmedAmount,
    evidenceRef: trimmedRef,
  };
}

export function formatSettleResult(result: SettleResult): string[] {
  const lines: string[] = [];
  if (result.settled === true) {
    lines.push("SETTLED");
  } else if (typeof result.reasonCode === "string" && result.reasonCode !== "") {
    lines.push("BLOCKED: " + result.reasonCode);
  } else {
    lines.push("settled state unknown, see the transaction hash and the live read below");
  }
  lines.push("tx hash: " + String(result.txHash ?? "unknown"));
  lines.push("state after: " + String(result.stateAfter ?? "unknown"));
  lines.push("balance before: " + String(result.balanceBefore ?? "unknown"));
  lines.push("balance after: " + String(result.balanceAfter ?? "unknown"));
  lines.push("moved: " + String(result.moved ?? "unknown"));
  return lines;
}

export function formatReadResult(read: {
  obligation?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  recipientBalance?: string | null;
}): string[] {
  const obligation = read.obligation ?? {};
  const policy = read.policy ?? {};
  return [
    "obligation " + String(obligation.obligation_id ?? "unknown") + ": " + String(obligation.state ?? "unknown"),
    "recorded recipient: " + String(obligation.recipient ?? "unknown"),
    "recorded amount: " + String(obligation.amount ?? "unknown"),
    "policy " + String(obligation.policy_id ?? "unknown") + ": limit " + String(policy.limit ?? "unknown") + ", spent " + String(policy.spent ?? "unknown") + ", reserved " + String(policy.reserved ?? "unknown") + ", funded " + String(policy.funded ?? "unknown") + ", frozen " + String(policy.frozen ?? "unknown"),
    "recipient ft_balance_of: " + String(read.recipientBalance ?? "unknown"),
  ];
}

interface DemoObligation {
  obligation_id: string;
  role: string;
  amount: string;
  note: string;
  evidence_type: string;
  settleable?: boolean;
}

interface DemoVault {
  label: string;
  vaultId: string;
  obligations: DemoObligation[];
}

/**
 * The settle result as a card: labelled rows instead of
 * the raw lines. The verdict is the first row so the judge
 * sees SETTLED or BLOCKED with the reason code at a glance;
 * the tx hash and the live balance delta are the proof.
 */
export function formatSettleCard(result: SettleResult): [string, string][] {
  const verdict =
    result.settled === true
      ? "SETTLED"
      : typeof result.reasonCode === "string" && result.reasonCode !== ""
        ? "BLOCKED: " + result.reasonCode
        : "settled state unknown, see the transaction hash and the live read";
  return [
    ["verdict", verdict],
    ["tx hash", String(result.txHash ?? "unknown")],
    ["state after", String(result.stateAfter ?? "unknown")],
    ["balance before", String(result.balanceBefore ?? "unknown")],
    ["balance after", String(result.balanceAfter ?? "unknown")],
    ["moved", String(result.moved ?? "unknown")],
  ];
}

export function renderSettleCard(id: string, result: SettleResult): void {
  const element = document.getElementById(id);
  if (element === null) {
    return;
  }
  element.textContent = "";
  for (const [label, value] of formatSettleCard(result)) {
    const row = document.createElement("div");
    row.className = "row";
    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    const valueSpan = document.createElement("span");
    valueSpan.textContent = value;
    if (label === "verdict") {
      row.className = "row verdict";
    }
    row.appendChild(labelSpan);
    row.appendChild(valueSpan);
    element.appendChild(row);
  }
  element.className = "card";
}

/**
 * The test matrix: one row per demo obligation, [vault,
 * obligation, evidence_type, role, amount, note]. The matrix
 * is the plan; the live state comes from the Read button.
 */
export function matrixRows(vaults: DemoVault[]): string[][] {
  const rows: string[][] = [];
  for (const vault of vaults) {
    for (const obligation of vault.obligations) {
      rows.push([
        vault.label,
        obligation.obligation_id,
        obligation.evidence_type,
        obligation.role,
        obligation.amount,
        obligation.note + (obligation.settleable === false ? " (read-only: this case is not settled from the playground)" : ""),
      ]);
    }
  }
  return rows;
}

export function renderTestMatrix(id: string, vaults: DemoVault[]): void {
  const table = document.getElementById(id);
  if (table === null) {
    return;
  }
  table.textContent = "";
  const header = document.createElement("tr");
  for (const label of ["vault", "obligation", "evidence", "role", "amount", "expected"]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    header.appendChild(cell);
  }
  table.appendChild(header);
  for (const row of matrixRows(vaults)) {
    const tr = document.createElement("tr");
    for (const value of row) {
      const cell = document.createElement("td");
      cell.textContent = value;
      tr.appendChild(cell);
    }
    table.appendChild(tr);
  }
}

/**
 * Tamper-and-detect in the browser. The frozen receipt hash
 * (plan section 3.1.10), implemented with Web Crypto so the
 * judge can verify a receipt chain without the executor:
 * SHA-256 over index_u64_BE || prev_hash_32_bytes ||
 * obligation_id / recipient / token_id / tx_ref each as
 * u32_BE length prefix plus UTF-8, amount_u128_BE, and
 * timestamp_u64_BE. Receipts arrive from the executor with
 * the u64/u128 fields as decimal strings, so no value is
 * rounded by JSON.parse. A tamper in a receipt is detected
 * at the NEXT receipt, whose prev_hash no longer matches
 * the recomputed hash of the tampered row; the last receipt
 * has no next row yet, so it is only anchored when the next
 * receipt arrives. Requires a secure context (localhost
 * counts); crypto.subtle is also present in Node for tests.
 */
export interface BrowserReceipt {
  index: string;
  prev_hash: string;
  obligation_id: string;
  recipient: string;
  amount: string;
  token_id: string;
  timestamp: string;
  tx_ref: string;
}

function u64be(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, value, false);
  return bytes;
}

function u128be(value: bigint): Uint8Array {
  const bytes = new Uint8Array(16);
  let v = value;
  for (let i = 15; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

function lengthPrefixed(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  const out = new Uint8Array(4 + encoded.length);
  new DataView(out.buffer).setUint32(0, encoded.length, false);
  out.set(encoded, 4);
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("hash must be exactly 64 hex characters (32 bytes)");
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function receiptHashBrowser(receipt: BrowserReceipt): Promise<string> {
  const parts = [
    u64be(BigInt(receipt.index)),
    hexToBytes(receipt.prev_hash),
    lengthPrefixed(receipt.obligation_id),
    lengthPrefixed(receipt.recipient),
    u128be(BigInt(receipt.amount)),
    lengthPrefixed(receipt.token_id),
    u64be(BigInt(receipt.timestamp)),
    lengthPrefixed(receipt.tx_ref),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyReceiptChainBrowser(
  receipts: BrowserReceipt[],
): Promise<{ index: string; verified_ok: boolean }[]> {
  let prev = "00".repeat(32);
  let expected = 0n;
  const out: { index: string; verified_ok: boolean }[] = [];
  for (const receipt of receipts) {
    const ok = BigInt(receipt.index) === expected && receipt.prev_hash.toLowerCase() === prev;
    out.push({ index: receipt.index, verified_ok: ok });
    prev = await receiptHashBrowser(receipt);
    expected += 1n;
  }
  return out;
}

export function formatReceiptRows(
  receipts: BrowserReceipt[],
  results: { index: string; verified_ok: boolean }[],
): string[] {
  return receipts.map((receipt, i) => {
    const ok = results[i]?.verified_ok ?? false;
    return (
      receipt.index +
      " " +
      receipt.obligation_id +
      " amount=" +
      receipt.amount +
      " verified_ok=" +
      String(ok) +
      (ok ? "" : " <-- CHAIN BREAK")
    );
  });
}

function setText(id: string, text: string): void {
  const element = document.getElementById(id);
  if (element !== null) {
    element.textContent = text;
  }
}

function showLines(id: string, lines: string[]): void {
  const element = document.getElementById(id);
  if (element === null) {
    return;
  }
  element.textContent = "";
  for (const line of lines) {
    const div = document.createElement("div");
    div.textContent = line;
    element.appendChild(div);
  }
}

function inputValue(id: string): string {
  const element = document.getElementById(id) as HTMLInputElement | null;
  return element === null ? "" : element.value;
}

function selectValue(id: string): string {
  const element = document.getElementById(id) as HTMLSelectElement | null;
  return element === null ? "" : element.value;
}

async function init(): Promise<void> {
  const vaultSelect = document.getElementById("vault") as HTMLSelectElement | null;
  const obligationSelect = document.getElementById("obligation") as HTMLSelectElement | null;
  if (vaultSelect === null || obligationSelect === null) {
    return;
  }
  const vaultElement: HTMLSelectElement = vaultSelect;
  const obligationElement: HTMLSelectElement = obligationSelect;
  let demo: { vaults: DemoVault[] } = { vaults: [] };
  try {
    const response = await fetch("/demo-obligations");
    demo = (await response.json()) as { vaults: DemoVault[] };
  } catch {
    setText("status", "could not load the demo obligations from the executor");
    return;
  }
  function updateSettleAvailability(): void {
    const button = document.getElementById("fire-settle") as HTMLButtonElement | null;
    if (button === null) {
      return;
    }
    const vault = demo.vaults.find(function (v) {
      return v.vaultId === vaultElement.value;
    });
    const selected = vault?.obligations.find(function (o) {
      return o.obligation_id === obligationElement.value;
    });
    const readOnly = selected !== undefined && selected.settleable === false;
    button.disabled = readOnly;
    if (readOnly) {
      setText("status", "this case is read-only: the proof obligation is not settled from the playground, use Read live state to inspect it");
    }
  }
  function fillObligations(): void {
    const vault = demo.vaults.find(function (v) {
      return v.vaultId === vaultElement.value;
    });
    obligationElement.textContent = "";
    for (const obligation of vault?.obligations ?? []) {
      const option = document.createElement("option");
      option.value = obligation.obligation_id;
      option.textContent =
        obligation.obligation_id +
        " (" +
        obligation.role +
        ", " +
        obligation.amount +
        ")" +
        (obligation.settleable === false ? " (read-only)" : "");
      obligationElement.appendChild(option);
    }
    updateSettleAvailability();
  }
  for (const vault of demo.vaults) {
    const option = document.createElement("option");
    option.value = vault.vaultId;
    option.textContent = vault.label + " (" + vault.vaultId + ")";
    vaultSelect.appendChild(option);
  }
  vaultSelect.addEventListener("change", fillObligations);
  obligationSelect.addEventListener("change", updateSettleAvailability);
  fillObligations();
  renderTestMatrix("test-matrix", demo.vaults);
  const authButton = document.getElementById("authenticate");
  authButton?.addEventListener("click", async function () {
    const token = inputValue("token");
    if (token === "") {
      setText("status", "enter the executor token first");
      return;
    }
    const response = await fetch("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    setText("status", response.ok ? "authenticated, settle calls are allowed" : "authentication failed (" + String(response.status) + ")");
  });
  const readButton = document.getElementById("read-live");
  readButton?.addEventListener("click", async function () {
    const vaultId = selectValue("vault");
    const obligationId = selectValue("obligation");
    const response = await fetch("/read?vaultId=" + encodeURIComponent(vaultId) + "&obligationId=" + encodeURIComponent(obligationId));
    if (!response.ok) {
      setText("status", "live read failed (" + String(response.status) + ")");
      return;
    }
    showLines("live-read", formatReadResult((await response.json()) as never));
    setText("status", "live read done, no transaction was sent");
  });
  const settleButton = document.getElementById("fire-settle");
  settleButton?.addEventListener("click", async function () {
    let request: SettleRequestBody;
    try {
      request = buildSettleRequest(selectValue("vault"), selectValue("obligation"), inputValue("payee"), inputValue("amount"), inputValue("evidence-ref"));
    } catch (e) {
      setText("status", e instanceof Error ? e.message : String(e));
      return;
    }
    setText("status", "settle sent, waiting for the chain...");
    const response = await fetch("/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (response.status === 401) {
      setText("status", "not authenticated: enter the executor token and authenticate first");
      return;
    }
    if (response.status === 429) {
      setText("status", "rate limited: at most 5 settle calls per 60 seconds, retry after " + String(response.headers.get("retry-after") ?? "?") + " seconds");
      return;
    }
    if (!response.ok) {
      const body = (await response.json().catch(function () {
        return {};
      })) as Record<string, unknown>;
      const problems = Array.isArray(body.problems) ? (body.problems as string[]).join("; ") : String(body.error ?? response.status);
      setText("status", "rejected before execution: " + problems);
      return;
    }
    const settleJson = (await response.json()) as SettleResult;
    renderSettleCard("result-card", settleJson);
    showLines("result", formatSettleResult(settleJson));
    setText("status", "settle done, result above with the live tx hash and the live chain read");
  });
  let loadedReceipts: BrowserReceipt[] = [];
  const loadButton = document.getElementById("load-receipts");
  loadButton?.addEventListener("click", async function () {
    const vaultId = selectValue("vault");
    const response = await fetch("/receipts?vaultId=" + encodeURIComponent(vaultId));
    if (!response.ok) {
      setText("status", "receipts load failed (" + String(response.status) + ")");
      return;
    }
    loadedReceipts = ((await response.json()) as { receipts: BrowserReceipt[] }).receipts;
    const results = await verifyReceiptChainBrowser(loadedReceipts);
    showLines("receipt-chain", formatReceiptRows(loadedReceipts, results));
    setText("status", "live receipts loaded: " + String(loadedReceipts.length) + " rows, all verified_ok=" + String(results.every((r) => r.verified_ok)));
  });
  const tamperButton = document.getElementById("verify-tampered");
  tamperButton?.addEventListener("click", async function () {
    if (loadedReceipts.length === 0) {
      setText("status", "load the live receipts first");
      return;
    }
    const index = Number(inputValue("tamper-index"));
    const amount = inputValue("tamper-amount").trim();
    if (!Number.isInteger(index) || index < 0 || index >= loadedReceipts.length || !/^[0-9]+$/.test(amount)) {
      setText("status", "pick a receipt index in range and a digits-only amount");
      return;
    }
    const tampered = loadedReceipts.map((r) => ({ ...r }));
    const row = tampered[index];
    if (row === undefined) {
      setText("status", "no receipt at that index");
      return;
    }
    row.amount = amount;
    const results = await verifyReceiptChainBrowser(tampered);
    showLines("tamper-result", formatReceiptRows(tampered, results));
    setText("status", "tampered copy verified locally; the live chain was not modified");
  });
}

if (typeof document !== "undefined") {
  void init();
}
