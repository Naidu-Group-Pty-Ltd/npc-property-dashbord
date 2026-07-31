# Template Library — Implementation

What was built, and the judgements behind it. Supersedes the "planned" framing
in [`03-roadmap.md`](./03-roadmap.md) for PRs 2–5, which are delivered.

---

## 1. The tenancy judgement

The instruction was that the template functionality should be **visible and
usable by tenant**. The assessment established that this codebase has no
organisation, tenant or agency table — `whitelabel_settings` is a documented
singleton, and `report_templates.agency_id` is an orphan column whose own
migration says no membership relation exists.

Two ways to honour the instruction:

**Option A — build a tenancy model.** Organisations, memberships, a resolver,
and RLS across every existing template table.

- *Advantages:* delivers the literal ask; unlocks per-tenant catalogues later.
- *Disadvantages:* a cross-cutting change to the platform's identity model,
  driven by a template feature. It would require altering `report_templates`
  RLS, `applyReportTemplateReadScope`, and the resolver — the three things this
  work was explicitly told not to touch. It also invents a model without knowing
  how the business actually segments customers.
- *Verdict:* **rejected.** The blast radius is the whole platform, and the
  requirement was stability over speed.

**Option B — treat the deployment as the tenant.**

- *Advantages:* it is what the platform already is. `whitelabel_settings` being
  a singleton means one deployment carries one brand and one customer. Every
  authenticated user of this deployment is a member of that tenant by
  definition, so a published library entry is tenant-visible with no new
  infrastructure. Zero change to any existing table or policy.
- *Disadvantages:* one deployment cannot host two catalogues. That is a real
  ceiling, and it is the same ceiling the rest of the platform already has.
- *Verdict:* **adopted.**

### What that means in practice

| Question | Answer |
| --- | --- |
| Who sees the library? | Every authenticated user with `templates:view`. The tab is on the existing Template Management page. |
| Who can use a template? | Every user with `templates:edit` — the same permission creating a Builder template already needs. |
| Who owns a working copy? | The user who created it. The server stamps `scope='user'` and `owner_user_id` from the verified session. |
| Who can publish to the library? | Superadmins only. |
| Is a working copy private? | Yes. `applyReportTemplateReadScope` in `manage-templates` already restricts non-superadmins to `scope='global' OR (scope='user' AND owner_user_id = me)`. |

That last row is worth dwelling on, because it is **stricter than the Builder's
own behaviour**. `useReportTemplateMutations().create` sets neither `scope` nor
`owner_user_id`, so a template created by the "New template" button falls to the
column default `scope='global'` and is readable by every authenticated user.
A library working copy is user-scoped from birth. Existing Builder behaviour is
unchanged — the new path is simply better isolated.

`visibility` on the entry is CHECK-constrained to `('global','agency')` and only
ever written as `'global'`. When a tenancy model arrives, `'agency'` becomes
usable without a column change. Nothing in the UI implies tenant segmentation
exists today.

---

## 2. Why instantiation is server-side

The obvious implementation was to call `manage-templates` `insert` from the
browser with a payload built client-side — that is what
`TemplateBranchingDialog` does for branches, and it reuses the existing broker.

Tracing that path revealed why it is the wrong choice here.
`manage-templates`' insert branch runs no validation:

```ts
if (operation === 'insert' && data) {
  const { data: record, error } = await supabase.from(table).insert(data).select().single();
```

`validateReportTemplateUpdate` — the function enforcing "superadmin **and**
approved **and** has a production adapter" before a template may go live — is
only wired into the `update` branch. On insert, the caller's payload reaches
Postgres as-is. A client can therefore name its own `owner_user_id`, `scope`,
`is_active` and `is_default`.

So the library builds the row **in the edge function**, from the verified
session. `manage-template-library` constructs every safety-critical field
itself; the request body contributes only a name and an optional description.
There is no code path by which a library caller can produce an active, default,
global or foreign-owned template.

> **Closed, with approval.** The gap above was reported rather than silently
> worked around, and the fix was held until it was explicitly approved —
> `manage-templates` is the live Builder write path and the brief protected it
> absolutely. It is now closed; see §2a.

---

### 2a. The insert gate

