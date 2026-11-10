/* The Cynex live security console. Hash routing over routes.ts, a sticky
   nav with live chain status, and the four operable surfaces. */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme-cream.css";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

import { useRoute, Link, currentPath } from "./lib/nav";
import { ROUTES, titleForPage } from "./lib/routes";
import { LiveProvider, useLive } from "./lib/live";
import { RECORD } from "./lib/record";
import { Unavailable, Verdict } from "./components/ui";
import { Logo } from "./components/brand";
import { HomePage } from "./pages/Home";
import { ConsolePage } from "./pages/Console";
import { ToolsPage } from "./pages/Tools";
import { RecordPage } from "./pages/Record";

function Nav({ route }: { route: string }) {
  const live = useLive();
  return (
    <nav className="nav">
      <div className="nav-in">
        <Link to="/home" className="brand">
          <Logo size={26} />
        </Link>
        <div className="nav-links">
          {ROUTES.filter((r) => r.page !== "home" || true).map((r) => (
            <a key={r.hash} href={r.hash} aria-current={route === r.page ? "page" : undefined}>
              {r.label}
            </a>
          ))}
        </div>
        <div className="nav-right">
          <div className="nav-status" title="Live NEAR testnet state">
            <span className={`dot ${live.ok ? "live" : live.checkedAt ? "stale" : ""}`} />
            {live.block ? `block ${live.block}` : live.checkedAt ? <Unavailable what="block" /> : "syncing…"}
          </div>
          <a className="btn btn-primary" href="#/console" style={{ padding: "9px 16px", fontSize: 13.5 }}>
            Open console
          </a>
        </div>
      </div>
    </nav>
  );
}

function NotFound({ route }: { route: string }) {
  return (
    <section className="section" style={{ paddingTop: 80 }}>
      <div className="wrap" style={{ textAlign: "center", maxWidth: 560 }}>
        <p className="kicker" style={{ justifyContent: "center" }}>case error</p>
        <h2 className="section-title">No such page.</h2>
        <Verdict kind="REFUSED" code={`ERR_ROUTE_UNKNOWN · ${route}`} />
        <p className="section-lead" style={{ margin: "22px 0" }}>That URL is not in the file. Try the console or the record.</p>
        <a className="btn btn-primary" href="#/home">Back to the case</a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-in">
        <div>
          <div className="foot-brand">
            <Logo size={26} />
          </div>
          <p className="foot-tag">Pay the obligation. Not the prompt. A purpose-bound settlement vault for AI agents on NEAR.</p>
        </div>
        <div>
          <h5>surfaces</h5>
          <a href="#/home">The case</a>
          <a href="#/console">Live console</a>
          <a href="#/tools">MCP tools</a>
          <a href="#/record">The record</a>
        </div>
        <div>
          <h5>verify</h5>
          <a href={RECORD.commands.verifyTest.startsWith("node") ? "https://github.com/Jayanng/Cynex" : "#"}>
            Replay the receipts
          </a>
          <a href="https://testnet.nearblocks.io" target="_blank" rel="noreferrer">NEAR testnet explorer</a>
          <a href="https://github.com/Jayanng/Cynex" target="_blank" rel="noreferrer">Source</a>
        </div>
        <div className="foot-legal">
          <span>NEAR testnet demo · test tokens have no value · no mainnet deployment is claimed</span>
          <span>every number graded · every claim cited · every errata published</span>
        </div>
      </div>
    </footer>
  );
}

function App() {
  const route = useRoute();
  const page =
    route === "home" ? (
      <HomePage />
    ) : route === "console" ? (
      <ConsolePage />
    ) : route === "tools" ? (
      <ToolsPage />
    ) : route === "record" ? (
      <RecordPage />
    ) : (
      <NotFound route={route} />
    );

  return (
    <div className="shell">
      <Nav route={route} />
      <main style={{ flex: 1 }}>{page}</main>
      <Footer />
    </div>
  );
}

document.title = titleForPage(currentPath());
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LiveProvider>
      <App />
    </LiveProvider>
  </StrictMode>,
);
