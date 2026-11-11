/**
 * cynex-mcp command line: the published package entry point.
 *
 *   cynex-mcp            Serve the MCP server over stdio against testnet
 *                        (CYNEX_* environment, see services/mcp/README.md).
 *   cynex-mcp --sandbox  Start the local sandbox demo: a real local
 *                        chain with five seeded obligations, and serve
 *                        the MCP server over stdio against it. No
 *                        testnet, no live funds. The demo keeps running
 *                        until killed.
 *
 * The dispatch is a single flag on purpose: the demo is the same
 * server with the same six tools, pointed at a local chain by the
 * demo entry point, not a second server.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runDemo } from "./demo.js";
import { runServer } from "./server.js";

export type CliMode = "server" | "sandbox" | "help";

export const CLI_USAGE = [
  "Usage: cynex-mcp [--sandbox]",
  "",
  "  cynex-mcp            Serve the MCP server over stdio against testnet.",
  "  cynex-mcp --sandbox  Start the local sandbox demo and serve over stdio.",
  "  cynex-mcp --help     Show this usage.",
].join("\n");

/**
 * Parse the command line. Exactly one flag is accepted: --sandbox
 * runs the demo, --help prints usage, nothing runs the normal
 * server. --help counts only on its own: combined with any other
 * argument it is an error like anything else, so no flag is ever
 * silently ignored. Anything unknown is an error.
 */
export function parseCliArgs(argv: readonly string[]): CliMode {
  if (argv.length === 0) {
    return "server";
  }
  if (argv.length === 1 && argv[0] === "--sandbox") {
    return "sandbox";
  }
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return "help";
  }
  throw new Error(
    "cynex-mcp: unknown arguments: " + argv.join(" ") + ". " + CLI_USAGE,
  );
}

/**
 * Resolve a path to its real location, following symlinks. Returns
 * the input unchanged when it cannot be resolved, so a missing file
 * does not throw here; the entry check below then simply does not
 * match.
 */
export function resolveEntryPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * True when argv1 names this module as the process entry point.
 * The argv path is resolved first, because npm installs the bin as
 * a symlink (node_modules/.bin/cynex-mcp points at
 * dist/cynex-mcp.mjs), so argv[1] is the symlink path while
 * import.meta.url is the real file. Comparing the raw argv path
 * against import.meta.url fails for the symlink and main() never
 * runs, so the binary exits silently. Resolving first makes the
 * symlink and the direct path agree. The name check stays, so
 * importing this file as a library from a process whose argv
 * happens to name the entry file cannot auto-run main().
 */
export function isEntryPoint(argv1: string, importMetaUrl: string): boolean {
  if (argv1 === "") {
    return false;
  }
  const entry = resolveEntryPath(argv1);
  return (
    fileURLToPath(importMetaUrl) === entry &&
    (entry.endsWith("cli.js") ||
      entry.endsWith("cynex-mcp.mjs") ||
      entry.endsWith("cynex-mcp"))
  );
}

async function main(): Promise<number> {
  let mode: CliMode;
  try {
    mode = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (mode === "help") {
    console.log(CLI_USAGE);
    return 0;
  }
  if (mode === "sandbox") {
    return runDemo();
  }
  return runServer();
}

/**
 * Run main() only when this file is the entry point: directly as
 * cli.js, or as the bundled cynex-mcp bin. The check names the
 * entry file, not just import.meta.url, because the bundle inlines
 * server.ts and demo.ts too, and their own entry guards must stay
 * quiet when the bundle runs. The import.meta.url equality is kept
 * alongside the name check, so importing this file as a library
 * from a process whose argv happens to name the entry file cannot
 * auto-run main(). The argv path is resolved through symlinks
 * first, because the npm-installed bin is a symlink.
 */
const entry = process.argv[1] ?? "";
if (isEntryPoint(entry, import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(
        "cynex-mcp failed: " + (error instanceof Error ? error.message : String(error)),
      );
      process.exitCode = 1;
    });
}
