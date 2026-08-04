# The template converter

Upload a template somebody has been sending clients for years; get it back set
through the report design system and bound to one of the migrated report
formats.

This is not a ninth format. It is a way *into* the eight that exist — the point
at which an old document stops being a PDF nobody can change and becomes a
structure the programme's renderers can fill.

- **Page**: `/admin/template-builder/converter` (`src/pages/admin/TemplateConverter.tsx`),
  guarded by `<ModuleGuard moduleKey="templates" requireEdit>`.
- **Routes**: `convert-template-document`, `generate-brand-design-system`.
- **Tables**: `template_conversions`, `brand_design_systems`
  (`supabase/migrations/20260823000000_template_converter.sql`).
- **Bucket**: `converted-templates`, private, created by that migration.

---

## What the converter takes, and what it deliberately leaves

Sections, their order, their nesting, and whether they are tabular. Nothing
else.

Not margins, not colours, not where a logo sat. Those are the things the design
system is replacing, and carrying them across would reproduce the document
rather than refurbish it. It is also the only part of a PDF that survives
extraction reliably — positions and fonts do not come back at all from a scanned
source and come back wrong often enough from a native one that a layout-faithful
converter would spend its life in the uncanny valley.

Depth is capped at two (`MAX_BIND_DEPTH`). Nothing in the design system renders a
fourth-level heading as anything but a heading in the body copy, so deeper
headings stay in the prose and simply stop being chapter candidates.

---

## The three steps, and why they are three requests

| Action | What it does | What it writes |
| --- | --- | --- |
| `extract` | Parses the upload, extracts the structure, proposes a binding | A `template_conversions` row at `review` |
| `propose` | Re-scores the **stored** Markdown against a different format | `binding`, `bound_format`, the three counts |
| `render` | Renders the confirmed binding through WeasyPrint | `succeeded`, the file, the counts, the snapshot |

They are separate because a person sits between them.

`proposeBinding` scores each extracted section against each archetype chapter
and returns its best guess **with the score attached**. Nothing here decides
anything on its own, and that is deliberate: a wrong automatic binding produces
a document where the "Serviceability" chapter is filled with the fee schedule,
which looks entirely correct and is completely wrong. A visible low score is
recoverable; a silent mismatch is not.

`propose` re-reads the stored Markdown rather than the upload, so trying a
second format costs nothing. Parsing a PDF is the slow and expensive half.

### The scorer is intentionally simple

0.7 × token overlap, 0.22 × order proximity, 0.08 × shape, and **zero if no word
is shared**. That last clause is not a tidy-up; it is a defect fix. With seven
chapters and seven sections, order and shape alone created enough score for the
greedy pass to bind every one, so a "Fee Schedule" section landed on "Next
Steps" purely because it sat in a comparable position — and the appendix, which
exists to catch precisely this, was left empty.

The binding is greedy and one-to-one. A section bound twice prints the same
three paragraphs in two places and looks entirely deliberate.

Measured against a realistic seven-section borrowing-capacity template, the
proposal binds five chapters at 87–100 and leaves two unfilled, sending four
sections to the appendix. "Servicing & Buffers" does *not* bind to
"Serviceability" — no shared token — and that is the conservative outcome the
review screen exists to let a person correct by hand.

---

## Three things a chapter can be

- **bound** — a section of the upload plays this chapter. Its prose is set.
- **unfilled** — the format has this chapter and the template offered nothing.
  It is still printed, with a line saying the live report will supply it,
  because dropping it would change the format's own structure.
- **appendix** — a section of the upload no chapter wanted. Printed at the back
  rather than discarded.

That third case is the one worth stating plainly. It is tempting to drop unbound
sections — they are, by definition, the ones the format has no place for. But
somebody chose to put them in their template, and a converter that silently eats
a third of an upload is a converter nobody trusts twice.

---

## Defects found by rendering, and fixed

**C1 — the depth baseline was wrong for the commonest document shape.** One `#`
title over a run of `##` sections made every real section depth 2, so the review
screen reported "0 sections, 8 sub-sections" for a document that plainly has
eight. `extractStructure` now treats a lone shallowest heading as the title and
takes the baseline from the level below it — the same resolution the Report Q&A
migration reached in `chapterLevelOf`.

**C2 — the scorer bound everything.** See above: `if (!shared) return 0;`.

**C3 — the archetype page band was fatal.** A converted draft is not an instance
of the format; it carries appendix chapters the format never has. A seven-chapter
template with four unmatched sections lands at 13 pages against Borrowing
Capacity's `[4, 12]`, which is correct output. The band is now advisory, surfaced
as `bandNote` and shown on the review screen; every other rule `validateSpine`
enforces — illegal slots, duplicate ids, a document with no chapters — is a real
defect here too and stays fatal.

**C4 — the document printed a contents page the format does not have.**
`buildSpine` adds a contents entry only when the archetype declares one, and
Borrowing Capacity declares `contents: false` because a short format does not
carry one. The renderer printed one regardless. Two consequences: the draft
stopped opening *as* the format it claimed to be bound to, and the page budget
under-claimed by exactly one on every render, because the spine costed a page the
document was not printing. Confirmed against WeasyPrint — claimed 13, actual 14 —
and closed by reading the answer back off the spine rather than deciding it
twice. All four fixtures now claim exactly what they render.

---

## Brand design systems

A name, a brand colour, and a full `ReportDesignOptions`. That is the whole
surface, deliberately — it is exactly the surface the report design system
already reads, so a saved system is a *position* on the existing rendering path
rather than a new one. Every migrated format picks it up for free.

A system can be authored in the form or drafted by Claude from a brief. Both go
through `readBrandDesignSystem` and both are gated on `auditBrandDesignSystem`;
which end the value came from is not one of their inputs.

