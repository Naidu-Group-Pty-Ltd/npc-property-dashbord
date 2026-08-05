/**
 * Read a completed intake pack inside the dashboard.
 *
 * The worked examples exist to answer questions a blank form cannot — how much
 * detail an answer needs, where it goes, what a finished sheet looks like — and
 * the honest answer is the document itself, not a description of it. So this
 * renders the real .xlsx and .docx at full fidelity rather than summarising
 * them, and it is strictly read-only: there is no download, no edit, and the
 * source files are never written to.
 *
 * ## Why an iframe
 *
 * Both documents carry their own typography and layout rules. Dropping either
 * into the dashboard would let two design systems fight — their `table`, `p`
 * and `span` rules inheriting from ours, and ours from theirs — and the result
 * would no longer be the approved document. An iframe is the only total
 * isolation, and it costs one element. It is sandboxed with scripts disallowed:
 * the content is static markup and nothing in it needs to execute.
 *
 * This mirrors `TemplateReaderDialog`, which reached the same conclusion for
 * the same reason.
 *
 * ## Why the frame does not scroll
 *
 * The frame is sized to its full content height with the *outer* container
 * scrolling, so page and sheet navigation is ordinary arithmetic on measured
 * offsets and never requires reaching inside the frame. That is what keeps the
 * frame script-free.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2, Minus, Plus,
  RotateCcw, TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PackSourceDocument } from '@/lib/ciAssessment/intakePack/sourceDocuments';

/** Zoom steps. 1 is "as rendered"; below it fits a wide sheet on screen. */
const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2];
const DEFAULT_ZOOM_INDEX = 3;
/** Workbooks open slightly reduced so a wide sheet fits without side-scrolling. */
const WORKBOOK_ZOOM_INDEX = 2;

