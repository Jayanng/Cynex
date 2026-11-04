/**
 * Near-sandbox integration harness, Phase 1 Lane B.
 *
 * The harness runs the real contract code, never a mock.
 * It looks for the Lane A contract wasm at
 * contract/target/wasm32-unknown-unknown/release/cynex_vault.wasm
 * (or CYNEX_WASM_PATH). If that file does not exist, the
 * harness exits with code 2 and a PENDING message: the
 * contract skeleton has not landed yet, so there is nothing
 * real to run, and the harness must not pretend otherwise.
 * Deployment of the wasm into a sandbox account, and the
 * forbidden-call checks from Phase 1, are wired in once the
 * wasm exists and its account is configured.
 */
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const DEFAULT_WASM_PATH =
  "contract/target/wasm32-unknown-unknown/release/cynex_vault.wasm";

export function wasmPath(): string {
  return process.env.CYNEX_WASM_PATH ?? DEFAULT_WASM_PATH;
}

export function main(): number {
  const path = wasmPath();
  if (!existsSync(path)) {
    console.log("PENDING: contract wasm not found at " + path);
    console.log("Contract source is present but no built wasm was found (cargo-near is not installed on this machine). No mock run was made.");
    return 2;
  }
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  console.log("FOUND: contract wasm at " + path);
  console.log("wasm sha256: " + hash);
  console.log("Sandbox deployment step is next, once the vault account is configured.");
  return 0;
}

if (import.meta.url === "file://" + process.argv[1]) {
  process.exitCode = main();
}
