# Builder / Developer Portal — Phase 3 report

The Builder Projects module.

Baseline: `5a75c29` (Phase 2, PR #1751, merged).
Branch: `claude/builder-portal-phase-3`.

Phase 3 builds developments, projects, project parties, project-level access and
the surfaces that administer and consume them. It builds **no** stages, lots,
units, inventory, reservations, transactions, transaction-case links,
construction tracking, variations, progress claims, inspections, defects,
handover, documents, messages, tasks, pipeline, reporting or AI features.

Nothing was deployed. No production data was touched. The Solicitor Portal was
not modified.

The Solicitor Matters module is the template; the file-for-file map is
`15-phase-3-mirroring-inventory.md`.

---

## 1. What was built

### Database — one additive migration

`supabase/migrations/20260803000000_builder_portal_phase3_projects.sql`

| Object | Kind | Mirrors |
|---|---|---|
| `builder_developments` | table | *(no Solicitor equivalent — Builder domain)* |
| `builder_projects` | table | `legal_matters` |
| `builder_project_parties` | table | `legal_matter_parties` |
| `builder_project_status_history` | table | `legal_matter_status_history` |
| `builder_project_access` | table | `solicitor_matter_access` |
| `builder_tri_state_permissions_valid()` | function | `solicitor_tri_state_permissions_valid()` |
| `builder_enforce_project_access_org()` | trigger fn | `enforce_solicitor_matter_access_firm()` |
| `builder_prevent_project_access_org_drift()` | trigger fn | `prevent_solicitor_matter_access_firm_drift()` |
| `builder_enforce_project_development_org()` | trigger fn | *(Builder domain)* |
| `builder_project_status_history_append_only()` | trigger fn | *(correction)* |
| `builder_resolve_project_permission()` | function | `resolveTriStatePermissions()` + `resolveMatterPermissions()` |
| `builder_accessible_projects()` | function | `listAccessibleMatterIds()` |
| `builder_is_project_transition_allowed()` | function | `is_legal_matter_transition_allowed()` |
| `builder_transition_project()` | function | `transition_legal_matter()` |
| `builder_admin_upsert_project_access()` | guarded command | `upsert_matter_access` operation |
| `builder_admin_revoke_project_access()` | guarded command | `revoke_matter_access` operation |

Also: role defaults seeded for the `projects` permission key, and the Phase 1
activity-log `entity_type` CHECK widened to accept project entities. Both are
additive; nothing previously accepted is now rejected.

### Edge Functions — two, both new

- `builder-portal-projects` (external, `verify_jwt = false`, cookie session)
- `builder-projects-admin` (internal, `verify_jwt = true`, staff JWT + `builder_portal_admin` + CSRF)

Both are registered in `supabase/config.toml` and `SECURITY_REGISTRY.json`, and
both are inside the scoped Deno type-check (now 11 functions).

### Frontend

`src/lib/builderProjects.ts`, `src/lib/builderQueries.ts`,
`src/components/builder-portal/BuilderPortalShell.tsx`,
`src/pages/builder/BuilderProjects.tsx`,
`src/pages/builder/BuilderProjectDetail.tsx`,
`src/components/admin/builder-portal/AdminBuilderProjectsPanel.tsx`.

Routes `/builder/projects` and `/builder/projects/:projectId` sit inside the
governance gate and the portal layout. The Projects navigation item is enabled;
Transactions, Pipeline, Messages and Tasks remain disabled.

---

## 2. Access model

An explicit grant is the whole boundary. Organisation membership alone grants
nothing — verified.

A request resolves in this order:

1. **A live grant must exist.** `builder_project_access`, unrevoked,
   `valid_from <= now()`, `valid_until` null or in the future. No grant → denied
   before anything else is consulted.
2. **The organisation baseline** from Phase 1's `builder_resolve_permission`,
   which already denies forbidden keys, requires an active membership and clamps
   `read_only`. Losing the membership therefore closes the project immediately.
3. **The project-scoped membership override** from the Phase 1
   `scope_type = 'project'` seam.
4. **The grant's own tri-state override** — explicit deny wins, explicit allow
   can raise a false baseline, `inherit` falls through.
5. **Forbidden keys re-asserted**, because steps 3 and 4 can raise the baseline.
6. **`read_only` on the grant clamps writes**, last.

Structural rules enforced by trigger, not convention:

- A grant must name one **exact, non-null** organisation on the side it claims.
- The grantee must hold an **active membership** of that organisation.
- A project's organisations cannot be changed while live grants exist.
- A project must have at least one organisation, and the two sides must differ.

The portal function additionally requires that the grant runs through the
session's **server-held** active organisation, and that the project still names
that organisation on the granted side. A project id, organisation id, role or
permission in the request body is only ever a lookup key.

---

## 3. Defects this phase's own verification caught

Recorded because a report listing only successes is not evidence.

1. **The module would have shipped unusable.** Phase 1 catalogued the `projects`
   permission key but seeded no role defaults, so `builder_resolve_permission`
   returned false for every role and every valid grant resolved to no access.
   Four positive-path assertions failed. Fixed by seeding the role defaults in
   the Phase 3 migration, with a post-migration assertion so it cannot regress.
2. **Seven wrong helper signatures in `builder-projects-admin`.** `verifyAuth`,
   `requireModulePermission` and `createForbiddenResponse` all have different
   shapes than assumed. Caught by the scoped Deno type-check before the function
   ever ran; fixed by copying the Phase 1 pattern exactly, including the
   `service_role`-is-not-a-uuid guard.
3. **Two migration helpers did not exist.** `builder_touch_updated_at` (the real
   name is `builder_touch_row`) and `builder_tri_state_permissions_valid` (never
   created — Phase 1 used typed columns). Caught by applying the migration to a
   real database.
4. **The activity-log `entity_type` CHECK rejected project events.** Phase 1
   constrained it to identity entities. Widened additively.
5. **A withheld project spun instead of surfacing.** react-query retried the 404
   three times with backoff, leaving the user on a spinner. A 4xx is the
   server's answer, not a transient failure; Builder queries no longer retry it.

---

## 4. Validation

Every result below was produced by actually running the command.

| Check | Command | Result |
|---|---|---|
| Phase 1 database verification | `npm run builder:db:verify` | **135/135 passed** |
| Phase 2 database verification | `npm run builder:db:verify:phase2` | **73/73 passed** |
| Phase 3 database verification | `npm run builder:db:verify:phase3` | **76/76 passed** |
| Builder Portal tests | `npm run test:builder-portal` | **270/270 passed** (47 new) |
| Builder security check | `npm run security:builder-portal` | **Passed** — 11 Edge Functions, 19 browser sources |
| Solicitor security regression | `npm run security:solicitor-portal` | **Passed** |
| Builder Edge Function type-check | `npm run typecheck:builder-edge` | **Passed** — 11 functions |
| TypeScript check | `npx tsc --noEmit` | **Passed**, no output |
| Production build | `npm run build` | **Passed** |
| Builder Portal E2E | `npm run test:e2e:builder-portal` | **18/18 passed** in real Chromium |
| Migration reset harness | `npm run builder:db:reset` | 757 migrations; **0 Builder defects** |
| Style-token ratchet | `npm run audit:style` | **No new violations** — identical to baseline |
| Scoped lint | `npx eslint` over Builder sources | **0 problems** |
| Supabase types | `npm run builder:types` | Regenerated; 14 Builder table blocks |

### Not passing — pre-existing, verified identical on the baseline

Re-measured with every Phase 3 change stashed, producing the same result:

- Solicitor contract tests: **116/117**. `all five Solicitor resource functions
  use the shared matter resolver` fails on `solicitor-portal-matters`.
- Style-token counts: 846 / 341 / 97 / 25 — unchanged by this phase.

### Not available

- **Supabase CLI / Docker** — unavailable in this environment, so
  `supabase db reset` cannot run. Mitigated with a real local PostgreSQL 16
  cluster replaying the full migration corpus.
- **282 of 757 historical migrations do not replay** on a plain cluster
  (Supabase-managed extensions, objects created outside the corpus). Pre-existing
  and measured before any Builder file existed.
- **Deployment verification** — nothing was deployed, so no claim is made about
  deployed behaviour. The E2E suite runs against the real build in a real browser
  with every Edge Function call answered locally.

---

## 5. Required test evidence

| Required condition | Where it is proven |
|---|---|
| Users only see projects they are authorised to access | `verify-phase-3.mjs` — "membership alone grants NO project access", "the grant makes exactly one project visible" |
| Access to one project does not provide access to another | "access to one project does NOT grant access to another", "and the second project is absent from the accessible list" |
| Revoked access stops working immediately | "a revoked grant stops resolving immediately", "and disappears from the accessible list immediately" |
| Expired access stops working immediately | "an expired grant stops resolving immediately", "a future-dated grant does not resolve yet" |
| A project can have separate developer and builder organisations | "a project carries separate developer and builder organisations", "the developer side of the same project is granted independently", "both sides can reach the same project" |
| Direct browser database access is denied | "anonymous SELECT on \<table\> is denied" ×5; contract test "the browser reaches project data only through the Edge Function" |
| Internal project administration requires `builder_portal_admin` | Contract tests "the admin function requires internal auth, the module permission and CSRF", "mutating admin operations require can_edit" |
| Audit failure rolls back project access changes | "a grant fails when the trusted audit write fails" + "the grant was NOT created"; same for revocation and transition |
| Existing Solicitor Portal behaviour remains unchanged | `verify-phase-3.mjs` §9; contract test "the Solicitor Portal was not modified by Phase 3"; `security:solicitor-portal` passes; no Solicitor file in the diff |
| No later-phase Builder features were introduced | Migration post-assertion; "no later-phase Builder table was created"; "the Builder function family stops at projects"; "Phase 3 adds no transaction-case link" |

---

## 6. Not started

Phase 4 and everything on the do-not-build list. The portal navigation still
shows Transactions, Pipeline, Messages and Tasks as disabled with an explicit
"available in a later phase" tooltip.
