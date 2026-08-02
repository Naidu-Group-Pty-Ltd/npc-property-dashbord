/**
 * A golden capture of the Borrowing Capacity Snapshot as it ships today.
 *
 * ## Why this exists before any change is made
 *
 * `docs/reports/DESIGN_SYSTEM.md` records that shipping PDF paths have **zero**
 * fidelity coverage. This is the first. It is deliberately written against the
 * *current* jsPDF generator, unmodified, so that when the report is rebuilt on
 * the design system there is something truthful to diff the result against.
 *
 * A golden is only worth having if it exercises the branches. The fixture below
 * turns on every conditional the generator has — LMI, additional assumptions,
 * recommendations, warnings, the calculation explanation, the audit trail and
 * the scenario comparison — because those are four extra pages that a
 * happy-path fixture would never reach, and four pages a migration could
 * silently drop.
 *
 * The artefact is written to `reports/` (gitignored) for rasterising and
 * eyeballing; the assertions below are what runs in CI.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const REPO = resolve(__dirname, '../../../..');
const GOLDEN_PDF = resolve(REPO, 'reports/golden/borrowing-capacity-snapshot.pdf');

// ── The generator's collaborators, stubbed at the boundary ──────────────────
//
// Only the three that reach the network. Everything else — the drawing, the
// layout, the pagination, the colours — is the real code path.

vi.mock('sonner', () => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

vi.mock('@/hooks/useGlobalReportSettings', () => ({
  fetchGlobalReportSettings: async () => ({
    contactDetails: {
      company_name: 'Meridian Property Partners',
      website: 'meridianpartners.example',
      email: 'advice@meridianpartners.example',
      phone: '+61 7 5555 0100',
      address: 'Level 8, 100 Example Street, Brisbane QLD 4000',
      abn: '11 222 333 444',
    },
    disclaimer: {
      is_enabled: true,
      font_size: 'small',
      text: 'This report is general in nature and does not take into account your '
        + 'objectives, financial situation or needs.',
    },
  }),
}));

vi.mock('@/lib/fetchLatestBorrowingCapacity', () => ({
  fetchLatestBorrowingCapacity: async () => null,
}));

/**
 * The generator fetches its cover art by relative URL, which has no meaning
 * outside a browser. Serve the real file so the golden contains the real cover
 * — the point of a golden is that it is what a client receives.
 */
