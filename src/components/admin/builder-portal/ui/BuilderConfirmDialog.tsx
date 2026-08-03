import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CircleAlert, CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The one confirmation surface every destructive Builder administration action
 * goes through.
 *
 * It exists so a confirmation can never be a bare "are you sure?". Each caller
 * spells out what ends, what is kept and whether the action can be refused, and
 * the dialog renders those consistently. When the server refuses a removal
 * because the record is still in use, `blockedMessage` shows what is holding it
 * without closing the dialog, so the administrator can read it and choose the
 * alternative the caller names.
 */
export type ConsequenceTone = 'ends' | 'remains' | 'warning';

export interface BuilderConsequence {
  tone: ConsequenceTone;
  text: string;
}

export interface BuilderConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  consequences?: BuilderConsequence[];
  /** When true the action cannot be submitted until a reason is typed. */
  reasonRequired?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  confirmLabel: string;
  /** Rendered as a destructive button when true. */
  destructive?: boolean;
  busy?: boolean;
  /** Server explanation of why the action was refused, e.g. a 409. */
  blockedMessage?: string | null;
  onConfirm: (reason: string) => void;
}

const TONE_ICON: Record<ConsequenceTone, typeof CircleX> = {
  ends: CircleX,
  remains: CircleCheck,
  warning: TriangleAlert,
};

const TONE_CLASS: Record<ConsequenceTone, string> = {
  ends: 'text-destructive',
  remains: 'text-success',
  warning: 'text-warning',
};

export function BuilderConfirmDialog({
  open, onOpenChange, title, description, consequences = [],
  reasonRequired = false, reasonLabel = 'Reason', reasonPlaceholder,
  confirmLabel, destructive = false, busy = false, blockedMessage, onConfirm,
}: BuilderConfirmDialogProps) {
  const [reason, setReason] = useState('');

  // The reason belongs to one decision. Reopening the dialog for a different
  // record must not inherit the last one's wording.
  useEffect(() => { if (open) setReason(''); }, [open]);

  const canConfirm = !busy && (!reasonRequired || reason.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {consequences.length > 0 && (
          <ul className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            {consequences.map((item) => {
              const Icon = TONE_ICON[item.tone];
              return (
                <li key={item.text} className="flex items-start gap-2 text-sm">
                  <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE_CLASS[item.tone])} aria-hidden />
                  <span className="leading-snug">{item.text}</span>
                </li>
              );
            })}
          </ul>
        )}

        {blockedMessage && (
          <Alert variant="destructive">
            <CircleAlert className="h-4 w-4" aria-hidden />
            <AlertDescription>{blockedMessage}</AlertDescription>
          </Alert>
        )}

        {reasonRequired && (
          <div className="space-y-2">
            <Label htmlFor="builder-confirm-reason">
              {reasonLabel} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="builder-confirm-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={reasonPlaceholder}
              rows={3}
              required
            />
            <p className="text-xs text-muted-foreground">
              Recorded against this action in the Builder audit trail.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            disabled={!canConfirm}
            onClick={() => onConfirm(reason.trim())}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
