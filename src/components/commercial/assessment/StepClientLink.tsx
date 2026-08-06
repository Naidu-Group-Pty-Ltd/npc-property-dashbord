import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Check, Link2, Loader2, Search, Unlink, User, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ciAssessmentApi, type ClientSearchRow } from '@/hooks/useCiAssessments';
import { fetchClientProfile } from '@/utils/commercial/clientPortfolioRepository';
import {
  buildReconciliationPlan, reconcileAssessmentWithClient,
  type ReconciliationDisposition, type ReconciliationItem, type ReconciliationSummary,
} from '@/lib/ciAssessment/reconciliation';
import type { AssessmentPayload } from '@/lib/ciAssessment/types';
import { prefillFromAssessment } from './clientPrefill';
import { toast } from '@/hooks/use-toast';

const DISPOSITION_OPTIONS: ReadonlyArray<{ value: ReconciliationDisposition; label: string }> = [
  { value: 'assessment_only', label: 'Keep in assessment only' },
  { value: 'update_client', label: 'Update the client record' },
  { value: 'create_portfolio_item', label: 'Create a new portfolio item' },
  { value: 'update_portfolio_item', label: 'Update the existing portfolio item' },
];

const CATEGORY_TONE: Record<ReconciliationItem['category'], string> = {
  matching: 'ci-status-good',
  new: 'ci-status-progress',
  conflicting: 'ci-status-warn',
  outdated: 'ci-status-warn',
  excluded: 'ci-status-neutral',
};

function clientLabel(client: ClientSearchRow): string {
  return [client.primary_first_name, client.primary_surname].filter(Boolean).join(' ') || 'Unnamed client';
}

