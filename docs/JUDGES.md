<!-- The "What is real and what is simulated" table below is copied from
     web/src/pages/Proof.tsx. Keep the two in sync by hand. -->

# Judges, start here

Live site: https://cynex-jayanngs-projects.vercel.app/

One action: click **Run it live** on Home, or open **Break it** and try to pay a different recipient.

## 60-second path

Three steps, each with the exact expected output.

### Step 1 (15 seconds): open the live site

Read the conflict line and the numbers strip.

Expected: 31 receipts on the test vault, 13 on production, demo policy 5,400 of 10,000 spent.

### Step 2 (30 seconds): click Run it live

Expected, once the live settle proof has run: demo-live-001 PAID, receipt 31, policy spent 5,400 to 5,500, agent2 100 to 200.

Not yet proven live: the button is built, but no live settle has been run from it yet, because the preview deployment cannot see the demo key. The first live settle will be recorded here with its transaction hash.

### Step 3 (15 seconds): open Break it, change the recipient

Change the recipient to attacker.testnet and run the attack.

Expected: REFUSED, ERR_RECIPIENT_SUBSTITUTION, tx AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S, 0 tokens moved.

## 5-minute path, no wallet

The same three steps, plus:

- **Verify the chain yourself.** Run `node frontend/dist-test/cli/cynex.js verify-live cynex-testvault.cynexmaster.testnet`. Expected: every row verified_ok = true, 31 receipts, all ok.
- **Tamper with a receipt.** On Break it or Proof, edit the amount on receipt 2 and recompute. The link to receipt 3 breaks, and the verifier replay flags it.
- **Run the MCP sandbox demo.** Run `cd frontend && npm run mcp:build && npm run mcp:demo`. Expected: demo-ready-001 PAID, receipt 2 in the local sandbox. Nothing is mocked, nothing touches testnet.

## What is real and what is simulated

| Item | Real or simulated | Limit, stated plainly |
|---|---|---|
| Vault contract | Real, deployed on NEAR testnet | Testnet only. Both vaults run code hash 65ZQhWUzkTeQkrRuyiWP6oxthpb74cWBEhiAFW4mApu6. No mainnet deployment, no mainnet spending. |
| Testnet chain | Real NEAR testnet | Testnet only. Receipts, balances, and transactions are live chain reads, but nothing here has real value. |
| Refusal | Real transaction on testnet | Transaction AFYAq8Sju41NjBFwPmTHbJ1psmsYQWjVdBhmXBZbpa7S, ERR_RECIPIENT_SUBSTITUTION, 0 tokens moved. The Attack page currently shows this recorded refusal, not a fresh live attempt from the judge's click. |
| Settle | Real transaction on testnet | Settles use pre-seeded obligations and team keys. A judge does not create their own obligation without their own testnet accounts. Latest test settle is receipt 30, mcp-working-check-001. Test vault receipts are live, 31. Production vault receipts are live, 13, policy p5-prod-001 spent 500 of 1000. Counts read live 11 Nov 2026. |
| TEE attestation | Real, OutLayer, request 11912 | The TDX v4 quote was verified off chain. The vault does not verify the quote on chain, by design, so verification is off chain, not part of the contract check. |
| VRF anchor | Real signature, verified on chain | The signature is verified on chain and bound to the pending request. It proves determinism and binding. It does NOT prove TEE execution, and that link must never be claimed. |
| Reputation gate | Real, five sourced signals | A BLOCK refuses, a WARN escalates. It is a gate on top of the vault check, not a replacement for it. The vault still decides every settle. |
| MCP server | Real, six tools over stdio, one moves funds | Stdio only. There is no hosted endpoint. A judge needs their own testnet accounts, vault, scoped settle-only key, and CYNEX_ env vars to use it against testnet. The sandbox mode needs no keys. |
| Sandbox demo | Real vault and token contracts in a local near-sandbox | Local only, not testnet. Receipts are local, for example receipt 2 for demo-ready-001, and do not appear on testnet. Nothing is mocked. |
| Demo key | Real scoped settle-only key, test vault only | It can only call settle on the test vault. It cannot create obligations or move other funds. It is rate limited, and at least 9 READY obligations remain for judges after the single live proof settle. When they are used up, the button stops. |
| Token | Real testnet token, usdc.fakes.testnet, 6 decimals, shown as USDC.e testnet | Fake testnet USDC with no value. No mainnet value, no mainnet spending. One past recipient, acme-supplies.testnet, does not exist on chain despite a receipt and a token balance, because settle uses plain ft_transfer, which credits the token contract map even for a nonexistent id. Future settles avoid that recipient unless the owner decides explicitly with the WARN shown. |

## Troubleshooting

- **The site shows "Unavailable, retrying".** The live RPC read failed. Wait 8 seconds, it retries. No action needed.
- **Run it live returns 429.** The rate limit is 1 per minute and 5 per hour per IP. Wait a minute and try again.
- **Run it live returns 503 DEMO_NOT_CONFIGURED.** The demo key is not visible to this deployment. This is the preview-target issue: the key is targeted at production only in the Vercel dashboard, and the fix is a dashboard change, not a judge action.

Everything on this page is verifiable from the chain. Where a number is a snapshot, the date is stated next to it.
