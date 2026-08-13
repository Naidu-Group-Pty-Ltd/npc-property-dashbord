/**
 * The seam between the two portals.
 *
 * The plumbing was fixed first — the partner is notified when an agreement is
 * issued, the Command Centre is notified when the partner views it or asks for
 * a change. What remained were the joins: places where a message went out
 * correctly and then had nowhere useful to land, or where a person was left
 * waiting on an answer nobody told them had arrived.
 *
 * Three, all confirmed against the production timeline of a live agreement:
 *
 *  1. `resolve_change_request` logged an event and returned. The partner had
 *     asked a question about a clause and could not sensibly accept the
 *     agreement until it was answered — and was told nothing. A resolved
 *     request was noticed only because a new version happened to follow it 90
 *     seconds later; a DECLINED one would have reached them never.
 *  2. The route guard threads `state.from` through terms and onboarding but
 *     dropped it at sign-in, and sign-in is the gate every link from OUTSIDE
 *     the portal hits first. So the agreement emails deep-linking to
 *     `/finance/agreements/<id>` landed everyone on the dashboard.
 *  3. Nothing on the partner's first screen mentioned agreements at all.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_STATUSES,
  PARTNER_VISIBLE_STATUSES,
  partnerAgreementAction,
  type AgreementStatus,
} from '@/lib/agreements';

describe('what the partner is being asked to do', () => {
  it('asks for a review while the agreement is with them', () => {
    const view = partnerAgreementAction('partner_review');
    expect(view.action).toBe('review');
    expect(view.awaitingPartner).toBe(true);
  });

  it('asks for a signature once they have accepted', () => {
    const view = partnerAgreementAction('sent_for_signature');
    expect(view.action).toBe('sign');
    expect(view.awaitingPartner).toBe(true);
  });

  it('does NOT chase a partner who is waiting on us', () => {
    // They asked us a question. An ACTION REQUIRED banner in front of somebody
    // waiting on our answer is worse than saying nothing.
    for (const status of ['changes_requested', 'partially_signed'] as AgreementStatus[]) {
      const view = partnerAgreementAction(status);
      expect(view.awaitingPartner).toBe(false);
      expect(view.action).toBe('waiting_on_issuer');
    }
  });

  it('asks nothing once the agreement is executed or dead', () => {
    for (const status of ['active', 'withdrawn', 'terminated', 'superseded', 'void'] as AgreementStatus[]) {
      expect(partnerAgreementAction(status).awaitingPartner).toBe(false);
    }
  });

  it('answers for every status, so a new one cannot fall through silently', () => {
    for (const status of AGREEMENT_STATUSES) {
      const view = partnerAgreementAction(status);
      expect(view.label.length).toBeGreaterThan(0);
      expect(view.detail.length).toBeGreaterThan(0);
    }
  });

  it('only ever waits on the partner for a status they can actually see', () => {
    // An agreement that is not partner-visible cannot be acted on by them, so
    // marking it as awaiting them would produce a card linking to a 404.
    for (const status of AGREEMENT_STATUSES) {
      if (partnerAgreementAction(status).awaitingPartner) {
        expect(PARTNER_VISIBLE_STATUSES).toContain(status);
      }
    }
  });
});

describe('the answer to a change request reaches the partner', () => {
  const route = readFileSync(
    join(process.cwd(), 'supabase/functions/manage-partner-agreements/index.ts'), 'utf8',
  );
  const block = route.split("action === 'resolve_change_request'")[1]?.split('─── SET OWNER')[0] ?? '';

  it('notifies on resolution', () => {
    expect(block).not.toBe('');
    expect(block).toContain('notifyPartner(');
  });

  it('distinguishes a refusal from an acceptance in the title', () => {
    // "Your request has been answered" reads as agreement, and half of these
    // are refusals — which is the case the partner most needs to read.
    expect(block).toContain('change_request_declined');
    expect(block).toMatch(/was not accepted/);
  });

  it('links to the agreement rather than the dashboard', () => {
    expect(block).toMatch(/\/finance\/agreements\/\$\{id\}/);
  });
});

describe('a deep link survives the way in', () => {
  const guard = readFileSync(
    join(process.cwd(), 'src/components/finance-portal/FinancePortalProtectedRoute.tsx'), 'utf8',
  );
  const login = readFileSync(
    join(process.cwd(), 'src/pages/finance-portal/FinancePortalLogin.tsx'), 'utf8',
  );
  const changePassword = readFileSync(
    join(process.cwd(), 'src/pages/finance-portal/FinancePortalChangePassword.tsx'), 'utf8',
  );

  it('the guard sends the destination to the login page', () => {
    const redirect = /to="\/finance\/login"[\s\S]{0,200}?\/>/.exec(guard)?.[0] ?? '';
    expect(redirect).toContain('from');
  });

  it('every gate in the chain carries it onward', () => {
    for (const source of [login, changePassword]) {
      expect(source).toContain('location.state');
    }
    // The guard's own two gates already did, and must keep doing.
    expect(guard).toContain('state={{ from }}');
  });

  it('refuses a destination outside the portal', () => {
    // `from` is attacker-supplied in principle, and an open redirect out of an
    // authentication page is not worth the convenience. Both pages test the
    // same shape before navigating.
    for (const source of [login, changePassword]) {
      expect(source).toMatch(/\/\^\\\/finance\(\\\/\|\$\|\\\?\)\//);
    }
  });
});

describe('the waiting agreement is on the first screen', () => {
  const card = readFileSync(
    join(process.cwd(), 'src/components/finance-portal/AgreementActionCard.tsx'), 'utf8',
  );
  const dashboard = readFileSync(
    join(process.cwd(), 'src/pages/finance-portal/FinancePortalDashboard.tsx'), 'utf8',
  );

  it('is mounted on the dashboard', () => {
    expect(dashboard).toContain('<AgreementActionCard />');
  });

  it('decides with the shared lifecycle model, not its own status list', () => {
    expect(card).toContain('partnerAgreementAction');
    expect(card).toContain('awaitingPartner');
  });

  it('renders nothing when there is nothing to do', () => {
    // What stops it becoming furniture people stop seeing.
    expect(card).toContain('waiting.length === 0) return null');
  });
});
