# Cynex Frontend Rebuild: The Dossier

Build plan for a ground-up frontend on branch `frontend-vision-rebuild`.
Written before any code, for approval first. Nothing here copies the existing
site's design, structure, components or copy. The only inherited material is
the brand palette. All facts on the rebuilt site must remain true to chain and
repo, verified live, never mocked.

## 1. The vision, one line

The vault keeps a case file. Every screen is a page in that file, and the
judge reads it like an auditor reading a dossier: claim, evidence, grade,
verdict, signature.

The current site is an editorial landing experience that presents the project.
The rebuild is the project's own file room. The difference is posture. Landing
sites say, trust this story. A dossier says, here is the record, check it.
Cynex's entire thesis, trust nothing, verify everything, is a dossier thesis,
so the interface itself should look like the document the vault writes.

Feel: paper-warm, mono-fluent, quietly technical. Somewhere between a forensic
audit report and a court exhibit. Confident without being loud. The one moment
of theater is the verdict stamp, because the verdict is the product.

## 2. Constraints honored, stated hard

- The warm cream palette is the only thing taken from the existing build. No
  layout, no component, no copy, no section order, no icon, no illustration
  style, no font is carried over. Every line of CSS and TSX in web/src is
  rewritten.
- Nothing mocked or hardcoded as a fake live value. Every number renders with
  an evidence grade (see section 5). Simulated content must say so on its face.
- No silent failures. Every failed read shows an honest failure state, never a
  cached value dressed as live, never a blank.
- Copy reads like a person wrote it. No em dashes anywhere. No filler phrases.
- Desktop QA after UI edits, on the visible desktop, per standing house rules.
- No merge until Johnson accepts. Commits land on the branch only.

## 3. What I inherit, exactly

From `web/src/index.css`, the palette values and nothing else:

| Token | Value | Role |
|---|---|---|
| bg | #f7f4ee | page paper |
| card | #fdfbf7 | card paper |
| raised | #efe9df | raised paper |
| txt | #1f1b16 | ink |
| secondary | #5e554a | supporting ink |
| muted | #6e6255 | metadata ink |
| accent | #f3923c | brand amber |
| accent-text | #9a4d0f | amber ink for links |
| accent-soft | #fdeed3 | amber wash |
| pos | #16a34a / #15803d | PAID states |
| neg | #dc2626 / #b91c1c | REFUSED states |
| warn | #92400e | warnings |

I may derive tints and shades from these for my own scale, but no new hues.

Everything else is mine. The historical facts that must appear (tx hashes,
receipt indices, vault account ids, error codes, policy numbers, attestation
bundle names) are chain facts, not design. They will be re-read live and cited,
not copied from any existing page.

## 4. Information architecture

Five routes on a fresh hash router of my own writing. Old links keep working
through automatic redirects, so the repo's demo script and README commands stay
valid.

| New route | Redirect from | Job |
|---|---|---|
| /#/case | /#/ | The file: verdict-first hero, the live refusal story, the three layers, the one-command verify |
| /#/break | /#/attack | The hostile bench: attack payloads against fixed terms |
| /#/walkthrough | /#/demo | The three scenes, receipt by receipt |
| /#/record | /#/proof | The ledger, attestations, commands, errata |
| /#/notes | /#/docs | The repo's own documentation, cited to source |

Section order on each route is my own and follows the dossier logic: verdict
first, then the record, then the receipts, then the footnotes. A landing page
asks for attention. A file opens with the finding.

## 5. The evidence grade system, the core idea

Every rendered number, hash, verdict or claim carries a visible grade chip.
This is the design's spine and the reason the dossier form fits.

| Grade | Meaning | Where it comes from |
|---|---|---|
| CHAIN READ | Fetched live from RPC this session | near-api-js view calls |
| HISTORICAL | A past on-chain event, cited with tx hash | explorer linkable |
| SIMULATED | Computed in-browser, no chain write | stated on the chip |
| ATTESTED | Backed by an attestation bundle in repo | named bundle + verify command |
| ERRATA | A known caveat attached to this item | links to the errata note |

Component contracts enforce this at the type level. A `<Figure>` component
requires a grade prop. There is no ungraded number in the system, so it is
impossible to render a claim without a provenance label. Unit tests assert the
contract.

## 6. Design system

Typography: Spectral for display and body text (a text serif, reads like a
document), IBM Plex Mono for all data, hashes, commands and grades. Both
self-hosted, no CDN. Two families only, used with conviction.

Layout: a two-column dossier grid at desktop, wide measure for the record,
narrow margin rail for annotations, errata and live metadata. At mobile the
margin rail flows inline below its reference, since marginalia must stay
adjacent to their claims.

Motion: almost none. One signature: the verdict stamp lands with a slight
scale-down and opacity settle when an attack resolves, rotated a few degrees
like a real rubber stamp. All motion respects prefers-reduced-motion.

Components, all new, named for their job in the file:

- CaseBar: sticky header, case id, block height, vault chips, live dot.
- VerdictStamp: PAID or REFUSED seal, the only theatrical element.
- TermsLock: the fixed terms grid, always visible during an attack, with the
  lock glyph, so the judge can see what the vault will not let them move.
- EvidenceGrade: the provenance chip from section 5.
- LedgerTable: receipt rows with the prev_hash spine drawn as a thin vertical
  rule connecting index to index, the hash chain made visible.
