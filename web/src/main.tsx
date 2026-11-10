/* The dossier shell. Hash routing with redirects for the old slugs, a
   404 that keeps the stamp language, and the live hook driving every
   CHAIN READ on the site. */

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "@fontsource/spectral/latin-400.css";
import "@fontsource/spectral/latin-400-italic.css";
import "@fontsource/spectral/latin-500.css";
import "@fontsource/spectral/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/ibm-plex-mono/latin-600.css";

import { useLive } from "./lib/live";
import { parseHash, pageForRoute, titleForPage, applyLegacyRedirect, ROUTES } from "./lib/routes";
import { CaseBar } from "./components/CaseBar";
import { VerdictStamp } from "./components/ui";
import { CasePage } from "./pages/Case";
import { BreakPage } from "./pages/Break";
import { WalkthroughPage } from "./pages/Walkthrough";
import { RecordPage } from "./pages/Record";
import { NotesPage } from "./pages/Notes";

/* window.history.replaceState, exposed through the shape the route helpers
   accept, so legacy slugs are swapped in place and never pushed. */
const locShim = {
  get hash() {
    return window.location.hash;
  },
  replace(url: string) {
    // replaceState only. A hash assignment here would push a history entry
    // and the Back button would land on a dead legacy route.
    history.replaceState(null, "", url);
  },
};

function currentRoute(): string {
  const segs = parseHash(window.location.hash);
  applyLegacyRedirect(locShim, segs);
  return pageForRoute(parseHash(window.location.hash));
}

function NotFound({ route }: { route: string }) {
  return (
    <div className="page notfound">
      <p className="kicker">Case error</p>
      <h1 className="display" style={{ fontSize: "clamp(36px, 5vw, 56px)" }}>
        No such page.
      </h1>
      <VerdictStamp verdict="REFUSED" code={`ERR_ROUTE_UNKNOWN · ${route}`} />
      <p className="lede" style={{ marginTop: 24 }}>
        That URL is not in the file. Try the case, the bench, or the record.
      </p>
      <a className="btn btn-primary" href="#/case">
        Back to the case
      </a>
    </div>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-in">
        <div>
          Cynex · Pay the obligation. Not the prompt.
          <br />
          NEAR testnet demo. Test tokens have no value. No mainnet deployment is claimed.
        </div>
        <div>
          <a href="#/case">The case</a> · <a href="#/break">Break it</a> ·{" "}
          <a href="#/walkthrough">Walkthrough</a> · <a href="#/record">The record</a> ·{" "}
          <a href="#/notes">Notes</a>
        </div>
        <div>Every number graded. Every claim cited. Every errata published.</div>
      </div>
    </footer>
  );
}

function App() {
  const live = useLive();
  const [route, setRoute] = useState(currentRoute());

  useEffect(() => {
    const onHash = () => {
      const r = currentRoute();
      setRoute(r);
      document.title = titleForPage(r);
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const page =
    route === "case" ? (
      <CasePage live={live} />
    ) : route === "break" ? (
      <BreakPage live={live} />
    ) : route === "walkthrough" ? (
      <WalkthroughPage live={live} />
    ) : route === "record" ? (
      <RecordPage live={live} />
    ) : route === "notes" ? (
      <NotesPage />
    ) : (
      <NotFound route={route} />
    );

  return (
    <div className="shell">
      <CaseBar live={live} route={route} />
      <main>{page}</main>
      <Footer />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
