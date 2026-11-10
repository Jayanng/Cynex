/* The console. The product running: reputation gate, attack bench, budget
   guardrail, and the scoped key, all operable against testnet. */

import { useLive } from "../lib/live";
import { RECORD } from "../lib/record";
import { baseUnits } from "../lib/format";
import { KEY_LIMITS, ATTACKS } from "../lib/features";
import { RepGate } from "../components/RepGate";
import { AttackBench } from "../components/AttackBench";
import { GradeBadge, Panel, Stat, Unavailable, CommandBlock } from "../components/ui";
import { LiveStamp } from "../components/LiveStamp";

export function ConsolePage() {
  const live = useLive();
  const bal = live.balance;

  return (
    <section className="section" style={{ paddingTop: 48 }}>
      <div className="wrap">
        <div className="section-head">
          <p className="kicker">the live console</p>
          <h2 className="section-title">Everything here runs against testnet while you watch.</h2>
          <p className="section-lead">
            Run the reputation gate over any account. Fire the four attack scenarios at the vault. Read the
            budget the agent is spending against. Nothing is staged, and nothing on this page can move a token
            it should not.
          </p>
        </div>

        {/* live chain strip */}
        <div style={{ marginBottom: 14 }}>
          <LiveStamp label="vault state" />
        </div>
        <div className="grid grid-4" style={{ marginBottom: 28 }}>
          <Panel>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Stat value={live.block ? `#${live.block}` : "…"} label="NEAR testnet block" />
              <GradeBadge g="chain-read" />
            </div>
          </Panel>
          <Panel>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Stat
                value={bal ? baseUnits(bal.spent) : "…"}
                label={`spent of ${bal ? baseUnits(bal.limit) : "…"} limit`}
                tone="var(--accent-ink)"
              />
              <GradeBadge g="chain-read" />
            </div>
          </Panel>
          <Panel>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Stat value={live.receiptsTest.length || "…"} label="test vault receipts" tone="var(--pos-ink)" />
              <GradeBadge g="chain-read" />
            </div>
          </Panel>
          <Panel>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Stat value={live.agentUnits ? baseUnits(live.agentUnits) : "…"} label="agent token balance" />
              <GradeBadge g="chain-read" />
            </div>
          </Panel>
        </div>

        {/* reputation gate */}
        <div style={{ marginBottom: 24 }}>
          <RepGate />
        </div>

        {/* attack bench */}
        <div style={{ marginBottom: 24 }}>
          <AttackBench />
        </div>

        {/* budget guardrail + key limits */}
        <div className="grid grid-2">
          <Panel
            title="Budget guardrail"
            right={<span className="row" style={{ gap: 8 }}><span className="badge badge-accent">policy p6-001</span><GradeBadge g="chain-read" /></span>}
          >
            <p className="muted" style={{ marginTop: 0, fontSize: 14.5 }}>
              The contract checks spent plus reserved plus amount against the policy limit before any transfer.
              A breach is refused with no partial move. These numbers are read from the vault now.
            </p>
            {bal ? (
              <>
                <div className="spread" style={{ margin: "18px 0" }}>
                  <div>
                    <div className="big-num" style={{ color: "var(--accent-ink)" }}>{baseUnits(bal.spent)}</div>
                    <div className="stat-label">spent</div>
                  </div>
                  <div>
                    <div className="big-num">{baseUnits(bal.reserved)}</div>
                    <div className="stat-label">reserved</div>
                  </div>
                  <div>
                    <div className="big-num" style={{ color: "var(--pos-ink)" }}>{baseUnits(bal.limit)}</div>
                    <div className="stat-label">limit</div>
                  </div>
                </div>
                <div
                  style={{
                    height: 10,
                    borderRadius: 999,
                    background: "var(--surface-3)",
                    overflow: "hidden",
                    border: "1px solid var(--line-2)",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min((Number(bal.spent) / Number(bal.limit)) * 100, 100)}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, var(--accent), var(--accent-2))",
                    }}
                  />
                </div>
                <div className="row" style={{ gap: 8, marginTop: 12 }}>
                  <span className="mono muted" style={{ fontSize: 12 }}>
                    {baseUnits(bal.funded)} funded · headroom {baseUnits(bal.native_headroom)} NEAR
                  </span>
                </div>
              </>
            ) : (
              <Unavailable what="policy balances" />
            )}
          </Panel>

          <Panel title="The agent's key, and its limits" right={<GradeBadge g="repo" />}>
            <p className="muted" style={{ marginTop: 0, fontSize: 14.5 }}>
              A compromised agent can ask. It cannot decide. The key is scoped so tightly that even fully
              leaked it can only ask the vault to say no faster.
            </p>
            <div className="stack" style={{ marginTop: 8 }}>
              {KEY_LIMITS.map((k) => (
                <div key={k.label} className="spread" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 10 }}>
                  <div>
                    <div className="mono" style={{ fontSize: 13, color: "var(--ink)" }}>{k.value}</div>
                    <div className="muted" style={{ fontSize: 12.5 }}>{k.detail}</div>
                  </div>
                  <span className="badge">{k.label}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="note" style={{ maxWidth: 760, marginTop: 28 }}>
          <strong>Why nothing here can hurt anything.</strong> The live attack button, when configured, holds a
          function-call key scoped to one method on one vault on testnet with a small allowance. It can knock on
          the door. It cannot reach a wallet, cannot transfer tokens by itself, and cannot call anything but
          settle. {ATTACKS.length} attack paths, zero that can move funds the order does not name.
        </div>

        <CommandBlock
          label="replay the receipts the console just read"
          command={RECORD.commands.verifyTest}
          expected="every row verified, index contiguous, hash links intact"
        />
      </div>
    </section>
  );
}
