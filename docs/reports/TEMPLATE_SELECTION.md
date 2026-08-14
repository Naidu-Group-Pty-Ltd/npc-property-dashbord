# Choosing the template a report comes out in

Read this before touching `reportTemplateSelection.pure.ts`, the picker, or
anything in the generation path that decides which `report_templates` row a
document is drawn from.

---

## What did not exist

A template reached a document by **ranking alone**. `resolve_report_template()`
sorts the active rows for a report type by scope, then variant, then priority,
then recency, and takes the first. That is a good tiebreak and a bad interface:

- **Nobody chose.** There was no surface anywhere in the product that bound a
  template to a report format for generation.
- **Nobody could see.** The person pressing "Premium PDF" could not tell which
  template their document would come out in, or that it had changed.
- **The only door was an editor.** Every path that touched a template ended in
  `/admin/template-builder/:id` — `UseTemplateDialog` navigated there
  unconditionally on success. Choosing is not editing, so people were being sent
  into a page-design editor to express a preference, and what they got at the
  end of it was a *working copy*, which is inactive and therefore cannot be what
  a report is generated from at all.

This is the chooser that was missing. It navigates nowhere.

---

## The shape

| piece | what it is |
| --- | --- |
| `report_template_selections` | one row per (user, format): the template that user's reports of that format use |
| `_shared/reports/reportTemplateSelection.pure.ts` | the rules — what may be chosen, and what a stored choice resolves to |
| `manage-templates` | the only reader and writer, scoping every operation to the session user |
| `useReportTemplateSelection` | the two queries and two mutations every surface shares |
| `ReportTemplatePicker` | the dialog |
| `ReportTemplateSelector` | the line above a generate button |
| `ReportTemplateBindings` | every format at once, on the Templates page |
| `routeReportThroughTemplate({ templateId })` | the generation path honouring the choice |

**A selection is read before the ranking, never instead of it.** No row means
today's behaviour, byte for byte. That is what makes this safe to ship against
1,317 existing generation runs.

---

## Four rules that keep biting

### A format has several spellings and they are one format

`compass`, `investment_compass`, `investment_report` and `property_investment`
are all the Investment report, and `manage-templates` will activate a template
stored under any of them (`PRODUCTION_REPORT_TEMPLATE_TYPES`). A picker matching
the raw `report_type` column would show a different set depending on which
spelling a template happened to be saved under, and a selection keyed on the raw
column would be a *different selection* for each spelling.

Everything goes through `normaliseReportType`, and a selection is stored under
the normalised key. That map now lives in the pure module and
`src/lib/reportTemplate/adapters/index.ts` re-exports it, because two copies is
exactly how `commercial_industrial` came to be a spelling the broker would
**activate** and the registry would then resolve to **no adapter at all** — a
template that could be published, could not be picked, and rendered nothing.
`reportTemplateSelection.spec.ts` reads `PRODUCTION_REPORT_TEMPLATE_TYPES` out
of the broker's source and fails when any spelling in it does not land on an
adapter.

### Selecting is not approving

Every entry in the picker is already `is_active`, and a row only becomes active
by passing `validateReportTemplateUpdate` — superadmin, approved, a production
adapter for the type, and a schema that renders. So choosing is choosing among
things somebody else already approved, and it needs no module permission of its
own. Gating it on `templates:edit` would mean the people who generate reports
could not choose which template they use.

The house default stays where it already lives: `is_default` and `priority` on
`report_templates`, applied by the ranking when nobody has chosen.

### A chosen template that will not be drawn has to say so

`routeReportThroughTemplate` skips anything whose `engine` is not `weasyprint`
and the caller falls through to the legacy generator. That is one of the four
silent fall-throughs [`COVERAGE.md`](./COVERAGE.md) measured, and the reason
**80 of 81** template rows draw nothing. Such a template is still selectable —
it is what the ranking would have picked anyway — but both the picker and the
control beside the generate button label it, because "chosen" and "used" are
otherwise indistinguishable from outside.

### A selection can go stale without being deleted

The template can be deactivated, or retyped onto another format, and the row
still points at it. `resolveTemplateSelection` answers **`unavailable`** for
that — a third status, not a collapse to `none`. Generation falls back to the
ranking either way; the difference is that the fallback is *said out loud*,
because a document quietly changing template under somebody is the failure this
whole feature exists to prevent. `routeReportThroughTemplate` re-reads the row
server-side and applies the same rule, so a stale id in the browser cannot
resurrect a retired template.

---

## Ownership, and why it is in the broker

