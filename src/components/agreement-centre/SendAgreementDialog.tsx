/**
 * Send an issued agreement to the partner — and to anyone else who needs it.
 *
 * Once an agreement was issued, the Command Centre offered nothing: no resend,
 * no covering note, no way to copy the broker's practice manager or a
 * compliance mailbox. The only send that ever happened was the one implied by
 * the word "issue", and that one wrote an in-app notification and no email at
 * all — so a partner who had not logged in received nothing and there was no
 * second chance to fix it.
 *
 * The dialog is deliberately shaped around one distinction: the partner contact
 * is a **party** to the agreement and is not the operator's to remove, while
 * everyone else is a **copy** and is entirely theirs. So the primary address is
 * shown and fixed; the rest is a free-text field that accepts whatever people
 * paste out of Outlook.
 */
import { useMemo, useState } from 'react';
import { Loader2, Mail, Paperclip, Send } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  MAX_ADDITIONAL_RECIPIENTS,
  recipientBlocker,
  resolveRecipients,
} from '@/lib/agreements';

export interface SendAgreementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partnerName: string | null;
  partnerEmail: string | null;
  versionLabel: string | null;
  /** True when the partner cannot sign in yet — changes what the email says. */
  awaitingActivation?: boolean;
  sending?: boolean;
  onSend: (payload: { additionalRecipients: string; note: string; notifyPortal: boolean }) => void;
}

export default function SendAgreementDialog({
  open, onOpenChange, partnerName, partnerEmail, versionLabel,
  awaitingActivation, sending, onSend,
}: SendAgreementDialogProps) {
  const [additional, setAdditional] = useState('');
  const [note, setNote] = useState('');
  const [notifyPortal, setNotifyPortal] = useState(true);

  // The same resolver the server runs, so what the dialog promises and what the
  // send does cannot disagree — including the de-duplication, which is the part
  // a person would otherwise discover by sending somebody two copies.
  const resolved = useMemo(
    () => resolveRecipients(partnerEmail, additional),
    [partnerEmail, additional],
  );
  const blocker = recipientBlocker(resolved);

  const close = (next: boolean) => {
    if (!next) { setAdditional(''); setNote(''); setNotifyPortal(true); }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4 text-primary" />
            Send agreement{versionLabel ? ` — v${versionLabel}` : ''}
          </DialogTitle>
          <DialogDescription>
            Emails the agreement as a PDF with a link into the Finance Portal.
            {awaitingActivation
              ? ' This partner cannot sign in yet, so the email says the agreement is waiting for them.'
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Partner (always included)
            </Label>
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
              <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">
                  {resolved.primary ?? 'No email on the partner record'}
                </div>
                {partnerName ? (
                  <div className="truncate text-xs text-muted-foreground">{partnerName}</div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agc-send-additional">Also send to</Label>
            <Input
              id="agc-send-additional"
              placeholder="admin@brokerage.com.au, compliance@aggregator.com.au"
              value={additional}
              onChange={(event) => setAdditional(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Separate with commas, semicolons or new lines — up to {MAX_ADDITIONAL_RECIPIENTS}.
              Copies do not change who the agreement is addressed to.
            </p>
            {resolved.additional.length > 0 ? (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {resolved.additional.map((address) => (
                  <span key={address} className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                    {address}
                  </span>
                ))}
              </div>
            ) : null}
            {resolved.duplicates.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Already included, so not sent twice: {resolved.duplicates.join(', ')}
              </p>
            ) : null}
            {resolved.overflow.length > 0 ? (
              <p className="text-xs text-warning">
                Over the limit and not sent: {resolved.overflow.join(', ')}
              </p>
            ) : null}
            {blocker ? <p className="text-xs text-destructive">{blocker}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="agc-send-note">Covering note (optional)</Label>
            <Textarea
              id="agc-send-note"
              rows={3}
              maxLength={2000}
              placeholder="Anything the partner should read before opening the agreement."
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Appears in the email only. It is not part of the agreement and is not recorded
              on the timeline.
            </p>
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
            <Checkbox
              checked={notifyPortal}
              onCheckedChange={(checked) => setNotifyPortal(checked === true)}
              className="mt-0.5"
            />
            <span className="text-sm text-foreground">
              Also raise a portal notification
              <span className="block text-xs text-muted-foreground">
                Shows in the partner's notification bell next time they sign in.
              </span>
            </span>
          </label>

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Paperclip className="mt-0.5 h-3 w-3 shrink-0" />
            The issued PDF is attached — the same document the Issued PDF download gives you.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={sending}>Cancel</Button>
          <Button
            disabled={sending || blocker !== null}
            onClick={() => onSend({ additionalRecipients: additional, note, notifyPortal })}
          >
            {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            Send to {resolved.all.length} recipient{resolved.all.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