interface Props {
  document: PackSourceDocument | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Status = 'idle' | 'loading' | 'ready' | 'error' | 'unsupported';

interface WorkbookState {
  kind: 'workbook';
  sheets: Array<{ name: string; html: string }>;
}

interface WordState {
  kind: 'guide';
  html: string;
  pageOffsets: number[];
  height: number;
  width: number;
}

type Rendered = WorkbookState | WordState;

/** The frame. `sandbox` with no tokens blocks scripts, forms and navigation. */
function DocumentFrame({
  html, title, height, scale,
}: {
  html: string;
  title: string;
  height?: number;
  scale: number;
}) {
  return (
    <iframe
      title={title}
      srcDoc={html}
      sandbox=""
      referrerPolicy="no-referrer"
      className="ci-pack-frame"
      style={{
        height: height ? `${height}px` : '100%',
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        width: `${100 / scale}%`,
      }}
    />
  );
}

export function PackDocumentViewer({ document: source, open, onOpenChange }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [expanded, setExpanded] = useState(false);
  /** Bumped to re-run the render effect after a failure. */
  const [attempt, setAttempt] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const zoom = ZOOM_STEPS[zoomIndex];

  useEffect(() => {
    if (!open || !source) return;

    let cancelled = false;
    setStatus('loading');
    setError(null);
    setRendered(null);
    setSheetIndex(0);
    setPageIndex(0);
    // Workbook sheets are far wider than they are tall, so they open one step
    // down: that fits a sheet across the stage without a horizontal scroll.
    setZoomIndex(source.kind === 'workbook' ? WORKBOOK_ZOOM_INDEX : DEFAULT_ZOOM_INDEX);

    (async () => {
      try {
        const { readSourceDocument } = await import(
          '@/lib/ciAssessment/intakePack/sourceDocuments'
        );
        const data = await readSourceDocument(source);
        if (cancelled) return;

        if (source.kind === 'workbook') {
          const { renderWorkbookToHtml } = await import(
            '@/lib/ciAssessment/intakePack/viewer/excelToHtml'
          );
          const result = await renderWorkbookToHtml(data);
          if (cancelled) return;
          setRendered({
            kind: 'workbook',
            sheets: result.sheets.map((sheet) => ({ name: sheet.name, html: sheet.html })),
          });
        } else {
          const { renderWordToHtml } = await import(
            '@/lib/ciAssessment/intakePack/viewer/wordToHtml'
          );
          const result = await renderWordToHtml(data);
          if (cancelled) return;
          setRendered({
            kind: 'guide',
            html: result.html,
            pageOffsets: result.pageOffsets,
            height: result.height,
            width: result.width,
          });
        }
        if (!cancelled) setStatus('ready');
      } catch (caught) {
        if (cancelled) return;
        setStatus('error');
        setError(caught instanceof Error ? caught.message : 'The document could not be opened.');
      }
    })();

    return () => { cancelled = true; };
  }, [open, source, attempt]);

  const pageCount = rendered?.kind === 'guide' ? rendered.pageOffsets.length : 0;

  /** Scroll the outer container — the frame itself never scrolls. */
  const goToPage = useCallback((index: number) => {
    if (rendered?.kind !== 'guide') return;
    const clamped = Math.max(0, Math.min(index, rendered.pageOffsets.length - 1));
    setPageIndex(clamped);
    scrollRef.current?.scrollTo({
      top: rendered.pageOffsets[clamped] * zoom,
      behavior: 'smooth',
    });
  }, [rendered, zoom]);

  const goToSheet = useCallback((index: number) => {
    setSheetIndex(index);
    scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const title = source?.title ?? 'Document';

  const sheetStrip = useMemo(() => {
    if (rendered?.kind !== 'workbook') return null;
    return (
      <nav className="ci-pack-tabs" aria-label="Worksheets">
        {rendered.sheets.map((sheet, index) => (
          <button
            key={sheet.name}
            type="button"
            onClick={() => goToSheet(index)}
            aria-current={index === sheetIndex ? 'true' : undefined}
            className={cn('ci-pack-tab', index === sheetIndex && 'ci-pack-tab-active')}
          >
            {sheet.name}
          </button>
        ))}
      </nav>
    );
  }, [rendered, sheetIndex, goToSheet]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The size classes are written here, not only in `ci-pack-dialog`: the
          dialog primitive's own `sm:max-w-lg` / `sm:max-h-[85dvh]` utilities sit
          in a later cascade layer than the component class, so a component-layer
          width was silently losing to them and the viewer opened tiny. */}
      <DialogContent
        className={cn(
          'ci-pack-dialog',
          'w-[96vw] max-w-none sm:w-[96vw] sm:max-w-none',
          'h-[92dvh] max-h-[92dvh] sm:max-h-[92dvh]',
          expanded && 'ci-pack-dialog-expanded w-[99vw] sm:w-[99vw] h-[97dvh] max-h-[97dvh] sm:max-h-[97dvh]',
        )}
      >
        <header className="ci-pack-header">
          <div className="min-w-0">
            <DialogTitle className="truncate text-base">{title}</DialogTitle>
            <DialogDescription className="mt-0.5 text-xs">
              A completed example, shown as the document itself. Read-only — nothing here can be
              edited, and it is not the file you fill in.
            </DialogDescription>
          </div>

          <div className="ci-pack-toolbar">
            <Badge variant="outline" className="ci-pack-readonly">Read-only</Badge>

            {rendered?.kind === 'guide' && pageCount > 1 ? (
              <span className="ci-pack-pager">
                <Button
                  size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => goToPage(pageIndex - 1)}
                  disabled={pageIndex === 0}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
                  Page {pageIndex + 1} of {pageCount}
                </span>
                <Button
                  size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => goToPage(pageIndex + 1)}
                  disabled={pageIndex >= pageCount - 1}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </span>
            ) : null}

            <span className="ci-pack-pager">
              <Button
                size="icon" variant="ghost" className="h-7 w-7"
                onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
                disabled={zoomIndex === 0}
                aria-label="Zoom out"
              >
                <Minus className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                size="icon" variant="ghost" className="h-7 w-7"
                onClick={() => setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))}
                disabled={zoomIndex === ZOOM_STEPS.length - 1}
                aria-label="Zoom in"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </span>

            <Button
              size="icon" variant="ghost" className="h-7 w-7"
              onClick={() => setExpanded((current) => !current)}
              aria-label={expanded ? 'Exit full screen' : 'Expand to full screen'}
              aria-pressed={expanded}
            >
              {expanded
                ? <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
                : <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />}
            </Button>
          </div>
        </header>

        {sheetStrip}

        <div
          ref={scrollRef}
          className="ci-pack-stage"
          tabIndex={0}
          role="group"
          aria-label={`${title} — scrollable document`}
        >
          {status === 'loading' ? (
            <div className="ci-pack-state" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">Opening the example…</p>
              <Skeleton className="mt-3 h-40 w-full max-w-3xl" />
            </div>
          ) : null}

          {status === 'error' ? (
            <div className="ci-pack-state" role="alert">
              <TriangleAlert className="h-5 w-5 text-destructive" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">This example could not be opened</p>
              <p className="max-w-md text-xs leading-5 text-muted-foreground">
                {error ?? 'Something went wrong rendering the document.'}
              </p>
              <Button size="sm" variant="outline" className="mt-2" onClick={retry}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Close and try again
              </Button>
            </div>
          ) : null}

          {status === 'unsupported' ? (
            <div className="ci-pack-state" role="alert">
              <TriangleAlert className="h-5 w-5 text-warning" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">This file type cannot be previewed</p>
            </div>
          ) : null}

          {status === 'ready' && rendered?.kind === 'workbook' ? (
            <DocumentFrame
              key={`${source?.id}-${sheetIndex}`}
              html={rendered.sheets[sheetIndex]?.html ?? ''}
              title={`${title} — ${rendered.sheets[sheetIndex]?.name ?? ''}`}
              scale={zoom}
            />
          ) : null}

          {status === 'ready' && rendered?.kind === 'guide' ? (
            <DocumentFrame
              key={source?.id}
              html={rendered.html}
              title={title}
              height={rendered.height}
              scale={zoom}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
