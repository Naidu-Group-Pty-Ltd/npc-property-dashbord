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

> **Pre-existing finding, deliberately not fixed here.** The insert gap above
> exists on `main` and is reachable by anyone with `templates:edit` today,
> independently of this feature — the Builder's own client happens to send safe
> values. Closing it means adding validation to `manage-templates`' insert
> branch, which modifies the live Builder write path. That is a separate change
> needing its own approval and its own regression run. It is recorded here
> rather than silently worked around: this feature does not widen the gap, and
> routing instantiation server-side means it does not depend on it either.

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

`vitest`, `eslint` and `vite` are absent from this container, so the pure logic
was extracted and executed directly under Node to produce real results rather
than assumed ones. The committed specs cover the same assertions for CI.

| Check | Result |
| --- | --- |
| `tsc --noEmit -p tsconfig.app.json` | Clean |
| Feature-flag precedence, 24 assertions | Pass |
| Filter / sort logic, 24 assertions | Pass |
| Production allow-list parity with `manage-templates` | Pass — 64 block types, 5 report types, sets identical |
| Working-copy payload safety, 22 assertions | Pass |
| `npm run audit:style` | Byte-identical to `main` (846 / 341 / 97 / 25). Zero new violations. |
| `SECURITY_REGISTRY.json` still parses | Pass |

The payload assertions are the ones that matter most. They read the edge
function's source and fail if the working-copy insert ever gains
`is_active: true`, loses `created_by: null`, stops defaulting `config`, or
starts taking `scope`/`owner_user_id` from the request body.

**Limitation, stated plainly:** the safety and parity specs are source-level.
They catch a changed literal, not a changed control flow, and they cannot
execute the Deno function. They complement the manual checklist below; they do
not replace it.

---

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
| **Catalogue content** | The library ships empty. Entries are created by promoting Builder templates — authoring 30–40 designed templates is content work, not platform work, and seeding schemas through a migration would have shipped hard-coded template data. |
| **Public preview bucket** | Columns exist; the bucket and the publish-time render job do not. SVG schematics cover the browse and preview paths today. |
| **Premium tier enforcement** | `access_tier` is stored and displayed but not enforced. Enforcing it means mapping tiers onto `planEnablesSubModule`, which needs the commercial model settled first. |
| **Update notifications** | Lineage records the exact version copied, so "a newer version exists" is computable. Surfacing it in the Builder would mean modifying the Builder. |
| **`manage-templates` insert validation** | Pre-existing gap documented in §2. Needs its own approval and regression run. |
