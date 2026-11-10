/* Live-mode demo key contract.
   Values come from build-time environment variables and never from git.
   The key, when supplied, is a function-call access key scoped to `settle`
   on the test vault only, with a small allowance. Even fully leaked it can
   only attempt settles. The vault decides. */

import type { KeyPairString } from "near-api-js";
import { RPC_URL, VAULT_TEST } from "./chain";

export interface DemoKeyConfig {
  enabled: boolean;
  accountId: string;
  publicKey: string;
  privateKey: string;
  readyObligationId: string;
  pendingObligationId: string;
}

const env = import.meta.env as Record<string, string | undefined>;

export const DEMO_KEY: DemoKeyConfig = {
  enabled: env.VITE_DEMO_ENABLED === "true",
  accountId: env.VITE_DEMO_ACCOUNT_ID ?? "",
  publicKey: env.VITE_DEMO_PUBLIC_KEY ?? "",
  privateKey: env.VITE_DEMO_PRIVATE_KEY ?? "",
  readyObligationId: env.VITE_DEMO_READY_OBLIGATION ?? "",
  pendingObligationId: env.VITE_DEMO_PENDING_OBLIGATION ?? "",
};

export function demoKeyConfigured(): boolean {
  return !!(DEMO_KEY.enabled && DEMO_KEY.accountId && DEMO_KEY.publicKey &&
    DEMO_KEY.privateKey && DEMO_KEY.readyObligationId && DEMO_KEY.pendingObligationId);
}

export interface LiveAttemptResult {
  ok: boolean;
  errCode: string | null;
  txHash: string | null;
  detail: string;
}

/** Sign and send a real settle call with the demo key. Only attacks are ever
    sent: the recipient is never the authorized one, so a success here would
    mean the vault is broken, which is exactly what the button tests. */
export async function attemptLiveSettle(
  obligationId: string,
  tamperedRecipient: string,
  amount: string,
  nonce: number,
): Promise<LiveAttemptResult> {
  if (!demoKeyConfigured()) {
    return { ok: false, errCode: null, txHash: null, detail: "not configured" };
  }
  try {
    // near-api-js pulls in node-only modules, so it is loaded only when a
    // live attack is actually attempted. The main bundle never touches it.
    const { Account, actions } = await import("near-api-js");
    const account = new Account(DEMO_KEY.accountId, RPC_URL, DEMO_KEY.privateKey as KeyPairString);
    const args = {
      obligation_id: obligationId,
      proposed_recipient: tamperedRecipient,
      proposed_amount: amount,
      evidence_ref: "live-demo-attack",
    };
    const outcome = await account.signAndSendTransaction({
      receiverId: VAULT_TEST,
      actions: [actions.functionCall("settle", args, 30_000_000_000_000n, 0n)],
    });
    const txHash: string | null = outcome?.transaction?.hash ?? null;
    const status = outcome?.status;
    const failure = JSON.stringify(status ?? null).match(/ERR_[A-Z_]+/);
    if (typeof status === "object" && status !== null && "SuccessValue" in status) {
      return {
        ok: true,
        errCode: null,
        txHash,
        detail: "settled, which should be impossible for an attack",
      };
    }
    return {
      ok: false,
      errCode: failure ? failure[0] : null,
      txHash,
      detail: failure ? "vault refusal" : "failed without a vault code",
    };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    const code = msg.match(/ERR_[A-Z_]+/);
    const hash = msg.match(/[1-9A-HJ-NP-Za-km-z]{43,44}/);
    return {
      ok: false,
      errCode: code ? code[0] : null,
      txHash: hash ? hash[0] : null,
      detail: msg.slice(0, 240),
    };
  }
}
