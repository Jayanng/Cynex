#!/usr/bin/env bash
# verify-tee-attestation.sh -- verify a Cynex TEE execution's TDX attestation.
#
# Two modes:
#   --bundle <file>  Re-check a saved proof bundle. Fully offline, no network.
#   --tx <hash>      Fetch the attestation for a NEAR transaction hash from
#                    the live OutLayer testnet API and verify it.
#
# The vault does not verify the TDX quote on chain, by design: on-chain
# TDX verification is infeasible on NEAR. This script is the off-chain
# check, and it prints PASS only when outlayer-verify exits 0.
#
# A note on the VRF signature, so nobody over-reads it: the VRF signature
# proves the output was not re-rolled and binds the signature to the
# pending request. It does NOT prove a TEE executed the guest. The TDX
# quote is what proves the guest ran inside a genuine enclave, and this
# script verifies the quote.

set -euo pipefail

API_TESTNET="https://testnet-api.outlayer.ai"
API_MAINNET="https://api.outlayer.ai"
FMSPC="b0c06f000000"
INSTALL_CMD="cargo install --git https://github.com/out-layer/outlayer-verify outlayer-verify"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SHIPPED_COLLATERAL="${REPO_ROOT}/docs/attestation-proofs/collateral-fmspc-b0c06f000000-2026-11-08.json"

usage() {
  cat <<EOF
Usage:
  $(basename "$0") --bundle <proof-bundle.json>   verify a saved bundle, offline
  $(basename "$0") --tx <near-tx-hash>            verify live from a transaction hash
EOF
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

check_deps() {
  if ! command -v outlayer-verify >/dev/null 2>&1; then
    printf 'outlayer-verify is not installed.\n' >&2
    printf 'Install it with:\n  %s\n' "$INSTALL_CMD" >&2
    exit 3
  fi
  for dep in python3 mktemp; do
    if ! command -v "$dep" >/dev/null 2>&1; then
      printf 'FAIL: required tool %s is not installed.\n' "$dep" >&2
      exit 3
    fi
  done
}

check_live_deps() {
  for dep in curl grep; do
    if ! command -v "$dep" >/dev/null 2>&1; then
      fail "required tool $dep is not installed"
    fi
  done
}

# Print a one-line summary of a --json verifier result, best effort.
# Never fails: a bad summary must not change the verification verdict.
summarise() {
  python3 - "$1" <<'PYEOF' || true
import json, sys
raw = open(sys.argv[1]).read()
start = raw.find("{")
if start < 0:
    print(raw.strip())
    sys.exit(0)
try:
    d = json.loads(raw[start:])
except Exception:
    print(raw.strip())
    sys.exit(0)
parts = []
for key in ("authenticity", "identity", "binding", "input", "output"):
    v = d.get(key)
    if isinstance(v, dict):
        parts.append(key + "=" + str(v.get("verdict", "?")))
if parts:
    print("  " + ", ".join(parts))
    tcb = d.get("collateral", {})
    if isinstance(tcb, dict) and tcb.get("valid_from"):
        print("  collateral window: " + str(tcb.get("valid_from")) + " .. " + str(tcb.get("valid_until")))
else:
    print(raw.strip())
PYEOF
}

verify_bundle() {
  local bundle="$1"
  [ -f "$bundle" ] || fail "bundle not found: $bundle"
  local out rc
  out="$(mktemp)"
  if outlayer-verify bundle "$bundle" --offline --json >"$out" 2>"$out.err"; then
    printf 'PASS: %s verified offline, exit 0\n' "$bundle"
    summarise "$out"
    rm -f "$out" "$out.err"
    return 0
  else
    rc=$?
    printf 'FAIL: %s did not verify, exit %s\n' "$bundle" "$rc" >&2
    cat "$out" "$out.err" >&2
    rm -f "$out" "$out.err"
    return 1
  fi
}

# True when the shipped collateral file covers the given unix timestamp.
shipped_covers() {
  local exec_ts="$1"
  [ -f "$SHIPPED_COLLATERAL" ] || return 1
  python3 - "$SHIPPED_COLLATERAL" "$exec_ts" <<'PYEOF'
import json, sys
from datetime import datetime, timezone

def epoch(s):
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())

d = json.load(open(sys.argv[1]))
tcb = json.loads(d["tcb_info"])
ts = int(sys.argv[2])
sys.exit(0 if epoch(tcb["issueDate"]) <= ts < epoch(tcb["nextUpdate"]) else 1)
PYEOF
}

# True when a collateral API wrapper says its window covers the timestamp.
wrapper_covers() {
  local wrapper="$1"
  local exec_ts="$2"
  python3 - "$wrapper" "$exec_ts" <<'PYEOF'
import json, sys
from datetime import datetime, timezone

def epoch(s):
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())

w = json.load(open(sys.argv[1]))
ts = int(sys.argv[2])
if w.get("covers_requested_time") is True:
    sys.exit(0)
vf = w.get("valid_from")
vu = w.get("valid_until")
if vf and vu and epoch(vf) <= ts < epoch(vu):
    sys.exit(0)
sys.exit(1)
PYEOF
}

