/**
 * Where a finance partner stands with the portal, and the one action that
 * moves them on — wherever the question comes up.
 *
 * It comes up in three places (choosing the partner, deciding how to issue,
 * and looking at an agreement already issued) and it used to be answered
 * differently in each: a grey chip, a yellow sentence, and nothing at all. The
 * sentence said digital issue was "unavailable until they are invited" and
 * offered no way to invite them, which is the specific dead end this component
 * exists to remove — the invitation lives here now, not two sections away.
 *
 * The states and their wording come from `partnerAccess.pure.ts`, which the
 * server decides with, so a partner cannot be told one thing here and another
 * by the issue route.
 */
import { Loader2, Mail, RotateCcw, ShieldCheck, ShieldOff, ShieldQuestion, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  PARTNER_ACCESS_LABELS,
  PARTNER_ACCESS_NOTES,
  type PartnerPortalAccess,
} from '@/lib/agreements';

const TONE: Record<PartnerPortalAccess, string> = {
  none: 'border-warning/40 bg-warning/10 text-warning',
  invited: 'border-primary/40 bg-primary/10 text-primary',
  active: 'border-success/40 bg-success/10 text-success',
  revoked: 'border-destructive/40 bg-destructive/10 text-destructive',
};

const ICON: Record<PartnerPortalAccess, typeof ShieldCheck> = {
  none: ShieldQuestion,
  invited: Send,
  active: ShieldCheck,
  revoked: ShieldOff,
};

/** The small state chip, on its own — for a list row or a card corner. */
export function PartnerAccessBadge({
  access, className,
}: { access: PartnerPortalAccess; className?: string }) {
  return (
    <span className={cn(
      'inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
      TONE[access], className,
    )}>
      {PARTNER_ACCESS_LABELS[access]}
    </span>
  );
}

export interface PartnerAccessPanelProps {
  access: PartnerPortalAccess;
  partnerLabel?: string | null;
  /** Absent → the actions are hidden and the panel is read-only. */
  onInvite?: () => void;
  onReinstate?: () => void;
  busy?: boolean;
  className?: string;
}

/**
 * The state, what it means for this agreement, and the way out of it.
 *
 * `none` and `invited` are deliberately NOT presented as problems: an agreement
 * can be issued in either, and the panel says so rather than implying the user
 * has hit a wall. Only `revoked` reads as a blocker, because it is one.
 */
export function PartnerAccessPanel({
  access, partnerLabel, onInvite, onReinstate, busy, className,
}: PartnerAccessPanelProps) {
  const Icon = ICON[access];
  const canInvite = access === 'none' || access === 'invited';

  return (
    <div className={cn('rounded-xl border p-3.5', TONE[access].replace(/text-\S+/, ''), className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE[access].split(' ').pop())} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                {PARTNER_ACCESS_LABELS[access]}
              </span>
              {partnerLabel ? (
                <span className="truncate text-xs text-muted-foreground">{partnerLabel}</span>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {PARTNER_ACCESS_NOTES[access]}
            </p>
          </div>
        </div>
        {onInvite && canInvite ? (
          <Button size="sm" variant="outline" className="shrink-0" disabled={busy} onClick={onInvite}>
            {busy
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <Mail className="mr-1.5 h-3.5 w-3.5" />}
            {access === 'invited' ? 'Resend invitation' : 'Invite to portal'}
          </Button>
        ) : null}
        {onReinstate && access === 'revoked' ? (
          <Button size="sm" variant="outline" className="shrink-0" disabled={busy} onClick={onReinstate}>
            {busy
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
            Reinstate access
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export default PartnerAccessPanel;
