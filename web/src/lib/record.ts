/* The citation ledger. Typed view over claims.json, the single source of
   truth for historical facts. check-claims.mjs re-verifies these against
   chain before the build ships. Nothing here is asserted from memory. */

import raw from "../claims.json";

export interface EventCite {
  id: string;
  label: string;
  verdict: "PAID" | "REFUSED" | "OK";
  errCode?: string;
  tx: string;
  receiptIndex?: number;
  obligationId: string;
  sentBy: string[];
}

export interface AttestationCite {
  bundle: string;
  request: number;
  vault: "test" | "prod";
}

export const RECORD = {
  vaults: raw.vaults as { test: string; prod: string },
  agent: raw.agent as string,
  token: raw.token as string,
  policy: raw.policy as string,
  codeHash: raw.codeHash as string,
  expectedReceipts: raw.expectedReceipts as { test: number; prod: number },
  obligation: raw.obligation as {
    id: string;
    recipient: string;
    amount: string;
    nonce: number;
    evidenceType: string;
  },
  events: raw.events as EventCite[],
  attestations: raw.attestations as AttestationCite[],
  commands: raw.commands as Record<string, string>,
  repoFacts: raw.repoFacts as {
    jest: { passed: number; skipped: number; suites: number; command: string };
    contractTests: { count: number; command: string };
    errorCodes: { defined: number; returnedBySettle: number };
  },
};

export function event(id: string): EventCite {
  const e = RECORD.events.find((x) => x.id === id);
  if (!e) throw new Error(`record missing event ${id}`);
  return e;
}

/** The four payloads a judge can throw at the vault. Three have real on-chain
    refusals in the record. The fourth is honest about being simulated. */
export interface Payload {
  id: string;
  name: string;
  attack: string;
  expectedCode: string;
  grade: "historical" | "simulated";
  eventId?: string;
  note: string;
}

export const PAYLOADS: Payload[] = [
  {
    id: "recipient",
    name: "Change the recipient",
    attack: "Send the money to a different account than the order names.",
    expectedCode: "ERR_RECIPIENT_SUBSTITUTION",
    grade: "historical",
    eventId: "refuse-recipient",
    note: "Executed on the test vault. The proposed recipient was the owner account. Zero tokens moved.",
  },
  {
    id: "amount",
    name: "Change the amount",
    attack: "Inflate the amount from 100 to 200 base units.",
    expectedCode: "ERR_TERMS_MISMATCH",
    grade: "historical",
    eventId: "refuse-amount",
    note: "Executed on the test vault. The order on chain says 100. The vault does not round up.",
  },
  {
    id: "replay",
    name: "Replay a nonce",
    attack: "Settle the same order twice and collect twice.",
    expectedCode: "ERR_NONCE_ALREADY_CONSUMED",
    grade: "historical",
    eventId: "refuse-replay",
    note: "Executed on the test vault. Every nonce pays exactly once, even when the first transfer fails.",
  },
  {
    id: "evidence",
    name: "Remove the evidence",
    attack: "Settle with no evidence against an obligation that demands some.",
    expectedCode: "ERR_INVALID_STATE",
    grade: "simulated",
    note:
      "Never executed on chain in the demo run. On the demo obligation, which is already PAID, a live settle would trip the nonce check first. The no-evidence case itself is ERR_INVALID_STATE on a pending obligation. Simulated, on purpose, and labelled as one.",
  },
];
