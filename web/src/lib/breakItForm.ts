/* BreakIt input validation and free-text term extraction, pure logic
 * with no React, so Jest can cover it. The validation checks only the
 * shape of what the judge typed: a non-empty recipient and a
 * whole-number amount. It judges nothing about the terms: the
 * outcome of an attack comes from the chain, from /api/demo-attack,
 * never from a local comparison.
 *
 * The extraction is pattern-based, not an LLM: it looks for an
 * account id and an integer in the judge's free text, shows exactly
 * what it found, and lets the judge confirm or edit it before
 * anything is submitted. The settle attempt and the vault rejection
 * are the live parts; no agent is tricked in the browser.
 */

export type BreakItInputValidation =
  | { ok: true }
  | { ok: false; error: string };

export function validateBreakItInput(
  recipient: string,
  amount: string,
): BreakItInputValidation {
  const r = recipient.trim();
  const a = amount.trim();
  if (!r) {
    return {
      ok: false,
      error: "Enter a recipient first. An empty recipient is not an authorized term.",
    };
  }
  if (!a) {
    return {
      ok: false,
      error: "Enter an amount first. An empty amount is not an authorized term.",
    };
  }
  if (!/^[0-9]+$/.test(a)) {
    return {
      ok: false,
      error: "The amount must be a whole number of base units.",
    };
  }
  return { ok: true };
}

export interface ExtractedAttackTerms {
  recipient: string | null;
  amount: string | null;
}

/* Strip the punctuation a judge wraps a token in: quotes, brackets,
 * a trailing comma or full stop. The inside of the token is left
 * exactly as typed. */
function cleanToken(token: string): string {
  return token.replace(/^["'([{<]+/, "").replace(/["')\]},;:!?.]+$/, "");
}

/* A token counts as an account id when it is all lowercase letters,
 * digits and separators, 2 to 64 characters, and does not start or
 * end with a separator. This matches the server shape check. */
function looksLikeAccountId(token: string): boolean {
  if (token.length < 2 || token.length > 64) return false;
  if (!/^[a-z0-9._-]+$/.test(token)) return false;
  if (/^[._-]|[._-]$/.test(token)) return false;
  return true;
}

/* Extract the best-guess recipient and amount from free text.
 * Recipient: the first token ending in .testnet wins. Failing that,
 * the first token that looks like an account id and contains a dot,
 * underscore or hyphen, so a plain English word is not mistaken for
 * an account. A bare word with no separator and no .testnet suffix
 * is not extracted: the judge can type it in the edit box instead.
 * Amount: the first run of digits once the recipient token is taken
 * out, so a digit inside the account id is not read as the amount.
 * Commas are stripped, so 1,000 reads as 1000. Returns null for
 * either side when nothing usable is found. */
export function extractAttackTerms(text: string): ExtractedAttackTerms {
  const tokens = text
    .split(/\s+/)
    .map(cleanToken)
    .filter((t) => t !== "");
  let recipient: string | null = null;
  for (const token of tokens) {
    if (token.endsWith(".testnet") && looksLikeAccountId(token)) {
      recipient = token;
      break;
    }
  }
  if (recipient === null) {
    for (const token of tokens) {
      if (
        looksLikeAccountId(token) &&
        /[._-]/.test(token) &&
        /[a-z]/.test(token)
      ) {
        recipient = token;
        break;
      }
    }
  }
  let rest = text;
  if (recipient !== null) rest = rest.replace(recipient, " ");
  const amountMatch = rest.match(/\d[\d,]*/);
  const amount =
    amountMatch === null ? null : amountMatch[0].replace(/,/g, "");
  return { recipient, amount };
}
