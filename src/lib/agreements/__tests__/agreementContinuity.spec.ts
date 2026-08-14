/**
 * An agreement is never nowhere.
 *
 * ## The report
 *
 * "An agreement is issued to the Finance Partner Portal and then disappears
 * from the originating portal." Measured against production first, because a
 * disappearance has several very different causes and only one of them is a
 * display fault:
 *
 *  - the row is present, `archived_at` null, `voided_at` null, `partner_review`;
 *  - `list` returns it — 4 rows for the register, both issued agreements in it;
 *  - the full timeline is intact: created → pending_review → approved →
 *    **issued** → **partner_viewed by the partner** → emailed;
 *  - every Command Centre API call in the reproduction window returned 200.
 *
 * So nothing is deleted, hidden by the API, or lost between the portals. What
 * actually happens is that the register partitions itself BY STATUS, and
 * issuing changes the status. You stand on "Ready to Issue" — the only stage
 * whose primary action is "Send to Finance Partner" — you issue, the row moves
 * to `partner_review`, and the filter does not move with it. The stage empties
 * and says "Nothing in this stage" above a **Create Agreement** button.
 *
 * To somebody who has just issued an agreement, that sentence and that button
 * are indistinguishable from the agreement having been destroyed. With the
 * cross-portal sync cursor polling every 20s it can now empty with nobody
 * touching anything.
 *
 * ## What is asserted here
 *
 * The invariant, not the wording: every status an agreement can hold has
 * exactly one stage to be found under, a stage that empties can always be
 * escaped, and an issued agreement stays visible to BOTH sides at every
 * subsequent state. The last one is the property the report is really about.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_STATUSES,
  AGREEMENT_DASHBOARD_GROUPS,
  AGREEMENT_TRANSITIONS,
  PARTNER_VISIBLE_STATUSES,
  POST_ISSUE_STATUSES,
  agreementStagesCoverEveryStatus,
  dashboardGroupForStatus,
  isIssued,
  isPartnerVisible,
  stageToFollow,
  type AgreementStatus,
} from '@/lib/agreements';

function repoFile(...parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), 'utf8');
}

describe('every status has exactly one stage', () => {
  it('leaves no status unstaged and none in two stages', () => {
    // A status with no stage is invisible under every filter but "All"; a
    // status in two is double-counted by the counters above the table.
    const verdict = agreementStagesCoverEveryStatus();
    expect(verdict.unstaged).toEqual([]);
    expect(verdict.duplicated).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  it('resolves a stage for each status individually', () => {
    for (const status of AGREEMENT_STATUSES) {
      expect(dashboardGroupForStatus(status), `no stage for ${status}`).not.toBeNull();
    }
  });

  it('files the post-issue statuses under stages a person would look in', () => {
    expect(dashboardGroupForStatus('partner_review')).toBe('partner_review');
    expect(dashboardGroupForStatus('changes_requested')).toBe('action_required');
    expect(dashboardGroupForStatus('sent_for_signature')).toBe('awaiting_signature');
    expect(dashboardGroupForStatus('partially_signed')).toBe('partially_executed');
    expect(dashboardGroupForStatus('active')).toBe('fully_executed');
  });
});

describe('following an agreement that changes stage', () => {
  it('follows the exact move the report is about', () => {
    // Issue: approved_for_issue → partner_review, standing on "Ready to Issue".
    expect(stageToFollow('ready_to_issue', 'partner_review')).toBe('partner_review');
  });

  it('follows every legal transition out of every stage', () => {
    for (const [from, targets] of Object.entries(AGREEMENT_TRANSITIONS)) {
      const fromGroup = dashboardGroupForStatus(from as AgreementStatus);
      if (!fromGroup) continue;
      for (const to of targets) {
        const toGroup = dashboardGroupForStatus(to);
        const followed = stageToFollow(fromGroup, to);
        // Either it stayed in the same stage, or we can name where it went.
        // Never null-while-moving: that is precisely the silent disappearance.
        if (toGroup === fromGroup) expect(followed).toBeNull();
        else expect(followed).toBe(toGroup);
      }
    }
  });

  it('does not chase anything out of the unfiltered views', () => {
    // "All" already shows it, and the executed vault is a destination somebody
    // chose rather than a stage agreements pass through — yanking the view out
    // from under them there would be its own bug.
    expect(stageToFollow('all', 'partner_review')).toBeNull();
    expect(stageToFollow('executed_vault', 'partner_review')).toBeNull();
  });
});

describe('issuance is a fact about the row, not a status', () => {
  it('is read off issued_at', () => {
    expect(isIssued({ issued_at: '2026-08-13T13:30:52Z' })).toBe(true);
    expect(isIssued({ issued_at: null })).toBe(false);
    expect(isIssued(null)).toBe(false);
    expect(isIssued(undefined)).toBe(false);
  });

  it('stays true after the agreement moves on or is killed', () => {
    // The whole reason this is not a status test: a withdrawn or voided
    // agreement WAS issued, the partner saw it, and the register has to keep
    // saying so. `void` is not in POST_ISSUE_STATUSES and must still read as
    // issued when it carries a date.
    expect(isIssued({ issued_at: '2026-08-12T14:31:52Z' })).toBe(true);
    expect(POST_ISSUE_STATUSES).not.toContain('void');
    expect(POST_ISSUE_STATUSES).not.toContain('withdrawn');
  });

  it('never claims a draft was issued', () => {
    for (const status of ['draft', 'pending_review', 'approved_for_issue'] as AgreementStatus[]) {
      expect(POST_ISSUE_STATUSES).not.toContain(status);
    }
  });
});

describe('an issued agreement stays visible to both sides', () => {
  const ISSUED_AT = '2026-08-13T13:30:52Z';

  it('is visible to the PARTNER at every state reachable after issue', () => {
    for (const status of POST_ISSUE_STATUSES) {
      expect(isPartnerVisible(status, ISSUED_AT), `partner lost it at ${status}`).toBe(true);
    }
  });

  it('is visible to the partner after it is withdrawn, voided or superseded', () => {
    // Watching a document silently vanish is worse than being told it is dead.
    for (const status of ['withdrawn', 'terminated', 'superseded', 'void'] as AgreementStatus[]) {
      expect(isPartnerVisible(status, ISSUED_AT), `partner lost it at ${status}`).toBe(true);
    }
  });

  it('is findable in the ISSUER register at every state reachable after issue', () => {
    for (const status of AGREEMENT_STATUSES) {
      expect(dashboardGroupForStatus(status), `issuer has no stage for ${status}`).not.toBeNull();
    }
  });

  it('never shows the partner something that was never sent', () => {
    // The other half of the invariant. Visibility must not become "show
    // everything" in the course of making sure nothing is lost.
    for (const status of PARTNER_VISIBLE_STATUSES) {
      expect(isPartnerVisible(status, null)).toBe(false);
    }
    expect(isPartnerVisible('draft', ISSUED_AT)).toBe(false);
    expect(isPartnerVisible('approved_for_issue', ISSUED_AT)).toBe(false);
  });
});

describe('the register cannot claim to be empty while it holds agreements', () => {
  const PAGE = repoFile('src', 'pages', 'AgreementCentre.tsx');

  it('separates "a filter hides everything" from "there is nothing"', () => {
    // The regression: one empty state served both, so a filtered-out register
    // offered "Create Agreement" to somebody whose agreement had just moved.
    expect(PAGE).toContain('filtered.length === 0 && agreements.length > 0');
    expect(PAGE).toContain('Nothing at this stage right now');
    expect(PAGE).toContain('Nothing has been lost');
  });

  it('offers a way out of the filter rather than a way to make more rows', () => {
    const block = PAGE.split('filtered.length === 0 && agreements.length > 0')[1]
      ?.split('filtered.length === 0 ?')[0] ?? '';
    expect(block).toContain("setGroup('all')");
    expect(block).not.toContain('/partner-agreements/new');
  });

  it('asks the lifecycle module which stage a row is in', () => {
    // Rather than searching the presentation array by hand, which is what
    // allowed a status to belong to no stage without anything noticing.
    expect(PAGE).toContain('dashboardGroupForStatus(agreement.status as AgreementStatus) === group');
  });

  it('says when an agreement left the stage being watched', () => {
    expect(PAGE).toContain('stageToFollow(group, row.status as AgreementStatus)');
    expect(PAGE).toContain('moved on to');
  });

  it('shows that an agreement has been issued', () => {
    // No lifecycle status renders as "Issued" — `partner_review` is as close
    // as the product got, and it does not mean the same thing.
    expect(Object.values(AGREEMENT_DASHBOARD_GROUPS).some((g) => /issued/i.test(g.label))).toBe(false);
    expect(PAGE).toContain('isIssued(agreement)');
    expect(PAGE).toContain('Issued {format(new Date(agreement.issued_at as string)');
  });
});

describe('the register can show which portal account it went to', () => {
  const FN = repoFile('supabase', 'functions', 'manage-partner-agreements', 'index.ts');
  const PAGE = repoFile('src', 'pages', 'AgreementCentre.tsx');

  it('resolves the linked finance contact on the list', () => {
    // `partner_legal_name` is typed; `finance_agent_contact_id` is what the
    // portal query and the notification resolve against. They differ on half
    // the production register, and the register could not show it.
    expect(FN).toContain("from('finance_agent_contacts')");
    expect(FN).toContain('partner_account_name');
  });

  it('shows it only when it disagrees with the typed name', () => {
    expect(PAGE).toContain('agreement.partner_account_name !== agreement.partner_legal_name');
  });
});
