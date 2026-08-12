/**
 * The agreement workspace — one agreement, end to end.
 *
 * Three panes: section navigation, the digital document, and the action rail.
 * The rail's primary action tracks the lifecycle (review & approve → send to
 * partner → awaiting partner → counter-sign → executed vault), with the
 * activity timeline, version history, change requests and execution status
 * behind tabs. Downloads adapt to state: draft exports before issue, the
 * frozen issued PDF while in review, the executed master after execution.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Archive, ArchiveRestore, ArrowLeft, Ban, CheckCircle2, ChevronDown, Download,
  Eye, FileSignature, Loader2, MoreHorizontal, Pencil, RotateCcw, Send, Trash2,
  Undo2, FilePlus2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AGREEMENT_STATUS_LABELS,
  agreementDeliveryNote,
  agreementDispositionFromRow,
  agreementTemplate,
  templateKeyForDirection,
  projectFieldValues,
  type AgreementStatus,
} from '@/lib/agreements';
import {
  useAgreementCentreDetail,
  useAgreementCentreMutations,
  docxBrandFrom,
  downloadAgreementDocx,
  downloadAgreementPdf,
  useIssuerDefaults,
  usePartnerPortalAccess,
  useSendAgreement,
} from '@/hooks/useAgreementCentre';
import SendAgreementDialog from '@/components/agreement-centre/SendAgreementDialog';
import AnnotationRail from '@/components/agreement-centre/AnnotationRail';
import { useAgreementAnnotations } from '@/hooks/useAgreementAnnotations';
import { loadDocxLogo } from '@/lib/agreements/docx';
import { useBrand } from '@/branding/BrandProvider';
import DigitalAgreementView, { agreementSectionNav } from '@/components/agreement-centre/DigitalAgreementView';
import AgreementStatusBadge from '@/components/agreement-centre/AgreementStatusBadge';
import AgreementTimeline from '@/components/agreement-centre/AgreementTimeline';
import VersionHistory from '@/components/agreement-centre/VersionHistory';
import SignatureDialog from '@/components/agreement-centre/SignatureDialog';
import PdfPreviewDialog from '@/components/agreement-centre/PdfPreviewDialog';
import AgreementDispositionDialog, {
  type DispositionMode,
} from '@/components/agreement-centre/AgreementDispositionDialog';

export default function AgreementCentreDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useAgreementCentreDetail(id ?? null);
  const { data: issuer } = useIssuerDefaults();
  const { settings: brandSettings } = useBrand();
  const {
    transition, recordReview, issueToPartner, withdraw, counterSign,
    resolveChangeRequest, newVersion, voidAgreement, archive, restore, deleteAgreement,
  } = useAgreementCentreMutations();

  const [reviewDialog, setReviewDialog] = useState<null | 'approve' | 'return'>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [withdrawDialog, setWithdrawDialog] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [counterSignOpen, setCounterSignOpen] = useState(false);
  const [pdfPreviewId, setPdfPreviewId] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [disposition, setDisposition] = useState<DispositionMode | null>(null);

  const agreement = data?.agreement ?? null;
  const templateKey = agreement ? templateKeyForDirection(agreement.direction) : null;
  const title = templateKey ? agreementTemplate(templateKey).title : 'Agreement';
  const status = (agreement?.status ?? 'draft') as AgreementStatus;

  useEffect(() => {
    document.title = `${title} | Command Centre`;
  }, [title]);

  const currentVersion = useMemo(
    () => data?.issued_versions?.find((version) => version.id === (agreement as { issued_version_id?: string } | null)?.issued_version_id)
      ?? data?.issued_versions?.[0] ?? null,
    [data, agreement],
  );

  const values = useMemo(() => {
    if (!agreement || !templateKey) return {};
    // The issued/executed document shows the FROZEN values; a working draft
    // shows the live row.
    const frozen = ['partner_review', 'changes_requested', 'sent_for_signature', 'partially_signed', 'active']
      .includes(status);
    if (frozen && currentVersion && (currentVersion as { field_values?: Record<string, unknown> }).field_values) {
      return (currentVersion as unknown as { field_values: Record<string, unknown> }).field_values;
    }
    return projectFieldValues(templateKey, agreement as never);
  }, [agreement, templateKey, status, currentVersion]);

  const versionSignatures = useMemo(
    () => (data?.signatures ?? []).filter((signature) =>
      !currentVersion || signature.version_id === currentVersion.id),
    [data, currentVersion],
  );

  const openRequests = (data?.change_requests ?? []).filter((request) => request.status === 'open');

  // Whether the counterparty can actually reach this. Derived server-side and
  // absent on an older deployment, in which case the banner simply does not
  // appear — a missing field must not become a false alarm.
  const partnerAccess = data?.partner_portal_access ?? 'active';
  const delivery = data?.delivery ?? 'delivered';
  const deliveryNote = data?.delivery ? agreementDeliveryNote(data.delivery) : '';
  const { invite: invitePartner, reinstate: reinstatePartner } = usePartnerPortalAccess();
  const partnerAccessBusy = invitePartner.isPending || reinstatePartner.isPending;
  const sendAgreement = useSendAgreement();

  // The partner's pins, on the issuer's own live preview. The same layer object
  // the Finance Portal builds, over the same document component — which is what
  // makes "the Command Centre sees the same pins" structural rather than a
  // second implementation to keep in step. The issuer never adds a pin: a
  // change request is the counterparty's instrument for asking, and the issuer
  // answers it or amends the clause.
  const annotations = useAgreementAnnotations({
    templateKey,
    values,
    rows: data?.change_requests ?? [],
    canAdd: false,
  });
  // Once there is an issued version there is something to send. The action has
  // to outlive the moment of issue: the address was wrong, the broker's admin
  // needs a copy, the first email went to spam.
  const canSend = currentVersion !== null && status !== 'void';

  /**
   * What the issued copy actually is, which depends on whether anybody has
   * signed against the version. Unsigned, the stored PDF is a cache of the
   * frozen wording and gets re-typeset by whichever build serves it; signed, it
   * is the document a person committed to and is never touched again.
   */
  const issuedCopyNote = useMemo(() => {
    if (!currentVersion) return '';
    const issued = currentVersion.issued_at
      ? format(new Date(currentVersion.issued_at), 'd MMM yyyy')
      : null;
    if (versionSignatures.length > 0) {
      return `Signed — served exactly as signed${issued ? `, issued ${issued}` : ''}`;
    }
    return issued
      ? `Issued ${issued} — the frozen wording, in the current layout`
      : 'The frozen wording, in the current layout';
  }, [currentVersion, versionSignatures]);

  const download = async (kind: 'draft' | 'issued' | 'executed' | 'docx') => {
    if (!agreement) return;
    try {
      setDownloading(kind);
      if (kind === 'docx') {
        const logo = await loadDocxLogo(brandSettings?.reportLogo ?? brandSettings?.sidebarLogo ?? null);
        await downloadAgreementDocx(agreement, docxBrandFrom(
          issuer, brandSettings?.brandColor ?? brandSettings?.primaryColor ?? null, logo,
        ));
        return;
      }
      const outcome = await downloadAgreementPdf(agreement.id, kind);
      // Which document did they just get? A stored artefact can be older than
      // this build in two different ways, and they call for opposite answers:
      // one the app has already fixed, one it cannot.
      if (outcome.service === 'behind') {
        toast.warning(
          'Downloaded in the previous document format — the agreement render service has not '
          + 'been deployed yet. Re-download once it has.',
        );
      } else if (outcome.refreshed) {
        toast.success('Re-rendered in the current document format. The wording is unchanged.');
      } else if (outcome.artefactState === 'frozen') {
        toast.info(
          kind === 'executed'
            ? 'The executed agreement is downloading, exactly as executed.'
            : 'This version has been signed, so it is served exactly as signed rather than re-rendered.',
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  if (isLoading || !agreement || !templateKey) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const busy = transition.isPending || recordReview.isPending || issueToPartner.isPending
    || withdraw.isPending || counterSign.isPending;

  /** The one obvious primary action for the current stage. */
  const primaryAction = () => {
    // Archived work is out of the list, so offering to progress it here would
    // be offering something the server will refuse. Restoring is the action.
    if (agreement.archived_at) {
      return (
        <Button className="w-full" variant="outline" disabled={dispositionPending}
          onClick={() => setDisposition('restore')}>
          <ArchiveRestore className="mr-2 h-4 w-4" /> Restore to working list
        </Button>
      );
    }
    switch (status) {
      case 'draft':
        return (
          <Button className="w-full" onClick={() => navigate(`/partner-agreements/${agreement.id}/edit`)}>
            <Pencil className="mr-2 h-4 w-4" /> Continue Agreement
          </Button>
        );
      case 'pending_review':
        return (
          <div className="space-y-2">
            <Button className="w-full" disabled={busy} onClick={() => { setReviewNotes(''); setReviewDialog('approve'); }}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Review & Approve
            </Button>
            <Button variant="outline" className="w-full" disabled={busy}
              onClick={() => { setReviewNotes(''); setReviewDialog('return'); }}>
              <RotateCcw className="mr-2 h-4 w-4" /> Return to Draft
            </Button>
          </div>
        );
      case 'approved_for_issue':
        return (
          <Button className="w-full" disabled={busy} onClick={() => issueToPartner.mutate(agreement.id)}>
            {issueToPartner.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send to Finance Partner
          </Button>
        );
      case 'partner_review':
        return (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-center text-sm text-muted-foreground">
            Awaiting partner review
            {agreement.first_viewed_at
              ? ` — viewed ${format(new Date(agreement.first_viewed_at as string), 'd MMM')}`
              : ' — not viewed yet'}
          </div>
        );
      case 'changes_requested':
        return (
          <Button className="w-full" disabled={busy}
            onClick={() => transition.mutate({ id: agreement.id, status: 'draft' })}>
            <Pencil className="mr-2 h-4 w-4" /> Create Revision
          </Button>
        );
      case 'sent_for_signature':
        return (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-center text-sm text-muted-foreground">
            Accepted — awaiting the partner's signature
          </div>
        );
      case 'partially_signed':
        return (
          <Button className="w-full" disabled={busy} onClick={() => setCounterSignOpen(true)}>
            <FileSignature className="mr-2 h-4 w-4" /> Complete Counter-Signature
          </Button>
        );
      case 'active':
        return (
          <Button className="w-full" disabled={downloading !== null} onClick={() => download('executed')}>
            <Download className="mr-2 h-4 w-4" /> Download Executed Copy
          </Button>
        );
      case 'withdrawn':
        return (
          <Button className="w-full" variant="outline" disabled={busy}
            onClick={() => transition.mutate({ id: agreement.id, status: 'draft' })}>
            <RotateCcw className="mr-2 h-4 w-4" /> Reopen as Draft
          </Button>
        );
      default:
        return null;
    }
  };

  const sections = agreementSectionNav(templateKey, false, values);
  const canWithdraw = ['partner_review', 'changes_requested', 'sent_for_signature'].includes(status);
  const can = agreementDispositionFromRow(agreement);
  const archivedAt = agreement.archived_at ?? null;
  const dispositionPending = voidAgreement.isPending || archive.isPending
    || restore.isPending || deleteAgreement.isPending;

  const runDisposition = (input: { reason?: string }) => {
    const close = { onSuccess: () => setDisposition(null) };
    switch (disposition) {
      case 'void': return voidAgreement.mutate({ id: agreement.id, reason: input.reason ?? '' }, close);
      case 'archive': return archive.mutate({ id: agreement.id, reason: input.reason }, close);
      case 'restore': return restore.mutate(agreement.id, close);
      case 'delete':
        // The row is about to stop existing, so there is nowhere to return to.
        return deleteAgreement.mutate({ id: agreement.id }, {
          onSuccess: () => { setDisposition(null); navigate('/partner-agreements'); },
        });
      default: return undefined;
    }
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => navigate('/partner-agreements')}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Agreements
          </Button>
          <h1 className="truncate text-xl font-semibold text-foreground">{title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <AgreementStatusBadge status={status} />
            <span>{agreement.partner_legal_name}</span>
            {currentVersion ? <span>· Version {currentVersion.version_label}</span> : <span>· v{agreement.version} draft</span>}
            {(agreement as { agreement_owner_label?: string | null }).agreement_owner_label ? (
              <span>· Owner: {(agreement as { agreement_owner_label?: string | null }).agreement_owner_label}</span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPdfPreviewId(agreement.id)}>
            <Eye className="mr-1.5 h-4 w-4" /> Preview
          </Button>
          {canSend ? (
            <Button variant="outline" size="sm" onClick={() => setSendOpen(true)}>
              <Send className="mr-1.5 h-4 w-4" /> Send
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={downloading !== null}>
                {downloading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
                Download <ChevronDown className="ml-1 h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            {/* Each item says what the document IS, because they are genuinely
                different documents and the difference used to be invisible: a
                stale issued artefact looked identical to a current one in this
                menu, so a superseded cover left for a partner unremarked. */}
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem className="flex-col items-start gap-0.5" onClick={() => download('draft')}>
                <span>Draft PDF (template pack)</span>
                <span className="text-xs text-muted-foreground">
                  Rendered now from the working record, with the partner email page
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex-col items-start gap-0.5" onClick={() => download('docx')}>
                <span>DOCX (template pack)</span>
                <span className="text-xs text-muted-foreground">The same pack as an editable Word file</span>
              </DropdownMenuItem>
              {currentVersion ? (
                <DropdownMenuItem className="flex-col items-start gap-0.5" onClick={() => download('issued')}>
                  <span>Issued PDF — v{currentVersion.version_label}</span>
                  <span className="text-xs text-muted-foreground">{issuedCopyNote}</span>
                </DropdownMenuItem>
              ) : null}
              {status === 'active' ? (
                <DropdownMenuItem className="flex-col items-start gap-0.5" onClick={() => download('executed')}>
                  <span>Executed PDF</span>
                  <span className="text-xs text-muted-foreground">
                    The signed instrument, exactly as executed
                  </span>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {['draft', 'pending_review', 'approved_for_issue', 'changes_requested'].includes(status) ? (
                <DropdownMenuItem onClick={() => navigate(`/partner-agreements/${agreement.id}/edit`)}>
                  <Pencil className="mr-2 h-4 w-4" /> Edit configuration
                </DropdownMenuItem>
              ) : null}
              {canWithdraw ? (
                <DropdownMenuItem onClick={() => { setWithdrawReason(''); setWithdrawDialog(true); }}>
                  <Undo2 className="mr-2 h-4 w-4" /> Withdraw agreement
                </DropdownMenuItem>
              ) : null}
              {status === 'active' ? (
                <DropdownMenuItem onClick={() => newVersion.mutate(agreement.id)}>
                  <FilePlus2 className="mr-2 h-4 w-4" /> New version (vary terms)
                </DropdownMenuItem>
              ) : null}
              {can.canRestore || can.canVoid || can.canArchive || can.canDelete ? (
                <DropdownMenuSeparator />
              ) : null}
              {can.canRestore ? (
                <DropdownMenuItem onClick={() => setDisposition('restore')}>
                  <ArchiveRestore className="mr-2 h-4 w-4" /> Restore from archive
                </DropdownMenuItem>
              ) : null}
              {can.canVoid ? (
                <DropdownMenuItem onClick={() => setDisposition('void')}>
                  <Ban className="mr-2 h-4 w-4" /> Void agreement
                </DropdownMenuItem>
              ) : null}
              {can.canArchive ? (
                <DropdownMenuItem onClick={() => setDisposition('archive')}>
                  <Archive className="mr-2 h-4 w-4" /> Archive
                </DropdownMenuItem>
              ) : null}
              {can.canDelete ? (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDisposition('delete')}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete permanently
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Why the actions are missing, said before the user goes looking. */}
      {archivedAt ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Archived</span>{' '}
            {format(new Date(archivedAt), 'd MMM yyyy')}
            {agreement.archived_by_label ? ` by ${agreement.archived_by_label}` : ''}
            {agreement.archive_reason ? ` — ${agreement.archive_reason}` : ''}
            . Its status is unchanged; restore it to make changes.
          </p>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setDisposition('restore')}>
            <ArchiveRestore className="mr-1.5 h-4 w-4" /> Restore
          </Button>
        </div>
      ) : null}

      {status === 'void' ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
          <p className="text-sm text-foreground">
            <span className="font-medium">This agreement is void</span>
            {agreement.voided_at ? ` — ${format(new Date(agreement.voided_at), 'd MMM yyyy')}` : ''}
            . It is of no effect and cannot be executed or reopened.
            {agreement.void_reason ? ` Reason: ${agreement.void_reason}` : ''}
          </p>
        </div>
      ) : null}

      {/* "Awaiting partner" and "awaiting a partner who cannot open it" look
          identical in the status badge and mean opposite things about whose
          move it is. An agreement can sit here for a fortnight while somebody
          waits for a reply that was never possible. */}
      {deliveryNote ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground">{deliveryNote}</p>
          {agreement.finance_agent_contact_id ? (
            <Button
              variant="outline" size="sm" className="shrink-0" disabled={partnerAccessBusy}
              onClick={() => (delivery === 'access_revoked'
                ? reinstatePartner.mutate(agreement.finance_agent_contact_id as string)
                : invitePartner.mutate({
                  financeContactId: agreement.finance_agent_contact_id as string,
                  resend: partnerAccess === 'invited',
                }))}
            >
              {partnerAccessBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {delivery === 'access_revoked'
                ? 'Reinstate access'
                : partnerAccess === 'invited' ? 'Resend invitation' : 'Invite to portal'}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[200px_minmax(0,1fr)_340px]">
        {/* Left — section navigation */}
        <aside className="hidden xl:block">
          <nav className="sticky top-4 space-y-0.5">
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#agc-${section.id}`}
                className="flex items-baseline gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
              >
                <span className="w-8 shrink-0 font-mono text-[10px] text-primary">{section.badge}</span>
                <span className="truncate">{section.heading}</span>
              </a>
            ))}
          </nav>
        </aside>

        {/* Centre — the document */}
        <Card className="min-w-0">
          <CardContent className="p-4 sm:p-6">
            <DigitalAgreementView
              templateKey={templateKey}
              values={values}
              signatures={versionSignatures}
              versionLabel={currentVersion?.version_label ?? `${agreement.version}.0 draft`}
              annotations={annotations.layer}
            />
          </CardContent>
        </Card>

        {/* Right — action rail */}
        <aside className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {AGREEMENT_STATUS_LABELS[status]}
              </div>
              {primaryAction()}
              {openRequests.length > 0 ? (
                <p className="text-xs text-warning">
                  {openRequests.length} open change request{openRequests.length === 1 ? '' : 's'} —
                  pinned on the document, and answerable from the Requests tab.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <Tabs defaultValue="activity">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>
                  <TabsTrigger value="versions" className="text-xs">Versions</TabsTrigger>
                  <TabsTrigger value="requests" className="text-xs">
                    Requests{openRequests.length ? ` (${openRequests.length})` : ''}
                  </TabsTrigger>
                  <TabsTrigger value="execution" className="text-xs">Execution</TabsTrigger>
                </TabsList>
                <TabsContent value="activity" className="mt-4 max-h-[50vh] overflow-y-auto">
                  <AgreementTimeline events={data?.events ?? []} />
                </TabsContent>
                <TabsContent value="versions" className="mt-4 max-h-[50vh] overflow-y-auto">
                  <VersionHistory versions={data?.issued_versions ?? []} />
                </TabsContent>
                {/* The same rail the partner writes in, answered from here.
                    Selecting a thread highlights its pin on the document to the
                    left, so "which clause did they mean" stops being a
                    question anybody has to ask. */}
                <TabsContent value="requests" className="mt-4 max-h-[50vh] overflow-y-auto">
                  <AnnotationRail
                    annotations={annotations.placed}
                    activeId={annotations.activeId}
                    onSelect={annotations.select}
                    resolvingId={resolveChangeRequest.isPending ? annotations.activeId : null}
                    emptyHint="The partner has not requested any changes."
                    onResolve={(requestId, resolution, note) =>
                      resolveChangeRequest.mutate({
                        id: agreement.id, request_id: requestId, resolution, resolution_note: note,
                      })}
                  />
                </TabsContent>
                <TabsContent value="execution" className="mt-4 space-y-2">
                  {(data?.signatures ?? []).length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">No signatures yet.</p>
                  ) : (
                    (data?.signatures ?? []).map((signature) => (
                      <div key={signature.id} className="rounded-lg border border-border bg-card/50 px-3 py-2.5 text-sm">
                        <div className="font-medium text-foreground">
                          {signature.party_role === 'partner' ? 'Finance Partner' : 'Issuing Organisation'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {signature.signatory_name}
                          {signature.signatory_title ? ` · ${signature.signatory_title}` : ''}
                          {signature.signed_at ? ` — ${format(new Date(signature.signed_at), 'd MMM yyyy · h:mm a')}` : ''}
                        </div>
                      </div>
                    ))
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </aside>
      </div>

      {/* Internal review decision */}
      <Dialog open={reviewDialog !== null} onOpenChange={(open) => { if (!open) setReviewDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{reviewDialog === 'approve' ? 'Approve for issue' : 'Return to draft'}</DialogTitle>
            <DialogDescription>
              {reviewDialog === 'approve'
                ? 'Confirm the parties, branding and commercial variables are correct. Approval makes this agreement Ready to Issue.'
                : 'Send the agreement back for further preparation. Add a note so the owner knows what to fix.'}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reviewNotes}
            onChange={(event) => setReviewNotes(event.target.value)}
            placeholder="Review notes (optional)…"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialog(null)}>Cancel</Button>
            <Button
              disabled={recordReview.isPending}
              onClick={() => {
                recordReview.mutate(
                  { id: agreement.id, decision: reviewDialog === 'approve' ? 'approved' : 'returned', notes: reviewNotes },
                  { onSuccess: () => setReviewDialog(null) },
                );
              }}
            >
              {recordReview.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {reviewDialog === 'approve' ? 'Approve' : 'Return'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Withdraw */}
      <Dialog open={withdrawDialog} onOpenChange={setWithdrawDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Withdraw agreement</DialogTitle>
            <DialogDescription>
              The partner will see that this agreement is no longer available for execution. The
              issued version and the full audit record are preserved.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={withdrawReason}
            onChange={(event) => setWithdrawReason(event.target.value)}
            placeholder="Reason (recorded in the activity history)…"
            rows={2}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawDialog(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={withdraw.isPending}
              onClick={() => withdraw.mutate(
                { id: agreement.id, reason: withdrawReason },
                { onSuccess: () => setWithdrawDialog(false) },
              )}
            >
              {withdraw.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Withdraw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Counter-signature */}
      <SignatureDialog
        open={counterSignOpen}
        onOpenChange={setCounterSignOpen}
        title="Counter-sign agreement"
        description="The partner has signed. Your signature completes execution — the executed master copy is generated and stored automatically."
        legalEntity={agreement.principal_legal_name}
        confirmLabel="Sign & execute"
        pending={counterSign.isPending}
        onSign={(signature) => counterSign.mutate(
          { id: agreement.id, ...signature },
          { onSuccess: () => setCounterSignOpen(false) },
        )}
      />

      <AgreementDispositionDialog
        mode={disposition}
        agreementLabel={agreement.partner_legal_name}
        pending={dispositionPending}
        onOpenChange={(open) => { if (!open) setDisposition(null); }}
        onConfirm={runDisposition}
      />

      <PdfPreviewDialog agreementId={pdfPreviewId} onOpenChange={(open) => { if (!open) setPdfPreviewId(null); }} />

      <SendAgreementDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        partnerName={agreement.partner_legal_name}
        partnerEmail={(agreement as { partner_contact_email?: string | null }).partner_contact_email ?? null}
        versionLabel={currentVersion?.version_label ?? null}
        awaitingActivation={delivery === 'awaiting_activation'}
        sending={sendAgreement.isPending}
        onSend={({ additionalRecipients, note, notifyPortal }) => {
          sendAgreement.mutate({
            id: agreement.id,
            additionalRecipients,
            note,
            notifyPortal,
            // Anything after the issue itself is a resend, and the partner
            // should be told which one they are reading.
            isResend: true,
          }, { onSuccess: () => setSendOpen(false) });
        }}
      />
    </div>
  );
}
