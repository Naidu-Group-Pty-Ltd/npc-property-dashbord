/**
 * Passport view — audience security contracts (Phase 1 acceptance battery).
 *
 * The client projection is a dedicated server-side build, and these tests are
 * the contract that keeps it that way. They feed the assembler adversarial
 * inputs — the exact material that must never reach a client — and assert
 * both the allow-list behaviour and the fail-closed tripwire.
 *
 * Do not weaken these assertions to make a UI ship. Fix the projection.
 */
import { describe, expect, it } from 'vitest';
import {
  assertClientSafe,
  buildPassportView,
  findClientRestrictedKeys,
  type PassportView,
  type PassportViewInput,
} from './index';

const NOW = '2026-08-13T10:00:00Z';

/** A fully-populated case: every family present, including restricted data. */
function richInput(): PassportViewInput {
  return {
    issuer_org: 'Naidu Property Consulting Services',
    officer_label: 'P. Naidu · MLRO',
    case: {
      id: 'case-1',
      case_reference: 'AML-2026-1184',
      subject_display_name: 'Meridian Coast Holdings Pty Ltd',
      subject_type: 'entity',
      status: 'cleared',
      case_stage: 'cleared',
      service_gate_status: 'approved',
      opened_at: '2026-08-01T00:00:00Z',
      closed_at: null,
    },
    attestations: [
      { version: 1, issued_at: '2026-08-05T00:00:00Z', superseded_at: '2026-08-12T00:00:00Z', payload_sha256: 'a'.repeat(64), schema_version: 2 },
      { version: 2, issued_at: '2026-08-12T00:00:00Z', superseded_at: null, payload_sha256: 'b'.repeat(64), schema_version: 2 },
    ],
    material_inputs_current: true,
    open_refresh_obligations: 0,
    personal_details: {
      full_name: 'Daniel Raphael Okafor',
      dob: '1979-03-04',
      citizenship: 'Australian',
      tax_residency: 'Australia',
      address: '22 Kestrel Avenue, Broadbeach Waters QLD 4218',
      occupation: 'Company director',
      // Screening-adjacent self-declarations: MUST NOT surface anywhere.
      pep: 'yes',
      adverse: 'no',
      // Adversarial extras a future section might accidentally carry:
      internal_note: 'do not disclose',
      risk_score: 87,
    },
    entity_details: {
      entity_name: 'Meridian Coast Holdings Pty Ltd',
      abn_acn: '671 402 118',
      registration_place: 'Australia',
      registered_address: 'Level 8, 145 Eagle Street, Brisbane QLD 4000',
      trustee_type: 'corporate',
    },
    documents: [
      { id: 'd1', requirement_label: 'Primary photo ID', requirement_code: 'primary_id', required: true, status: 'accepted', created_at: NOW, version_number: 1 },
    ],
    transactions: [
      { id: 't1', kind: 'purchase', status: 'under_contract', property_address: 'Lot 14, 27 Sanctuary Parade', contract_date: '2026-07-28', settlement_date: '2026-10-15', purchase_price: 2480000 },
    ],
    screening: {
      subjects: [{ state: 'completed', completed_at: NOW, party_label: 'D. Okafor' }],
      pep_result: 'not_pep',
      pep_determined_at: NOW,
      list_freshness: { dfat: NOW },
    },
    funding: {
      sof: [{ verified: true, verified_at: NOW }],
      sow: [{ verified: false, verified_at: null }],
      edd: [{ status: 'completed', completed_at: NOW }],
    },
    partners: [{
      org_name: 'GT Financial Services', org_type: 'finance', portal_type: 'finance',
      link_state: 'active', legal_route: 'reliance',
      grant_created_at: NOW, grant_expires_at: '2026-11-13T00:00:00Z', grant_revoked_at: null,
      attestation_version: 2, last_viewed_at: NOW,
      assessment_status: 'satisfied', assessment_decided_at: NOW, assessor_name: 'G. Turnbull',
    }],
    events: [
      { id: 'e1', category: 'pep_sanctions_hit', summary: 'Possible PEP match referred to MLRO — internal', actor_label: 'System', created_at: NOW },
      { id: 'e2', category: 'mlro_decision', summary: 'MLRO cleared with rationale: acceptable risk', actor_label: 'P. Naidu', created_at: NOW },
    ],
    client_requests: [
      { id: 'r1', kind: 'new_document', subject: 'Updated rates notice', status: 'open', created_at: NOW },
    ],
    stamp_input: {
      issuer_org: 'Naidu Property Consulting Services',
      attestations: [
        { version: 1, issued_at: '2026-08-05T00:00:00Z', superseded_at: '2026-08-12T00:00:00Z' },
        { version: 2, issued_at: '2026-08-12T00:00:00Z', superseded_at: null },
      ],
      consents: [{ id: 'c1', kind: 'privacy', accepted_at: '2026-08-01T09:13:00Z' }],
      verification_checks: [
        { id: 'v1', party_label: 'D. Okafor', check_type: 'electronic_idv', status: 'passed', completed_at: '2026-08-02T00:00:00Z' },
      ],
      documents: [{ status: 'accepted', reviewed_at: NOW }],
      screening_subjects: [{ state: 'completed', completed_at: NOW }],
      owners: [{ verification_state: 'verified', verified_at: NOW }],
      source_of_funds: [{ verified: true, verified_at: NOW }],
      source_of_wealth: [],
      edd_cases: [{ status: 'completed', completed_at: NOW }],
      grants: [{ id: 'g1', created_at: NOW, revoked_at: null, partner_org_name: 'GT Financial Services', partner_org_type: 'finance', attestation_version: 2 }],
      assessments: [{ id: 'a1', status: 'satisfied', decided_at: NOW, assessor_name: 'G. Turnbull', partner_org_name: 'GT Financial Services', partner_org_type: 'finance' }],
      refresh_obligations: [],
      transactions: [{ id: 't1', status: 'under_contract', settlement_date: null }],
    },
  };
}