`supabase/functions/_shared/reportTemplateInsertGuard.pure.ts` applies four
rules to `report_templates` inserts. They mirror the update path, so insert and
update can no longer diverge.

| # | Rule | Status |
| --- | --- | --- |
| 1 | Creating a row already `is_active` or `is_default` requires superadmin **and** `approval_status='approved'` **and** a report type **and** a production adapter **and** a renderer-safe schema | 403 / 422 |
| 2 | A non-superadmin cannot create a row that is already `approved` | 403 |
| 3 | A non-superadmin cannot name another user as `owner_user_id` | 403 |
| 4 | A non-superadmin cannot create an `agency`-scoped row | 403 |

Rule 1 is the one with the production blast radius, and it is reported first
when several rules are broken, so the caller is told about the important one.

**The diff to the broker is 32 insertions and zero deletions.** The update,
delete and read-scoping paths are byte-identical; that is asserted, not assumed.

**Why it cannot break the Builder.** Only two call sites insert into
`report_templates` through this broker, and both are unaffected by construction:

- `useReportTemplates.ts` "New template" sends `is_active: false`,
  `is_default: false`, and no `scope`, `owner_user_id` or `approval_status`.
- `TemplateBranchingDialog.tsx` sends `is_active: false`, `is_default: false`,
  `approval_status: 'draft'`, and inherits `scope`/`owner_user_id` from a row
  the caller could already read — global (owner null) or their own.

`reportTemplateInsertGuard.spec.ts` **replays both payload objects verbatim**
and asserts the gate returns null, including the superadmin, service-role and
own-user-scope variants. If a future change to either flow trips the gate, that
suite fails before a user does.

Rejection is preferred over silent coercion throughout. Quietly rewriting a
caller's payload would hide the intent from whoever has to debug it later.

---

## 3. What shipped
---

## 3. What shipped

### Data (`20260801090000_create_template_library.sql`)

Three new tables. **No `ALTER TABLE`, no data migration, no change to any
existing policy, index, constraint or function.**

| Table | Purpose |
| --- | --- |
| `template_library_entries` | The catalogue. 40 columns, six indexes, CHECK constraints on every enumerated field. |
| `template_library_instantiations` | Lineage: entry + exact version → working copy. `ON DELETE SET NULL` on the template so usage history outlives a deleted copy. |
| `template_library_events` | Publish / deprecate / archive trail. Needed because `template_audit_log.template_id` is `NOT NULL` with an FK to `report_templates`, so library-side actions cannot go there. |

RLS: authenticated users may `SELECT` published entries and nothing else.
Lineage and events are service-role only. **No write grant to `authenticated`
on any of the three tables** — every mutation goes through the broker.

### API (`manage-template-library`)

| Operation | Permission | Notes |
| --- | --- | --- |
| `list` | `templates:can_view` | Scalar projection only — never selects `schema` |
| `get` | `templates:can_view` | Non-superadmins are pinned to `status='published'` |
| `instantiate` | `templates:can_edit` | Builds the working copy server-side |
| `promote` | superadmin | Builder template → catalogue draft |
| `save_draft` | superadmin | Editing a **published** entry creates the next version as a draft |
| `publish` | superadmin | Runs the validation gate; retires the previous published version in the family |
| `deprecate` / `archive` / `restore` | superadmin | Soft transitions; **no hard delete exists** |
| `events` | superadmin | Governance trail |

Authorisation is deny-by-default: `list`/`get` need view, `instantiate` needs
edit, and **every other operation falls through to `requireSuperadmin`** — so a
future operation is superadmin-only until someone deliberately lowers it.

Publish-time validation, all derived server-side from the schema and never
trusted from the caller: page count, block types used, required bindings,
brand-safety (no literal colour in a colour-ish field outside `tokens`),
production-readiness (report type has an adapter **and** every block is in the
production allow-list), orientation, and the page-1 preview schema.

### UI

