import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, CircleSlash, HelpCircle, History,
  Loader2, RefreshCw, RotateCcw, ShieldCheck, XCircle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { toast } from 'sonner';

/**
 * Builder / Developer Portal release management.
 *
 * Mirrors the Solicitor controlled-cutover and observability construction
 * (CrossPortalCutoverPanel + OperationalObservabilityPanel) rather than
 * inventing a Builder-specific design. What differs is domain, not pattern:
 *
 *   * Only Builder and shared feature definitions are listed. The server
 *     filters too; this is presentation, not authorization.
 *   * Every call goes to `builder-portal-admin`, which is gated on the
 *     `builder_portal_admin` module permission. `legal-matters-admin` is never
 *     called from here.
 *   * Nothing writes `cross_portal_*` directly — those tables are revoked from
 *     anon and authenticated, so a browser could not write them even if this
 *     component tried.
 *   * Builder is greenfield, so dual_read and dual_write are absent by design
 *     and legacy comparison checks render as explicitly not applicable.
 */

const APPROVAL_TYPES = [
  { value: 'technical', label: 'Technical' },
  { value: 'security', label: 'Security' },
  { value: 'operations', label: 'Operations' },
  { value: 'business_owner', label: 'Business owner' },
] as const;

/**
 * The Builder transition graph, mirroring
 * `builder_rollout_transition_allowed`. The database is the authority; this
 * only decides which buttons to offer.
 */
const NEXT_MODE: Record<string, string | undefined> = {
  off: 'shadow',
  shadow: 'cutover',
  rollback: 'shadow',
};

const MODE_META: Record<string, { label: string; description: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  off: {
    label: 'Off',
    description: 'The external portal is blocked for this organisation.',
    variant: 'outline',
  },
  shadow: {
    label: 'Shadow',
    description: 'Provisioned and internally verifiable. The external portal is still blocked — this is the observation stage before going live.',
    variant: 'secondary',
  },
  cutover: {
    label: 'Live',
    description: 'This organisation’s external users can sign in and use the portal.',
    variant: 'default',
  },
  rollback: {
    label: 'Rolled back',
    description: 'Access is disabled. All organisation data is preserved.',
    variant: 'destructive',
  },
};

const CHECK_META: Record<string, { icon: typeof CheckCircle2; className: string; label: string }> = {
  pass: { icon: CheckCircle2, className: 'text-success', label: 'Pass' },
  fail: { icon: XCircle, className: 'text-destructive', label: 'Fail' },
  unknown: { icon: HelpCircle, className: 'text-warning', label: 'Unknown' },
  not_applicable: { icon: CircleSlash, className: 'text-muted-foreground', label: 'Not applicable' },
};

interface Organisation {
  id: string;
  legal_name: string;
  trading_name: string | null;
}

interface Definition {
  feature_key: string;
  description: string;
  default_mode: string;
  legacy_removal_target: string;
  minimum_stable_days: number;
  portal: string;
  legacy_comparison_applicable: boolean;
  runtime_consumed: boolean;
  not_applicable_reason: string | null;
}

interface Rollout {
  id: string;
  feature_key: string;
  mode: string;
  reason: string;
  changed_at: string;
  stable_since: string | null;
  row_version: number;
}

interface HistoryRow {
  id: string;
  feature_key: string;
  from_mode: string | null;
  to_mode: string;
  reason: string;
  changed_at: string;
}

interface Approval {
  id: string;
  feature_key: string;
  approval_type: string;
  evidence_reference: string;
  approved_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
}

interface ReadinessCheck {
  key: string;
  required: boolean;
  status: 'pass' | 'fail' | 'unknown' | 'not_applicable';
  detail: string;
}

interface Readiness {
  ready: boolean;
  feature_key: string;
  current_mode: string;
  minimum_stable_days: number;
  required_failures: number;
  unknown_required: number;
  runtime_consumed: boolean;
  checks: ReadinessCheck[];
  evaluated_at: string;
}

