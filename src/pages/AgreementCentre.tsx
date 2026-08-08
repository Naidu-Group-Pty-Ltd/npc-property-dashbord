/**
 * Agreement Centre — the Command Centre's partner-agreement workspace.
 *
 * Not a document library: an active management surface. Status counters read
 * the same lifecycle groups the server enforces, and the table's primary
 * action column answers "what do I do next" per row.
 *
 * The two header actions are deliberately different journeys. **Create
 * Agreement** goes straight into the wizard — the tracked lifecycle that ends
 * in a digitally executed, automatically stored agreement. **Templates**
 * opens a download desk for the business that signs somewhere else. They
 * previously shared one picker, which made them look like the same thing.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Archive, ArchiveRestore, ArrowRight, Ban, FileSignature, FileStack, Loader2,
  MoreHorizontal, Plus, RefreshCw, Search, Trash2, Vault,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AGREEMENT_DASHBOARD_GROUPS,
  AGREEMENT_PRIMARY_ACTIONS,
  agreementDispositionFromRow,
  templateKeyForDirection,
  agreementTemplate,
  type AgreementStatus,
  type AgreementTemplateKey,
} from '@/lib/agreements';
import {
  docxBrandFrom,
  downloadTemplateDocx,
  useAgreementCentreList,
  useAgreementCentreMutations,
  useIssuerDefaults,
} from '@/hooks/useAgreementCentre';
import { loadDocxLogo } from '@/lib/agreements/docx';
import { useBrand } from '@/branding/BrandProvider';
import type { PartnerAgreement } from '@/hooks/usePartnerAgreements';
import AgreementStatusBadge from '@/components/agreement-centre/AgreementStatusBadge';
import TemplateLibraryDialog from '@/components/agreement-centre/TemplateLibraryDialog';
import AgreementDispositionDialog, {
  type DispositionMode,
} from '@/components/agreement-centre/AgreementDispositionDialog';

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
  const [templatesOpen, setTemplatesOpen] = useState(false);
  /** The archive is a separate list, not a filter over the working one. */
  const [view, setView] = useState<'working' | 'archived'>('working');
  const [disposition, setDisposition] = useState<
    { mode: DispositionMode; agreement: PartnerAgreement } | null
  >(null);

  const { data, isLoading, isFetching, refetch } = useAgreementCentreList(
    view === 'archived' ? 'only' : 'exclude',
  );
  const agreements = data?.agreements ?? [];
  const archivedCount = data?.archivedCount ?? 0;
  const { data: issuer } = useIssuerDefaults();
  const { settings: brandSettings } = useBrand();
  const { voidAgreement, archive, restore, deleteAgreement } = useAgreementCentreMutations();

  const dispositionPending = voidAgreement.isPending || archive.isPending
    || restore.isPending || deleteAgreement.isPending;

  const runDisposition = (input: { reason?: string }) => {
    if (!disposition) return;
    const id = disposition.agreement.id;
    const done = { onSuccess: () => setDisposition(null) };
    switch (disposition.mode) {
      case 'void': return voidAgreement.mutate({ id, reason: input.reason ?? '' }, done);
      case 'archive': return archive.mutate({ id, reason: input.reason }, done);
      case 'restore': return restore.mutate(id, done);
      case 'delete': return deleteAgreement.mutate({ id }, done);
    }
  };

  /**
   * The template download. The mark is fetched here rather than inside the
   * builder so a slow or missing logo costs the document its cover image and
   * nothing else — the download itself never fails on it.
   */
  const exportTemplate = async (templateKey: AgreementTemplateKey) => {
    const logo = await loadDocxLogo(brandSettings?.reportLogo ?? brandSettings?.sidebarLogo ?? null);
    const brand = docxBrandFrom(
      issuer,
      brandSettings?.brandColor ?? brandSettings?.primaryColor ?? null,
      logo,
    );
    await downloadTemplateDocx(templateKey, brand);
  };

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
            <Button
              variant="outline"
              onClick={() => { setView('working'); setGroup('executed_vault'); }}
            >
              <Vault className="mr-2 h-4 w-4" /> Executed Agreements
            </Button>
            {/* Only offered once something is in there — an empty archive is
                not a destination, and the count is the reassurance that
                archiving did not lose anything. */}
            {archivedCount > 0 || view === 'archived' ? (
              <Button
                variant={view === 'archived' ? 'secondary' : 'outline'}
                onClick={() => {
                  setView(view === 'archived' ? 'working' : 'archived');
                  setGroup('all');
                }}
              >
                <Archive className="mr-2 h-4 w-4" />
                Archived{archivedCount > 0 ? ` (${archivedCount})` : ''}
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
              <FileStack className="mr-2 h-4 w-4" /> Templates
            </Button>
            <Button onClick={() => navigate('/partner-agreements/new')}>
              <Plus className="mr-2 h-4 w-4" /> Create Agreement
            </Button>
          </div>
        </header>

        {view === 'archived' ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
            <Archive className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Archived agreements.</span>{' '}
              Nothing here has been changed — an archived agreement keeps its status and,
              if it is active, still governs commission. Restore one to work on it again.
            </p>
          </div>
        ) : null}

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
            ) : filtered.length === 0 && view === 'archived' ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <Archive className="h-10 w-10 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">The archive is empty</p>
                  <p className="mx-auto max-w-md text-sm text-muted-foreground">
                    Archiving takes a settled or abandoned agreement out of the working list
                    without changing anything about it.
                  </p>
                </div>
                <Button variant="outline" onClick={() => { setView('working'); setGroup('all'); }}>
                  Back to the working list
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <FileSignature className="h-10 w-10 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    {group === 'all' ? 'No agreements yet' : 'Nothing in this stage'}
                  </p>
                  <p className="mx-auto max-w-md text-sm text-muted-foreground">
                    Create an agreement to take it through internal review, issuance to the partner
                    portal, and execution — or download the Word template to send through your own
                    platform.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button onClick={() => navigate('/partner-agreements/new')}>
                    <Plus className="mr-2 h-4 w-4" /> Create Agreement
                  </Button>
                  <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
                    <FileStack className="mr-2 h-4 w-4" /> Templates
                  </Button>
                </div>
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
                      <TableHead className="w-10" aria-label="Actions" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((agreement) => {
                      const templateKey = templateKeyForDirection(agreement.direction);
                      const can = agreementDispositionFromRow(agreement);
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
                          {/* The row navigates; this cell must not. */}
                          <TableCell onClick={(event) => event.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  aria-label={`Actions for ${agreement.partner_legal_name}`}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem onSelect={() => navigate(`/partner-agreements/${agreement.id}`)}>
                                  <ArrowRight className="mr-2 h-4 w-4" /> Open agreement
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {can.canRestore ? (
                                  <DropdownMenuItem onSelect={() => setDisposition({ mode: 'restore', agreement })}>
                                    <ArchiveRestore className="mr-2 h-4 w-4" /> Restore
                                  </DropdownMenuItem>
                                ) : null}
                                {can.canVoid ? (
                                  <DropdownMenuItem onSelect={() => setDisposition({ mode: 'void', agreement })}>
                                    <Ban className="mr-2 h-4 w-4" /> Void agreement
                                  </DropdownMenuItem>
                                ) : null}
                                {can.canArchive ? (
                                  <DropdownMenuItem onSelect={() => setDisposition({ mode: 'archive', agreement })}>
                                    <Archive className="mr-2 h-4 w-4" /> Archive
                                  </DropdownMenuItem>
                                ) : null}
                                {can.canDelete ? (
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onSelect={() => setDisposition({ mode: 'delete', agreement })}
                                  >
                                    <Trash2 className="mr-2 h-4 w-4" /> Delete permanently
                                  </DropdownMenuItem>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
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

      <TemplateLibraryDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onDownload={exportTemplate}
      />

      <AgreementDispositionDialog
        mode={disposition?.mode ?? null}
        agreementLabel={disposition?.agreement.partner_legal_name ?? ''}
        pending={dispositionPending}
        onOpenChange={(open) => { if (!open) setDisposition(null); }}
        onConfirm={runDisposition}
      />
    </>
  );
}
