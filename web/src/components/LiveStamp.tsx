/* A live sync stamp. The point of this component is that no number should
   ever look like a placeholder: it says where it came from and when it was
   read, and it ticks. This is the visible proof that the data is live. */

import { useLive } from "../lib/live";
import { RPC_URL } from "../lib/chain";

export function LiveStamp({ label = "chain state" }: { label?: string }) {
  const live = useLive();
  return (
    <div
      className="row"
      style={{ gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-3)", flexWrap: "wrap" }}
    >
      <span className={`dot ${live.ok ? "live" : live.checkedAt ? "stale" : ""}`} />
      <span style={{ color: "var(--pos-text)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {live.ok ? "live" : "syncing"}
      </span>
      <span>·</span>
      <span>{label}</span>
      <span>·</span>
      <span title={RPC_URL}>read from NEAR testnet RPC</span>
      <span>·</span>
      <span>{live.checkedAt ? `synced ${live.checkedAt} UTC` : "reading…"}</span>
    </div>
  );
}
