# Demo live proof, test vault, 2026-11-07

Run on the test vault
`cynex-testvault.cynexmaster.testnet`. All calls used the owner key
`cynexmaster.testnet` (the agent holds test-vault-bound settle keys as well, so the owner key was the demo's choice, not a limit: an agent-signed settle already succeeded on the test vault, tx 7HHtxoHX7bvYpRmdm5pyhwhBWWRiCUHiGPMDye8F1oKh, receipt 7). Recipient throughout is the agent account
`cynex-agent.cynexmaster.testnet`, never acme-supplies.testnet. Token
`usdc.fakes.testnet` (USDC.e, 6 decimals).

## Baseline before the demo

Test policy p6-001: limit 10000, spent 3400, reserved 0, funded 10000, frozen
false. Agent token balance 700. Test vault receipts 11 (indices 0-10).

## Happy path, preimage (layer 1)

Obligation `p10-demo-preimage-001`, policy p6-001, recipient the agent,
amount 100, evidence_type PREIMAGE, nonce 1001, expires 2030-01-01
(1893456000000000000). Delivery note string:
`demo-delivery-note-001:p10-demo-preimage-001:100`, SHA-256
d51c5d7ddbbe4b8e0e420caa1658d806cb29beb89c608ad9dbb043e3910f7657.

- Create: CC8gdACowXvBskZS9K4WEzXddunVpxpwCEdsdFdP2xa3
- Request evidence: FE5EtKA12h8AwLcngWXuMsaSL1vhg9gzMB4RAWGWCNNx
- Submit preimage (the delivery note bytes): MVJrygCRiiZgNv96gkSQC9vzk2saLwj4wdKTULoCJzh
- Obligation went READY (the vault hashed the bytes itself and matched the
 committed digest).
- Settle (correct recipient and amount): 3Gp3J2zZCKrne1PamDVf6PgXHk4qGc3a58GBvoFcNhrZ,
 receipt index 11.
- Obligation PAID. Agent balance 700 to 800. Policy spent 3400 to 3500,
 reserved 0.

## Attack, prompt-injected agent tries bad terms

Obligation `p10-demo-attack-001`, policy p6-001, recipient the agent, amount
100, evidence_type PREIMAGE, nonce 1002, expires 2030-01-01. Delivery note:
`demo-delivery-note-002:p10-demo-attack-001:100`, SHA-256
276232a238c8c252e7d17a1e3a45568eb885f80e78dfa93fdf0a11c6023b1441.

- Create: 3j1DwASmR3m9A9xBEyrTnVCXi9dVer4PXXdVzy2bH7Ly
- Request evidence: CEHnbjzg66pUcjqvPMBf3XW6Jd9ybxg4SY6HrEeiFatG
- Submit preimage: HCGmY5CZxY1qUKXzyyTeU7kyEjqyEsxmqf1QuX2dtdwU
- Obligation READY.

Attack 1, changed recipient (proposed cynexmaster.testnet instead of the
agent):
- Tx AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S, failed.
- Rejection: `Smart contract panicked: ERR_RECIPIENT_SUBSTITUTION`.
- Obligation stayed READY. No receipt. No balance change.

Attack 2, changed amount (proposed 200 instead of 100):
- Tx 43YaxJVggxuZ3E25WfjzkgGBsGAqLrj8nwdUU9RLAQRy, failed.
- Rejection: `Smart contract panicked: ERR_TERMS_MISMATCH`.
- Obligation stayed READY. No receipt. No balance change.

Correct settle (to show the obligation was still good):
- Tx Ho97UjQEDDfe7Go66uHrVSJvbF8narZJ2YBH3hWarxi, receipt index 12.
- Obligation PAID. Agent balance 800 to 900. Policy spent 3500 to 3600.

Attack 3, replay (settle the same obligation again after PAID):
- Tx AwzQS7XsuGSYnPmvd5jFJzPDs3WDc2gRgSbW3smWq1Cs, failed.
- Rejection: `Smart contract panicked: ERR_NONCE_ALREADY_CONSUMED`.
- Obligation stayed PAID. Agent balance 900, not 1000, so no double payment.

## TEE and VRF (layers 2 and 3)

Obligation `p10-demo-tee-001`, policy p6-001, recipient the agent, amount
100, evidence_type TEE, nonce 1003, expires 2030-01-01. Evidence URL
https://raw.githubusercontent.com/near/near-api-js/master/README.md (7,701
bytes), SHA-256 f23aeaa4efc068df8a05ef97c1ade88022575ad5ea52dbe9af218028462d4e27.

- Create: E81V6t996qpzgboNtShmBxTfrhahiZYaB8qxZnkS6fB2
- Request evidence: 7Ao5v6mWnr46rM4FnSJP5m9kvhhn9ah7wd2sYGenpm7x
- Request TEE verification: 5Xvu78qxd9NfgJzRBeyvdQXnqK8sLfSmzrfVC5dgDK68,
 300 TGas, no attached deposit. Note: the method does not accept an
 attached deposit; the 0.01 NEAR is a vault liquid-headroom requirement,
 not a caller deposit. The first attempt with a 0.01 NEAR deposit failed
 with "Method request_tee_verification doesn't accept deposit".
- OutLayer request 11912, project cynexmaster.testnet/cynex-verifier,
 version 8abfe08b. The guest fetched the URL, hashed it with SHA-256,
 requested VRF randomness, and returned digest, source, request id, VRF
 output, signature, and alpha. The callback verified the digest, the
 source, and the VRF signature on-chain.
- Obligation went READY.
- Settle: 3QV2aCRSiJ8ZYqLECCpK6ZkXpYE4AdxJzmyP3JTaDqWB, receipt index 13.
- Obligation PAID. Agent balance 900 to 1000. Policy spent 3600 to 3700.

## Verification

cynex-verify on the test vault (`verify-live cynex-testvault.cynexmaster.testnet`):
14 receipts, indices 0-13, all verified_ok=true. The three new demo receipts
are indices 11 (p10-demo-preimage-001), 12 (p10-demo-attack-001), and 13
(p10-demo-tee-001), all to the agent, 100 each.

## Final state

Test policy p6-001: limit 10000, spent 3700, reserved 0, funded 10000,
frozen false. Agent token balance 1000. All three demo obligations PAID.
No cleanup needed: no obligation left in EVIDENCE_PENDING, READY, or
TRANSFER_PENDING, no reservation held, no funds locked.

## Notes for the demo

- The happy path, the three attacks, and the TEE path all ran on the test
 vault with real tx hashes. Nothing was settled on production for this
 demo.
- The TEE request takes about a minute to resolve (guest execution plus
 callback). The demo video should allow for that, or cut from the request
 to the READY read.
- The recipient-substitution rejection is a contract panic
 (ERR_RECIPIENT_SUBSTITUTION), not a graceful error return. That is the
 contract's behaviour for a terms mismatch in settle, and it is the same
 in the attack transcript.
