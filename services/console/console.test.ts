/**
 * Console evidence wiring tests, frontend. The console
 * branches on evidence_type (agent/console.ts): PREIMAGE calls
 * submit_evidence_preimage with the artifact bytes as a JSON
 * number array (owner as courier, no verifier key), TEE calls
 * request_tee_verification with the evidence URL at 300 TGas
 * prepaid, anything else keeps the verifier submit_evidence
 * path. These are pure-function tests; the live proof is the
 * acceptance audit, which runs the console against the test
 * vault with real keys.
 */
import {
  EVIDENCE_TIMEOUT_NS,
  PREIMAGE_MAX_BYTES,
  TEE_CALL_GAS,
  consoleCalls,
  createObligationArgs,
  evidenceBranch,
  isHttpUrl,
  pollTee,
} from "../../agent/console.js";
import type { ObligationFile } from "../../agent/console.js";
import type { CynexClient } from "../../frontend/src/cynex/client.js";

function obligationFile(evidenceType: string, evidenceRef: string): ObligationFile {
  return {
    obligation_id: "p9-test-001",
    policy_id: "p6-001",
    recipient: "cynex-agent.cynexmaster.testnet",
    amount: "100",
    evidence_type: evidenceType,
    evidence_hash: "00".repeat(32),
    expires_at_ns: "1893456000000000000",
    nonce: "9101",
    evidence_ref: evidenceRef,
  };
}

describe("evidenceBranch", () => {
  test("PREIMAGE and TEE take their own paths", () => {
    expect(evidenceBranch("PREIMAGE")).toBe("PREIMAGE");
    expect(evidenceBranch("TEE")).toBe("TEE");
  });

  test("anything else keeps the verifier path", () => {
    expect(evidenceBranch("delivery-note")).toBe("VERIFIER");
    expect(evidenceBranch("TRUSTED_RELAYER")).toBe("VERIFIER");
    expect(evidenceBranch("")).toBe("VERIFIER");
  });
});

describe("isHttpUrl", () => {
  test("http and https URLs pass", () => {
    expect(isHttpUrl("https://example.test/artifact.bin")).toBe(true);
    expect(isHttpUrl("http://127.0.0.1:8080/a")).toBe(true);
  });

  test("anything else fails closed", () => {
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl("sample-demo")).toBe(false);
    expect(isHttpUrl("ftp://example.test/a")).toBe(false);
    expect(isHttpUrl("https://example.test/a b")).toBe(false);
  });
});

describe(" constants", () => {
  test("TEE prepaid gas is 300 TGas, the live-proof figure", () => {
    expect(TEE_CALL_GAS).toBe(300000000000000n);
  });

  test("the preimage cap is 64 KiB", () => {
    expect(PREIMAGE_MAX_BYTES).toBe(65536);
  });

  test("the evidence timeout is 1 hour in nanoseconds", () => {
    expect(EVIDENCE_TIMEOUT_NS).toBe(3600000000000n);
  });
});

describe("consoleCalls", () => {
  test("PREIMAGE calls submit_evidence_preimage as the owner", () => {
    const calls = consoleCalls("cynex-testvault.cynexmaster.testnet", obligationFile("PREIMAGE", "sample-evidence"));
    const evidence = calls[3] as Record<string, unknown>;
    expect(evidence.account).toBe("owner");
    expect(evidence.methodName).toBe("submit_evidence_preimage");
    const args = evidence.args as Record<string, unknown>;
    expect(args.obligation_id).toBe("p9-test-001");
    expect(args.request_id).toBe("<pending_request_id read from chain>");
    expect(typeof args.evidence).toBe("string");
  });

  test("TEE calls request_tee_verification as the owner at 300 TGas", () => {
    const calls = consoleCalls("cynex-testvault.cynexmaster.testnet", obligationFile("TEE", "https://example.test/artifact.bin"));
    const evidence = calls[3] as Record<string, unknown>;
    expect(evidence.account).toBe("owner");
    expect(evidence.methodName).toBe("request_tee_verification");
    expect(evidence.gas).toBe("300 TGas");
    const args = evidence.args as Record<string, unknown>;
    expect(args.obligation_id).toBe("p9-test-001");
    expect(args.evidence_url).toBe("https://example.test/artifact.bin");
  });

  test("the verifier path is unchanged for other evidence types", () => {
    const calls = consoleCalls("cynex-testvault.cynexmaster.testnet", obligationFile("delivery-note", "sample-demo"));
    const evidence = calls[3] as Record<string, unknown>;
    expect(evidence.account).toBe("verifier");
    expect(evidence.methodName).toBe("submit_evidence");
    const args = evidence.args as Record<string, unknown>;
    expect(args.result).toBe("ALLOWED");
  });

  test("all three branches still list the same nine calls", () => {
    for (const type of ["PREIMAGE", "TEE", "delivery-note"]) {
      const calls = consoleCalls("cynex-testvault.cynexmaster.testnet", obligationFile(type, "https://example.test/a"));
      expect(calls).toHaveLength(9);
      expect(calls[0]?.methodName).toBe("create_obligation");
      expect(calls[6]?.methodName).toBe("settle");
    }
  });
});

