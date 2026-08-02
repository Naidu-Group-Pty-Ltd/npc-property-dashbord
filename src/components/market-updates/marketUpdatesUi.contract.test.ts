import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const read = (path:string) => readFileSync(path,'utf8');
const page = read('src/pages/MarketUpdates.tsx');
const archive = read('src/components/market-updates/MarketArchivePage.tsx');
const sources = read('src/components/market-updates/MarketSourcesAdminDialog.tsx');
const coverage = read('src/components/market-updates/MarketSourceCoveragePanel.tsx');
const desktopNavigation = read('src/components/layout/DashboardSidebar.tsx');
const mobileNavigation = read('src/components/layout/MobileSidebar.tsx');
const commandPalette = read('src/components/layout/GlobalCommandPalette.tsx');
const breadcrumbs = read('src/components/aurixa/BreadcrumbRail.tsx');
const routes = read('src/App.tsx');

describe('Market Updates Phase 4 UI contract',()=>{
  it('uses the Market News Feed display name while retaining the compatible route and permission key',()=>{
    expect(page).toContain('>Market News Feed</h1>');
    expect(desktopNavigation).toContain("title: 'Market News Feed', url: '/market-updates'");
    expect(mobileNavigation).toContain("title: 'Market News Feed', url: '/market-updates'");
    expect(commandPalette).toContain("title: 'Market News Feed', url: '/market-updates'");
    expect(breadcrumbs).toContain("'market-updates': 'Market News Feed'");
    expect(routes).toContain('<Route path="market-updates" element={<MarketUpdates />} />');
    expect(page).toContain("useModulePermissions('market_updates')");
  });

  it('surfaces published and held scopes inline in the feed rather than a separate candidate review modal',()=>{
    expect(page).toContain('Published');
    expect(page).toContain('Held');
    expect(page).toContain('setFeedScope');
    expect(page).not.toContain('max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-4xl');
    expect(page).not.toContain('reviewCandidates');
  });

  it('keeps Clear All in the filter container and preserves unrelated state',()=>{
    expect(page).toContain('Clear All');
    expect(page).toContain('disabled={!hasClearableFilters}');
    expect(page).toContain("clearMarketUpdateArticleFilters()");
    expect(page).not.toMatch(/const clearFilters = \(\) => \{[^}]*setActiveSegment/s);
    expect(page).not.toMatch(/const clearFilters = \(\) => \{[^}]*setActiveFreshness/s);
  });

  it('uses a deep-linkable archive page, fixed Sonner toast Undo, and permission-gated mutations',()=>{
    expect(page).toContain('archiveMarketUpdate(update.id)');
    expect(page).toContain('restoreMarketUpdate(updateId)');
    expect(page).toContain("action:{label:'Undo'");
    expect(page).toContain('canEditMarketUpdates && <Button');
    expect(archive).toContain('fetchMarketUpdateArchive');
    expect(page).toContain("navigate('/market-updates/archived')");
    expect(routes).toContain('<Route path="market-updates/archived" element={<MarketArchivePage />} />');
    expect(archive).toContain('Articles archived from the Market News Feed will appear here.');
    expect(archive).toContain('Clear All');
    expect(archive).toContain('Recently archived');
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
