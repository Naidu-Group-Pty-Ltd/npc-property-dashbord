/**
 * Sample report data for Template Library previews.
 *
 * ## Why this exists
 *
 * A template catalogue that shows abstract grey rectangles is asking the reader
 * to imagine the product. This dataset lets the browse and preview surfaces run
 * each template through the **real** production renderer, so what a user sees is
 * the actual document they would produce — same pipeline, same typography, same
 * palette as the PDF — with the fields filled in.
 *
 * ## It is sample data, and it says so
 *
 * Nothing here is real and nothing here is a customer's. Every surface that
 * renders it labels it as sample, because a preview that looks like live data
 * is worse than no preview: someone will screenshot it. The one rule this file
 * follows without exception is that it is used for **preview only** and is never
 * written into a report, a template, or the database.
 *
 * ## Conventions that matter
 *
 * - The `percent` filter formats the number it is given and does **not**
 *   multiply by 100. A 3.84% yield is `3.84`, not `0.0384`. Getting this wrong
 *   renders "0.04%".
 * - `currency` takes a raw number, not a preformatted string.
 * - Indexed bindings (`risks.0.action`) resolve through ordinary arrays.
 *
 * ## One scenario, told consistently
 *
 * Every namespace describes the same fictional engagement — the Nguyen family
 * buying in Leichhardt through Meridian Property Advisory — so a user flicking
 * between templates sees one coherent story rather than forty unrelated
 * fragments. That consistency is most of what makes a preview feel considered.
 */

const ADDRESS = '14 Marlborough Street, Leichhardt NSW 2040';
const CLIENT = 'Jordan & Sarah Nguyen';

/** Owner/timing triples reused by the action-list blocks across templates. */
function action(a: string, owner: string, timing: string) {
  return { action: a, owner, timing };
}
function risk(r: string, why: string, a: string) {
  return { risk: r, why, action: a };
}

/**
 * Attach named fields to a list.
 *
 * A few templates address the same namespace both ways — `fees.0.amount` for the
 * rows and `fees.exclusions` for the note underneath. The binding resolver walks
 * plain property access, so an array carrying extra keys satisfies both without
 * the template having to change.
 */
function withFields<T extends unknown[], P extends object>(list: T, fields: P): T & P {
  return Object.assign(list, fields);
}

const RISKS = [
  risk(
    'Interest rate sensitivity',
    'A 100bp rise adds roughly $214/week to the holding cost at the modelled loan amount.',
    'Fix 60% of the facility for three years and retain the offset on the balance.',
  ),
  risk(
    'Single-tenant vacancy',
    'One dwelling means income is binary — a four-week vacancy costs $3,800.',
    'Hold a six-month expense reserve and instruct a letting agent before settlement.',
  ),
  risk(
    'Heritage overlay constraints',
    'The street is a conservation area, so external changes need council consent.',
    'Confirm the granny-flat footprint with a town planner during the cooling-off period.',
  ),
];

const NEXT_STEPS = [
  action('Issue contract to conveyancer for review', 'Buyer', 'Within 2 days'),
  action('Book building, pest and strata inspections', 'Adviser', 'Within 5 days'),
  action('Confirm formal loan approval and valuation', 'Broker', 'Within 10 days'),
  action('Exchange with a 10% deposit and 42-day settlement', 'Conveyancer', 'Within 14 days'),
];

