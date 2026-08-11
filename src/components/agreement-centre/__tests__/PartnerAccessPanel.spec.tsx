/**
 * The panel that replaced the dead end.
 *
 * What it used to say, in full: *"This partner has no active Finance Portal
 * login — digital issue will be unavailable until they are invited, but the
 * download options always work."* Three claims, two of them now wrong and the
 * third unhelpful — there was no way to invite anybody from that screen.
 *
 * These assertions are about what a person can see and click, because the
 * failure being fixed was not a logic error. The rules were right; the screen
 * gave the user nowhere to go with them.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import PartnerAccessPanel, { PartnerAccessBadge } from '../PartnerAccessPanel';
import { PARTNER_ACCESS_LABELS } from '@/lib/agreements';

afterEach(cleanup);

describe('the badge', () => {
  it('names each state in the shared vocabulary', () => {
    for (const access of ['none', 'invited', 'active', 'revoked'] as const) {
      cleanup();
      render(<PartnerAccessBadge access={access} />);
      expect(screen.getByText(PARTNER_ACCESS_LABELS[access])).toBeTruthy();
    }
  });

  it('no longer claims a partner is connected when they cannot sign in', () => {
    render(<PartnerAccessBadge access="invited" />);
    expect(screen.queryByText(/portal connected/i)).toBeNull();
    expect(screen.getByText('Invited')).toBeTruthy();
  });
});

describe('a partner with no login at all', () => {
  it('offers the invitation instead of describing its absence', () => {
    const onInvite = vi.fn();
    render(<PartnerAccessPanel access="none" onInvite={onInvite} />);
    const button = screen.getByRole('button', { name: /invite to portal/i });
    button.click();
    expect(onInvite).toHaveBeenCalledTimes(1);
  });

  it('says the agreement can still be issued', () => {
    render(<PartnerAccessPanel access="none" />);
    expect(screen.getByText(/can still issue the agreement/i)).toBeTruthy();
    expect(screen.queryByText(/unavailable/i)).toBeNull();
  });
});

describe('a partner who has been invited but not activated', () => {
  it('offers a resend rather than a duplicate invitation', () => {
    render(<PartnerAccessPanel access="invited" onInvite={() => {}} />);
    expect(screen.getByRole('button', { name: /resend invitation/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^invite to portal$/i })).toBeNull();
  });
});

describe('a partner whose access was revoked', () => {
  it('offers reinstatement, and never an invitation', () => {
    const onInvite = vi.fn();
    const onReinstate = vi.fn();
    render(<PartnerAccessPanel access="revoked" onInvite={onInvite} onReinstate={onReinstate} />);
    // Inviting somebody whose access was deliberately taken away would work
    // around the decision rather than surface it.
    expect(screen.queryByRole('button', { name: /invite/i })).toBeNull();
    screen.getByRole('button', { name: /reinstate access/i }).click();
    expect(onReinstate).toHaveBeenCalledTimes(1);
    expect(onInvite).not.toHaveBeenCalled();
  });
});

describe('read-only use', () => {
  it('renders no actions when none are supplied', () => {
    render(<PartnerAccessPanel access="none" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('disables the action while one is in flight', () => {
    render(<PartnerAccessPanel access="none" onInvite={() => {}} busy />);
    expect(screen.getByRole('button', { name: /invite to portal/i }).hasAttribute('disabled')).toBe(true);
  });
});
