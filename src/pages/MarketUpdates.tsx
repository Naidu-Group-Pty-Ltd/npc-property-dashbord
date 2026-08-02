import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Activity, AlertTriangle, Archive, BarChart3, Building2, ExternalLink, Eye, FileText, Globe2, Loader2, Newspaper, Radio, RotateCcw, Search, Settings, ShieldCheck, Sparkles, TrendingUp, Zap, Clock, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { normaliseSegmentBreakdown } from '@/lib/marketDigestSegments';
import { interleaveBySource } from '@/lib/marketFeedOrder';
import { answerMarketUpdateQuestion, archiveMarketUpdate, fetchLatestMarketDigest, fetchMarketSourceHealth, fetchMarketUpdates, generateMarketDigest, publishMarketUpdate, restoreMarketUpdate, streamMarketUpdateQuestion, ensureMarketUpdatesFresh, MarketUpdatesOperationalError } from '@/services/marketUpdatesService';
import type { MarketAudienceTag, MarketDigest24h, MarketDigestPeriod, MarketFreshnessTier, MarketGeography, MarketImpactLevel, MarketIngestionRun, MarketQAMessage, MarketSegment, MarketSourceHealth, MarketUpdate, MarketUpdateCategory, MarketUpdatesOperationalIssue } from '@/types/marketUpdates';
import { MarketSourcesAdminDialog } from '@/components/market-updates/MarketSourcesAdminDialog';
import { MarketSourceCoveragePanel } from '@/components/market-updates/MarketSourceCoveragePanel';
import { MarketQAVoiceButton } from '@/components/market-updates/MarketQAVoiceButton';
import { MarketQAAnswerActions } from '@/components/market-updates/MarketQAAnswerActions';
import type { MarketQARetrievedItem } from '@/types/marketUpdates';
import { LiveModelBadge } from '@/components/agentModels';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { clearMarketUpdateArticleFilters, DEFAULT_MARKET_UPDATE_ARTICLE_FILTERS, hasClearableMarketUpdateFilters } from '@/lib/marketUpdateFilters';

const PERIODS: Array<{ id: MarketDigestPeriod; label: string; hint: string }> = [
  { id: '24h', label: '24 Hours', hint: 'Last day' },
  { id: 'weekly', label: 'Weekly', hint: 'Past 7 days' },
  { id: 'biweekly', label: 'Bi-weekly', hint: 'Past 14 days' },
  { id: 'monthly', label: 'Monthly', hint: 'Past 30 days' },
  { id: 'quarterly', label: 'Quarterly', hint: 'Past 90 days' },
  { id: 'annual', label: 'Annual', hint: 'Past 12 months' },
];

const SEGMENTS: MarketSegment[] = ['finance','property','construction','political','economic','social','policy_regulation','rental'];
const FRESHNESS: Array<{ id: MarketFreshnessTier | 'all'; label: string; icon: any }> = [
  { id: 'all', label: 'All', icon: Radio },
  { id: 'breaking', label: 'Breaking', icon: Zap },
  { id: 'today', label: 'Today', icon: Clock },
  { id: 'this_week', label: 'This Week', icon: Newspaper },
  { id: 'older', label: 'Older', icon: FileText },
];

const categories: Array<'all' | MarketUpdateCategory> = ['all','finance','property_market','construction','policy_regulation','rental_market','economy','political','planning_supply','other'];
const geographies: Array<'all' | MarketGeography> = ['all','Australia','NSW','VIC','QLD','WA','SA','TAS','ACT','NT','Multi'];
const impacts: Array<'all' | MarketImpactLevel> = ['all','critical','high','medium','low'];
const audiences: Array<'all' | MarketAudienceTag> = ['all','investors','owner_occupiers','first_home_buyers','smsf','developers','buyers_agents','mortgage_brokers','property_managers','builders','finance_brokers'];

const titleCase = (v: string) => v.split('_').map(p => p[0].toUpperCase() + p.slice(1)).join(' ');
const label = (v: string) => v === 'all' ? 'All' : titleCase(v);
const dateLabel = (v?: string | null) => v ? new Date(v).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not available';

const FRESHNESS_STYLE: Record<MarketFreshnessTier, string> = {
  breaking: 'bg-destructive/15 text-destructive border-destructive/30',
  today: 'bg-primary/15 text-primary border-primary/30',
  this_week: 'bg-info/15 text-[hsl(var(--info))] border-info/30',
  older: 'bg-muted text-muted-foreground border-border',
};
const IMPACT_STYLE: Record<MarketImpactLevel, string> = {
  critical: 'bg-destructive/20 text-destructive border-destructive/50',
  high: 'bg-destructive/15 text-destructive border-destructive/30',
  medium: 'bg-warning/15 text-[hsl(var(--warning))] border-warning/30',
  low: 'bg-muted text-muted-foreground border-border',
};

function FreshnessBadge({ tier }: { tier: MarketFreshnessTier }) {
  const Icon = tier === 'breaking' ? Zap : tier === 'today' ? Clock : tier === 'this_week' ? Newspaper : FileText;
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', FRESHNESS_STYLE[tier])}><Icon className="h-3 w-3" />{titleCase(tier)}</span>;
}

function SegmentChip({ seg, active, onClick }: { seg: MarketSegment | 'all'; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
          : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
      )}
    >
      {seg === 'all' ? 'All Segments' : titleCase(seg)}
    </button>
  );
}