function renderValue(value: unknown): string {
  if (value == null) return 'Not present';
  if (typeof value === 'number') return value.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${key}: ${typeof entry === 'number' ? entry.toLocaleString('en-AU') : String(entry)}`)
      .join(' · ');
  }
  return String(value);
}

interface Props {
  assessmentId: string;
  payload: AssessmentPayload;
  linkedClientId: string | null;
  onLinked: () => void;
  canLink: boolean;
  canUpdateClient: boolean;
}

/**
 * Final step — client association.
 *
 * The sequence is deliberate and enforced: search → confirm the right client →
 * reconcile every field → choose a disposition per item → link. Nothing is
 * written to the client record except the items explicitly set to update it,
 * and the whole decision set is stored on the link for audit.
 */
export function StepClientLink({
  assessmentId, payload, linkedClientId, onLinked, canLink, canUpdateClient,
}: Props) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [clients, setClients] = useState<ClientSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ClientSearchRow | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [reconciliation, setReconciliation] = useState<ReconciliationSummary | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [linking, setLinking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ---- Create a new client ----------------------------------------------
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(() => ({
    ...prefillFromAssessment(payload), email: '', mobile: '',
  }));

  const createAndSelect = useCallback(async () => {
    if (!draft.firstName.trim() && !draft.surname.trim()) {
      toast({ title: 'A name is required', description: 'Enter at least a first name or surname.', variant: 'destructive' });
      return;
    }
    setCreating(true);
    const result = await ciAssessmentApi.createClient({
      firstName: draft.firstName.trim(),
      surname: draft.surname.trim(),
      email: draft.email.trim() || undefined,
      mobile: draft.mobile.trim() || undefined,
      assessmentId,
    });
    setCreating(false);

    if (result.error || !result.data) {
      toast({ title: 'Could not create the client', description: result.error ?? 'Try again.', variant: 'destructive' });
      return;
    }

    toast({
      title: 'Client created',
      description: `${clientLabel(result.data)} was added to your client book.`,
    });
    // Straight into the existing flow: the new client becomes the selected
    // client, and confirmation + reconciliation + linking run exactly as they
    // do for one found by search. One path, not two.
    setCreatingOpen(false);
    setSelected(result.data);
    setConfirmed(false);
    setReconciliation(null);
  }, [draft, assessmentId]);

  // Debounced so typing a name does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    ciAssessmentApi.searchClients(debouncedSearch).then((result) => {
      if (cancelled) return;
      setClients(result.data ?? []);
      setSearching(false);
    });
    return () => { cancelled = true; };
  }, [debouncedSearch]);

  const confirmClient = useCallback(async (client: ClientSearchRow) => {
    setConfirmed(true);
    setLoadingProfile(true);
    try {
      const profile = await fetchClientProfile(client.id);
      setReconciliation(reconcileAssessmentWithClient(payload, profile));
    } catch (error) {
      toast({
        title: 'Could not load the client portfolio',
        description: error instanceof Error ? error.message : 'Try again, or link without reconciling.',
        variant: 'destructive',
      });
      setConfirmed(false);
    } finally {
      setLoadingProfile(false);
    }
  }, [payload]);

  const setDisposition = (itemId: string, disposition: ReconciliationDisposition) => {
    setReconciliation((current) => current && ({
      ...current,
      items: current.items.map((item) => (item.id === itemId ? { ...item, disposition } : item)),
    }));
  };

  const plan = useMemo(
    () => (reconciliation ? buildReconciliationPlan(reconciliation.items) : null),
    [reconciliation],
  );

  const mutatingCount = plan
    ? plan.clientUpdates.length + plan.portfolioCreates.length + plan.portfolioUpdates.length
    : 0;

  const doLink = async () => {
    if (!selected || !reconciliation) return;
    setLinking(true);
    const applied = reconciliation.items
      .filter((item) => item.disposition !== 'assessment_only')
      .map((item) => ({
        id: item.id, field: item.field, section: item.section,
        disposition: item.disposition, value: item.assessmentValue,
        clientRecordId: item.clientRecordId ?? null,
      }));

    const result = await ciAssessmentApi.linkClient({
      assessmentId,
      clientId: selected.id,
      reconciliationItems: reconciliation.items,
      appliedChanges: applied,
    });
    setLinking(false);
    setConfirmOpen(false);

    if (result.error) {
      toast({ title: 'Link failed', description: result.error, variant: 'destructive' });
      return;
    }
    toast({
      title: 'Assessment linked',
      description: mutatingCount
        ? `${mutatingCount} item(s) recorded for the client record.`
        : 'Linked without changing any client data.',
    });
    onLinked();
  };

  const doUnlink = async () => {
    setLinking(true);
    const result = await ciAssessmentApi.unlinkClient(assessmentId);
    setLinking(false);
    if (result.error) {
      toast({ title: 'Unlink failed', description: result.error, variant: 'destructive' });
      return;
    }
    toast({ title: 'Assessment unlinked', description: 'The assessment and its audit history are preserved.' });
    onLinked();
  };

  // ---- Already linked ------------------------------------------------------
  if (linkedClientId) {
    return (
      <div className="ci-step-panel space-y-4">
        <h2 className="ci-step-heading">Client link</h2>
        <div className="ci-warning-row ci-warning-info">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium text-foreground">This assessment is linked to a client record.</p>
            <p className="mt-0.5 text-sm">
              Unlinking preserves the assessment, its calculation history and its audit trail — it only
              removes the association.
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={doUnlink} disabled={linking || !canLink}>
          <Unlink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Unlink from client
        </Button>
      </div>
    );
  }

  return (
    <div className="ci-step-panel space-y-5">
      <div>
        <h2 className="ci-step-heading">Save and link</h2>
        <p className="ci-step-description">
          The assessment is complete and stands on its own. Linking it to a client is optional, happens
          here and nowhere earlier, and never changes client data without your explicit instruction.
        </p>
      </div>

      {!canLink ? (
        <div className="ci-warning-row ci-warning-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            You do not have permission to link assessments to client records. The assessment remains
            saved and can be exported without linking.
          </span>
        </div>
      ) : null}

      {/* ---- 1. Search --------------------------------------------------- */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">1. Find the client</h3>
        <div className="max-w-md">
          <Label htmlFor="client-search" className="ci-field-label">Search your clients</Label>
          <div className="relative mt-1.5">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="client-search"
              value={search}
              disabled={!canLink}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name or email"
              className="pl-9"
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Only clients you are authorised to access appear here.
          </p>
        </div>

        {searching ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Searching…
          </p>
        ) : !clients.length ? (
          <p className="text-sm text-muted-foreground">No matching clients.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Matching clients">
            {clients.map((client) => (
              <li key={client.id}>
                <button
                  type="button"
                  disabled={!canLink}
                  aria-pressed={selected?.id === client.id}
                  className={cn('ci-client-option', selected?.id === client.id && 'ci-client-option-active')}
                  onClick={() => { setSelected(client); setConfirmed(false); setReconciliation(null); }}
                >
                  <span className="flex min-w-0 items-start gap-2.5">
                    <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-foreground">{clientLabel(client)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{client.primary_email || 'No email recorded'}</span>
                      <span className="block truncate text-xs text-muted-foreground">{client.primary_mobile || 'No phone recorded'}</span>
                    </span>
                  </span>
                  {selected?.id === client.id ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- 1b. Or create ------------------------------------------------ */}
      <section className="space-y-3">
        {!creatingOpen ? (
          <Button
            variant="outline" size="sm" disabled={!canLink}
            onClick={() => setCreatingOpen(true)}
          >
            <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Create a new client instead
          </Button>
        ) : (
          <div className="rounded-lg border border-border bg-muted/25 p-4">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">Create a new client</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Prefilled from this assessment where possible — check it before creating. The client is
              added to your book and then linked through the same confirmation and reconciliation steps.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="new-client-first" className="ci-field-label">First name</Label>
                <Input
                  id="new-client-first" className="mt-1.5" value={draft.firstName}
                  onChange={(event) => setDraft((d) => ({ ...d, firstName: event.target.value }))}
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="new-client-surname" className="ci-field-label">Surname</Label>
                <Input
                  id="new-client-surname" className="mt-1.5" value={draft.surname}
                  onChange={(event) => setDraft((d) => ({ ...d, surname: event.target.value }))}
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="new-client-email" className="ci-field-label">Email</Label>
                <Input
                  id="new-client-email" className="mt-1.5" type="email" value={draft.email}
                  onChange={(event) => setDraft((d) => ({ ...d, email: event.target.value }))}
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="new-client-mobile" className="ci-field-label">Mobile</Label>
                <Input
                  id="new-client-mobile" className="mt-1.5" value={draft.mobile}
                  onChange={(event) => setDraft((d) => ({ ...d, mobile: event.target.value }))}
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={createAndSelect} disabled={creating}>
                {creating
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  : <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                {creating ? 'Creating…' : 'Create client'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCreatingOpen(false)} disabled={creating}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ---- 2. Confirm --------------------------------------------------- */}
      {selected && !confirmed ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">2. Confirm this is the right client</h3>
          <div className="rounded-lg border border-border bg-muted/25 p-4">
            <p className="text-sm font-semibold text-foreground">{clientLabel(selected)}</p>
            <dl className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
              <div className="flex gap-2"><dt className="text-muted-foreground">Email</dt><dd className="text-foreground">{selected.primary_email || '—'}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground">Phone</dt><dd className="text-foreground">{selected.primary_mobile || '—'}</dd></div>
            </dl>
            <Button className="mt-3" size="sm" onClick={() => confirmClient(selected)} disabled={loadingProfile}>
              {loadingProfile ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Confirm and reconcile
            </Button>
          </div>
        </section>
      ) : null}

      {/* ---- 3. Reconcile ------------------------------------------------- */}
      {reconciliation ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">3. Reconcile against the client record</h3>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="ci-status-badge ci-status-good">{reconciliation.counts.matching} matching</Badge>
              <Badge variant="outline" className="ci-status-badge ci-status-progress">{reconciliation.counts.new} new</Badge>
              <Badge variant="outline" className="ci-status-badge ci-status-warn">{reconciliation.counts.conflicting} conflicting</Badge>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Choose what happens to each item. Anything left as &ldquo;keep in assessment only&rdquo; leaves the
            client record untouched.
          </p>

          {reconciliation.duplicateWarnings.length ? (
            <div className="ci-warning-row ci-warning-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <div>
                <p className="font-medium text-foreground">Possible duplicates</p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {reconciliation.duplicateWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            </div>
          ) : null}

          {!reconciliation.items.length ? (
            <p className="text-sm text-muted-foreground">
              This assessment holds no portfolio, liability or income data to reconcile.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {reconciliation.items.map((item) => (
                <li key={item.id} className="ci-reconcile-item">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{item.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.reason}</p>
                    </div>
                    <span className={cn('ci-status-badge', CATEGORY_TONE[item.category])}>{item.category}</span>
                  </div>

                  <div className="ci-reconcile-compare">
                    <div className="ci-reconcile-side">
                      <p className="ci-reconcile-side-label">In this assessment</p>
                      <p className="ci-reconcile-side-value">{renderValue(item.assessmentValue)}</p>
                    </div>
                    <div className="ci-reconcile-side">
                      <p className="ci-reconcile-side-label">On the client record</p>
                      <p className="ci-reconcile-side-value">{renderValue(item.clientValue)}</p>
                    </div>
                  </div>

                  <div className="mt-2.5 max-w-sm">
                    <Label htmlFor={`disposition-${item.id}`} className="ci-field-label">Action</Label>
                    <Select
                      value={item.disposition}
                      onValueChange={(value) => setDisposition(item.id, value as ReconciliationDisposition)}
                      disabled={!canUpdateClient}
                    >
                      <SelectTrigger id={`disposition-${item.id}`} className="mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DISPOSITION_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!canUpdateClient ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        You can link this assessment but not write back to the client record.
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button onClick={() => setConfirmOpen(true)} disabled={linking || !canLink}>
              <Link2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Link to {clientLabel(selected!)}
            </Button>
            <p className="text-sm text-muted-foreground">
              {mutatingCount === 0
                ? 'No client data will be changed.'
                : `${mutatingCount} item(s) will be recorded against the client record.`}
            </p>
          </div>
        </section>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Link this assessment to {selected ? clientLabel(selected) : 'the client'}?</AlertDialogTitle>
            <AlertDialogDescription>
              {mutatingCount === 0
                ? 'The assessment will be associated with this client. No client data will be changed.'
                : `${mutatingCount} reconciliation item(s) will be recorded against the client record. Who linked it, when, and exactly what changed are all written to the audit trail.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={linking}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doLink} disabled={linking}>
              {linking ? 'Linking…' : 'Confirm link'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
