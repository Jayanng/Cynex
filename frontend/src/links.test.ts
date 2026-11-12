/* Tests for the explorer link helper (web/src/lib/links.tsx): every
 * transaction hash, account, and obligation id on the site links out
 * to the NEAR testnet explorer, with the full value in the href and
 * only the display text truncated. Components are invoked directly
 * and their rendered anchor props asserted, no DOM needed. A
 * source-level wiring test at the bottom proves the pages and
 * components actually use these helpers, since Jest runs in node
 * with no DOM renderer. */

import { readFileSync } from "node:fs";

import {
  EXPLORER_BASE,
  TxLink,
  AccountLink,
  accountUrl,
  shortHash,
  txUrl,
} from "../../web/src/lib/links.js";

const HASH = "D7aRDckcLkt4FghZUGpAkrCLx677NAVjPYrWUvTM2EJe";
const ACCOUNT = "cynex-testvault.cynexmaster.testnet";

describe("EXPLORER_BASE", () => {
  it("points at the NEAR testnet explorer", () => {
    expect(EXPLORER_BASE).toBe("https://testnet.nearblocks.io");
  });
});

describe("txUrl", () => {
  it("builds the txns path for a transaction hash", () => {
    expect(txUrl(HASH)).toBe("https://testnet.nearblocks.io/txns/" + HASH);
  });
});

describe("accountUrl", () => {
  it("builds the address path for an account id", () => {
    expect(accountUrl(ACCOUNT)).toBe("https://testnet.nearblocks.io/address/" + ACCOUNT);
  });
});

describe("shortHash", () => {
  it("truncates to first 8, ellipsis, last 6", () => {
    expect(shortHash(HASH)).toBe("D7aRDckc...TM2EJe");
  });

  it("leaves a short value untouched", () => {
    expect(shortHash("abc")).toBe("abc");
    expect(shortHash("12345678901234")).toBe("12345678901234");
  });
});

describe("TxLink", () => {
  it("renders an anchor with the correct href, target _blank, and full hash text", () => {
    const el = TxLink({ hash: HASH });
    expect(el.type).toBe("a");
    expect(el.props.href).toBe("https://testnet.nearblocks.io/txns/" + HASH);
    expect(el.props.target).toBe("_blank");
    expect(el.props.rel).toBe("noopener");
    expect(el.props.className).toBe("hash");
    expect(el.props.children).toBe(HASH);
  });

  it("keeps the full hash in the href when the display text is truncated", () => {
    const el = TxLink({ hash: HASH, children: shortHash(HASH) });
    expect(el.props.href).toBe("https://testnet.nearblocks.io/txns/" + HASH);
    expect(el.props.children).toBe("D7aRDckc...TM2EJe");
  });
});

describe("AccountLink", () => {
  it("renders an anchor with the correct href, target _blank, and account text", () => {
    const el = AccountLink({ account: ACCOUNT });
    expect(el.type).toBe("a");
    expect(el.props.href).toBe("https://testnet.nearblocks.io/address/" + ACCOUNT);
    expect(el.props.target).toBe("_blank");
    expect(el.props.rel).toBe("noopener");
    expect(el.props.children).toBe(ACCOUNT);
  });

  it("renders given children instead of the account id", () => {
    const el = AccountLink({ account: ACCOUNT, children: "demo-live-005" });
    expect(el.props.href).toBe("https://testnet.nearblocks.io/address/" + ACCOUNT);
    expect(el.props.children).toBe("demo-live-005");
  });
});

describe("page and component wiring", () => {
  /* The helper tests above invoke TxLink and AccountLink directly, but
     that alone cannot prove the pages and components actually use them
     for the hashes and accounts they render. Jest runs in node with no
     DOM renderer, so this is a source-level assertion: each file that
     renders a transaction hash or an account must import the link
     helpers from ../lib/links and use them. Files that render no
     transaction hash (Docs, Strip, TamperPanel, ui) use AccountLink
     only, so TxLink is asserted only where a hash is rendered. */
  const TXLINK_FILES = [
    "web/src/pages/Home.tsx",
    "web/src/pages/Demo.tsx",
    "web/src/pages/Attack.tsx",
    "web/src/pages/Proof.tsx",
    "web/src/components/BreakIt.tsx",
    "web/src/components/LiveDemoButton.tsx",
  ];
  const ACCOUNTLINK_FILES = [
    ...TXLINK_FILES,
    "web/src/pages/Docs.tsx",
    "web/src/components/Strip.tsx",
    "web/src/components/TamperPanel.tsx",
    "web/src/components/ui.tsx",
  ];
  const source = (rel: string): string =>
    readFileSync(new URL("../../" + rel, import.meta.url), "utf8");

  it.each(TXLINK_FILES)("uses TxLink for its transaction hashes: %s", (rel: string) => {
    const src = source(rel);
    expect(src).toMatch(/import \{[^}]*\bTxLink\b[^}]*\} from "\.\.\/lib\/links"/);
    expect(src).toContain("<TxLink");
  });

  it.each(ACCOUNTLINK_FILES)("uses AccountLink for its accounts: %s", (rel: string) => {
    const src = source(rel);
    expect(src).toMatch(/import \{[^}]*\bAccountLink\b[^}]*\} from "\.\.\/lib\/links"/);
    expect(src).toContain("<AccountLink");
  });
});
