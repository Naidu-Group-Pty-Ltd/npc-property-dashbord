import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Handshake,
  Plus,
  Search,
  RefreshCw,
  Loader2,
  FileSignature,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import {
  DIRECTION_LABELS,
  STATUS_LABELS,
  usePartnerAgreements,
  type PartnerAgreement,
  type PartnerAgreementDirection,
} from '@/hooks/usePartnerAgreements';
import PartnerAgreementDialog from '@/components/partner-agreements/PartnerAgreementDialog';
import PartnerAgreementDetailSheet, {
  statusVariant,
} from '@/components/partner-agreements/PartnerAgreementDetailSheet';

type DirectionFilter = 'all' | PartnerAgreementDirection;

export default function PartnerAgreements() {
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PartnerAgreement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: agreements = [], isLoading, isFetching, refetch } = usePartnerAgreements(
    directionFilter === 'all' ? undefined : { direction: directionFilter },
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agreements;
    return agreements.filter((a) =>
      [a.partner_legal_name, a.partner_trading_name, a.partner_abn, a.partner_aggregator]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [agreements, search]);

  const stats = useMemo(() => {
    const active = agreements.filter((a) => a.status === 'active').length;
    const inFlight = agreements.filter((a) =>
      ['pending_review', 'sent_for_signature', 'partially_signed'].includes(a.status),
    ).length;
    const drafts = agreements.filter((a) => a.status === 'draft').length;
    return { active, inFlight, drafts, total: agreements.length };
  }, [agreements]);

  useEffect(() => {
    document.title = 'Partner Agreements | Command Centre';
  }, []);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (agreement: PartnerAgreement) => {
    setSelectedId(null);
    setEditing(agreement);
    setDialogOpen(true);
  };

  return (
    <>
      <div className="space-y-6 p-4 sm:p-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
              <Handshake className="h-6 w-6 text-primary" />
              Partner Agreements
            </h1>
            <p className="text-sm text-muted-foreground">
              Referral and commission agreements with finance partners — parties, legal terms, commercial
              schedule and version history in one register.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" /> New agreement
            </Button>
          </div>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total agreements" value={stats.total} icon={FileSignature} />
          <StatCard label="Active" value={stats.active} icon={CheckCircle2} accent="text-success" />
          <StatCard label="In signature flow" value={stats.inFlight} icon={Clock} accent="text-primary" />
          <StatCard label="Drafts" value={stats.drafts} icon={FileSignature} accent="text-muted-foreground" />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs value={directionFilter} onValueChange={(v) => setDirectionFilter(v as DirectionFilter)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="outbound_finance_referral">Finance referral</TabsTrigger>
              <TabsTrigger value="inbound_property_referral">Property referral</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search partner, ABN, aggregator…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Handshake className="h-10 w-10 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">No partner agreements yet</p>
                  <p className="text-sm text-muted-foreground">
                    Create a draft to capture the parties and commercial schedule, then take it through review,
                    signature and activation.
                  </p>
                </div>
                <Button onClick={openNew}>
                  <Plus className="h-4 w-4 mr-2" /> New agreement
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a) => (
                    <TableRow
                      key={a.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedId(a.id)}
                    >
                      <TableCell>
                        <div className="font-medium text-foreground">{a.partner_legal_name}</div>
                        {a.partner_trading_name && (
                          <div className="text-xs text-muted-foreground">{a.partner_trading_name}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {DIRECTION_LABELS[a.direction]}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {summariseSchedule(a)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {a.effective_date ? format(new Date(a.effective_date), 'd MMM yyyy') : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">v{a.version}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusVariant(a.status)}>
                          {STATUS_LABELS[a.status]}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <PartnerAgreementDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        agreement={editing}
      />
      <PartnerAgreementDetailSheet
        agreementId={selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
        onEdit={openEdit}
      />
    </>
  );
}

function summariseSchedule(a: PartnerAgreement): string {
  if (a.direction === 'outbound_finance_referral') {
    const parts: string[] = [];
    if (a.upfront_share_pct != null) parts.push(`${a.upfront_share_pct}% upfront`);
    if (a.trail_share_pct != null) parts.push(`${a.trail_share_pct}% trail`);
    return parts.length ? parts.join(' · ') : 'Not set';
  }
  if (a.fee_model === 'fixed_fee' && a.fee_amount != null) {
    return `$${Number(a.fee_amount).toLocaleString('en-AU')} fixed`;
  }
  if (a.fee_model === 'percentage_of_fee' && a.fee_percentage != null) {
    return `${a.fee_percentage}% of BA fee`;
  }
  return a.fee_model ? a.fee_model.replace(/_/g, ' ') : 'Not set';
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent = 'text-primary',
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold text-foreground">{value}</p>
        </div>
        <Icon className={`h-5 w-5 ${accent}`} />
      </CardContent>
    </Card>
  );
}
