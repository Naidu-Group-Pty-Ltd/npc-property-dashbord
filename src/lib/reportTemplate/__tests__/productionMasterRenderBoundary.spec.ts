/**
 * A production master, rendered with production-shaped data, through the gate
 * the renderer actually has to pass.
 *
 * ## Why this is a whole file
 *
 * `printFontPolicy.spec.ts` asserts the rule on a template written here. This
 * one asserts it on the bytes a client's document is drawn from: the schema is
 * lifted verbatim out of the seed migration that produced the row the 10 Year
 * Cash Flow's template selection points at in production, and the data comes
 * from `liveProjectionRow`, the same bridge the modal's download uses.
 *
 * That combination is what found the defect. Every measure in this programme —
 * the ink floor, the critique rubric, the golden diff, PDF/UA validation — is
 * taken against a fixture, and a fixture written in the catalogue's own
 * vocabulary passes while production is refused. `docs/reports/COVERAGE.md`
 * says this about content bindings; it is just as true of the render boundary,
 * where the answer was that a document with zero unresolved bindings and 84
 * correctly drawn blocks never reached the renderer at all.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileTemplateHtmlForPdf } from '../compileTemplateForPdf';
import { parseTemplate } from '../templateSchema';
import { refuseUnboundReconstruction } from '../rendering/productionTemplateGuard';
import { assertSafeRenderResources } from '../../../../supabase/functions/_shared/renderResourcePolicy.pure';
import {
  applyLiveCashFlowProjection,
  wireAsProjectionRow,
} from '@/lib/reports/cashFlow/liveProjectionRow';
import type { WireProjection } from '@/lib/reports/cashFlow/requestCashFlowPdf';

const SUPABASE_URL = 'https://dduzbchuswwbefdunfct.supabase.co';
const SEED = join(
  __dirname,
  '../../../../supabase/migrations/20260812090000_seed_template_library_v5_borrowing_capacity_portfolio.sql',
);
/** The library entry the production `cashflow` selection was adopted from. */
const SLUG = 'cash-flow-ten-year-ca-02-board-pack-brief';

function seededSchema(): unknown {
  const sql = readFileSync(SEED, 'utf8');
  const at = sql.indexOf(SLUG);
  if (at < 0) throw new Error(`${SLUG} is no longer seeded — repoint this spec`);
  const json = /\$tlj\$([\s\S]*?)\$tlj\$/.exec(sql.slice(at, at + 400_000));
  if (!json) throw new Error(`no schema literal follows ${SLUG}`);
  return JSON.parse(json[1]);
}

const year = (n: number) => ({
  year: n,
  calendarYear: 2026 + n,
  propertyValue: 800_000 + n * 40_000,
  loanBalance: 640_000,
  rentalIncome: 31_200 + n * 900,
  grossYield: 3.9,
  netYield: 3.1,
  expenses: 6_200,
  interestRate: 6.1,
  interest: 39_040,
  principal: 0,
  preTaxAnnual: -9_000 + n * 800,
  afterTaxAnnual: -4_200 + n * 700,
  depreciation: 8_000,
  taxRefund: 4_800,
  landTax: 900,
  capitalGrowth: 5,
  cpiGrowth: 3,
});

const wire = {
  acquisition: {
    purchasePrice: 800_000, marketValue: 830_000, deposit: 160_000,
    loanAmount: 640_000, loanTermYears: 30, interestRate: 6.1,
    loanType: 'interest_only', weeklyRent: 600, costs: [],
  },
  years: Array.from({ length: 10 }, (_, i) => year(i + 1)),
  assumptions: [{ label: 'Capital growth', value: '5% per year' }],
  notes: [],
} as unknown as WireProjection;

function bindingContext(): Record<string, unknown> {
  const row = wireAsProjectionRow(wire, {
    reportId: 'rep-1', propertyAddress: '28 Bligh Street',
  });
  expect(row, 'the live projection bridge refused a whole ten-year series').not.toBeNull();
  const data: Record<string, unknown> = {
    report: { id: 'rep-1', type: 'cashflow', generated_at: '2026-08-14T00:00:00.000Z' },
    analysis: row,
    brand: { tokens: {}, logo: null },
  };
  applyLiveCashFlowProjection(data, row!, null);
  return data;
}

describe('the production 10 Year Cash Flow master', () => {
  it('renders every page and binds every path', async () => {
    const schema = parseTemplate(seededSchema());
    expect(schema.pages.length, 'the schema salvaged to an empty template').toBe(11);
    expect(refuseUnboundReconstruction(schema)).toBeNull();

    const { html } = await compileTemplateHtmlForPdf(schema, {
      data: bindingContext(),
      title: 'Board Pack Brief — 10 Year Cash Flow',
      cascadeMetadata: true,
    });

    expect(html.length).toBeGreaterThan(20_000);
    expect(html, 'the cover title lost its binding').toContain('28 Bligh Street');
    expect(html, 'the scenario is no longer labelled honestly').toContain('Adviser-reviewed');
    // An unresolved binding renders as the empty string, never as a visible
    // `{{…}}` — so a leftover brace means the renderer stopped resolving.
    expect(html.match(/\{\{/g) ?? []).toHaveLength(0);
  });

  it('is accepted by the boundary the renderer enforces', async () => {
    // The whole defect in one assertion. Before the fix this document parsed,
    // passed the reconstruction guard, resolved all 84 blocks and every
    // binding — and was then refused here, after which the download came out
    // of the standard composer with the person's chosen template unused.
    const { html } = await compileTemplateHtmlForPdf(parseTemplate(seededSchema()), {
      data: bindingContext(),
      title: 'Board Pack Brief',
    });
    expect(() => assertSafeRenderResources(html, SUPABASE_URL)).not.toThrow();
  });
});
