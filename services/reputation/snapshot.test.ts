/**
 * Snapshot tests,  frontend.
 *
 * Covers the snapshot format rules (every field required, a
 * missing account records a null code hash), the file naming, and
 * the earliest-first-seen selection. The files themselves are
 * written by the CLI snapshot command and read back here from a
 * temp directory, so the round trip is real, not a re-read of a
 * constant.
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  earliestFirstSeen,
  readSnapshots,
  snapshotFileName,
  takeSnapshot,
  type SnapshotFile,
} from "./snapshot.js";

describe("snapshot file naming", () => {
  it("names the file from the UTC fetch time", () => {
    expect(snapshotFileName("2026-11-06T06:00:00.000Z")).toBe("2026-11-06-060000Z.json");
  });
});

describe("takeSnapshot format rules", () => {
  it("rejects an existing account without a code hash", () => {
    expect(() =>
      takeSnapshot(
        [
          {
            account_id: "someone.testnet",
            exists: true,
            code_hash: null,
            block_height: 1,
            block_timestamp: 1,
            fetched_at: "2026-11-06T06:00:00.000Z",
          },
        ],
        "side-b",
        "https://test.rpc.fastnear.com",
        "2026-11-06T06:00:00.000Z",
      ),
    ).toThrow("code hash");
  });

  it("rejects a missing account with a non-null code hash", () => {
    expect(() =>
      takeSnapshot(
        [
          {
            account_id: "someone.testnet",
            exists: false,
            code_hash: "11111111111111111111111111111111",
            block_height: 1,
            block_timestamp: 1,
            fetched_at: "2026-11-06T06:00:00.000Z",
          },
        ],
        "side-b",
        "https://test.rpc.fastnear.com",
        "2026-11-06T06:00:00.000Z",
      ),
    ).toThrow("null code hash");
  });
});

describe("snapshot round trip and first seen", () => {
  const dir = join(tmpdir(), "cynex-p7-snapshot-test");

  beforeAll(() => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const first: SnapshotFile = takeSnapshot(
      [
        {
          account_id: "acme-supplies.testnet",
          exists: false,
          code_hash: null,
          block_height: 276444189,
          block_timestamp: 1793890000000000000,
          fetched_at: "2026-11-06T06:00:00.000Z",
        },
        {
          account_id: "cynex-agent.cynexmaster.testnet",
          exists: true,
          code_hash: "11111111111111111111111111111111",
          block_height: 276444189,
          block_timestamp: 1793890000000000000,
          fetched_at: "2026-11-06T06:00:00.000Z",
        },
      ],
      "side-b",
      "https://test.rpc.fastnear.com",
      "2026-11-06T06:00:00.000Z",
    );
    writeFileSync(join(dir, "2026-11-06-060000Z.json"), JSON.stringify(first, null, 2));
    const second: SnapshotFile = takeSnapshot(
      [
        {
          account_id: "cynex-agent.cynexmaster.testnet",
          exists: true,
          code_hash: "11111111111111111111111111111111",
          block_height: 276444300,
          block_timestamp: 1793890100000000000,
          fetched_at: "2026-11-06T07:00:00.000Z",
        },
      ],
      "side-b",
      "https://test.rpc.fastnear.com",
      "2026-11-06T07:00:00.000Z",
    );
    writeFileSync(join(dir, "2026-11-06-070000Z.json"), JSON.stringify(second, null, 2));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads entries for one account across files", () => {
    const entries = readSnapshots(dir, "cynex-agent.cynexmaster.testnet");
    expect(entries).toHaveLength(2);
    expect(entries[0].fetchedAt).toBe("2026-11-06T06:00:00.000Z");
    expect(entries[1].fetchedAt).toBe("2026-11-06T07:00:00.000Z");
    expect(entries[0].file).toContain("2026-11-06-060000Z.json");
  });

  it("earliest first seen is the first snapshot that shows the account existing", () => {
    const entries = readSnapshots(dir, "cynex-agent.cynexmaster.testnet");
    expect(earliestFirstSeen(entries)?.fetchedAt).toBe("2026-11-06T06:00:00.000Z");
  });

  it("an account no snapshot shows existing has no first seen", () => {
    const entries = readSnapshots(dir, "acme-supplies.testnet");
    expect(entries).toHaveLength(1);
    expect(entries[0].exists).toBe(false);
    expect(earliestFirstSeen(entries)).toBeNull();
  });

  it("a missing snapshot directory reads as no snapshots, not a failure", () => {
    expect(readSnapshots(join(dir, "no-such-dir"), "someone.testnet")).toEqual([]);
  });

  it("rejects a snapshot file missing a required field", () => {
    const badDir = join(tmpdir(), "cynex-p7-snapshot-bad");
    rmSync(badDir, { recursive: true, force: true });
    mkdirSync(badDir, { recursive: true });
    writeFileSync(
      join(badDir, "2026-11-06-060000Z.json"),
      JSON.stringify({ taken_by: "side-b", source_rpc: "https://test.rpc.fastnear.com" }),
    );
    expect(() => readSnapshots(badDir, "someone.testnet")).toThrow("missing");
    rmSync(badDir, { recursive: true, force: true });
  });
});