- HashChip: mono hash, truncatable, copy on click, explorer link.
- CommandBlock: copyable shell command with expected output beneath.
- ErrataNote: a correction-notice card in the margin rail, styled like a typed
  amendment, for caveats like the acme-supplies receipts warning.
- PayloadCard: attack cards with attempt lines and expected verdicts.
- LayerStack: the three-layer diagram, built as stacked document tabs, not
  arrows.

## 7. Data layer, written fresh

`lib/chain.ts`: my own minimal RPC client on top of near-api-js 7. view_account,
view_call with base64 args, receipts pagination, block height. One place where
RPC endpoints live.

`lib/record.ts`: the citation ledger. Every historical fact the site shows,
each with vault id, tx hash or receipt index, block context, and an explorer
URL builder. Facts here are checked against RPC during QA, by a script I write,
`scripts/check-claims.ts`, which reads every citation and confirms it against
chain before the build ships. Nothing is asserted from memory.

`lib/grades.ts`: the grade enum and the rules that assign it.

`lib/demo-key.ts`: the live-mode key contract, compatible with the existing
supply flow by field semantics (enabled, accountId, publicKey, privateKey,
readyObligationId, pendingObligationId), but implemented my own way. Values
come from build-time environment variables, never committed to the repo, so
the key reaches the bundle by design without ever living in git.

Live failure rule: on any RPC failure the field renders `Unavailable, retrying`
in the warning ink, and the block height freezes visibly stale rather than
pretending freshness.

## 8. Route storyboards

Case (home): headline is the verdict, not the tagline. The live refusal,
ERR_RECIPIENT_SUBSTITUTION, renders as a full verdict stamp with its terms
above it, because a refusal with visible terms teaches the product in ten
seconds. Below: the three layers as stacked tabs, then the one-command verify
in a CommandBlock, then the live strip as a slim margin rail running the whole
page rather than a banner. Tagline sits under the verdict as the case name.

Break: the judge's bench. TermsLock pinned at top, payload chips beneath,
verdict stamps landing as they resolve, live mode button as the escalation,
with the demo key status stated plainly whether or not the key is configured.
Simulation versus on-chain is never ambiguous, the grade chip carries it.

Walkthrough: the three scenes as numbered exhibits, each with its transaction
receipts, grade chips, and a live re-read. The fourth scene, the reputation
gate, is presented as an off-chain exhibit with its own honest labeling.

Record: LedgerTable as the hero, the hash spine visible, the one-command
verify above it, attestation bundles as filed exhibits with verify commands,
errata notes in the margin.

Notes: the repo's documentation, condensed with source paths and commit
references, presented as footnotes in the dossier, not as a marketing page.

## 9. States and edge cases

Loading: ledger skeleton rows in muted ink, no shimmer theater. Failure:
`Unavailable, retrying` in warn ink, per-field. Demo key absent: the live
button explains and falls back to the simulated verdict, never faking a
refusal as on-chain. 404: a dossier page, file not found, with a way home.
Empty receipt set: states it. Long hashes: truncation with full value on copy.
Mobile 390px: margin rail inline, tables scroll horizontally with a visible
edge fade so rows are readable.

## 10. Quality gates, before I call it done

1. tsc strict clean, vite build clean, no chunk over 250 kB gzipped.
2. Every route walked in the visible desktop browser, zero console errors,
   screenshots captured for each.
3. scripts/check-claims.ts passes: every cited fact re-verified against RPC.
4. Contrast measured on my derived scale: body ink on paper at least 7:1,
   accent ink at least 5:1, grade chips at least 4.5:1 against their fills.
5. Mobile 390, tablet 768, desktop 1280: no horizontal overflow, no clipped
   hash chips.
6. Copy sweep: zero em dashes, zero placeholder text, zero unlabelled numbers.
7. Live-mode flow driven end to end in the browser when a test key is present
   (staging value), and the honest fallback verified when it is absent.
8. The existing jest suite still passes, to prove the rebuild touched nothing
   outside web/.
9. The three visible-content checks: tagline and error codes verbatim against
   the contract source, tx hashes match explorer, receipt counts match RPC.

Definition of done, in the observable sense: a judge opening /#/case can state
what Cynex does in one sentence within ten seconds, can break the vault within
two clicks, can verify a receipt without trusting the page, and sees a grade on
every number they read.

## 11. Rollout

Branch: frontend-vision-rebuild. Sequence of commits: this plan, tokens and
primitives, chain lib and claim checker, routes one at a time, polish and QA
evidence. No push to origin until Johnson says push. No merge until Johnson
accepts. The preview runs locally at a served build port, on the visible
desktop for review.

## 12. Open questions, for Johnson

1. Route names. I propose the new slugs with redirects so old links survive.
   If you want the five current names kept exactly (Home, Demo, Attack, Docs,
   Proof), say so and I will keep them with my own internals.
2. Fonts. Spectral plus IBM Plex Mono, self-hosted. Both are new choices and
   not in the current build. Any veto?
3. The live-mode key at build time via environment variables, never in git.
   That keeps your key-supply step the same, just a different injection point.
   Acceptable?
4. Anything in the current copy that must survive verbatim beyond the tagline,
   the error codes and the honest disclosure lines? I plan to rewrite all prose
   in my own voice.

Until these are answered and this plan is accepted, no code is written.
