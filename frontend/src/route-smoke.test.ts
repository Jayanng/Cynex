/**
 * Route smoke test for the Cynex web app: legacy slugs like #/demo/sandbox
 * land on their canonical page without pushing a history entry. The helpers
 * live in web/src/lib/routes.ts (pure, no React, no window) and lib/nav.tsx
 * wires them to the live hash; this test covers the helpers, which are the
 * logic the router runs.
 * Run: NODE_PATH=<absolute frontend/node_modules>
 *   NODE_OPTIONS=--experimental-vm-modules npx jest --roots src ../services --runInBand
 */
import {
  applyLegacyRedirect,
  effectiveRoute,
  pageForRoute,
  parseHash,
  titleForPage,
} from "../../web/src/lib/routes.js";

function fakeLocation(initialHash: string) {
  const replaced: string[] = [];
  let hash = initialHash;
  const loc = {
    get hash() {
      return hash;
    },
    set hash(v: string) {
      hash = v;
    },
    replace(url: string) {
      replaced.push(url);
    },
  };
  return { loc, replaced, getHash: () => hash };
}

describe("parseHash", function () {
  it("parses a single-segment route", function () {
    expect(parseHash("#/console")).toEqual(["console"]);
  });
  it("parses a legacy two-segment hash", function () {
    expect(parseHash("#/demo/sandbox")).toEqual(["demo", "sandbox"]);
  });
  it("parses an empty hash and the root as no route", function () {
    expect(parseHash("")).toEqual([]);
    expect(parseHash("#/")).toEqual([]);
  });
});

describe("effectiveRoute", function () {
  it("treats the legacy sandbox route as console", function () {
    expect(effectiveRoute(["demo", "sandbox"])).toEqual(["console"]);
  });
  it("treats the legacy root, case, and landing as home", function () {
    expect(effectiveRoute([])).toEqual(["home"]);
    expect(effectiveRoute(["case"])).toEqual(["home"]);
    expect(effectiveRoute(["landing"])).toEqual(["home"]);
  });
  it("leaves canonical routes alone", function () {
    expect(effectiveRoute(["console"])).toEqual(["console"]);
    expect(effectiveRoute(["tools"])).toEqual(["tools"]);
    expect(effectiveRoute(["record"])).toEqual(["record"]);
  });
});

describe("pageForRoute and titleForPage", function () {
  it("the sandbox route pages as console, never a legacy page", function () {
    expect(pageForRoute(["demo", "sandbox"])).toBe("console");
    expect(titleForPage(pageForRoute(["demo", "sandbox"]))).toBe("Live console, Cynex");
  });
  it("an empty route pages as home", function () {
    expect(pageForRoute([])).toBe("home");
    expect(titleForPage("home")).toBe("Cynex: Pay the obligation. Not the prompt.");
  });
  it("legacy docs and notes page as tools, walkthrough and proof as record", function () {
    expect(pageForRoute(["docs"])).toBe("tools");
    expect(pageForRoute(["notes"])).toBe("tools");
    expect(pageForRoute(["walkthrough"])).toBe("record");
    expect(pageForRoute(["proof"])).toBe("record");
  });
  it("unknown routes page as 404", function () {
    expect(pageForRoute(["nope"])).toBe("404");
    expect(titleForPage("404")).toBe("No such page, Cynex");
  });
});

describe("applyLegacyRedirect", function () {
  it("replaces the sandbox entry with #/console and never assigns the hash", function () {
    const f = fakeLocation("#/demo/sandbox");
    expect(applyLegacyRedirect(f.loc, ["demo", "sandbox"])).toBe(true);
    expect(f.replaced).toEqual(["#/console"]);
    expect(f.getHash()).toBe("#/demo/sandbox");
  });
  it("does nothing for a canonical route", function () {
    const f = fakeLocation("#/console");
    expect(applyLegacyRedirect(f.loc, ["console"])).toBe(false);
    expect(f.replaced).toEqual([]);
  });
  it("does nothing for a route with no legacy mapping", function () {
    const f = fakeLocation("#/tools");
    expect(applyLegacyRedirect(f.loc, ["tools"])).toBe(false);
    expect(f.replaced).toEqual([]);
  });
});

describe("Back-button invariant after the legacy redirect", function () {
  it("replace swaps the sandbox entry, so Back lands on the page before it, never on sandbox", function () {
    /* The browser history is modelled as a stack of hashes: location.replace
       swaps the top entry instead of pushing, which is exactly the behaviour
       applyLegacyRedirect relies on. The redirect call itself is the real
       helper; only the history stack is a model, because Jest has no browser
       history to navigate and no App mount to drive a real Back press. What
       this test does NOT cover: an actual Back-button press in a browser. */
    const entries = ["#/", "#/demo/sandbox"];
    const loc = {
      get hash() {
        return entries[entries.length - 1];
      },
      replace(url: string) {
        entries[entries.length - 1] = url;
      },
    };
    expect(applyLegacyRedirect(loc, ["demo", "sandbox"])).toBe(true);
    expect(entries).toEqual(["#/", "#/console"]);
    expect(pageForRoute(parseHash(entries[entries.length - 1]))).toBe("console");
    expect(titleForPage(pageForRoute(parseHash(entries[entries.length - 1])))).toBe("Live console, Cynex");
    /* Back: pop the console entry. The entry underneath must be the page
       before the sandbox link, and the sandbox route must be gone. */
    entries.pop();
    expect(entries).toEqual(["#/"]);
    expect(pageForRoute(parseHash(entries[entries.length - 1]))).toBe("home");
    expect(entries).not.toContain("#/demo/sandbox");
  });
});
