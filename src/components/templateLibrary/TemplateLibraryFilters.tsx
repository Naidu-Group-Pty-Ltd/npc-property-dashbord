/**
 * Search, sort and multi-select filter chips for the library grid.
 *
 * Chips are real toggle buttons carrying `aria-pressed`, not styled divs, so
 * the filter state is reachable and announced. Filtering itself is pure and
 * lives in `filterEntries.ts`.
 */
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Search, X } from 'lucide-react';
import {
  CATEGORY_OPTIONS, INDUSTRY_OPTIONS, ORIENTATION_OPTIONS, STYLE_OPTIONS, reportTypeLabel,
} from '@/lib/templateLibrary/taxonomy';
import { hasActiveFilters, type TemplateLibrarySort } from '@/lib/templateLibrary/filterEntries';
import type { TemplateLibraryFilters as Filters } from '@/lib/templateLibrary/types';

interface Props {
  filters: Filters;
  onChange: (next: Filters) => void;
  sort: TemplateLibrarySort;
  onSortChange: (next: TemplateLibrarySort) => void;
  reportTypes: string[];
  onClear: () => void;
  resultCount: number;
  totalCount: number;
}

/** Toggle a value in one of the array-valued filter axes. */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

interface ChipProps {
  label: string;
  pressed: boolean;
  onClick: () => void;
}

function FilterChip({ label, pressed, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={[
        'rounded-full border px-3 py-1 text-xs transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        pressed
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function ChipGroup({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

export function TemplateLibraryFilters({
  filters, onChange, sort, onSortChange, reportTypes, onClear, resultCount, totalCount,
}: Props) {
  const active = hasActiveFilters(filters);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            placeholder="Search templates by name, description or tag..."
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            className="pl-9"
            aria-label="Search templates"
          />
        </div>
        <Select value={sort} onValueChange={(v) => onSortChange(v as TemplateLibrarySort)}>
          <SelectTrigger className="w-full sm:w-[200px]" aria-label="Sort templates">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">Recently updated</SelectItem>
            <SelectItem value="popular">Most used</SelectItem>
            <SelectItem value="name_asc">Name (A–Z)</SelectItem>
            <SelectItem value="name_desc">Name (Z–A)</SelectItem>
            <SelectItem value="pages_asc">Fewest pages</SelectItem>
            <SelectItem value="pages_desc">Most pages</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ChipGroup legend="Category">
          {CATEGORY_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              label={o.label}
              pressed={filters.categories.includes(o.value)}
              onClick={() => onChange({ ...filters, categories: toggle(filters.categories, o.value) })}
            />
          ))}
        </ChipGroup>

        {reportTypes.length > 0 && (
          <ChipGroup legend="Report type">
            {reportTypes.map((t) => (
              <FilterChip
                key={t}
                label={reportTypeLabel(t) ?? t}
                pressed={filters.reportTypes.includes(t)}
                onClick={() => onChange({ ...filters, reportTypes: toggle(filters.reportTypes, t) })}
              />
            ))}
          </ChipGroup>
        )}

        <ChipGroup legend="Style">
          {STYLE_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              label={o.label}
              pressed={filters.styles.includes(o.value)}
              onClick={() => onChange({ ...filters, styles: toggle(filters.styles, o.value) })}
            />
          ))}
        </ChipGroup>

        <ChipGroup legend="Industry">
          {INDUSTRY_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              label={o.label}
              pressed={filters.industries.includes(o.value)}
              onClick={() => onChange({ ...filters, industries: toggle(filters.industries, o.value) })}
            />
          ))}
        </ChipGroup>

        <ChipGroup legend="Orientation">
          {ORIENTATION_OPTIONS.map((o) => (
            <FilterChip
              key={o.value}
              label={o.label}
              pressed={filters.orientations.includes(o.value)}
              onClick={() => onChange({ ...filters, orientations: toggle(filters.orientations, o.value) })}
            />
          ))}
        </ChipGroup>

        <ChipGroup legend="Compatibility">
          <FilterChip
            label="Report-ready only"
            pressed={filters.productionReadyOnly}
            onClick={() => onChange({ ...filters, productionReadyOnly: !filters.productionReadyOnly })}
          />
        </ChipGroup>
      </div>

      <div className="flex items-center gap-3">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {active
            ? `${resultCount} of ${totalCount} template${totalCount === 1 ? '' : 's'}`
            : `${totalCount} template${totalCount === 1 ? '' : 's'}`}
        </p>
        {active && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={onClear}>
            <X className="h-3 w-3" aria-hidden="true" /> Clear filters
          </Button>
        )}
        {filters.productionReadyOnly && (
          <Badge variant="outline" className="text-xs">Report-ready only</Badge>
        )}
      </div>
    </div>
  );
}