| Component | Role |
| --- | --- |
| `TemplateLibraryTab` | Ninth tab on Template Management, behind the feature flag |
| `TemplateLibraryFilters` | Search, sort, six filter axes as `aria-pressed` toggle buttons |
| `TemplateLibraryCard` | Schematic preview, taxonomy badges, compatibility badge |
| `TemplatePreviewSvg` | Page rendered as SVG from the schema — no stored image, no PDF round-trip |
| `TemplatePreviewDialog` | Page-by-page preview, components used, report data used, compatibility |
| `UseTemplateDialog` | Name the copy, create it, navigate to the Builder |
| `TemplateLibraryAdminPanel` | Superadmin-only: promote, edit metadata, publish, deprecate, archive, restore |

### Catalogue content

Twelve templates ship with the feature, generated by
`scripts/template-library/` and seeded through
`20260801093000_seed_template_library.sql`. The migration upserts on
`(slug, version)`, so re-running it updates the seeded rows, never duplicates
them, and never touches an entry an operator promoted themselves.

| Template | Category | Pages | Production-ready |
| --- | --- | --- | --- |
| Investor Compass | investment | 10 | yes |
| Executive Brief | investment | 4 | yes |
| Property Snapshot | investment | 2 | yes |
| Due Diligence Dossier | investment | 5 | yes |
| Suburb Market Compass | suburb | 5 | preview only |
| Suburb Snapshot | suburb | 2 | preview only |
| Postcode Market Analysis | postcode | 5 | preview only |
| Statewide Market Review | statewide | 5 | preview only |
| Property Comparison Matrix | comparison | 4 | preview only |
| Ten-Year Cash Flow Projection | cash_flow | 6 | preview only |
| Client Fact Find | client_form | 4 | preview only |
| Compliance File Review | compliance | 5 | preview only |

Every category the filter chips offer has at least one template, so no filter
returns an empty grid. "Preview only" is the adapter limitation from decision
D2, not a defect in the template.

The schemas live in the database, not the bundle. That is checked, not assumed:
a build-output grep for seed-template content finds nothing in `dist/`. The
Builder's own list documents why it matters — PDF-imported schemas can reach
hundreds of megabytes, and a bundled catalogue would cost every user on first
paint, including those who never open the library.

Authoring rules the generator enforces before it will emit a migration:

- the schema parses against the **live** `ReportTemplateSchema`, not a copy;
- every block type is in the production renderer allow-list;
- the entry passes the same publish gate the API applies;
- no page is empty;
- every colour is a `token:*` reference, so `brand_safe` is true and a partner
  palette applies in full.

### Previews
### Previews

Card and preview thumbnails are **SVG drawn from the schema at render time**.
No image is stored and no PDF is rendered on the browse path.

This is a direct consequence of a finding: `render-template-pdf` uploads to the
private `investment-reports` bucket and returns a **24-hour signed URL**. A
thumbnail persisted from that response would be a broken image the next day. The
SVG approach also stays correct when an entry is edited, costs nothing, and
follows `PageTemplatesMarketplaceDialog`, which already previews starter presets
the same way. `thumbnail_path` and `preview_image_paths` exist on the table for
a future public-bucket hero image; they hold **paths, never signed URLs**.

---

## 4. Verification

`npm install` succeeds in this environment, so the real toolchain ran — these
are measured results, not simulations.

| Check | Result |
| --- | --- |
| `npx vitest run src/lib/templateLibrary` | **265 passed**, 7 files |
| `npx vitest run src/lib/reportTemplate` (2,744 tests) | **18 failures — byte-identical to `origin/main`.** Compared by test name against a clean worktree: 0 new, 0 fixed. |
| `npm run lint` | **43 errors / 2,077 warnings — identical to `origin/main`** with these changes stashed and applied. Zero new. |
| `npm run build` | Succeeds. Seed templates confirmed absent from `dist/`. |
| `npm run audit:style` | Byte-identical to `main` (846 / 341 / 97 / 25). |
| `tsc --noEmit -p tsconfig.app.json` | Clean |
| Seed catalogue generator | 12 templates validated against the live Zod schema and the production allow-list |
| Edge-function contract tests | 10 failures / 121 passed — identical to `origin/main` |
| Visual render | Three templates rendered through the production HTML renderer and screenshotted in Chromium |
| Edge-function syntax | All four functions parse clean (Deno is unavailable here, so this is a TypeScript parse check, not a typecheck) |

