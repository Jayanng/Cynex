/* Cynex web, app shell.
   Hash routing matching the showcase URLs (#/, #/demo, #/attack, #/docs,
   #/proof) so existing links keep working. The header and the live
   strip read from the same live store. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

function Header({ page, headerRef, headerHeight }: { page: string; headerRef: React.RefObject<HTMLElement | null>; headerHeight: number | null }) {
  const { live } = useLive();
  const nettxt = live.blockHeight
    ? "Testnet \u00b7 " + String(live.blockHeight)
    : live.anyErr
      ? "Testnet \u00b7 retrying"
      : "Testnet";
  return (
    <header
      ref={headerRef}
      className="fixed top-0 left-0 right-0 z-50 border-b"
      style={{ background: "var(--bg)", borderColor: "var(--line)" }}
    >
      <div className="wrap flex flex-nowrap items-center justify-between gap-x-4 h-16 overflow-x-auto">
        <a href="#/" className="flex items-center gap-3 flex-none">
          <Logo markSize={28} />
          <span className="hidden lg:block text-xs dim2 leading-tight">
            purpose-bound settlement vault
          </span>
          <span className="hidden sm:flex items-center gap-2 text-xs dim2">
            <span className="livedot"></span>Testnet live
          </span>
        </a>
        <nav className="flex flex-nowrap items-center gap-1 flex-none" id="mainnav">
          <a className={"navlink" + (page === "home" ? " active" : "")} href="#/">
            Home
          </a>
          <a
            className={"navlink" + (page === "demo" ? " active" : "")}
            href="#/demo/guided"
            title="Guided walkthrough of the recorded demo, watch the story"
          >
            Guided demo
          </a>
          <a
            className={"navlink" + (page === "attack" ? " active" : "")}
            href="#/attack"
            title="Try to break the vault yourself, interactive playground"
          >
            Break it
          </a>
          <a className={"navlink" + (page === "docs" ? " active" : "")} href="#/docs">
            Docs
          </a>
          <a className={"navlink" + (page === "proof" ? " active" : "")} href="#/proof">
            Proof
          </a>
        </nav>
        <div className="flex items-center gap-2 flex-none">
          <LiveDemoButton variant="nav" top={headerHeight ?? undefined} />
          <div className="netpill mono flex-none" title="Live RPC: test.rpc.fastnear.com">
            <span className={"livedot" + (live.anyErr ? " err" : "")} id="netdot"></span>
            <span id="nettxt">{nettxt}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

function Shell() {
  const [route, setRoute] = useState<string[]>(() => parseRoute());
  /* The header is fixed, so main needs top padding equal to its real
     height. Measure it before paint: on narrow screens the header used
     to wrap taller than its fixed height, and a hardcoded offset hid
     content under it. The height starts unset, so no hardcoded fallback
     is ever used. The nav result toast uses the same height, so it never
     overlaps the header. */
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerH, setHeaderH] = useState<number | null>(null);
  /* Measure before paint, so the first frame already uses the real height. */
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderH(el.offsetHeight);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
      <Header page={page} headerRef={headerRef} headerHeight={headerH} />
      <main id="main" className="min-h-screen" style={{ paddingTop: headerH ?? undefined }}>
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
