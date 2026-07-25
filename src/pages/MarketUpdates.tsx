import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Activity, AlertTriangle, BarChart3, Building2, ExternalLink, FileText, Globe2, Loader2, Newspaper, RefreshCw, Search, Settings, ShieldCheck, Sparkles, TrendingUp, Zap, Clock, Radio } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
import { answerMarketUpdateQuestion, fetchLatestMarketDigest, fetchMarketSourceHealth, fetchMarketSources, fetchMarketUpdates, generateMarketDigest, streamMarketUpdateQuestion, triggerMarketIngestion, ensureMarketUpdatesFresh } from '@/services/marketUpdatesService';
import type { MarketAudienceTag, MarketDigest24h, MarketDigestPeriod, MarketFreshnessTier, MarketGeography, MarketImpactLevel, MarketQAMessage, MarketSegment, MarketSource, MarketSourceHealth, MarketUpdate, MarketUpdateCategory } from '@/types/marketUpdates';
import { MarketSourcesAdminDialog } from '@/components/market-updates/MarketSourcesAdminDialog';
import { MarketQAVoiceButton } from '@/components/market-updates/MarketQAVoiceButton';
import { MarketQAAnswerActions } from '@/components/market-updates/MarketQAAnswerActions';
import type { MarketQARetrievedItem } from '@/types/marketUpdates';
import { LiveModelBadge } from '@/components/agentModels';

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

