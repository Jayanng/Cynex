/* Cynex web, app shell.
   Hash routing matching the showcase URLs (#/landing, #/demo, #/docs,
   #/proof) so existing links keep working. The header and the live
   strip read from the same live store. */

import { useEffect, useState } from "react";
import { LiveProvider, useLive } from "./lib/live";
import { Landing } from "./pages/Landing";
import { Demo } from "./pages/Demo";
import { Docs } from "./pages/Docs";
import { Proof } from "./pages/Proof";
import { Logo } from "./components/Logo";

function parseRoute(): string[] {
  return (window.location.hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
}

function Header({ page }: { page: string }) {
  const { live } = useLive();
  const nettxt = live.blockHeight
    ? "Testnet \u00b7 " + String(live.blockHeight)
    : live.anyErr
      ? "Testnet \u00b7 retrying"
      : "Testnet";
  return (
    <header
      className="md:fixed md:top-0 md:left-0 md:right-0 z-50 border-b"
      style={{ background: "var(--bg)", borderColor: "var(--line)" }}
    >
      <div className="wrap flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2 md:flex-nowrap md:h-16 md:py-0">
        <a href="#/" className="flex items-center gap-3 flex-none">
          <Logo markSize={28} />
          <span className="hidden md:block text-xs dim2 leading-tight">
            purpose-bound settlement vault
          </span>
        </a>
        <nav className="flex items-center gap-1" id="mainnav">
          <a className={"navlink" + (page === "landing" ? " active" : "")} href="#/">
            Landing
          </a>
          <a className={"navlink" + (page === "demo" ? " active" : "")} href="#/demo/guided">
            Demo
          </a>
          <a className={"navlink" + (page === "docs" ? " active" : "")} href="#/docs">
            Docs
          </a>
          <a className={"navlink" + (page === "proof" ? " active" : "")} href="#/proof">
            Proof
          </a>
        </nav>
        <div className="netpill mono flex-none" title="Live RPC: test.rpc.fastnear.com">
          <span className={"livedot" + (live.anyErr ? " err" : "")} id="netdot"></span>
          <span id="nettxt">{nettxt}</span>
        </div>
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
      if (!p[2] && p[0] !== "docs") window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const page = route[0] || "landing";
  useEffect(() => {
    document.title =
      page === "demo"
        ? "Demo, Cynex"
        : page === "docs"
          ? "Docs, Cynex"
          : page === "proof"
            ? "Proof, Cynex"
            : "Cynex, Pay the obligation. Not the prompt.";
  }, [page]);

  return (
    <>
      <Header page={page} />
      <main className="md:pt-16 min-h-screen">
        {page === "demo" ? (
          <Demo mode={route[1] === "sandbox" ? "sandbox" : "guided"} anchor={route[2]} />
        ) : page === "docs" ? (
          <Docs active={route[1]} />
        ) : page === "proof" ? (
          <Proof />
        ) : (
          <Landing />
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
