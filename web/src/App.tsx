/* Cynex web, app shell.
   Hash routing matching the showcase URLs (#/, #/demo, #/attack, #/docs,
   #/proof) so existing links keep working. The header and the live
   strip read from the same live store. */

import { useEffect, useState } from "react";
import { LiveProvider } from "./lib/live";
import { Home } from "./pages/Home";
import { Demo } from "./pages/Demo";
import { Attack } from "./pages/Attack";
import { Docs } from "./pages/Docs";
import { Proof } from "./pages/Proof";
import { applySandboxRedirect, effectiveRoute, pageForRoute, parseHash, titleForPage } from "./lib/routes";

function parseRoute(): string[] {
  return parseHash(window.location.hash);
}

function Header({ page }: { page: string }) {
  const links: [string, string, string, string?][] = [
    ["home", "#/", "Home"],
    ["demo", "#/demo/guided", "Guided demo", "Guided walkthrough of the recorded demo, watch the story"],
    ["attack", "#/attack", "Break it", "Try to break the vault yourself, interactive playground"],
    ["docs", "#/docs", "Docs"],
    ["proof", "#/proof", "Proof"],
  ];
  return (
    <header className="site">
      <div className="wrap">
        <a href="#/" className="wordmark">
          CYNE<span>X</span>
        </a>
        <nav className="main" aria-label="Main">
          {links.map(([id, href, label, title]) => (
            <a key={id} className={page === id ? "here" : ""} href={href} title={title}>
              {label}
            </a>
          ))}
        </nav>
        <a href="#/attack/run" className="btn-run">
          Run it live
        </a>
      </div>
    </header>
  );
}

function Shell() {
  const [route, setRoute] = useState<string[]>(() => parseRoute());
  useEffect(() => {
    const onHash = () => {
      const p = parseRoute();
      setRoute(p);
      if (!p[2] && p[0] !== "docs" && !(p[0] === "attack" && p[1] === "run")) window.scrollTo(0, 0);
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
      <main id="main" className="min-h-screen">
        {page === "demo" ? (
          <Demo anchor={effRoute[2]} />
        ) : page === "attack" ? (
          <Attack anchor={effRoute[1]} />
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
