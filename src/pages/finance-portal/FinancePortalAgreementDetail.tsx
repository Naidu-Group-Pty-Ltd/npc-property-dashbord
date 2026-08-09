/**
 * Finance Partner Portal — the agreement room.
 *
 * The agreement opens INSIDE the portal as a digital document: full text,
 * section navigation, version and issuer identity, a reference-copy download —
 * not a generic PDF in another tab. The partner can accept and sign, or lodge
 * a structured change request; the legal body is never editable. Mobile is a
 * first-class layout: everything stacks, and the action bar leads.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft, CheckCircle2, Download, FileSignature, Loader2, MessageSquareWarning, ShieldCheck,
} from 'lucide-react';
import { useFinancePortalAuth } from '@/hooks/useFinancePortalAuth';
import { CHANGE_REQUEST_SECTIONS, type AgreementTemplateKey } from '@/lib/agreements';
import DigitalAgreementView, { agreementSectionNav } from '@/components/agreement-centre/DigitalAgreementView';
import AgreementTimeline from '@/components/agreement-centre/AgreementTimeline';
import SignatureDialog from '@/components/agreement-centre/SignatureDialog';
import { PARTNER_STATUS_LABELS, partnerStatusBadge } from './FinancePortalAgreements';

interface RoomPayload {
  agreement: Record<string, unknown> & {
    id: string; title: string; template_key: AgreementTemplateKey; status: string;
    partner_legal_name: string | null;
    principal_legal_name: string | null; principal_trading_name: string | null;
    issued_at: string | null; accepted_at: string | null; executed_at: string | null;
  };
  current_version: {
    id: string; version_label: string; field_values: Record<string, unknown>;
    changed_fields: { field: string; label: string; previous: unknown; updated: unknown }[];
    issued_at: string; status: string;
  } | null;
  change_requests: {
    id: string; section_key: string; comment: string; status: string;
    resolution_note: string | null; created_at: string;
  }[];
  signatures: {
    id: string; version_id: string; party_role: string; legal_entity: string | null;
    signatory_name: string | null; signatory_title: string | null; signed_at: string | null;
  }[];
  events: { event_type: string; actor_label: string | null; summary: string | null; created_at: string }[];
}

export default function FinancePortalAgreementDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { invokeFinanceFunction } = useFinancePortalAuth();

  const [signOpen, setSignOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestSection, setRequestSection] = useState<string>('commercial_schedule');
  const [requestComment, setRequestComment] = useState('');
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['finance-portal-agreement', id],
    enabled: !!id,
    queryFn: async () => {
      const { data: payload, error } = await invokeFinanceFunction('finance-portal-agreements', {
        operation: 'get', id,
      });
      if (error) throw new Error(error.message ?? 'Failed to load the agreement');
      if ((payload as { error?: string })?.error) throw new Error((payload as { error: string }).error);
      return payload as RoomPayload;
    },
  });

  const agreement = data?.agreement ?? null;
  const status = String(agreement?.status ?? '');

  useEffect(() => {
    document.title = `${agreement?.title ?? 'Agreement'} | Finance Portal`;
  }, [agreement?.title]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['finance-portal-agreement', id] });
    queryClient.invalidateQueries({ queryKey: ['finance-portal-agreements'] });
  };

  const act = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data: result, error } = await invokeFinanceFunction('finance-portal-agreements', payload);
      if (error) throw new Error(error.message ?? 'Action failed');
      if ((result as { error?: string })?.error) throw new Error((result as { error: string }).error);
      return result;
    },
    onSuccess: () => invalidate(),
    onError: (error: Error) => toast.error(error.message),
  });

  const download = async (kind: 'issued' | 'executed') => {
    try {
      setDownloading(true);
      const { data: result, error } = await invokeFinanceFunction('finance-portal-agreements', {
        operation: 'download', id, kind,
      });
      if (error) throw new Error(error.message ?? 'Download failed');
      const payload = result as { url?: string; error?: string };
      if (payload.error) throw new Error(payload.error);
      if (payload.url) window.open(payload.url, '_blank', 'noopener');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const values = data?.current_version?.field_values ?? {};
  const versionSignatures = useMemo(
    () => (data?.signatures ?? []).filter((signature) =>
      !data?.current_version || signature.version_id === data.current_version.id),
    [data],
  );

  if (isLoading || !agreement) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const issuerName = agreement.principal_trading_name || agreement.principal_legal_name || 'the issuing organisation';
  const sections = agreementSectionNav(agreement.template_key, false, values);
  const changedFields = data?.current_version?.changed_fields ?? [];

  const actionBar = () => {
    switch (status) {
      case 'partner_review':
        return (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" disabled={act.isPending}
              onClick={() => act.mutate({ operation: 'accept', id })}>
              {act.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Accept & Continue to Sign
            </Button>
            <Button variant="outline" className="flex-1" disabled={act.isPending}
              onClick={() => { setRequestComment(''); setRequestOpen(true); }}>
              <MessageSquareWarning className="mr-2 h-4 w-4" /> Request Changes
            </Button>
          </div>
        );
      case 'sent_for_signature':
        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> Agreement accepted — signature required
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1" onClick={() => setSignOpen(true)}>
                <FileSignature className="mr-2 h-4 w-4" /> Sign Agreement
              </Button>
              <Button variant="outline" disabled={act.isPending}
                onClick={() => { setRequestComment(''); setRequestOpen(true); }}>
                Request Changes
              </Button>
            </div>
          </div>
        );
      case 'changes_requested':
        return (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
            Your change request has been sent. The issuing organisation will respond or issue an
            updated version.
          </div>
        );
      case 'partially_signed':
        return (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
            Signed by your organisation — awaiting counter-signature from {issuerName}.
          </div>
        );
      case 'active':
        return (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-success">
              <ShieldCheck className="h-4 w-4" /> Fully executed
              {agreement.executed_at ? ` — ${format(new Date(String(agreement.executed_at)), 'd MMM yyyy')}` : ''}
            </div>
            <Button disabled={downloading} onClick={() => download('executed')}>
              {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Download Executed Copy
            </Button>
          </div>
        );
      case 'withdrawn':
        return (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
            This agreement has been withdrawn by {issuerName} and is no longer available for execution.
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <header className="space-y-2">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate('/finance/agreements')}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Agreements
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-serif text-xl font-semibold leading-snug text-foreground sm:text-2xl">
              {agreement.title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Issued by {issuerName}
              {agreement.issued_at ? ` · ${format(new Date(String(agreement.issued_at)), 'd MMM yyyy')}` : ''}
              {data?.current_version ? ` · Version ${data.current_version.version_label}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={partnerStatusBadge(status)}>
              {PARTNER_STATUS_LABELS[status] ?? status}
            </Badge>
            <Button variant="outline" size="sm" disabled={downloading} onClick={() => download('issued')}>
              {downloading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              Reference copy
            </Button>
          </div>
        </div>
      </header>

      <Card className="border-primary/30">
        <CardContent className="p-4">{actionBar()}</CardContent>
      </Card>

      {changedFields.length > 0 ? (
        <Card>
          <CardContent className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              Updated in Version {data?.current_version?.version_label}
            </div>
            <div className="mt-2 space-y-1.5">
              {changedFields.map((change) => (
                <div key={change.field} className="text-sm">
                  <span className="font-medium text-foreground">{change.label}</span>
                  <span className="text-muted-foreground"> — previous: </span>
                  <span className="text-muted-foreground line-through">{String(change.previous ?? '—') || '—'}</span>
                  <span className="text-muted-foreground"> · updated: </span>
                  <span className="font-medium text-foreground">{String(change.updated ?? '—') || '—'}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav className="sticky top-4 space-y-0.5">
            {sections.map((section) => (
              <a key={section.id} href={`#agc-${section.id}`}
                className="flex items-baseline gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground">
                <span className="w-8 shrink-0 font-mono text-[10px] text-primary">{section.badge}</span>
                <span className="truncate">{section.heading}</span>
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardContent className="p-4 sm:p-6">
              <DigitalAgreementView
                templateKey={agreement.template_key}
                values={values}
                signatures={versionSignatures}
                versionLabel={data?.current_version?.version_label}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <Tabs defaultValue="activity">
                <TabsList>
                  <TabsTrigger value="activity" className="text-xs">Activity</TabsTrigger>
                  <TabsTrigger value="requests" className="text-xs">
                    Your requests{data?.change_requests?.length ? ` (${data.change_requests.length})` : ''}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="activity" className="mt-4">
                  <AgreementTimeline events={data?.events ?? []} />
                </TabsContent>
                <TabsContent value="requests" className="mt-4 space-y-3">
                  {(data?.change_requests ?? []).length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">No change requests.</p>
                  ) : (
                    (data?.change_requests ?? []).map((request) => (
                      <div key={request.id} className="rounded-lg border border-border bg-card/50 p-3.5">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-medium text-foreground">
                            {CHANGE_REQUEST_SECTIONS.find((section) => section.key === request.section_key)?.label ?? 'Other'}
                          </span>
                          <span className="text-muted-foreground">
                            {format(new Date(request.created_at), 'd MMM yyyy')}
                          </span>
                          <Badge variant="outline" className={request.status === 'open'
                            ? 'bg-warning/15 text-warning border-warning/30'
                            : request.status === 'resolved'
                              ? 'bg-success/15 text-success border-success/30'
                              : 'bg-muted text-muted-foreground border-border'}>
                            {request.status === 'open' ? 'Open' : request.status === 'resolved' ? 'Resolved' : 'Declined'}
                          </Badge>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">{request.comment}</p>
                        {request.resolution_note ? (
                          <p className="mt-2 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                            Response: {request.resolution_note}
                          </p>
                        ) : null}
                      </div>
                    ))
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Structured change request — never an edit. */}
      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request changes</DialogTitle>
            <DialogDescription>
              Describe what you need changed. The issuing organisation will respond or issue an
              updated version — the current document stays on record unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={requestSection} onValueChange={setRequestSection}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHANGE_REQUEST_SECTIONS.map((section) => (
                  <SelectItem key={section.key} value={section.key}>{section.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              value={requestComment}
              onChange={(event) => setRequestComment(event.target.value)}
              placeholder="Please provide details…"
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRequestOpen(false)}>Cancel</Button>
            <Button
              disabled={!requestComment.trim() || act.isPending}
              onClick={() => act.mutate(
                { operation: 'request_changes', id, section_key: requestSection, comment: requestComment },
                { onSuccess: () => { setRequestOpen(false); toast.success('Change request sent'); } },
              )}
            >
              {act.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Execution */}
      <SignatureDialog
        open={signOpen}
        onOpenChange={setSignOpen}
        title="Sign agreement"
        description={`Version ${data?.current_version?.version_label ?? ''} of ${agreement.title}. Your typed signature executes the agreement for your organisation.`}
        legalEntity={String(agreement.partner_legal_name ?? '') || null}
        confirmLabel="Sign agreement"
        pending={act.isPending}
        onSign={(signature) => act.mutate(
          { operation: 'sign', id, ...signature },
          { onSuccess: () => { setSignOpen(false); toast.success('Signed — awaiting counter-signature'); } },
        )}
      />
    </div>
  );
}