describe('command projection', () => {
  it('carries the authorised sections and the derived state', () => {
    const view = buildPassportView('command', richInput());
    expect(view.audience).toBe('command');
    expect(view.header.credential).toBe('AUX-AML-2026-1184-V2');
    expect(view.header.state.code).toBe('issued_current');
    expect(view.screening?.performed).toBe(true);
    expect(view.funding?.edd_completed).toBe(true);
    expect(view.partners).toHaveLength(1);
    expect(view.versions).toHaveLength(2);
    expect(view.history.length).toBeGreaterThan(0);
  });

  it('version register: v1 initial issue, v2 current, fingerprints shortened', () => {
    const view = buildPassportView('command', richInput());
    expect(view.versions[0].state).toBe('initial_issue');
    expect(view.versions[1].state).toBe('current');
    expect(view.versions[1].fingerprint_short).toMatch(/^[0-9A-F·]+$/);
  });
});

describe('client projection — strict boundary', () => {
  const view = buildPassportView('client', richInput());
  const json = JSON.stringify(view);

  it('structurally lacks the restricted sections — they are absent, not emptied', () => {
    expect('screening' in view).toBe(false);
    expect('funding' in view).toBe(false);
    expect('partners' in view).toBe(false);
  });

  it('cannot receive screening, PEP or sanctions material', () => {
    expect(json).not.toMatch(/pep_result|not_pep|possible_match|confirmed_match|adverse_media|watchlist|sanction/i);
    expect(json).not.toContain('Possible PEP match');
    // "Screening" may appear ONLY as closed-vocabulary machine identifiers and
    // the stamp title — the FACT that screening completed is client-safe
    // transparency (the attestation states it to partners too); its CONTENT
    // never is. Everything scrubbed here is an identifier or that one title;
    // no candidate, match, list or determination text may survive.
    const scrubbed = json
      .replaceAll('SCREENING COMPLETED', '')
      .replaceAll('screening_completed', '')
      .replaceAll('"code":"screening"', '')
      .replaceAll('aml.party_screening_subjects', '');
    expect(scrubbed).not.toMatch(/screening/i);
  });

  it('cannot receive internal risk data or reasoning', () => {
    expect(json).not.toMatch(/risk_score|risk_rating|rationale|acceptable risk/i);
    expect(json).not.toContain('internal_note');
    expect(json).not.toContain('do not disclose');
  });

  it('cannot receive MLRO notes or raw case-event summaries', () => {
    expect(json).not.toContain('MLRO cleared');
    // Client history is CONSTRUCTED: stamps + own requests only.
    for (const h of view.history) {
      expect(h.title).not.toMatch(/mlro|pep|sanction|risk/i);
    }
  });

  it('cannot receive partner internal assessment detail beyond its stamps', () => {
    // The reliance-accepted stamp is a deliberate, client-safe transparency
    // signal. Assessment notes and statuses never appear.
    expect(json).not.toContain('assessment_status');
    expect(json).not.toContain('not_satisfied');
  });

  it('identity fields are the allow-list, and only the allow-list', () => {
    const keys = view.identity.fields.map((f) => f.key);
    expect(keys).toContain('full_name');
    expect(keys).toContain('occupation');
    expect(keys).toContain('entity_name');
    expect(keys).not.toContain('pep');
    expect(keys).not.toContain('adverse');
    expect(keys).not.toContain('internal_note');
    expect(keys).not.toContain('risk_score');
  });

  it('EDD never surfaces to the client, even as a stamp', () => {
    expect(view.stamps.map((s) => s.code)).not.toContain('edd_completed');
    expect(json).not.toMatch(/enhanced due diligence/i);
  });

  it('state reasons (internal machine codes) are stripped', () => {
    expect(view.header.state.reasons).toEqual([]);
  });

  it('keeps the client-safe substance: credential, state, versions, stamps, requests', () => {
    expect(view.header.credential).toBe('AUX-AML-2026-1184-V2');
    expect(view.header.state.code).toBe('issued_current');
    expect(view.versions).toHaveLength(2);
    expect(view.stamps.length).toBeGreaterThan(3);
    expect(view.open_requests).toHaveLength(1);
    expect(view.transactions).toHaveLength(1);
  });

  it('the client journey states facts in the client\'s words, never operational vocabulary', () => {
    const titles = view.journey.phases.flatMap((p) => p.milestones.map((m) => `${m.title} ${m.detail} ${m.feeds}`));
    for (const text of titles) {
      expect(text).not.toMatch(/sanction|\bPEP\b|risk assessment|MLRO|service gate|EDD/i);
    }
    // …while still telling them the milestone happened.
    expect(titles.join(' ')).toMatch(/Background checks completed/);
  });

  it('the tripwire passes on the shipped view', () => {
    expect(() => assertClientSafe(view)).not.toThrow();
  });
});

