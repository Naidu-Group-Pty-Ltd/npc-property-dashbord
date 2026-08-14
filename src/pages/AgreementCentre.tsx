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
import { useEffect, useMemo, useRef, useState } from 'react';
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
  AGREEMENT_STATUS_LABELS,
  agreementDispositionFromRow,
  dashboardGroupForStatus,
  isIssued,
  stageToFollow,
  templateKeyForDirection,
  agreementTemplate,
  type AgreementDelivery,
  type AgreementStatus,
  type AgreementTemplateKey,
} from '@/lib/agreements';
import {
  docxBrandFrom,
  downloadTemplateDocx,
  useAgreementCentreList,
  useAgreementCentreMutations,
  useAgreementCentreSync,
  useIssuerDefaults,
} from '@/hooks/useAgreementCentre';
import { SyncIndicator } from '@/components/agreement-centre/SyncIndicator';
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
  // The register is a wallboard as much as a list — it is left open while
  // partners review, accept and sign on the other side of the wall. The cursor
  // is what makes those arrive here instead of waiting for somebody to reload.
  const sync = useAgreementCentreSync();
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
      // Asked of the lifecycle module rather than by searching the
      // presentation array: `dashboardGroupForStatus` is the one mapping, and a
      // status it cannot place is a status this filter would silently drop.
      rows = rows.filter((agreement) =>
        dashboardGroupForStatus(agreement.status as AgreementStatus) === group);
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

  /**
   * Agreements that left the stage you are standing in, while you were
   * standing in it.
   *
   * This is the reported bug. Issuing moves an agreement from "Ready to Issue"
   * to "Partner Review", and the stage filter is component state that does not
   * move with it — so the row silently leaves the view, and with the sync
   * cursor polling it can now leave while nobody has touched anything. From
   * the outside that is indistinguishable from the agreement being deleted.
   *
   * Rather than suppress the movement (which would mean showing an agreement
   * under a stage it is no longer in — a worse lie), the register says where it
   * went and offers to follow. Departures are only recorded when the row is
   * still in the register under a different stage: a row that has genuinely
   * left the working list was archived, which is a deliberate act with its own
   * destination and its own button.
   */
  const [departures, setDepartures] = useState<
    { id: string; partner: string; toGroup: string; toLabel: string }[]
  >([]);
  const watchRef = useRef<{ group: GroupKey; inStage: Map<string, string> }>({
    group: 'all', inStage: new Map(),
  });

  useEffect(() => {
    const stageOf = (agreement: PartnerAgreement): string | null => (
      group === 'executed_vault'
        ? (agreement.status === 'active' ? 'executed_vault' : null)
        : dashboardGroupForStatus(agreement.status as AgreementStatus)
    );
    const inStage = new Map<string, string>();
    if (group !== 'all') {
      for (const agreement of agreements) {
        if (stageOf(agreement) === group) inStage.set(agreement.id, agreement.status);
      }
    }

    // Changing stage yourself is not a departure — it is navigation.
    if (watchRef.current.group !== group) {
      watchRef.current = { group, inStage };
      setDepartures([]);
      return;
    }

    const left: { id: string; partner: string; toGroup: string; toLabel: string }[] = [];
    for (const [id, previousStatus] of watchRef.current.inStage) {
      if (inStage.has(id)) continue;
      const row = agreements.find((agreement) => agreement.id === id);
      // Absent from the register entirely → archived, not moved. The archive
      // has its own button and its own count; claiming it "moved to a stage"
      // would send somebody to a stage it is not in.
      if (!row || row.status === previousStatus) continue;
      const toGroup = stageToFollow(group, row.status as AgreementStatus);
      if (!toGroup) continue;
      left.push({
        id,
        partner: row.partner_legal_name,
        toGroup,
        toLabel: AGREEMENT_DASHBOARD_GROUPS.find((entry) => entry.key === toGroup)?.label
          ?? AGREEMENT_STATUS_LABELS[row.status as AgreementStatus],
      });
    }

    watchRef.current = { group, inStage };
    if (left.length > 0) {
      setDepartures((current) => [
        ...left,
        ...current.filter((entry) => !left.some((one) => one.id === entry.id)),
      ].slice(0, 5));
    }
  }, [agreements, group]);

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
            <SyncIndicator sync={sync} />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => { void refetch(); sync.syncNow(); }}
              disabled={isFetching}
              aria-label="Refresh"
            >
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

        {/* Where it went. Shown instead of letting the row vanish out of the
            stage you are standing in — see the `departures` effect. */}
        {departures.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-foreground">
              {departures.length === 1 ? (
                <>
                  <span className="font-medium">{departures[0].partner}</span> moved on to{' '}
                  <span className="font-medium">{departures[0].toLabel}</span>. It is still in the
                  register — this stage no longer holds it.
                </>
              ) : (
                <>
                  <span className="font-medium">{departures.length} agreements</span> moved on to
                  other stages. They are still in the register.
                </>
              )}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {departures.length === 1 ? (
                <Button size="sm" variant="outline"
                  onClick={() => navigate(`/partner-agreements/${departures[0].id}`)}>
                  Open agreement
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => setGroup('all')}>
                Show all
              </Button>
            </div>
          </div>
        ) : null}

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
            ) : filtered.length === 0 && agreements.length > 0 ? (
              /* The register is NOT empty — a filter is hiding everything.
                 This used to render "Nothing in this stage" above a Create
                 Agreement button, which is the sentence somebody reads
                 immediately after issuing and concludes their agreement was
                 destroyed. An empty stage is a statement about the filter, and
                 the only honest thing to offer is a way out of it. */
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <FileSignature className="h-10 w-10 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    {search.trim() ? 'Nothing matches this search' : 'Nothing at this stage right now'}
                  </p>
                  <p className="mx-auto max-w-md text-sm text-muted-foreground">
                    {search.trim()
                      ? `${agreements.length} agreement${agreements.length === 1 ? ' is' : 's are'} in the register.`
                      : `Nothing has been lost — ${agreements.length} agreement${agreements.length === 1 ? '' : 's'} `
                        + 'in the register '
                        + `${agreements.length === 1 ? 'is' : 'are'} at other stages. An agreement moves stage as it `
                        + 'progresses; issuing one sends it to Partner Review.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button onClick={() => { setGroup('all'); setSearch(''); }}>
                    Show all {agreements.length} agreement{agreements.length === 1 ? '' : 's'}
                  </Button>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <FileSignature className="h-10 w-10 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-medium text-foreground">No agreements yet</p>
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
                            {/* The portal account it is actually addressed to,
                                shown only when it is not the name above — a
                                trading name differing from a login is normal;
                                a DIFFERENT PARTNER is the thing worth seeing,
                                and the register could not show it at all. */}
                            {agreement.partner_account_name
                              && agreement.partner_account_name !== agreement.partner_legal_name ? (
                                <div className="mt-0.5 text-xs text-muted-foreground">
                                  Portal account:{' '}
                                  <span className="text-foreground">{agreement.partner_account_name}</span>
                                </div>
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
                            {/* Nothing in this product ever said the word
                                "Issued". The lifecycle status says where the
                                agreement is NOW — `partner_review`,
                                `changes_requested`, `void` — and none of those
                                tells you it was sent, so a person who has just
                                issued one finds no confirmation of it anywhere
                                in the register. Driven by `issued_at`, so it
                                stays true after the agreement moves on or is
                                withdrawn. */}
                            {isIssued(agreement) ? (
                              <span className="mt-1 block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                Issued {format(new Date(agreement.issued_at as string), 'd MMM yyyy')}
                              </span>
                            ) : null}
                            {/* "Partner Review" reads the same whether the
                                partner is reading it or cannot sign in to
                                reach it. Without this the register cannot
                                distinguish a partner who is slow from one who
                                was never able to open the document. */}
                            {(agreement as { delivery?: AgreementDelivery }).delivery === 'awaiting_activation' ? (
                              <span className="mt-1 block text-[10px] font-medium uppercase tracking-wider text-warning">
                                Awaiting activation
                              </span>
                            ) : null}
                            {(agreement as { delivery?: AgreementDelivery }).delivery === 'access_revoked' ? (
                              <span className="mt-1 block text-[10px] font-medium uppercase tracking-wider text-destructive">
                                Partner access revoked
                              </span>
                            ) : null}
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
