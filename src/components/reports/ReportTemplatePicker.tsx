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
 * ## The library IS the choice, not a place the choice points at
 *
 * The catalogue of designs lives in `template_library_entries` — fifty masters
 * per format — and for a long time the only exit from it was "Use template",
 * which creates an *editing draft* in the Builder. Choosing a design for
 * generation is a different act, so this dialog lists the library's
 * production-ready designs for the format directly, grouped by design family
 * with the family's curated colourways beside them. Picking one asks the
 * server for a *selectable* copy (`use_for_reports` — active, approved,
 * user-scoped, idempotent on entry + version + colourway) and stores it as the
 * selection in one flow. The seeded house masters are found by lineage before
 * any copy is made, so adopting the default never mints a private duplicate.
 *
 * An existing selection is followed: the row it descends from is pre-checked
 * and badged, whichever half of the dialog it lives in — and the choice can
 * always be changed or returned to automatic.
 *
 * ## What it will and will not claim
 *
 * Active rows with no library lineage (hand-built templates, the Compass
 * pilot) are still listed and still selectable. A template whose engine is not
 * WeasyPrint says on its face that it produces the legacy document — it is
 * selectable because it is what the ranking would have picked anyway.
 */
import { useEffect, useMemo, useState } from 'react';
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
import { useAdoptForReports, useTemplateLibraryEntries } from '@/hooks/useTemplateLibrary';
import {
  normaliseReportType,
  templateRendersThroughDesignSystem,
  type SelectableTemplateRow,
} from '@/lib/reportTemplate/templateSelection';
import type { TemplateLibraryListEntry } from '@/lib/templateLibrary/types';
import {
  axisLabel, entryColourways, entryDefaultColourwayId,
} from '@/lib/templateLibrary/entryDesign';
import { TemplateColourwayPicker } from '@/components/templateLibrary/TemplateColourwayPicker';

/** The sentinel for "no fixed template" — the resolver's ranking decides. */
const AUTOMATIC = '__automatic__';
/** Radio value for a library design: `lib:<entryId>`. Colourway rides beside it. */
const libValue = (entryId: string) => `lib:${entryId}`;

interface Props {
  /** Any spelling of the format; it is normalised before anything is stored. */
  reportType: string;
  /** What to call the format on screen. */
  formatLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** A design family's entries, in the approved variant order (A first). */
interface FamilyGroup {
  key: string;
  name: string;
  note: string | null;
  defaultColourwayId: string | null;
  entries: TemplateLibraryListEntry[];
}

function groupByFamily(entries: TemplateLibraryListEntry[]): {
  families: FamilyGroup[];
  loose: TemplateLibraryListEntry[];
} {
  const families = new Map<string, FamilyGroup>();
  const loose: TemplateLibraryListEntry[] = [];
  for (const entry of entries) {
    const meta = entry.designMeta;
    if (!meta?.familyKey) { loose.push(entry); continue; }
    let group = families.get(meta.familyKey);
    if (!group) {
      group = {
        key: meta.familyKey,
        name: meta.familyName || meta.familyKey,
        note: meta.familyNote || null,
        defaultColourwayId: entryDefaultColourwayId(entry),
        entries: [],
      };
      families.set(meta.familyKey, group);
    }
    group.entries.push(entry);
  }
  for (const group of families.values()) {
    group.entries.sort((a, b) =>
      String(a.designMeta?.variantAxis ?? '').localeCompare(String(b.designMeta?.variantAxis ?? '')));
  }
  return {
    families: [...families.values()].sort((a, b) => a.name.localeCompare(b.name)),
    loose: loose.sort((a, b) => String(a.name).localeCompare(String(b.name))),
  };
}

/** The active row this (entry, colourway) already exists as, if any. */
function candidateForEntry(
  candidates: SelectableTemplateRow[],
  entry: TemplateLibraryListEntry,
  colourwayId: string | null,
): SelectableTemplateRow | null {
  return candidates.find((row) => {
    const lineage = row.libraryLineage;
    if (!lineage?.entryId) return false;
    return lineage.entryId === entry.id
      && Number(lineage.entryVersion ?? -1) === Number(entry.version ?? -2)
      && ((lineage.colourway ?? null) === (colourwayId ?? null));
  }) ?? null;
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

function LibraryRow({
  entry, checked, current, isHouseDefault,
}: {
  entry: TemplateLibraryListEntry;
  checked: boolean;
  current: boolean;
  isHouseDefault: boolean;
}) {
  const axis = axisLabel(entry.designMeta?.variantAxis);
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition',
        checked ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
      )}
    >
      <RadioGroupItem value={libValue(entry.id)} className="mt-1 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{entry.name}</span>
          {axis && <Badge variant="outline" className="text-[10px] capitalize">{axis}</Badge>}
          {isHouseDefault && <Badge variant="secondary" className="text-[10px]">House default</Badge>}
          {current && <Badge className="text-[10px]">Current</Badge>}
        </span>
        {entry.description && (
          <span className="mt-1 block text-xs text-muted-foreground">{entry.description}</span>
        )}
        {entry.pageCount > 0 && (
          <span className="mt-1 block text-[11px] text-muted-foreground/80">
            {entry.pageCount} page{entry.pageCount === 1 ? '' : 's'}
          </span>
        )}
      </span>
    </label>
  );
}