beforeAll(() => {
  const coverPath = resolve(REPO, 'public/templates/npc-cashflow-cover.jpg');
  const cover = readFileSync(coverPath);
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('npc-cashflow-cover')) {
      return {
        ok: true,
        blob: async () => new Blob([cover], { type: 'image/jpeg' }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
});

// ── Fixture ─────────────────────────────────────────────────────────────────
//
// Fictional. A golden is committed, rasterised and shared; real client
// financials must never be the thing that gets shared.

const ASSESSMENT = {
  created_at: '2026-08-01T00:00:00.000Z',
  borrowing_capacity: 785_000,
  stress_tested_capacity: 712_000,
  monthly_surplus: 1_840,
  serviceability_band: 'green',
  dti_ratio: 5.4,
  assessment_rate: 8.65,
  interest_rate_used: 6.15,
  buffer_rate: 2.5,
  loan_term_years: 30,
  gross_annual_income: 186_000,
  shaded_annual_income: 171_400,
  living_expenses_monthly: 4_820,
  existing_commitments_monthly: 1_310,
  expense_method: 'hybrid',
  deposit_amount: 157_000,
  property_value_estimate: 942_000,
  proposed_loan_amount: 760_000,
  net_purchase_capacity: 942_000,
  // Turns on the LMI block.
  lmi_mode: 'capitalised',
  lmi_amount: 18_640,
  lmi_lvr_trigger: 80,
  // Field names are generator A's, read from the source (`:602-605`, `:667-674`):
  // it reads `component`, not `source`, and `shadingRate` is a FRACTION 0-1 that
  // it multiplies by 100. Generators B and C read `source`/`shadingRate`-as-
  // percent for the same data — the three implementations do not agree on the
  // field names, which is one of the reasons this report is being rebuilt.
  income_breakdown: [
    { component: 'PAYG salary — applicant 1', grossAmount: 124_000, shadingRate: 1, shadedAmount: 124_000 },
    { component: 'PAYG salary — applicant 2', grossAmount: 42_000, shadingRate: 1, shadedAmount: 42_000 },
    { component: 'Rental income', grossAmount: 20_000, shadingRate: 0.8, shadedAmount: 16_000 },
  ],
  liability_breakdown: [
    { type: 'mortgage', label: 'Example Bank', balance: 412_000, monthlyServicing: 2_480 },
    { type: 'car_loan', label: 'Example Finance', balance: 21_400, monthlyServicing: 610 },
    { type: 'credit_card', label: 'Example Bank', balance: 8_000, monthlyServicing: 240 },
  ],
  // Turns on the additional-assumptions card.
  assumptions: {
    selectedLenderName: 'Example Bank — Investor P&I',
    hemBenchmark: 4_120,
    shadingPolicy: 'Rental 80%, overtime 80%, bonus 50%',
  },
  recommendations: [
    'Clear the credit card limit before application — the limit, not the balance, is assessed.',
    'A twelve-month rental ledger would remove the 20% shading on the investment income.',
  ],
  warnings: [
    'DTI of 5.4 is above the 5.0 threshold at several lenders.',
  ],
  // Turns on the "How This Was Calculated" page.
  explanation: {
    executiveSummary: 'Capacity is set by serviceability rather than deposit: the '
      + 'assessed surplus supports $785,000 at the 8.65% assessment rate, while the '
      + 'deposit would support more.',
    steps: [
      {
        step: 1,
        title: 'Shade the income',
        narrative: 'Rental income is shaded to 80% under the selected lender policy; '
          + 'PAYG salary is taken in full.',
        figures: [
          { label: 'Gross annual income', value: '$186,000' },
          { label: 'Shaded annual income', value: '$171,400' },
        ],
      },
      {
        step: 2,
        title: 'Deduct assessed expenses',
        narrative: 'The greater of declared expenses and the HEM benchmark is used, '
          + 'then existing commitments are deducted.',
        figures: [
          { label: 'Assessed living expenses', value: '$4,820 / month' },
          { label: 'Existing commitments', value: '$1,310 / month' },
        ],
      },
      {
        step: 3,
        title: 'Convert surplus to capacity',
        narrative: 'The residual surplus is capitalised over 30 years at the '
          + 'assessment rate of 8.65%.',
        figures: [{ label: 'Borrowing capacity', value: '$785,000' }],
      },
    ],
  },
  // Turns on the audit-trail page.
  //
  // Shapes taken from the edge function that produces this, not guessed:
  // `AuditCategory` is lowercase singular (index.ts:194), `rawValue`,
  // `assessedValue` and `delta` are numbers the renderer formats itself
  // (index.ts:196-207), and the summary keys are the four the renderer reads
  // (index.ts:214-217). A fixture that gets these wrong renders a header row
  // and four $0 tiles with no entries — which is what the first capture did.
  auditTrail: {
    summary: {
      totalTransformations: 5,
      byCategory: { income: 2, expense: 1, liability: 1, policy: 1, tax: 0, property: 0, constraint: 0 },
      totalIncomeShading: 14_600,
      totalExpenseAdjustments: 700,
      totalLiabilityAdjustments: 240,
      totalTaxImpact: 0,
      hasOverrides: false,
      hasConstraints: false,
    },
    entries: [
      { seq: 1, category: 'income', action: 'shade', label: 'Rental income', rawValue: 20_000, assessedValue: 16_000, delta: -4_000, impact: 'decrease', rule: 'Rental shading 80%' },
      { seq: 2, category: 'income', action: 'shade', label: 'Bonus', rawValue: 21_200, assessedValue: 10_600, delta: -10_600, impact: 'decrease', rule: 'Bonus shading 50%' },
      { seq: 3, category: 'expense', action: 'floor', label: 'Living expenses (monthly)', rawValue: 4_120, assessedValue: 4_820, delta: 700, impact: 'increase', rule: 'HEM floor applied' },
      { seq: 4, category: 'liability', action: 'assess', label: 'Credit card', rawValue: 0, assessedValue: 240, delta: 240, impact: 'increase', rule: '3% of limit' },
      { seq: 5, category: 'policy', action: 'buffer', label: 'Assessment rate', rawValue: 6.15, assessedValue: 8.65, delta: 2.5, impact: 'increase', rule: 'Servicing buffer 2.5%' },
    ],
  },
};

/**
 * `ScenarioPreset.adjustedInputs` is a **whole** `BorrowingCapacityInput`, not a
 * patch, and `result` is a whole `BorrowingCapacityResult`
 * (`StrategyScenarioModeling.tsx:174`). A partial one is not a smaller version
 * of the real thing — it is a different thing, and it makes the generator print
 * `Rate NaN%` and `$0` surpluses that the product never produces. Every preset
 * below therefore carries the complete shape, differing only where the scenario
 * says it differs.
 */
const BASE_INPUTS = {
  grossAnnualIncome: 186_000,
  shadedAnnualIncome: 171_400,
  monthlyLivingExpenses: 4_820,
  monthlyCommitments: 1_310,
  interestRate: 6.15,
  bufferRate: 2.5,
  loanTermYears: 30,
  totalDebtBalances: 441_400,
};

const acquisition = (maxPurchasePrice: number, loan: number) => ({
  releasedCapital: 0,
  lmi: 18_640,
  lmiMode: 'debt_capitalised' as const,
  stampDuty: 37_290,
  otherAcquisitionCosts: 3_200,
  maxPurchasePrice,
  loanAvailableForPurchase: loan,
  cashAvailable: 157_000,
});

const SCENARIO_PRESETS = [
  {
    id: 'base',
    name: 'Base Case (Original)',
    isBase: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    adjustedInputs: { ...BASE_INPUTS },
    result: {
      borrowingCapacity: 785_000,
      monthlySurplus: 1_840,
      serviceabilityBand: 'green',
      stressTestedCapacity: 712_000,
      dtiRatio: 5.4,
      assessmentRate: 8.65,
      recommendations: [],
      warnings: [],
      afterTaxAnnualIncome: 131_800,
      monthlyAfterTaxIncome: 10_983,
    },
    acquisitionCapacity: acquisition(942_000, 785_000),
  },
  {
    id: 'clear-card',
    name: 'Clear the credit card',
    isBase: false,
    createdAt: '2026-08-01T00:05:00.000Z',
    adjustedInputs: { ...BASE_INPUTS, monthlyCommitments: 1_070, totalDebtBalances: 433_400 },
    result: {
      borrowingCapacity: 812_000,
      monthlySurplus: 2_080,
      serviceabilityBand: 'green',
      stressTestedCapacity: 736_000,
      dtiRatio: 5.2,
      assessmentRate: 8.65,
      recommendations: [],
      warnings: [],
      afterTaxAnnualIncome: 131_800,
      monthlyAfterTaxIncome: 10_983,
    },
    acquisitionCapacity: acquisition(975_000, 812_000),
    scenarioDeltas: [
      { id: 'cc-1', label: 'Close credit card', type: 'liability_removed', value: 8_000, unit: 'absolute' },
    ],
  },
  {
    id: 'rate-rise',
    name: 'Rate rise 100bp',
    isBase: false,
    createdAt: '2026-08-01T00:10:00.000Z',
    adjustedInputs: { ...BASE_INPUTS, interestRate: 7.15 },
    result: {
      borrowingCapacity: 704_000,
      monthlySurplus: 1_180,
      serviceabilityBand: 'amber',
      stressTestedCapacity: 638_000,
      dtiRatio: 5.9,
      assessmentRate: 9.65,
      recommendations: [],
      warnings: [],
      afterTaxAnnualIncome: 131_800,
      monthlyAfterTaxIncome: 10_983,
    },
    acquisitionCapacity: acquisition(845_000, 704_000),
    scenarioDeltas: [
      { id: 'rate-1', label: 'Interest rate', type: 'rate_change', value: 1, unit: 'percent' },
    ],
  },
];

const FIXTURE = {
  clientId: '00000000-0000-4000-8000-000000000000',
  clientName: 'A. & J. Sample',
  assessment: ASSESSMENT,
  scenarioPresets: SCENARIO_PRESETS,
  returnBlob: true as const,
};

// ── The capture ─────────────────────────────────────────────────────────────

describe('Borrowing Capacity Snapshot — golden capture', () => {
  let bytes: Buffer;
  let fileName: string;

  beforeAll(async () => {
    const { generateBorrowingCapacityPDF } = await import('../BorrowingCapacityPDFReport');
    const result = await generateBorrowingCapacityPDF(FIXTURE as never);
    expect(result, 'the generator returned nothing').toBeDefined();
    bytes = Buffer.from(await result!.blob.arrayBuffer());
    fileName = result!.fileName;

    mkdirSync(dirname(GOLDEN_PDF), { recursive: true });
    writeFileSync(GOLDEN_PDF, bytes);
  });

  it('produces a PDF', () => {
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(50_000);
  });

  it('names the file the way the product does', () => {
    expect(fileName).toMatch(/^Borrowing_Capacity_Snapshot_.*\.pdf$/);
  });

  /**
   * Page count is the single most useful thing a golden pins. A migration that
   * silently drops the audit trail or the scenario comparison changes nothing
   * a unit test would notice — but it changes this.
   */
  it('emits every conditional page the fixture turns on', () => {
    const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    // cover, summary, (flowing body), explanation, audit trail, scenarios, closing
    expect(pages).toBeGreaterThanOrEqual(7);
  });

  it.each([
    ['the running foot', 'Borrowing Capacity Snapshot'],
    ['the executive summary', 'Executive Summary'],
    ['the income table', 'Income Analysis'],
    ['the capacity breakdown', 'Capacity Breakdown'],
    ['the calculation explanation', 'How This Was Calculated'],
    ['the audit trail', 'Audit Trail'],
    ['the scenario comparison', 'Scenario Comparison'],
  ])('contains %s', (_label, needle) => {
    // jsPDF writes text uncompressed with standard fonts, so the section titles
    // are literally in the byte stream.
    expect(bytes.toString('latin1')).toContain(needle);
  });

  /**
   * The two findings this capture is here to pin, so the rebuild can be
   * measured against them rather than argued about.
   */
  describe('what the current output gets wrong', () => {
    it('sets the entire document in Helvetica — no brand typeface anywhere', () => {
      const text = bytes.toString('latin1');
      expect(text).toMatch(/Helvetica/);
      for (const brandFace of ['Cinzel', 'Playfair', 'IBM Plex']) {
        expect(text).not.toContain(brandFace);
      }
    });

    it('carries a cover that names OUR company, whoever the tenant is', () => {
      // The fixture's issuing company is "Meridian Property Partners", and the
      // generator resolves that name — then pastes an NPC-branded JPEG over the
      // top of it anyway. The name only reaches the page if the image fetch
      // fails. The cover is a raster, so this asserts the code path rather than
      // the pixels: the tenant name appears nowhere on page one.
      const firstPage = bytes.toString('latin1').slice(0, bytes.indexOf('Executive Summary'));
      expect(firstPage).not.toContain('MERIDIAN');
    });
  });
});
