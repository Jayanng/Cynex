# Phase 0 conformance outputs - captured 2026-11-03, Instabox machine rastadev

Frozen base: Master 5eee26a (Phase 0 Lane A freeze, cynex-v1.0.0).
Lane B mirror: frontend/src/cynex-schema.ts and frontend/src/cynex/
(digest, schema, receipt, api), tests/test-vectors/vectors.json (frozen).

## Rust - cargo test, schemas/cynex-v1.0.0

Command: cargo test
Result: ok
- Unittests: 4 passed, 0 failed
  - hex_to_32_rejects_non_ascii_without_panic
  - hex_rejects_non_ascii_whitespace_before_trim
  - obligation_records_policy_version_and_lock
  - settlement_digest_rejects_other_network (should panic)
- Conformance tests: 2 passed, 0 failed
  - receipt_hash_matches_frozen_formula
  - conformance (6 vectors)
- Doc-tests: 0 passed, 0 failed

## TypeScript - Node conformance, frontend

Command: npm run conformance (tsc, then node dist/scripts/conformance.js)
Result: 6 passing vectors, tamper check ok, BigInt check ok

basic 0524986a7f7d5e3a332f3a2ec99c1847aa54ae48cad9a9aec1a8e5b6af043ba6
large-amount b828d550dd71d40a08d3986926613d61180b4e9a7b2becfd4c4521edefdb784a
non-ascii-recipient 88a7f173f84abd82c502b84cd9954efcd11a42b041552142db08e9416449a1a1
zero-edge 99cf86fba91e4c8ecc5b1fe7e0e44a97effff3a85fb32cc5772d6ca5db9501bc
max-ish-nonce 1d9bbc388adccd89f735d89f9286d86377a38cec6ef7e17775da0fbf9090e383
unicode-evidence-type ee10278d43125a98d8914d55e2f184384c07f60b27fbea543cc4bcef26cb3086
tamper check ok: basic amount+1 -> 6fbf5469c7f0a98312b3f9b41b77f865b418a4b280c860d075c0280b7396f4ac
BigInt check ok: Number amount rejected

These 6 hashes are identical to the Rust conformance hashes for the
same vectors. A single-byte change (amount + 1) changes the hash.

## TypeScript - Jest, frontend

Command: npm run jest (NODE_OPTIONS=--experimental-vm-modules npx jest src/cynex-schema.test.ts --runInBand)
Result: Test Suites 1 passed, Tests 9 passed, 0 failed
- exactly 6 frozen vectors
- vector basic matches Rust
- vector large-amount matches Rust
- vector non-ascii-recipient matches Rust
- vector zero-edge matches Rust
- vector max-ish-nonce matches Rust
- vector unicode-evidence-type matches Rust
- single-byte change changes the digest
- Number amount is rejected

## Receipt hash cross-check

TypeScript receiptHash for the Rust test receipt (index 0, genesis
prev_hash, obl-001, acme-supplies.testnet, 250000000, usdc.fakes.testnet,
1767225600000000000, tx-abc123) equals the Rust expected value:
2099107143c5609e23746037ee133473bc7459c6234db76ebd93333d03bf4934

## Status

Phase 0 mirror is complete for Lane B as defined above. Joint sign-off
on docs/contract-api.md still needs both lanes, so Phase 0 is not
closed by this evidence file alone.