export const SAMPLE_REPORT_DATA: Record<string, unknown> = {
  reportType: 'investment',

  /**
   * Report-level metadata. The date is a fixed string, not `new Date()`: the
   * catalogue tests assert the rendered output, and a preview that changes at
   * midnight is a flaky test waiting to happen.
   */
  report: {
    generatedDate: '2 August 2026',
  },

  org: {
    name: 'Meridian Property Advisory',
    abn: '42 618 305 774',
    address: 'Level 8, 120 Sussex Street, Sydney NSW 2000',
    phone: '(02) 8005 4120',
    email: 'advice@meridianproperty.example',
    website: 'meridianproperty.example',
  },
  author: { name: 'Alexandra Whitfield', title: 'Senior Investment Adviser' },
  recommendation: {
    headline: 'Proceed to offer at or below $1.29m',
    rationale:
      'The holding clears our land-value and tenant-demand tests, and the shortfall is '
      + 'serviceable inside the stated surplus. Value is in the land and the approved '
      + 'secondary-dwelling footprint, not in the current improvements.',
  },

  client: {
    name: CLIENT,
    email: 'j.nguyen@example.com',
    phone: '0412 887 340',
    address: '9/44 Regent Street, Newtown NSW 2042',
    dateOfBirth: '14 March 1988',
    employment: 'PAYG — Registered Nurse & Software Engineer',
    income: 268000,
    debts: 41500,
    deposit: 340000,
    preApproval: 'Conditional to $1,340,000 (Westpac, expires 12 weeks)',
    existingProperty: '1 — Newtown apartment, owner-occupied',
  },

  property: {
    address: ADDRESS,
    suburb: 'Leichhardt',
    type: 'Freestanding house',
    configuration: '3 bed · 2 bath · 1 car',
    landArea: '412 m²',
    yearBuilt: '1928',
    zoning: 'R2 Low Density Residential',
    tenancy: 'Vacant possession at settlement',
    condition: 'Original interior, sound structure, roof replaced 2019',
    rationale:
      'Land-rich holding inside the 8km ring with a compliant secondary-dwelling '
      + 'footprint and a level rear yard.',
  /**
   * Sample plates for the two photographic families.
   *
   * Luxury Editorial and Architectural Property declare `image_slots`, and a
   * catalogue preview that showed those plates as absent would make both
   * families look broken — the exact trap `docs/reports/COVERAGE.md` warns
   * about, where a measure passes because the thing it measures is unused.
   *
   * These are deliberately TONAL STUDIES rather than photographs. A sample
   * that looked like a real house would misrepresent what the preview shows,
   * and the reader is told this is sample data. Base64 SVG because
   * `renderResourcePolicy` skips a base64 payload and holds a
   * percent-encoded one under the SSRF scanner.
   *
   * No adapter emits `property.images` today. A real report therefore has
   * none, every plate is conditional, and an unfilled plate prints nothing.
   */
  images: [
    // Frontage
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMzAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNDOUI4OTYiLz48c3RvcCBvZmZzZXQ9IjAuNTUiIHN0b3AtY29sb3I9IiM2RTYyNTMiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyQTI0MUMiLz48L2xpbmVhckdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0idiIgY3g9IjAuNSIgY3k9IjAuNDIiIHI9IjAuNzUiPjxzdG9wIG9mZnNldD0iMC41NSIgc3RvcC1jb2xvcj0iIzAwMCIgc3RvcC1vcGFjaXR5PSIwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDAwIiBzdG9wLW9wYWNpdHk9IjAuMzgiLz48L3JhZGlhbEdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCNnKSIvPjxlbGxpcHNlIGN4PSIxMjgiIGN5PSIxOTYiIHJ4PSIxOTAiIHJ5PSIxMjAiIGZpbGw9IiMyQTI0MUMiIG9wYWNpdHk9IjAuMjIiLz48cmVjdCB4PSIwIiB5PSIyMzIiIHdpZHRoPSI0MDAiIGhlaWdodD0iNjgiIGZpbGw9IiMyQTI0MUMiIG9wYWNpdHk9IjAuMzAiLz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCN2KSIvPjwvc3ZnPg==',
    // Streetscape
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMzAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNEOEM5QUMiLz48c3RvcCBvZmZzZXQ9IjAuNTUiIHN0b3AtY29sb3I9IiM3QzcyNjQiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyNDFGMTkiLz48L2xpbmVhckdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0idiIgY3g9IjAuNSIgY3k9IjAuNDIiIHI9IjAuNzUiPjxzdG9wIG9mZnNldD0iMC41NSIgc3RvcC1jb2xvcj0iIzAwMCIgc3RvcC1vcGFjaXR5PSIwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDAwIiBzdG9wLW9wYWNpdHk9IjAuMzgiLz48L3JhZGlhbEdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCNnKSIvPjxlbGxpcHNlIGN4PSIxMjgiIGN5PSIxOTYiIHJ4PSIxOTAiIHJ5PSIxMjAiIGZpbGw9IiMyNDFGMTkiIG9wYWNpdHk9IjAuMjIiLz48cmVjdCB4PSIwIiB5PSIyMzIiIHdpZHRoPSI0MDAiIGhlaWdodD0iNjgiIGZpbGw9IiMyNDFGMTkiIG9wYWNpdHk9IjAuMzAiLz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCN2KSIvPjwvc3ZnPg==',
    // Parkland
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMzAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNCOUM3QTQiLz48c3RvcCBvZmZzZXQ9IjAuNTUiIHN0b3AtY29sb3I9IiM1RjZBNTUiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxRTI0MUIiLz48L2xpbmVhckdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0idiIgY3g9IjAuNSIgY3k9IjAuNDIiIHI9IjAuNzUiPjxzdG9wIG9mZnNldD0iMC41NSIgc3RvcC1jb2xvcj0iIzAwMCIgc3RvcC1vcGFjaXR5PSIwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDAwIiBzdG9wLW9wYWNpdHk9IjAuMzgiLz48L3JhZGlhbEdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCNnKSIvPjxlbGxpcHNlIGN4PSIxMjgiIGN5PSIxOTYiIHJ4PSIxOTAiIHJ5PSIxMjAiIGZpbGw9IiMxRTI0MUIiIG9wYWNpdHk9IjAuMjIiLz48cmVjdCB4PSIwIiB5PSIyMzIiIHdpZHRoPSI0MDAiIGhlaWdodD0iNjgiIGZpbGw9IiMxRTI0MUIiIG9wYWNpdHk9IjAuMzAiLz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCN2KSIvPjwvc3ZnPg==',
    // Interior
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMzAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNFMENGQjAiLz48c3RvcCBvZmZzZXQ9IjAuNTUiIHN0b3AtY29sb3I9IiM4QTdBNjYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyQzI0MTkiLz48L2xpbmVhckdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0idiIgY3g9IjAuNSIgY3k9IjAuNDIiIHI9IjAuNzUiPjxzdG9wIG9mZnNldD0iMC41NSIgc3RvcC1jb2xvcj0iIzAwMCIgc3RvcC1vcGFjaXR5PSIwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDAwIiBzdG9wLW9wYWNpdHk9IjAuMzgiLz48L3JhZGlhbEdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCNnKSIvPjxlbGxpcHNlIGN4PSIxMjgiIGN5PSIxOTYiIHJ4PSIxOTAiIHJ5PSIxMjAiIGZpbGw9IiMyQzI0MTkiIG9wYWNpdHk9IjAuMjIiLz48cmVjdCB4PSIwIiB5PSIyMzIiIHdpZHRoPSI0MDAiIGhlaWdodD0iNjgiIGZpbGw9IiMyQzI0MTkiIG9wYWNpdHk9IjAuMzAiLz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCN2KSIvPjwvc3ZnPg==',
    // Aspect
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMzAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNCNkJEQzgiLz48c3RvcCBvZmZzZXQ9IjAuNTUiIHN0b3AtY29sb3I9IiM2QjZFNzYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxRDIwMjYiLz48L2xpbmVhckdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0idiIgY3g9IjAuNSIgY3k9IjAuNDIiIHI9IjAuNzUiPjxzdG9wIG9mZnNldD0iMC41NSIgc3RvcC1jb2xvcj0iIzAwMCIgc3RvcC1vcGFjaXR5PSIwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDAwIiBzdG9wLW9wYWNpdHk9IjAuMzgiLz48L3JhZGlhbEdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCNnKSIvPjxlbGxpcHNlIGN4PSIxMjgiIGN5PSIxOTYiIHJ4PSIxOTAiIHJ5PSIxMjAiIGZpbGw9IiMxRDIwMjYiIG9wYWNpdHk9IjAuMjIiLz48cmVjdCB4PSIwIiB5PSIyMzIiIHdpZHRoPSI0MDAiIGhlaWdodD0iNjgiIGZpbGw9IiMxRDIwMjYiIG9wYWNpdHk9IjAuMzAiLz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCN2KSIvPjwvc3ZnPg==',
    // Detail
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMzAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNDQkI1QTIiLz48c3RvcCBvZmZzZXQ9IjAuNTUiIHN0b3AtY29sb3I9IiM3QTY1NTgiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyNTFDMTciLz48L2xpbmVhckdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0idiIgY3g9IjAuNSIgY3k9IjAuNDIiIHI9IjAuNzUiPjxzdG9wIG9mZnNldD0iMC41NSIgc3RvcC1jb2xvcj0iIzAwMCIgc3RvcC1vcGFjaXR5PSIwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDAwIiBzdG9wLW9wYWNpdHk9IjAuMzgiLz48L3JhZGlhbEdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCNnKSIvPjxlbGxpcHNlIGN4PSIxMjgiIGN5PSIxOTYiIHJ4PSIxOTAiIHJ5PSIxMjAiIGZpbGw9IiMyNTFDMTciIG9wYWNpdHk9IjAuMjIiLz48cmVjdCB4PSIwIiB5PSIyMzIiIHdpZHRoPSI0MDAiIGhlaWdodD0iNjgiIGZpbGw9IiMyNTFDMTciIG9wYWNpdHk9IjAuMzAiLz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCN2KSIvPjwvc3ZnPg==',
  ],
  },

  financials: {
    purchasePrice: 1285000, stampDuty: 55832, legalFees: 2200, inspectionFees: 1450,
    loanFees: 1600, loanAmount: 1028000, totalCost: 1346082,
    weeklyRent: 950, annualRent: 49400,
    weeklyRepayment: 1180, annualRepayment: 61360,
    weeklyRates: 42, annualRates: 2184,
    weeklyInsurance: 31, annualInsurance: 1612,
    weeklyMaintenance: 48, annualMaintenance: 2496,
    weeklyManagement: 62, annualManagement: 3224,
    weeklyHolding: 183, annualHolding: 9516,
    weeklyCosts: 1363, weeklyNet: -413, annualNet: -21476,
    grossYield: 3.84, cashOnCash: 2.1, breakEvenRent: 1363,
    fundingNote:
      'Modelled at 80% LVR on a 30-year P&I facility at 6.14%, with the balance funded '
      + 'from the stated deposit and no lenders mortgage insurance.',
    narrative:
      'The holding is negatively geared by $413 a week before tax and roughly $268 after '
      + 'the depreciation and interest deductions modelled overleaf. That shortfall sits '
      + 'inside the household surplus with room to absorb a further 100bp of rate movement.',
  },

  assumptions: {
    capitalGrowth: 5.2, rentalGrowth: 3.1, interestRate: 6.14,
    expenseInflation: 2.8, vacancy: 2.0, taxRate: 39, sellingCosts: 2.5,
  },

  market: {
    postcode: '2040', state: 'NSW', suburbCount: 34,
    medianPrice: 1985000, medianPriceLast: 1871000,
    medianRent: 950, medianRentLast: 895,
    grossYield: 2.49, grossYieldLast: 2.35, yieldChange: 0.14,
    growth12m: 6.1, rentGrowth12m: 6.15,
    vacancy: 1.4, vacancyLast: 1.9, vacancyChange: -0.5,
    daysOnMarket: 21, daysOnMarketLast: 28, domChange: -7, daysToLease: 12,
    regionMedianPrice: 1642000, regionMedianRent: 820, regionGrowth12m: 4.8,
    regionVacancy: 1.7, regionGrossYield: 2.6, regionDaysOnMarket: 26,
    stateMedianPrice: 1180000, stateMedianRent: 720, stateGrowth12m: 3.9,
    stateVacancy: 2.1, stateGrossYield: 3.17, stateDaysOnMarket: 32,
    source: 'CoreLogic hedonic index, quarter close',
    censusSource: 'ABS Census, latest release',
    strength: [
      'Days on market fell from 28 to 21 across the year — buyers are competing earlier.',
      'Vacancy at 1.4% is half a point below the regional average.',
      'Rental growth of 6.15% outpaced price growth, lifting yield off its floor.',
    ],
    watch: [
      'Yield remains below 2.5%, so the case rests on land value rather than income.',
      'Two townhouse approvals within 900m add 46 dwellings from late next year.',
    ],
    narrative:
      'Leichhardt has moved from a recovery footing to a genuinely tight market. Stock on '
      + 'market is down, days on market has compressed by a week, and the rental market is '
      + 'clearing faster than the surrounding region. Prices have followed rents rather '
      + 'than led them, which is the healthier of the two sequences.',
    conclusion: {
      headline: 'Tight, land-constrained, and clearing faster than the region',
      body:
        'On every measure we track, the suburb is ahead of both its region and the state. '
        + 'The constraint is entry yield, not demand. Buy for the land and the ability to '
        + 'add a second dwelling, and treat the current rent as a floor rather than a case.',
    },
    drivers: [
      { title: 'Employment access', body: 'Thirty-one minutes to the CBD by light rail, with the Bays Precinct pipeline adding local white-collar roles.' },
      { title: 'Constrained supply', body: 'A conservation overlay across 60% of the suburb caps new detached stock almost entirely.' },
      { title: 'School catchment', body: 'In-catchment for two consistently over-subscribed public primary schools.' },
      { title: 'Amenity depth', body: 'Norton Street retail strip, two supermarkets and 4.2 hectares of parkland within 800m.' },
    ],
    calendar: [
      { date: 'Q1', label: 'Rate decision cycle', note: 'Three meetings; market pricing one cut.' },
      { date: 'Q2', label: 'Land tax assessments', note: 'Issued to investors; typical listing bump.' },
      { date: 'Q3', label: 'Spring listings', note: 'Volume rises 40%; best window to buy.' },
      { date: 'Q4', label: 'Townhouse completions', note: '46 dwellings settle 900m north.' },
    ],
    suburbs: [
      { name: 'Leichhardt', median: 1985000, rent: 950, yield: 2.49, growth: 6.1 },
      { name: 'Annandale', median: 2140000, rent: 990, yield: 2.41, growth: 5.4 },
      { name: 'Lilyfield', median: 1875000, rent: 920, yield: 2.55, growth: 6.8 },
      { name: 'Petersham', median: 1660000, rent: 880, yield: 2.76, growth: 5.9 },
      { name: 'Marrickville', median: 1595000, rent: 860, yield: 2.80, growth: 7.2 },
    ],
    regions: [
      { name: 'Inner West', median: 1642000, rent: 820, vacancy: 1.7, growth: 4.8 },
      { name: 'Eastern Suburbs', median: 2380000, rent: 1150, vacancy: 1.5, growth: 4.1 },
      { name: 'Lower North Shore', median: 2210000, rent: 1050, vacancy: 1.6, growth: 3.8 },
      { name: 'Northern Beaches', median: 1980000, rent: 980, vacancy: 1.4, growth: 4.4 },
      { name: 'Parramatta', median: 1120000, rent: 700, vacancy: 2.3, growth: 5.6 },
      { name: 'Sutherland', median: 1385000, rent: 760, vacancy: 1.8, growth: 4.2 },
    ],
  },

  scorecard: {
    locationNote: 'Inside the 8km ring with rail and light rail access.',
    yieldNote: 'Below the metro median; the case is land, not income.',
    growthNote: 'Ten-year CAGR of 6.4% through two rate cycles.',
    conditionNote: 'Sound structure; kitchen and bathroom at end of life.',
    tenantAppealNote: 'Three bedrooms and a level yard suit the dominant family profile.',
  },

  summary: {
    narrative:
      'A land-led acquisition in a supply-constrained inner-west suburb, bought below the '
      + 'suburb median with a clear path to a second income stream.',
    strength: [
      '412m² of R2 land, 18% above the suburb average lot size',
      'Compliant secondary-dwelling footprint confirmed at concept level',
      'Vacancy at 1.4% with a 12-day average letting time',
    ],
    watch: [
      'Entry yield of 3.84% needs the shortfall serviced from income',
      'Kitchen and bathroom will need $60–80k inside three years',
    ],
    for: 'Land value, catchment, and a second dwelling the numbers already support.',
    against: 'Thin entry yield and near-term capital works.',
  },

  risk: {
    horizon: '10+ years', horizonNote: 'Long enough to absorb a full rate cycle.',
    income: 268000, incomeStability: 'Both incomes permanent and ongoing',
    surplus: 3850, reserves: 62000, debt: 41500, dependants: '1',
    experience: 'One prior purchase (owner-occupied)',
    growthOrIncome: 'Growth-weighted',
    negativeCashFlow: 'Accepted to $600/week',
    vacancy: 'Can absorb 8 weeks', valueFall: 'Can absorb a 20% paper fall',
    toleranceNote: 'Balanced — accepts volatility for growth but not forced sale risk.',
    capacityAssessment: 'Adequate',
    capacityNote:
      'Surplus covers the modelled shortfall 9x over, and reserves cover eight months '
      + 'of holding costs with the property vacant.',
  },

  risks: RISKS,
  nextSteps: NEXT_STEPS,
  steps: [
    'Confirm the brief and set the search parameters',
    'Shortlist and inspect against the scorecard',
    'Model the shortlist and rank on risk-adjusted return',
    'Negotiate, exchange, and manage to settlement',
    'Review annually against the original thesis',
  ],
  prep: [
    action('Collect two years of tax returns and payslips', 'Client', 'Week 1'),
    action('Obtain a written pre-approval with a valuation buffer', 'Broker', 'Week 2'),
    action('Sign the engagement and set the search brief', 'Adviser', 'Week 2'),
  ],
  watch: [
    { date: 'Mar', label: 'Rate decision', note: 'Second of three meetings this quarter.' },
    { date: 'Jun', label: 'Land tax', note: 'Assessment issued; listing volume rises.' },
    { date: 'Sep', label: 'Spring market', note: 'Peak listing window opens.' },
    { date: 'Dec', label: 'Townhouse completions', note: '46 dwellings settle nearby.' },
  ],

  drivers: withFields([
    {
      title: 'Transport access', body: 'Light rail to Central in 31 minutes, plus two bus corridors.',
      evidence: 'Transport for NSW patronage data, latest release', watch: 'No planned service reduction.',
    },
    {
      title: 'Supply constraint', body: 'Conservation overlay covers 60% of detached stock.',
      evidence: 'Inner West DCP, heritage schedule', watch: 'Overlay under review in the next LEP cycle.',
    },
    {
      title: 'Employment pipeline', body: 'Bays Precinct staging adds 8,000 roles within 5km.',
      evidence: 'Infrastructure NSW staging report', watch: 'Delivery has slipped twice.',
    },
    {
      title: 'Household formation', body: 'Family households up 4.1% since the last census.',
      evidence: 'ABS Census, latest release', watch: 'Growth concentrated in the 30–44 cohort.',
    },
  ], {
    conclusion: {
      headline: 'Supply constraint is the durable driver',
      body: 'Transport and employment help, but the overlay is what keeps detached stock scarce.',
    },
  }),

  supply: [
    { name: 'Norton Street mixed-use', type: 'Apartments', dwellings: 84, status: 'Under construction', completion: 'Q4 next year' },
    { name: 'Marion Street townhouses', type: 'Townhouses', dwellings: 46, status: 'Approved', completion: 'Q2 following year' },
    { name: 'Balmain Road infill', type: 'Apartments', dwellings: 32, status: 'At DA', completion: 'Not before Q4 +2' },
    { name: 'Catherine Street terraces', type: 'Terraces', dwellings: 9, status: 'Approved', completion: 'Q1 next year' },
  ],

  finance: {
    monthlyRepayment: 5113, annualRepayment: 61360,
    monthlyRates: 182, annualRates: 2184,
    monthlyInsurance: 134, annualInsurance: 1612,
    monthlyMaintenance: 208, annualMaintenance: 2496,
    monthlyStrata: 0, annualStrata: 0,
    monthlyWater: 71, annualWater: 852,
    monthlyCost: 5708, annualCost: 68504,
    capacity: 1340000, maxPurchase: 1385000,
    narrative:
      'Serviceability is assessed at a 3% buffer over the offered rate. At that '
      + 'assessment the household clears the modelled commitment with $1,240 a month spare.',
  },

  grants: { fhog: 10000, dutyConcession: 31090, depositScheme: 'Eligible — 5% deposit, no LMI', total: 41090 },

  tax: {
    marginalRate: 39, preTaxWeekly: -413, benefitWeekly: 145, afterTaxWeekly: -268,
    totalDeductions: 71240, depreciationNote: 'Division 43 at 2.5% plus plant and equipment from a quantity surveyor schedule.',
    deductions: [
      { amount: 61360, note: 'Loan interest at the modelled rate' },
      { amount: 2496, note: 'Repairs and maintenance' },
      { amount: 3224, note: 'Property management fees' },
      { amount: 1612, note: 'Landlord insurance' },
      { amount: 2184, note: 'Council rates' },
      { amount: 364, note: 'Water and sewerage' },
      { amount: 0, note: 'Strata levies — not applicable' },
    ],
    narrative:
      'The deductible position converts a $413 weekly pre-tax shortfall into $268 after tax '
      + 'at the stated marginal rate.',
    conclusion: {
      headline: 'Serviceable after tax, but not a tax strategy',
      body: 'The deduction improves the holding cost; it does not make a weak asset strong.',
    },
  },

  cashflow: Array.from({ length: 10 }, (_, i) => {
    const rent = Math.round(49400 * 1.031 ** i);
    const costs = Math.round(68504 * 1.028 ** i);
    return {
      rent, costs, preTax: rent - costs,
      afterTax: Math.round((rent - costs) * 0.61),
      value: Math.round(1285000 * 1.052 ** (i + 1)),
    };
  }).reduce((acc: Record<string, unknown>, row, i) => {
    acc[String(i)] = row;
    return acc;
  }, {
    breakEvenNote: 'Pre-tax cash flow turns positive in year seven on the modelled assumptions.',
    narrative:
      'Rent compounds faster than costs from year four, and the position crosses into '
      + 'positive pre-tax territory in year seven without any rate relief assumed.',
    conclusion: {
      headline: 'Positive by year seven without assuming a rate cut',
      body: 'The crossover is driven by rental growth, which is the assumption to stress-test hardest.',
    },
  }),

  drag: {
    yield: 3.84, growth: 5.2, maintenance: 2496, lvr: 80, net: -21476,
    summary: 'Holding costs are the binding constraint in the first six years.',
    recommendation: {
      headline: 'Hold, and revisit at the year-three review',
      body: 'Selling inside five years surrenders the growth that funds the early shortfall.',
    },
  },

  equity: {
    totalValue: 3410000, totalDebt: 2088000, paper: 1322000, usable: 640000, lvrLimit: 80,
    holdings: [
      { address: '9/44 Regent Street, Newtown', value: 1125000, debt: 612000, lvr: 54.4, usable: 288000 },
      { address: ADDRESS, value: 1285000, debt: 1028000, lvr: 80.0, usable: 0 },
      { address: '7 Wardell Road, Dulwich Hill', value: 640000, debt: 288000, lvr: 45.0, usable: 224000 },
      { address: '12/3 Denison Road, Lewisham', value: 360000, debt: 160000, lvr: 44.4, usable: 128000 },
    ],
    scenarios: [
      { deposit: 128000, capacity: 512000, maxPurchase: 640000 },
      { deposit: 224000, capacity: 896000, maxPurchase: 1120000 },
      { deposit: 288000, capacity: 1152000, maxPurchase: 1440000 },
    ],
    constraintNote: 'Serviceability, not equity, is the binding constraint at the third scenario.',
    recommendation: {
      headline: 'Release to the second scenario only',
      body: 'The third clears on equity but leaves no buffer if rates move another 50bp.',
    },
  },

  portfolio: {
    count: 4, value: 3410000, debt: 2088000, equity: 1322000, lvr: 61.2,
    grossYield: 4.12, growth12m: 5.4, netCashFlow: -14200,
    avgYield: 4.12, avgGrowth: 5.4, avgNet: -3550, avgMaintenance: 2180,
    holdings: [
      { address: '9/44 Regent Street, Newtown', value: 1125000, debt: 612000, equity: 513000, yield: 3.9, net: 2100 },
      { address: ADDRESS, value: 1285000, debt: 1028000, equity: 257000, yield: 3.84, net: -21476 },
      { address: '7 Wardell Road, Dulwich Hill', value: 640000, debt: 288000, equity: 352000, yield: 4.6, net: 3400 },
      { address: '12/3 Denison Road, Lewisham', value: 360000, debt: 160000, equity: 200000, yield: 4.9, net: 1776 },
      { address: 'Portfolio total', value: 3410000, debt: 2088000, equity: 1322000, yield: 4.12, net: -14200 },
    ],
    scores: {
      growthNote: 'Weighted growth of 5.4% is ahead of the metro average.',
      cashFlowNote: 'Net position is negative but improving year on year.',
      gearingNote: 'Portfolio LVR of 61% leaves headroom for one more acquisition.',
      diversificationNote: 'All four assets sit within 6km — concentrated by geography.',
    },
    strength: ['Weighted growth ahead of the metro average', 'LVR leaves room for one further purchase'],
    watch: ['All four assets within 6km of each other', 'Net cash flow still negative overall'],
    actions: [
      action('Refinance the Newtown facility off its expiring fixed rate', 'Broker', 'Within 60 days'),
      action('Obtain a depreciation schedule for the Leichhardt purchase', 'Adviser', 'Post-settlement'),
      action('Review the Lewisham holding against its original thesis', 'Client', 'Year-end'),
      action('Diversify the next acquisition outside the inner west', 'Adviser', 'Next cycle'),
    ],
    narrative:
      'The portfolio is performing on growth and under-performing on income, which is the '
      + 'expected shape for four inner-ring assets bought inside six years.',
    recommendation: {
      headline: 'Diversify the next purchase by geography',
      body: 'Concentration is now the largest uncompensated risk in the portfolio.',
    },
  },

  ranking: [
    { address: '7 Wardell Road, Dulwich Hill', growth: 7.1, net: 3400, equity: 352000, contribution: 31 },
    { address: '12/3 Denison Road, Lewisham', growth: 6.2, net: 1776, equity: 200000, contribution: 24 },
    { address: '9/44 Regent Street, Newtown', growth: 5.1, net: 2100, equity: 513000, contribution: 28 },
    { address: ADDRESS, growth: 4.4, net: -21476, equity: 257000, contribution: 12 },
    { address: 'Portfolio weighted average', growth: 5.4, net: -3550, equity: 330500, contribution: 100 },
  ],

  comparison: {
    a: {
      address: ADDRESS, price: 1285000, rent: 950, yield: 3.84, net: -413, land: '412 m²',
      built: '1928', config: '3 bed · 2 bath · 1 car', condition: 'Original', growth: 6.1,
      median: 1985000, vacancy: 1.4,
      summary: 'Land-led, thin yield, clear second-dwelling path.',
      scoreNote: 'Wins on land and catchment; loses on entry yield.',
    },
    b: {
      address: '22 Chapel Street, Marrickville NSW 2204', price: 1180000, rent: 890, yield: 3.92,
      net: -352, land: '328 m²', built: '1946', config: '3 bed · 1 bath · 1 car',
      condition: 'Renovated 2021', growth: 7.2, median: 1595000, vacancy: 1.6,
      summary: 'Cheaper entry, better growth, less land.',
      scoreNote: 'Best growth of the three but the smallest development envelope.',
    },
    c: {
      address: '5 Wentworth Road, Burwood NSW 2134', price: 1420000, rent: 1050, yield: 3.84,
      net: -468, land: '556 m²', built: '1962', config: '4 bed · 2 bath · 2 car',
      condition: 'Part-renovated', growth: 4.9, median: 2050000, vacancy: 2.1,
      scoreNote: 'Most land, weakest growth and the highest holding cost.',
    },
    alternative: 'Marrickville is the closer call; Burwood is ruled out on growth.',
    recommendation: {
      headline: 'Leichhardt on land, Marrickville on growth — take Leichhardt',
      body:
        'Marrickville has the better recent growth number, but Leichhardt has 84m² more land '
        + 'and a development envelope that converts into a second income stream. Over a ten-year '
        + 'horizon the optionality is worth more than 1.1 points of trailing growth.',
    },
  },

  options: {
    a: { capital: 0, costs: 21476, cashFlow: -413, tax: 145, value10: 2128000, equity10: 1100000, reversibility: 'Full' },
    b: { capital: 185000, costs: 34200, cashFlow: 180, tax: 210, value10: 2410000, equity10: 1197000, reversibility: 'Partial' },
    c: { capital: 0, costs: 0, cashFlow: 0, tax: 0, value10: 1285000, equity10: 1285000, reversibility: 'None' },
    risks: RISKS,
    recommendation: {
      headline: 'Hold and add the secondary dwelling in year three',
      body: 'Option B carries the best ten-year equity outcome once the build is funded from released equity rather than cash.',
    },
  },

  reno: {
    budget: 185000, acquisitionCosts: 1346082, holdingCost: 21600, holdingWeeks: 24,
    totalInvested: 1552682, endValue: 1740000, margin: 187318, marginPercent: 12.1,
    items: [
      { scope: 'Kitchen replacement', cost: 42000, basis: 'Builder quote, fixed price' },
      { scope: 'Two bathrooms', cost: 48000, basis: 'Builder quote, fixed price' },
      { scope: 'Flooring and paint throughout', cost: 31000, basis: 'Rate per m²' },
      { scope: 'Electrical and lighting', cost: 18500, basis: 'Provisional sum' },
      { scope: 'Landscaping and fencing', cost: 22000, basis: 'Quote' },
      { scope: 'Contingency at 13%', cost: 23500, basis: 'Percentage of works' },
    ],
    risks: RISKS,
    marginNote: 'Margin is stated before selling costs and assumes no change to the end-value comparables.',
    narrative:
      'The works lift the property from the bottom quartile of the street to the median '
      + 'without touching the heritage-controlled façade.',
  },

  development: {
    siteArea: '412 m²', zoning: 'R2 Low Density Residential', fsr: '0.5:1', heightLimit: '8.5 m',
    setbacks: '6m front, 900mm side, 3m rear', parking: '1 space per dwelling',
    affordable: 'Not applicable below 10 dwellings', dwellings: 2, gfa: '206 m²',
    grossRevenue: 2180000, sellingCosts: 54500, netRevenue: 2125500,
    totalCost: 1806000, residual: 319500, developerMargin: 319500, marginPercent: 17.7,
    products: [
      { type: 'Retained dwelling (renovated)', count: 1, price: 1340000, revenue: 1340000 },
      { type: 'New secondary dwelling', count: 1, price: 840000, revenue: 840000 },
      { type: 'Car space (strata)', count: 0, price: 0, revenue: 0 },
    ],
    costs: [
      { note: 'Land acquisition', rate: 'Contract', amount: 1285000 },
      { note: 'Construction', rate: '$3,100/m²', amount: 338000 },
      { note: 'Professional fees', rate: '8% of build', amount: 27000 },
      { note: 'Authority contributions', rate: 'Section 7.11', amount: 42000 },
      { note: 'Finance costs', rate: '7.2% over 14 months', amount: 74000 },
      { note: 'Contingency', rate: '5% of cost', amount: 40000 },
    ],
    programme: [
      { date: 'Months 1–4', note: 'DA lodgement and determination' },
      { date: 'Months 5–6', note: 'Construction certificate and tender' },
      { date: 'Months 7–16', note: 'Construction' },
      { date: 'Months 17–18', note: 'Occupation certificate and settlement' },
    ],
    risks: RISKS,
  },

  commercial: {
    passingYield: 5.8, capRate: 6.1, occupancy: 92, wale: 3.4,
    netIncome: 268000, marketIncome: 291000, fullyLeasedIncome: 302000, totalOutgoings: 84000,
    valuePassing: 4620000, valueMarket: 4770000, valueFullyLeased: 4950000,
    tenants: [
      { name: 'Harrow & Fitch Legal', area: '310 m²', rent: 108500, expiry: 'Mar +3', review: 'CPI + 1%' },
      { name: 'Lumen Physiotherapy', area: '186 m²', rent: 62000, expiry: 'Sep +2', review: 'Fixed 3.5%' },
      { name: 'Corso Coffee Roasters', area: '95 m²', rent: 47500, expiry: 'Jan +5', review: 'Fixed 4%' },
      { name: 'Vacant — Suite 4', area: '124 m²', rent: 0, expiry: '—', review: '—' },
    ],
    outgoings: [
      { amount: 31000, recoverable: 'Recoverable', net: 0 },
      { amount: 24000, recoverable: 'Recoverable', net: 0 },
      { amount: 12000, recoverable: 'Recoverable', net: 0 },
      { amount: 11000, recoverable: 'Not recoverable', net: 11000 },
      { amount: 6000, recoverable: 'Not recoverable', net: 6000 },
    ],
    concentrationNote: 'The largest tenant contributes 49% of income and expires inside the WALE.',
    recommendation: {
      headline: 'Price on passing income, underwrite the vacancy',
      body: 'The fully-leased number is achievable but should not be paid for at acquisition.',
    },
  },

  smsf: {
    name: 'Nguyen Family Superannuation Fund', trustee: 'Nguyen Custodial Pty Ltd',
    members: 'Jordan Nguyen, Sarah Nguyen', balance: 612000, available: 448000,
    lrba: 'Yes — bare trust established', lvr: 62, rate: 6.85, interest: 54800,
    rentalIncome: 49400, outgoings: 9516, adminCost: 3400, netToFund: -18316,
    contributionsRequired: 21000, liquidityAfter: 164000,
    strategyAllows: 'Yes — direct property permitted under the current investment strategy',
    boundaries: 'No related-party lease; no improvements funded by borrowings',
    structure: [
      'Fund acquires via a bare trust with a corporate custodian',
      'Single acquirable asset — no subdivision while the LRBA is on foot',
      'Repairs permitted; improvements must be funded from fund cash',
      'Lease must be at arm\'s length and on commercial terms',
    ],
    risks: RISKS,
  },

  brief: {
    objective: 'Build a growth-weighted portfolio funding a work-optional position by age 55',
    purpose: 'Investment — long-term hold', budget: 1290000, maxPrice: 1340000, maxStretch: 1385000,
    propertyType: 'Freestanding house or semi', configuration: '3+ bed, 1+ bath, off-street parking',
    minLand: '380 m²', locations: 'Leichhardt, Annandale, Lilyfield, Petersham, Marrickville',
    horizon: '10+ years', timeframe: 'Exchange within 90 days', targetYield: 3.5, targetReturn: 8.5,
    riskTolerance: 'Balanced — growth-weighted', authority: 'Adviser to negotiate; client to exchange',
    reporting: 'Weekly shortlist, full report before any offer',
    compromises: 'Will trade condition for land; will not trade catchment',
    dealBreakers: [
      'Main-road frontage',
      'Strata title',
      'Flood-affected land',
      'No off-street parking',
    ],
  },

  engagement: {
    scope: [
      'Define the brief and confirm borrowing capacity',
      'Search, shortlist and inspect against agreed criteria',
      'Provide a written report before any offer',
      'Negotiate and manage the process to exchange',
      'Coordinate inspections and settlement milestones',
    ],
    reporting: 'Weekly written update, plus a full report before any offer',
    responseTime: 'Within one business day',
  },

  fees: withFields([
    { basis: 'Engagement fee', amount: 4400, when: 'On signing' },
    { basis: 'Success fee — 1.65% of purchase price', amount: 21203, when: 'On exchange' },
    { basis: 'Renovation project management', amount: 0, when: 'Only if separately engaged' },
  ], {
    exclusions:
      'Fees exclude stamp duty, legal and conveyancing costs, building and pest inspections, '
      + 'strata reports, and any lender or broker charges. These are payable directly to the '
      + 'provider and are not collected by us.',
  }),

  onboarding: {
    needs: [
      { action: 'Provide identification for AML verification', timing: 'Before engagement' },
      { action: 'Provide income and liability evidence', timing: 'Week 1' },
      { action: 'Confirm the brief in writing', timing: 'Week 2' },
    ],
  },

  opportunity: {
    reason: 'Deceased estate — executors seeking a pre-market settlement',
    vendorPosition: 'Motivated; prefers certainty over price',
    deadline: 'Expressions of interest close Friday 5pm',
    settlement: '42 days, or longer by negotiation',
    rationale: 'Priced against unrenovated comparables while the land supports two dwellings.',
    recommendation: 'Offer $1,265,000 with a 10% deposit and a short cooling-off waiver.',
    narrative:
      'This has not been listed publicly. The executors want a clean exchange before the '
      + 'end of the quarter, which is where the discount sits.',
    strength: ['Priced below the last three comparable land sales', 'No competing buyers currently engaged'],
    unknown: ['Building and pest not yet completed', 'No survey on file', 'Rental appraisal is verbal only'],
  },

  dd: {
    period: '10 business days from exchange',
    method: {
      inspection: 'Two physical inspections, including one with the building consultant',
      reports: 'Building, pest, and a structural engineer opinion on the rear wall',
      searches: 'Title, planning certificate, sewer diagram, land tax clearance',
      documents: 'Contract, vendor disclosure, prior DA approvals, rates notices',
    },
    findings: [
      { matter: 'Title', finding: 'Torrens title, no easements affecting the buildable area', status: 'Clear' },
      { matter: 'Planning', finding: 'R2 zoning confirmed; conservation area applies to the façade', status: 'Clear' },
      { matter: 'Structure', finding: 'Rear wall shows historic movement; engineer reports it stable', status: 'Noted' },
      { matter: 'Pest', finding: 'Evidence of previous termite activity, treated 2019', status: 'Noted' },
      { matter: 'Services', finding: 'Sewer line crosses the rear yard, offset from the build envelope', status: 'Action' },
      { matter: 'Tenancy', finding: 'Vacant possession confirmed; no residential tenancy agreement on foot', status: 'Clear' },
    ],
    risks: RISKS,
    checklist: [...NEXT_STEPS, action('Confirm the sewer offset with a service locator', 'Adviser', 'Before settlement')],
    conclusion: {
      headline: 'No matter identified that changes the recommendation',
      body: 'Two items require action before settlement; neither affects value materially.',
    },
  },

  inspection: {
    date: '18th, 11:00am', weather: 'Fine, 22°C', present: 'Adviser, client, building consultant',
    areas: [
      { condition: 'Good', defects: 'None observed', cost: 0 },
      { condition: 'Fair', defects: 'Bench and cabinetry at end of life', cost: 42000 },
      { condition: 'Poor', defects: 'Waterproofing failed at shower base', cost: 24000 },
      { condition: 'Fair', defects: 'Original wiring in two rooms', cost: 18500 },
      { condition: 'Good', defects: 'Roof replaced 2019, gutters sound', cost: 0 },
      { condition: 'Fair', defects: 'Rear fence leaning, needs replacement', cost: 6500 },
    ],
    scores: {
      locationNote: 'Quiet street, 400m to light rail',
      conditionNote: 'Sound structure, dated services',
      layoutNote: 'Original layout works; kitchen is isolated from living',
      appealNote: 'Presents poorly, which is where the buying opportunity is',
    },
    recommendation: {
      headline: 'Proceed, with $91,000 allowed for immediate works',
      body: 'Nothing found is structural. The defect list is cosmetic and services-related.',
    },
  },

  rental: {
    householdType: 'Family households, 62% of the suburb',
    tenantAge: '30–44 is the largest cohort',
    rentingShare: 38, tenancyLength: '2.4 years average',
    house: { 1: 620, 2: 780, 3: 950, 4: 1180 },
    unit: { 1: 480, 2: 640, 3: 820, 4: 980 },
    town: { 1: 540, 2: 700, 3: 880, 4: 1050 },
    actions: [
      action('List two weeks before settlement to avoid a vacancy gap', 'Adviser', 'Pre-settlement'),
      action('Present unfurnished; the cohort brings its own', 'Agent', 'At listing'),
      action('Set the asking rent at $950, not $980', 'Agent', 'At listing'),
    ],
    recommendation: {
      headline: 'Ask $950 and let in under two weeks',
      body: 'Pushing to $980 adds an estimated 11 days of vacancy, which costs more than it gains.',
    },
  },

  kyc: {
    customerType: 'Individual — joint applicants', verifier: 'A. Whitfield (Adviser)',
    primary: { type: 'Australian passport', ref: 'PA••••417', sighted: 'Original sighted', verified: 'Verified' },
    secondary: { type: 'NSW driver licence', ref: 'DL••••882', sighted: 'Original sighted', verified: 'Verified' },
    address: { type: 'Utility account', ref: 'UT••••310', sighted: 'Certified copy', verified: 'Verified' },
    pep: 'No match', beneficialOwners: 'Not applicable — individual applicants',
    ownershipEvidence: 'Not applicable',
    sourceOfFunds: 'Employment income and sale proceeds of a prior residence',
    fundsEvidence: 'Six months of bank statements and a settlement statement sighted',
    fundsConsistent: 'Consistent with the stated occupation and income',
    screening: [
      { provider: 'Sanctions and PEP screen', date: 'On engagement', result: 'No match' },
      { provider: 'Adverse media screen', date: 'On engagement', result: 'No match' },
      { provider: 'Politically exposed person re-screen', date: 'Annual review', result: 'No match' },
    ],
    risk: {
      customerNote: 'Low — domestic individuals, verified in person',
      geoNote: 'Low — all parties and funds domestic',
      productNote: 'Low — advisory only, no custody of client funds',
      overallNote: 'Low — standard customer due diligence applied',
    },
  },

  advice: {
    date: 'On engagement', adviser: 'Alexandra Whitfield', reference: 'ADV-2040-118',
    basis: 'Personal advice based on the stated objectives and circumstances',
    objectives:
      'Build a growth-weighted property portfolio capable of funding a work-optional '
      + 'position by age 55, without compromising the household\'s current lifestyle.',
    financialSituation:
      'Combined income of $268,000, one owner-occupied property with $513,000 of equity, '
      + '$41,500 of consumer debt, and $340,000 available for deposit and costs.',
    needs:
      'A single acquisition inside the 8km ring, held long term, with a shortfall no '
      + 'greater than $600 per week.',
    riskProfile: 'Balanced — growth-weighted, accepts volatility but not forced-sale risk.',
    recommendation:
      'Acquire 14 Marlborough Street, Leichhardt at or below $1,290,000, funded at 80% LVR '
      + 'on a 30-year principal-and-interest facility, with 60% of the balance fixed for '
      + 'three years.',
    reasoning:
      'The property meets the land, catchment and tenant-demand criteria in the brief, and '
      + 'the modelled shortfall is serviced nine times over by the stated surplus. The '
      + 'secondary-dwelling envelope provides a second income stream without a further '
      + 'acquisition, which is the most capital-efficient route to the stated objective.',
    scopeLimitation:
      'This advice covers the property acquisition only. It is not tax, credit or legal '
      + 'advice, and does not consider your superannuation, insurance or estate planning.',
    gaps:
      'No quantity surveyor depreciation schedule was available at the time of advice. '
      + 'Depreciation figures are estimates and should be confirmed post-settlement.',
    alternatives: [
      { option: 'Acquire in Marrickville at $1,180,000', reason: 'Stronger trailing growth but 84m² less land and no development envelope.' },
      { option: 'Acquire in Burwood at $1,420,000', reason: 'More land, but weaker growth and a higher weekly shortfall.' },
      { option: 'Defer for twelve months', reason: 'Rejected — holding costs of delay exceed the modelled price risk.' },
    ],
    disclosures: [
      { detail: 'Success fee of 1.65% of the purchase price, payable on exchange', date: 'On engagement', ack: 'Acknowledged' },
      { detail: 'No commission or referral fee is received from any lender', date: 'On engagement', ack: 'Acknowledged' },
      { detail: 'No ownership interest in any property presented', date: 'On engagement', ack: 'Acknowledged' },
      { detail: 'Building and pest providers are independent of this firm', date: 'On engagement', ack: 'Acknowledged' },
    ],
  },

  review: {
    type: 'Annual file review', period: 'Financial year to date', date: 'Quarter close',
    reviewer: 'M. Okafor', adviser: 'A. Whitfield', reference: 'QA-2040-118',
    result: 'Compliant with two observations', checkedCount: 18, failedCount: 2, dueDate: 'Within 30 days',
    items: [
      { item: 'Engagement signed before advice given', result: 'Pass', comment: 'Signed and filed' },
      { item: 'Identification verified and recorded', result: 'Pass', comment: 'Both applicants' },
      { item: 'Fee disclosure provided', result: 'Pass', comment: 'Acknowledged in writing' },
      { item: 'Written report issued before offer', result: 'Pass', comment: 'Issued two days prior' },
      { item: 'Conflicts declared', result: 'Observation', comment: 'Declaration undated' },
      { item: 'File notes contemporaneous', result: 'Observation', comment: 'Two entries added late' },
      { item: 'Advice record complete and dated', result: 'Pass', comment: 'All sections completed' },
      { item: 'Client acknowledgement on file', result: 'Pass', comment: 'Signed and returned' },
    ],
    actions: [
      { action: 'Re-date and re-file the conflicts declaration', owner: 'Adviser', due: 'Within 14 days' },
      { action: 'Refresher on contemporaneous file notes', owner: 'Compliance', due: 'Within 30 days' },
      { action: 'Re-test both observations at the next quarterly review', owner: 'Compliance', due: 'Next quarter' },
    ],
    note: 'Internal quality assurance record. Not for distribution outside the licensee.',
  },

  attestation: {
    period: 'Financial year', officer: 'M. Okafor, Responsible Manager',
    obligationCount: 14, compliantCount: 12, exceptionCount: 2, overdueCount: 0,
    items: [
      { obligation: 'Maintain adequate professional indemnity cover', status: 'Compliant', evidence: 'Certificate of currency on file' },
      { obligation: 'Maintain competence and training records', status: 'Compliant', evidence: 'CPD register, 42 hours' },
      { obligation: 'Complaints handling within prescribed timeframes', status: 'Compliant', evidence: 'Register reviewed' },
      { obligation: 'AML/CTF programme independently reviewed', status: 'Exception', evidence: 'Review overdue by one cycle' },
      { obligation: 'Breach reporting procedures current', status: 'Exception', evidence: 'Procedure not updated for the latest guidance' },
      { obligation: 'Client money handled per licence conditions', status: 'Compliant', evidence: 'No client money held at any time' },
    ],
    exceptions: [
      { item: 'AML/CTF independent review', why: 'Reviewer engagement lapsed', action: 'Engage a reviewer and complete within the quarter' },
      { item: 'Breach reporting procedure', why: 'Guidance updated after the last revision', action: 'Revise and re-issue to all staff' },
    ],
    statement:
      'I have made reasonable enquiry and, other than the exceptions recorded above, the '
      + 'obligations listed have been met for the period stated.',
  },

  complaints: {
    period: 'Financial year', received: 4, resolved: 3, outstanding: 1, avgDays: 11,
    items: [
      { ref: 'C-118', received: 'Q1', category: 'Fee clarity', days: 6, status: 'Resolved' },
      { ref: 'C-119', received: 'Q2', category: 'Communication frequency', days: 9, status: 'Resolved' },
      { ref: 'C-120', received: 'Q3', category: 'Report accuracy', days: 18, status: 'Resolved' },
      { ref: 'C-121', received: 'Q4', category: 'Fee clarity', days: 11, status: 'Open' },
    ],
    systemic: [
      { issue: 'Fee clarity raised twice', why: 'Success fee basis not restated at exchange', action: 'Add a fee restatement to the pre-exchange checklist' },
      { issue: 'One matter exceeded the 14-day target', why: 'Owner on leave with no delegate assigned', action: 'Assign a standing delegate for the complaints register' },
    ],
  },

  /**
   * The ten-year projection matrix.
   *
   * Shaped to match the legacy `CashFlowAnalysisModal` export — the same input
   * set, the same four banded groups (statistics, cash deductions, non-cash
   * deductions, summary), the same milestone columns — so the three
   * legacy-derived catalogue templates preview against realistic figures
   * rather than empty cells.
   *
   * Derived from the sample property above, not copied from any client file.
   */
  tenYear: (() => {
    const price = 1285000;
    const deposit = Math.round(price * 0.2);
    const loan = price - deposit;
    const weeklyRent = 950;
    const growth = 5.2;
    const cpi = 3.1;
    const rate = 6.14;
    const taxRate = 37;

    const money = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;
    const signed = (n: number) =>
      (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-AU');

    const years = Array.from({ length: 10 }, (_, i) => {
      const y = i + 1;
      const value = price * (1 + growth / 100) ** y;
      const balance = loan * (1 - 0.018 * y);
      const rent = weeklyRent * 52 * (1 + cpi / 100) ** i;
      const expenses = 10610 * (1 + cpi / 100) ** i;
      const interest = balance * (rate / 100);
      const principal = loan * 0.018;
      const preTax = rent - expenses - interest - principal;
      const deductions = expenses + interest;
      const netProfit = rent - deductions;
      const refund = netProfit < 0 ? -netProfit * (taxRate / 100) : 0;
      const afterTax = preTax + refund;
      return {
        y, value, balance, equity: value - balance, lvr: (balance / value) * 100,
        rent, grossYield: (rent / value) * 100,
        netYield: ((rent - expenses) / value) * 100,
        expenses, interest, principal, preTax, deductions, netProfit, refund, afterTax,
      };
    });

    const last = years[years.length - 1];
    const row = (pick: (r: typeof years[0]) => string) => years.map(pick);

    return {
      // Column headings, so a template does not hard-code the horizon.
      years: years.map((r) => `Yr ${r.y}`),
      // ── Inputs ────────────────────────────────────────────────────────────
      inputs: {
        purchasePrice: money(price), landPrice: '—', buildPrice: money(price),
        deposit: money(deposit), loanAmount: money(loan),
        interestRate: `${rate.toFixed(2)}%`, capitalGrowth: `${growth.toFixed(1)}%`,
        cpiGrowth: `${cpi.toFixed(1)}%`, taxRate: `${taxRate}%`, depreciation: '—',
        weeklyRent: money(weeklyRent), grossYield: `${((weeklyRent * 52 / price) * 100).toFixed(2)}%`,
        councilRates: '$2,800', waterRates: '$1,100', propertyManagement: '8%',
        landlordInsurance: '$1,800', lettingFees: money(weeklyRent),
        repairs: '$2,500', bodyCorporate: '—',
        stampDuty: '$54,190', conveyancing: '$1,800',
      },
      upfront: {
        deposit: money(deposit), stampDuty: '$54,190', conveyancing: '$1,800',
        agentFee: '$4,940', total: money(deposit + 54190 + 1800 + 4940),
        overall: money(price + 54190 + 1800 + 4940),
      },
      // ── Matrix rows, pre-formatted per year ───────────────────────────────
      matrix: {
        capitalGrowth: row(() => growth.toFixed(1)),
        cpiGrowth: row(() => cpi.toFixed(1)),
        propertyValue: row((r) => money(r.value)),
        loanAmount: row((r) => money(r.balance)),
        equity: row((r) => money(r.equity)),
        lvr: row((r) => r.lvr.toFixed(1)),
        rentalIncome: row((r) => money(r.rent)),
        grossYield: row((r) => r.grossYield.toFixed(2)),
        netYield: row((r) => r.netYield.toFixed(2)),
        expenses: row((r) => money(r.expenses)),
        landTax: row(() => '—'),
        interestRate: row(() => rate.toFixed(2)),
        interestPayments: row((r) => money(r.interest)),
        principalPayments: row((r) => money(r.principal)),
        preTaxPA: row((r) => signed(r.preTax)),
        preTaxPW: row((r) => signed(r.preTax / 52)),
        depreciation: row(() => '—'),
        totalDeductions: row((r) => money(r.deductions)),
        netProfitLoss: row((r) => signed(r.netProfit)),
        taxRefund: row((r) => money(r.refund)),
        afterTaxPA: row((r) => signed(r.afterTax)),
        afterTaxPW: row((r) => signed(r.afterTax / 52)),
      },
      today: {
        propertyValue: money(price), loanAmount: money(loan),
        equity: money(deposit), lvr: '80.0', rentalIncome: `${money(weeklyRent)}pw`,
      },
      summary: {
        propertyValue: money(last.value), totalEquity: money(last.equity),
        capitalGain: money(last.value - price),
        totalAfterTax: signed(years.reduce((a, r) => a + r.afterTax, 0)),
      },
      insight: {
        value: `The property is projected to appreciate by ${(((last.value - price) / price) * 100).toFixed(1)}% over the ten-year horizon, from ${money(price)} to ${money(last.value)}, on the configured capital growth assumption.`,
        equity: `Equity increases from ${money(deposit)} to ${money(last.equity)}, driven by both capital appreciation and principal repayments reducing the outstanding loan balance.`,
        cashFlow: `After-tax cash flow improves by ${signed(last.afterTax - years[0].afterTax)} across the period. Equity surpasses the remaining loan balance in year ${years.findIndex((r) => r.equity > r.balance) + 1}, the point at which the investor holds majority ownership of the asset.`,
        grossYield: `Gross yield moves from ${years[0].grossYield.toFixed(2)}% in year one to ${last.grossYield.toFixed(2)}% in year ten. The compression occurs because value appreciates faster than rental income — a hallmark of capital-growth-oriented property.`,
        netYield: `Net yield shifts from ${years[0].netYield.toFixed(2)}% to ${last.netYield.toFixed(2)}%, accounting for council rates, insurance, maintenance and management fees.`,
        expenseDrag: `The average spread between gross and net yield is ${(years.reduce((a, r) => a + (r.grossYield - r.netYield), 0) / years.length).toFixed(2)} percentage points — the proportion of rental income consumed by holding costs.`,
      },
      equitySeries: years.map((r) => ({ label: `Yr ${r.y}`, value: Math.round(r.equity) })),
      valueSeries: years.map((r) => ({ label: `Yr ${r.y}`, value: Math.round(r.value) })),
      grossYieldSeries: years.map((r) => ({ label: `Yr ${r.y}`, value: Number(r.grossYield.toFixed(2)) })),
      netYieldSeries: years.map((r) => ({ label: `Yr ${r.y}`, value: Number(r.netYield.toFixed(2)) })),
      afterTaxSeries: years.map((r) => ({ label: `Yr ${r.y}`, value: Math.round(r.afterTax) })),
    };
  })(),
};

/**
 * A short, human line naming what the reader is looking at. Rendered next to
 * every preview so sample content is never mistaken for a real client file.
 */
export const SAMPLE_DATA_NOTICE =
  'Filled with sample data for preview. Your reports use live client and market data.';