`report_template_selections` has RLS enabled and **no policy**, and no grants to
`authenticated`. Every read and write goes through `manage-templates`, which
holds a service-role client — and a service-role client bypasses RLS, so
ownership has to be enforced in the broker or not at all. It is the same
treatment `comparison_analysis_templates` already gets there, for the same
stated reason.

Three things the broker does, all asserted in
`reportTemplateSelection.spec.ts`:

- `list` is `.eq('owner_user_id', userId)` **before** the caller's filters are
  applied, so no filter combination enumerates anyone else's choices;
- `get` / `update` / `delete` re-check ownership by id and answer 404 otherwise;
- `insert` / `upsert` stamp `owner_user_id` from the verified session and
  **drop a caller-supplied `id`** — the upsert names `(owner_user_id,
  report_type)` as its conflict target, and a primary key in the body would be a
  second, unscoped way to address a row that is not yours.

`UNIQUE (owner_user_id, report_type)` is what "locked in" means: choosing again
replaces the answer rather than adding a second one, in the database rather than
by convention.

---

## What is wired, and what is not

`PremiumPdfButton` — the Investment report's design-system path — reads the
selection and passes it to `tryRouteThroughTemplateBuilder`. The control sits in
`InvestmentReportExportPanel` above the generate buttons, because which template
a document comes out in is a decision *about the document*.

`ReportTemplateBindings` on the Templates page covers **every** format the
adapter registry knows, including the preview-only ones — which say why a choice
would not change anything rather than being silently absent. Formats other than
Investment can therefore be bound today, and the binding is honoured the moment
their generation surface passes `templateId` through the same routing helper.
That wiring is per-surface and deliberately not done in bulk: each format's
generate button reaches its renderer by its own path, and
[`COVERAGE.md`](./COVERAGE.md) is the list of which paths those are.

`UseTemplateDialog` no longer navigates into the Builder on success. Creating a
working copy and editing one are now two buttons instead of one action with a
side effect — the copy is inactive either way, so there was never anything about
it that had to be finished in an editor.

## The choice has to reach the document, on every format

The picker lists every format the adapter registry knows and tells the reader
"a choice is kept for every report of that format until it is changed here".
That was true of one format. `PremiumPdfButton` passed the chosen id into the
Compass route; the shared path every other format's delivery goes through —
`tryTemplateDocument` — did not accept one, so on the other eight a selection
was **stored, displayed as `selected`, and ignored by the generator it was a
choice about**. The UI promised something the system did not do, which is worse
than not offering the choice: the person has no way to tell, because a document
still arrives and it looks fine.

`tryTemplateDocument` now resolves the selection itself and forwards it.
Deliberately looked up there rather than threaded through eight `deliver*`
signatures: that would have fixed the surfaces that remembered to pass it and
left the same hole open for the email, attachment and broker-portal paths,
which never touch the picker's hook. The lookup is **not cached** — somebody
who changes their template and generates again expects the new one — and a
failed read resolves by ranking, exactly as it did before selections existed.

Nothing else changes about resolution: the id is still re-read and revalidated
server-side by `loadSelectedTemplate`, and a choice that no longer applies
still falls back to the ranking rather than failing the generation.

### The one format whose choice cannot always be honoured

The 10 Year Cash Flow renders from a projection the modal recomputes in the
browser, and a template renders the stored one. When they differ — which is
the normal case for a report with adviser overrides — the export cannot use a
template without printing different figures from the ones on screen, so it does
not. That is correct, and it used to be silent: the person had chosen a
template and received the standard layout with no explanation, which is
indistinguishable from the choice being broken. The export now says so, and
only to somebody it is news for — a person with a selection for that format who
did not get it.

`templateRouteEnforcement.spec.ts` holds the whole contract for every format at
once: each production format has an adapter that can list, route and bind; each
one's delivery path asks for a templated document; that request carries the
chosen template; and a format whose choice cannot change anything says so.

## The choice belongs where the document is produced

Choosing a template was possible in two places: the Template Library list, and
one export panel. Every other format's download control offered no way to see
or change it — so the answer to "which template is this going to come out in?"
lived a page away from the button that used it, and a person had to know that
page existed at all to find it. Nobody should have to learn a settings screen to
answer a question about the button in front of them.

All nine production formats now carry the control at the point of download.
Two presentations over one hook, one picker and one stored selection:

- **`useReportTemplateMenu`** — a labelled section at the foot of a download
  menu, for the seven surfaces that are split buttons with a dropdown of
  destinations. It states the current template and opens the picker.
- **`ReportTemplateSelector`** — the row form, for surfaces that are not menus:
  the Market Intelligence options popover, the Commercial & Industrial card
  header (once for the card, since every row's Generate report uses the same
  per-format choice) and the Investment export panel it was written for.

Three rules the hook keeps:

