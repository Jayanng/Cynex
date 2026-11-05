/**
 * Cynex playground client, Phase 6 Lane B. Browser only, fetch
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
}

interface DemoVault {
  label: string;
  vaultId: string;
  obligations: DemoObligation[];
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
  function fillObligations(): void {
    const vault = demo.vaults.find(function (v) {
      return v.vaultId === vaultElement.value;
    });
    obligationElement.textContent = "";
    for (const obligation of vault?.obligations ?? []) {
      const option = document.createElement("option");
      option.value = obligation.obligation_id;
      option.textContent = obligation.obligation_id + " (" + obligation.role + ", " + obligation.amount + ")";
      obligationElement.appendChild(option);
    }
  }
  for (const vault of demo.vaults) {
    const option = document.createElement("option");
    option.value = vault.vaultId;
    option.textContent = vault.label + " (" + vault.vaultId + ")";
    vaultSelect.appendChild(option);
  }
  vaultSelect.addEventListener("change", fillObligations);
  fillObligations();
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
    showLines("result", formatSettleResult((await response.json()) as SettleResult));
    setText("status", "settle done, result above with the live tx hash and the live chain read");
  });
}

if (typeof document !== "undefined") {
  void init();
}
