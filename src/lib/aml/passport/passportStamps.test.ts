/**
 * Passport stamps — earned from records, never authored.
 *
 * Pins: the closed vocabulary; that no stamp exists without an underlying
 * record timestamp; version binding against the attestation register; partner
 * attribution; and the client-safe subset.
 */
import { describe, expect, it } from 'vitest';
import {
  STAMP_VOCABULARY,
  clientSafeStamps,
  derivePassportStamps,
  type PassportStampInput,
} from './index';

const empty: PassportStampInput = {
  issuer_org: 'Naidu Property Consulting Services',
  attestations: [],
  consents: [],
  verification_checks: [],
  documents: [],
  screening_subjects: [],
  owners: [],
  source_of_funds: [],
  source_of_wealth: [],
  edd_cases: [],
  grants: [],
  assessments: [],
  refresh_obligations: [],
  transactions: [],
};

describe('derivePassportStamps', () => {
  it('produces nothing from nothing — a stamp requires a record', () => {
    expect(derivePassportStamps(empty)).toEqual([]);
  });

  it('never emits a stamp whose source has no timestamp', () => {
    const stamps = derivePassportStamps({
      ...empty,
      consents: [{ id: 'c1', kind: 'privacy', accepted_at: null }],
      transactions: [{ id: 't1', status: 'settled', settlement_date: null }],
    });
    expect(stamps).toEqual([]);
  });

  it('derives the client journey stamps from their records', () => {
    const stamps = derivePassportStamps({
      ...empty,
      consents: [{ id: 'c1', kind: 'privacy', accepted_at: '2026-08-13T09:13:00Z', actor_label: 'client@example.com' }],
      verification_checks: [
        { id: 'v1', party_label: 'Subject', check_type: 'electronic_idv', status: 'passed', completed_at: '2026-08-13T09:27:00Z' },
      ],
      documents: [
        { status: 'accepted', reviewed_at: '2026-08-13T09:29:00Z' },
        { status: 'superseded', reviewed_at: '2026-08-10T00:00:00Z' }, // superseded rows do not block
      ],
      screening_subjects: [
        { state: 'completed', completed_at: '2026-08-13T09:31:00Z' },
        { state: 'false_positive', completed_at: '2026-08-13T09:32:00Z' },
      ],
      owners: [{ verification_state: 'verified', verified_at: '2026-08-13T09:46:00Z' }],
    });
    const codes = stamps.map((s) => s.code);
    expect(codes).toEqual([
      'client_consent_recorded',
      'identity_verified',
      'documents_verified',
      'screening_completed',
      'ownership_verified',
    ]);
    // Chronological order is the register's order.
    expect(stamps.map((s) => s.at)).toEqual([...stamps.map((s) => s.at)].sort());
    // Attribution comes from the record, not from copy.
    expect(stamps[0].portal).toBe('Client Portal');
    expect(stamps[0].source).toEqual({ kind: 'aml.consents', id: 'c1' });
  });

  it('does not award documents_verified while any live document is unaccepted', () => {
    const stamps = derivePassportStamps({
      ...empty,
      documents: [
        { status: 'accepted', reviewed_at: '2026-08-13T09:00:00Z' },
        { status: 'uploaded', created_at: '2026-08-13T09:10:00Z' },
      ],
    });
    expect(stamps.map((s) => s.code)).not.toContain('documents_verified');
  });

  it('does not award screening_completed while a subject is unresolved', () => {
    const stamps = derivePassportStamps({
      ...empty,
      screening_subjects: [
        { state: 'completed', completed_at: '2026-08-13T09:31:00Z' },
        { state: 'possible_match' },
      ],
    });
    expect(stamps.map((s) => s.code)).not.toContain('screening_completed');
  });

  it('issuance lineage: v1 issues, later versions update, supersession records', () => {
    const stamps = derivePassportStamps({
      ...empty,
      attestations: [
        { version: 1, issued_at: '2026-08-01T10:07:00Z', superseded_at: '2026-08-13T13:20:00Z' },
        { version: 2, issued_at: '2026-08-13T13:21:00Z', superseded_at: null },
      ],
    });
    const codes = stamps.map((s) => s.code);
    expect(codes).toContain('passport_issued');
    expect(codes).toContain('passport_updated');
    expect(codes).toContain('passport_superseded');
    const issued = stamps.find((s) => s.code === 'passport_issued')!;
    expect(issued.version).toBe(1);
    const updated = stamps.find((s) => s.code === 'passport_updated')!;
    expect(updated.version).toBe(2);
  });

  it('binds a stamp to the attestation version current when it was earned', () => {
    const stamps = derivePassportStamps({
      ...empty,
      attestations: [
        { version: 1, issued_at: '2026-08-01T00:00:00Z', superseded_at: '2026-08-10T00:00:00Z' },
        { version: 2, issued_at: '2026-08-10T00:00:00Z', superseded_at: null },
      ],
      consents: [{ id: 'c0', kind: 'privacy', accepted_at: '2026-07-30T00:00:00Z' }],
      transactions: [{ id: 't1', status: 'settled', settlement_date: '2026-08-15T00:00:00Z' }],
    });
    // Earned before any issue → no version claim.
    expect(stamps.find((s) => s.code === 'client_consent_recorded')!.version).toBeNull();
    // Earned under v2.
    expect(stamps.find((s) => s.code === 'transaction_completed')!.version).toBe(2);
  });

  it('partner sharing and decisions attribute the right organisation and portal', () => {
    const stamps = derivePassportStamps({
      ...empty,
      grants: [{
        id: 'g1', created_at: '2026-08-13T10:18:00Z', revoked_at: null,
        partner_org_name: 'GT Financial Services', partner_org_type: 'finance', attestation_version: 1,
      }],
      assessments: [{
        id: 'a1', status: 'satisfied', decided_at: '2026-08-13T10:36:00Z',
        assessor_name: 'G. Turnbull', partner_org_name: 'GT Financial Services', partner_org_type: 'finance',
      }],
    });
    const shared = stamps.find((s) => s.code === 'passport_shared_finance')!;
    expect(shared.portal).toBe('Finance Portal');
    expect(shared.version).toBe(1);
    const reliance = stamps.find((s) => s.code === 'reliance_accepted_finance')!;
    // The partner's stamp speaks for the PARTNER, not the issuer.
    expect(reliance.org).toBe('GT Financial Services');
    expect(reliance.actor).toBe('G. Turnbull');
  });

  it('a non-satisfied partner decision records independent CDD, never an acceptance', () => {
    const stamps = derivePassportStamps({
      ...empty,
      assessments: [{
        id: 'a2', status: 'not_satisfied', decided_at: '2026-08-13T11:00:00Z',
        assessor_name: 'E. Vance', partner_org_name: 'Harlow & Vance Legal', partner_org_type: 'solicitor_conveyancer',
      }],
    });
    expect(stamps.map((s) => s.code)).toEqual(['independent_cdd_recorded']);
  });

  it('revocation stamps from the grant record', () => {
    const stamps = derivePassportStamps({
      ...empty,
      grants: [{
        id: 'g1', created_at: '2026-08-01T00:00:00Z', revoked_at: '2026-08-14T00:00:00Z',
        partner_org_name: 'GT Financial Services', partner_org_type: 'finance', attestation_version: 1,
      }],
    });
    expect(stamps.map((s) => s.code)).toContain('access_revoked');
  });

  it('transaction_completed only from canonical settled status', () => {
    const stamps = derivePassportStamps({
      ...empty,
      transactions: [
        { id: 't1', status: 'under_contract', settlement_date: '2026-10-15T00:00:00Z' },
        { id: 't2', status: 'settled', settlement_date: '2026-10-15T00:00:00Z' },
      ],
    });
    expect(stamps.filter((s) => s.code === 'transaction_completed')).toHaveLength(1);
  });

  it('developer organisations stamp through the builder surface', () => {
    const stamps = derivePassportStamps({
      ...empty,
      grants: [{
        id: 'g2', created_at: '2026-08-13T14:18:00Z', revoked_at: null,
        partner_org_name: 'Coastline Developments', partner_org_type: 'developer', attestation_version: 1,
      }],
    });
    expect(stamps.map((s) => s.code)).toContain('passport_shared_builder');
    expect(stamps[0].portal).toBe('Builder / Developer Portal');
  });
});

describe('vocabulary and client subset', () => {
  it('the vocabulary is closed and every entry is fully specified', () => {
    for (const [code, v] of Object.entries(STAMP_VOCABULARY)) {
      expect(code).toMatch(/^[a-z_]+$/);
      expect(v.title.length).toBeGreaterThan(0);
      expect(['circle', 'rect', 'seal']).toContain(v.shape);
    }
  });

  it('EDD is the one stamp a client must not see', () => {
    const hidden = Object.entries(STAMP_VOCABULARY).filter(([, v]) => !v.client_safe);
    expect(hidden.map(([k]) => k)).toEqual(['edd_completed']);
  });

  it('clientSafeStamps drops non-client-safe stamps and keeps order', () => {
    const stamps = derivePassportStamps({
      ...empty,
      edd_cases: [{ status: 'completed', completed_at: '2026-08-13T10:00:00Z' }],
      consents: [{ id: 'c1', kind: 'privacy', accepted_at: '2026-08-13T09:13:00Z' }],
    });
    expect(stamps).toHaveLength(2);
    const safe = clientSafeStamps(stamps);
    expect(safe.map((s) => s.code)).toEqual(['client_consent_recorded']);
  });
});
