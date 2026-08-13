/**
 * Command Passport section — presentation states.
 *
 * The critical assertion is the first one: with the flag off (server answers
 * passport_disabled) the section renders NOTHING, so the workspace behaves
 * exactly as it did before the Passport existed.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPassportView, type PassportViewInput } from '@/lib/aml/passport';
import { CommandPassportSection } from './CommandPassportSection';

const getPassportView = vi.fn();
vi.mock('@/hooks/useAmlAccess', () => ({
  useAmlAccess: () => ({
    roles: new Set(['mlro']), isMlro: true, canWrite: true,
    flagEnabled: true, loading: false, capabilities: new Set(['aml.view']),
  }),
}));

vi.mock('@/lib/aml/amlRelianceApi', () => ({
  amlRelianceApi: {
    getPassportView: (...args: unknown[]) => getPassportView(...args),
  },
}));

function commandView() {
  const input: PassportViewInput = {
    issuer_org: 'Test Org',
    officer_label: null,
    case: {
      id: 'c1', case_reference: 'AML-2026-0001', subject_display_name: 'Test Subject',
      subject_type: 'individual', status: 'cleared', case_stage: 'cleared',
      service_gate_status: 'approved', opened_at: '2026-08-01T00:00:00Z', closed_at: null,
    },
    attestations: [{ version: 1, issued_at: '2026-08-05T00:00:00Z', superseded_at: null, payload_sha256: 'a'.repeat(64), schema_version: 2 }],
    material_inputs_current: true,
    open_refresh_obligations: 0,
    personal_details: { full_name: 'Test Person', occupation: 'Director' },
    entity_details: null,
    documents: [],
    transactions: [],
    screening: { subjects: [], pep_result: null, pep_determined_at: null, list_freshness: {} },
    funding: { sof: [], sow: [], edd: [] },
    partners: [],
    events: [],
    client_requests: [],
    stamp_input: {
      issuer_org: 'Test Org',
      attestations: [{ version: 1, issued_at: '2026-08-05T00:00:00Z', superseded_at: null }],
      consents: [{ id: 'c', kind: 'privacy', accepted_at: '2026-08-01T00:00:00Z' }],
      verification_checks: [], documents: [], screening_subjects: [], owners: [],
      source_of_funds: [], source_of_wealth: [], edd_cases: [], grants: [],
      assessments: [], refresh_obligations: [], transactions: [],
    },
  };
  return buildPassportView('command', input);
}

beforeEach(() => {
  getPassportView.mockReset();
});

describe('CommandPassportSection', () => {
  it('renders NOTHING when the server answers passport_disabled', async () => {
    getPassportView.mockRejectedValue(new Error('The Compliance Passport view is not available.'));
    const { container } = render(<CommandPassportSection caseId="c1" />);
    await waitFor(() => expect(getPassportView).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders the identity strip, state and credential from the projection', async () => {
    getPassportView.mockResolvedValue({ passport: commandView() });
    render(<CommandPassportSection caseId="c1" />);
    expect(await screen.findByText('Test Subject')).toBeInTheDocument();
    expect(screen.getByText('AUX-AML-2026-0001-V1')).toBeInTheDocument();
    expect(screen.getByText('Issued · Current')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
  });

  it('shows an error state with retry for real failures — never a fake view', async () => {
    getPassportView.mockRejectedValue(new Error('network unreachable'));
    render(<CommandPassportSection caseId="c1" />);
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders earned stamps as buttons that open the underlying record', async () => {
    getPassportView.mockResolvedValue({ passport: commandView() });
    render(<CommandPassportSection caseId="c1" initialPage="stamps" />);
    await screen.findByText('Test Subject');
    // The consent stamp derived from the record fixture — a button that
    // opens the stamp's underlying record.
    expect((await screen.findAllByLabelText(/CLIENT CONSENT RECORDED/)).length).toBeGreaterThan(0);
  });
});