const humanise = (key: string) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export function AdminBuilderReleasePanel({
  organisations,
  canEdit,
}: {
  organisations: Organisation[];
  canEdit: boolean;
}) {
  const [organisationId, setOrganisationId] = useState('');
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [rollouts, setRollouts] = useState<Rollout[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [readiness, setReadiness] = useState<Record<string, Readiness>>({});
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Transition dialog. Every transition requires a typed reason — the database
  // rejects a blank one, so collecting it here is the only way the button can
  // succeed.
  const [pending, setPending] = useState<{ featureKey: string; mode: string; version: number | null } | null>(null);
  const [reason, setReason] = useState('');

  // Approval dialog.
  const [approving, setApproving] = useState<{ featureKey: string; type: string } | null>(null);
  const [evidence, setEvidence] = useState('');
  const [revoking, setRevoking] = useState<{ featureKey: string; type: string } | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  useEffect(() => {
    if (!organisationId && organisations[0]) setOrganisationId(organisations[0].id);
  }, [organisationId, organisations]);

  const load = useCallback(async () => {
    if (!organisationId) return;
    setLoading(true);
    const [rollout, healthResult] = await Promise.all([
      invokeSecureFunction('builder-portal-admin', {
        operation: 'list_builder_rollouts', organisation_id: organisationId,
      }),
      invokeSecureFunction('builder-portal-admin', {
        operation: 'get_builder_operational_health', organisation_id: organisationId,
      }),
    ]);
    setLoading(false);

    if (rollout.error || rollout.data?.error) {
      toast.error(rollout.data?.error || rollout.error?.message || 'Unable to load release controls');
      return;
    }
    setDefinitions(rollout.data.definitions ?? []);
    setRollouts(rollout.data.rollouts ?? []);
    setHistory(rollout.data.history ?? []);
    setApprovals(rollout.data.approvals ?? []);
    setReadiness({});
    if (!healthResult.error && !healthResult.data?.error) setHealth(healthResult.data.health ?? null);
  }, [organisationId]);

  useEffect(() => { void load(); }, [load]);

  const rolloutFor = (featureKey: string) => rollouts.find((r) => r.feature_key === featureKey);
  const modeFor = (definition: Definition) =>
    rolloutFor(definition.feature_key)?.mode ?? definition.default_mode;

  const activeApprovals = (featureKey: string) =>
    approvals.filter((a) => a.feature_key === featureKey && !a.revoked_at);

  const checkReadiness = async (featureKey: string) => {
    setBusyKey(featureKey);
    const { data, error } = await invokeSecureFunction('builder-portal-admin', {
      operation: 'get_builder_readiness', organisation_id: organisationId, feature_key: featureKey,
    });
    setBusyKey(null);
    if (error || data?.error) {
      toast.error(data?.error || error?.message || 'Readiness check failed');
      return;
    }
    setReadiness((current) => ({ ...current, [featureKey]: data.readiness }));
  };

  const submitTransition = async () => {
    if (!pending) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toast.error('A reason is required for every rollout transition');
      return;
    }
    setBusyKey(pending.featureKey);
    const { data, error } = await invokeSecureFunction('builder-portal-admin', {
      operation: 'set_builder_rollout',
      organisation_id: organisationId,
      feature_key: pending.featureKey,
      mode: pending.mode,
      reason: trimmedReason,
      // Omitted for the very first transition, when no mutable row exists yet.
      ...(pending.version === null ? {} : { expected_version: pending.version }),
    });
    setBusyKey(null);

    if (error || data?.error) {
      const code = data?.code;
      if (code === 'stale_write') {
        toast.error('This rollout changed since you loaded it. Refreshing.');
        await load();
      } else if (code === 'readiness_failed') {
        toast.error('Cutover is blocked: required readiness checks are not satisfied.');
        await checkReadiness(pending.featureKey);
      } else {
        toast.error(data?.error || error?.message || 'Transition blocked');
      }
      return;
    }

    toast.success(pending.mode === 'rollback' ? 'Rollback activated' : `Rollout moved to ${pending.mode}`);
    setPending(null);
    setReason('');
    await load();
  };

  const submitApproval = async () => {
    if (!approving) return;
    const trimmedEvidence = evidence.trim();
    if (!trimmedEvidence) {
      toast.error('An evidence reference is required');
      return;
    }
    const { data, error } = await invokeSecureFunction('builder-portal-admin', {
      operation: 'record_builder_approval',
      organisation_id: organisationId,
      feature_key: approving.featureKey,
      approval_type: approving.type,
      evidence_reference: trimmedEvidence,
    });
    if (error || data?.error) {
      toast.error(data?.error || error?.message || 'Approval failed');
      return;
    }
    toast.success('Approval recorded');
    setApproving(null);
    setEvidence('');
    await load();
  };

  const submitRevocation = async () => {
    if (!revoking) return;
    const trimmedReason = revokeReason.trim();
    if (!trimmedReason) {
      toast.error('A revocation reason is required');
      return;
    }
    const { data, error } = await invokeSecureFunction('builder-portal-admin', {
      operation: 'revoke_builder_approval',
      organisation_id: organisationId,
      feature_key: revoking.featureKey,
      approval_type: revoking.type,
      reason: trimmedReason,
    });
    if (error || data?.error) {
      toast.error(data?.error || error?.message || 'Revocation failed');
      return;
    }
    toast.success('Approval revoked');
    setRevoking(null);
    setRevokeReason('');
    await load();
  };

  const openAlerts = useMemo<any[]>(() => health?.open_alerts ?? [], [health]);

  if (!organisations.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Release readiness and controlled rollout</CardTitle>
          <CardDescription>
            Add a Builder organisation before configuring a rollout.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Release readiness and controlled rollout</CardTitle>
            <CardDescription>
              The Builder Portal is enabled one organisation at a time. Rollback is always
              available and never deletes organisation data.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Select value={organisationId} onValueChange={setOrganisationId}>
              <SelectTrigger className="w-64" aria-label="Builder organisation for rollout">
                <SelectValue placeholder="Choose organisation" />
              </SelectTrigger>
              <SelectContent>
                {organisations.map((organisation) => (
                  <SelectItem key={organisation.id} value={organisation.id}>
                    {organisation.trading_name || organisation.legal_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => void load()} aria-label="Refresh release controls">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading release controls" />
            </div>
          ) : (
            <div className="space-y-4">
              {definitions.map((definition) => {
                const mode = modeFor(definition);
                const rollout = rolloutFor(definition.feature_key);
                const meta = MODE_META[mode] ?? { label: mode, description: '', variant: 'outline' as const };
                const next = NEXT_MODE[mode];
                const ready = readiness[definition.feature_key];
                const active = activeApprovals(definition.feature_key);
                const busy = busyKey === definition.feature_key;

                return (
                  <div key={definition.feature_key} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{definition.description}</p>
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                          {!definition.runtime_consumed && (
                            <Badge variant="outline" className="text-muted-foreground">
                              Descriptive only
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{meta.description}</p>
                        {!definition.runtime_consumed && definition.not_applicable_reason && (
                          <p className="mt-1 text-xs text-warning">
                            {definition.not_applicable_reason}
                          </p>
                        )}
                        <p className="mt-2 text-xs text-muted-foreground">
                          Approvals {active.length}/4 · minimum stable window {definition.minimum_stable_days} days
                          {rollout?.stable_since
                            ? ` · in ${mode} since ${new Date(rollout.stable_since).toLocaleDateString()}`
                            : ' · observation window not started'}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" disabled={busy}
                          onClick={() => void checkReadiness(definition.feature_key)}>
                          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                          Check readiness
                        </Button>
                        {canEdit && next && (
                          <Button size="sm" disabled={busy}
                            onClick={() => {
                              setPending({ featureKey: definition.feature_key, mode: next, version: rollout?.row_version ?? null });
                              setReason('');
                            }}>
                            Advance to {MODE_META[next]?.label ?? next}
                          </Button>
                        )}
                        {canEdit && (mode === 'shadow' || mode === 'cutover') && (
                          <Button size="sm" variant="destructive" disabled={busy}
                            onClick={() => {
                              setPending({ featureKey: definition.feature_key, mode: 'rollback', version: rollout?.row_version ?? null });
                              setReason('');
                            }}>
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Roll back
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Four-approval evidence */}
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {APPROVAL_TYPES.map((type) => {
                        const approval = active.find((a) => a.approval_type === type.value);
                        return (
                          <div key={type.value} className="rounded-md border p-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-medium">{type.label}</span>
                              {approval
                                ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Approved" />
                                : <XCircle className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Not approved" />}
                            </div>
                            <p className="mt-1 truncate text-xs text-muted-foreground" title={approval?.evidence_reference}>
                              {approval ? approval.evidence_reference : 'No evidence recorded'}
                            </p>
                            {canEdit && (
                              <Button size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs"
                                onClick={() => {
                                  if (approval) {
                                    setRevoking({ featureKey: definition.feature_key, type: type.value });
                                    setRevokeReason('');
                                  } else {
                                    setApproving({ featureKey: definition.feature_key, type: type.value });
                                    setEvidence('');
                                  }
                                }}>
                                {approval ? 'Revoke' : 'Record approval'}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Readiness evidence */}
                    {ready && (
                      <div className="mt-4 rounded-md border bg-muted/40 p-3">
                        <div className="flex items-center gap-2">
                          {ready.ready
                            ? <CheckCircle2 className="h-4 w-4 text-success" />
                            : <AlertTriangle className="h-4 w-4 text-warning" />}
                          <p className="text-sm font-medium">
                            {ready.ready
                              ? 'Ready for controlled cutover'
                              : `Cutover blocked — ${ready.required_failures} required check(s) failing, ${ready.unknown_required} unknown`}
                          </p>
                        </div>
                        <div className="mt-2 overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-8" />
                                <TableHead>Check</TableHead>
                                <TableHead className="w-28">Requirement</TableHead>
                                <TableHead>Evidence</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {ready.checks.map((check) => {
                                const statusMeta = CHECK_META[check.status] ?? CHECK_META.unknown;
                                const Icon = statusMeta.icon;
                                return (
                                  <TableRow key={check.key}>
                                    <TableCell>
                                      <Icon className={`h-4 w-4 ${statusMeta.className}`} aria-label={statusMeta.label} />
                                    </TableCell>
                                    <TableCell className="text-xs">{humanise(check.key)}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                      {check.status === 'not_applicable'
                                        ? 'Not applicable'
                                        : check.required ? 'Required' : 'Advisory'}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">{check.detail}</TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Evaluated {new Date(ready.evaluated_at).toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Operational health */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Builder operational health</CardTitle>
          <CardDescription>
            Open Builder alerts and the last 24 hours of Builder portal events.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {openAlerts.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No open Builder alerts.
            </p>
          ) : (
            <div className="space-y-2">
              {openAlerts.map((alert) => (
                <Alert key={alert.id} variant={alert.severity === 'critical' ? 'destructive' : 'default'}>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <span className="font-medium">{alert.alert_type}</span> — {alert.summary}
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          )}
          {health?.event_summary && (
            <p className="mt-3 text-xs text-muted-foreground">
              {health.event_summary.events_24h ?? 0} event(s) in 24h ·{' '}
              {health.event_summary.failures_24h ?? 0} failure(s) ·{' '}
              {health.sessions_active ?? 0} active Builder session(s)
            </p>
          )}
        </CardContent>
      </Card>

      {/* Rollout history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rollout history</CardTitle>
          <CardDescription>
            Immutable record of every transition, with the reason given at the time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No transitions recorded for this organisation.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Feature</TableHead>
                    <TableHead>Transition</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(row.changed_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">{row.feature_key}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        <span className="text-muted-foreground">{row.from_mode ?? 'none'}</span>
                        {' → '}
                        <span className="font-medium">{row.to_mode}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Transition confirmation */}
      <Dialog open={!!pending} onOpenChange={(open) => { if (!open) { setPending(null); setReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pending?.mode === 'rollback' ? 'Roll back this organisation' : `Move to ${MODE_META[pending?.mode ?? '']?.label ?? pending?.mode}`}
            </DialogTitle>
            <DialogDescription>
              {pending?.mode === 'rollback'
                ? 'Access is disabled immediately. Projects, inventory, transactions, construction, documents and messages are all preserved — rollback changes who may sign in, never the data.'
                : pending?.mode === 'cutover'
                  ? 'This organisation’s external users will be able to sign in. All four approvals and the minimum stable window must already be satisfied.'
                  : 'The organisation is provisioned and internally verifiable. The external portal stays blocked until cutover.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="builder-rollout-reason">Reason (recorded in history and audit)</Label>
            <Input id="builder-rollout-reason" value={reason} onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Pilot approved at release board 2026-08-14" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setPending(null); setReason(''); }}>Cancel</Button>
            <Button variant={pending?.mode === 'rollback' ? 'destructive' : 'default'}
              disabled={!reason.trim()} onClick={() => void submitTransition()}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approval capture */}
      <Dialog open={!!approving} onOpenChange={(open) => { if (!open) { setApproving(null); setEvidence(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record approval</DialogTitle>
            <DialogDescription>
              Approvals require an evidence reference — a ticket, sign-off document or test run
              a reviewer can independently retrieve.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="builder-approval-evidence">Evidence reference</Label>
            <Input id="builder-approval-evidence" value={evidence} onChange={(event) => setEvidence(event.target.value)}
              placeholder="e.g. REL-2026-08-14 security sign-off" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setApproving(null); setEvidence(''); }}>Cancel</Button>
            <Button disabled={!evidence.trim()} onClick={() => void submitApproval()}>Record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approval revocation */}
      <Dialog open={!!revoking} onOpenChange={(open) => { if (!open) { setRevoking(null); setRevokeReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke approval</DialogTitle>
            <DialogDescription>
              Revoking an approval immediately makes this organisation ineligible for cutover.
              An organisation that is already live is not disabled by this — use rollback for that.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="builder-revoke-reason">Reason</Label>
            <Input id="builder-revoke-reason" value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)}
              placeholder="e.g. Penetration test regression reopened" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRevoking(null); setRevokeReason(''); }}>Cancel</Button>
            <Button variant="destructive" disabled={!revokeReason.trim()} onClick={() => void submitRevocation()}>
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <History className="h-3 w-3" />
        Transitions, approvals and revocations are written to the Builder audit trail in the same
        transaction as the change. A failed audit write rolls the change back.
      </p>
    </div>
  );
}
