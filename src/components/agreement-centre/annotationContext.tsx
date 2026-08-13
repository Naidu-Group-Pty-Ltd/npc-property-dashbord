/**
 * The annotation layer's context and marker, shared by both portals.
 *
 * `DigitalAgreementView` already routes every text node of the document through
 * `Amendable`, which knows that node's stable path — the same path an amendment
 * writes to. That is exactly the hook a pin needs, so the annotation layer is a
 * second context read at the same point rather than a parallel traversal: one
 * document, one address space, two things hanging off it.
 *
 * It lives in its own module because the renderer is already 840 lines and
 * because both portals import the marker for their comment rails.
 */
import { createContext, useContext } from 'react';
import { MessageSquare, MessageSquarePlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toneForPath, type PlacedAnnotation } from '@/lib/agreements';

export interface AnnotationLayer {
  /** Pins that can be placed, bucketed by the path they sit on. */
  byPath: Map<string, PlacedAnnotation[]>;
  /** The thread currently open, so the document and the rail agree. */
  activeId: string | null;
  onSelect: (id: string | null) => void;
  /** True when this reader may raise a new request. */
  canAdd: boolean;
  /** Start a new request against this clause. */
  onAdd?: (path: string) => void;
  /** The path being composed against right now, if any. */
  composingPath?: string | null;
}

export const AnnotationContext = createContext<AnnotationLayer | null>(null);

export function useAnnotationLayer(): AnnotationLayer | null {
  return useContext(AnnotationContext);
}

/**
 * The marker that sits at the end of an annotated clause.
 *
 * Numbered rather than a bare dot: the number is what lets two people on a call
 * say "pin 4" and mean the same clause, which is most of the point of moving
 * the conversation onto the document in the first place.
 *
 * An open pin is loud and a settled one is quiet, because the only question a
 * reader is asking as they scan the page is "is anything still outstanding
 * here". A clause with one open and three resolved requests reads as open.
 */
export function AnnotationMarker({
  annotations,
  active,
  onSelect,
}: {
  annotations: PlacedAnnotation[];
  active: boolean;
  onSelect: (id: string) => void;
}) {
  if (annotations.length === 0) return null;
  const tone = toneForPath(annotations);
  const first = annotations[0];
  const label = annotations.length === 1
    ? `Change request ${first.index}${first.status === 'open' ? '' : ` (${first.status})`}`
    : `${annotations.length} change requests on this clause`;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => { event.stopPropagation(); onSelect(first.id); }}
      className={cn(
        'ml-1.5 inline-flex h-5 min-w-5 shrink-0 translate-y-[-1px] items-center justify-center',
        'gap-0.5 rounded-full px-1.5 align-middle text-[10px] font-semibold leading-none',
        'transition-colors',
        tone === 'open'
          ? 'bg-warning/20 text-warning ring-1 ring-warning/40 hover:bg-warning/30'
          : 'bg-muted text-muted-foreground ring-1 ring-border hover:bg-muted/80',
        active && 'ring-2 ring-primary',
      )}
    >
      <MessageSquare className="h-2.5 w-2.5" aria-hidden />
      {annotations.length === 1 ? first.index : annotations.length}
    </button>
  );
}

/**
 * The affordance for starting one, shown only to a reader who may.
 *
 * Deliberately quiet until the clause is hovered or focused: the document is a
 * legal instrument first and a comment surface second, and a page peppered with
 * permanent "+" buttons reads as a form. Keyboard users get it on focus, which
 * is why it is a real button in the flow rather than a hover-only overlay.
 */
export function AnnotationAddButton({
  path,
  onAdd,
  composing,
}: {
  path: string;
  onAdd: (path: string) => void;
  composing: boolean;
}) {
  return (
    <button
      type="button"
      aria-label="Request a change to this clause"
      title="Request a change to this clause"
      onClick={(event) => { event.stopPropagation(); onAdd(path); }}
      className={cn(
        'ml-1.5 inline-flex h-5 w-5 shrink-0 translate-y-[-1px] items-center justify-center',
        'rounded-full align-middle text-muted-foreground transition-opacity',
        'hover:bg-primary/10 hover:text-primary focus-visible:opacity-100',
        composing
          ? 'bg-primary/15 text-primary opacity-100'
          : 'opacity-0 group-hover/doctext:opacity-100 focus:opacity-100',
      )}
    >
      <MessageSquarePlus className="h-3 w-3" aria-hidden />
    </button>
  );
}