- **A format a choice cannot change offers none.** Preview-only formats render
  nothing rather than a control that does nothing — the Library page is where
  they explain why.
- **The picker is rendered outside the menu that opens it.** Radix unmounts
  `DropdownMenuContent` on close, so a dialog inside it opens and vanishes in
  the same frame. The hook returns the section and the dialog separately for
  exactly this reason, and `templateRouteEnforcement.spec.ts` asserts no
  surface puts the dialog inside its own menu.
- **A failed read is not "nothing chosen"** — it says the check failed *and*
  that generation is unaffected, because a person who reads only the first half
  has no way to know whether their download still works.

`templateRouteEnforcement.spec.ts` also holds the format→surface map complete
against the adapter registry, so a tenth format cannot ship with a download
control that offers no way to choose its template.

## The choice was empty on eight of nine formats, and why

The picker draws from `report_templates` where `is_active`, and for eight of
the nine production formats that set was empty — not by fault but by
architecture. The library's only exit (`instantiate`) deliberately creates
inactive user drafts ("nothing about a fresh copy is live"), and the only
surface that sets `is_active` is the Builder's superadmin Activate button, one
approved template at a time. No migration, script or seed had ever produced an
active row for borrowing_capacity, cashflow, client_details,
commercial_capacity, comparison, market_intelligence, portfolio or qa. So the
menus shipped above stated, correctly, that there was nothing to choose — and
every document fell back to the legacy generator, which is the coverage number
`COVERAGE.md` measures.

`supabase/migrations/20260814190000_activate_production_masters_eight_formats.sql`
seeded one master per format: Private Banking, variant A — "Chancery", the
drawn reference of the catalogue's leading family, copied from
`template_library_entries` in exactly the state the activation gate produces
(approved, active, global, weasyprint, a production adapter for the type — the
contract in `reportTemplateInsertGuard.pure.ts`). It records lineage the way
`instantiate` does, skips any format that already has an active template — so
a re-run is a no-op and a hand activation is never displaced — and can only
insert. `productionMasterSeed.spec.ts` pins those properties, and pins that the
seeded spellings are the adapters' own routing strings verbatim, because the
ranking fallback matches `report_type` with a raw `eq` and a template stored
under a spelling no adapter emits can be picked but never resolves.

The behavioural consequence is deliberate and worth stating plainly: a format
whose ranking used to resolve nothing now resolves a WeasyPrint master, so
documents with **no stored selection** route through the design system instead
of the legacy generator. A stored selection still beats the ranking, every
failure path still falls back to legacy, and deactivating the master returns
the format to exactly its previous behaviour.

## The library is the choice, not a place the choice points at

The picker used to list only rows already in `report_templates` — after the
seed, one master per format — while the fifty designs the library holds per
format were reachable only through the Library page, and only as *editing*
copies (`instantiate` deliberately creates inactive drafts). Choosing a design
for generation is a different act, so the picker now offers the library
directly: the format's published, production-ready, WeasyPrint designs, grouped
by design family with the family's curated colourways beside them, on every
download surface at once.

The path from the catalogue to a choice is `use_for_reports` in
`manage-template-library`: given an entry (and optionally a colourway), it
returns a **selectable** `report_templates` row — active, approved,
**user-scoped**, every safety-critical field fixed server-side. It carries the
same authority bar as `instantiate` (module `can_edit`), because the copy it
creates is visible only to its owner and can only ever affect that owner's own
documents — the superadmin activation gate protects the *global* candidate
set, which this operation cannot touch. `validateEntryForReportUse` refuses
anything the render path would silently drop (unpublished, preview-only,
non-WeasyPrint, no production pipeline), because a selection that changes
nothing is worse than a refusal with a reason.

Four rules carry the tie-up, pinned by `reportUseCopy.spec.ts` and
`reportTemplatePickerLibrary.test.tsx`:

- **Adoption is idempotent on (entry, entry version, colourway).** Reuse is
  matched on the `libraryLineage` block, global rows first — so adopting the
  house default finds the seeded master rather than minting a private
  duplicate of it, and asking twice returns the same row.
- **The entry's default colourway is recorded as null** — the authored
  palette, unbaked — which is how the seeded masters record it. This is NOT
  what `instantiate` does (it resolves and bakes the default); baking here
  would stamp the default's id into the lineage and break the reuse match.
- **An active row that descends from a listed design is folded into that
  design's row** (the picker fetches `config->libraryLineage` as its own tiny
  column, never `config`), so one choice never looks like two. Hand-built
  templates and the Compass pilot keep their own rows.
- **A library version bump is a different design.** A copy of v1 is never
  reused for a v2 pick — the user chose the design as the library shows it
  now — and the stale copy simply stops being offered.
