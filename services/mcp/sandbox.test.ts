/**
 * Near-sandbox integration suite for the Cynex MCP server.
 *
 * Gated by CYNEX_SANDBOX_TESTS=1: the suite starts a local chain,
 * builds the wasms when missing, and runs the full flow, which takes
 * minutes on a first run and needs the sandbox binary download. The
 * default Jest run skips it with a note instead of failing on a
 * machine that never asked for it. Run it with:
 *
 *   CYNEX_SANDBOX_TESTS=1 npm run jest:sandbox
 *
 * The suite itself throws on the first failed expectation, naming the
 * exact on-chain values it saw. A failure is a failure, never a skip.
 */
import { runSandboxMcpSuite } from "./sandbox-harness.js";

const SANDBOX_TESTS = process.env.CYNEX_SANDBOX_TESTS === "1";

describe("sandbox MCP suite", () => {
  // A skipped test, not a passing one: when the flag is absent Jest
  // reports 1 skipped, so the default run never implies sandbox
  // coverage that did not execute.
  (SANDBOX_TESTS ? test : test.skip)(
    "spins up a local chain, deploys the vault, and runs the MCP tools",
    async () => {
        const result = await runSandboxMcpSuite();
      // near-sandbox 2.13.4 randomizes its chain id on every init
      // (test-chain-XXXXX); older builds report "sandbox". Either is
      // a local chain, never testnet or mainnet.
      expect(result.chainId).toMatch(/^(sandbox|test-chain-[A-Za-z0-9]+)$/);
      expect(result.vaultCodeHash).toBe("65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6");
      expect(result.checks.length).toBeGreaterThanOrEqual(10);
      expect(result.txHashes["mcp-001"]).toMatch(/^[A-Za-z0-9]{43,44}$/);
      expect(result.txHashes["negative-001"]).toMatch(/^[A-Za-z0-9]{43,44}$/);
      expect(result.txHashes["bootstrap-001"]).toMatch(/^[A-Za-z0-9]{43,44}$/);
      expect(result.txHashes["bootstrap-002"]).toMatch(/^[A-Za-z0-9]{43,44}$/);
      for (const check of result.checks) {
        console.log("SANDBOX CHECK " + check.name + ": " + check.detail);
      }
      for (const [name, hash] of Object.entries(result.txHashes)) {
        console.log("SANDBOX TX " + name + " " + hash);
      }
    },
    1_800_000,
  );
});
