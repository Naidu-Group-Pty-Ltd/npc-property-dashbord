import { useEffect, useState } from 'react';
import { Archive, ExternalLink, Loader2, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { fetchMarketUpdateArchive } from '@/services/marketUpdatesService';
import type { ArchivedMarketUpdate, MarketUpdateArchivePage } from '@/types/marketUpdates';

const EMPTY_PAGE: MarketUpdateArchivePage = { items:[], count:0, page:1, pageSize:20, hasMore:false };
const dateLabel = (value?:string|null) => value ? new Date(value).toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short'}) : 'Not available';
const titleCase = (value:string) => value.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');

interface MarketArchiveDialogProps {
  open:boolean;
  onOpenChange:(open:boolean)=>void;
  onRestore:(id:string,title:string)=>Promise<boolean>;
  onCountChange:(count:number)=>void;
}

export function MarketArchiveDialog({ open, onOpenChange, onRestore, onCountChange }:MarketArchiveDialogProps) {
  const [archive,setArchive] = useState<MarketUpdateArchivePage>(EMPTY_PAGE);
  const [search,setSearch] = useState('');
  const [appliedSearch,setAppliedSearch] = useState('');
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [restoringId,setRestoringId] = useState<string|null>(null);
  const [reviewing,setReviewing] = useState<ArchivedMarketUpdate|null>(null);

  const load = async (page = 1, query = appliedSearch) => {
    setLoading(true);
    try {
      const result = await fetchMarketUpdateArchive({ page, pageSize:20, search:query, sort:'archived_desc' });
      setArchive(result);
      onCountChange(result.count);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Archived updates could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setReviewing(null);
    void load(1, appliedSearch);
  }, [open]);

  const applySearch = () => {
    const next = search.trim();
    setAppliedSearch(next);
    void load(1,next);
  };
  const clearSearch = () => {
    setSearch('');
    setAppliedSearch('');
    void load(1,'');
  };
  const restore = async (item:ArchivedMarketUpdate) => {
    if (restoringId) return;
    setRestoringId(item.id);
    const restored = await onRestore(item.id,item.title);
    if (restored) {
      setReviewing(current => current?.id === item.id ? null : current);
      await load(archive.items.length === 1 && archive.page > 1 ? archive.page - 1 : archive.page);
    }
    setRestoringId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-6xl">
        <DialogHeader className="shrink-0 space-y-2 border-b border-border/60 px-5 py-4 pr-14 text-left sm:px-6">
          <DialogTitle className="flex items-center gap-2"><Archive className="h-5 w-5 text-primary" aria-hidden />Market Updates Archive</DialogTitle>
          <p className="max-w-3xl text-sm text-muted-foreground">Archived news remains available for 30 days before automatic deletion. Review or restore an update without leaving this page.</p>
        </DialogHeader>

        <div className="shrink-0 border-b border-border/60 px-5 py-3 sm:px-6">
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={event => { event.preventDefault(); applySearch(); }}>
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search archived title, source or summary…" aria-label="Search archived market updates" className="pl-9" />
            </div>
            <Button type="submit" variant="outline" disabled={loading}>Search</Button>
            <Button type="button" variant="ghost" onClick={clearSearch} disabled={loading || (!search && !appliedSearch)}>Clear</Button>
            <Button type="button" variant="ghost" size="icon" onClick={() => void load(archive.page)} disabled={loading} aria-label="Refresh archived market updates">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">{archive.count} archived {archive.count === 1 ? 'update' : 'updates'}{appliedSearch ? ` matching “${appliedSearch}”` : ''}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-4 pb-8 sm:px-6" tabIndex={0} aria-label="Archived market updates">
          {error && <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"><p className="font-semibold text-destructive">Archive could not be loaded</p><p className="mt-1 text-muted-foreground">{error}</p><Button className="mt-3" size="sm" variant="outline" onClick={() => void load(archive.page)}>Retry</Button></div>}
          {loading && archive.items.length === 0 ? <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading archived updates…</div>
          : archive.items.length === 0 && !error ? <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center"><Archive className="h-9 w-9 text-muted-foreground" aria-hidden /><p className="mt-3 font-medium">No archived updates</p><p className="mt-1 max-w-lg text-sm text-muted-foreground">Archived news will remain here for 30 days before being automatically deleted.</p></div>
          : <div className="space-y-3">{archive.items.map(item => (
            <article key={item.id} className="min-w-0 rounded-xl border border-border/60 bg-card p-4">
              <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{titleCase(item.category)}</Badge>{item.geography.map(place => <Badge key={place} variant="secondary">{place}</Badge>)}</div>
                  <h3 className="mt-2 break-words text-base font-semibold leading-snug">{item.title}</h3>
                  <p className="mt-1 break-words text-sm text-muted-foreground">{item.source_name}</p>
                  <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
                    <div><dt className="text-muted-foreground">Archived</dt><dd className="mt-0.5 font-medium">{dateLabel(item.archived_at)}</dd></div>
                    <div><dt className="text-muted-foreground">Archived by</dt><dd className="mt-0.5 break-all font-medium" title={item.archived_by ?? undefined}>{item.archived_by ? `Administrator ${item.archived_by.slice(0,8)}…` : 'Historical operator'}</dd></div>
                    <div><dt className="text-muted-foreground">Scheduled deletion</dt><dd className="mt-0.5 font-medium">{dateLabel(item.deletes_at)}</dd></div>
                    <div><dt className="text-muted-foreground">Retention</dt><dd className="mt-0.5 font-medium">{item.days_remaining} {item.days_remaining === 1 ? 'day' : 'days'} remaining</dd></div>
                  </dl>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setReviewing(item)}>Review</Button>
                  <Button size="sm" variant="outline" asChild><a href={item.source_url} target="_blank" rel="noreferrer"><ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden />Open source</a></Button>
                  <Button size="sm" onClick={() => void restore(item)} disabled={Boolean(restoringId)} aria-label={`Restore ${item.title}`}>
                    {restoringId === item.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden />}Restore
                  </Button>
                </div>
              </div>
            </article>
          ))}</div>}
        </div>

        {archive.count > archive.pageSize && <div className="flex shrink-0 items-center justify-between border-t border-border/60 px-5 py-3 sm:px-6"><Button variant="outline" size="sm" onClick={() => void load(archive.page - 1)} disabled={loading || archive.page <= 1}>Previous</Button><span className="text-xs text-muted-foreground">Page {archive.page} of {Math.max(1,Math.ceil(archive.count/archive.pageSize))}</span><Button variant="outline" size="sm" onClick={() => void load(archive.page + 1)} disabled={loading || !archive.hasMore}>Next</Button></div>}
      </DialogContent>

      <Dialog open={Boolean(reviewing)} onOpenChange={next => { if (!next) setReviewing(null); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-3xl">
          <DialogHeader><DialogTitle className="break-words pr-8 leading-snug">{reviewing?.title}</DialogTitle><p className="break-words text-sm text-muted-foreground">{reviewing?.source_name}</p></DialogHeader>
          <div className="space-y-4"><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{reviewing?.ai_summary || reviewing?.public_excerpt || 'No stored summary is available. Open the original source to review this update.'}</p><div className="flex flex-wrap gap-2"><Button variant="outline" asChild><a href={reviewing?.source_url} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" aria-hidden />Open original source</a></Button>{reviewing && <Button onClick={() => void restore(reviewing)} disabled={Boolean(restoringId)}><RotateCcw className="mr-2 h-4 w-4" aria-hidden />Restore update</Button>}</div></div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
