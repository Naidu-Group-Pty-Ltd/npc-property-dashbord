/**
 * Pure filtering and sorting for the Template Library browse grid.
 *
 * Kept out of the component so the matching rules are unit-testable and so the
 * grid stays a rendering concern. Filtering is client-side: the catalogue is
 * tens of entries, not thousands, and the list payload is scalar metadata only,
 * so a round-trip per keystroke would be slower and no more correct. If the
 * catalogue ever outgrows that, this is the single function to move server-side.
 */
import type { TemplateLibraryFilters, TemplateLibraryListEntry } from './types';

export type TemplateLibrarySort =
  | 'recent'
  | 'name_asc'
  | 'name_desc'
  | 'popular'
  | 'pages_asc'
  | 'pages_desc';

export const EMPTY_FILTERS: TemplateLibraryFilters = {
  search: '',
  categories: [],
  reportTypes: [],
  industries: [],
  styles: [],
  orientations: [],
  productionReadyOnly: false,
};

export function hasActiveFilters(filters: TemplateLibraryFilters): boolean {
  return (
    filters.search.trim() !== ''
    || filters.categories.length > 0
    || filters.reportTypes.length > 0
    || filters.industries.length > 0
    || filters.styles.length > 0
    || filters.orientations.length > 0
    || filters.productionReadyOnly
  );
}

/** Case-insensitive match across the fields a user would reasonably search. */
function matchesSearch(entry: TemplateLibraryListEntry, query: string): boolean {
  if (!query) return true;
  const haystack = [
    entry.name,
    entry.description ?? '',
    entry.category,
    entry.reportType ?? '',
    entry.style ?? '',
    ...(entry.tags ?? []),
    ...(entry.industry ?? []),
  ].join(' ').toLowerCase();
  // Every whitespace-separated term must appear, so "suburb compass" narrows
  // rather than widening the way an OR match would.
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

/**
 * Filters compose as AND across axes and OR within one axis: picking two
 * categories widens, adding a style narrows. That is what a user means when
 * they tick two boxes in one group and one in another.
 */
export function filterLibraryEntries(
  entries: TemplateLibraryListEntry[],
  filters: TemplateLibraryFilters,
): TemplateLibraryListEntry[] {
  const query = filters.search.trim();
  return entries.filter((entry) => {
    if (!matchesSearch(entry, query)) return false;
    if (filters.categories.length && !filters.categories.includes(entry.category)) return false;
    if (filters.reportTypes.length && !filters.reportTypes.includes(entry.reportType ?? '')) return false;
    if (filters.styles.length && !filters.styles.includes(entry.style as never)) return false;
    if (filters.orientations.length && !filters.orientations.includes(entry.orientation)) return false;
    if (filters.industries.length) {
      const industries = entry.industry ?? [];
      if (!filters.industries.some((i) => industries.includes(i))) return false;
    }
    if (filters.productionReadyOnly && !entry.compatibility?.productionReady) return false;
    return true;
  });
}

export function sortLibraryEntries(
  entries: TemplateLibraryListEntry[],
  sort: TemplateLibrarySort,
): TemplateLibraryListEntry[] {
  const out = [...entries];
  switch (sort) {
    case 'name_asc':
      return out.sort((a, b) => a.name.localeCompare(b.name));
    case 'name_desc':
      return out.sort((a, b) => b.name.localeCompare(a.name));
    case 'popular':
      return out.sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0) || a.name.localeCompare(b.name));
    case 'pages_asc':
      return out.sort((a, b) => (a.pageCount ?? 0) - (b.pageCount ?? 0) || a.name.localeCompare(b.name));
    case 'pages_desc':
      return out.sort((a, b) => (b.pageCount ?? 0) - (a.pageCount ?? 0) || a.name.localeCompare(b.name));
    case 'recent':
    default:
      return out.sort(
        (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
      );
  }
}

/** The report types actually present in the catalogue, for the filter chips. */
export function availableReportTypes(entries: TemplateLibraryListEntry[]): string[] {
  return [...new Set(entries.map((e) => e.reportType).filter((t): t is string => !!t))].sort();
}
