# Phase 3 — Data tables & selection primitives

## Scope
Shared primitives for list/table surfaces (Clients, Deals, Reports, Listings, Call
Logs). Non-invasive additions to `@/components/aurixa` — existing pages continue to
work; new pages and future refactors adopt the primitives incrementally.

## Deliverables

- `src/components/aurixa/DataTableToolbar.tsx`
  - Slots: `leading`, `search`, `filters`, `actions`.
  - Built-in density toggle (`comfortable | compact`) and view-mode toggle
    (`list | grid`).
  - Count chip (`filtered / total`) and active-filter clear affordance.
  - Semantic tokens only (`hsl(var(--card))`, `border-border`, `text-muted-foreground`).
  - Focus-visible rings on every interactive; `aria-pressed` on toggle groups.

- `src/components/aurixa/BulkActionBar.tsx`
  - Floating (`anchor="bottom"`) or inline selection bar.
  - Slide-in animation gated behind `motion-safe:` to honour
    `prefers-reduced-motion`.
  - `aria-live="polite"` on count badge; keyboard-accessible clear button.

- Barrel export updated in `src/components/aurixa/index.ts` so consumers use one
  path: `import { DataTableToolbar, BulkActionBar } from '@/components/aurixa'`.

## Adoption notes for target pages

The heavy list pages (`Listings.tsx` ~1.1k LOC, `GeneratedReports.tsx` ~1.2k LOC,
`DealPipeline.tsx`, `CallLogs.tsx`) already ship bespoke toolbars and floating
bulk bars. To avoid regressions this phase publishes the primitives and defers
the mechanical migrations to focused follow-ups:

1. Replace the existing floating `Card` in `Listings.tsx` (lines ~1016–1066) with
   `<BulkActionBar count={selectedListings.size} onClear={…}>`.
2. Wrap the search + filter row on `Listings.tsx` and `GeneratedReports.tsx` in
   `<DataTableToolbar>` slots, keeping state intact.
3. Repeat for `DealPipeline.tsx` (list mode) and `CallLogs.tsx`.

Each replacement is a pure JSX swap — state, filters, and data fetching stay put.

## Verification

- `bunx tsgo --noEmit` — clean.
- No new `audit:style` violations (only semantic tokens used).
- Reduced-motion: slide-in only under `motion-safe:`.
- Keyboard: toggle groups use `aria-pressed`, buttons have visible focus rings.

## Files changed

- `src/components/aurixa/DataTableToolbar.tsx` (new)
- `src/components/aurixa/BulkActionBar.tsx` (new)
- `src/components/aurixa/index.ts` (exports)
- `archives/ui-uplift/phase-3-brief.md` (this file)
