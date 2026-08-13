/**
 * The Client Details projection.
 *
 * The fixture is a `ClientDetails` payload — the shape
 * `_shared/reports/clientDetails/normalise.pure.ts` produces — rather than raw
 * table rows, because that is what this projection is given. Its counts and
 * magnitudes are the record's: expenses in the dozens, assets and liabilities
 * that can exceed what a page can draw, and at most four properties.
 *
 * What this file mostly asserts is **the bounding**. These templates cannot
 * paginate: a table that runs long does not spill onto the next page, it prints
 * over whatever follows. So every collection is capped, every cap is measured,
 * and every cap that bites is published beside a count so the page can say so.
 */
import { describe, it, expect } from 'vitest';
import {
  projectClientDetails,
  applyClientDetailsProjection,
  CAPS,
} from '../../../../supabase/functions/_shared/clientDetailsProjection.pure';
import { getAdapter, supportsProduction, normaliseReportType } from '../adapters';

const aud = (value: number) => ({ value, unit: 'aud' as const });
const perMonth = (value: number) => ({ value, unit: 'aud/month' as const });
const perYear = (value: number) => ({ value, unit: 'aud/year' as const });
const pct = (value: number) => ({ value, unit: 'percent' as const });

function expense(category: string, name: string, monthly: number, isEssential = true) {
  return { category, name, monthly: perMonth(monthly), isEssential };
}

function property(kindLabel: string, address: string, value: number, loan: number) {
  return {
    kind: 'investment' as const, kindLabel, address, shortAddress: address.split(',')[0],
    value: aud(value), loanRemaining: aud(loan), equity: aud(value - loan),
    lvr: pct((loan / value) * 100), interestRate: pct(6.02), ownershipPercentage: pct(100),
    lender: 'CommBank', repaymentType: 'Principal and interest',
    rentMonthly: perMonth(2450), rentWeekly: { value: 565, unit: 'aud/week' as const },
    expensesMonthly: perMonth(1180), netMonthly: perMonth(1270), smsf: null,
  };
}

/** A record with something in every collection. */
function fullDetails(overrides: Record<string, unknown> = {}) {
  return {
    meta: {
      clientId: 'c-1', clientName: 'Jordan & Sarah Nguyen',
      preparedOn: '2026-08-02T00:00:00.000Z', propertyCount: 2, hasSecondaryContact: true,
    },
    narrative: 'Two-person household with two holdings.',
    household: {
      contacts: [
        { role: 'primary' as const, name: 'Jordan Nguyen', email: 'j@example.test', mobile: '0400 000 000', gender: 'Male', dateOfBirth: '1986-04-12' },
        { role: 'secondary' as const, name: 'Sarah Nguyen', email: 's@example.test', mobile: '0400 000 001', gender: 'Female', dateOfBirth: '1988-09-30' },
      ],
      residences: [{
        contact: 'primary' as const,
        residence: {
          address: '9/44 Regent Street', suburb: 'Newtown', state: 'NSW', postcode: '2042',
          country: 'Australia', livingSituation: 'Owner occupied', residentialStatus: 'Australian citizen',
        },
        sharedWithPrimary: false,
      }],
      maritalStatus: 'Married',
      dependents: { value: 2, unit: 'rate' as const },
      history: [],
    },
    ownerOccupied: null,
    employment: [
      { contact: 'primary' as const, employer: 'Meridian', employmentType: 'Full time', role: 'Manager', startDate: '2021-03-01', isCurrent: true, workplace: 'Sydney', workArrangement: 'Hybrid', grossAnnual: perYear(198000), extrasAnnual: perYear(24000) },
    ],
    income: {
      primaryEmploymentMonthly: perMonth(16500), secondaryEmploymentMonthly: perMonth(0),
      totalEmploymentMonthly: perMonth(16500), otherIncome: [],
      totalOtherMonthly: perMonth(0), rentalMonthly: perMonth(2450),
      totalMonthly: perMonth(18950), totalGrossAnnual: perYear(227400),
    },
    assets: [{ type: 'Savings', description: 'Offset', value: aud(84000) }],
    liabilities: [{
      type: 'Credit card', provider: 'CommBank', balance: aud(4200), creditLimit: aud(15000),
      interestRate: pct(20.99), captured: perMonth(300), monthlyServicing: perMonth(300),
      isEstimated: false, basis: 'As recorded',
    }],
    liabilitiesIncludeEstimates: false,
    expenses: [expense('Groceries', 'Supermarket', 1650)],
    properties: [property('Investment', '7 Wardell Road, Dulwich Hill', 640000, 288000)],
    position: {
      propertyValue: aud(640000), propertyDebt: aud(288000), propertyEquity: aud(352000),
      otherAssets: aud(84000), otherLiabilities: aud(4200), netWorth: aud(431800),
      incomeMonthly: perMonth(18950), commitmentsMonthly: perMonth(6420),
      surplusMonthly: perMonth(12530), commitmentRatio: pct(33.88),
    },
    ...overrides,
  } as never;
}

