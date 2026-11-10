/* The routing engine. Pure helpers, no React, no window access except through
   the location-like object callers pass in. The app's router (nav.tsx) and its
   nav both run on this table, and the frontend suite smoke-tests the same
   helpers, so there is exactly one routing truth in the repo.

   Legacy slugs from earlier builds keep resolving. They are rewritten with
   history.replaceState semantics (the caller's loc.replace), never a pushed
   entry, so the Back button can never land on a dead route. */

export interface RouteDef {
  hash: string;
  page: string;
  title: string;
  label: string;
  legacy?: string[];
}

export const ROUTES: RouteDef[] = [
  {
    hash: "#/home",
    page: "home",
    title: "Cynex: Pay the obligation. Not the prompt.",
    label: "The case",
    legacy: ["#/", "#", "#/case", "#/landing"],
  },
  {
    hash: "#/console",
    page: "console",
    title: "Live console, Cynex",
    label: "Live console",
    legacy: ["#/attack", "#/demo/sandbox", "#/break"],
  },
  {
    hash: "#/tools",
    page: "tools",
    title: "MCP tools, Cynex",
    label: "MCP tools",
    legacy: ["#/docs", "#/notes"],
  },
  {
    hash: "#/record",
    page: "record",
    title: "The record, Cynex",
    label: "The record",
    legacy: ["#/proof", "#/demo", "#/demo/guided", "#/walkthrough"],
  },
];

/** Legacy alias table: hash string -> canonical hash string. */
const ALIASES: Record<string, string> = Object.fromEntries(
  ROUTES.flatMap((r) => (r.legacy ?? []).map((l) => [l, r.hash])),
);

/** "#/demo/sandbox" -> ["demo", "sandbox"]. "" and "#/" -> []. */
export function parseHash(hash: string): string[] {
  const clean = hash.replace(/^#\/?/, "").replace(/\/$/, "");
  return clean === "" ? [] : clean.split("/");
}

/** Map a parsed legacy route onto its canonical form. Everything that is
    not a known alias passes through untouched. */
export function effectiveRoute(segments: string[]): string[] {
  const hash = segments.length ? `#/${segments.join("/")}` : "#/";
  const target = ALIASES[hash];
  return target ? parseHash(target) : segments;
}

/** Canonical page id for a parsed route. Unknown routes page as "404",
    the empty route pages as "home". */
export function pageForRoute(segments: string[]): string {
  const eff = effectiveRoute(segments);
  if (eff.length === 0) return "home";
  const hit = ROUTES.find((r) => parseHash(r.hash)[0] === eff[0]);
  return hit ? hit.page : "404";
}

export function titleForPage(page: string): string {
  const hit = ROUTES.find((r) => r.page === page);
  return hit ? hit.title : "No such page, Cynex";
}

/** True when the current hash is a legacy alias and has been replaced in
    place with its canonical target. The caller's loc.replace must be the
    platform's history.replaceState path, never a hash assignment, so the
    history stack keeps its shape and Back lands on the previous real page. */
export function applyLegacyRedirect(loc: { hash: string; replace(url: string): void }, segments: string[]): boolean {
  const hash = segments.length ? `#/${segments.join("/")}` : "#/";
  const target = ALIASES[hash];
  if (!target || target === hash) return false;
  loc.replace(target);
  return true;
}
