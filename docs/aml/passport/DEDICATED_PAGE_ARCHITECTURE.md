# Compliance Passport — the dedicated page

Rebuild of the Passport onto the approved Claude Design
(`AML Compliance Passport.dc.html`, project `a663070e-…`), as a page of its own
under AML/CTF Compliance rather than as sections grafted onto the surfaces
where compliance work is done.

## The architectural correction

The Passport had been embedded in three places on the existing AML pages: a tab
in `CaseWorkspaceTabs`, a section in the V3 `AmlCaseWorkspace`, and queue cards
on both Compliance Home surfaces. That made it read as one more tab in the
casework interface.

It is not casework. **The case workspace is where compliance work is done; the
Passport is the record that work produces.** Those are different artefacts with
different audiences, and merging their surfaces is what made the Passport feel
like a feature bolted onto a page rather than a document the platform issues.

All three embeds are removed. What stays is the destination:
`/admin/aml/passport`, in the AML nav under Customer Compliance, in **both**
shells.

### What the revert deliberately did NOT take with it

`ReliancePassportSection` and `ComplianceJourneyMap` predate this programme
(#2018) and stay exactly where they were in the case workspace. A test asserts
this, because the risk in any revert is removing the thing beside the thing you
meant to remove.

## Layers

```
supabase/functions/_shared/aml/passport/*.pure.ts   derivation (shared, Deno)
  passportState / passportStamps / passportJourney / passportCredential
  passportView          the audience assembler + fail-closed tripwire
  passportIdv           ← the IDV seam (below)
        │  re-exported by relative path
src/lib/aml/passport/index.ts
        │
src/components/aml/passport/design/
  primitives.tsx        tone pills, wax seals, field grids, record rows
  pagesJourney.tsx      00–05
  pagesRecord.tsx       06–11
  pageRegister.tsx      order, numbering, audience
  PassportBooklet.tsx   the cream-paper document view
  PassportWorkspace.tsx the shell: identity strip, rail, controls, page
        │
src/pages/aml/AmlPassports.tsx    customer picker + workspace
```

Every page is a **pure function of the projection**. No page fetches, and no
page decides what may be disclosed — the projection has already removed what
this audience may not see, so a page cannot leak by forgetting a check. Adding
a page is a component plus one line in `pageRegister.tsx`.

## The design layer

`src/styles/passport-tokens.css` **is** the visual system. Components carry no
colour. Three reasons, recorded in that file's header: the Passport is a
deliberate exception to the app's surface language and must not drift when app
tokens move; `audit:style` counts hex literals in components; and nothing in
that file escapes `.passport-scope`.

Values are HSL, matching the repo convention — the design specifies hex, and
transcribing it as hex would have moved `cssHexOutsideTokens` from 2 to 56.

The legacy `.passport-seal--circle|rect|seal` and `.passport-page*` classes are
kept verbatim at the foot of the file. They are the contract for `StampSeal`
and the **client** booklet, which is a separate, already-shipped audience
projection: restyling it as a side effect of rebuilding the Command page is
exactly the unrelated regression this rebuild was asked not to introduce.

## The IDV seam

`passportIdv.pure.ts` exists before the integration does, and it is the reason
the later wiring is an addition rather than a rewrite.

**The page never names a check type.** It asks the module what components exist
and what each means. When the live IDV workflow starts emitting richer signals
it declares them there, beside the existing ones, and the Verification page
renders them untouched.

Two rules the module carries:

- **An unknown check type returns `null`, never a default bucket.** Showing a
  check under the wrong component tells an operator that a control was
  performed which was not. Unmapped checks are counted and surfaced.
- **`disclosable: false` means presence and pass/fail only** — never a score, a
  measurement or the underlying media. `face_match` and `liveness` are marked
  false. `summariseIdv` cannot return a score because the module never carries
  one, and a test asserts its output matches no score-like key.

A component with no record is reported as `not_performed` rather than omitted:
the design shows the full control set so a reader can see what was *not* done,
which is the question an auditor asks first.

## The flag-off contract, and where it is asserted

With `aml_passport_command_view` off the server answers `passport_disabled` and
the workspace renders **nothing** — the AML module behaves exactly as it did
before the Passport existed.

That branch lives in `passportSurfaceState` (`loadState.ts`) rather than inline
in the component, and is asserted exhaustively in `loadState.test.ts`. The
reason is recorded there: a mocked rejection inside a full Passport component
graph is mis-attributed as an unhandled error by the test runner even when
demonstrably caught. Rather than leave the contract that matters most as the one
branch no test could reach, the branch was extracted into a pure function.

`disabled` beats `loading`, so no skeleton flashes on a deployment with the flag
off. A stale view alongside a fresh failure is still a failure — showing the
previous customer's record after a failed load is worse than an error.

## The booklet

The booklet is the artefact the Passport stands for, and it is composed rather
than hand-laid. `passportBooklet.pure.ts` turns one `PassportView` into an
ordered page list built from the design's block vocabulary (statement, fields,
summary, chips, matrix, rows, partners, seals, hero, timeline, verify, note,
signature, banner). `BookletBlocks.tsx` draws each block; `PassportBooklet.tsx`
draws the bound document around them.

