
# Solicitor Portal — Feature List & Implementation Plan

## 1. Why this shape

The Finance Portal already proves the pattern this codebase wants: a standalone, session-token portal with its own login/invite/auth stack, its own edge functions, its own permission matrix, and an admin surface inside Command Centre. The Solicitor Portal mirrors that skeleton exactly so we inherit auth, notifications, audit chains, comments, branding and the tri-portal sync work already done.

The key conceptual object is the **Matter** (conveyancing file). It is to the solicitor what the **Purchase File** is to the broker — and crucially, both hang off the same client + property + deal. Matter ↔ Purchase File is a first-class link, exactly like the existing `client_deals` ↔ `purchase_files` link. That single design decision is what makes finance, legal, and (later) build all line up on one settlement date.

```text
                        clients / client_deals
                                 |
        +------------------------+------------------------+
        |                        |                        |
  purchase_files            legal_matters            build_jobs (Builder Portal, later)
  (Finance Portal)        (Solicitor Portal)          (not built yet)
        |                        |                        |
        +----- shared settlement date + critical dates ----+
                     surfaced in Command Centre + Client Portal
```

## 2. What solicitors actually need

Grouped by their real workflow, mapped to what already exists here.

### A. Matter management (core)
- Matter list: purchase / sale / transfer / off-the-plan / house-and-land / refinance / commercial.
- Matter detail "Legal Deal Room": parties, property, contract, dates, docs, tasks, comms, audit.
- Matter status pipeline: `instructed → contract_review → exchanged → cooling_off → conditions → unconditional → pre_settlement → settled → post_settlement → terminated`.
- Link to the client's Purchase File and internal Deal (bidirectional, drift-detected — never auto-mirror shared fields).

### B. Critical dates & settlement runway (highest value)
- Typed critical dates: contract date, cooling-off expiry, finance clause, building & pest, deposit due, balance-of-deposit, sunset date, settlement date, adjustment date.
- State-aware defaults (NSW 5-business-day cooling off, VIC 3, QLD 5) seeded from a template table.
- Settlement runway checklist auto-seeded on `unconditional` — mirrors the existing 9-step finance settlement task pattern (transfer lodged, stamp duty paid, PEXA workspace created, settlement statement issued, adjustments agreed, funds authorised, keys released).
- Countdown + escalation cron (T-14 / T-7 / T-2 / T-0) raising notifications into all three portals.

### C. Contract review
- Contract upload + versioning, special conditions register, amendment tracking.
- Optional AI contract summariser (Lovable AI, tool-calling) producing: parties, price, deposit %, key dates, special conditions, risk flags — always human-reviewed, never auto-actioned. Follows the existing `ai_doc_classifications` pattern.
- Advice note to client (shared) vs internal legal note (never leaves the portal).

### D. Requisitions, searches & disbursements
- Searches register: title, plan, council 149/10.7, water, land tax clearance, strata, ATO clearance certificate, foreign resident withholding.
- Each search: ordered / received / issue-found / cleared, with cost captured.
- Disbursement ledger → feeds a settlement statement and an invoice figure.

### E. Documents & signing
- Document requirements matrix scoped to the matter (mirrors `document_requirement_instances`), requestable from the client with reminders/escalation.
- Client-signable docs via the existing DocuSign anchor strategy (costs disclosure, client authority, verification of identity declaration).
- VOI: reuse the existing `voi_verifications` table from the finance compliance batch rather than building a second identity stack.

### F. Trust & funds (read-only ledger, not a trust accounting system)
- Deposit tracking, stakeholder details, funds-to-complete calculation, settlement adjustments (rates, water, strata, land tax).
- Explicitly **not** a regulated trust accounting replacement — it records, it does not reconcile.

### G. Collaboration
- Solicitor ↔ Command Centre thread (internal, always).
- Solicitor ↔ Client thread (permissioned, mirrored into Client Portal inbox).
- Solicitor ↔ Finance Partner thread — the finance-clause / unconditional handshake. This is the biggest real-world win: broker marks unconditional, solicitor sees it instantly.
- Entity-level comment threads on matters, reusing `purchase_file_entity_comments` semantics.

### H. Dashboard & ops
- Today view: settlements this week, dates due, unanswered client requests, docs outstanding.
- Matter pipeline board (kanban by status).
- Capacity/KPIs: matters by stage, average time to settle, settlements booked by month, at-risk matters.

### I. Compliance
- Hash-chained audit events per matter (reuse the `purchase_file_audit_events` design).
- Costs disclosure issued/acknowledged tracking, conflict check record, file-closure/archive with retention date.
- AML: solicitors are reporting entities. Read-only AML case snapshot only, no SMR exposure — same restriction the Finance Portal has.

