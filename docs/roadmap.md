# Cynex roadmap

This is the road ahead, ordered from the largest step to the final one, with the timing of each step stated, so a reader can see both the ambition and the schedule. Nothing here is a promise of a date, and nothing here changes the Cynex idea.

Note: this file holds the roadmap content for the README. It lives here, instead of in the README, because the README is being edited on a separate branch for the judge steps (item 1) and merging the roadmap into the README now would conflict. Once that branch merges, this content moves into the README's roadmap section.

## Mainnet deployment

After submission, once the mainnet constants are swapped and re-audited. The vault's layer 2 and 3 constants are testnet only, so a mainnet deploy needs those changed, a rebuild, a fresh audit, and a full live re-proof. The guide is in `docs/deployment-mainnet.md`. Mainnet is when Cynex stops being a demo and starts being infrastructure real agents can use.

## MCP server

The build in progress now, scoped and waiting on the final decisions, that turns the vault into infrastructure any MCP agent can use. It lands with the submission and grows after it: a thin adapter that exposes the vault's operations as tools, holding only the agent's scoped settle key, with the vault still enforcing everything on chain. It is the single biggest impact move available, because it broadens who Cynex serves from one agent to every agent that speaks MCP.

## More reputation signals

The reputation engine scores five signals today. More signals make the counterparty check stronger: the exact set depends on what proves useful in practice, and each new signal goes through the same review and live proof as the first five. The engine is also a candidate to stand alone as a service other agents can call without the vault, which would make Cynex reusable infrastructure, not a single vault.

## Hosted demo

13 November, the last step before the video. The playground hosted so a judge clicks a link and sees it work without cloning anything. A judge who has to clone, install, and configure before seeing anything is a judge who sees less.

## Video

13 to 14 November, the very last thing. It records the finished product: the polished frontend, the concrete use case, and the attack stopped on chain with the receipt and the log. The video is the first thing a human judge watches, and it decides whether they read the README at all.
