/**
 * One badge for the whole lifecycle — label and treatment from the shared
 * state machine, so a status added there is styled here or fails to compile.
 */
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AGREEMENT_STATUS_LABELS, type AgreementStatus } from '@/lib/agreements';

const VARIANTS: Record<AgreementStatus, string> = {
  draft: 'bg-muted text-muted-foreground border-border',
  pending_review: 'bg-warning/15 text-warning border-warning/30',
  approved_for_issue: 'bg-primary/15 text-primary border-primary/30',
  partner_review: 'bg-primary/15 text-primary border-primary/30',
  changes_requested: 'bg-warning/15 text-warning border-warning/30',
  sent_for_signature: 'bg-primary/15 text-primary border-primary/30',
  partially_signed: 'bg-primary/15 text-primary border-primary/30',
  active: 'bg-success/15 text-success border-success/30',
  withdrawn: 'bg-muted text-muted-foreground border-border',
  terminated: 'bg-destructive/15 text-destructive border-destructive/30',
  superseded: 'bg-muted text-muted-foreground border-border',
  void: 'bg-destructive/15 text-destructive border-destructive/30',
};

export default function AgreementStatusBadge({
  status,
  className,
}: {
  status: AgreementStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(VARIANTS[status] ?? VARIANTS.draft, className)}>
      {AGREEMENT_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