### J. Builder Portal foresight (design now, build later)
- `legal_matters.build_job_id` nullable FK reserved.
- House-and-land / off-the-plan matters get a construction block: land settlement date, build contract date, practical completion, progress-payment schedule reference.
- Critical-date types already include sunset date + practical completion so the builder's milestones drop straight in.
- Shared enum + shared notification dispatcher so Builder Portal is a new role on the same rails, not a third stack.

## 3. Phase plan

Each phase is independently shippable and ends at a gate.

**Phase 1 — Foundation & auth**
`solicitor_portal_users`, `solicitor_portal_sessions`, `solicitor_portal_client_assignments`, `solicitor_portal_activity_log`, `solicitor_portal_default_permissions`. Edge functions: invite, accept-invite, login, logout, verify, forgot-password, reset-password, change-password. `useSolicitorPortalAuth` + `SolicitorPortalProtectedRoute` + `SolicitorPortalLayout`. Routes under `/legal/*` (login, accept-invite, change-password, dashboard shell).

**Phase 2 — Command Centre admin**
`/admin/solicitor-portal` behind `ModuleGuard moduleKey="solicitor_portal_admin"`: invite solicitors, assign clients, per-client permission matrix + global baseline (OR-merged, null = legacy allow), suspend/revoke, activity log. Firm-level grouping (`solicitor_firms`) so a practice can have multiple users.

**Phase 3 — Matters core**
`legal_matters` (+ status history, party records, `purchase_file_id` / `client_deal_id` / reserved `build_job_id`), matter list + Deal Room detail with Overview / Parties / Dates / Docs / Notes tabs. Bidirectional link card to the Purchase File, plus a Linked Matters panel on the internal Deal Pipeline.

**Phase 4 — Critical dates & settlement runway**
`legal_critical_dates` (typed, state-aware templates), `legal_settlement_tasks` auto-seeded on unconditional via trigger, countdown UI, hourly cron escalations, cross-portal notifications.

**Phase 5 — Documents, searches & requisitions**
Matter-scoped document requirements + request-from-client flow with auto-reminders, searches register, disbursement ledger, DocuSign costs-disclosure/authority pack, VOI reuse.

**Phase 6 — Communications & tri-portal sync**
Solicitor↔CC, Solicitor↔Client (mirrored into Client Portal), Solicitor↔Finance threads; notification prefs + quiet hours reusing the shared dispatcher; a Legal card on the client's `/client/finance`-style hub showing matter status and next date only.

**Phase 7 — Intelligence & reporting**
AI contract summariser + special-conditions extractor + risk flags (all human-confirmed), matter pipeline kanban, KPI dashboard, at-risk/stuck-matter detection.

**Phase 8 — Compliance, audit & hardening**
Hash-chained `legal_matter_audit_events`, audit timeline tab + verify, compliance export, conflict checks, file closure/retention, tri-portal health checks extended to legal, security scan + negative-auth tests.

## 4. Technical notes

- **Auth**: opaque session token in `x-solicitor-session-token`, validated in-function; `verify_jwt = false`; never `supabase.auth.getUser()`. Invite links are single-use, expiring, and force a password change on first login (same as finance).
- **Data access**: service-role-only RLS; all reads/writes go through `solicitor-portal-*` edge functions with explicit table whitelists. Every new `public` table gets explicit `GRANT`s in the same migration.
- **Isolation**: every query scoped by `solicitor_user_id` + assignment; no cross-firm visibility; SMR/restricted AML records never selected.
- **Enums**: new `legal_matter_type`, `legal_matter_status`, `legal_critical_date_type`, `legal_search_type`, `legal_settlement_task_key`.
- **Realtime**: new tables added to `supabase_realtime`; new notification types added to `notifications_type_check`.
- **UI**: dark-gold semantic tokens only, shadcn-first, `h-[90vh]` + ScrollArea modals, no raw palette classes — `npm run audit:style` must not regress.
- **Reuse, don't fork**: notification dispatcher, comments threads, document requirement instances, VOI, audit-hash helper, DocuSign anchors are all shared with the Finance Portal rather than duplicated.

## 5. Open questions before Phase 1

1. Is a solicitor a **firm with multiple users** (recommended: yes, `solicitor_firms` + members) or a single login per solicitor?
2. Should solicitors ever see the client's **financial position** (borrowing capacity, income), or strictly matter/legal data? Default assumption: strictly legal, plus finance-clause status only.
3. Are you using **PEXA**? If so we model the workspace ID and settlement booking as first-class fields now rather than retrofitting.
4. Which **states** are in scope at launch (cooling-off and duty rules are state-specific)? Default: NSW, VIC, QLD.
