/**
 * Booklet composition — which leaves exist, and how they pair.
 *
 * This is the half of the booklet a component test cannot see. A render test
 * proves one fixture draws; these prove the document has the right pages for a
 * given case, which is what stops a bound artefact printing a blank leaf or
 * silently dropping a section.
 */
import { describe, expect, it } from 'vitest';
import {
  bookletLabel,
  bookletSpreads,
  buildBooklet,
  buildPassportView,
  type PassportViewInput,
} from './index';

const NOW = '2026-08-13T10:00:00Z';

function input(over: Partial<PassportViewInput> = {}): PassportViewInput {
  return {
    issuer_org: 'Naidu Property Consulting Services',
    officer_label: 'P. Naidu · MLRO',
    case: {
      id: 'c1', case_reference: 'AML-2026-1184', subject_display_name: 'Meridian Coast Holdings',
      subject_type: 'entity', status: 'cleared', case_stage: 'cleared',
      service_gate_status: 'approved', opened_at: '2026-08-01T00:00:00Z', closed_at: null,
    },
    attestations: [{ version: 1, issued_at: '2026-08-05T00:00:00Z', superseded_at: null, payload_sha256: 'a'.repeat(64), schema_version: 2 }],
    material_inputs_current: true,
    open_refresh_obligations: 0,
    personal_details: null,
    entity_details: null,
    documents: [],
    transactions: [],
    screening: null,
    funding: null,
    partners: [],
    events: [],
    client_requests: [],
    stamp_input: {
      issuer_org: 'Naidu Property Consulting Services',
      attestations: [{ version: 1, issued_at: '2026-08-05T00:00:00Z', superseded_at: null }],
      consents: [], verification_checks: [], documents: [], screening_subjects: [], owners: [],
      source_of_funds: [], source_of_wealth: [], edd_cases: [], grants: [],
      assessments: [], refresh_obligations: [], transactions: [],
    },
    ...over,
  };
}

const bookletFor = (over: Partial<PassportViewInput> = {}) =>
  buildBooklet(buildPassportView('command', input(over)));

describe('buildBooklet', () => {
  it('always opens with Client Identity and Compliance Summary', () => {
    const pages = bookletFor();
    expect(pages[0].title).toBe('Client Identity');
    expect(pages[1].title).toBe('Compliance Summary');
    // A passport that has not been issued still has a bearer and a state.
    expect(pages.length).toBeGreaterThanOrEqual(3);
  });

  it('does NOT print a leaf whose records do not exist', () => {
    // An empty "Screening" leaf in a bound document reads as "screening found
    // nothing" — a different and much worse claim than "not part of this record".
    const titles = bookletFor().map((p) => p.title);
    expect(titles).not.toContain('Screening');
    expect(titles).not.toContain('Funding & Due Diligence');
    expect(titles).not.toContain('Evidence Wallet');
    expect(titles).not.toContain('Partner Access');
    expect(titles).not.toContain('Transaction & Matter');
  });

  it('grows as the case does', () => {
    const rich = bookletFor({
      screening: { subjects: [{ state: 'completed', completed_at: NOW }], pep_result: 'not_pep', pep_determined_at: NOW, list_freshness: { dfat: NOW } },
      funding: { sof: [{ verified: true, verified_at: NOW }], sow: [], edd: [] },
      documents: [{ id: 'd1', requirement_label: 'Primary photo ID', requirement_code: 'primary_id', required: true, status: 'accepted', created_at: NOW, version_number: 1 }],
      transactions: [{ id: 't1', kind: 'purchase', status: 'under_contract', property_address: 'Lot 14', contract_date: NOW, settlement_date: null, purchase_price: 2480000 }],
    });
    const titles = rich.map((p) => p.title);
    expect(titles).toContain('Screening');
    expect(titles).toContain('Funding & Due Diligence');
    expect(titles).toContain('Evidence Wallet');
    expect(titles).toContain('Transaction & Matter');
    expect(titles).toContain('Transaction Completion');
    expect(rich.length).toBeGreaterThan(bookletFor().length);
  });

  it('numbers pages in sequence with roman numerals', () => {
    const pages = bookletFor();
    expect(pages[0].numeral).toBe('I');
    expect(pages[1].numeral).toBe('II');
    expect(pages[2].numeral).toBe('III');
    // No gaps, whatever the case holds.
    expect(new Set(pages.map((p) => p.numeral)).size).toBe(pages.length);
  });

  it('closes on Review & Renewal, which states the reliance boundary', () => {
    const pages = bookletFor();
    const last = pages[pages.length - 1];
    expect(last.title).toBe('Review & Renewal');
    const note = last.blocks.find((b) => b.kind === 'note');
    expect(note && 'text' in note ? note.text : '').toMatch(/remains responsible for its own obligations/i);
  });

  it('leaves the settlement seal unearned until settlement is confirmed', () => {
    const pending = bookletFor({
      transactions: [{ id: 't1', kind: 'purchase', status: 'under_contract', property_address: 'Lot 14', contract_date: NOW, settlement_date: null, purchase_price: 1 }],
    }).find((p) => p.id === 'completion');
    const hero = pending?.blocks.find((b) => b.kind === 'hero');
    expect(hero && 'earned' in hero ? hero.earned : true).toBe(false);

    const done = bookletFor({
      transactions: [{ id: 't1', kind: 'purchase', status: 'settled', property_address: 'Lot 14', contract_date: NOW, settlement_date: NOW, purchase_price: 1 }],
    }).find((p) => p.id === 'completion');
    const heroDone = done?.blocks.find((b) => b.kind === 'hero');
    expect(heroDone && 'earned' in heroDone ? heroDone.earned : false).toBe(true);
  });

  it('carries no restricted material onto paper', () => {
    const pages = bookletFor({
      screening: { subjects: [{ state: 'completed', completed_at: NOW }], pep_result: 'not_pep', pep_determined_at: NOW, list_freshness: {} },
    });

    // The Screening leaf carries a boundary NOTE that names the excluded
    // material in order to say it is excluded ("Candidate matches, dismissed
    // hits …"). That sentence is the control, not a leak, so it is removed
    // before the scan — and asserted separately, because dropping it would
    // silently remove the statement this page exists to make.
    const boundary = pages
      .flatMap((p) => p.blocks)
      .find((b) => b.kind === 'note' && b.title === 'Internal boundary');
    expect(boundary && 'text' in boundary ? boundary.text : '').toMatch(/Candidate matches/);

    const json = JSON.stringify(pages).replace(
      boundary && 'text' in boundary ? boundary.text : '',
      '',
    );
    expect(json).not.toMatch(/not_pep|possible_match|candidate|risk_score|rationale|storage_path/i);
  });
});

describe('bookletSpreads / bookletLabel', () => {
  it('pairs facing leaves on a wide viewport and singles on a narrow one', () => {
    expect(bookletSpreads(4, 2)).toEqual([[0, 1], [2, 3]]);
    expect(bookletSpreads(4, 1)).toEqual([[0], [1], [2], [3]]);
  });

  it('leaves the last leaf unpaired when the count is odd — never an empty page', () => {
    expect(bookletSpreads(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
  });

  it('labels a spread the way the design labels it', () => {
    expect(bookletLabel([0, 1], 14)).toBe('PAGES 1–2 OF 14');
    expect(bookletLabel([0], 12)).toBe('PAGE 1 OF 12');
    expect(bookletLabel([], 12)).toBe('');
  });

  it('handles an empty document without producing a phantom spread', () => {
    expect(bookletSpreads(0, 2)).toEqual([]);
  });
});
