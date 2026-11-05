/**
 * Cynex attack runner core, Phase 6 Lane B. Pure logic only: no
 * network, no signing, no shell. The CLI (cli/cynex.ts) does the
 * live reads and the settle calls; the executor
 * (services/executor/executor.ts) reuses the validators here.
 *
 * The four runner scenarios, and the reason code each must
 * produce on chain (settle check order, Master lib.rs):
 *   recipient: proposed recipient differs from the recorded one
 *     -> ERR_RECIPIENT_SUBSTITUTION (checked before terms)
 *   terms: proposed amount differs from the recorded one
 *     -> ERR_TERMS_MISMATCH
 *   nonce: settle against a PAID obligation, or a second settle
 *     after a correct one in the same run
 *     -> ERR_NONCE_ALREADY_CONSUMED (checked before the state
 *     check, Phase 6 Lane A)
 *   budget: proposed amount equals the recorded one, and the
 *     recorded amount exceeds the remaining headroom
 *     -> ERR_BUDGET_EXCEEDED (checked after terms, so the
 *     proposed amount must match the recorded one or the terms
 *     check fires first instead)
 *
 * Expired and frozen are proven by Lane A and runnable in the
 * playground, but they are not runner scenarios.
 */

export const ATTACK_SCENARIOS = ["recipient", "terms", "nonce", "budget"] as const;
export type AttackScenario = (typeof ATTACK_SCENARIOS)[number];