The decision logic lives in `_shared/templateLibraryCore.pure.ts` — a Deno-free
module the frontend suite imports directly, following the existing
`claudeReconstruct.pure.ts` precedent. That is deliberate: an earlier revision
tested the edge function by scanning its source, which can only prove a literal
has not changed. The tests now **execute** the rules, including the one that
matters most — that a working copy is built with `is_active: false`,
`approval_status: 'draft'`, `created_by: null` and a server-stamped owner, and
that a tampered catalogue row cannot talk it out of any of those.

### Two real defects the render tests caught

Both were in the seeded templates, and neither would have been visible from
schema validation alone. They are the reason the tests render rather than parse.

1. **`{{binding}}` printed literally into the output.** `scorecard.items[].rating`
   and `risk-register.items[].rating` / `.confidence` select a chip colour from
   a fixed palette (`blocks/_chips.html.ts`) and are deliberately **not** passed
   through `resolveBindable`. Binding them printed the braces into the report.
   Fixed by using vocabulary values, and a test now asserts every seeded
   template stays inside that vocabulary.

2. **`0.04%` where `3.84%` belonged.** The `percent` filter formats the number
   it is given and does not multiply by 100, so a yield must be supplied as
   `3.84`, not `0.0384`. The templates were right and the sample data was wrong,
   but the failure mode — a plausible-looking wrong number in a customer's
   report — is bad enough that the convention is now documented in
   `scripts/template-library/blocks.ts` where an author will meet it.

## 5. Manual verification checklist

To run against a deployed environment before enabling for users.

**Existing Builder — must be unchanged**

- [ ] Builder tab lists the same templates in the same order as before
- [ ] "New template" creates and opens a template
- [ ] Edit, save and version-snapshot behave as before
- [ ] Delete: inactive succeeds, active → 409, locked → 423
- [ ] "Open in Builder" loads the correct template
- [ ] Formats, Cover Page, PDF, Q&A, Cash Flow, Branding, Settings tabs unchanged
- [ ] A live report generates the same PDF as before
- [ ] `resolve_report_template` returns the same winner for a fixed input

**Library**

- [ ] Tab appears for a user with `templates:view`; disappears with `?templateLibrary=0`
- [ ] Empty state shows when nothing is published
- [ ] Search, each filter axis, filter combinations and clear-filters behave
- [ ] Preview opens, pages navigate, focus is trapped and restored
- [ ] "Use template" is hidden for a view-only user
- [ ] Creating a copy lands in the Builder with the right content
- [ ] The copy is `is_active=false`, `is_draft=true`, `approval_status='draft'`, `scope='user'`
- [ ] Editing the copy leaves the library entry's `schema` unchanged
- [ ] A second user cannot see the first user's copy in the Builder list
- [ ] Admin panel is invisible to a non-superadmin, and its operations 403

---

## 6. What is deliberately still open

| Item | Status |
| --- | --- |
| **Public preview bucket** | Columns exist; the bucket and the publish-time render job do not. SVG schematics cover the browse and preview paths today. |
| ~~**More catalogue content**~~ | **Closed.** Forty templates now ship, at least two per category. See §7. |
| **Live-database E2E** | The browse → preview → copy → Builder journey is covered by unit tests over the real logic and a manual checklist (§5). An E2E run needs a seeded database, which this environment does not have. |
| **Premium tier enforcement** | `access_tier` is stored and displayed but not enforced. Enforcing it means mapping tiers onto `planEnablesSubModule`, which needs the commercial model settled first. |
| **Update notifications** | Lineage records the exact version copied, so "a newer version exists" is computable. Surfacing it in the Builder would mean modifying the Builder. |
| **`manage-templates` insert validation** | Pre-existing gap documented in §2. Needs its own approval and regression run. |

---

## 7. Follow-up: forty templates, and why the grid looked empty

Reported after the first release: *"there are no templates populating — over 40
selectable templates were created but they are not showcasing on the front end."*

Two separate things were behind that, and only one of them was a bug.

### 7.1 The forty were a different product

`public/templates/command-center/` holds 80 `.docx` files — 40 masters and 40
samples — and `CATALOGUE` lists 40 entries. Those are the **Command Center**
document pack. They are not Template Library entries, share no table with them,
and were never wired to this grid. The Library shipped with twelve, which is
what the page was correctly reporting.