Three properties are structural, not decorative:

- **It is bound.** Wide viewports show two facing leaves with a spine; narrow
  ones show one. A booklet that always showed a single page reads as a
  slideshow, not a document.
- **The page count comes from the data.** The design's own screenshots show 12,
  14 and 16 pages of the same document. A leaf whose records do not exist is
  not printed — an empty "Screening" leaf in a bound document reads as
  *screening found nothing*, which is a different and much worse claim than
  *screening is not part of this record*.
- **Every leaf is directly reachable**, via the numbered chips.

Composition is pure and tested (`passportBooklet.test.ts`) because page
arithmetic is the half a render test cannot see: which leaves exist, that
numerals never gap, that an odd page count does not produce an empty facing
page, and that no restricted material reaches paper.

**The QR is deliberately not reproduced.** The design mocks a scannable code
from a hash. A code that looks scannable but resolves to nothing is worse than
no code on a document a partner may rely on, so the Verify block carries the
credential ID and evidence fingerprint — what a verifier can actually check by
hand — until public verification exists.

### The cover, and why the leaf is scaled

**The passport opens on its cover.** Page 1 is the navy Aurixa board — the delta
(`/brand/aurixa-mark.svg`, the repo's existing brand asset), the wordmark, the
title, the bearer, the credential, the state and the evidence fingerprint. A
booklet whose first page is a data table reads as a report, which is the
opposite of what this artefact is. The cover is **not numbered**: numbering
starts on the first leaf, so adding or removing it can never shift a printed
numeral.

**A leaf is scaled, never squeezed.** Every type size, rule, seal and grid
inside a leaf is authored against a 470×648 box. Letting flexbox shrink that box
keeps 11px body copy and 30px seals inside a 200px-wide page — text reflows,
wraps one character per line and overflows, which is exactly what the reported
screenshot showed. The leaf now renders at its design size under a uniform
`transform: scale()`, so every internal proportion is preserved at any viewport,
and the aspect ratio is exact by construction rather than by CSS approximation.

`bookletGeometry` owns that arithmetic so it is testable without a DOM: it fits
by width *and* height (a short laptop never clips a page), caps enlargement,
falls back from a facing pair to a single leaf when two would no longer be
legible, and degrades to a usable minimum rather than collapsing on a phone.
The leaf body scrolls internally, so a long journey record can never stretch the
page out of proportion.

**The dialog must override the primitive at the same breakpoint.** This cost a
round. `DialogContent` sets `sm:max-w-lg`, `sm:max-h-[85dvh]` and
`sm:overflow-visible`; tailwind-merge treats an unprefixed `max-w-*` as a
different utility group from `sm:max-w-*`, so a plain `max-w-[1180px]` silently
lost on every screen ≥640px. The booklet rendered inside a 512px dialog, could
never show a facing pair, and — because the primitive also un-hides overflow at
`sm:` — spilled off the bottom of the viewport. There is no runtime error, no
type error and no failing render for this: jsdom has no layout, so only a
source assertion catches it (`bookletDialog.test.ts`).

The board also measures **its own box** rather than deriving a height from
`window.innerHeight`. The book is nested in a dialog whose height is itself
capped, so a window-derived guess is wrong by however much chrome sits above and
below it.

**One viewer, both portals.** `PassportBook` is shared by the Command dialog and
the Client Portal page. The Client Portal previously carried a second booklet
implementation — its own cover, its own page list and eight page components —
which is how the two could drift. The audience difference is already handled by
the projection, so the viewer does not need to know who is reading: the client's
booklet simply has fewer leaves, because the client's projection has fewer
sections.

## Connected portals, not a portal switcher

The design's top chrome switches the view between Command, Client, Finance,
Solicitor and Builder. That is a prototype affordance: each portal is a separate
authentication domain with its own cookie and its own server-side projection.
There is no session in which one operator is all five, and a Command-side "view
as client" rendering the client projection from Command data would show a
*simulation* of the boundary rather than the boundary.

The strip keeps what the design was communicating — which portals hold this
Passport and what each has done with it — and drops the impersonation. Rows are
derived from real grants (`portalRows.ts`), so a portal never appears for a case
it was not shared with.

## Still deferred

Unchanged from `DESIGN_CONFORMANCE_AUDIT.md`: QR/public verification, client
biometric portrait, per-document partner ACLs, four-eyes authorisation,
printable booklet PDF, identifier unmask-with-reason, Command preview-as-client,
and notification-drawer passport events. The booklet is a single-leaf reader
rather than the design's two-page bound spread.
