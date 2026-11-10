/**
 * Route smoke test for the Cynex web app: legacy slugs like #/demo/sandbox
 * land on their canonical page without pushing a history entry. The helpers
 * live in web/src/lib/routes.ts (pure, no React, no window) and main.tsx
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
  it("parses #/break", function () {
    expect(parseHash("#/break")).toEqual(["break"]);
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
  it("treats the legacy sandbox route as break", function () {
    expect(effectiveRoute(["demo", "sandbox"])).toEqual(["break"]);
  });
  it("treats the legacy root and landing as case", function () {
    expect(effectiveRoute([])).toEqual(["case"]);
    expect(effectiveRoute(["landing"])).toEqual(["case"]);
  });
  it("leaves canonical routes alone", function () {
    expect(effectiveRoute(["break"])).toEqual(["break"]);
    expect(effectiveRoute(["walkthrough"])).toEqual(["walkthrough"]);
    expect(effectiveRoute(["record"])).toEqual(["record"]);
  });
});

describe("pageForRoute and titleForPage", function () {
  it("the sandbox route pages as break, never a legacy page", function () {
    expect(pageForRoute(["demo", "sandbox"])).toBe("break");
    expect(titleForPage(pageForRoute(["demo", "sandbox"]))).toBe("Break it, Cynex");
  });
  it("the guided demo pages as walkthrough", function () {
    expect(pageForRoute(["demo", "guided"])).toBe("walkthrough");
    expect(titleForPage("walkthrough")).toBe("Walkthrough, Cynex");
  });
  it("an empty route pages as case", function () {
    expect(pageForRoute([])).toBe("case");
    expect(titleForPage("case")).toBe("The case, Cynex");
  });
  it("legacy proof and docs pages as record and notes", function () {
    expect(pageForRoute(["proof"])).toBe("record");
    expect(pageForRoute(["docs"])).toBe("notes");
  });
  it("unknown routes page as 404", function () {
    expect(pageForRoute(["nope"])).toBe("404");
    expect(titleForPage("404")).toBe("No such page, Cynex");
  });
});

describe("applyLegacyRedirect", function () {
  it("replaces the sandbox entry with #/break and never assigns the hash", function () {
    const f = fakeLocation("#/demo/sandbox");
    expect(applyLegacyRedirect(f.loc, ["demo", "sandbox"])).toBe(true);
    expect(f.replaced).toEqual(["#/break"]);
    expect(f.getHash()).toBe("#/demo/sandbox");
  });
  it("does nothing for a canonical route", function () {
    const f = fakeLocation("#/break");
    expect(applyLegacyRedirect(f.loc, ["break"])).toBe(false);
    expect(f.replaced).toEqual([]);
  });
  it("does nothing for a legacy alias that is already canonical", function () {
    const f = fakeLocation("#/walkthrough");
    expect(applyLegacyRedirect(f.loc, ["walkthrough"])).toBe(false);
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
    expect(entries).toEqual(["#/", "#/break"]);
    expect(pageForRoute(parseHash(entries[entries.length - 1]))).toBe("break");
    expect(titleForPage(pageForRoute(parseHash(entries[entries.length - 1])))).toBe("Break it, Cynex");
    /* Back: pop the Break entry. The entry underneath must be the page
       before the sandbox link, and the sandbox route must be gone. */
    entries.pop();
    expect(entries).toEqual(["#/"]);
    expect(pageForRoute(parseHash(entries[entries.length - 1]))).toBe("case");
    expect(entries).not.toContain("#/demo/sandbox");
  });
});
