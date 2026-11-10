/**
 * Route smoke test for the Cynex web app: #/attack renders Attack and
 * the legacy #/demo/sandbox link ends on #/attack without pushing a
 * history entry. The helpers live in web/src/lib/routes.ts (pure, no
 * React, no window) and App.tsx wires them to the live hash; this test
 * covers the helpers, which are the logic App runs.
 * Run: NODE_PATH=<absolute frontend/node_modules>
 *   NODE_OPTIONS=--experimental-vm-modules npx jest --roots src ../services --runInBand
 */
import {
  applySandboxRedirect,
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
  it("parses #/attack", function () {
    expect(parseHash("#/attack")).toEqual(["attack"]);
  });
  it("parses #/demo/sandbox", function () {
    expect(parseHash("#/demo/sandbox")).toEqual(["demo", "sandbox"]);
  });
  it("parses an empty hash and the root as no route", function () {
    expect(parseHash("")).toEqual([]);
    expect(parseHash("#/")).toEqual([]);
  });
});

describe("effectiveRoute", function () {
  it("treats the legacy sandbox route as attack", function () {
    expect(effectiveRoute(["demo", "sandbox"])).toEqual(["attack"]);
  });
  it("leaves every other route alone", function () {
    expect(effectiveRoute(["attack"])).toEqual(["attack"]);
    expect(effectiveRoute(["demo", "guided"])).toEqual(["demo", "guided"]);
    expect(effectiveRoute([])).toEqual([]);
  });
});

describe("pageForRoute and titleForPage", function () {
  it("the sandbox route pages as attack, never demo", function () {
    expect(pageForRoute(["demo", "sandbox"])).toBe("attack");
    expect(titleForPage(pageForRoute(["demo", "sandbox"]))).toBe("Attack, Cynex");
  });
  it("guided demo still pages as demo", function () {
    expect(pageForRoute(["demo", "guided"])).toBe("demo");
    expect(titleForPage("demo")).toBe("Demo, Cynex");
  });
  it("an empty route pages as home", function () {
    expect(pageForRoute([])).toBe("home");
    expect(titleForPage("home")).toBe("Home, Cynex");
    expect(titleForPage("docs")).toBe("Docs, Cynex");
    expect(titleForPage("proof")).toBe("Proof, Cynex");
  });
  it("the legacy #/landing route pages as home, so the Home nav link stays active", function () {
    expect(pageForRoute(["landing"])).toBe("home");
    expect(titleForPage(pageForRoute(["landing"]))).toBe("Home, Cynex");
  });
});

describe("applySandboxRedirect", function () {
  it("replaces the sandbox entry with #/attack and never assigns the hash", function () {
    const f = fakeLocation("#/demo/sandbox");
    expect(applySandboxRedirect(f.loc, ["demo", "sandbox"])).toBe(true);
    expect(f.replaced).toEqual(["#/attack"]);
    expect(f.getHash()).toBe("#/demo/sandbox");
  });
  it("does nothing for #/attack itself", function () {
    const f = fakeLocation("#/attack");
    expect(applySandboxRedirect(f.loc, ["attack"])).toBe(false);
    expect(f.replaced).toEqual([]);
  });
  it("does nothing for guided demo", function () {
    const f = fakeLocation("#/demo/guided");
    expect(applySandboxRedirect(f.loc, ["demo", "guided"])).toBe(false);
    expect(f.replaced).toEqual([]);
  });
});

describe("Back-button invariant after the sandbox redirect", function () {
  it("replace swaps the sandbox entry, so Back lands on the page before it, never on sandbox", function () {
    /* The browser history is modelled as a stack of hashes: location.replace
       swaps the top entry instead of pushing, which is exactly the behaviour
       applySandboxRedirect relies on. The redirect call itself is the real
       helper; only the history stack is a model, because Jest has no browser
       history to navigate and no App mount to drive a real Back press. What
       this test does NOT cover: an actual Back-button press in a browser.
       That behaviour was verified in headless Chromium, where Back from
       Attack after the redirect lands on Home with no bounce. */
    const entries = ["#/", "#/demo/sandbox"];
    const loc = {
      get hash() {
        return entries[entries.length - 1];
      },
      replace(url: string) {
        entries[entries.length - 1] = url;
      },
    };
    expect(applySandboxRedirect(loc, ["demo", "sandbox"])).toBe(true);
    expect(entries).toEqual(["#/", "#/attack"]);
    expect(pageForRoute(parseHash(entries[entries.length - 1]))).toBe("attack");
    expect(titleForPage(pageForRoute(parseHash(entries[entries.length - 1])))).toBe("Attack, Cynex");
    /* Back: pop the Attack entry. The entry underneath must be the page
       before the sandbox link, and the sandbox route must be gone. */
    entries.pop();
    expect(entries).toEqual(["#/"]);
    expect(pageForRoute(parseHash(entries[entries.length - 1]))).toBe("home");
    expect(entries).not.toContain("#/demo/sandbox");
  });
});
