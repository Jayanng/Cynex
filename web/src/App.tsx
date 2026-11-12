/* Cynex web, app shell.
   Hash routing matching the showcase URLs (#/, #/demo, #/attack, #/docs,
   #/proof) so existing links keep working. The header and the live
   strip read from the same live store. */

import { useEffect, useState } from "react";
import { LiveProvider, useLive } from "./lib/live";
import { Home } from "./pages/Home";
import { Demo } from "./pages/Demo";
import { Attack } from "./pages/Attack";
import { Docs } from "./pages/Docs";
import { Proof } from "./pages/Proof";
import { Logo } from "./components/Logo";
import { LiveDemoButton } from "./components/LiveDemoButton";
import { applySandboxRedirect, effectiveRoute, pageForRoute, parseHash, titleForPage } from "./lib/routes";

function parseRoute(): string[] {
  return parseHash(window.location.hash);
}

function Header({ page }: { page: string }) {
  const { live } = useLive();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
  }, [page]);
  const nettxt = live.blockHeight
    ? "Testnet \u00b7 " + String(live.blockHeight)
    : live.anyErr
      ? "Testnet \u00b7 retrying"
      : "Testnet";
  const links: [string, string, string, string?][] = [
    ["home", "#/", "Home"],
    ["demo", "#/demo/guided", "Guided demo", "Guided walkthrough of the recorded demo, watch the story"],
    ["attack", "#/attack", "Break it", "Try to break the vault yourself, interactive playground"],
    ["docs", "#/docs", "Docs"],
    ["proof", "#/proof", "Proof"],
  ];
  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 border-b"
      style={{ background: "var(--bg)", borderColor: "var(--line)" }}
    >
      <div className="wrap flex items-center justify-between gap-3 h-16">
        <a href="#/" className="flex items-center gap-3 flex-none">
          <Logo markSize={28} />
          <span className="hidden lg:block text-xs dim2 leading-tight">
            purpose-bound settlement vault
          </span>
        </a>
        <nav className="hidden md:flex items-center gap-1" id="mainnav">
          {links.map(([id, href, label, title]) => (
            <a key={id} className={"navlink" + (page === id ? " active" : "")} href={href} title={title}>
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2 flex-none">
          <span className="hidden md:block">
            <LiveDemoButton variant="nav" top={64} />
          </span>
          <div className="netpill mono" title="Live RPC: test.rpc.fastnear.com">
            <span className={"livedot" + (live.anyErr ? " err" : "")} id="netdot"></span>
            <span id="nettxt">{nettxt}</span>
          </div>
          <button
            type="button"
            className="mobile-menu-btn"
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              {menuOpen ? (
                <>
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </>
              ) : (
                <>
                  <path d="M4 7h16" />
                  <path d="M4 12h16" />
                  <path d="M4 17h16" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>
      {menuOpen ? (
        <nav
          className="md:hidden border-t wrap py-3 flex flex-col gap-1"
          style={{ borderColor: "var(--line2)", background: "var(--bg)" }}
          aria-label="Mobile navigation"
        >
          {links.map(([id, href, label]) => (
            <a key={id} className={"navlink" + (page === id ? " active" : "")} href={href} onClick={() => setMenuOpen(false)}>
              {label}
            </a>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

function Shell() {
  const [route, setRoute] = useState<string[]>(() => parseRoute());
  useEffect(() => {
    const onHash = () => {
      const p = parseRoute();
      setRoute(p);
      if (!p[2] && p[0] !== "docs") window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  /* The effective route treats a legacy #/demo/sandbox link as #/attack,
     so no frame ever shows the Demo nav or title for it. */
  const effRoute = effectiveRoute(route);
  const page = pageForRoute(route);
  /* The old sandbox route moved to the Attack page; keep the link working.
     replace swaps the history entry instead of pushing one, so Back from
     Attack leaves the page instead of bouncing forward again. */
  useEffect(() => {
    applySandboxRedirect(window.location, route);
  }, [route]);
  useEffect(() => {
    document.title = titleForPage(page);
  }, [page]);

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Header page={page} />
      <main id="main" className="pt-16 min-h-screen">
        {page === "demo" ? (
          <Demo anchor={effRoute[2]} />
        ) : page === "attack" ? (
          <Attack />
        ) : page === "docs" ? (
          <Docs active={route[1]} />
        ) : page === "proof" ? (
          <Proof />
        ) : (
          <Home />
        )}
      </main>
    </>
  );
}

export function App() {
  return (
    <LiveProvider>
      <Shell />
    </LiveProvider>
  );
}
