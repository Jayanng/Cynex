/* CaseBar: the file header. Sticky, mono, quiet. It carries the live block
   height so the judge always knows what chain they are reading. The nav is
   rendered from the routing table, one routing truth in the repo. */

import type { LiveState } from "../lib/live";
import { ROUTES } from "../lib/routes";
import { Unavailable } from "./ui";

export function CaseBar({ live, route }: { live: LiveState; route: string }) {
  return (
    <header className="casebar">
      <div className="casebar-in">
        <a className="casebar-mark" href="#/case">
          <span className="seal" aria-hidden="true" />
          Cynex
        </a>
        <nav className="casebar-nav" aria-label="Sections">
          {ROUTES.map((r) => (
            <a key={r.hash} href={r.hash} aria-current={route === r.page ? "page" : undefined}>
              {r.label}
            </a>
          ))}
        </nav>
        <div className="casebar-meta" title="Live block height, NEAR testnet">
          <span>
            <span className={`livedot ${live.ok ? "" : "stale"}`} aria-hidden="true" />
            {live.block
              ? `block ${live.block}`
              : live.checkedAt
                ? <Unavailable what="block height" />
                : <span className="td-mute">syncing…</span>}
          </span>
          <span>NEAR testnet</span>
        </div>
      </div>
    </header>
  );
}
