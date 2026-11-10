/* The evidence grade: provenance for every claim the site renders.
   No ungraded number exists in this system. The Figure component enforces it. */

export type Grade =
  | "chain-read"
  | "historical"
  | "simulated"
  | "attested"
  | "repo"
  | "errata";

export const GRADE_LABEL: Record<Grade, string> = {
  "chain-read": "CHAIN READ",
  historical: "HISTORICAL",
  simulated: "SIMULATED",
  attested: "ATTESTED",
  repo: "REPO",
  errata: "ERRATA",
};

export const GRADE_TITLE: Record<Grade, string> = {
  "chain-read": "Fetched live from NEAR RPC during this session.",
  historical:
    "A past on-chain event. Cited with its transaction hash and linked to the explorer.",
  simulated: "Computed in your browser. No chain write happened. Never presented as on-chain.",
  attested: "Backed by an attestation bundle committed in the repo. Verify it yourself.",
  repo: "A fact from the repository itself, checkable by anyone with the checkout.",
  errata: "A known caveat is attached to this item. Read the note.",
};