describe('fail-closed tripwire', () => {
  it('finds restricted keys wherever they hide', () => {
    expect(findClientRestrictedKeys({ a: { risk_score: 1 } })).toEqual(['a.risk_score']);
    expect(findClientRestrictedKeys([{ mlro_note: 'x' }])).toEqual(['[0].mlro_note']);
    expect(findClientRestrictedKeys({ pep_result: 'x' })).toEqual(['pep_result']);
    expect(findClientRestrictedKeys({ storage_path: 'x' })).toEqual(['storage_path']);
    expect(findClientRestrictedKeys({ biometric_storage_path: 'x' }).length).toBeGreaterThan(0);
    expect(findClientRestrictedKeys({ ok: { fine: 'yes' } })).toEqual([]);
  });

  it('throws when a restricted key is smuggled into a client view', () => {
    const view = buildPassportView('client', richInput()) as PassportView & {
      leaked?: unknown;
    };
    view.leaked = { screening_matches: ['x'] };
    expect(() => assertClientSafe(view)).toThrow(/restricted keys/);
  });

  it('derivation is deterministic — same input, same view', () => {
    const a = JSON.stringify(buildPassportView('client', richInput()));
    const b = JSON.stringify(buildPassportView('client', richInput()));
    expect(a).toBe(b);
  });
});