export const REASON_CODES = [
  "ERR_RECIPIENT_SUBSTITUTION",
  "ERR_TERMS_MISMATCH",
  "ERR_NONCE_ALREADY_CONSUMED",
  "ERR_BUDGET_EXCEEDED",
  "ERR_OBLIGATION_EXPIRED",
  "ERR_POLICY_FROZEN",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const SCENARIO_LABELS: Record<AttackScenario, string> = {
  recipient: "recipient substitution",
  terms: "terms mismatch",
  nonce: "nonce replay",
  budget: "budget exceeded",
};

export const EXPECTED_CODE: Record<AttackScenario, ReasonCode> = {
  recipient: "ERR_RECIPIENT_SUBSTITUTION",
  terms: "ERR_TERMS_MISMATCH",
  nonce: "ERR_NONCE_ALREADY_CONSUMED",
  budget: "ERR_BUDGET_EXCEEDED",
};

/** Evidence ref used by every Phase 6 attack settle, matching Lane A live proofs. */
export const ATTACK_EVIDENCE_REF = "phase6-demo";

/** A valid account id that is never a real demo recipient. Used as the wrong payee. */
export const WRONG_RECIPIENT = "unregistered-xyz.testnet";
export const WRONG_RECIPIENT_FALLBACK = "wrong-payee.testnet";

export const U128_MAX = (1n << 128n) - 1n;

/**
 * Find the first known reason code inside an error string. The
 * string may be a near-api-js panic message ("Smart contract
 * panicked: ERR_...") or a raw RPC Failure JSON. Returns null
 * when no known code appears, so the caller reports an unknown
 * failure instead of guessing a code.
 */
export function reasonCodeFromError(text: string): ReasonCode | null {
  for (const code of REASON_CODES) {
    if (text.indexOf(code) !== -1) {
      return code;
    }
  }
  return null;
}

/**
 * NEAR account id shape: 2 to 64 characters, lowercase letters,
 * digits, underscore, hyphen, and dots separating segments; no
 * segment may start or end with an underscore, hyphen, or dot,
 * and no two dots in a row. This accepts named accounts and
 * 64-hex implicit accounts, and rejects anything a shell or a
 * JSON parser would treat as structure.
 */
export function isValidAccountId(value: string): boolean {
  if (value.length < 2 || value.length > 64) {
    return false;
  }
  if (/[^a-z0-9._-]/.test(value)) {
    return false;
  }
  const segments = value.split(".");
  for (const segment of segments) {
    if (segment.length === 0) {
      return false;
    }
    if (segment.startsWith("-") || segment.startsWith("_") || segment.endsWith("-") || segment.endsWith("_")) {
      return false;
    }
  }
  return true;
}

/** Shell metacharacters: anything that could break out of an argument list. */
const SHELL_META = /[;&|$`"'\s\\<>(){}\[\]*?~#!]/;

export function containsShellMeta(value: string): boolean {
  return SHELL_META.test(value);
}

/**
 * Parse a proposed amount. It must be a decimal string of digits
 * only, a positive u128 (1 to 2^128 - 1). A JSON number is
 * rejected by the caller before this runs: near-api-js would
 * round it and deserialization would fail before any contract
 * check, which is exactly the failure Lane A hit once.
 */
export function parseAmountU128(value: string): bigint {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("amount must be a decimal string of digits only, got: " + value);
  }
  const parsed = BigInt(value);
  if (parsed < 1n || parsed > U128_MAX) {
    throw new Error("amount must be a positive u128, got: " + value);
  }
  return parsed;
}

/**
 * Validate all three settle parameters. Returns the list of
 * rejection reasons; empty means the call may be attempted.
 * Every parameter is checked for shell metacharacters, even
 * though the executor passes arguments as an argv array and
 * never through a shell: the check is the acceptance criterion,
 * not a workaround for a shell.
 */
export function validateSettleParams(proposedRecipient: string, proposedAmount: string, evidenceRef: string): string[] {
  const problems: string[] = [];
  if (!isValidAccountId(proposedRecipient)) {
    problems.push("proposed recipient is not a valid account id: " + proposedRecipient);
  }
  try {
    parseAmountU128(proposedAmount);
  } catch (e) {
    problems.push(String(e instanceof Error ? e.message : e));
  }
  if (evidenceRef.length === 0 || evidenceRef.length > 128) {
    problems.push("evidence_ref must be 1 to 128 characters");
  }
  for (const [name, value] of [
    ["proposed recipient", proposedRecipient],
    ["proposed amount", proposedAmount],
    ["evidence_ref", evidenceRef],
  ] as const) {
    if (containsShellMeta(value)) {
      problems.push(name + " contains a shell metacharacter");
    }
  }
  return problems;
}

export interface AttackObligation {
  obligation_id: string;
  recipient: string;
  amount: bigint;
  state: string;
}

export interface AttackPolicy {
  limit: bigint;
  funded: bigint;
  spent: bigint;
  reserved: bigint;
}

export interface AttackParams {
  proposedRecipient: string;
  proposedAmount: bigint;
  evidenceRef: string;
  expectedCode: ReasonCode;
}

/**
 * Headroom for new settlements, in token base units: the
 * smaller of limit and funded, minus spent and reserved.
 * Negative headroom is reported as zero, never as a negative
 * number: a policy that is already over its cap has no room.
 */
export function headroomFor(policy: AttackPolicy): bigint {
  const cap = policy.limit < policy.funded ? policy.limit : policy.funded;
  const used = policy.spent + policy.reserved;
  return used >= cap ? 0n : cap - used;
}

/**
 * Derive the exact settle parameters for one scenario from the
 * obligation and policy as read live from the chain. The caller
 * must have read both rows live; nothing here is guessed.
 * Throws when the scenario cannot produce its expected code
 * from this obligation (for example a budget attack on an
 * obligation whose recorded amount fits the headroom): the
 * runner refuses to fire a call that cannot prove the code,
 * instead of firing it and reporting a surprise.
 */
export function attackParams(
  scenario: AttackScenario,
  obligation: AttackObligation,
  policy: AttackPolicy,
): AttackParams {
  if (scenario === "recipient") {
    const wrong = obligation.recipient !== WRONG_RECIPIENT ? WRONG_RECIPIENT : WRONG_RECIPIENT_FALLBACK;
    return {
      proposedRecipient: wrong,
      proposedAmount: obligation.amount,
      evidenceRef: ATTACK_EVIDENCE_REF,
      expectedCode: EXPECTED_CODE.recipient,
    };
  }
  if (scenario === "terms") {
    if (obligation.amount >= U128_MAX) {
      throw new Error("terms attack needs a recorded amount below the u128 maximum");
    }
    return {
      proposedRecipient: obligation.recipient,
      proposedAmount: obligation.amount + 1n,
      evidenceRef: ATTACK_EVIDENCE_REF,
      expectedCode: EXPECTED_CODE.terms,
    };
  }
  if (scenario === "nonce") {
    return {
      proposedRecipient: obligation.recipient,
      proposedAmount: obligation.amount,
      evidenceRef: ATTACK_EVIDENCE_REF,
      expectedCode: EXPECTED_CODE.nonce,
    };
  }
  const headroom = headroomFor(policy);
  if (obligation.amount <= headroom) {
    throw new Error(
      "budget attack needs a recorded amount above the headroom (" +
        headroom.toString() +
        "), obligation amount is " +
        obligation.amount.toString(),
    );
  }
  return {
    proposedRecipient: obligation.recipient,
    proposedAmount: obligation.amount,
    evidenceRef: ATTACK_EVIDENCE_REF,
    expectedCode: EXPECTED_CODE.budget,
  };
}

export interface TranscriptRow {
  scenario: string;
  obligationId: string;
  proposedRecipient: string;
  proposedAmount: string;
  txHash: string;
  reasonCode: string;
  stateAfter: string;
  balanceBefore: string;
  balanceAfter: string;
  moved: string;
}

export function transcriptHeader(): string {
  return "| scenario | obligation | proposed recipient | proposed amount | tx hash | reason code | state after | balance before | balance after | moved |\n|---|---|---|---|---|---|---|---|---|---|";
}

export function formatTranscriptRow(row: TranscriptRow): string {
  return (
    "| " +
    row.scenario +
    " | " +
    row.obligationId +
    " | " +
    row.proposedRecipient +
    " | " +
    row.proposedAmount +
    " | " +
    row.txHash +
    " | " +
    row.reasonCode +
    " | " +
    row.stateAfter +
    " | " +
    row.balanceBefore +
    " | " +
    row.balanceAfter +
    " | " +
    row.moved +
    " |"
  );
}
