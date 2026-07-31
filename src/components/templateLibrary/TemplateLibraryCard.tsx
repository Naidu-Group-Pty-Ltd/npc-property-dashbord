/**
 * One template in the browse grid: schematic preview, identity, compatibility.
 *
 * The compatibility badge is the honest bit. Only the investment report-type
 * family has a production adapter today, so most library templates can be
 * copied and edited but not activated for live report generation. Saying so on
 * the card is better than letting a user discover it after they have invested
 * an afternoon in edits.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Eye, FileStack, Plus, ShieldCheck, TriangleAlert } from 'lucide-react';
import { TemplatePreviewSvg } from './TemplatePreviewSvg';
import { categoryLabel, reportTypeLabel, styleLabel } from '@/lib/templateLibrary/taxonomy';
import type { TemplateLibraryListEntry } from '@/lib/templateLibrary/types';

interface Props {
  entry: TemplateLibraryListEntry;
  canUse: boolean;
  onPreview: (entry: TemplateLibraryListEntry) => void;
  onUse: (entry: TemplateLibraryListEntry) => void;
}

export function TemplateLibraryCard({ entry, canUse, onPreview, onUse }: Props) {
  const compat = entry.compatibility;

  return (
    <Card className="flex flex-col overflow-hidden transition-colors hover:border-primary/40">
      <button
        type="button"
        onClick={() => onPreview(entry)}
        className="group relative block w-full border-b border-border bg-muted/30 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Preview ${entry.name}`}
      >
        <div className="mx-auto aspect-[210/297] w-full max-w-[180px] overflow-hidden rounded-sm border border-border shadow-sm">
          <TemplatePreviewSvg
            schema={entry.previewSchema}
            className="h-full w-full"
            label={`Schematic preview of ${entry.name}, page 1 of ${entry.pageCount}`}
          />
        </div>
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-card px-3 py-1.5 text-xs font-medium shadow-md">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Preview
          </span>
        </span>
      </button>

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">{entry.name}</CardTitle>
            <CardDescription className="mt-1 line-clamp-2 text-xs">
              {entry.description || 'No description'}
            </CardDescription>
          </div>
          {entry.accessTier !== 'standard' && (
            <Badge variant="default" className="shrink-0 text-xs capitalize">
              {entry.accessTier}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col justify-between gap-3">
        <div className="flex flex-wrap gap-1.5 text-xs">
          <Badge variant="secondary">{categoryLabel(entry.category)}</Badge>
          {entry.reportType && <Badge variant="outline">{reportTypeLabel(entry.reportType)}</Badge>}
          {entry.style && <Badge variant="outline">{styleLabel(entry.style)}</Badge>}
          <Badge variant="outline" className="gap-1">
            <FileStack className="h-3 w-3" aria-hidden="true" />
            {entry.pageCount} page{entry.pageCount === 1 ? '' : 's'}
          </Badge>
        </div>

        <TooltipProvider>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={
                    compat.productionReady
                      ? 'gap-1 border-success/40 text-success'
                      : 'gap-1 border-warning/40 text-warning'
                  }
                >
                  {compat.productionReady
                    ? <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                    : <TriangleAlert className="h-3 w-3" aria-hidden="true" />}
                  {compat.productionReady ? 'Report-ready' : 'Preview only'}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {compat.productionReady
                  ? 'This report type has a production adapter, and every block renders in the production pipeline. A copy can be approved and activated for live reports.'
                  : 'A copy can be created and edited, but this report type has no production adapter yet, so it cannot be activated for live report generation.'}
              </TooltipContent>
            </Tooltip>

            {compat.brandSafe && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="gap-1">White-label ready</Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Every colour is a brand token, so a partner palette applies in full.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </TooltipProvider>

        <div className="flex gap-2 pt-1">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => onPreview(entry)}>
            <Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Preview
          </Button>
          {canUse && (
            <Button size="sm" className="flex-1" onClick={() => onUse(entry)}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Use template
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