/** A record with contact details and nothing else — 742 of the 775 clients. */
function emptyDetails() {
  return fullDetails({
    employment: [], assets: [], liabilities: [], expenses: [], properties: [],
    ownerOccupied: null,
    meta: {
      clientId: 'c-2', clientName: 'Alex Tran', preparedOn: '2026-08-02T00:00:00.000Z',
      propertyCount: 0, hasSecondaryContact: false,
    },
  });
}

describe('the client details adapter is real, not a stub', () => {
  it('reports production support', () => {
    expect(supportsProduction('client_details')).toBe(true);
    expect(getAdapter('client_details')?.label).toBe('Client Details');
  });

  it('routes the legacy generator’s own name to the same adapter', () => {
    // `formara` is what FormaraPDFGenerator calls this document. A template
    // stored under it is activatable rather than stranded.
    expect(normaliseReportType('formara')).toBe('client_details');
    expect(supportsProduction('formara')).toBe(true);
  });

  it('keeps the legacy generator, and says what it costs', () => {
    expect(getAdapter('client_details')?.legacyFallback?.reason).toContain('selectable');
  });
});

describe('the record with nothing in it', () => {
  const p = projectClientDetails(emptyDetails());

  it('says so as a fact, because 742 of the 775 clients answer this way', () => {
    expect(p.clientDetails.hasFinancials).toBe(false);
  });

  it('still publishes who the document is about', () => {
    expect(p.client.name).toBe('Alex Tran');
    expect((p.clientDetails.contacts as any[])[0].name).toBe('Jordan Nguyen');
    expect((p.clientDetails.residence as any).suburb).toBe('Newtown');
  });

  it('omits every financial collection rather than publishing empty ones', () => {
    // A template makes those pages conditional, which it cannot do against an
    // empty array — `evalConditional` sees a bound name holding `[]`, which is
    // truthy.
    for (const key of ['assets', 'liabilities', 'expenseGroups', 'properties', 'employment']) {
      expect(key in p.clientDetails, key).toBe(false);
    }
  });
});

describe('hasFinancials', () => {
  it('is true when any one collection holds anything', () => {
    for (const only of ['employment', 'assets', 'liabilities', 'expenses', 'properties'] as const) {
      const bare = {
        employment: [], assets: [], liabilities: [], expenses: [], properties: [],
        ownerOccupied: null,
      } as Record<string, unknown>;
      bare[only] = (fullDetails() as any)[only];
      expect(projectClientDetails(fullDetails(bare)).clientDetails.hasFinancials, only).toBe(true);
    }
  });

  it('is true for a client whose only property is the home they live in', () => {
    const p = projectClientDetails(fullDetails({
      employment: [], assets: [], liabilities: [], expenses: [], properties: [],
      ownerOccupied: property('Owner occupied', '9/44 Regent Street, Newtown', 1125000, 612000),
    }));
    expect(p.clientDetails.hasFinancials).toBe(true);
    expect(p.clientDetails.ownerOccupied).toBeTruthy();
    // And the home is not in the portfolio: it counts in net worth and not in
    // what they invest.
    expect('properties' in p.clientDetails).toBe(false);
  });

  it('is not derived from net worth', () => {
    // A client holding a property worth exactly what is owed on it has a net
    // worth of zero and a great deal recorded; one with only debts has a
    // negative net worth and the same.
    const p = projectClientDetails(fullDetails({
      position: {
        ...(fullDetails() as any).position, netWorth: aud(0),
      },
    }));
    expect(p.clientDetails.hasFinancials).toBe(true);
  });
});

