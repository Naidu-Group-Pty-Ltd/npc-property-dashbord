/**
 * The thread list beside the document — one component, both portals.
 *
 * The partner raises requests here and the issuer answers them here, and it is
 * the same rail in both places for the same reason the document itself is one
 * component: two implementations of "the conversation about this agreement"
 * would disagree within a fortnight, and the whole value of pinning is that
 * both sides are looking at the same marks on the same page.
 *
 * Selection is lifted to the caller and shared with the document, so clicking
 * pin 4 highlights thread 4 and clicking thread 4 highlights pin 4. That
 * two-way link is the feature; a list that merely sits next to a document is
 * the modal again with extra steps.
 */
import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Check, Loader2, MessageSquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { PlacedAnnotation } from '@/lib/agreements';

export interface AnnotationRailProps {
  annotations: PlacedAnnotation[];
  activeId: string | null;
  onSelect: (id: string | null) => void;
  /** Composer state, owned by the caller so the document can drive it too. */
  composing?: {
    path: string;
    label: string;
    quote: string;
  } | null;
  onCancelCompose?: () => void;
  onSubmit?: (comment: string) => void;
  submitting?: boolean;
  /** Issuer-only: answer a request in place. */
  onResolve?: (id: string, resolution: 'resolved' | 'declined', note: string) => void;
  resolvingId?: string | null;
  emptyHint?: string;
  className?: string;
}

const STATUS_TONE: Record<PlacedAnnotation['status'], string> = {
  open: 'border-warning/40 bg-warning/5',
  resolved: 'border-success/40 bg-success/5',
  declined: 'border-destructive/40 bg-destructive/5',
};

const STATUS_LABEL: Record<PlacedAnnotation['status'], string> = {
  open: 'Open',
  resolved: 'Actioned',
  declined: 'Not accepted',
};

export default function AnnotationRail({
  annotations, activeId, onSelect, composing, onCancelCompose, onSubmit,
  submitting, onResolve, resolvingId, emptyHint, className,
}: AnnotationRailProps) {
  const [draft, setDraft] = useState('');
  const [answer, setAnswer] = useState('');
  const [answerFor, setAnswerFor] = useState<string | null>(null);
  const composeRef = useRef<HTMLTextAreaElement | null>(null);
  const activeRef = useRef<HTMLDivElement | null>(null);

  // A composer that opens from a click on the page has to take the caret with
  // it, or the partner clicks a clause and then has to find the box.
  useEffect(() => {
    if (composing) { setDraft(''); composeRef.current?.focus(); }
  }, [composing]);

  // Selecting a pin in the document scrolls its thread into view. Without this
  // the link is one-directional and pin 12 selects something off-screen.
  useEffect(() => {
    if (activeId) activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  const open = annotations.filter((a) => a.status === 'open').length;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          Change requests
          {annotations.length > 0 ? (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {open > 0 ? `${open} open` : 'all answered'}
            </span>
          ) : null}
        </h3>
      </div>

      {composing ? (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-primary">{composing.label}</div>
              {composing.quote ? (
                <p className="mt-1 line-clamp-3 border-l-2 border-primary/30 pl-2 text-[11px] italic leading-relaxed text-muted-foreground">
                  {composing.quote}
                </p>
              ) : null}
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0"
              aria-label="Cancel" onClick={onCancelCompose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Textarea
            ref={composeRef}
            rows={3}
            maxLength={4000}
            className="mt-2 text-sm"
            placeholder="What needs to change here?"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancelCompose} disabled={submitting}>
              Cancel
            </Button>
            <Button size="sm" disabled={submitting || !draft.trim()}
              onClick={() => onSubmit?.(draft.trim())}>
              {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Request change
            </Button>
          </div>
        </div>
      ) : null}

      {annotations.length === 0 && !composing ? (
        <div className="rounded-xl border border-dashed border-border p-4 text-center">
          <MessageSquarePlus className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {emptyHint ?? 'No change requests on this agreement.'}
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        {annotations.map((annotation) => {
          const active = annotation.id === activeId;
          return (
            <div
              key={annotation.id}
              ref={active ? activeRef : undefined}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(active ? null : annotation.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(active ? null : annotation.id);
                }
              }}
              className={cn(
                'cursor-pointer rounded-xl border p-3 text-left transition-colors',
                STATUS_TONE[annotation.status],
                active && 'ring-2 ring-primary',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className={cn(
                  'flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5',
                  'text-[10px] font-semibold leading-none',
                  annotation.status === 'open'
                    ? 'bg-warning/20 text-warning' : 'bg-muted text-muted-foreground',
                )}>
                  {annotation.index}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs font-semibold text-foreground">
                      {annotation.anchor?.label ?? 'General request'}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {STATUS_LABEL[annotation.status]}
                    </span>
                  </div>
                  {/* An anchor that no longer resolves keeps its label and says
                      why it has no pin, rather than quietly vanishing. */}
                  {annotation.anchor && !annotation.placeable ? (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      This clause has changed since the request was raised.
                    </p>
                  ) : null}
                  {annotation.anchor?.quote ? (
                    <p className="mt-1 line-clamp-2 border-l-2 border-border pl-2 text-[11px] italic leading-relaxed text-muted-foreground">
                      {annotation.anchor.quote}
                    </p>
                  ) : null}
                  <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                    {annotation.comment}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {annotation.requestedByLabel ?? 'Partner'}
                    {' · '}
                    {format(new Date(annotation.createdAt), 'd MMM yyyy')}
                  </p>

                  {annotation.resolutionNote || annotation.status !== 'open' ? (
                    <div className="mt-2 rounded-lg bg-background/60 p-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Response
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                        {annotation.resolutionNote || 'No note was left.'}
                      </p>
                    </div>
                  ) : null}

                  {onResolve && annotation.status === 'open' ? (
                    <div className="mt-2" onClick={(event) => event.stopPropagation()}>
                      {answerFor === annotation.id ? (
                        <>
                          <Textarea
                            rows={2} maxLength={2000} className="text-xs"
                            placeholder="What are you telling the partner?"
                            value={answer}
                            onChange={(event) => setAnswer(event.target.value)}
                          />
                          <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
                            <Button variant="ghost" size="sm" className="h-7 text-xs"
                              onClick={() => { setAnswerFor(null); setAnswer(''); }}>
                              Cancel
                            </Button>
                            <Button variant="outline" size="sm" className="h-7 text-xs"
                              disabled={resolvingId === annotation.id}
                              onClick={() => onResolve(annotation.id, 'declined', answer.trim())}>
                              Not accepted
                            </Button>
                            <Button size="sm" className="h-7 text-xs"
                              disabled={resolvingId === annotation.id}
                              onClick={() => onResolve(annotation.id, 'resolved', answer.trim())}>
                              {resolvingId === annotation.id
                                ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                : <Check className="mr-1 h-3 w-3" />}
                              Actioned
                            </Button>
                          </div>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" className="h-7 text-xs"
                          onClick={() => { setAnswerFor(annotation.id); setAnswer(''); }}>
                          Respond
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