export default function MarketUpdates() {
  const navigate = useNavigate();
  const { canEdit:canEditMarketUpdates } = useModulePermissions('market_updates');
  const [updates, setUpdates] = useState<MarketUpdate[]>([]);
  const [sourceHealth, setSourceHealth] = useState<MarketSourceHealth>({ totalSources:0, enabledSources:0, healthySources:0, degradedSources:0, failedSources:0 });
  const [loading, setLoading] = useState(true);
  const [digestLoading, setDigestLoading] = useState(false);
  const [period, setPeriod] = useState<MarketDigestPeriod>('24h');
  const [digest, setDigest] = useState<MarketDigest24h | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dataIssue, setDataIssue] = useState<MarketUpdatesOperationalIssue | null>(null);
  const [digestIssue, setDigestIssue] = useState<MarketUpdatesOperationalIssue | null>(null);
  const [actionIssue, setActionIssue] = useState<MarketUpdatesOperationalIssue | null>(null);
  const operationalIssue = actionIssue ?? dataIssue ?? digestIssue;
  const [selectedUpdate, setSelectedUpdate] = useState<MarketUpdate | null>(null);
  const [hidingId, setHidingId] = useState<string | null>(null);
  const [qaUpdate, setQaUpdate] = useState<MarketUpdate | null>(null);
  const [question, setQuestion] = useState('');
  const [qaMessage, setQaMessage] = useState<MarketQAMessage | null>(null);
  const [qaThread, setQaThread] = useState<Array<{ role: 'user' | 'assistant'; content: string; citations?: string[]; limitations?: string[]; follow_up_questions?: string[]; key_figures?: Array<{ label: string; value: string; source_id?: string }>; time_horizon?: string; sentiment?: string; streaming?: boolean; retrieved?: MarketQARetrievedItem[]; question_id?: string | null }>>([]);
  const [asking, setAsking] = useState(false);
  const qaAbortRef = useRef<AbortController | null>(null);
  const qaRequestRef = useRef(0);
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const [dialogConversationId, setDialogConversationId] = useState<string>(() => crypto.randomUUID());
  const [search, setSearch] = useState('');
  const [activeSegment, setActiveSegment] = useState<MarketSegment | 'all'>('all');
  const [activeFreshness, setActiveFreshness] = useState<MarketFreshnessTier | 'all'>('all');
  const [filters, setFilters] = useState({...DEFAULT_MARKET_UPDATE_ARTICLE_FILTERS});
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [sourcesAdminOpen, setSourcesAdminOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<'updates' | 'ask-ai'>('updates');
  const [runSummary, setRunSummary] = useState<MarketIngestionRun | null>(null);
  // Shadow counters live on the ingestion response rather than the run row, so the
  // last run's validation result is held alongside it.
  const [runShadow, setRunShadow] = useState<{ sources:number; ingested:number; wouldPublish:number } | null>(null);
  // Held items live in the main feed behind a scope chip rather than a modal —
  // the tiered publication policy leaves far fewer of them, and the ones that
  // remain are managed in place.
  const [heldUpdates, setHeldUpdates] = useState<MarketUpdate[]>([]);
  const [feedScope, setFeedScope] = useState<'published' | 'held'>('published');
  const [publishingId, setPublishingId] = useState<string | null>(null);


  const issueFrom = (error: unknown): MarketUpdatesOperationalIssue => error instanceof MarketUpdatesOperationalError
    ? error.issue
    : { stage:'database', code:'unknown', message:'Some Market News Feed data could not be refreshed.', remediation:'Previously loaded information remains visible. Retry; if the warning persists, ask an administrator to review the status function.', functionName:'market-updates-status', retryable:true };

  const loadUpdates = async () => {
    setLoading(true);
    const [updatesResult, healthResult, heldResult] = await Promise.allSettled([
      fetchMarketUpdates({ limit:200 }),
      fetchMarketSourceHealth(),
      fetchMarketUpdates({ status:'candidate', limit:100 }),
    ]);
    if (updatesResult.status === 'fulfilled') setUpdates(updatesResult.value);
    if (healthResult.status === 'fulfilled') setSourceHealth(healthResult.value);
    // Held items are supplementary: a failure there must not blank the feed.
    if (heldResult.status === 'fulfilled') setHeldUpdates(heldResult.value);
    const failure = [updatesResult, healthResult].find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    setDataIssue(failure ? issueFrom(failure.reason) : null);
    setLoading(false);
    return {
      updates: updatesResult.status === 'fulfilled' ? updatesResult.value : null,
      health: healthResult.status === 'fulfilled' ? healthResult.value : null,
    };
  };

  const loadDigest = async (selectedPeriod:MarketDigestPeriod) => {
    try { setDigest(await fetchLatestMarketDigest(selectedPeriod)); setDigestIssue(null); }
    catch (error) { setDigestIssue(issueFrom(error)); }
  };

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      const loaded = await loadUpdates();
      if (cancelled || !loaded.updates || !loaded.health) return;
      try {
        setActionIssue(null);
        const result = await ensureMarketUpdatesFresh(loaded.health, loaded.updates.length);
        if (!cancelled && result) {
          setMessage(result.active ? 'Checking for newer market intelligence…' : `Market intelligence refreshed: ${result.ingested} items reviewed, ${result.published} new updates published.`);
          await loadUpdates();
        }
      } catch (error) { if (!cancelled) setActionIssue(issueFrom(error)); }
    };
    void start();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { void loadDigest(period); }, [period]);

  // Recency alone let the highest-volume masthead take most of the first screen, so the
  // filtered feed is interleaved across publishers before it renders.
  const filteredUpdates = useMemo(() => interleaveBySource(updates.filter((u) => {
    if (filters.category !== 'all' && u.category !== filters.category) return false;
    if (filters.geography !== 'all' && !u.geography.includes(filters.geography as MarketGeography)) return false;
    if (filters.impact !== 'all' && u.impact_level !== filters.impact) return false;
    if (filters.audience !== 'all' && !u.audience_tags.includes(filters.audience as MarketAudienceTag)) return false;
    if (activeSegment !== 'all' && !u.segments.includes(activeSegment)) return false;
    if (activeFreshness !== 'all' && u.freshness_tier !== activeFreshness) return false;
    if (sourceFilter !== 'all' && u.source_name !== sourceFilter) return false;
    if (search && !`${u.title} ${u.ai_summary ?? ''} ${u.source_name}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), (u) => u.source_name), [updates, filters, activeSegment, activeFreshness, sourceFilter, search]);
  const hasClearableFilters = hasClearableMarketUpdateFilters(search,sourceFilter,filters);
  const hasActiveFilters = hasClearableFilters || activeSegment !== 'all' || activeFreshness !== 'all';
  const clearFilters = () => { const cleared=clearMarketUpdateArticleFilters(); setSearch(cleared.search); setSourceFilter(cleared.source); setFilters(cleared.filters); };

  // Only the publishers actually present in the loaded feed, so the filter can
  // never offer a source that would return nothing.
  const feedSources = useMemo(
    () => [...new Set(updates.map(u => u.source_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [updates],
  );

  const freshnessCounts = useMemo(() => ({
    all: updates.length,
    breaking: updates.filter(u => u.freshness_tier === 'breaking').length,
    today: updates.filter(u => u.freshness_tier === 'today').length,
    this_week: updates.filter(u => u.freshness_tier === 'this_week').length,
    older: updates.filter(u => u.freshness_tier === 'older').length,
  }), [updates]);

  const segmentCounts = useMemo(() => {
    const c: Record<string, number> = { all: updates.length };
    for (const seg of SEGMENTS) c[seg] = updates.filter(u => u.segments.includes(seg)).length;
    return c;
  }, [updates]);

  const kpis = useMemo(() => [
    { label: 'Breaking Now', value: freshnessCounts.breaking, icon: Zap, tone: 'text-destructive' },
    { label: 'Today', value: freshnessCounts.today, icon: Clock, tone: 'text-primary' },
    { label: 'High Impact', value: updates.filter(u => u.impact_level === 'high').length, icon: TrendingUp, tone: 'text-warning' },
    { label: 'Finance', value: segmentCounts.finance ?? 0, icon: BarChart3, tone: 'text-primary' },
    { label: 'Property', value: segmentCounts.property ?? 0, icon: Building2, tone: 'text-info' },
    { label: 'Policy', value: segmentCounts.policy_regulation ?? 0, icon: ShieldCheck, tone: 'text-success' },
  ], [freshnessCounts, updates, segmentCounts]);

  const highImpact = updates.filter(u => u.impact_level === 'high').slice(0, 5);
  const feedEmptyState = useMemo(() => {
    if (loading) return null;
    if (updates.length > 0 && filteredUpdates.length === 0 && hasActiveFilters) return { title:'Published updates hidden by filters', description:'Clear the active filters to restore the complete published feed.', kind:'filters' as const };
    if (updates.length > 0) return null;
    if (dataIssue && sourceHealth.totalSources === 0) return { title:'Market News Feed data is unavailable', description:'Previously loaded content is not available in this session. Retry the authoritative status and feed requests.', kind:'failure' as const };
    if (sourceHealth.totalSources === 0) return { title:'No canonical source registry', description:'Apply the canonical registry migration, then open Sources to verify the approved feeds.', kind:'registry' as const };
    if (sourceHealth.enabledSources === 0) return { title:'Sources are configured but none are enabled', description:'Open Sources and enable at least one approved canonical source.', kind:'disabled' as const };
    if (sourceHealth.activeRun) return { title:'Ingestion is running', description:'The active run is discovering and classifying source-backed items. Progress is shown above.', kind:'running' as const };
    if ((sourceHealth.candidates ?? 0) > 0) return { title:'Items are awaiting review', description:`${sourceHealth.candidates} candidate item(s) were discovered but did not meet automatic publication criteria.`, kind:'candidates' as const };
    if (!sourceHealth.latestRun) return { title:'Sources are enabled and ready for their first run', description:'Sync the latest news to retrieve, classify and publish eligible source-backed updates.', kind:'never-run' as const };
    if ((sourceHealth.latestRun.items_discovered ?? 0) > 0 && (sourceHealth.latestRun.items_classified ?? 0) < sourceHealth.latestRun.items_discovered) return { title:'Discovered items are awaiting AI classification', description:'Review the latest run and test the configured Market News Feed classifier route.', kind:'classification' as const };
    return { title:'No published updates yet', description:'The latest run completed without an eligible publication. Review candidates, source health and AI readiness.', kind:'no-published' as const };
  }, [loading, updates.length, filteredUpdates.length, hasActiveFilters, dataIssue, sourceHealth]);

  const handleGenerateDigest = async () => {
    setDigestLoading(true);
    try { setActionIssue(null); const result = await generateMarketDigest(period); setMessage(result.message || null); setDigest(result.digest); }
    catch(error) { setActionIssue(issueFrom(error)); }
    finally { setDigestLoading(false); }
  };


  // legacy helper kept for a graceful transition from the old candidate-review modal

  const publishHeldUpdate = async (update: MarketUpdate) => {
    if (publishingId) return;
    setPublishingId(update.id);
    setActionIssue(null);
    try {
      await publishMarketUpdate(update.id);
      setHeldUpdates(current => current.filter(u => u.id !== update.id));
      toast.success(`Published “${update.title}”.`);
      await loadUpdates();
    } catch (error) {
      setActionIssue(issueFrom(error));
      toast.error(`“${update.title}” could not be published.`, { description:'It remains held for review.' });
    } finally { setPublishingId(null); }
  };


  const restoreArchived = async (updateId:string,title:string):Promise<boolean> => {
    if (hidingId) return false;
    setHidingId(updateId);
    try {
      setActionIssue(null);
      await restoreMarketUpdate(updateId);
      setSourceHealth(current => ({ ...current, archivedUpdates:Math.max(0,(current.archivedUpdates ?? 1)-1) }));
      await loadUpdates();
      toast.success(`Restored “${title}”.`);
      return true;
    } catch (error) {
      setActionIssue(issueFrom(error));
      toast.error(`“${title}” could not be restored.`,{description:'The active feed was not changed. Retry from the Archive.'});
      return false;
    } finally { setHidingId(null); }
  };

  const archiveUpdate = async (update: MarketUpdate) => {
    if (hidingId) return;
    setHidingId(update.id);
    setActionIssue(null);
    try {
      await archiveMarketUpdate(update.id);
      setUpdates(current => current.filter(u => u.id !== update.id));
      setSourceHealth(current => ({ ...current, archivedUpdates:(current.archivedUpdates ?? 0)+1 }));
      toast.success(`Archived “${update.title}”.`,{
        description:'This update remains available in Archived News until it is restored.',
        action:{label:'Undo',onClick:() => { void restoreArchived(update.id,update.title); }},
      });
    } catch (error) {
      setActionIssue(issueFrom(error));
      toast.error(`“${update.title}” could not be archived.`,{description:'The update remains in the active feed.'});
    }
    finally { setHidingId(null); }
  };

  const handleAsk = async (overrideQuestion?: string) => {
    const q = (overrideQuestion ?? question).trim();
    if (!q || asking) return;
    setAsking(true);
    const priorHistory = qaThread.map((t) => ({ role: t.role, content: t.content }));
    const inDialog = Boolean(qaUpdate);
    const convId = inDialog ? dialogConversationId : conversationId;
    qaAbortRef.current?.abort();
    const controller = new AbortController();
    qaAbortRef.current = controller;
    const requestId = ++qaRequestRef.current;
    setQaThread((t) => [...t, { role: 'user', content: q }, { role: 'assistant', content: '', streaming: true }]);
    setQuestion('');
    try {
      const seg = activeSegment !== 'all' ? activeSegment : undefined;
      const answer = await streamMarketUpdateQuestion(q, {
        updateIds: qaUpdate ? [qaUpdate.id] : undefined,
        history: priorHistory,
        segment: seg,
        conversation_id: convId,
        signal: controller.signal,
        onDelta: (acc) => {
          if (qaRequestRef.current !== requestId) return;
          setQaThread((t) => {
            const next = [...t];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: acc };
            return next;
          });
        },
      });
      if (qaRequestRef.current !== requestId) return;
      setQaMessage(answer);
      setQaThread((t) => {
        const next = [...t];
        next[next.length - 1] = {
          role: 'assistant',
          content: answer?.content ?? 'No response.',
          citations: answer?.citations ?? [],
          limitations: answer?.limitations ?? [],
          follow_up_questions: answer?.follow_up_questions ?? [],
          key_figures: answer?.key_figures ?? [],
          time_horizon: answer?.time_horizon,
          sentiment: answer?.sentiment,
          retrieved: answer?.retrieved ?? [],
          question_id: answer?.question_id ?? null,
          streaming: false,
        };
        return next;
      });
    } catch (err) {
      if (qaRequestRef.current !== requestId || (err instanceof DOMException && err.name === 'AbortError')) return;
      setQaThread((t) => {
        const next = [...t];
        next[next.length - 1] = { role: 'assistant', content: err instanceof Error ? err.message : 'Failed to get an answer. Please try again.', streaming: false };
        return next;
      });
    } finally {
      if (qaRequestRef.current === requestId) { setAsking(false); qaAbortRef.current = null; }
    }
  };

  const cancelAsk = () => {
    qaRequestRef.current += 1;
    qaAbortRef.current?.abort();
    qaAbortRef.current = null;
    setAsking(false);
    setQaThread((thread) => thread.filter((turn) => !turn.streaming));
  };


  const handleFollowUp = (q: string) => { setQuestion(q); void handleAsk(q); };

  const handleQuestionKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleAsk();
    }
  };


  const renderAskAIWorkspace = () => (
    <Card className="flex min-h-[560px] flex-col border-primary/20 bg-gradient-to-br from-card to-primary/[0.03]">
      <CardHeader className="flex-none pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-4 w-4 text-primary" />Ask AI
            </CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">Source-grounded, streaming answers from published market news. Threaded — follow-ups keep prior context.</p>
          </div>
          {qaThread.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => { cancelAsk(); setQaThread([]); setQaMessage(null); setConversationId(crypto.randomUUID()); }}>New thread</Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <div aria-label="Ask AI conversation" className="min-h-[320px] flex-1 space-y-3 overflow-y-auto overflow-x-hidden rounded-xl border border-border/60 bg-background/40 p-3">
          {qaThread.length === 0 ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
              <Sparkles className="mb-3 h-8 w-8 text-primary/70" />
              <h3 className="text-base font-semibold">Ask a source-grounded market question</h3>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">Answers use published market news and may refuse if there are no grounded sources available.</p>
              {!updates.length && <p className="mt-2 text-xs text-muted-foreground">No published updates loaded yet — the AI may refuse if it has no grounded sources.</p>}
            </div>
          ) : qaThread.map((turn, i) => (
            <div key={i} className={cn('rounded-lg p-3 text-sm leading-relaxed', turn.role === 'user' ? 'bg-primary/10 text-foreground' : 'border border-border/60 bg-background/70')}>
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                <span>{turn.role === 'user' ? 'You' : 'AI'}</span>
                {turn.role === 'assistant' && turn.sentiment && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{turn.sentiment}</Badge>}
                {turn.role === 'assistant' && turn.time_horizon && turn.time_horizon !== 'unclear' && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{turn.time_horizon.replace('_',' ')}</Badge>}
              </div>
              <p className="whitespace-pre-wrap break-words">{turn.content}</p>
              {turn.key_figures && turn.key_figures.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {turn.key_figures.map((k, j) => (
                    <div key={j} className="rounded border border-border/60 bg-background/50 px-2 py-1.5">
                      <div className="text-[10px] uppercase text-muted-foreground">{k.label}</div>
                      <div className="text-sm font-semibold text-primary">{k.value}</div>
                    </div>
                  ))}
                </div>
              )}
              {turn.citations && turn.citations.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {turn.citations.map((url, j) => (
                    <a key={url + j} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"><ExternalLink className="h-4 w-4" />Open original source</a>
                  ))}
                </div>
              )}
              {turn.follow_up_questions && turn.follow_up_questions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {turn.follow_up_questions.map((fq, j) => (
                    <button key={j} type="button" onClick={() => handleFollowUp(fq)} disabled={asking} className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-50">↳ {fq}</button>
                  ))}
                </div>
              )}
              {turn.limitations && turn.limitations.length > 0 && <ul className="mt-3 list-disc pl-4 text-xs text-muted-foreground">{turn.limitations.map((l, j) => <li key={j}>{l}</li>)}</ul>}
              {turn.role === 'assistant' && !turn.streaming && (
                <MarketQAAnswerActions content={turn.content} retrieved={turn.retrieved} questionId={turn.question_id} questionText={qaThread[i-1]?.role === "user" ? qaThread[i-1].content : undefined} />
              )}
            </div>
          ))}
          {asking && (
            <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/70 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
            </div>
          )}
        </div>
        <div className="flex-none space-y-2" aria-label="Ask AI composer">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleQuestionKeyDown}
            placeholder="Ask anything — e.g. What's the RBA signalling this month?"
            className="min-h-[96px] text-sm"
          />
          <div className="flex gap-2">
            <MarketQAVoiceButton onTranscript={(t) => setQuestion((q) => (q ? `${q.trim()} ${t}` : t))} disabled={asking} />
            <Button className="flex-1" onClick={() => handleAsk()} disabled={asking || !question.trim()}>
              {asking ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Asking…</> : <><Sparkles className="mr-2 h-4 w-4" />Ask safely</>}
            </Button>
            {asking && <Button variant="outline" onClick={cancelAsk}><XCircle className="mr-2 h-4 w-4" />Cancel</Button>}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-8">
        {/* Hero */}
        <section className="w-full overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 p-5 shadow-lg">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-primary/15 text-primary hover:bg-primary/20">Aurixa Market News Intelligence</Badge>
              </div>
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Market News Feed</h1>
              <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
                Australian property, lending, economic and regulatory intelligence
              </p>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Last ingest: {dateLabel(sourceHealth.lastSuccessAt)}</Badge>
                <Badge variant="outline" className={sourceHealth.automation?.cronStale ? 'text-destructive' : undefined}>Automation: {sourceHealth.automation?.cronStale ? 'stale' : dateLabel(sourceHealth.automation?.lastIngestionDispatchAt)}</Badge>
                <Badge variant="outline">{sourceHealth.enabledSources}/{sourceHealth.totalSources} sources live</Badge>
                {Boolean(sourceHealth.shadowSources) && <Badge variant="outline" title="Fetched and classified, but held out of the feed while they are validated."><Eye className="mr-1 h-3 w-3" />{sourceHealth.shadowSources} in shadow</Badge>}
                {sourceHealth.failedSources > 0 && <Badge variant="outline" className="text-destructive"><AlertTriangle className="mr-1 h-3 w-3" />{sourceHealth.failedSources} failing</Badge>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => navigate('/market-updates/archived')} aria-label="Open Archived News"><Archive className="mr-2 h-4 w-4" aria-hidden />Archived{typeof sourceHealth.archivedUpdates === 'number' && <Badge variant="secondary" className="ml-2">{sourceHealth.archivedUpdates}</Badge>}</Button>
              <Button variant="ghost" onClick={() => setSourcesAdminOpen(true)}><Settings className="mr-2 h-4 w-4" />Sources</Button>
            </div>
          </div>
        </section>

        {message && (
          <Card className="border-primary/25 bg-primary/5">
            <CardContent className="flex items-start justify-between gap-4 p-4">
              <p className="text-sm text-foreground">{message}</p>
              <Button size="sm" variant="ghost" onClick={() => setMessage(null)}>Dismiss</Button>
            </CardContent>
          </Card>
        )}

        {operationalIssue && (
          <Card role="alert" className="border-destructive/30 bg-destructive/5">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="font-semibold text-destructive">Market News Feed requires attention</p>
                <p className="text-sm text-foreground">{operationalIssue.message}</p>
                <p className="text-xs text-muted-foreground">Stage: {titleCase(operationalIssue.stage)}{operationalIssue.functionName ? ` · Function: ${operationalIssue.functionName}` : ''}{operationalIssue.httpStatus ? ` · HTTP ${operationalIssue.httpStatus}` : ''}{operationalIssue.correlationId ? ` · Correlation: ${operationalIssue.correlationId}` : ''} · {operationalIssue.retryable ? 'Retryable' : 'Administrator action required'}</p>
                <p className="text-sm text-muted-foreground">{operationalIssue.remediation}</p>
              </div>
              <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" onClick={operationalIssue.stage === 'digest' ? handleGenerateDigest : loadUpdates}>{operationalIssue.stage === 'digest' ? 'Retry digest' : 'Retry page data'}</Button><Button size="sm" onClick={() => setSourcesAdminOpen(true)}>Open Sources</Button></div>
            </CardContent>
          </Card>
        )}

        {(runSummary || sourceHealth.activeRun) && (() => { const run = runSummary ?? sourceHealth.activeRun!; return <Card aria-live="polite" className="border-primary/20"><CardContent className="space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">Ingestion run <span className="font-mono text-xs">{run.id.slice(0,8)}</span></p><p className="text-xs text-muted-foreground">{titleCase(run.status)} · {run.sources_processed}/{run.sources_considered} sources processed</p></div>{['queued','running'].includes(run.status) && <Loader2 className="h-4 w-4 animate-spin text-primary" />}</div><div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-8">{[['Discovered',run.items_discovered],['Deduplicated',run.items_deduplicated ?? 0],['Classified',run.items_classified ?? 0],['Published',run.items_published],['Candidates',run.items_candidate ?? 0],['Ignored',run.items_ignored ?? 0],['Failed items',run.items_failed ?? 0],['Failed sources',run.sources_failed]].map(([label,value]) => <div key={String(label)} className="rounded border border-border/60 p-2"><span className="block text-muted-foreground">{label}</span><strong>{value}</strong></div>)}</div>{runShadow && <p className="text-xs text-muted-foreground">Shadow validation: {runShadow.sources} source(s) sampled {runShadow.ingested} item(s); {runShadow.wouldPublish} would have been published had they been live. None reached the feed.</p>}</CardContent></Card>; })()}

        {/* KPIs */}
        <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {kpis.map(k => (
            <button key={k.label} type="button" onClick={() => { if(k.label==='Breaking Now')setActiveFreshness('breaking'); else if(k.label==='Today')setActiveFreshness('today'); else if(k.label==='High Impact')setFilters(f=>({...f,impact:'high'})); else setActiveSegment(k.label==='Policy'?'policy_regulation':k.label.toLowerCase() as MarketSegment); }} className="rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Card className="h-full border-border/60 hover:border-primary/40"><CardContent className="p-4">
                <k.icon className={cn('mb-3 h-5 w-5', k.tone)} />
                <div className="text-2xl font-semibold tabular-nums">{k.value}</div>
                <p className="mt-1 text-xs text-muted-foreground">{k.label}</p>
              </CardContent></Card></button>
          ))}
        </section>

        {/* Where the feed comes from: all canonical sources, split by what the
            pipeline does with each. Collapsed to three tiles until asked to expand. */}
        <MarketSourceCoveragePanel shadowMetrics={sourceHealth.shadowMetrics} />

        {/* Period tabs + Digest */}
        <section>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as MarketDigestPeriod)}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <TabsList className="w-full sm:w-auto">
                {PERIODS.map(p => (
                  <TabsTrigger key={p.id} value={p.id} className="text-xs sm:text-sm">{p.label}</TabsTrigger>
                ))}
              </TabsList>
              <p className="text-xs text-muted-foreground">Digest period: <strong className="text-foreground">{PERIODS.find(p => p.id === period)?.hint}</strong></p>
            </div>

            {PERIODS.map(p => (
              <TabsContent key={p.id} value={p.id} className="mt-4">
                <Card className="border-primary/20 bg-gradient-to-br from-card to-primary/[0.03]">
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Sparkles className="h-4 w-4 text-primary" />
                        {p.label} Digest
                      </CardTitle>
                      {digest && <span className="text-xs text-muted-foreground">Generated {dateLabel(digest.generated_at)}</span>}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {!digest ? (
                      <div className="rounded-xl border border-dashed border-border p-5 text-center">
                        <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
                        <p className="text-sm text-muted-foreground">No digest has been generated for this period. The latest published updates are still available in Latest Updates.</p>
                        <Button size="sm" className="mt-4" onClick={handleGenerateDigest} disabled={digestLoading}>
                          {digestLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                          Generate {p.label} Digest
                        </Button>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm leading-relaxed text-foreground">{digest.executive_summary}</p>

                        {(() => {
                          const segments = normaliseSegmentBreakdown(digest.segment_breakdown);
                          if (!segments.length) return null;
                          return (
                            <div className="grid gap-3 md:grid-cols-2">
                              {segments.map(({ seg, headline, highlights, implications }) => (
                                <div key={seg} className="rounded-xl border border-border/60 bg-background/50 p-3">
                                  <button type="button" onClick={() => setActiveSegment(seg as MarketSegment)} className="mb-1 rounded text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Filter the feed by ${titleCase(seg)}`}>
                                    {titleCase(seg)}
                                  </button>
                                  {headline && <p className="text-sm leading-relaxed">{headline}</p>}
                                  {highlights.length > 0 && (
                                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                                      {highlights.slice(0, 4).map((h, i) => <li key={i}>{h}</li>)}
                                    </ul>
                                  )}
                                  {implications && <p className="mt-2 text-xs italic text-foreground/80">{implications}</p>}
                                </div>
                              ))}
                            </div>
                          );
                        })()}

                        {digest.client_advisory_implications.length > 0 && (
                          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">Client Advisory Implications</h4>
                            <ul className="list-disc space-y-1 pl-4 text-sm">
                              {digest.client_advisory_implications.map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                          </div>
                        )}

                        {digest.source_urls.length > 0 && (
                          <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
                            <span className="text-xs font-medium text-muted-foreground">Sources:</span>
                            {digest.source_urls.slice(0, 8).map((url, i) => (
                              <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-primary">
                                <ExternalLink className="h-2.5 w-2.5" />Source {i + 1}
                              </a>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        </section>

        {/* Filters: Segment chips + Freshness pills + advanced */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Segments</span>
            <SegmentChip seg="all" active={activeSegment === 'all'} onClick={() => setActiveSegment('all')} />
            {SEGMENTS.map(seg => (
              <SegmentChip key={seg} seg={seg} active={activeSegment === seg} onClick={() => setActiveSegment(seg)} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Freshness</span>
            {FRESHNESS.map(f => {
              const active = activeFreshness === f.id;
              const count = freshnessCounts[f.id as keyof typeof freshnessCounts];
              return (
                <button
                  key={f.id}
                  onClick={() => setActiveFreshness(f.id)}
                  className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground')}
                >
                  <f.icon className="h-3 w-3" />{f.label}
                  <span className={cn('rounded-full px-1.5 py-0 text-[10px]', active ? 'bg-primary-foreground/20' : 'bg-muted')}>{count}</span>
                </button>
              );
            })}
          </div>
          <div className="grid gap-3 rounded-2xl border border-border/60 bg-card/40 p-3 md:grid-cols-3 xl:grid-cols-7">
            <div className="space-y-1 md:col-span-1">
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Title, summary, source…" className="pl-8" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Source</Label>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sources</SelectItem>
                  {feedSources.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {([['category', categories],['geography', geographies],['impact', impacts],['audience', audiences]] as const).map(([key, values]) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{titleCase(key)}</Label>
                <Select value={(filters as any)[key]} onValueChange={(v) => setFilters(f => ({ ...f, [key]: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{(values as readonly string[]).map(v => <SelectItem key={v} value={v}>{label(v)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
            <div className="flex items-end md:col-span-3 xl:col-span-1">
              <Button type="button" variant="outline" className="w-full" onClick={clearFilters} disabled={!hasClearableFilters} aria-label="Clear all search and article filters">
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden />Clear All
              </Button>
            </div>
          </div>
        </section>

        {/* Feed + Sidebar */}
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Tabs value={workspaceTab} onValueChange={(v) => setWorkspaceTab(v as 'updates' | 'ask-ai')} className="min-w-0 space-y-4">
            <TabsList aria-label="Market updates workspace" className="w-full justify-start sm:w-auto">
              <TabsTrigger value="updates">Latest Updates</TabsTrigger>
              <TabsTrigger value="ask-ai">Ask AI</TabsTrigger>
            </TabsList>
            <TabsContent value="updates" className="mt-0 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">
                  {feedScope === 'held'
                    ? <>{heldUpdates.length} {heldUpdates.length === 1 ? 'held item' : 'held items'}<span className="ml-2 text-sm font-normal text-muted-foreground">awaiting a publication decision</span></>
                    : <>{filteredUpdates.length} {filteredUpdates.length === 1 ? 'update' : 'updates'}<span className="ml-2 text-sm font-normal text-muted-foreground">of {updates.length} published</span></>}
                </h2>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Feed scope">
                  <Button size="sm" variant={feedScope === 'published' ? 'default' : 'outline'} className="rounded-full" onClick={() => setFeedScope('published')} aria-pressed={feedScope === 'published'}>
                    Published<Badge variant="secondary" className="ml-2">{updates.length}</Badge>
                  </Button>
                  <Button size="sm" variant={feedScope === 'held' ? 'default' : 'outline'} className="rounded-full" onClick={() => setFeedScope('held')} aria-pressed={feedScope === 'held'} title="Items fetched and classified but not published automatically.">
                    Held<Badge variant="secondary" className="ml-2">{heldUpdates.length}</Badge>
                  </Button>
                </div>
              </div>

              {feedScope === 'held' ? (
                heldUpdates.length ? heldUpdates.map(held => (
                  <article key={held.id} className="min-w-0 rounded-2xl border border-warning/30 bg-card p-5">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-warning">Held</Badge>
                      <span className="min-w-0 break-words text-xs text-muted-foreground" title={held.source_name}>{held.source_name}</span>
                      {held.source_authority && <Badge variant="secondary">{titleCase(held.source_authority)}</Badge>}
                      <span className="text-xs text-muted-foreground">Relevance {held.relevance_score}{typeof held.confidence_score === 'number' ? ` · Confidence ${held.confidence_score}` : ''}</span>
                    </div>
                    <h3 className="mt-2 break-words font-semibold leading-snug">{held.title}</h3>
                    <p className="mt-2 break-words text-sm text-muted-foreground">{held.candidate_reason ? titleCase(held.candidate_reason) : 'Publication criteria were not met.'}</p>
                    {held.ai_summary && <p className="mt-2 break-words text-sm">{held.ai_summary}</p>}
                    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
                      <Button size="sm" onClick={() => void publishHeldUpdate(held)} disabled={publishingId === held.id}>
                        {publishingId === held.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Publish to feed
                      </Button>
                      <a href={held.source_url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-2 rounded-md border border-primary/40 px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/10" title={held.source_url}>
                        <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />Open original source
                      </a>
                    </div>
                  </article>
                )) : (
                  <Card className="border-dashed">
                    <CardContent className="p-10 text-center">
                      <Globe2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
                      <h3 className="text-lg font-semibold">Nothing is being held</h3>
                      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Every classified item from the latest runs met its tier's publication policy and is live in the feed.</p>
                      <div className="mt-4 flex justify-center"><Button size="sm" variant="outline" onClick={() => setFeedScope('published')}>Back to published feed</Button></div>
                    </CardContent>
                  </Card>
                )
              ) : loading ? (

                <div className="space-y-3">
                  {[1,2,3].map(i => <Card key={i} className="animate-pulse"><CardContent className="h-40 p-6" /></Card>)}
                </div>
              ) : feedEmptyState ? (
                <Card className="border-dashed">
                  <CardContent className="p-10 text-center">
                    <Globe2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
                    <h3 className="text-lg font-semibold">{feedEmptyState.title}</h3>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{feedEmptyState.description}</p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {feedEmptyState.kind === 'filters' && <Button size="sm" variant="outline" onClick={clearFilters}>Clear filters</Button>}
                      {['registry','disabled'].includes(feedEmptyState.kind) && <Button size="sm" variant="outline" onClick={() => setSourcesAdminOpen(true)}>Open Sources</Button>}
                      {['candidates','classification','no-published'].includes(feedEmptyState.kind) && <Button size="sm" variant="outline" onClick={reviewCandidates}>Review held items</Button>}
                      {sourceHealth.latestRun && ['classification','no-published'].includes(feedEmptyState.kind) && <Button size="sm" variant="outline" onClick={() => setRunSummary(sourceHealth.latestRun ?? null)}>View latest run</Button>}
                      {feedEmptyState.kind === 'classification' && <Button size="sm" variant="outline" onClick={() => setWorkspaceTab('ask-ai')}>Test AI route</Button>}
                    </div>
                  </CardContent>
                </Card>
              ) : (
                filteredUpdates.map(update => (
                  <article key={update.id} className="group rounded-2xl border border-border/60 bg-card p-5 transition-all hover:border-primary/30 hover:shadow-md">
                    <div className="flex flex-wrap items-center gap-2">
                      <FreshnessBadge tier={update.freshness_tier} />
                      <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', IMPACT_STYLE[update.impact_level])}>
                        {update.impact_level} impact
                      </span>
                      {/* Category is omitted when the segment chips below already carry it,
                          and provenance/legal badges live in the analysis dialog — the card
                          keeps only what a reader scans by. */}
                      {!update.segments.includes(update.category as MarketSegment) && (
                        <Badge variant="outline" className="text-[10px]">{titleCase(update.category)}</Badge>
                      )}
                      {update.geography.slice(0, 2).map(g => <Badge key={g} variant="secondary" className="text-[10px]">{g}</Badge>)}
                    </div>

                    <h3 className="mt-3 text-lg font-semibold leading-snug">
                      <a
                        href={update.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:text-primary"
                      >
                        {update.title}
                        <span className="sr-only"> (opens the original article in a new tab)</span>
                      </a>
                    </h3>
                    {/* The publisher name is the filter: a reader who wants "more like
                        this, from here" should not have to hunt for the source dropdown.
                        The authority tag beside it says what kind of source it is —
                        a regulator and an advocacy body carry very different weight. */}
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => setSourceFilter(update.source_name)}
                        className="rounded font-medium text-foreground/80 underline-offset-2 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Show only updates from ${update.source_name}`}
                      >
                        {update.source_name}
                      </button>
                      {update.source_authority && (
                        <Badge variant="outline" className="h-4 px-1.5 py-0 text-[9px] font-medium uppercase tracking-wide">
                          {titleCase(update.source_authority)}
                        </Badge>
                      )}
                      <span>· {dateLabel(update.source_published_at ?? update.ingested_at)}</span>
                    </p>

                    {update.ai_summary && <p className="mt-3 text-sm leading-relaxed text-foreground/90">{update.ai_summary}</p>}

                    {update.why_it_matters && (
                      <div className="mt-3 rounded-lg border-l-2 border-primary/60 bg-primary/5 py-2 pl-3 pr-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Why it matters</p>
                        <p className="mt-0.5 text-sm text-foreground/90">{update.why_it_matters}</p>
                      </div>
                    )}

                    {/* The classifier already writes a property read for every item; it was
                        only visible inside the dialog, so the feed never answered "what does
                        this mean for property?" without a click. */}
                    {update.property_implications && (
                      <div className="mt-2 rounded-lg border-l-2 border-info/60 bg-info/5 py-2 pl-3 pr-2">
                        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-info">
                          <Building2 className="h-3 w-3" />Property impact
                          <span className="rounded-full border border-info/30 px-1.5 py-0 text-[9px] font-medium normal-case tracking-normal">
                            {update.geography.some(g => g === 'Australia') ? 'Macro · national' : `Local · ${update.geography.slice(0, 2).join(', ') || 'regional'}`}
                          </span>
                        </p>
                        <p className="mt-0.5 text-sm text-foreground/90">{update.property_implications}</p>
                      </div>
                    )}

                    {update.segments.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {update.segments.map(s => (
                          <button key={s} onClick={() => setActiveSegment(s)} className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary">
                            {titleCase(s)}
                          </button>
                        ))}
                      </div>
                    )}
                    {Boolean(update.lending_criteria_tags?.length) && <div className="mt-2 flex flex-wrap gap-1" aria-label="Lending criteria topics">{update.lending_criteria_tags!.slice(0,6).map(tag=><Badge key={tag} variant="secondary" className="text-[10px]">{titleCase(tag)}</Badge>)}</div>}
                    {update.effective_date && <p className="mt-2 text-xs text-muted-foreground">Verified effective date: <strong className="text-foreground">{dateLabel(update.effective_date)}</strong></p>}

                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                      <Button size="sm" onClick={() => setSelectedUpdate(update)}>Open Analysis</Button>
                      <Button size="sm" variant="outline" onClick={() => { setQaUpdate(update); setQaMessage(null); setQaThread([]); setQuestion(''); setDialogConversationId(crypto.randomUUID()); }}>Ask AI</Button>
                      {canEditMarketUpdates && <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-foreground" disabled={hidingId === update.id} onClick={() => archiveUpdate(update)} aria-label={`Archive ${update.title}`}>
                        {hidingId === update.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden />}Archive
                      </Button>}
                      <div className="ml-auto flex flex-wrap items-center gap-1">
                        <a href={update.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3.5 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/20">
                          <ExternalLink className="h-4 w-4" />Open original source
                        </a>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </TabsContent>
            <TabsContent value="ask-ai" className="mt-0 min-h-0">
              {renderAskAIWorkspace()}
            </TabsContent>
          </Tabs>

          {/* Sidebar */}
          <aside className="space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">High Impact Watchlist</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {highImpact.length ? highImpact.map(u => (
                  <button key={u.id} onClick={() => setSelectedUpdate(u)} className="block w-full rounded-lg border border-border/60 bg-background/50 p-2 text-left transition-colors hover:border-primary/40">
                    <div className="mb-1 flex items-center gap-1.5"><FreshnessBadge tier={u.freshness_tier} /></div>
                    <p className="line-clamp-2 text-xs font-medium">{u.title}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">{u.source_name}</p>
                  </button>
                )) : <p className="text-xs text-muted-foreground">No high impact updates yet.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Segment Coverage</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {SEGMENTS.map(seg => {
                  const count = segmentCounts[seg] ?? 0;
                  const pct = updates.length ? (count / updates.length) * 100 : 0;
                  return (
                    <div key={seg}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-foreground/80">{titleCase(seg)}</span>
                        <span className="tabular-nums text-muted-foreground">{count}</span>
                      </div>
                      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary/60" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

          </aside>
        </section>

        <p className="pb-6 text-center text-xs text-muted-foreground">General market intelligence only. Review source material and obtain professional advice before acting.</p>

        {/* Analysis Dialog */}
        <Dialog open={Boolean(selectedUpdate)} onOpenChange={(open) => !open && setSelectedUpdate(null)}>
          {/* Fixed header over a scrolling body: at 6xl the prose ran to ~130 characters
              a line and the implications grid was clipped below the fold with the title
              scrolled out of view. 4xl keeps a readable measure on any screen. */}
          <DialogContent className="flex max-h-[90vh] w-[96vw] max-w-[96vw] flex-col overflow-hidden p-0 sm:max-w-2xl lg:max-w-4xl">
            <DialogHeader className="shrink-0 space-y-2 border-b border-border/60 px-6 pb-4 pt-6 text-left">
              <div className="flex flex-wrap items-center gap-2">
                {selectedUpdate && <FreshnessBadge tier={selectedUpdate.freshness_tier} />}
                {selectedUpdate && <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase', IMPACT_STYLE[selectedUpdate.impact_level])}>{selectedUpdate.impact_level} impact</span>}
              </div>
              <DialogTitle className="pr-8 text-xl leading-snug lg:text-2xl">{selectedUpdate?.title}</DialogTitle>
              <p className="text-sm text-muted-foreground">{selectedUpdate?.source_name} · {dateLabel(selectedUpdate?.source_published_at)}</p>
              {selectedUpdate && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {selectedUpdate.segments.map(s => (
                    <button key={s} type="button" onClick={() => { setActiveSegment(s); setSelectedUpdate(null); }} className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {titleCase(s)}
                    </button>
                  ))}
                  {selectedUpdate.source_authority && <Badge variant="outline" className="text-[10px]">{titleCase(selectedUpdate.source_authority)}</Badge>}
                  {selectedUpdate.source_perspective && <Badge variant="secondary" className="text-[10px]">{titleCase(selectedUpdate.source_perspective)}</Badge>}
                  {selectedUpdate.legal_status && selectedUpdate.legal_status !== 'not_applicable' && <Badge variant="outline" className="text-[10px]">{titleCase(selectedUpdate.legal_status)}</Badge>}
                </div>
              )}
            </DialogHeader>
            {selectedUpdate && (
              <div className="flex-1 space-y-5 overflow-y-auto px-6 pb-6 pt-5 text-base leading-relaxed">
                {selectedUpdate.ai_summary && <div><h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">AI Summary</h4><p className="mt-1.5">{selectedUpdate.ai_summary}</p></div>}
                {selectedUpdate.key_points.length > 0 && <div><h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Key Points</h4><ul className="mt-1.5 list-disc space-y-1.5 pl-5">{selectedUpdate.key_points.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
                {selectedUpdate.why_it_matters && <div className="rounded-lg border-l-2 border-primary/60 bg-primary/5 py-3 pl-4 pr-3"><h4 className="text-sm font-semibold uppercase tracking-wide text-primary">Why it matters</h4><p className="mt-1.5">{selectedUpdate.why_it_matters}</p></div>}
                <div className="grid gap-4 md:grid-cols-3">
                  {selectedUpdate.property_implications && <div className="rounded-lg border border-border/60 p-4"><h4 className="text-sm font-semibold uppercase text-info">Property</h4><p className="mt-1.5 text-sm">{selectedUpdate.property_implications}</p></div>}
                  {selectedUpdate.finance_implications && <div className="rounded-lg border border-border/60 p-4"><h4 className="text-sm font-semibold uppercase text-primary">Finance</h4><p className="mt-1.5 text-sm">{selectedUpdate.finance_implications}</p></div>}
                  {selectedUpdate.policy_implications && <div className="rounded-lg border border-border/60 p-4"><h4 className="text-sm font-semibold uppercase text-success">Policy</h4><p className="mt-1.5 text-sm">{selectedUpdate.policy_implications}</p></div>}
                </div>
                {selectedUpdate.risk_flags.length > 0 && <div><h4 className="text-sm font-semibold uppercase tracking-wide text-destructive">Risk Flags</h4><div className="mt-1.5 flex flex-wrap gap-1.5">{selectedUpdate.risk_flags.map(r => <Badge key={r} variant="outline" className="border-destructive/30 text-destructive">{r}</Badge>)}</div></div>}
                <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
                  <a href={selectedUpdate.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"><ExternalLink className="h-4 w-4" />Open original source</a>
                  {canEditMarketUpdates && <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-foreground" disabled={hidingId === selectedUpdate.id} onClick={() => { const target = selectedUpdate; setSelectedUpdate(null); archiveUpdate(target); }} aria-label={`Archive ${selectedUpdate.title}`}>
                    {hidingId === selectedUpdate.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden />}Archive update
                  </Button>}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Q&A Dialog */}
        <Dialog open={Boolean(qaUpdate)} onOpenChange={(open) => { if (!open) { cancelAsk(); setQaUpdate(null); setQaMessage(null); setQaThread([]); setDialogConversationId(crypto.randomUUID()); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ask AI about this update</DialogTitle>
              <p className="text-xs text-muted-foreground">{qaUpdate?.title}</p>
            </DialogHeader>
            <div className="space-y-3">
              {qaThread.length > 0 && (
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-background/40 p-2">
                  {qaThread.map((turn, i) => (
                    <div key={i} className={cn('rounded-md p-2 text-sm', turn.role === 'user' ? 'bg-primary/10' : 'bg-background/70 border border-border/60')}>
                      <div className="mb-0.5 flex flex-wrap items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground">
                        <span>{turn.role === 'user' ? 'You' : 'AI'}</span>
                        {turn.role === 'assistant' && turn.sentiment && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{turn.sentiment}</Badge>}
                        {turn.role === 'assistant' && turn.time_horizon && turn.time_horizon !== 'unclear' && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{turn.time_horizon.replace('_',' ')}</Badge>}
                      </div>
                      <p className="whitespace-pre-wrap">{turn.content}</p>
                      {turn.key_figures && turn.key_figures.length > 0 && (
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {turn.key_figures.map((k, j) => (
                            <div key={j} className="rounded border border-border/60 bg-background/50 px-2 py-1">
                              <div className="text-[9px] uppercase text-muted-foreground">{k.label}</div>
                              <div className="text-sm font-semibold text-primary">{k.value}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {turn.citations && turn.citations.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {turn.citations.map((url, j) => (
                            <a key={url + j} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"><ExternalLink className="h-4 w-4" />Open original source</a>
                          ))}
                        </div>
                      )}
                      {turn.follow_up_questions && turn.follow_up_questions.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {turn.follow_up_questions.map((fq, j) => (
                            <button key={j} type="button" onClick={() => handleFollowUp(fq)} disabled={asking} className="rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-50">↳ {fq}</button>
                          ))}
                        </div>
                      )}
                      {turn.limitations && turn.limitations.length > 0 && <ul className="mt-2 list-disc pl-4 text-[10px] text-muted-foreground">{turn.limitations.map((l, j) => <li key={j}>{l}</li>)}</ul>}
                      {turn.role === 'assistant' && !turn.streaming && (
                        <MarketQAAnswerActions content={turn.content} retrieved={turn.retrieved} questionId={turn.question_id} questionText={qaThread[i-1]?.role === "user" ? qaThread[i-1].content : undefined} />
                      )}
                    </div>
                  ))}
                  {asking && <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background/70 p-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Thinking…</div>}
                </div>
              )}
              <Textarea value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={handleQuestionKeyDown} placeholder="Ask a source-grounded question…" className="min-h-[100px]" />
              <div className="flex gap-2">
                <MarketQAVoiceButton onTranscript={(t) => setQuestion((q) => (q ? `${q.trim()} ${t}` : t))} disabled={asking} />
                <Button onClick={() => handleAsk()} className="flex-1" disabled={asking || !question.trim()}>
                  {asking ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Asking…</> : <><Sparkles className="mr-2 h-4 w-4" />Ask safely</>}
                </Button>
                {asking && <Button variant="outline" onClick={cancelAsk}><XCircle className="mr-2 h-4 w-4" />Cancel</Button>}
              </div>
            </div>
          </DialogContent>
        </Dialog>
        {/* The candidate-review modal was retired: held items are now managed
            inline through the Held scope chip on the feed itself. */}


        <MarketSourcesAdminDialog open={sourcesAdminOpen} onOpenChange={setSourcesAdminOpen} onChanged={loadUpdates} />
      </div>
    </main>
  );
}