describe('the bounding', () => {
  it('groups expenses rather than listing them', () => {
    // One client records 100 rows and the average among the thirteen who record
    // any is 39. No cap short enough to fit a page leaves a useful document.
    const rows = [
      expense('Groceries', 'Supermarket', 1000),
      expense('Groceries', 'Butcher', 200),
      expense('Groceries', 'Market', 100),
      expense('Transport', 'Fuel', 400),
      expense('Housing', 'Rates', 210),
    ];
    const p = projectClientDetails(fullDetails({ expenses: rows }));
    const groups = p.clientDetails.expenseGroups as any[];

    expect(groups).toHaveLength(3);
    // Largest first, so the page leads on what the money goes on.
    expect(groups[0]).toEqual({ category: 'Groceries', monthly: 1300, lines: 3, essential: 3 });
    expect(groups[1].category).toBe('Transport');
    expect(p.clientDetails.expenseCategoryCount).toBe(3);
    expect(p.clientDetails.expenseLineCount).toBe(5);
    expect(p.clientDetails.expenseMonthly).toBe(1910);
  });

  it('counts essential lines within a category rather than flattening the flag', () => {
    const p = projectClientDetails(fullDetails({
      expenses: [
        expense('Recreation', 'Dining', 400, false),
        expense('Recreation', 'Streaming', 60, false),
        expense('Recreation', 'Sport for the children', 180, true),
      ],
    }));
    expect((p.clientDetails.expenseGroups as any[])[0]).toEqual({
      category: 'Recreation', monthly: 640, lines: 3, essential: 1,
    });
  });

  it('caps assets and liabilities, and publishes the count beside the cap', () => {
    const assets = Array.from({ length: 18 }, (_, i) => ({
      type: 'Savings', description: `Account ${i + 1}`, value: aud(1000 * (i + 1)),
    }));
    const liabilities = Array.from({ length: 16 }, (_, i) => ({
      type: 'Credit card', provider: `Lender ${i + 1}`, balance: aud(1000),
      creditLimit: null, interestRate: null, captured: perMonth(50),
      monthlyServicing: perMonth(50), isEstimated: false, basis: 'As recorded',
    }));
    const p = projectClientDetails(fullDetails({ assets, liabilities }));

    expect(p.clientDetails.assets).toHaveLength(CAPS.assets);
    expect(p.clientDetails.assetsShown).toBe(CAPS.assets);
    // The count is what makes the cap honest: PORTFOLIO.md's F4 is not that the
    // generator truncates, it is that it truncates with nothing saying so.
    expect(p.clientDetails.assetCount).toBe(18);
    expect(p.clientDetails.liabilities).toHaveLength(CAPS.liabilities);
    expect(p.clientDetails.liabilityCount).toBe(16);
  });

  it('reports shown equal to count when the cap does not bite', () => {
    const p = projectClientDetails(fullDetails());
    expect(p.clientDetails.assetsShown).toBe(1);
    expect(p.clientDetails.assetCount).toBe(1);
  });

  it('draws every property, because no client holds more than four', () => {
    const properties = Array.from({ length: 4 }, (_, i) =>
      property('Investment', `${i + 1} Example Street, Sydney`, 500000, 200000));
    const p = projectClientDetails(fullDetails({ properties }));
    expect(p.clientDetails.properties).toHaveLength(4);
    expect(p.clientDetails.propertiesShown).toBe(4);
  });
});

describe('restating', () => {
  const p = projectClientDetails(fullDetails());

  it('unwraps every Measure, because a template binds a number', () => {
    // Publishing `{ value, unit, precision }` renders `[object Object]`.
    expect((p.clientDetails.position as any).netWorth).toBe(431800);
    expect((p.clientDetails.assets as any[])[0].value).toBe(84000);
    expect((p.clientDetails.income as any).totalMonthly).toBe(18950);
    expect((p.clientDetails.properties as any[])[0].lvr).toBeCloseTo(45, 5);
  });

  it('turns booleans into words, because a page prints a value', () => {
    expect(p.clientDetails.hasSecondaryContact).toBe('Yes');
    expect(p.clientDetails.liabilitiesIncludeEstimates).toBe('No');
    expect((p.clientDetails.employment as any[])[0].current).toBe('Yes');
  });

  it('carries the servicing basis in words rather than a footnote marker', () => {
    expect((p.clientDetails.liabilities as any[])[0].basis).toBe('As recorded');
    expect((p.clientDetails.liabilities as any[])[0].estimated).toBe('No');
  });

  it('names the client, which this format alone can do', () => {
    // `clients` is the source table. The Borrowing Capacity, Comparison and
    // Cash Flow formats have no client-name column at all.
    expect(p.client.name).toBe('Jordan & Sarah Nguyen');
  });

  it('never writes an undefined key, so absent means absent', () => {
    const walk = (o: any, at: string) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        expect(v, `${at}.${k}`).not.toBeUndefined();
        walk(v, `${at}.${k}`);
      }
    };
    walk(p, 'projection');
  });
});

describe('merging', () => {
  it('nests under `clientDetails` and leaves the other formats alone', () => {
    // `assets`, `liabilities`, `expenses`, `properties`, `income` and
    // `position` all mean other things to the other five formats in the one
    // shared preview object.
    const data = applyClientDetailsProjection(
      { properties: ['portfolio row'], position: 'something else' },
      fullDetails(),
    );
    expect(data.properties).toEqual(['portfolio row']);
    expect(data.position).toBe('something else');
    expect((data.clientDetails.properties as any[])[0].lender).toBe('CommBank');
  });

  it('publishes the client name and the generation date at the top level', () => {
    const data = applyClientDetailsProjection({}, fullDetails());
    expect(data.client.name).toBe('Jordan & Sarah Nguyen');
    expect(data.report.generatedDate).toBe('2026-08-02T00:00:00.000Z');
  });
});
