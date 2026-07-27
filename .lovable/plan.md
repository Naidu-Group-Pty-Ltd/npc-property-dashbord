
# UI/UX Enhancement Plan — NPC Command Centre (21st.dev-informed)

Planning only, no code changes. Grounded in existing project memory (dark-gold theme, semantic tokens, tri-portal split, glass modals, ScrollArea patterns) and 12+ inspiration results returned from 21st.dev across sidebar shells, data tables, kanban, KPI tiles, command palettes, AI chat assistants, and premium CTA affordances.

## Guiding principles (apply to every phase)

- **Semantic tokens only.** Never `text-white`, `bg-[#…]`, or raw Tailwind palette classes in shared UI. All new palette work extends `--aurixa-*` / `--gold-*` tokens already declared in `tokens.css`.
- **Aurixa aurora + gold on graphite.** Glass surfaces (`bg-glass`, `backdrop-blur`), gold accents (`hsl(var(--primary))` ≈ #D4A843), status pills use `text-success` / `text-warning` / `text-destructive`.
- **Tri-portal parity.** Command Centre, Client Portal, Finance Portal share primitives (`AurixaMark`, `AurixaSectionHeader`, `StatusPill`, `GlassCard`, `MetricTile`) but never share sensitive AML surfaces.
- **Accessibility floor.** WCAG AA contrast, focus-visible rings on every interactive, 44px tap targets, `prefers-reduced-motion` fallback for every animation, keyboard shortcut coverage on every list/table.
- **Data density with breathing room.** Tables get sticky headers, condensed row height, inline row actions, empty states that describe next steps (per AGENTS.md rule "empty states must be actionable").
- **Zero regressions.** Each phase ends with `npm run lint`, `npm run audit:style`, `npm run build`, and a screenshot pass on the affected route.

## Phase 0 — Design system audit & token consolidation

Deliverable: `archives/ui-uplift/phase-0-audit.md`.

- Enumerate every hardcoded colour, font, spacing outlier via `npm run audit:style` and record baseline count.
- Catalogue the six "shell" primitives already shipped (`AurixaMark`, `AurixaSectionHeader`, `StatusPill`, `GlassCard`, aurora orb launcher, glass modal shell) and identify parity gaps between Command Centre / Client Portal / Finance Portal.
- Define the missing shared primitives to build: `MetricTile`, `KpiRow`, `SectionEmptyState`, `DataTableToolbar`, `SegmentedTabs`, `AuroraHero`, `TimelineRail`, `KanbanColumn`.
- Publish the token map (spacing scale, radius scale, elevation scale, motion durations 120/200/320 ms) so subsequent phases reference tokens, not raw values.

## Phase 1 — Global chrome (sidebar, topbar, breadcrumb, search)

Inspired by 21st.dev results: Dashboard Sidebar (arunjdass, dual-theme charcoal shell), Workbench Sidebar (nexus-ui), Command Palette (rafa-porto), Omni Command Palette.

- Rebuild `DashboardSidebar` as a **collapsible, grouped multi-tier nav** with pinned favourites, a "Recent" section, and a compact rail mode (56 px). Preserve the AML consolidation (single AML/CTF Compliance entry).
- Topbar: unified search (⌘K), notification bell with unread pip, AI Agent orb (already shipped) moved to a fixed anchor, workspace switcher (Command Centre / Finance / Client-as-staff), user menu with role badge.
- Breadcrumb rail replaces per-page headers where duplication exists.
- Command palette upgrade: fuzzy nav, "Recent reports", "Recent clients", inline actions (create client, open PF, run report). Keyboard-first, screen-reader labelled.

## Phase 2 — Home / Compliance Home / Finance dashboard (KPI + activity)

Inspired by: Efferd Dashboard 2, Analytics Dashboard, Animated Dashboard Card, Dashboard Card With Modal.

- Introduce `MetricTile` with animated count-up, delta chip (up/down/neutral), sparkline mini-chart, and drill-down affordance.
- Landing pages become **role-adaptive**: superadmin sees all workspaces, finance partner sees Pipeline+Forecast+Inbox, compliance officer sees Cases+SMR queue. Driven by effective permissions (already implemented) — this phase only redesigns the surface.
- Add "Today" strip at top (morning briefing, streaks, badges — already implemented in finance portal; extend visual language to Command Centre).
- Aurora hero band with the AurixaMark, current period, and a single primary CTA per role.

## Phase 3 — Data tables (Clients, Deals, Reports, Listings, Call Logs)

Inspired by: HeroUI Table, Data Table Filter, Complex Data Table, Project Data Table, Leads Data Table.

- Unified `DataTableToolbar`: search, column visibility, saved views, bulk-action bar that slides in on selection, export CSV/PDF, density toggle.
- Sticky first column (identity) + sticky header, virtualized rows for >200 items, inline row hover actions, right-side detail drawer instead of full page navigation for quick previews.
- Status column standardised on `StatusPill` variants (compliance, deal stage, doc state).
- Empty states with contextual next-step CTA (per AGENTS.md).
- Column presets per role; URL-synced filters and pagination (pattern already proven on Model Hub OpenRouter tab).

## Phase 4 — Pipelines, timelines, kanban (Deal Pipeline, Finance Pipeline, AML case timeline, Chronological Timeline)

Inspired by: UltraQualityKanbanBoard, Sidebar Dashboard Skeleton.

- Redesign kanban cards with lender chip, days-in-stage micro-bar, risk pill, assignee avatar; drag handle isolated to reduce accidental drags.
- Column headers show count + weighted value + WIP limit; over-limit column glows warning.
- Timeline rail primitive for AML Chronological Timeline and Deal history: vertical gold rail, glass event cards, filter chips (system / user / integration / audit), keyboard nav.
- Preserve current backend contracts; UI-only.

## Phase 5 — Modals, drawers, forms

Reinforce project memory rule: modals use `h-[90vh]` + `ScrollArea`, no Radix Select empty strings.

- Standardise every dialog on a `GlassModal` primitive (header slot, sticky footer with primary/secondary/destructive slots, mandatory close via ⎋).
- Multi-step forms (report generation, client intake, PF creation, AML case open) adopt a shared `Stepper` with progress rail, save-and-resume drafts.
- Inline validation with token-coloured helper text; server errors surface as toast + inline flag on the offending field.
- Right-side detail drawers replace deep-linked modals where the user needs to keep list context (Clients, Deals, Reports).

## Phase 6 — AI surfaces (Agent widget, Report Q&A, Copilot, Chat)

Inspired by: Glowing AI Chat Assistant, Suggestions, AI Suggested Actions, Message Dock.

- Agent widget: keep aurora orb (Phase 2 legacy), add docked mode, suggestion chips above the composer, tool-call visualisation cards, memory citation strip (already shipped) with hover previews.
- Report Q&A: split-pane on ≥lg (thread left, source viewer right), collapsible on md, single-column on sm. Streaming tokens use shimmer primitive from `primitives.css`.
- Model-change indicator (already shipped from Model Hub work) gets a persistent chip in every AI surface header.
- Voice-to-text mic button with waveform feedback and captioned transcript.

## Phase 7 — Reports & PDF surfaces (viewer, cover, chart embeds)

- `ReportViewer` gains a left TOC rail, floating "share/print/copy" cluster, chart lightbox parity with the Charts page (already implemented, extend).
- Cover pages standardised on `AuroraHero` primitive, brand mark, category chip, timestamp, and canonical property key.
- Chart embeds inherit `LiveChart` legend rule (legends off, tooltip on hover), always-print-safe palette.
- Generated Reports index gets grouped view (by category / by property / by client) with saved filters.

## Phase 8 — QA, motion, accessibility, and cutover

- Reduced-motion audit: every aurora glow, shimmer, count-up, drawer slide must degrade to a static state under `prefers-reduced-motion`.
- Keyboard audit: tab-order, focus-visible ring, skip-to-content, arrow-key nav on tables/kanban.
- Contrast audit against WCAG AA on gold-on-graphite and status pills.
- Cross-viewport pass at 1280×800, 1440×900, 1920×1080, 1366×768 (per user's 100 %-zoom preference), plus responsive checkpoints for finance-portal mobile cockpit.
- Rollout flag `ui_uplift_v2` gated per workspace, mirroring the AML v3 cutover pattern; document runbook at `archives/ui-uplift/phase-8-runbook.md`.

## Technical details (per-phase)

- **21st.dev component sourcing**: for each phase, we metadata-search first (free), then `get_component` only for the two or three exemplars we actually adapt. All fetched code is re-tokenised to Aurixa semantics before merging — never ship a 21st component with its own palette or fonts.
- **Skills wiring**: run the `frontend-design` skill at the start of Phases 1-7 for direction, and `web-design-guidelines` at the end of each phase for the review pass; verify in Chrome DevTools MCP.
- **Non-negotiables**: `components.json`, `tailwind.config.ts`, `src/index.css`, `tokens.css`, `primitives.css` remain the only sources of design truth. New palette values land as tokens, never as raw hex.
- **Traceability**: each phase writes an entry to `archives/ui-uplift/phase-N-brief.md` (audit → plan → files changed → screenshots → verification checklist).
- **No backend changes** in any phase; the only allowed data-layer touch is adding query keys/columns strictly for presentation (e.g. sparkline sources) via existing edge functions.

## Success metrics

- 0 new `audit:style` violations, ≥ 30 % reduction from baseline.
- 100 % of shared UI on semantic tokens.
- Lighthouse a11y ≥ 95 on Home, Clients, Deal Pipeline, Report Viewer, Finance Portal Overview.
- <150 ms perceived interaction latency on table filters and command palette.
- One shared primitive library referenced from all three portals.

Approve to proceed with Phase 0 (audit + primitive gap map). Each subsequent phase will be executed on your explicit "proceed" signal.