### The palette is never stored

`brand_design_systems` holds the brand hex and the options. The palette is
resolved at render time, every time. Storing it would freeze it against the
preset it was derived under, and presets disagree about the paper grounds —
`minimal_ink` has a champagne `paperAlt` where `signature` has ivory, and a
stored `accentOnPaper` derived against one is not legal on the other. That exact
bug is recorded in `brandResolve.pure.ts`.

### The audit is a backstop, not a common failure

`resolveReportPalette` already corrects the two accent roles against the worst
ground each prints on, so most hues a model or a person picks are *rescued*
rather than refused — a near-white `#FBF8F0` comes back as a legible darkened
accent rather than an error. `auditPaletteContrast` then checks every ink role
against every ground, and a system that still fails is refused with the failing
role, its ratio and its floor named. In practice that only happens if a preset is
added without its grounds being checked; running it anyway is what turns "we
derive contrast correctly" from a claim into something the route can refuse on.

Refused, not corrected. Nudging the hue until it passes hands somebody a colour
nobody chose, under a name that says it was designed for them.

---

## The source never becomes a stored file

The upload's bytes arrive in the request and the extracted Markdown is stored on
the row. No bucket for the source, so an abandoned conversion leaves no orphaned
object — which matters here because the repo's artifact retention job
(`pdf-import-retention`) is dry-run by design and never deletes anything.

The cost is a request-size ceiling: `MAX_SOURCE_BYTES` is 6 MB, checked in the
browser and again on the route.

A `.md`/`.txt` source is decoded and needs no model at all. A PDF is transcribed
to Markdown by Claude, sent as a `document` content block so a scanned template
goes through the same path as a native one rather than needing an OCR branch.
The prompt asks for ATX headings above everything else — headings are the only
thing `extractStructure` reads, and a transcription with none produces a
one-section document and a notice saying so — and forbids summarising,
reordering or improving. A converter that quietly rewrites somebody's template is
not a converter.

---

## Where the output lands, and why it is a new bucket

`converted-templates`, private.

Not `report-templates`, where the Template Builder's own assets go: that bucket
is **public**, and its public-ness is load-bearing — asset URLs from it are
embedded in saved template JSON (`secure-storage:52`). A converted draft carries
whatever prose was in somebody's uploaded template, which does not belong behind
a guessable public URL.

Not `template-import-artifacts` either, private though it is: that bucket belongs
to the PDF import subsystem, whose monitoring reports any object it cannot tie to
an import as an orphan (`pdf-import-monitoring:149`). Borrowing it would create a
standing false alarm.

The path carries the conversion id and the upload is `upsert: true`, because
re-rendering one conversion after changing its binding is the normal way the
screen is used and each render is the current draft of that conversion.

---

## Access

Both routes gate on `templates` / `can_edit` — the module the Template Builder
page is already guarded by. Creating a design system is an edit even though
nothing client-facing changes, because it decides what every generated document
looks like.

`convert-template-document` additionally re-checks ownership on `propose` and
`render`: a conversion is readable by whoever asked for it and by superadmins.
The table's RLS says the same thing, but the route runs as service role, so it
has to say it again itself.

The binding a person confirms is re-validated on arrival. `readBindingPlan`
re-checks every `sectionIndex` against a structure re-derived from the stored
Markdown — not against the stored `structure` column, which is a convenience for
the review screen — so a hand-edited jsonb column cannot point a chapter at a
section that is not there. An out-of-range index becomes `null` rather than an
error, because "this chapter has nothing bound" is a state the document already
handles.

---

## What stays

Nothing is replaced. `ImportPdfDialog` and `parse-template-document` bring a PDF
into the visual editor as an editable template; the converter refurbishes one
onto the report design system and binds it to a report format. Different
destinations, and both buttons sit side by side on the Template Builder header.

---

## Deliberate losses

- **Layout.** By design. See the top of this document.
- **Emphasis inside table cells.** The shared Markdown renderer sets pipe-table
  cells as plain text.
- **Headings past level two.** Kept in the prose, no longer chapter candidates.
- **Sections under `MIN_SECTION_CHARS` (40).** A section that short is a label.
  Counted in `notices.tooShort` and reported, not silently dropped.
- **Anything past `MAX_SECTION_CHARS` (12 000) or `MAX_SOURCE_CHARS` (400 000).**
  Counted in `notices.charsOmitted`.

---

## Formats it can bind to

`FORMAT_CHAPTERS` currently declares one: **Borrowing Capacity Assessment**
(Position Summary, Income, Commitments, Serviceability, Capacity & Scenarios,
Assumptions, Next Steps). The titles are taken from the shipped renderer rather
than invented — bind to "Serviceability" here and the Borrowing Capacity
renderer's serviceability chapter is what receives it.

Adding a format is one entry in `FORMAT_CHAPTERS`; `bindableFormats()` drives
both the route's validation and the page's dropdown, so nothing else has to
change.

---

## Deployment

1. Apply `20260823000000_template_converter.sql`. It creates both tables, the
   `converted-templates` bucket and its policies.
2. Deploy `convert-template-document` and `generate-brand-design-system`.
3. `ANTHROPIC_API_KEY` must be set for PDF sources and for drafting a design
   system from a brief. Without it, `.md`/`.txt` sources still convert and the
   route says so rather than failing opaquely.
4. `WEASYPRINT_SERVICE_URL` + `WEASYPRINT_SERVICE_TOKEN`, as for every other
   render route.

The DDL was executed against production inside a transaction — including the
bucket insert, the storage policy, both foreign keys and a full insert/update
round-trip — and rolled back; `to_regclass` confirmed null afterwards.
