/**
 * Structured partner change requests — the request loop that replaces free
 * editing of a legal document. Staff resolve by revising and reissuing (the
 * issue action auto-resolves open requests) or answer here directly.
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2, XCircle } from 'lucide-react';
import { CHANGE_REQUEST_SECTIONS } from '@/lib/agreements';
import type { AgreementChangeRequest } from '@/hooks/useAgreementCentre';

const STATUS_BADGES: Record<AgreementChangeRequest['status'], string> = {
  open: 'bg-warning/15 text-warning border-warning/30',
  resolved: 'bg-success/15 text-success border-success/30',
  declined: 'bg-muted text-muted-foreground border-border',
};

function sectionLabel(key: string): string {
  return CHANGE_REQUEST_SECTIONS.find((section) => section.key === key)?.label ?? 'Other';
}

interface Props {
  requests: AgreementChangeRequest[];
  onResolve?: (requestId: string, resolution: 'resolved' | 'declined', note: string) => void;
  resolving?: boolean;
}

export default function ChangeRequestsPanel({ requests, onResolve, resolving }: Props) {
  const [answering, setAnswering] = useState<string | null>(null);
  const [note, setNote] = useState('');

  if (!requests.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No change requests.</p>;
  }

  return (
    <div className="space-y-3">
      {requests.map((request) => (
        <div key={request.id} className="rounded-lg border border-border bg-card/50 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={STATUS_BADGES[request.status]}>
              {request.status === 'open' ? 'Open' : request.status === 'resolved' ? 'Resolved' : 'Declined'}
            </Badge>
            <span className="text-xs font-medium text-foreground">{sectionLabel(request.section_key)}</span>
            <span className="text-xs text-muted-foreground">
              {format(new Date(request.created_at), 'd MMM yyyy · h:mm a')}
              {request.requested_by_label ? ` — ${request.requested_by_label}` : ''}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{request.comment}</p>
          {request.resolution_note ? (
            <p className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
              Response: {request.resolution_note}
            </p>
          ) : null}
          {request.status === 'open' && onResolve ? (
            answering === request.id ? (
              <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                <Textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Response to the partner (optional)…"
                  rows={2}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={resolving}
                    onClick={() => { onResolve(request.id, 'resolved', note); setAnswering(null); setNote(''); }}
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Mark resolved
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={resolving}
                    onClick={() => { onResolve(request.id, 'declined', note); setAnswering(null); setNote(''); }}
                  >
                    <XCircle className="mr-1.5 h-3.5 w-3.5" /> Decline
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAnswering(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="mt-3" onClick={() => { setAnswering(request.id); setNote(''); }}>
                Respond
              </Button>
            )
          ) : null}
        </div>
      ))}
    </div>
  );
}
