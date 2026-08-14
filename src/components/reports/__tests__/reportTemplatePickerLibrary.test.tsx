import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The picker offers the Template Library itself, tied to the report format.
 *
 * ## What this pins
 *
 * The chooser used to list only rows already in `report_templates`, which for
 * most formats was one seeded master — the fifty designs the library holds per
 * format were reachable only through the Library page, and only as *editing*
 * copies. These assert the deep tie-up:
 *
 * - the library's production designs for the format are offered in the dialog,
 *   grouped by design family, and designs for other formats are not;
 * - an active row that descends from a listed design is folded INTO that
 *   design's row (badged as the house default) instead of appearing twice;
 * - a stored selection is followed — its design row is pre-checked and badged
 *   Current — and can still be changed;
 * - choosing a design that already exists as an active row selects that row
 *   directly, with no server copy; choosing a new one adopts it via
 *   `use_for_reports` FIRST and stores the returned id as the selection.
 */

const invokeSecureFunction = vi.fn();
vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: (...args: unknown[]) => invokeSecureFunction(...args),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

class TestResizeObserver { observe() {} unobserve() {} disconnect() {} }
Object.defineProperty(globalThis, 'ResizeObserver', { writable: true, value: TestResizeObserver });

import { ReportTemplatePicker } from '../ReportTemplatePicker';
import { defaultColourwayFor } from '@/lib/templateLibrary/colourways';

const DEFAULT_CW = defaultColourwayFor('private_banking')!;

/** Raw snake_case rows, as `manage-template-library`'s list returns them. */
const libraryEntry = (overrides: Record<string, unknown>) => ({
  id: 'ent-a',
  family_id: 'fam-1',
  slug: 'report-qa-pb-01-chancery',
  version: 1,
  name: 'Chancery',
  description: 'The reference expression.',
  category: 'investment',
  report_type: 'qa',
  tier: 'compass',
  variant: null,
  status: 'published',
  engine: 'weasyprint',
  production_ready: true,
  page_count: 6,
  design_meta: {
    familyKey: 'private_banking',
    familyName: 'Private Banking',
    familyNote: 'Gold on obsidian, editorial ledger.',
    variantAxis: 'A · reference',
    density: 'balanced',
    defaultColourway: DEFAULT_CW.id,
    colourways: [DEFAULT_CW.id],
  },
  ...overrides,
});

const LIBRARY = [
  libraryEntry({}),
  libraryEntry({
    id: 'ent-b',
    slug: 'report-qa-pb-02-sovereign-folio',
    name: 'Sovereign Folio',
    description: 'The expansive expression.',
    design_meta: {
      familyKey: 'private_banking',
      familyName: 'Private Banking',
      familyNote: 'Gold on obsidian, editorial ledger.',
      variantAxis: 'C · expansive',
      density: 'spacious',
      defaultColourway: DEFAULT_CW.id,
      colourways: [DEFAULT_CW.id],
    },
  }),
  // A different format's design must not be offered here.
  libraryEntry({ id: 'ent-x', slug: 'portfolio-review-pb-01', name: 'Portfolio Chancery', report_type: 'portfolio' }),
];

/** The seeded house master: the global active row Chancery already IS. */
const HOUSE_MASTER = {
  id: 'tpl-house', name: 'Private Banking — Chancery', description: 'Seeded master.',
  report_type: 'qa', engine: 'weasyprint',
  is_active: true, is_draft: false, is_default: true, scope: 'global',
  priority: 0, updated_at: '2026-08-14T00:00:00Z',
  libraryLineage: {
    entryId: 'ent-a', entrySlug: 'report-qa-pb-01-chancery', entryVersion: 1,
    familyKey: 'private_banking', familyName: 'Private Banking', colourway: null,
  },
};

let selections: any[] = [];
let writes: any[] = [];
let adoptions: any[] = [];

