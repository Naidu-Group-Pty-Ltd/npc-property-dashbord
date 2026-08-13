/**
 * The agreement's activity history — concise on the surface, complete in the
 * record. Works for both the Command Centre (full event stream) and the
 * partner room (the server already filtered to partner-relevant events).
 */
import { format } from 'date-fns';
import {
  CheckCircle2, Eye, FileSignature, MessageSquareWarning, RotateCcw, Send,
  ShieldCheck, Undo2, FilePlus2, Download, CircleDot,
} from 'lucide-react';

export interface TimelineEvent {
  event_type: string;
  actor_label?: string | null;
  summary: string | null;
  created_at: string;
}

const EVENT_ICONS: Record<string, typeof CircleDot> = {
  created: FilePlus2,
  issued: Send,
  reissued: Send,
  partner_viewed: Eye,
  accepted: CheckCircle2,
  partner_signed: FileSignature,
  counter_signed: FileSignature,
  fully_executed: ShieldCheck,
  withdrawn: Undo2,
  changes_requested: MessageSquareWarning,
  review_approved: CheckCircle2,
  review_returned: RotateCcw,
  partner_downloaded: Download,
};

export default function AgreementTimeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>;
  }
  return (
    <ol className="space-y-0">
      {events.map((event, index) => {
        const Icon = EVENT_ICONS[event.event_type] ?? CircleDot;
        return (
          <li key={`${event.created_at}-${index}`} className="relative flex gap-3 pb-5 last:pb-0">
            {index < events.length - 1 ? (
              <span aria-hidden className="absolute left-[11px] top-6 h-full w-px bg-border" />
            ) : null}
            <span className="relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-card">
              <Icon className="h-3 w-3 text-primary" />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-foreground">{event.summary ?? event.event_type.replace(/_/g, ' ')}</p>
              <p className="text-xs text-muted-foreground">
                {format(new Date(event.created_at), 'd MMM yyyy · h:mm a')}
                {event.actor_label ? ` — ${event.actor_label}` : ''}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
