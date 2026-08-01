import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const read = (path:string) => readFileSync(path,'utf8');
const page = read('src/pages/MarketUpdates.tsx');
const archive = read('src/components/market-updates/MarketArchiveDialog.tsx');
const sources = read('src/components/market-updates/MarketSourcesAdminDialog.tsx');
const coverage = read('src/components/market-updates/MarketSourceCoveragePanel.tsx');

describe('Market Updates Phase 4 UI contract',()=>{
  it('contains Candidate Review in one viewport-relative flex scroller',()=>{
    expect(page).toContain('max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-4xl');
    expect(page).toContain('min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden overscroll-contain');
    expect(page).toContain('pb-8');
    expect(page).toContain('break-words font-semibold leading-snug');
    expect(page).not.toContain('max-h-[70vh]');
  });

  it('keeps Clear All in the filter container and preserves unrelated state',()=>{
    expect(page).toContain('Clear All');
    expect(page).toContain('disabled={!hasClearableFilters}');
    expect(page).toContain("clearMarketUpdateArticleFilters()");
    expect(page).not.toMatch(/const clearFilters = \(\) => \{[^}]*setActiveSegment/s);
    expect(page).not.toMatch(/const clearFilters = \(\) => \{[^}]*setActiveFreshness/s);
  });

  it('uses the archive API, fixed Sonner toast Undo, and permission-gated controls',()=>{
    expect(page).toContain('archiveMarketUpdate(update.id)');
    expect(page).toContain('restoreMarketUpdate(updateId)');
    expect(page).toContain("action:{label:'Undo'");
    expect(page).toContain('canEditMarketUpdates && <Button');
    expect(archive).toContain('fetchMarketUpdateArchive');
    expect(archive).toContain('Archived news will remain here for 30 days');
    expect(archive).toContain('aria-label={`Restore ${item.title}`}');
  });

  it('does not render numerical intelligence confidence on Market Updates surfaces',()=>{
    expect(page).not.toContain('ConfidenceBar');
    expect(page).not.toContain('% conf');
    expect(page).not.toContain('AI confidence');
    expect(archive).not.toContain('confidence_score');
  });

  it('expands source administration and provides a wide wrapping geography area',()=>{
    expect(sources).toContain('max-w-7xl');
    expect(sources).toContain('aria-label="Market source registry"');
    expect(sources).toContain('Geography');
    expect(sources).toContain('whitespace-normal break-words');
    expect(coverage).toContain('min-h-[28rem] max-h-[70dvh]');
    expect(coverage).toContain('aria-label="Expanded source coverage"');
  });
});
