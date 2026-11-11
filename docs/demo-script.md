# Cynex demo script

For the demo video (frontend, Adejoke) and for judges reading the repo. Every
step below ran live on the test vault on 2026-11-07, with real tx hashes.
The full proof record, with before and after chain state, is in
`docs/demo-proof.md`. The recipient throughout
is the agent account `cynex-agent.cynexmaster.testnet`, never
acme-supplies.testnet, which does not exist on chain. All test-vault calls
were signed with the owner key `cynexmaster.testnet`, because the agent's
scoped function-call key is bound to the production vault as its receiver
and cannot settle on the test vault. Settle performs identical on-chain
term and nonce checks regardless of the caller, so the enforcement proof
is valid.

## The story in one line

A human authorizes a payment with exact terms. The agent, assumed
compromised, tries to change those terms, and the vault refuses on-chain.
When the terms match and the evidence checks out, the vault pays, and the
receipt proves it.

## Scene 1, the happy path (layer 1, on-chain preimage)

The owner creates an obligation: pay the agent 100 USDC.e for a delivery,
with the delivery note as evidence. The vault records the recipient, the
amount, and the SHA-256 of the delivery note, and nothing the agent later
proposes can change them.

- Create obligation `p10-demo-preimage-001`: tx
 CC8gdACowXvBskZS9K4WEzXddunVpxpwCEdsdFdP2xa3
- Request evidence: tx FE5EtKA12h8AwLcngWXuMsaSL1vhg9gzMB4RAWGWCNNx
- Submit the delivery note bytes: tx MVJrygCRiiZgNv96gkSQC9vzk2saLwj4wdKTULoCJzh
- The vault hashes the bytes itself, matches the committed digest, and the
 obligation goes READY.
- Settle with the correct recipient and amount: tx
 3Gp3J2zZCKrne1PamDVf6PgXHk4qGc3a58GBvoFcNhrZ, receipt index 11.
- The obligation is PAID. Agent balance 700 to 800. Policy spent 3400 to
 3500.

What the viewer sees: the obligation moves CREATED to EVIDENCE_PENDING to
READY to PAID, and the agent balance goes up by exactly 100.

## Scene 2, the attack (prompt injection, three tries)

The agent is compromised. Its prompt tells it to pay a different recipient,
then a larger amount, then to pay the same obligation twice. Each time the
vault refuses on-chain.

The obligation is `p10-demo-attack-001`, same terms: pay the agent 100
USDC.e, delivery note evidence. It is READY before the attacks begin.

- Create: tx 3j1DwASmR3m9A9xBEyrTnVCXi9dVer4PXXdVzy2bH7Ly
- Request evidence: tx CEHnbjzg66pUcjqvPMBf3XW6Jd9ybxg4SY6HrEeiFatG
- Submit preimage: tx HCGmY5CZxY1qUKXzyyTeU7kyEjqyEsxmqf1QuX2dtdwU

Attack 1, changed recipient. The agent proposes cynexmaster.testnet instead
of the agent account:
- Tx AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S, failed.
- Rejection: `Smart contract panicked: ERR_RECIPIENT_SUBSTITUTION`.
- The obligation stays READY. No receipt. No balance change.

Attack 2, changed amount. The agent proposes 200 instead of 100:
- Tx 43YaxJVggxuZ3E25WfjzkgGBsGAqLrj8nwdUU9RLAQRy, failed.
- Rejection: `Smart contract panicked: ERR_TERMS_MISMATCH`.
- The obligation stays READY. No receipt. No balance change.

Then the correct settle, to show the obligation was still good:
- Tx Ho97UjQEDDfe7Go66uHrVSJvbF8narZJ2YBH3hWarxi, receipt index 12.
- The obligation is PAID. Agent balance 800 to 900. Policy spent 3500 to
 3600.

Attack 3, replay. The agent tries to settle the same obligation again:
- Tx AwzQS7XsuGSYnPmvd5jFJzPDs3WDc2gRgSbW3smWq1Cs, failed.
- Rejection: `Smart contract panicked: ERR_NONCE_ALREADY_CONSUMED`.
- The obligation stays PAID. Agent balance 900, not 1000, so no double
 payment.

What the viewer sees: three failed settles, each with a named on-chain
rejection, and the balances do not move on any of them. The vault, not the
agent, decides whether the money moves.

## Scene 3, TEE and VRF (layers 2 and 3)

The same obligation shape, but the evidence is verified by a TEE guest
instead of the on-chain hash. The guest fetches the evidence from its
claimed source inside an attested enclave, hashes it there, requests VRF
randomness, and the vault verifies the digest, the source, and the VRF
signature on-chain.

The obligation is `p10-demo-tee-001`, evidence type TEE, evidence URL
https://raw.githubusercontent.com/near/near-api-js/master/README.md.

- Create: tx E81V6t996qpzgboNtShmBxTfrhahiZYaB8qxZnkS6fB2
- Request evidence: tx 7Ao5v6mWnr46rM4FnSJP5m9kvhhn9ah7wd2sYGenpm7x
- Request TEE verification: tx 5Xvu78qxd9NfgJzRBeyvdQXnqK8sLfSmzrfVC5dgDK68,
 300 TGas. OutLayer request 11912, project
 cynexmaster.testnet/cynex-verifier, guest version 8abfe08b.
- The obligation goes READY. The guest fetched the URL, hashed it, and the
 VRF signature verified.
- Settle: tx 3QV2aCRSiJ8ZYqLECCpK6ZkXpYE4AdxJzmyP3JTaDqWB, receipt index 13.
- The obligation is PAID. Agent balance 900 to 1000. Policy spent 3600 to
 3700.

What the viewer sees: the TEE request goes out, the obligation goes READY
after the guest runs, and the settle pays. The TEE step takes about a
minute; the video can cut from the request to the READY read.

## Scene 4, verification

Run cynex-verify on the test vault. All 14 receipts, indices 0 to 13,
report verified_ok=true, including the three new demo receipts (11, 12,
13). The receipt hash chain replays from genesis with no gap and no
mismatch.

## Final state

Test policy p6-001: spent 3700, reserved 0, funded 10000, frozen false.
Agent token balance 1000. All three demo obligations PAID. No cleanup
needed.

## For the video

- Show the obligation state and the balances before and after each step,
 not just the tx hash. The PAID read and the balance delta are the proof;
 the tx hash alone is not.
- Show the attack rejections with their exact reason codes on screen:
 ERR_RECIPIENT_SUBSTITUTION, ERR_TERMS_MISMATCH,
 ERR_NONCE_ALREADY_CONSUMED.
- The three layers are one story: layer 1 proves the bytes match, layer 2
 proves where they came from, layer 3 anchors the execution to the
 request. The video should say that in one line, not three.
- Do not settle to acme-supplies.testnet. It does not exist on chain.
