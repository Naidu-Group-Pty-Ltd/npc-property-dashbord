/**
 * Agreement Centre — the Command Centre's partner-agreement workspace.
 *
 * Not a document library: an active management surface. Status counters read
 * the same lifecycle groups the server enforces; the table's primary action
 * column answers "what do I do next" per row; the template library makes the
 * direction of each agreement unmistakable before anything is created.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ArrowRight, FileSignature, Loader2, Plus, RefreshCw, Search, Vault,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AGREEMENT_DASHBOARD_GROUPS,
  AGREEMENT_PRIMARY_ACTIONS,
  AGREEMENT_TEMPLATE_SUMMARIES,
  directionForTemplateKey,
  templateKeyForDirection,
  agreementTemplate,
  type AgreementStatus,
} from '@/lib/agreements';
import { useAgreementCentreList } from '@/hooks/useAgreementCentre';
import type { PartnerAgreement } from '@/hooks/usePartnerAgreements';
import AgreementStatusBadge from '@/components/agreement-centre/AgreementStatusBadge';

type GroupKey = 'all' | 'executed_vault' | (typeof AGREEMENT_DASHBOARD_GROUPS)[number]['key'];

function executionSummary(agreement: PartnerAgreement): string {
  switch (agreement.status) {
    case 'partner_review': return 'Awaiting partner review';
    case 'changes_requested': return 'Partner requested changes';
    case 'sent_for_signature': return 'Awaiting partner signature';
    case 'partially_signed': return 'Awaiting counter-signature';
    case 'active': return 'Complete';
    case 'withdrawn': return 'Withdrawn before execution';
    default: return '—';
  }
}

export default function AgreementCentre() {
  const navigate = useNavigate();
  const [group, setGroup] = useState<GroupKey>('all');
  const [search, setSearch] = useState('');
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  const { data: agreements = [], isLoading, isFetching, refetch } = useAgreementCentreList();

  useEffect(() => {
    document.title = 'Agreements | Command Centre';
  }, []);

  const counters = useMemo(() => AGREEMENT_DASHBOARD_GROUPS.map((entry) => ({
    ...entry,
    count: agreements.filter((agreement) => (entry.statuses as readonly string[]).includes(agreement.status)).length,
  })), [agreements]);

  const filtered = useMemo(() => {
    let rows = agreements;
    if (group === 'executed_vault') {
      rows = rows.filter((agreement) => agreement.status === 'active');
    } else if (group !== 'all') {
      const entry = AGREEMENT_DASHBOARD_GROUPS.find((candidate) => candidate.key === group);
      if (entry) rows = rows.filter((agreement) => (entry.statuses as readonly string[]).includes(agreement.status));
    }
    const query = search.trim().toLowerCase();
    if (query) {
      rows = rows.filter((agreement) =>
        [agreement.partner_legal_name, agreement.partner_trading_name, agreement.partner_abn,
          agreementTemplate(templateKeyForDirection(agreement.direction)).title]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query)));
    }
    return rows;
  }, [agreements, group, search]);

  return (
    <>
      <div className="space-y-6 p-4 sm:p-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
              <FileSignature className="h-6 w-6 text-primary" />
              Agreements
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage, issue, review and track partner agreements.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh">
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </Button>
            <Button variant="outline" onClick={() => setGroup('executed_vault')}>
              <Vault className="mr-2 h-4 w-4" /> Executed Agreements
            </Button>
            <Button onClick={() => setTemplatePickerOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Create Agreement
            </Button>
          </div>
        </header>

        {/* Status counters — compact and operational, not oversized KPI cards. */}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-9">
          {counters.map((entry) => (
            <button
              key={entry.key}
              type="button"
              title={entry.description}
              onClick={() => setGroup(group === entry.key ? 'all' : entry.key)}
              className={cn(
                'rounded-lg border px-3 py-2 text-left transition-colors',
                group === entry.key
                  ? 'border-primary/50 bg-primary/10'
                  : 'border-border bg-card/50 hover:bg-accent/10',
              )}
            >
              <div className="text-lg font-semibold leading-tight text-foreground">{entry.count}</div>
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{entry.label}</div>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            {group === 'all' ? (
              <span>{agreements.length} agreement{agreements.length === 1 ? '' : 's'}</span>
            ) : (
              <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setGroup('all')}>
                Clear filter — showing {group === 'executed_vault' ? 'Executed Agreements' : AGREEMENT_DASHBOARD_GROUPS.find((c) => c.key === group)?.label}
              </button>
            )}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search partner, ABN, agreement…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
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
                <FileSignature className="h-10 w-10 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    {group === 'all' ? 'No agreements yet' : 'Nothing in this stage'}
                  </p>
                  <p className="mx-auto max-w-md text-sm text-muted-foreground">
                    Create an agreement from a template, take it through internal review, then issue
                    it to the partner portal for review and execution — or download it as PDF / DOCX.
                  </p>
                </div>
                <Button onClick={() => setTemplatePickerOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" /> Create Agreement
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agreement</TableHead>
                      <TableHead>Partner</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Last activity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Execution</TableHead>
                      <TableHead className="text-right">Next step</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((agreement) => {
                      const templateKey = templateKeyForDirection(agreement.direction);
                      return (
                        <TableRow
                          key={agreement.id}
                          className="cursor-pointer"
                          onClick={() => navigate(`/partner-agreements/${agreement.id}`)}
                        >
                          <TableCell>
                            <div className="font-medium text-foreground">
                              {agreementTemplate(templateKey).title}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {templateKey === 'strategic_property_referral'
                                ? 'Property referral · issued by the buyer\'s agency'
                                : 'Finance referral · issued by the finance partner'}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-foreground">{agreement.partner_legal_name}</div>
                            {agreement.partner_trading_name ? (
                              <div className="text-xs text-muted-foreground">{agreement.partner_trading_name}</div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {(agreement as { agreement_owner_label?: string | null }).agreement_owner_label ?? '—'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">v{agreement.version}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(agreement.updated_at), 'd MMM yyyy')}
                          </TableCell>
                          <TableCell>
                            <AgreementStatusBadge status={agreement.status as AgreementStatus} />
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {executionSummary(agreement)}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                              {AGREEMENT_PRIMARY_ACTIONS[agreement.status as AgreementStatus]}
                              <ArrowRight className="h-3 w-3" />
                            </span>
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
      </div>

      {/* Template library — direction made unmistakable before selection. */}
      <Dialog open={templatePickerOpen} onOpenChange={setTemplatePickerOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Select agreement template</DialogTitle>
            <DialogDescription>
              Two locked templates. The wording is fixed — you configure parties, branding and the
              commercial schedule.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {AGREEMENT_TEMPLATE_SUMMARIES.map((template) => (
              <Link
                key={template.key}
                to={`/partner-agreements/new?direction=${directionForTemplateKey(template.key)}`}
                onClick={() => setTemplatePickerOpen(false)}
                className="group rounded-xl border border-border bg-card/50 p-4 transition-colors hover:border-primary/50 hover:bg-accent/10"
              >
                <div className="flex items-center justify-center gap-2 rounded-lg bg-muted/40 px-2 py-3 text-center">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {template.from}
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {template.to}
                  </span>
                </div>
                <h3 className="mt-3 font-serif text-base font-semibold leading-snug text-foreground">
                  {template.title}
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{template.referralFlow}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                  Configure agreement <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
