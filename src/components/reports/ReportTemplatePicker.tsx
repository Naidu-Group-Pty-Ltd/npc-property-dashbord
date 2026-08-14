/**
 * Choose the template a report format is generated with.
 *
 * ## Why this dialog exists
 *
 * A template reached a document by ranking alone — `resolve_report_template()`
 * sorted the active rows and took the first — and the only surface in the
 * product that touched templates was the Template Builder. So "use this
 * template for my Investment reports" meant opening an editor, forking a
 * working copy and hoping the ranking landed on it. This is the chooser that
 * was missing. It navigates nowhere.
 *
 * ## What it will and will not claim
 *
 * Every entry is a template that is already `is_active`, which a row only
 * becomes by passing `validateReportTemplateUpdate` — superadmin, approved, a
 * production adapter for the type, and a schema that renders. Choosing is
 * choosing among approved things, so the dialog does not gate anything.
 *
 * What it does do is tell the truth about the choice. A template whose engine
 * is not WeasyPrint is skipped by `routeReportThroughTemplate` and the document
 * comes out of the legacy generator instead — one of the four silent
 * fall-throughs `docs/reports/COVERAGE.md` measured, and the reason 80 of 81
 * template rows draw nothing. Such a row is still selectable, because it is
 * what the ranking would have picked anyway, but it says so on its face rather
 * than looking identical to one that works.
 */
import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle2, Loader2, TriangleAlert, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useReportTemplateSelection } from '@/hooks/useReportTemplateSelection';
import {
  templateRendersThroughDesignSystem, type SelectableTemplateRow,
} from '@/lib/reportTemplate/templateSelection';

/** The sentinel for "no fixed template" — the resolver's ranking decides. */
const AUTOMATIC = '__automatic__';

interface Props {
  /** Any spelling of the format; it is normalised before anything is stored. */
  reportType: string;
  /** What to call the format on screen. */
  formatLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function TemplateRow({ template, checked }: { template: SelectableTemplateRow; checked: boolean }) {
  const drawn = templateRendersThroughDesignSystem(template);
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition',
        checked ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
      )}
    >
      <RadioGroupItem value={template.id} className="mt-1 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{template.name || 'Untitled template'}</span>
          {template.is_default && <Badge variant="secondary" className="text-[10px]">House default</Badge>}
          {template.scope && template.scope !== 'global' && (
            <Badge variant="outline" className="text-[10px] capitalize">{template.scope}</Badge>
          )}
          {template.variant && (
            <Badge variant="outline" className="text-[10px] capitalize">{String(template.variant).replace(/_/g, ' ')}</Badge>
          )}
        </span>
        {template.description && (
          <span className="mt-1 block text-xs text-muted-foreground">{template.description}</span>
        )}
        {!drawn && (
          // Selectable, and honest: this is what the ranking would have picked
          // too, and it produces the legacy document either way.
          <span className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
            Not set up for design-system rendering — reports using it come out of the
            standard generator.
          </span>
        )}
      </span>
    </label>
  );
}

export function ReportTemplatePicker({ reportType, formatLabel, open, onOpenChange }: Props) {
  const { state, isLoading, error, isSaving, select, clear } = useReportTemplateSelection(reportType);
  const [choice, setChoice] = useState<string>(AUTOMATIC);

  // Re-seed from the server every time it opens, so a dialog dismissed without
  // saving never carries a phantom choice into the next viewing.
  useEffect(() => {
    if (!open) return;
    setChoice(state?.status === 'selected' ? state.selectedTemplateId ?? AUTOMATIC : AUTOMATIC);
  }, [open, state?.status, state?.selectedTemplateId]);

  const candidates = state?.candidates ?? [];
  const current = state?.status === 'selected' ? state.selectedTemplateId : null;
  const unchanged = choice === (current ?? AUTOMATIC);

  const save = async () => {
    try {
      if (choice === AUTOMATIC) {
        await clear();
        toast.success(`${formatLabel} reports will use the default template again.`);
      } else {
        await select(choice);
        const name = candidates.find((t) => t.id === choice)?.name ?? 'the selected template';
        toast.success(`${formatLabel} reports will now use ${name}.`);
      }
      onOpenChange(false);
    } catch {
      // The hook has already surfaced the reason; the dialog stays open so a
      // retry costs nothing and the choice is not lost.
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSaving) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Choose a template</DialogTitle>
          <DialogDescription>
            Pick the template <span className="font-medium text-foreground">{formatLabel}</span>{' '}
            reports are generated with. Your choice is kept for every report of this format
            until you change it here.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <TriangleAlert className="h-4 w-4" />
            <AlertTitle>We couldn’t load the templates</AlertTitle>
            <AlertDescription>
              {error.message} Reports still generate with the default template in the meantime.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3 py-2">
            {state?.status === 'unavailable' && (
              // A choice that stopped applying is news, and saying nothing would
              // mean documents quietly changing template under someone.
              <Alert variant="default">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Your previous choice is no longer available</AlertTitle>
                <AlertDescription>
                  The template you had chosen has been deactivated or moved to another format,
                  so these reports are using the default again. Pick another below.
                </AlertDescription>
              </Alert>
            )}

            <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
              <RadioGroup value={choice} onValueChange={setChoice} className="space-y-2">
                <label
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition',
                    choice === AUTOMATIC ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
                  )}
                >
                  <RadioGroupItem value={AUTOMATIC} className="mt-1 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Wand2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      Choose automatically
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Use whichever active template ranks highest for this format. This is what
                      happens when nothing is chosen.
                    </span>
                  </span>
                </label>

                {candidates.map((template) => (
                  <TemplateRow key={template.id} template={template} checked={choice === template.id} />
                ))}
              </RadioGroup>
            </div>

            {candidates.length === 0 && (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                No active templates have been published for {formatLabel} yet, so these reports
                use the standard generator. A template becomes available here once it is
                approved and activated.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isSaving || unchanged || isLoading || !!error}>
            {isSaving
              ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> Saving…</>
              : <><CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" /> Save choice</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
