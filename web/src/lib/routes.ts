/* Cynex web, hash-route helpers. Pure functions, no React, no window:
   Jest covers them in node (frontend/src/route-smoke.test.ts) and
   App.tsx wires them to the live hash. */
export function parseHash(hash: string): string[] {
  return (hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
}

/* The old sandbox route moved to the Attack page; the effective route
   treats a legacy #/demo/sandbox link as #/attack, so no frame ever
   shows the Demo nav or the Demo title for it. */
export function effectiveRoute(route: string[]): string[] {
  return route[0] === "demo" && route[1] === "sandbox" ? ["attack"] : route;
}

export function pageForRoute(route: string[]): string {
  const r = effectiveRoute(route);
  /* Legacy #/landing is the Home page: normalize it so the Home nav link stays active. */
  const page = r[0] || "home";
  return page === "landing" ? "home" : page;
}

export function titleForPage(page: string): string {
  return page === "demo"
    ? "Demo, Cynex"
    : page === "attack"
      ? "Attack, Cynex"
      : page === "docs"
        ? "Docs, Cynex"
        : page === "proof"
          ? "Proof, Cynex"
          : "Home, Cynex";
}

/* A location with a replace method, the only part of window.location
   the redirect needs. location.replace swaps the current history entry
   instead of pushing a new one, so Back from Attack leaves the page
   instead of bouncing forward again through #/demo/sandbox. */
export interface HashLocation {
  hash: string;
  replace: (url: string) => void;
}

export function applySandboxRedirect(loc: HashLocation, route: string[]): boolean {
  if (route[0] === "demo" && route[1] === "sandbox") {
    loc.replace("#/attack");
    return true;
  }
  return false;
}
