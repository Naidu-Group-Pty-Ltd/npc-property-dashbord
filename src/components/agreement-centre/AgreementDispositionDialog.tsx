/**
 * The confirm step for voiding, archiving, restoring and deleting.
 *
 * One component for all four because the thing that actually differs between
 * them is not the layout — it is **what survives**, and that is the only
 * question the person clicking has. Each mode therefore states its
 * consequences as a short list of facts rather than a paragraph of warning
 * prose, in the order someone worries about them: what happens to the
 * agreement, what the partner sees, and what is kept.
 *
 * Two deliberate frictions:
 *  - Voiding demands a reason, because the server does. Asking after the fact
 *    would mean a failed request explaining a rule the form never mentioned.
 *  - Deleting demands the partner's name typed out. A row that can be
 *    destroyed is one nobody has seen yet, which is exactly the row a person
 *    is most likely to destroy by reflex.
 */
import { useEffect, useState } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Archive, ArchiveRestore, Ban, Loader2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type DispositionMode = 'void' | 'archive' | 'restore' | 'delete';

/** The minimum the server accepts for a void reason — enforced here too. */
const MIN_VOID_REASON = 6;

interface ModeCopy {
  title: string;
  lead: string;
  /** What survives, and what does not. */
  consequences: string[];
  confirmLabel: string;
  destructive: boolean;
  icon: typeof Ban;
}

const COPY: Record<DispositionMode, ModeCopy> = {
  void: {
    title: 'Void this agreement',
    lead: 'Voiding declares the agreement of no effect. It is permanent — a void agreement cannot be reopened, only replaced by a new one.',
    consequences: [
      'The agreement stays on the register, marked Void.',
      'Any version sitting with the partner stops being available to execute.',
      'A partner who was sent it is notified and sees the status change — not your reason.',
      'The full document, version and audit history is kept.',
    ],
    confirmLabel: 'Void agreement',
    destructive: true,
    icon: Ban,
  },
  archive: {
    title: 'Archive this agreement',
    lead: 'Archiving is a filing decision. It takes the agreement out of your working list and changes nothing else about it.',
    consequences: [
      'Nothing about the agreement itself changes — including its status.',
      'An active agreement keeps governing commission exactly as before.',
      'The partner\'s copy in their portal is untouched.',
      'You can restore it to the working list at any time.',
    ],
    confirmLabel: 'Archive',
    destructive: false,
    icon: Archive,
  },
  restore: {
    title: 'Restore this agreement',
    lead: 'This brings the agreement back into the working list at the stage it left.',
    consequences: [
      'It reappears in the list and its counters.',
      'Its status and history are exactly as they were.',
    ],
    confirmLabel: 'Restore',
    destructive: false,
    icon: ArchiveRestore,
  },
  delete: {
    title: 'Delete this agreement permanently',
    lead: 'This destroys the record. It is available only because this agreement has never been issued, signed or executed — nothing outside this system has ever seen it.',
    consequences: [
      'The agreement and its working history are erased and cannot be recovered.',
      'The deletion itself is recorded in the compliance audit chain.',
      'If you only want it out of the way, archive it instead — it stays on the register.',
    ],
    confirmLabel: 'Delete permanently',
    destructive: true,
    icon: Trash2,
  },
};

export default function AgreementDispositionDialog({
  mode,
  agreementLabel,
  pending,
  onOpenChange,
  onConfirm,
}: {
  /** `null` closes the dialog. */
  mode: DispositionMode | null;
  /** The partner name — shown for orientation, and typed to confirm a delete. */
  agreementLabel: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: { reason?: string }) => void;
}) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');

  // A dialog that reopens holding the previous attempt's text is a dialog that
  // can be confirmed without reading it.
  useEffect(() => {
    if (mode) { setReason(''); setTyped(''); }
  }, [mode]);

  if (!mode) return null;
  const copy = COPY[mode];
  const Icon = copy.icon;

  const reasonOk = mode !== 'void' || reason.trim().length >= MIN_VOID_REASON;
  const typedOk = mode !== 'delete' || typed.trim().toLowerCase() === agreementLabel.trim().toLowerCase();
  const canConfirm = reasonOk && typedOk && !pending;

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Icon className={cn('h-5 w-5', copy.destructive ? 'text-destructive' : 'text-primary')} />
            {copy.title}
          </AlertDialogTitle>
          <AlertDialogDescription>{copy.lead}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {agreementLabel}
            </div>
            <ul className="mt-2 space-y-1.5">
              {copy.consequences.map((line) => (
                <li key={line} className="flex gap-2 text-xs text-muted-foreground">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {mode === 'void' ? (
            <div className="space-y-1.5">
              <Label htmlFor="agc-void-reason">Reason for voiding <span className="text-destructive">*</span></Label>
              <Textarea
                id="agc-void-reason"
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why is this agreement being voided?"
              />
              <p className="text-xs text-muted-foreground">
                Recorded permanently in the audit history. The partner is told the agreement is void,
                but never sees this note.
              </p>
            </div>
          ) : null}

          {mode === 'archive' ? (
            <div className="space-y-1.5">
              <Label htmlFor="agc-archive-note">Note (optional)</Label>
              <Input
                id="agc-archive-note"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="For whoever finds it in the archive later…"
              />
            </div>
          ) : null}

          {mode === 'delete' ? (
            <div className="space-y-1.5">
              <Label htmlFor="agc-delete-confirm">
                Type <span className="font-semibold text-foreground">{agreementLabel}</span> to confirm
              </Label>
              <Input
                id="agc-delete-confirm"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                placeholder={agreementLabel}
              />
            </div>
          ) : null}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm}
            className={cn(copy.destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}
            onClick={(event) => {
              // The dialog stays open until the mutation says otherwise, so a
              // server-side refusal is read next to the thing it refused.
              event.preventDefault();
              if (!canConfirm) return;
              onConfirm({ reason: reason.trim() || undefined });
            }}
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {copy.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