function routeCall(fn: string, payload: any) {
  if (fn === 'manage-template-library') {
    if (payload?.operation === 'list') {
      return Promise.resolve({ data: { records: LIBRARY }, error: null });
    }
    if (payload?.operation === 'use_for_reports') {
      adoptions.push(payload);
      return Promise.resolve({
        data: { templateId: 'tpl-new', reused: false, colourwayId: payload.colourwayId ?? null },
        error: null,
      });
    }
  }
  if (payload?.table === 'report_templates' && payload.operation === 'list') {
    return Promise.resolve({ data: { records: [HOUSE_MASTER] }, error: null });
  }
  if (payload?.table === 'report_template_selections') {
    if (payload.operation === 'list') {
      return Promise.resolve({ data: { records: selections }, error: null });
    }
    writes.push(payload);
    if (payload.operation === 'upsert') {
      selections = [{
        id: 'sel-1',
        report_type: payload.data.report_type,
        template_id: payload.data.template_id,
      }];
    }
    if (payload.operation === 'delete') selections = [];
    return Promise.resolve({ data: { records: selections }, error: null });
  }
  return Promise.resolve({ data: null, error: null });
}

function renderPicker() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ReportTemplatePicker
        reportType="qa"
        formatLabel="Report Q&A"
        open
        onOpenChange={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  invokeSecureFunction.mockReset();
  selections = [];
  writes = [];
  adoptions = [];
  invokeSecureFunction.mockImplementation(routeCall);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('the library is offered, tied to the format', () => {
  it('lists the format’s designs grouped by family, and no other format’s', async () => {
    renderPicker();
    expect(await screen.findByText('Private Banking')).toBeTruthy();
    expect(screen.getByText('Chancery')).toBeTruthy();
    expect(screen.getByText('Sovereign Folio')).toBeTruthy();
    // The portfolio design is the same family — and not this format's.
    expect(screen.queryByText('Portfolio Chancery')).toBeNull();
  });

  it('folds an active row into the design it descends from, keeping its badge', async () => {
    renderPicker();
    await screen.findByText('Chancery');
    // The seeded master is represented by the Chancery row, not listed twice…
    expect(screen.queryByText('Private Banking — Chancery')).toBeNull();
    // …and its house-default status shows on that row.
    expect(screen.getByText('House default')).toBeTruthy();
  });
});

describe('an existing selection is followed, and changeable', () => {
  it('pre-checks and badges the design the stored selection descends from', async () => {
    selections = [{ id: 'sel-1', report_type: 'qa', template_id: 'tpl-house' }];
    renderPicker();
    await screen.findByText('Chancery');
    expect(await screen.findByText('Current')).toBeTruthy();
    const checked = screen.getAllByRole('radio').filter(
      (r) => r.getAttribute('data-state') === 'checked' || r.getAttribute('aria-checked') === 'true',
    );
    expect(checked.length).toBe(1);
  });
});

describe('saving a library choice', () => {
  it('selects the existing house master directly — no server copy is made', async () => {
    renderPicker();
    fireEvent.click(await screen.findByText('Chancery'));
    fireEvent.click(screen.getByRole('button', { name: /Save choice/ }));

    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    expect(adoptions).toHaveLength(0);
    const upsert = writes.find((w) => w.operation === 'upsert');
    expect(upsert?.data?.template_id).toBe('tpl-house');
    expect(upsert?.data?.report_type).toBe('qa');
  });

  it('adopts a design with no active row first, then stores the returned id', async () => {
    renderPicker();
    fireEvent.click(await screen.findByText('Sovereign Folio'));
    fireEvent.click(screen.getByRole('button', { name: /Save choice/ }));

    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    expect(adoptions).toHaveLength(1);
    expect(adoptions[0].entryId).toBe('ent-b');
    const upsert = writes.find((w) => w.operation === 'upsert');
    expect(upsert?.data?.template_id).toBe('tpl-new');
  });
});
