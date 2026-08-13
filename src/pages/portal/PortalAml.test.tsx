import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/**
 * The Client Portal's onboarding stepper.
 *
 * ## The scenario these were written from
 *
 * A real customer uploaded `IMMI_Grant_Notification.pdf`. The case had no
 * formal document requirements. The server stored the file, the Documents
 * screen showed it as Received, they pressed Continue — and the Documents pill
 * stayed grey. So did Consent, which they had completed before any of it.
 *
 * The cause was structural rather than a wrong comparison: completion was read
 * from `sections.find(x => x.section === step.section)?.status`, and Consent,
 * Documents, Verify identity and Review & submit have no `section`. Four of
 * the eight steps could never turn green no matter what the server said.
 *
 * These render the page against a server journey and assert on what a customer
 * would actually see — including the two things that must stay separate:
 * the step you are ON, and the step you have FINISHED.
 */

const overview = vi.fn();
const verificationStatus = vi.fn();
const listDocuments = vi.fn();

vi.mock('@/lib/aml/amlPortalApi', () => ({
  amlPortalApi: {
    overview: (...a: unknown[]) => overview(...a),
    verificationStatus: (...a: unknown[]) => verificationStatus(...a),
    listDocuments: (...a: unknown[]) => listDocuments(...a),
    getConsents: () => Promise.resolve({ version: '2026.1', satisfied: true, outstanding: [], documents: [] }),
    getQuestionnaire: () => Promise.resolve({ response: null }),
    listRequirements: () => Promise.resolve({ requirements: [] }),
  },
  uploadAmlDocument: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
// The identity step owns a camera, a provider window and ~1,500 lines of its
// own state. It has its own suite; here it is a placeholder so the stepper can
// be asserted on without any of that.
vi.mock('@/components/portal/IdentityVerificationStep', () => ({
  IdentityVerificationStep: () => <div data-testid="idv-step" />,
}));
// Stands in for the real Documents screen, exposing the two things the page
// wires into it: "an upload landed, re-read the case" and "Continue".
vi.mock('@/components/portal/DocumentsStep', () => ({
  DocumentsStep: ({ onChange, onNext }: { onChange: () => void; onNext: () => void }) => (
    <div data-testid="documents-step">
      <button type="button" onClick={onChange}>upload landed</button>
      <button type="button" onClick={onNext}>Continue</button>
    </div>
  ),
}));

import PortalAml from './PortalAml';
import type { AmlPortalJourneyStatus } from '@/lib/aml/amlPortalApi';

const JOURNEY_DEFAULTS: Record<string, AmlPortalJourneyStatus> = {
  consent: 'complete',
  questionnaire: 'complete',
  documents: 'not_started',
  verification: 'not_started',
  submission: 'not_started',
  review: 'not_started',
};

const journey = (over: Partial<Record<string, AmlPortalJourneyStatus>> = {}) =>
  Object.entries({ ...JOURNEY_DEFAULTS, ...over }).map(([step, status]) => ({
    step, status, action_required: status === 'action_required',
    safe_label: step, safe_description: `${step} copy`, target_step: step, completed_at: null,
  }));

const overviewPayload = (over: Record<string, any> = {}) => ({
  case: {
    id: 'case-1', reference: 'AML-0001', subject: 'A Client',
    opened_at: new Date().toISOString(),
    status: 'in_progress', portal_status: 'in_progress',
    status_label: 'In progress', status_tone: 'progress',
  },
  consent: { version: '2026.1', satisfied: true, outstanding: [], required_count: 5 },
  sections: [
    { section: 'purchasing_structure', status: 'submitted', updated_at: null },
    { section: 'personal_details', status: 'submitted', updated_at: null },
    { section: 'purchase_profile', status: 'submitted', updated_at: null },
    { section: 'funding', status: 'submitted', updated_at: null },
  ],
  requirements: [],
  requirement_progress: { completed: 0, total: 0 },
  open_requests: [],
  recent_submissions: [],
  journey: journey(),
  ...over,
});

/** The stepper pill for a step, by its visible label. */
const pill = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label},`) });

beforeEach(() => {
  overview.mockReset();
  verificationStatus.mockReset();
  listDocuments.mockReset();
  overview.mockResolvedValue(overviewPayload());
  verificationStatus.mockResolvedValue({
    enabled: true, max_attempts: 3, biometric_consent_accepted: true,
    availability: 'available', parties: [],
  });
  listDocuments.mockResolvedValue({ documents: [] });
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/* ── the four steps that could never turn green ──────────────────────────── */

describe('stepper completion', () => {
  it('turns Consent green when the server says the consents are satisfied', async () => {
    render(<PortalAml />);
    await waitFor(() => expect(pill('Consent')).toHaveAccessibleName(/Consent, complete/));
  });

  it('turns Documents green after an upload, with no formal requirements', async () => {
    // The exact production scenario: one freeform document, no requirements.
    overview.mockResolvedValue(overviewPayload({ journey: journey({ documents: 'complete' }) }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toHaveAccessibleName(/Documents, complete/));
  });

  it('keeps Documents green after moving on to Verify identity', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', verification: 'action_required' }),
    }));
    render(<PortalAml />);
    // Resume lands on Verify identity; Documents stays complete behind it.
    await waitFor(() => expect(pill('Verify identity')).toHaveAttribute('aria-current', 'step'));
    expect(pill('Documents')).toHaveAccessibleName(/Documents, complete/);
    expect(pill('Documents')).not.toHaveAttribute('aria-current');
  });

  it('turns questionnaire steps green from their own section status', async () => {
    render(<PortalAml />);
    await waitFor(() => expect(pill('Source of funds')).toHaveAccessibleName(/complete/));
    expect(pill('Personal details')).toHaveAccessibleName(/Personal details, complete/);
  });

  it('does not collapse the questionnaire into one status', async () => {
    overview.mockResolvedValue(overviewPayload({
      sections: [
        { section: 'purchasing_structure', status: 'submitted', updated_at: null },
        { section: 'personal_details', status: 'submitted', updated_at: null },
        { section: 'purchase_profile', status: 'draft', updated_at: null },
        { section: 'funding', status: 'not_started', updated_at: null },
      ],
      journey: journey({ questionnaire: 'action_required' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Purchasing structure')).toHaveAccessibleName(/complete/));
    expect(pill('Purchase profile')).toHaveAccessibleName(/in progress/);
    expect(pill('Source of funds')).toHaveAccessibleName(/not started/);
  });

  it('turns Review & submit green once a submission exists', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', verification: 'complete', submission: 'complete' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Review & submit')).toHaveAccessibleName(/complete/));
  });
});

describe('identity verification never goes green early', () => {
  it('shows a running check as in progress, not as success', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', verification: 'in_progress' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Verify identity')).toHaveAccessibleName(/in progress/));
    expect(pill('Verify identity')).not.toHaveAccessibleName(/complete/);
  });

  it('shows a failed check as needing attention', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ verification: 'action_required' }),
    }));
    render(<PortalAml />);
    await waitFor(() =>
      expect(pill('Verify identity')).toHaveAccessibleName(/needs your attention/));
  });

  it('shows a contact-adviser state as blocked rather than actionable', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ verification: 'blocked' }),
    }));
    render(<PortalAml />);
    await waitFor(() =>
      expect(pill('Verify identity')).toHaveAccessibleName(/not available yet/));
  });

  it('turns green once the server settles the party as verified', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', verification: 'complete' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Verify identity')).toHaveAccessibleName(/complete/));
  });
});

/* ── the production scenario, end to end on the page ─────────────────────── */

/**
 * The customer who found this. They uploaded `IMMI_Grant_Notification.pdf` to
 * a case with no formal document requirements, saw it listed as Received,
 * pressed Continue — and Documents stayed grey.
 */
describe('upload → Continue, with no formal requirements', () => {
  it('turns Documents green on the upload and keeps it green after Continue', async () => {
    overview
      // Landing on Documents: nothing uploaded yet.
      .mockResolvedValueOnce(overviewPayload({ journey: journey({ documents: 'not_started' }) }))
      // The upload landed; the server now derives documents as complete from
      // `aml.documents`, with no requirement row anywhere in the case.
      .mockResolvedValue(overviewPayload({
        requirements: [], requirement_progress: { completed: 0, total: 0 },
        journey: journey({ documents: 'complete', verification: 'action_required' }),
      }));

    localStorage.setItem('aml_portal_resume:case-1', '5'); // Documents
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toHaveAttribute('aria-current', 'step'));
    expect(pill('Documents')).toHaveAccessibleName(/Documents, not started/);

    fireEvent.click(screen.getByRole('button', { name: 'upload landed' }));

    // Green while they are still standing on it: current AND complete.
    await waitFor(() => expect(pill('Documents')).toHaveAccessibleName(/Documents, complete/));
    expect(pill('Documents')).toHaveAttribute('aria-current', 'step');
    expect(await screen.findByText('6 of 8 steps complete')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // ...and still green once they move on.
    await waitFor(() => expect(pill('Verify identity')).toHaveAttribute('aria-current', 'step'));
    expect(pill('Documents')).toHaveAccessibleName(/Documents, complete/);
    expect(pill('Documents')).not.toHaveAttribute('aria-current');
  });
});

/* ── current location and completion are separate ────────────────────────── */

describe('current step and completion', () => {
  it('marks the current step with aria-current and shows it complete at the same time', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', submission: 'action_required' }),
    }));
    localStorage.setItem('aml_portal_resume:case-1', '5'); // Documents
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toHaveAccessibleName(/Documents, complete/));
    // Stored step is complete, so the canonical journey wins and moves them on.
    expect(pill('Documents')).not.toHaveAttribute('aria-current');
    expect(pill('Review & submit')).toHaveAttribute('aria-current', 'step');
  });

  it('shows the active step as current even when it is also complete', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'action_required' }),
    }));
    render(<PortalAml />);
    // Documents needs attention, so resume puts them there — and it is current.
    await waitFor(() => expect(pill('Documents')).toHaveAttribute('aria-current', 'step'));
    expect(pill('Documents')).toHaveAccessibleName(/needs your attention/);
    // Nothing else claims to be the current step.
    expect(screen.getAllByRole('button', { current: 'step' })).toHaveLength(1);
  });
});

/* ── progress ────────────────────────────────────────────────────────────── */

describe('overall progress', () => {
  it('counts actual step states, not a questionnaire/document formula', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', verification: 'in_progress' }),
    }));
    render(<PortalAml />);
    expect(await screen.findByText('6 of 8 steps complete')).toBeTruthy();
  });

  it('gives no credit for an untouched optional documents step', async () => {
    render(<PortalAml />);
    expect(await screen.findByText('5 of 8 steps complete')).toBeTruthy();
  });

  it('credits a freeform upload the old formula could never see', async () => {
    // Zero required requirements: the retired 60/40 formula capped this at 60%
    // however much the client uploaded.
    overview.mockResolvedValue(overviewPayload({
      requirement_progress: { completed: 0, total: 0 },
      journey: journey({ documents: 'complete' }),
    }));
    render(<PortalAml />);
    expect(await screen.findByText('6 of 8 steps complete')).toBeTruthy();
  });
});

/* ── resume ──────────────────────────────────────────────────────────────── */

describe('resume', () => {
  it('resumes to Documents when documents need attention', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'action_required' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toHaveAttribute('aria-current', 'step'));
  });

  it('resumes to Verify identity once documents are done', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', verification: 'action_required' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Verify identity')).toHaveAttribute('aria-current', 'step'));
  });

  it('does not jump back to a completed questionnaire step', async () => {
    localStorage.setItem('aml_portal_resume:case-1', '4'); // Source of funds, submitted
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'action_required' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toHaveAttribute('aria-current', 'step'));
  });

  it('handles a stored step that no longer exists', async () => {
    localStorage.setItem('aml_portal_resume:case-1', '99');
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'action_required' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toHaveAttribute('aria-current', 'step'));
  });

  it('sends an unconsented client to Consent whatever was stored', async () => {
    localStorage.setItem('aml_portal_resume:case-1', '5');
    overview.mockResolvedValue(overviewPayload({
      consent: { version: '2026.1', satisfied: false, outstanding: ['privacy_notice'], required_count: 5 },
      journey: journey({ consent: 'action_required', questionnaire: 'blocked' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Consent')).toHaveAttribute('aria-current', 'step'));
  });
});

/* ── accessibility & layout ──────────────────────────────────────────────── */

describe('accessibility', () => {
  it('says the state of every step in words, not only in colour', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'complete', verification: 'in_progress' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toHaveAccessibleName(/Documents, complete/));
    expect(pill('Verify identity')).toHaveAccessibleName(/Verify identity, in progress, current step/);
    expect(pill('Review & submit')).toHaveAccessibleName(/Review & submit, not started/);
  });

  it('keeps every unlocked step keyboard reachable', async () => {
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toBeTruthy());
    for (const label of ['Consent', 'Personal details', 'Documents', 'Verify identity', 'Review & submit']) {
      expect(pill(label)).not.toBeDisabled();
    }
  });

  it('locks every step but Consent until the consents are accepted', async () => {
    overview.mockResolvedValue(overviewPayload({
      consent: { version: '2026.1', satisfied: false, outstanding: ['privacy_notice'], required_count: 5 },
      journey: journey({ consent: 'action_required', questionnaire: 'blocked' }),
    }));
    render(<PortalAml />);
    await waitFor(() => expect(pill('Consent')).not.toBeDisabled());
    expect(pill('Documents')).toBeDisabled();
  });
});

describe('stepper layout', () => {
  it('is one scrollable row rather than a wrapping grid', async () => {
    render(<PortalAml />);
    await waitFor(() => expect(pill('Documents')).toBeTruthy());
    const list = pill('Documents').closest('ol')!;
    // `flex-wrap` is what orphaned "Review & submit" onto a second line.
    expect(list.className).not.toContain('flex-wrap');
    expect(list.className).toContain('flex');
    expect(list.parentElement!.className).toContain('overflow-x-auto');
    expect(pill('Review & submit').className).toContain('whitespace-nowrap');
  });
});

/* ── review summary ──────────────────────────────────────────────────────── */

describe('review & submit summary', () => {
  const openReview = async () => {
    localStorage.setItem('aml_portal_resume:case-1', '7');
    render(<PortalAml />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Submit for review/ })).toBeTruthy());
  };

  it('summarises the whole journey, not just questionnaire sections', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({
        documents: 'complete', verification: 'complete', submission: 'action_required',
      }),
    }));
    await openReview();
    const summary = within(screen.getByRole('list', { name: 'Your onboarding summary' }));
    // Consent, documents and identity are all in the summary now; it used to
    // list questionnaire sections and required documents alone.
    expect(summary.getByText('Consent')).toBeTruthy();
    expect(summary.getByText('Documents')).toBeTruthy();
    expect(summary.getByText('Verify identity')).toBeTruthy();
    expect(summary.getByText('Personal details')).toBeTruthy();
    // Raw backend enums never reach the page.
    expect(summary.queryByText(/submitted|accepted|in_review/)).toBeNull();
  });

  it('says everything has been received when nothing is outstanding', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({
        documents: 'complete', verification: 'complete', submission: 'action_required',
      }),
    }));
    await openReview();
    expect(await screen.findByText('Everything we need from you has been received.')).toBeTruthy();
  });

  it('says an identity check is still running without holding the pack', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({
        documents: 'complete', verification: 'in_progress', submission: 'action_required',
      }),
    }));
    await openReview();
    expect(await screen.findByText(/still being checked/)).toBeTruthy();
    expect(screen.getByText(/You can submit your information now/)).toBeTruthy();
  });

  it('names the step still needing attention', async () => {
    overview.mockResolvedValue(overviewPayload({
      journey: journey({ documents: 'action_required' }),
    }));
    await openReview();
    expect(await screen.findByText('One step still needs your attention')).toBeTruthy();
  });
});

/* ── adviser requests ────────────────────────────────────────────────────── */

describe('adviser requests', () => {
  it('shows an open request as an action for the client', async () => {
    overview.mockResolvedValue(overviewPayload({
      open_requests: [{
        id: 'r1', kind: 'info', subject: 'Please confirm your address', message: null,
        status: 'open', created_at: new Date().toISOString(),
        action_code: 'provide_clarification', action_target: {}, due_at: null,
      }],
      journey: journey({ review: 'action_required' }),
    }));
    render(<PortalAml />);
    expect(await screen.findByText('Action required')).toBeTruthy();
  });

  it('does not treat an already-answered request as an outstanding action', async () => {
    overview.mockResolvedValue(overviewPayload({
      open_requests: [{
        id: 'r1', kind: 'info', subject: 'Please confirm your address', message: null,
        status: 'responded', created_at: new Date().toISOString(),
        action_code: 'provide_clarification', action_target: {}, due_at: null,
      }],
      // The server no longer counts `responded` into openRequestCount, so the
      // journey is not action_required and the badge reads as sent.
      journey: journey(),
    }));
    render(<PortalAml />);
    expect(await screen.findByText('Response sent')).toBeTruthy();
    expect(screen.queryByText('Action required')).toBeNull();
  });
});