So the count was not a bug. The gap between expectation and delivery was real,
and §6 already listed it as open content work. It is now closed: the catalogue
ships **forty** templates.

### 7.2 The thumbnails were a bug

The grid *was* rendering — but every card looked like the same near-blank
rectangle, which is indistinguishable from "nothing loaded".

Root cause, from a probe over the seeded schemas:

```
PROBE investor-compass | page="Cover" bg={"color":"token:bg"} blocks=1
   cover x=undefined y=undefined w=undefined h=undefined
```

Nine of the twelve open on a cover page holding a **single `cover` block that
declares no geometry** — the renderer composes a cover from its props rather
than from a box. The preview drew one stray bar for it and filled the page with
the dashboard's `--card` token, discarding each template's palette. Twelve
distinct documents therefore rendered as twelve identical pale rectangles.

`TemplatePreviewSvg.tsx` now:

- composes a representative cover (eyebrow, wrapped title, accent rule,
  subtitle, footnote) for blocks that imply their own layout;
- resolves `token:*` against **the template's own** `tokens.colors`, so a card
  is drawn in the palette the PDF will use;
- picks ink by Rec. 601 luma, so text bands stay legible on a dark cover;
- gives tables a header rule and alternating rows, charts varying bar heights,
  and media a tinted block — so a card reads as the *kind* of document it is.

No literal colour is authored in the component. Every value comes from the
template data, with the dashboard's own semantic tokens as the fallback. A
template's palette is *content* — the same class of thing as a user's uploaded
logo — which is why it is exempt from the chrome-only token rule.

### 7.3 The seed migration had to be a new file

Regenerating the catalogue rewrote `20260801093000_seed_template_library.sql`,
which is **already applied in production**. Supabase records a migration by its
version prefix and never re-runs it, so that edit would have changed the
repository and nothing else: the 28 added templates would never have reached the
database, and the only symptom would have been a catalogue stuck at twelve —
i.e. exactly the complaint this work started from.

The applied file is restored untouched and the full catalogue goes out as
`20260802093000_seed_template_library_v2.sql`. Because the generated SQL upserts
the whole catalogue on `(slug, version)`, the new file is a complete replacement
rather than a delta, so a fresh database and a long-running one converge on the
same state. `buildSeedCatalogue.ts` now documents this at its `MIGRATION`
constant.

### 7.4 One real defect the render tests caught

`equity-position-report` put `{{equity.lvrLimit | percent}}` in a **table column
header**. `renderDataTableHtml` resolves `rows[].cells` but escapes `headers`
verbatim (`blocks/dataTable.html.ts:22`), so that would have printed literal
braces into a customer's PDF.

This is renderer behaviour that predates this work and is out of scope to
change, so the template was fixed: headers are static labels, and the LVR limit
the column is computed at now appears in the section heading, which *is*
resolved. A new per-template guard test asserts no seeded template puts a
binding in a table header — the same shape as the existing chip-vocabulary
guard, which was earned the same way.

### 7.5 Verification

| Check | Result |
| --- | --- |
| Seed generator over all 40 | ✅ every schema parses against the live `ReportTemplateSchema`, uses only `PRODUCTION_SAFE_BLOCK_TYPES`, passes the publish gate, has no empty page |
| `vitest src/lib/templateLibrary` | ✅ 642 passed — 13 checks per template, including a real HTML render through the production renderer |
| Visual contact sheet, all 40 | ✅ rendered through the real component in Chromium; every card distinct, in its own palette, none blank |
| `vitest src/lib/reportTemplate` | ✅ 18 failures on this branch, 18 on `origin/main`, **compared by test name: 0 new** |
| `npm run lint` | ✅ 43 errors / 2,077 warnings — identical to `origin/main` |
| `npm run audit:style` | ✅ 846/341/97/25 — byte-identical to `origin/main`; the ratchet regression predates this branch |
| `tsc --noEmit` | ✅ clean |
| `npm run build` | ✅ succeeds |

The existing Reporting Engine Builder is untouched. This branch modifies no file
under `src/components/templateBuilder/**`, `src/lib/reportTemplate/**` (except a
test-only spec), `src/pages/Templates.tsx`, `supabase/functions/**`, or any
applied migration.
