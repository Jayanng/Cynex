# Security policy

Cynex is a settlement vault. Treat security reports seriously and
privately.

## Reporting

Do not open a public issue for a vulnerability that could move money
or bypass the vault. Report it privately to the repo owners, with a
reproduction: the obligation, the call, the expected rejection, and
what actually happened. Include a transaction hash or a sandbox
reproduction where possible.

## Rules that apply to this repo

- No secrets, keys, seed phrases, or credentials in the repo, in
  history, or in test output. Owner keys are never on the executor host.
- No mocked, hardcoded, or faked results in the demo, the console, or
  the tests. Every number is read from chain or computed live.
- Every security finding gets a verdict (true, false, partial, or
  unproven) with reproduction evidence before it is accepted or fixed.
- The vault is the security boundary. The agent is assumed compromised.
  A prompt injection must be rejected on chain, not filtered in the UI.