verify_tx() {
  local hash="$1"
  check_live_deps
  local attestation="$WORK/attestation.json"
  if ! curl -fsS --max-time 30 "${API_TESTNET}/attestations/by-tx/${hash}" -o "$attestation"; then
    fail "could not fetch attestation for tx $hash from $API_TESTNET"
  fi
  local request_id exec_ts
  if ! python3 - "$attestation" >"$WORK/attestation-meta.txt" <<'PYEOF'
import json, sys
from datetime import datetime, timezone

d = json.load(open(sys.argv[1]))
ts = d.get("timestamp")
if isinstance(ts, str):
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    ts = int(dt.timestamp())
print(d.get("request_id", "?"), int(ts))
PYEOF
  then
    fail "could not parse the attestation for tx $hash"
  fi
  if ! read -r request_id exec_ts < "$WORK/attestation-meta.txt"; then
    fail "could not read the execution time from the attestation for tx $hash"
  fi
  if [ -z "${request_id:-}" ] || [ -z "${exec_ts:-}" ]; then
    fail "could not read the execution time from the attestation for tx $hash"
  fi
  printf 'Fetched attestation for OutLayer request %s (tx %s)\n' "$request_id" "$hash"

  local rc
  if outlayer-verify tx "$hash" --network testnet --api "$API_TESTNET" --json >"$WORK/plain.out" 2>"$WORK/plain.err"; then
    printf 'PASS: request %s verified live, exit 0\n' "$request_id"
    summarise "$WORK/plain.out"
    return 0
  else
    rc=$?
  fi

  if ! grep -qi "tcbinfo expired" "$WORK/plain.out" "$WORK/plain.err" 2>/dev/null; then
    printf 'FAIL: request %s did not verify live, exit %s\n' "$request_id" "$rc" >&2
    cat "$WORK/plain.out" "$WORK/plain.err" >&2
    return 1
  fi

  printf 'Note: the plain live check failed with TCBInfo expired.\n'
  printf 'The testnet collateral archive lags the current Intel window, so it has no collateral covering this execution yet. That failure is about the collateral window, not about the quote, and the retry with covering collateral is what confirms the quote. Retrying with covering collateral from the mainnet endpoint.\n'

  if curl -fsS --max-time 30 "${API_MAINNET}/public/collateral?fmspc=${FMSPC}&at=${exec_ts}" -o "$WORK/mainnet-wrapper.json"; then
    if python3 - "$WORK/mainnet-wrapper.json" "$WORK/mainnet-collateral.json" <<'PYEOF'
import json, sys
w = json.load(open(sys.argv[1]))
inner = w.get("collateral")
if isinstance(inner, str):
    inner = json.loads(inner)
json.dump(inner, open(sys.argv[2], "w"))
PYEOF
    then
      if wrapper_covers "$WORK/mainnet-wrapper.json" "$exec_ts"; then
        if outlayer-verify tx "$hash" --network testnet --api "$API_TESTNET" --collateral "$WORK/mainnet-collateral.json" --json >"$WORK/mainnet.out" 2>"$WORK/mainnet.err"; then
          printf 'PASS: request %s verified live with mainnet collateral, exit 0\n' "$request_id"
          printf 'Used mainnet collateral because the testnet archive window does not cover this execution yet. The collateral is per-FMSPC Intel material, not per-network, so the mainnet copy is valid evidence for a testnet execution.\n'
          summarise "$WORK/mainnet.out"
          return 0
        else
          printf 'Note: verification with mainnet collateral also failed, exit %s\n' "$?" >&2
        fi
      else
        printf 'Note: the mainnet collateral does not cover this execution time, skipping it.\n' >&2
      fi
    else
      printf 'Note: could not extract the inner collateral object from the mainnet response, skipping it.\n' >&2
    fi
  else
    printf 'Note: could not fetch mainnet collateral.\n' >&2
  fi

  if shipped_covers "$exec_ts"; then
    printf 'Falling back to the shipped collateral file, which covers this execution time.\n'
    if outlayer-verify tx "$hash" --network testnet --api "$API_TESTNET" --collateral "$SHIPPED_COLLATERAL" --json >"$WORK/shipped.out" 2>"$WORK/shipped.err"; then
      printf 'PASS: request %s verified live with the shipped collateral, exit 0\n' "$request_id"
      printf 'Used docs/attestation-proofs/collateral-fmspc-b0c06f000000-2026-11-08.json because the testnet archive window does not cover this execution yet.\n'
      summarise "$WORK/shipped.out"
      return 0
    else
      printf 'Note: verification with the shipped collateral also failed, exit %s\n' "$?" >&2
    fi
  fi

  printf 'FAIL: request %s did not verify live, plain exit %s\n' "$request_id" "$rc" >&2
  cat "$WORK/plain.out" "$WORK/plain.err" >&2
  for extra in "$WORK/mainnet.out" "$WORK/mainnet.err" "$WORK/shipped.out" "$WORK/shipped.err"; do
    [ -f "$extra" ] && cat "$extra" >&2
  done
  return 1
}

main() {
  check_deps
  case "${1:-}" in
    --bundle)
      [ -n "${2:-}" ] || { usage >&2; exit 3; }
      verify_bundle "$2"
      ;;
    --tx)
      [ -n "${2:-}" ] || { usage >&2; exit 3; }
      verify_tx "$2"
      ;;
    *)
      usage >&2
      exit 3
      ;;
  esac
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
main "$@"