describe("pollTee", () => {
  function stubClient(row: Record<string, unknown> | null): CynexClient {
    return { getObligation: async () => row } as unknown as CynexClient;
  }

  test("returns the row as soon as it is READY", async () => {
    const row = { state: "READY", evidence_requested_at_ns: Date.now() * 1000000 };
    const out = await pollTee(stubClient(row), "p9-test-001", 3, 0);
    expect(out).toBe(row);
  });

  test("returns null when the evidence window has closed", async () => {
    const twoHoursAgoNs = Date.now() * 1000000 - 2 * 3600000000000;
    const row = { state: "EVIDENCE_PENDING", evidence_requested_at_ns: twoHoursAgoNs };
    const out = await pollTee(stubClient(row), "p9-test-001", 3, 0);
    expect(out).toBeNull();
  });
});

describe("createObligationArgs expires_at_ns (audit finding 6-2)", () => {
  function fileWithExpiry(expiresAtNs: string): ObligationFile {
    return {
      ...obligationFile("PREIMAGE", "sample-evidence"),
      expires_at_ns: expiresAtNs,
    };
  }

  test("an arbitrary nanosecond timestamp (now + 1h) is accepted", () => {
    const expiry = (BigInt(Date.now()) * 1000000n + 3600000000000n) | 1n;
    const args = createObligationArgs(fileWithExpiry(expiry.toString()));
    expect(typeof args.expires_at_ns).toBe("number");
    const drift = BigInt(args.expires_at_ns) - expiry;
    const absDrift = drift < 0n ? -drift : drift;
    expect(absDrift <= 1000n).toBe(true);
  });

  test("exactly representable values still pass through unchanged", () => {
    const args = createObligationArgs(fileWithExpiry("1893456000000000000"));
    expect(BigInt(args.expires_at_ns).toString()).toBe("1893456000000000000");
  });

  test("an invalid expiry throws", () => {
    for (const bad of ["abc", "-1", "", "18446744073709551616", "1.5"]) {
      expect(() => createObligationArgs(fileWithExpiry(bad))).toThrow();
    }
  });

  test("an expiry that rounds to 2^64 still throws", () => {
    expect(() =>
      createObligationArgs(fileWithExpiry("18446744073709551615")),
    ).toThrow("outside the u64 range");
  });

  test("the tie value 2^64 - 1024 throws and 2^64 - 1025 rounds down", () => {
    expect(() =>
      createObligationArgs(fileWithExpiry("18446744073709550592")),
    ).toThrow("outside the u64 range");
    const args = createObligationArgs(fileWithExpiry("18446744073709550591"));
    expect(BigInt(args.expires_at_ns).toString()).toBe("18446744073709549568");
  });

  test("the largest exactly representable u64 below 2^64 is accepted", () => {
    const args = createObligationArgs(fileWithExpiry("18446744073709549568"));
    expect(BigInt(args.expires_at_ns).toString()).toBe("18446744073709549568");
  });

  test("amount and nonce still require exact representability", () => {
    const over = "9007199254740993";
    expect(() =>
      createObligationArgs({ ...obligationFile("PREIMAGE", "sample-evidence"), amount: over }),
    ).toThrow("not exactly representable");
    expect(() =>
      createObligationArgs({ ...obligationFile("PREIMAGE", "sample-evidence"), nonce: over }),
    ).toThrow("not exactly representable");
  });
});
