/**
 * Tests for the cynex-mcp command line entry check (services/mcp/cli.ts).
 *
 * Regression test for the 0.1.0 bug: the published binary silently
 * exited 0 and did nothing when run via `npx cynex-mcp` or
 * `./node_modules/.bin/cynex-mcp`. The bin is a symlink to
 * dist/cynex-mcp.mjs, so process.argv[1] is the symlink path while
 * import.meta.url is the real file. The old entry check compared
 * them with strict equality, so it never matched for the symlink
 * and main() never ran. The fix resolves argv[1] through symlinks
 * first. The symlink test below fails on the old code and passes
 * on the new code.
 *
 * The spawn test runs the built binary through a symlink, the way
 * npm installs it, and asserts --help prints usage and --bogus
 * exits 1 with the unknown-arguments error. It builds dist first
 * when it is missing.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CLI_USAGE, isEntryPoint, parseCliArgs, resolveEntryPath } from "./cli.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("parseCliArgs", () => {
  it("returns server with no arguments", () => {
    expect(parseCliArgs([])).toBe("server");
  });

  it("returns sandbox for --sandbox", () => {
    expect(parseCliArgs(["--sandbox"])).toBe("sandbox");
  });

  it("returns help for --help and -h", () => {
    expect(parseCliArgs(["--help"])).toBe("help");
    expect(parseCliArgs(["-h"])).toBe("help");
  });

  it("throws on unknown arguments", () => {
    expect(() => parseCliArgs(["--bogus"])).toThrow("unknown arguments");
    expect(() => parseCliArgs(["--sandbox", "--help"])).toThrow("unknown arguments");
  });
});

describe("resolveEntryPath", () => {
  it("resolves a symlink to its real target", () => {
    const dir = mkdtempSync(join(tmpdir(), "cynex-cli-test-"));
    try {
      const target = join(dir, "real.mjs");
      writeFileSync(target, "export {};\n");
      const link = join(dir, "link.mjs");
      symlinkSync(target, link);
      expect(resolveEntryPath(link)).toBe(target);
      expect(resolveEntryPath(target)).toBe(target);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns the input unchanged when it cannot be resolved", () => {
    const missing = join(tmpdir(), "cynex-cli-missing-" + Date.now() + ".mjs");
    expect(resolveEntryPath(missing)).toBe(missing);
  });
});

describe("isEntryPoint through a symlink", () => {
  it("matches when argv[1] is a symlink to this module", () => {
    const dir = mkdtempSync(join(tmpdir(), "cynex-cli-entry-"));
    try {
      const target = join(dir, "cynex-mcp.mjs");
      writeFileSync(target, "export {};\n");
      const link = join(dir, "cynex-mcp");
      symlinkSync(target, link);
      const importMetaUrl = pathToFileURL(target).href;
      // The symlink path is not the real path, so a strict equality
      // check would fail here. The fix resolves the symlink first.
      expect(link).not.toBe(target);
      expect(isEntryPoint(link, importMetaUrl)).toBe(true);
      expect(isEntryPoint(target, importMetaUrl)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not match a different file", () => {
    const dir = mkdtempSync(join(tmpdir(), "cynex-cli-entry-"));
    try {
      const target = join(dir, "cynex-mcp.mjs");
      writeFileSync(target, "export {};\n");
      const other = join(dir, "other.mjs");
      writeFileSync(other, "export {};\n");
      const importMetaUrl = pathToFileURL(target).href;
      expect(isEntryPoint(other, importMetaUrl)).toBe(false);
      expect(isEntryPoint("", importMetaUrl)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not match a file whose name is not an entry name", () => {
    const dir = mkdtempSync(join(tmpdir(), "cynex-cli-entry-"));
    try {
      const target = join(dir, "library.mjs");
      writeFileSync(target, "export {};\n");
      const importMetaUrl = pathToFileURL(target).href;
      expect(isEntryPoint(target, importMetaUrl)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("built binary through a symlink", () => {
  const distBin = join(__dirname, "dist", "cynex-mcp.mjs");

  beforeAll(() => {
    if (!existsSync(distBin)) {
      spawnSync("npm", ["run", "build"], {
        cwd: __dirname,
        stdio: "ignore",
      });
    }
  });

  it("prints usage for --help when invoked through a symlink", () => {
    if (!existsSync(distBin)) {
      throw new Error("dist/cynex-mcp.mjs was not built, cannot test the symlink entry");
    }
    const dir = mkdtempSync(join(tmpdir(), "cynex-cli-spawn-"));
    try {
      const link = join(dir, "cynex-mcp");
      symlinkSync(distBin, link);
      const result = spawnSync(link, ["--help"], { encoding: "utf-8" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: cynex-mcp");
      expect(result.stdout).toContain(CLI_USAGE.split("\n")[0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 1 with the unknown-arguments error for --bogus through a symlink", () => {
    if (!existsSync(distBin)) {
      throw new Error("dist/cynex-mcp.mjs was not built, cannot test the symlink entry");
    }
    const dir = mkdtempSync(join(tmpdir(), "cynex-cli-spawn-"));
    try {
      const link = join(dir, "cynex-mcp");
      symlinkSync(distBin, link);
      const result = spawnSync(link, ["--bogus"], { encoding: "utf-8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("unknown arguments");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
