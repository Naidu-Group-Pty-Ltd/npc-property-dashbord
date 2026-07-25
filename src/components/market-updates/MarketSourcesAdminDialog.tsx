import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Loader2, Play, RefreshCw, Settings2, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  clearMarketSourceError,
  fetchMarketSourceAdminSnapshot,
  toggleMarketSource,
  updateMarketSourceConfig,
  triggerMarketIngestion,
  type MarketSourceAlert,
} from '@/services/marketUpdatesService';
import type { MarketSource } from '@/types/marketUpdates';

const SEV_STYLE: Record<MarketSourceAlert['severity'], string> = {
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
  warning: 'border-warning/40 bg-warning/10 text-[hsl(var(--warning))]',
  info: 'border-info/40 bg-info/10 text-[hsl(var(--info))]',
};

const dateLabel = (v?: string | null) =>
  v ? new Date(v).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';

export function MarketSourcesAdminDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void;
}) {
  const [sources, setSources] = useState<MarketSource[]>([]);
  const [alerts, setAlerts] = useState<MarketSourceAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [freqDraft, setFreqDraft] = useState<Record<string, number>>({});

  const load = async () => {
    setLoading(true);
    const snap = await fetchMarketSourceAdminSnapshot();
    setSources(snap.sources);
    setAlerts(snap.alerts);
    setLoading(false);
  };

  useEffect(() => { if (open) void load(); }, [open]);

  const onToggle = async (s: MarketSource, next: boolean) => {
    setBusyId(s.id);
    const updated = await toggleMarketSource(s.id, next);
    if (updated) setSources((prev) => prev.map((p) => (p.id === s.id ? updated : p)));
    setBusyId(null);
    onChanged?.();
  };

  const onSaveFreq = async (s: MarketSource) => {
    const val = freqDraft[s.id];
    if (!val || val === s.refresh_frequency_hours) return;
    setBusyId(s.id);
    const updated = await updateMarketSourceConfig(s.id, { refresh_frequency_hours: val });
    if (updated) setSources((prev) => prev.map((p) => (p.id === s.id ? updated : p)));
    setBusyId(null);
    onChanged?.();
  };

  const onClearError = async (s: MarketSource) => {
    setBusyId(s.id);
    const updated = await clearMarketSourceError(s.id);
    if (updated) setSources((prev) => prev.map((p) => (p.id === s.id ? updated : p)));
    setAlerts((prev) => prev.filter((a) => a.source_id !== s.id));
    setBusyId(null);
    onChanged?.();
  };

  const runSource = async (s: MarketSource, test = false) => {
    setBusyId(s.id);
    await triggerMarketIngestion({ force: true, trigger_type: 'manual', sourceIds: [s.id], test });
    await load(); setBusyId(null); onChanged?.();
  };

  const copyFeedUrl = async () => {
    await navigator.clipboard.writeText(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/market-updates-feed`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary" />
            Market Sources — Health & Admin
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Admin-gated. Enable/disable feeds, tune refresh cadence, and clear ingestion errors. Changes take effect on the next scheduled ingest.
          </p>
        </DialogHeader>

        <div className="flex items-center justify-between border-b border-border/60 pb-2">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{sources.filter((s) => s.enabled).length}/{sources.length} enabled</Badge>
            {alerts.length > 0 ? (
              <Badge variant="outline" className="text-destructive">
                <AlertTriangle className="mr-1 h-3 w-3" />{alerts.length} alert{alerts.length === 1 ? '' : 's'}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-success">
                <CheckCircle2 className="mr-1 h-3 w-3" />All healthy
              </Badge>
            )}
          </div>
          <div className="flex gap-2"><Button size="sm" variant="outline" onClick={copyFeedUrl}><Copy className="mr-2 h-3.5 w-3.5" />Copy Unified RSS URL</Button><Button size="sm" variant="outline" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
            Refresh
          </Button></div>
        </div>

        {alerts.length > 0 && (
          <div className="space-y-2 border-b border-border/60 pb-3">
            {alerts.map((a) => (
              <div key={a.source_id} className={cn('flex items-start justify-between gap-3 rounded-lg border p-2 text-xs', SEV_STYLE[a.severity])}>
                <div>
                  <p className="font-semibold">{a.name}</p>
                  <p className="opacity-90">{a.message}</p>
                </div>
                <Badge variant="outline" className="uppercase">{a.severity}</Badge>
              </div>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-2 pt-2">
          {loading && sources.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading sources…
            </div>
          ) : sources.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              You must be an admin or superadmin to manage market sources.
            </div>
          ) : (
            sources.map((s) => {
              const hasError = Boolean(s.last_error);
              return (
                <div key={s.id} className={cn('rounded-lg border border-border/60 bg-card p-3', hasError && 'border-destructive/40')}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold truncate">{s.name}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">{s.source_type}</Badge>
                        <Badge variant="outline" className="text-[10px] uppercase">{s.reliability_tier}</Badge>
                        <Badge variant="outline" className="text-[10px]">{s.geography}</Badge>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground truncate">{s.url}</p>
                      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                        <span>Last success: <strong className="text-foreground">{dateLabel(s.last_success_at)}</strong></span>
                        <span>Last fetch: <strong className="text-foreground">{dateLabel(s.last_fetched_at)}</strong></span>
                        <span>Health: <strong className="text-foreground">{s.enabled ? s.health_status ?? 'degraded' : 'disabled'}</strong></span>
                        <span>HTTP: <strong className="text-foreground">{s.last_http_status ?? '—'}</strong></span>
                        <span>Latency: <strong className="text-foreground">{s.last_latency_ms ? `${s.last_latency_ms} ms` : '—'}</strong></span>
                        <span>Items: <strong className="text-foreground">{s.last_items_discovered ?? 0} found / {s.last_items_published ?? 0} published</strong></span>
                        <span>Failures: <strong className="text-foreground">{s.consecutive_failures ?? 0}</strong></span>
                      </div>
                      {hasError && (
                        <div className="mt-2 flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
                          <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="break-words">{s.last_error}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <Button size="sm" variant="outline" onClick={() => runSource(s, true)} disabled={busyId === s.id}>Test</Button>
                      <Button size="sm" variant="outline" onClick={() => runSource(s)} disabled={busyId === s.id}><Play className="mr-1 h-3 w-3" />Run</Button>
                      <div className="flex flex-col items-end gap-1">
                        <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Refresh (h)</Label>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={1}
                            max={168}
                            defaultValue={s.refresh_frequency_hours}
                            className="h-8 w-20"
                            onChange={(e) => setFreqDraft((d) => ({ ...d, [s.id]: Number(e.target.value) }))}
                          />
                          <Button size="sm" variant="ghost" disabled={busyId === s.id || !freqDraft[s.id] || freqDraft[s.id] === s.refresh_frequency_hours} onClick={() => onSaveFreq(s)}>
                            Save
                          </Button>
                        </div>
                      </div>
                      {hasError && (
                        <Button size="sm" variant="outline" onClick={() => onClearError(s)} disabled={busyId === s.id}>
                          Clear error
                        </Button>
                      )}
                      <div className="flex flex-col items-center gap-1">
                        <Switch checked={s.enabled} onCheckedChange={(v) => onToggle(s, v)} disabled={busyId === s.id} />
                        <span className="text-[10px] text-muted-foreground">{s.enabled ? 'On' : 'Off'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
