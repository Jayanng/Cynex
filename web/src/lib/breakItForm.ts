/* BreakIt free-form evaluation, pure logic with no React, so Jest can
   cover it. The form judges proposed terms against the authorized terms
   fixed on chain; the refusal shown is the recorded one from the test
   vault, not a fresh live attempt from this click. Amounts compare as
   numbers through BigInt, so 0100 is the same 100 base units the vault
   would see, while a non-numeric amount is invalid input, not a refusal. */

import { AUTHORIZED_TERMS, BREAK_IT } from "./data";

export type BreakItFormMode = "terms" | "replay" | "evidence";

export type BreakItFormOut = {
  kind: "refused" | "none" | "invalid";
  code?: string;
  tx?: string | null;
  text: string;
  /* When set, replaces the default recorded-refusal note under the result. */
  note?: string;
};

function scenario(key: string) {
  return BREAK_IT.find((s) => s.key === key);
}

export function evaluateBreakItForm(
  recipient: string,
  amount: string,
  mode: BreakItFormMode,
): BreakItFormOut {
  const r = recipient.trim();
  const a = amount.trim();
  /* An empty field is not an authorized term, in any mode. */
  if (!r) {
    return {
      kind: "invalid",
      text: "Enter a recipient first. An empty recipient is not an authorized term.",
    };
  }
  if (!a) {
    return {
      kind: "invalid",
      text: "Enter an amount first. An empty amount is not an authorized term.",
    };
  }
  if (!/^\d+$/.test(a)) {
    return {
      kind: "invalid",
      text: "The amount must be a whole number of base units.",
    };
  }
  /* The attack buttons set the tampered dimension, not the fields:
     replay resubmits the consumed nonce, remove-evidence submits with
     no evidence, both keeping the authorized recipient and amount. */
  if (mode === "replay") {
    const sc = scenario("replay");
    return {
      kind: "refused",
      code: "ERR_NONCE_ALREADY_CONSUMED",
      tx: sc ? sc.tx : null,
      text: "Nonce 1002 was already consumed by receipt 12. Reusing it is a double-pay, so the vault refused before moving anything.",
    };
  }
  if (mode === "evidence") {
    return {
      kind: "refused",
      code: "ERR_INVALID_STATE",
      tx: null,
      text: "Settle was called before evidence was submitted, so the obligation was not READY and the vault refused before moving anything.",
      note: "Verdict by terms: no executed refusal transaction exists for this case in the demo run, so no tx is shown.",
    };
  }
  if (r !== AUTHORIZED_TERMS.recipient) {
    const sc = scenario("recipient");
    return {
      kind: "refused",
      code: "ERR_RECIPIENT_SUBSTITUTION",
      tx: sc ? sc.tx : null,
      text: "The proposed recipient does not match the recipient fixed at authorization. The vault refused before any transfer.",
    };
  }
  if (BigInt(a) !== BigInt(AUTHORIZED_TERMS.amount)) {
    const sc = scenario("amount");
    return {
      kind: "refused",
      code: "ERR_TERMS_MISMATCH",
      tx: sc ? sc.tx : null,
      text: "The proposed amount does not match the amount fixed at authorization, " +
        AUTHORIZED_TERMS.amount +
        " base units. The vault refused before any transfer.",
    };
  }
  return {
    kind: "none",
    text: "No attack detected. The recipient and amount match the authorized terms. Change the recipient or the amount to see the vault refuse.",
  };
}
