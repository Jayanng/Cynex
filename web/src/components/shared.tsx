/* Cynex web, shared page fragments.
   The footer, used on every page. */

import { REPO } from "../lib/data";

/* ---------- footer ---------- */
export function Footer() {
  return (
    <footer className="site">
      <div className="wrap">
        <div className="foot">
          <span className="wm">
            CYNE<span>X</span>
          </span>
          <span className="tag">Pay the obligation. Not the prompt.</span>
          <span className="fine">
            Purpose-bound settlement vault for AI agents · NEAR testnet
            <br />
            Live reads from the chain ·{" "}
            <a href={REPO} target="_blank" rel="noopener">
              github.com/Jayanng/Cynex
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
