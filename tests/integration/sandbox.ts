/**
 * Near-sandbox integration suite, standalone runner.
 *
 * This replaces the old stub, which only checked whether a wasm file
 * existed and never ran anything. This runner starts a real local
 * near-sandbox chain, deploys the real vault and token wasms, and
 * runs the real MCP server against them. See
 * services/mcp/sandbox-harness.ts for the full flow. The Jest suite
 * (services/mcp/sandbox.test.ts) runs the same flow with assertions.
 *
 * Run, from frontend/ after npm run mcp:build:
 *
 *   node dist-test/tests/integration/sandbox.js
 *
 * Or run the Jest suite:
 *
 *   CYNEX_SANDBOX_TESTS=1 npm run jest:sandbox
 *
 * Exit code 0 means every check passed; exit code 1 means the first
 * failed expectation, with the exact on-chain values in the message.
 * No mocks, no canned results: a failure is reported, never skipped.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { runSandboxMcpSuite } from "../../services/mcp/sandbox-harness.js";

async function main(): Promise<number> {
  try {
    const result = await runSandboxMcpSuite();
    console.log("SANDBOX SUITE PASSED");
    console.log("vault " + result.vaultId + " token " + result.tokenId);
    console.log("policy " + result.policyId + " code hash " + result.vaultCodeHash);
    for (const [name, hash] of Object.entries(result.txHashes)) {
      console.log("TX " + name + " " + hash);
    }
    return 0;
  } catch (error) {
    console.error(
      "SANDBOX SUITE FAILED: " + (error instanceof Error ? error.message : String(error)),
    );
    return 1;
  }
}

// Compare resolved file URLs, not the raw argv string: Node
// absolutizes argv[1] for the entry script, but a plain string
// comparison would silently skip the suite if it ever did not, and
// a skipped suite must never exit 0 looking like a pass.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(
        "sandbox suite failed: " + (error instanceof Error ? error.message : String(error)),
      );
      process.exitCode = 1;
    });
}