export function ReportTemplatePicker({ reportType, formatLabel, open, onOpenChange }: Props) {
  const { state, isLoading, error, isSaving, select, clear } = useReportTemplateSelection(reportType);
  const adopt = useAdoptForReports();
  const library = useTemplateLibraryEntries({ enabled: open });
  const [choice, setChoice] = useState<string>(AUTOMATIC);
  // One colourway per family, keyed by familyKey. Missing key = family default.
  const [colourwayByFamily, setColourwayByFamily] = useState<Record<string, string>>({});

  const format = normaliseReportType(reportType);

  /** The library's production designs for this format, grouped by family. */
  const { families, loose } = useMemo(() => {
    const entries = (library.data ?? []).filter((entry) =>
      normaliseReportType(entry.reportType) === format
      && entry.status === 'published'
      && entry.compatibility.productionReady
      && entry.compatibility.engine === 'weasyprint');
    return groupByFamily(entries);
  }, [library.data, format]);

  const candidates = state?.candidates ?? [];
  const libraryEntryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of families) for (const entry of group.entries) ids.add(entry.id);
    for (const entry of loose) ids.add(entry.id);
    return ids;
  }, [families, loose]);

  // Active rows that descend from a listed design are represented BY that
  // design's row — listing them twice would make one choice look like two.
  // Everything else (hand-built templates, the Compass pilot, copies of
  // designs the library no longer lists) stays in its own section.
  const standaloneCandidates = useMemo(
    () => candidates.filter((row) =>
      !row.libraryLineage?.entryId || !libraryEntryIds.has(row.libraryLineage.entryId)),
    [candidates, libraryEntryIds],
  );

  /** What the stored selection means in this dialog's vocabulary. */
  const storedChoice = useMemo(() => {
    if (state?.status !== 'selected' || !state.selectedTemplateId) return AUTOMATIC;
    const lineage = state.template?.libraryLineage;
    if (lineage?.entryId && libraryEntryIds.has(lineage.entryId)) return libValue(lineage.entryId);
    return state.selectedTemplateId;
  }, [state?.status, state?.selectedTemplateId, state?.template, libraryEntryIds]);

  // Re-seed from the server every time it opens, so a dialog dismissed without
  // saving never carries a phantom choice into the next viewing. The stored
  // selection's colourway seeds its family's swatch, so "what you have" is
  // what the dialog shows before anything is touched.
  useEffect(() => {
    if (!open) return;
    setChoice(storedChoice);
    const lineage = state?.status === 'selected' ? state.template?.libraryLineage : null;
    if (lineage?.familyKey && lineage.colourway) {
      setColourwayByFamily((prev) => ({ ...prev, [lineage.familyKey!]: lineage.colourway! }));
    }
  }, [open, storedChoice]);

  const colourwayFor = (group: FamilyGroup): string | null =>
    colourwayByFamily[group.key] ?? group.defaultColourwayId;

  /** Null when the family default is chosen — "the authored palette, unbaked". */
  const normalisedColourway = (group: FamilyGroup | null, entry: TemplateLibraryListEntry): string | null => {
    if (!group) return null;
    const chosen = colourwayFor(group);
    return chosen && chosen !== entryDefaultColourwayId(entry) ? chosen : null;
  };

  const entryById = useMemo(() => {
    const map = new Map<string, { entry: TemplateLibraryListEntry; group: FamilyGroup | null }>();
    for (const group of families) for (const entry of group.entries) map.set(entry.id, { entry, group });
    for (const entry of loose) map.set(entry.id, { entry, group: null });
    return map;
  }, [families, loose]);

  const unchanged = choice === storedChoice && (() => {
    // A library choice is also its colourway: the same design in a different
    // palette is a different document.
    if (!choice.startsWith('lib:')) return true;
    const found = entryById.get(choice.slice(4));
    if (!found) return true;
    const storedColourway = state?.status === 'selected'
      ? state.template?.libraryLineage?.colourway ?? null
      : null;
    return normalisedColourway(found.group, found.entry) === storedColourway;
  })();

  const busy = isSaving || adopt.isPending;

  const save = async () => {
    try {
      if (choice === AUTOMATIC) {
        await clear();
        toast.success(`${formatLabel} reports will use the default template again.`);
      } else if (choice.startsWith('lib:')) {
        const found = entryById.get(choice.slice(4));
        if (!found) return;
        const colourwayId = normalisedColourway(found.group, found.entry);
        // An active row that already IS this (design, version, colourway) —
        // the seeded house master, or a copy adopted earlier — is selected
        // directly. Only a genuinely new combination asks the server for one,
        // and the server dedupes again in case another tab got there first.
        const existing = candidateForEntry(candidates, found.entry, colourwayId);
        const templateId = existing?.id
          ?? (await adopt.mutateAsync({ entryId: found.entry.id, colourwayId })).templateId;
        await select(templateId);
        const cwName = colourwayId
          ? entryColourways(found.entry).find((c) => c.id === colourwayId)?.name
          : null;
        toast.success(
          `${formatLabel} reports will now use ${found.entry.name}${cwName ? ` · ${cwName}` : ''}.`,
        );
      } else {
        await select(choice);
        const name = candidates.find((t) => t.id === choice)?.name ?? 'the selected template';
        toast.success(`${formatLabel} reports will now use ${name}.`);
      }
      onOpenChange(false);
    } catch (e) {
      // Selection errors are toasted by the hook; adoption errors are ours to
      // explain — and the current choice still stands, which is the half a
      // person needs to hear.
      if (choice.startsWith('lib:')) {
        toast.error(
          e instanceof Error && e.message
            ? `${e.message} Your current template choice is unchanged.`
            : 'The design could not be prepared. Your current template choice is unchanged.',
        );
      }
      // The dialog stays open so a retry costs nothing and the choice is not lost.
    }
  };

  const isSelectedRow = (entry: TemplateLibraryListEntry, group: FamilyGroup | null): boolean => {
    if (state?.status !== 'selected') return false;
    const lineage = state.template?.libraryLineage;
    if (!lineage || lineage.entryId !== entry.id) return false;
    return (lineage.colourway ?? null) === normalisedColourway(group, entry);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose a template</DialogTitle>
          <DialogDescription>
            Pick the design <span className="font-medium text-foreground">{formatLabel}</span>{' '}
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

            <div className="max-h-[56vh] space-y-4 overflow-y-auto pr-1">
              <RadioGroup value={choice} onValueChange={setChoice} className="space-y-4">
                <div className="space-y-2">
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

                  {standaloneCandidates.map((template) => (
                    <TemplateRow key={template.id} template={template} checked={choice === template.id} />
                  ))}
                </div>

                {(families.length > 0 || loose.length > 0) && (
                  <div className="space-y-4">
                    <p className="text-xs font-medium uppercase tracking-[0.07em] text-muted-foreground">
                      From the Template Library
                    </p>

                    {families.map((group) => (
                      <section key={group.key} className="space-y-2" aria-label={group.name}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{group.name}</span>
                            {group.note && (
                              <span className="block text-xs text-muted-foreground">{group.note}</span>
                            )}
                          </span>
                          <TemplateColourwayPicker
                            colourways={entryColourways(group.entries[0])}
                            selectedId={colourwayFor(group) ?? ''}
                            onSelect={(id) =>
                              setColourwayByFamily((prev) => ({ ...prev, [group.key]: id }))}
                            size="sm"
                            ariaLabel={`Colourway for ${group.name} designs`}
                          />
                        </div>
                        <div className="space-y-2">
                          {group.entries.map((entry) => (
                            <LibraryRow
                              key={entry.id}
                              entry={entry}
                              checked={choice === libValue(entry.id)}
                              current={isSelectedRow(entry, group)}
                              isHouseDefault={!!candidateForEntry(candidates, entry, null)
                                ?.is_default}
                            />
                          ))}
                        </div>
                      </section>
                    ))}

                    {loose.length > 0 && (
                      <section className="space-y-2" aria-label="More designs">
                        {families.length > 0 && (
                          <span className="block text-sm font-medium">More designs</span>
                        )}
                        {loose.map((entry) => (
                          <LibraryRow
                            key={entry.id}
                            entry={entry}
                            checked={choice === libValue(entry.id)}
                            current={isSelectedRow(entry, null)}
                            isHouseDefault={!!candidateForEntry(candidates, entry, null)?.is_default}
                          />
                        ))}
                      </section>
                    )}
                  </div>
                )}
              </RadioGroup>

              {library.isLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              )}
              {library.error != null && (
                // The library failing to load must not take the chooser down
                // with it: the active templates above are still the truth.
                <p className="text-xs text-muted-foreground">
                  The Template Library couldn’t be reached, so only the active templates are
                  shown. Your current choice is unaffected.
                </p>
              )}
            </div>

            {standaloneCandidates.length === 0 && families.length === 0 && loose.length === 0
              && !library.isLoading && (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                No templates have been published for {formatLabel} yet, so these reports
                use the standard generator. A design becomes available here once it is
                published to the Template Library.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || unchanged || isLoading || !!error}>
            {busy
              ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> Saving…</>
              : <><CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" /> Save choice</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
