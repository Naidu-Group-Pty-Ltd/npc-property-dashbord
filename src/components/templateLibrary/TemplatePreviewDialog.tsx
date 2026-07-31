/**
 * Full template preview: every page schematically, plus what the template
 * needs from the report data and whether it can drive a live report.
 *
 * Pages come from the entry's full `schema`, fetched on demand — the list
 * payload deliberately carries only page 1 so the grid query stays small.
 */
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, ShieldCheck, TriangleAlert } from 'lucide-react';
import { TemplatePreviewSvg } from './TemplatePreviewSvg';
import { useTemplateLibraryEntry } from '@/hooks/useTemplateLibrary';
import { categoryLabel, reportTypeLabel, styleLabel } from '@/lib/templateLibrary/taxonomy';
import type { TemplateLibraryListEntry } from '@/lib/templateLibrary/types';

interface Props {
  entry: TemplateLibraryListEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canUse: boolean;
  onUse: (entry: TemplateLibraryListEntry) => void;
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

export function TemplatePreviewDialog({ entry, open, onOpenChange, canUse, onUse }: Props) {
  const { data: detail, isLoading, isError, error } = useTemplateLibraryEntry(
    open && entry ? entry.id : undefined,
  );
  const [page, setPage] = useState(0);

  if (!entry) return null;

  const pages = Array.isArray((detail?.schema as any)?.pages) ? (detail!.schema as any).pages : [];
  const compat = entry.compatibility;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) setPage(0); onOpenChange(next); }}
    >
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{entry.name}</DialogTitle>
          <DialogDescription>
            {entry.longDescription || entry.description || 'No description provided.'}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(90vh-11rem)]">
          <div className="grid gap-6 px-6 py-5 md:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="space-y-3">
              {isLoading && <Skeleton className="mx-auto aspect-[210/297] w-full max-w-sm" />}

              {isError && (
                // Never block "Use template" on a preview failure — fall back to
                // the schematic the grid already has.
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Full preview unavailable{error instanceof Error ? `: ${error.message}` : '.'} Showing
                    the page-one outline instead.
                  </p>
                  <div className="mx-auto aspect-[210/297] w-full max-w-sm overflow-hidden rounded-md border border-border">
                    <TemplatePreviewSvg
                      schema={entry.previewSchema}
                      className="h-full w-full"
                      label={`Outline of ${entry.name}, page 1`}
                    />
                  </div>
                </div>
              )}

              {!isLoading && !isError && (
                <>
                  <div className="mx-auto aspect-[210/297] w-full max-w-sm overflow-hidden rounded-md border border-border shadow-sm">
                    <TemplatePreviewSvg
                      schema={detail?.schema}
                      pageIndex={page}
                      className="h-full w-full"
                      label={`Schematic preview of ${entry.name}, page ${page + 1} of ${pages.length}`}
                    />
                  </div>
                  {pages.length > 1 && (
                    <div className="flex flex-wrap justify-center gap-1.5" role="tablist" aria-label="Pages">
                      {pages.map((p: any, i: number) => (
                        <button
                          key={p?.id ?? i}
                          type="button"
                          role="tab"
                          aria-selected={i === page}
                          onClick={() => setPage(i)}
                          className={[
                            'rounded border px-2 py-1 text-xs transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            i === page
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                          ].join(' ')}
                        >
                          {p?.name || `Page ${i + 1}`}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="text-center text-xs text-muted-foreground">
                    Schematic outline — block placement, not final typography or imagery.
                  </p>
                </>
              )}
            </div>

            <div className="space-y-5">
              <dl className="grid grid-cols-2 gap-3">
                <Fact label="Category" value={categoryLabel(entry.category)} />
                <Fact label="Report type" value={reportTypeLabel(entry.reportType) ?? '—'} />
                <Fact label="Pages" value={entry.pageCount} />
                <Fact label="Page size" value={`${entry.pageSize} ${entry.orientation}`} />
                <Fact label="Style" value={styleLabel(entry.style) ?? '—'} />
                <Fact label="Version" value={`v${entry.version}`} />
              </dl>

              <div className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Compatibility
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  <Badge
                    variant="outline"
                    className={compat.productionReady
                      ? 'gap-1 border-success/40 text-success'
                      : 'gap-1 border-warning/40 text-warning'}
                  >
                    {compat.productionReady
                      ? <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                      : <TriangleAlert className="h-3 w-3" aria-hidden="true" />}
                    {compat.productionReady ? 'Report-ready' : 'Preview only'}
                  </Badge>
                  <Badge variant="outline">{compat.engine}</Badge>
                  {compat.brandSafe && <Badge variant="outline">White-label ready</Badge>}
                </div>
                {!compat.productionReady && (
                  <p className="text-xs text-muted-foreground">
                    You can create and edit a copy of this template. It cannot yet be activated for
                    live report generation, because this report type has no production adapter.
                  </p>
                )}
              </div>

              {compat.supportedModules.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Components used
                  </h3>
                  <div className="flex flex-wrap gap-1">
                    {compat.supportedModules.slice(0, 24).map((m) => (
                      <Badge key={m} variant="secondary" className="text-[11px]">{m}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {compat.requiredBindings.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Report data used
                  </h3>
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {compat.requiredBindings.slice(0, 18).map((b) => (
                      <li key={b} className="font-mono">{b}</li>
                    ))}
                    {compat.requiredBindings.length > 18 && (
                      <li>+{compat.requiredBindings.length - 18} more</li>
                    )}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Fields with no value in a report render empty rather than failing.
                  </p>
                </div>
              )}

              {entry.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {entry.tags.map((t) => (
                    <Badge key={t} variant="outline" className="text-[11px]">{t}</Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {canUse && (
            <Button onClick={() => onUse(entry)}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Use template
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
