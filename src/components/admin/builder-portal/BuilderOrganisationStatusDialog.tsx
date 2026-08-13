import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ORG_STATUSES, type BuilderOrganisation } from './accessTypes';

/**
 * Change an organisation's status.
 *
 * Previously the page offered a single Suspend/Activate toggle, which made
 * `closed` and `pending_activation` unreachable even though the guarded command
 * accepts them. All four are offered here, each with the consequence spelled
 * out, because moving to anything other than `active` ends every member's
 * session inside the same transaction.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organisation: BuilderOrganisation | null;
  memberCount: number;
  busy: boolean;
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
}

export function BuilderOrganisationStatusDialog({
  open, onOpenChange, organisation, memberCount, busy, onSubmit,
}: Props) {
  const [status, setStatus] = useState('active');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open && organisation) {
      setStatus(organisation.status);
      setReason('');
    }
  }, [open, organisation]);

  if (!organisation) return null;

  const unchanged = status === organisation.status;
  const endsSessions = status !== 'active';
  const isClosing = status === 'closed';
  const meta = ORG_STATUSES.find((entry) => entry.value === status);

  const submit = async () => {
    const ok = await onSubmit({
      organisation_id: organisation.id,
      expected_version: organisation.row_version,
      status,
      reason: reason.trim() || null,
    });
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change organisation status</DialogTitle>
          <DialogDescription>{organisation.legal_name}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-status">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="org-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORG_STATUSES.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {meta && <p className="text-xs text-muted-foreground">{meta.hint}</p>}
          </div>

          {endsSessions && !unchanged && (
            <Alert variant={isClosing ? 'destructive' : undefined}>
              <AlertTriangle className="h-4 w-4" aria-hidden />
              <AlertDescription>
                {memberCount === 0
                  ? 'This organisation has no current members, so no sessions will be ended.'
                  : `This immediately ends the sessions of ${memberCount} member${memberCount === 1 ? '' : 's'}.`}
                {isClosing && ' Closing is terminal: no new memberships or invitations can be created for it.'}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="org-status-reason">
              Reason {endsSessions && !unchanged ? '' : <span className="text-muted-foreground">(optional)</span>}
            </Label>
            <Textarea
              id="org-status-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Recorded in the audit trail"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={isClosing ? 'destructive' : 'default'}
            disabled={busy || unchanged}
            onClick={() => void submit()}
          >
            {unchanged ? 'No change' : `Set ${meta?.label.toLowerCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