function ConfidenceBar({ score }: { score?: number | null }) {
  const n = Math.round(score ?? 0);
  const color = n >= 80 ? 'bg-success' : n >= 55 ? 'bg-primary' : 'bg-muted-foreground/50';
  return (
    <div className="flex items-center gap-2" title={`AI confidence ${n}%`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><div className={cn('h-full', color)} style={{ width: `${Math.min(100, Math.max(0, n))}%` }} /></div>
      <span className="text-[10px] font-medium text-muted-foreground">{n}%</span>
    </div>
  );
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
  const [updates, setUpdates] = useState<MarketUpdate[]>([]);
  const [sources, setSources] = useState<MarketSource[]>([]);
  const [sourceHealth, setSourceHealth] = useState<MarketSourceHealth>({ totalSources:0, enabledSources:0, healthySources:0, degradedSources:0, failedSources:0 });
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [digestLoading, setDigestLoading] = useState(false);
  const [period, setPeriod] = useState<MarketDigestPeriod>('24h');
  const [digest, setDigest] = useState<MarketDigest24h | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedUpdate, setSelectedUpdate] = useState<MarketUpdate | null>(null);
  const [qaUpdate, setQaUpdate] = useState<MarketUpdate | null>(null);
  const [question, setQuestion] = useState('');
  const [qaMessage, setQaMessage] = useState<MarketQAMessage | null>(null);
  const [qaThread, setQaThread] = useState<Array<{ role: 'user' | 'assistant'; content: string; citations?: string[]; limitations?: string[]; follow_up_questions?: string[]; key_figures?: Array<{ label: string; value: string; source_id?: string }>; time_horizon?: string; sentiment?: string; confidence_score?: number | null; streaming?: boolean; retrieved?: MarketQARetrievedItem[]; question_id?: string | null }>>([]);
  const [asking, setAsking] = useState(false);
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const [dialogConversationId, setDialogConversationId] = useState<string>(() => crypto.randomUUID());
  const [search, setSearch] = useState('');
  const [activeSegment, setActiveSegment] = useState<MarketSegment | 'all'>('all');
  const [activeFreshness, setActiveFreshness] = useState<MarketFreshnessTier | 'all'>('all');
  const [filters, setFilters] = useState({ category: 'all', geography: 'all', impact: 'all', audience: 'all' });
  const [sourcesAdminOpen, setSourcesAdminOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<'updates' | 'ask-ai'>('updates');

  const loadUpdates = async () => {
    setLoading(true);
    const [u, s, h] = await Promise.all([fetchMarketUpdates({ limit: 200 }), fetchMarketSources(), fetchMarketSourceHealth()]);
    setUpdates(u); setSources(s); setSourceHealth(h);
    setLoading(false);
  };
  const loadDigest = async (p: MarketDigestPeriod) => { setDigest(await fetchLatestMarketDigest(p)); };

  useEffect(() => {
    let cancelled=false;
    const start=async()=>{ setLoading(true); const [u,src,h]=await Promise.all([fetchMarketUpdates({limit:200}),fetchMarketSources(),fetchMarketSourceHealth()]); if(cancelled)return; setUpdates(u);setSources(src);setSourceHealth(h);setLoading(false); const result=await ensureMarketUpdatesFresh(h,u.length); if(!cancelled&&result){setMessage(result.active?'Checking for newer market intelligence…':`Market intelligence refreshed: ${result.ingested} items reviewed, ${result.published} new updates published.`);await loadUpdates();}}; void start(); return()=>{cancelled=true};
  }, []);
  useEffect(() => { void loadDigest(period); }, [period]);

  const filteredUpdates = useMemo(() => updates.filter((u) => {
    if (filters.category !== 'all' && u.category !== filters.category) return false;
    if (filters.geography !== 'all' && !u.geography.includes(filters.geography as MarketGeography)) return false;
    if (filters.impact !== 'all' && u.impact_level !== filters.impact) return false;
    if (filters.audience !== 'all' && !u.audience_tags.includes(filters.audience as MarketAudienceTag)) return false;
    if (activeSegment !== 'all' && !u.segments.includes(activeSegment)) return false;
    if (activeFreshness !== 'all' && u.freshness_tier !== activeFreshness) return false;
    if (search && !`${u.title} ${u.ai_summary ?? ''} ${u.source_name}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [updates, filters, activeSegment, activeFreshness, search]);

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

  const handleGenerateDigest = async () => {
    setDigestLoading(true);
    const result = await generateMarketDigest(period);
    setMessage(result.message || null);
    setDigest(result.digest);
    setDigestLoading(false);
  };

  const handleIngest = async () => {
    setIngesting(true);
    const summary = await triggerMarketIngestion({ force: true, trigger_type: 'manual' });
    setMessage(summary.message ?? `Ingested ${summary.ingested} · Published ${summary.published} · Candidates ${summary.candidates}`);
    await loadUpdates();
    setIngesting(false);
  };

  const handleAsk = async (overrideQuestion?: string) => {
    const q = (overrideQuestion ?? question).trim();
    if (!q || asking) return;
    setAsking(true);
    const priorHistory = qaThread.map((t) => ({ role: t.role, content: t.content }));
    const inDialog = Boolean(qaUpdate);
    const convId = inDialog ? dialogConversationId : conversationId;
    setQaThread((t) => [...t, { role: 'user', content: q }, { role: 'assistant', content: '', streaming: true }]);
    setQuestion('');
    try {
      const seg = activeSegment !== 'all' ? activeSegment : undefined;
      const answer = await streamMarketUpdateQuestion(q, {
        updateIds: qaUpdate ? [qaUpdate.id] : undefined,
        history: priorHistory,
        segment: seg,
        conversation_id: convId,
        onDelta: (acc) => {
          setQaThread((t) => {
            const next = [...t];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: acc };
            return next;
          });
        },
      });
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
          confidence_score: answer?.confidence_score,
          retrieved: answer?.retrieved ?? [],
          question_id: answer?.question_id ?? null,
          streaming: false,
        };
        return next;
      });
    } catch (err) {
      setQaThread((t) => {
        const next = [...t];
        next[next.length - 1] = { role: 'assistant', content: err instanceof Error ? err.message : 'Failed to get an answer. Please try again.', streaming: false };
        return next;
      });
    } finally {
      setAsking(false);
    }
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
            <p className="mt-2 text-sm text-muted-foreground">Source-grounded, streaming answers from published market updates. Threaded — follow-ups keep prior context.</p>
          </div>
          {qaThread.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => { setQaThread([]); setQaMessage(null); setConversationId(crypto.randomUUID()); }}>New thread</Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
        <div aria-label="Ask AI conversation" className="min-h-[320px] flex-1 space-y-3 overflow-y-auto overflow-x-hidden rounded-xl border border-border/60 bg-background/40 p-3">
          {qaThread.length === 0 ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
              <Sparkles className="mb-3 h-8 w-8 text-primary/70" />
              <h3 className="text-base font-semibold">Ask a source-grounded market question</h3>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">Answers use published market updates and may refuse if there are no grounded sources available.</p>
              {!updates.length && <p className="mt-2 text-xs text-muted-foreground">No published updates loaded yet — the AI may refuse if it has no grounded sources.</p>}
            </div>
          ) : qaThread.map((turn, i) => (
            <div key={i} className={cn('rounded-lg p-3 text-sm leading-relaxed', turn.role === 'user' ? 'bg-primary/10 text-foreground' : 'border border-border/60 bg-background/70')}>
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
                <span>{turn.role === 'user' ? 'You' : 'AI'}</span>
                {turn.role === 'assistant' && turn.sentiment && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{turn.sentiment}</Badge>}
                {turn.role === 'assistant' && turn.time_horizon && turn.time_horizon !== 'unclear' && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{turn.time_horizon.replace('_',' ')}</Badge>}
                {turn.role === 'assistant' && typeof turn.confidence_score === 'number' && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{Math.round(turn.confidence_score)}% conf</Badge>}
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
                    <a key={url + j} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs hover:border-primary/40 hover:text-primary"><ExternalLink className="h-3 w-3" />Cite {j + 1}</a>
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
                <Badge className="bg-primary/15 text-primary hover:bg-primary/20">AI Market Intelligence</Badge>
                <Badge variant="outline">Australia · RBA · APRA · Treasury</Badge>
                <LiveModelBadge agentKey="market_qa" size="sm" showSlot={false} />
                <LiveModelBadge agentKey="market_digest" size="sm" showSlot={false} />
              </div>
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Market Updates</h1>
              <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
                Australian property, lending, economic and regulatory intelligence
              </p>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Last ingest: {dateLabel(sourceHealth.lastSuccessAt)}</Badge>
                <Badge variant="outline">{sourceHealth.enabledSources}/{sourceHealth.totalSources} sources live</Badge>
                {sourceHealth.failedSources > 0 && <Badge variant="outline" className="text-destructive"><AlertTriangle className="mr-1 h-3 w-3" />{sourceHealth.failedSources} failing</Badge>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={loadUpdates} variant="outline"><RefreshCw className="mr-2 h-4 w-4" />Refresh View</Button>
              <Button onClick={handleIngest} disabled={ingesting} variant="outline">{ingesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radio className="mr-2 h-4 w-4" />}Sync Latest News</Button>
              <Button onClick={handleGenerateDigest} disabled={digestLoading}>{digestLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Generate {PERIODS.find(p => p.id === period)?.label} Digest</Button>
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

        <button type="button" onClick={() => setSourcesAdminOpen(true)} className="grid w-full grid-cols-2 gap-3 rounded-xl border border-border/60 bg-card p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-4 lg:grid-cols-7" aria-label="Open market source health administration">
          {[
            ['Configured', sourceHealth.totalSources], ['Enabled', sourceHealth.enabledSources], ['Healthy', sourceHealth.healthySources], ['Degraded', sourceHealth.degradedSources], ['Failed', sourceHealth.failedSources],
            ['Last successful run', dateLabel(sourceHealth.lastSuccessAt)], ['Latest duration', sourceHealth.latestRun?.duration_ms ? `${Math.round(sourceHealth.latestRun.duration_ms / 1000)}s` : 'Not available'],
          ].map(([name,value]) => <span key={String(name)} className="min-w-0"><span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{name}</span><strong className="mt-1 block truncate text-sm">{value}</strong></span>)}
        </button>

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
                      {digest && <div className="flex items-center gap-3"><ConfidenceBar score={digest.confidence_score} /><span className="text-xs text-muted-foreground">Generated {dateLabel(digest.generated_at)}</span></div>}
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

                        {Object.keys(digest.segment_breakdown ?? {}).length > 0 && (
                          <div className="grid gap-3 md:grid-cols-2">
                            {Object.entries(digest.segment_breakdown).map(([seg, data]) => (
                              <div key={seg} className="rounded-xl border border-border/60 bg-background/50 p-3">
                                <div className="mb-1 flex items-center justify-between">
                                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titleCase(seg)}</h4>
                                </div>
                                {data.headline && <p className="text-sm font-medium">{data.headline}</p>}
                                {Array.isArray(data.highlights) && data.highlights.length > 0 && (
                                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                                    {data.highlights.slice(0, 4).map((h, i) => <li key={i}>{h}</li>)}
                                  </ul>
                                )}
                                {data.implications && <p className="mt-2 text-xs italic text-foreground/80">{data.implications}</p>}
                              </div>
                            ))}
                          </div>
                        )}

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
          <div className="grid gap-3 rounded-2xl border border-border/60 bg-card/40 p-3 md:grid-cols-5">
            <div className="space-y-1 md:col-span-1">
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Title, summary, source…" className="pl-8" />
              </div>
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
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  {filteredUpdates.length} {filteredUpdates.length === 1 ? 'update' : 'updates'}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">of {updates.length} published</span>
                </h2>
              </div>

              {loading ? (
                <div className="space-y-3">
                  {[1,2,3].map(i => <Card key={i} className="animate-pulse"><CardContent className="h-40 p-6" /></Card>)}
                </div>
              ) : filteredUpdates.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="p-10 text-center">
                    <Globe2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
                    <h3 className="text-lg font-semibold">Filters exclude available updates</h3>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Filters are hiding available updates. Clear all filters to restore the complete published feed.</p>
                    <div className="mt-4 flex justify-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setActiveSegment('all'); setActiveFreshness('all'); setSearch(''); setFilters({ category:'all', geography:'all', impact:'all', audience:'all' }); }}>Clear filters</Button>
                      <Button size="sm" onClick={handleIngest} disabled={ingesting}>{ingesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radio className="mr-2 h-4 w-4" />}Sync Latest News</Button>
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
                      <Badge variant="outline" className="text-[10px]">{titleCase(update.category)}</Badge>
                      {update.source_authority && <Badge variant="outline" className="text-[10px]">{titleCase(update.source_authority)}</Badge>}
                      {update.source_perspective && <Badge variant="secondary" className="text-[10px]">{titleCase(update.source_perspective)}</Badge>}
                      {update.legal_status && update.legal_status !== 'not_applicable' && <Badge variant="outline" className="text-[10px]">{titleCase(update.legal_status)}</Badge>}
                      {update.geography.slice(0, 3).map(g => <Badge key={g} variant="secondary" className="text-[10px]">{g}</Badge>)}
                      <div className="ml-auto"><ConfidenceBar score={update.confidence_score} /></div>
                    </div>

                    <h3 className="mt-3 text-lg font-semibold leading-snug text-foreground group-hover:text-primary">{update.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/80">{update.source_name}</span> · {dateLabel(update.source_published_at ?? update.ingested_at)}
                    </p>

                    {update.ai_summary && <p className="mt-3 text-sm leading-relaxed text-foreground/90">{update.ai_summary}</p>}

                    {update.why_it_matters && (
                      <div className="mt-3 rounded-lg border-l-2 border-primary/60 bg-primary/5 py-2 pl-3 pr-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary">Why it matters</p>
                        <p className="mt-0.5 text-sm text-foreground/90">{update.why_it_matters}</p>
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
                      <div className="ml-auto flex flex-wrap items-center gap-1">
                        {update.citation_urls.slice(0, 3).map((url, i) => (
                          <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary/40 hover:text-primary">
                            <ExternalLink className="h-2.5 w-2.5" />Cite {i + 1}
                          </a>
                        ))}
                        <a href={update.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20">
                          <ExternalLink className="h-2.5 w-2.5" />Open original source
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

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Source Health</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-border/60 bg-background/50 p-2"><div className="text-lg font-semibold">{sourceHealth.totalSources}</div><p className="text-[10px] text-muted-foreground">Total</p></div>
                  <div className="rounded-lg border border-success/30 bg-success/10 p-2"><div className="text-lg font-semibold text-success">{sourceHealth.enabledSources}</div><p className="text-[10px] text-muted-foreground">Enabled</p></div>
                  <div className={cn('rounded-lg border p-2', sourceHealth.failedSources > 0 ? 'border-destructive/30 bg-destructive/10' : 'border-border/60 bg-background/50')}>
                    <div className={cn('text-lg font-semibold', sourceHealth.failedSources > 0 && 'text-destructive')}>{sourceHealth.failedSources}</div>
                    <p className="text-[10px] text-muted-foreground">Failed</p>
                  </div>
                </div>
                <p className="text-muted-foreground">Last success: {dateLabel(sourceHealth.lastSuccessAt)}</p>
                {sourceHealth.lastError && <p className="text-destructive"><AlertTriangle className="mr-1 inline h-3 w-3" />{sourceHealth.lastError}</p>}
              </CardContent>
            </Card>
          </aside>
        </section>

        <p className="pb-6 text-center text-xs text-muted-foreground">General market intelligence only. Review source material and obtain professional advice before acting.</p>

        {/* Analysis Dialog */}
        <Dialog open={Boolean(selectedUpdate)} onOpenChange={(open) => !open && setSelectedUpdate(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                {selectedUpdate && <FreshnessBadge tier={selectedUpdate.freshness_tier} />}
                {selectedUpdate && <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase', IMPACT_STYLE[selectedUpdate.impact_level])}>{selectedUpdate.impact_level} impact</span>}
                {selectedUpdate && <ConfidenceBar score={selectedUpdate.confidence_score} />}
              </div>
              <DialogTitle className="text-xl leading-snug">{selectedUpdate?.title}</DialogTitle>
              <p className="text-xs text-muted-foreground">{selectedUpdate?.source_name} · {dateLabel(selectedUpdate?.source_published_at)}</p>
            </DialogHeader>
            {selectedUpdate && (
              <div className="space-y-4 text-sm">
                {selectedUpdate.ai_summary && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Summary</h4><p className="mt-1">{selectedUpdate.ai_summary}</p></div>}
                {selectedUpdate.key_points.length > 0 && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key Points</h4><ul className="mt-1 list-disc space-y-1 pl-5">{selectedUpdate.key_points.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
                {selectedUpdate.why_it_matters && <div className="rounded-lg border-l-2 border-primary/60 bg-primary/5 py-2 pl-3"><h4 className="text-xs font-semibold uppercase tracking-wide text-primary">Why it matters</h4><p className="mt-1">{selectedUpdate.why_it_matters}</p></div>}
                <div className="grid gap-3 md:grid-cols-3">
                  {selectedUpdate.property_implications && <div className="rounded-lg border border-border/60 p-3"><h4 className="text-xs font-semibold uppercase text-info">Property</h4><p className="mt-1 text-xs">{selectedUpdate.property_implications}</p></div>}
                  {selectedUpdate.finance_implications && <div className="rounded-lg border border-border/60 p-3"><h4 className="text-xs font-semibold uppercase text-primary">Finance</h4><p className="mt-1 text-xs">{selectedUpdate.finance_implications}</p></div>}
                  {selectedUpdate.policy_implications && <div className="rounded-lg border border-border/60 p-3"><h4 className="text-xs font-semibold uppercase text-success">Policy</h4><p className="mt-1 text-xs">{selectedUpdate.policy_implications}</p></div>}
                </div>
                {selectedUpdate.risk_flags.length > 0 && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-destructive">Risk Flags</h4><div className="mt-1 flex flex-wrap gap-1">{selectedUpdate.risk_flags.map(r => <Badge key={r} variant="outline" className="border-destructive/30 text-destructive">{r}</Badge>)}</div></div>}
                <div className="flex flex-wrap gap-2 border-t border-border/60 pt-3">
                  <a href={selectedUpdate.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20"><ExternalLink className="h-3 w-3" />Original source</a>
                  {selectedUpdate.citation_urls.map((url, i) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary/40 hover:text-primary"><ExternalLink className="h-3 w-3" />Citation {i + 1}</a>
                  ))}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Q&A Dialog */}
        <Dialog open={Boolean(qaUpdate)} onOpenChange={(open) => { if (!open) { setQaUpdate(null); setQaMessage(null); setQaThread([]); setDialogConversationId(crypto.randomUUID()); } }}>
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
                        {turn.role === 'assistant' && typeof turn.confidence_score === 'number' && <Badge variant="outline" className="h-4 px-1 py-0 text-[9px]">{Math.round(turn.confidence_score)}% conf</Badge>}
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
                            <a key={url + j} href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs hover:border-primary/40 hover:text-primary"><ExternalLink className="h-3 w-3" />Cite {j + 1}</a>
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
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <MarketSourcesAdminDialog open={sourcesAdminOpen} onOpenChange={setSourcesAdminOpen} onChanged={loadUpdates} />
      </div>
    </main>
  );
}
