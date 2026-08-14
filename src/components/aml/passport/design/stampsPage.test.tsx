/**
 * Stamps & Certifications — the page shows the whole set.
 *
 * The defect these pin: the page drew earned stamps and stopped, so a case
 * one certification into a fourteen-certification programme and a case whose
 * programme *is* one certification rendered identically. Production has five
 * cases; the best-covered earns two stamps and one earns none.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildPassportView, type PassportViewInput } from '@/lib/aml/passport';
import { StampsPage } from './pagesRecord';

const NOW = '2026-08-13T10:00:00Z';

function input(over: Partial<PassportViewInput> = {}): PassportViewInput {
  return {
    issuer_org: 'Naidu Property Consulting Services',
    officer_label: 'P. Naidu · MLRO',
    case: {
      id: 'c1', case_reference: 'AML-2026-1184', subject_display_name: 'Meridian Coast Holdings',
      subject_type: 'entity', status: 'kyc_in_progress', case_stage: 'verification',
      service_gate_status: 'pending', opened_at: '2026-08-01T00:00:00Z', closed_at: null,
    },
    attestations: [],
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
      attestations: [],
      consents: [{ id: 'c1', kind: 'privacy_notice', accepted_at: NOW }],
      verification_checks: [], documents: [], screening_subjects: [], owners: [],
      source_of_funds: [], source_of_wealth: [], edd_cases: [], grants: [],
      assessments: [], refresh_obligations: [], transactions: [],
    },
    ...over,
  };
}

const pageFor = (over: Partial<PassportViewInput> = {}) =>
  render(<StampsPage view={buildPassportView('command', input(over))} />);

describe('StampsPage', () => {
  it('shows the outstanding certifications, not only the earned one', () => {
    // One consent accepted and nothing else — which is close to the shape of
    // every live case in production today.
    const { container } = pageFor();

    expect(screen.getByText('CLIENT CONSENT RECORDED')).toBeInTheDocument();
    // The rest of the programme is drawn as empty impressions. Each title
    // appears twice — on the impression, and in the panel that says what it
    // is waiting for.
    expect(screen.getAllByText('IDENTITY VERIFIED')).toHaveLength(2);
    expect(screen.getAllByText('PASSPORT ISSUED')).toHaveLength(2);
    expect(container.querySelectorAll('.passport-stamp--pending').length).toBeGreaterThan(3);
  });

  it('counts the set rather than just the earned half', () => {
    pageFor();
    expect(screen.getByText(/\b1 of \d+ earned/)).toBeInTheDocument();
  });

  it('an outstanding impression is not a button and says it is unearned', () => {
    // Nothing to open — there is no record behind it. And the distinction is
    // in words, not only in the dashed border, so it survives a screen reader.
    const { container } = pageFor();
    const pending = container.querySelector('.passport-stamp--pending')!;
    expect(pending.tagName).not.toBe('BUTTON');
    expect(pending.closest('button')).toBeNull();
    expect(pending.getAttribute('aria-label')).toMatch(/not yet earned/i);
  });

  it('captions each earned stamp with the portal its record came from', () => {
    const { container } = pageFor();
    const earned = container.querySelector('.passport-stamp:not(.passport-stamp--pending)')!;
    expect(within(earned.closest('.passport-stamp-button')!).getByText('Client Portal'))
      .toBeInTheDocument();
  });

  it('every struck impression carries the Aurixa watermark', () => {
    // The layer the approved design is built around, and the one the previous
    // face omitted entirely: an impression carries the mark of the system that
    // struck it. An unstruck die does not — nothing pressed it.
    const { container } = pageFor();
    const struck = container.querySelector('.passport-stamp:not(.passport-stamp--pending)')!;
    expect(struck.querySelector('.passport-stamp__watermark'))
      .toHaveAttribute('src', '/brand/aurixa-emblem.png');
    expect(struck.querySelector('.passport-stamp__grain')).not.toBeNull();
    expect(struck.querySelector('.passport-stamp__inner')).not.toBeNull();

    const unstruck = container.querySelector('.passport-stamp--pending')!;
    expect(unstruck.querySelector('.passport-stamp__watermark')).toBeNull();
  });

  it('inks a stamp by what it speaks for, in the design’s three tones', () => {
    const { container } = pageFor();
    // The issuer's own certification.
    expect(container.querySelector('.passport-stamp--gold')).not.toBeNull();
    // …and the terminal one, which the design inks green.
    expect(container.querySelector('.passport-stamp--final')).toBeNull(); // not yet issued
  });

  it('says what each outstanding certification is waiting for', () => {
    pageFor({
      transactions: [{
        id: 't1', kind: 'purchase', status: 'under_contract', property_address: 'Lot 14',
        contract_date: NOW, settlement_date: '2026-10-15T00:00:00Z', purchase_price: 2480000,
      }],
      stamp_input: {
        ...input().stamp_input,
        transactions: [{ id: 't1', status: 'under_contract', settlement_date: '2026-10-15T00:00:00Z' }],
      },
    });
    // The design closes the page with its own panel for the settlement stamp,
    // so it is drawn there rather than in the outstanding list — and it is
    // drawn once, not in both.
    expect(screen.getByText('Final completion stamp — awaiting settlement')).toBeInTheDocument();
    expect(screen.getByText(/Applied on confirmed settlement, expected 15 Oct 2026/))
      .toBeInTheDocument();
    expect(screen.getAllByText(/TRANSACTION\s*COMPLETED/)).toHaveLength(1);
  });

  it('a closed case shows a finished register, not an action list', () => {
    const closed = pageFor({
      case: { ...input().case, status: 'closed', closed_at: NOW },
    });
    expect(closed.container.querySelector('.passport-stamp--pending')).toBeNull();
    expect(screen.queryByText(/still outstanding/)).not.toBeInTheDocument();
  });
});
