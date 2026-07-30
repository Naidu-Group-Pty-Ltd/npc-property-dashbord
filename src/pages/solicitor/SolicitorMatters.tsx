import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Briefcase, CalendarClock, Loader2, RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { invokeSolicitorFunction } from '@/lib/solicitorPortal';
import { SolicitorPortalShell } from '@/components/solicitor-portal/SolicitorPortalShell';
import {
  MATTER_STATUS_CLASSES, MATTER_STATUS_LABELS, MATTER_STATUS_ORDER, MATTER_TYPE_LABELS,
  countdownLabel, formatMatterDate, formatPropertyAddress,
  type LegalMatter, type LegalMatterStatus,
} from '@/lib/legalMatters';

interface MatterStats {
  total: number;
  by_status: Record<string, number>;
  settling_30d: number;
  at_risk: number;
}

export default function SolicitorMatters() {
  const [matters, setMatters] = useState<LegalMatter[]>([]);
  const [stats, setStats] = useState<MatterStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setRefreshing(true);
    const [list, stat] = await Promise.all([
      invokeSolicitorFunction('solicitor-portal-matters', { operation: 'list_matters' }),
      invokeSolicitorFunction('solicitor-portal-matters', { operation: 'matter_stats' }),
    ]);
    if (list.error) {
      toast.error(list.error.message || 'Could not load matters');
    } else {
      setMatters((list.data?.records || []) as LegalMatter[]);
    }
    if (!stat.error) setStats((stat.data?.stats as MatterStats) ?? null);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return matters.filter((m) => {
      if (statusFilter !== 'all' && m.status !== statusFilter) return false;
      if (!q) return true;
      return [m.title, m.matter_reference, m.property_address, m.property_suburb, m.client_name]
        .some((v) => v && String(v).toLowerCase().includes(q));
    });
  }, [matters, search, statusFilter]);

  const summaryTiles = [
    { label: 'Open matters', value: stats?.total ?? matters.length, icon: Briefcase },
    { label: 'Settling in 30 days', value: stats?.settling_30d ?? 0, icon: CalendarClock },
    { label: 'Flagged at risk', value: stats?.at_risk ?? 0, icon: AlertTriangle },
  ];

  return (
    <SolicitorPortalShell
      title="Matters"
      description="Every conveyancing file shared with your practice, ordered by settlement date."
      actions={
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={refreshing}>
          {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {summaryTiles.map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-3 pt-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
                <Icon className="h-5 w-5 text-primary" aria-hidden />
              </div>
              <div>
                <p className="text-2xl font-semibold text-foreground">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base">Matter list</CardTitle>
            <CardDescription>Select a matter to open its Legal Deal Room.</CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by matter, property, or client"
                className="pl-9"
                aria-label="Search matters"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="sm:w-56" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {MATTER_STATUS_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>{MATTER_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-14">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 px-4 py-12 text-center">
              <p className="text-sm font-medium text-foreground">No matters to show</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {matters.length === 0
                  ? 'Your NPC contact will notify you when a conveyancing file is shared with your practice.'
                  : 'No matters match the current search or status filter.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Matter</TableHead>
                    <TableHead className="hidden md:table-cell">Client</TableHead>
                    <TableHead className="hidden lg:table-cell">Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Settlement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((m) => {
                    const countdown = countdownLabel(m.settlement_date);
                    const overdue = countdown?.includes('overdue');
                    return (
                      <TableRow key={m.id} className="cursor-pointer">
                        <TableCell className="max-w-[22rem]">
                          <Link to={`/solicitor/matters/${m.id}`} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <span className="flex items-center gap-2 font-medium text-foreground">
                              {m.title}
                              {m.risk_flag ? (
                                <AlertTriangle className="h-3.5 w-3.5 text-destructive" aria-label="At risk" />
                              ) : null}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {m.matter_reference ? `${m.matter_reference} · ` : ''}{formatPropertyAddress(m)}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                          {m.client_name || '—'}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                          {MATTER_TYPE_LABELS[m.matter_type]}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('font-medium', MATTER_STATUS_CLASSES[m.status as LegalMatterStatus])}>
                            {MATTER_STATUS_LABELS[m.status as LegalMatterStatus]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          <span className="text-foreground">{formatMatterDate(m.settlement_date)}</span>
                          {countdown ? (
                            <span className={cn('block text-xs', overdue ? 'text-destructive' : 'text-muted-foreground')}>
                              {countdown}
                            </span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </SolicitorPortalShell>
  );
}
