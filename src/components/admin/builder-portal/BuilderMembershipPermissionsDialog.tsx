import { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, Loader2, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { MEMBERSHIP_ROLES } from './accessTypes';
import type {
  BuilderMembership, BuilderPermissionKey, BuilderPermissionOverride,
  BuilderRoleDefault, PermissionDecision,
} from './accessTypes';

/**
 * Per-membership permission overrides.
 *
 * The Builder Portal resolves permissions deny-by-default: a membership role
 * supplies a baseline and an override may raise or lower it for one key. All of
 * that existed in the database and in `builder-portal-admin`, with no way to
 * reach it from the Command Centre — the catalogue, the current overrides and
 * the update operation were all unreachable. This is that surface.
 *
 * Three things are enforced server-side and merely reflected here:
 *
 *   * Forbidden keys never appear — the catalogue excludes them, the resolver
 *     denies them and a database trigger rejects them.
 *   * `inbound_projection` keys are data this portal receives from another
 *     domain. They are readable but never writable, so edit and delete are
 *     fixed at inherit.
 *   * A row left entirely on inherit is not stored; the role baseline applies.
 */

const DECISIONS: { value: PermissionDecision; label: string }[] = [
  { value: 'inherit', label: 'Inherit' },
  { value: 'allow', label: 'Allow' },
  { value: 'deny', label: 'Deny' },
];

type OverrideRow = {
  view_decision: PermissionDecision;
  edit_decision: PermissionDecision;
  delete_decision: PermissionDecision;
  reason: string;
};

const BLANK: OverrideRow = {
  view_decision: 'inherit', edit_decision: 'inherit', delete_decision: 'inherit', reason: '',
};

const isBlank = (row: OverrideRow) =>
  row.view_decision === 'inherit' && row.edit_decision === 'inherit' && row.delete_decision === 'inherit';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membership: BuilderMembership | null;
  userName: string;
  organisationName: string;
  canEdit: boolean;
  busy: boolean;
  loadCatalogue: () => Promise<{ permission_keys: BuilderPermissionKey[]; role_defaults: BuilderRoleDefault[] }>;
  loadOverrides: (membershipId: string) => Promise<BuilderPermissionOverride[]>;
  onSave: (membershipId: string, overrides: Record<string, unknown>[], reason: string | null)
  => Promise<{ applied: number; rejected_keys: string[] } | null>;
}

export function BuilderMembershipPermissionsDialog({
  open, onOpenChange, membership, userName, organisationName,
  canEdit, busy, loadCatalogue, loadOverrides, onSave,
}: Props) {
  const [keys, setKeys] = useState<BuilderPermissionKey[]>([]);
  const [roleDefaults, setRoleDefaults] = useState<BuilderRoleDefault[]>([]);
  const [rows, setRows] = useState<Record<string, OverrideRow>>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!membership) return;
    setLoading(true);
    try {
      const [catalogue, overrides] = await Promise.all([
        loadCatalogue(), loadOverrides(membership.id),
      ]);
      setKeys(catalogue.permission_keys ?? []);
      setRoleDefaults(catalogue.role_defaults ?? []);
      const seeded: Record<string, OverrideRow> = {};
      for (const override of overrides ?? []) {
        seeded[override.permission_key] = {
          view_decision: override.view_decision ?? 'inherit',
          edit_decision: override.edit_decision ?? 'inherit',
          delete_decision: override.delete_decision ?? 'inherit',
          reason: override.reason ?? '',
        };
      }
      setRows(seeded);
    } finally {
      setLoading(false);
    }
  }, [membership, loadCatalogue, loadOverrides]);

  useEffect(() => {
    if (open && membership) { setSearch(''); setReason(''); void load(); }
  }, [open, membership, load]);

  /** The role baseline for a key, which an override is read against. */
  const baselineFor = useMemo(() => {
    const byKey = new Map<string, BuilderRoleDefault>();
    if (membership) {
      for (const entry of roleDefaults) {
        if (entry.membership_role === membership.membership_role) byKey.set(entry.permission_key, entry);
      }
    }
    return byKey;
  }, [roleDefaults, membership]);

  const visibleKeys = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? keys.filter((key) =>
        key.permission_key.toLowerCase().includes(term)
        || (key.description ?? '').toLowerCase().includes(term))
      : keys;
    return [...filtered].sort((a, b) => a.permission_key.localeCompare(b.permission_key));
  }, [keys, search]);

  const rowFor = (key: string): OverrideRow => rows[key] ?? BLANK;
  const setRow = (key: string, patch: Partial<OverrideRow>) =>
    setRows((prev) => ({ ...prev, [key]: { ...(prev[key] ?? BLANK), ...patch } }));

  const activeCount = Object.values(rows).filter((row) => !isBlank(row)).length;
  const roleLabel = MEMBERSHIP_ROLES.find((role) => role.value === membership?.membership_role)?.label
    ?? membership?.membership_role ?? '';

  const save = async () => {
    if (!membership) return;
    // Only non-blank rows are sent. The server replaces the whole
    // organisation-scoped set, so omitting a row is how an override is cleared.
    const payload = Object.entries(rows)
      .filter(([, row]) => !isBlank(row))
      .map(([permission_key, row]) => ({
        permission_key,
        view_decision: row.view_decision,
        edit_decision: row.edit_decision,
        delete_decision: row.delete_decision,
        reason: row.reason.trim() || null,
      }));
    const result = await onSave(membership.id, payload, reason.trim() || null);
    if (result) onOpenChange(false);
  };

  if (!membership) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Permissions — {userName}</DialogTitle>
          <DialogDescription>
            {organisationName} · role <strong>{roleLabel}</strong>. The role sets the baseline;
            an override changes one key for this membership only.
            {activeCount > 0 && ` ${activeCount} override${activeCount === 1 ? '' : 's'} set.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 overflow-hidden">
          <Alert>
            <Info className="h-4 w-4" aria-hidden />
            <AlertDescription>
              Permissions are deny-by-default: a key left on <em>Inherit</em> everywhere resolves to
              the role baseline, and an explicit <em>Deny</em> always wins over an allow.
            </AlertDescription>
          </Alert>

          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search permission keys"
            aria-label="Search permission keys"
            className="max-w-md"
          />

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
              <span className="sr-only">Loading permissions…</span>
            </div>
          ) : visibleKeys.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {keys.length === 0 ? 'The permission catalogue is empty.' : 'No permission matches that search.'}
            </p>
          ) : (
            <div className="max-h-[45vh] overflow-auto rounded-md border border-border/60">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead className="min-w-[15rem]">Permission</TableHead>
                    <TableHead>Baseline</TableHead>
                    <TableHead>View</TableHead>
                    <TableHead>Edit</TableHead>
                    <TableHead>Delete</TableHead>
                    <TableHead className="min-w-[12rem]">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleKeys.map((key) => {
                    const row = rowFor(key.permission_key);
                    const baseline = baselineFor.get(key.permission_key);
                    const readOnlyKey = key.key_kind === 'inbound_projection';
                    return (
                      <TableRow key={key.permission_key} className={isBlank(row) ? undefined : 'bg-muted/40'}>
                        <TableCell>
                          <span className="block font-mono text-xs font-medium">{key.permission_key}</span>
                          {key.description && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">{key.description}</span>
                          )}
                          {readOnlyKey && (
                            <Badge variant="outline" className="mt-1">Read-only projection</Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {baseline
                            ? [
                              baseline.can_view ? 'view' : null,
                              baseline.can_edit ? 'edit' : null,
                              baseline.can_delete ? 'delete' : null,
                            ].filter(Boolean).join(', ') || 'none'
                            : 'none'}
                        </TableCell>
                        {(['view_decision', 'edit_decision', 'delete_decision'] as const).map((level) => {
                          const locked = readOnlyKey && level !== 'view_decision';
                          return (
                            <TableCell key={level}>
                              <Select
                                value={locked ? 'inherit' : row[level]}
                                disabled={!canEdit || locked}
                                onValueChange={(value) => setRow(key.permission_key, { [level]: value as PermissionDecision })}
                              >
                                <SelectTrigger
                                  className="h-8 w-[6.5rem]"
                                  aria-label={`${key.permission_key} ${level.replace('_decision', '')}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {DECISIONS.map((decision) => (
                                    <SelectItem key={decision.value} value={decision.value}>{decision.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                          );
                        })}
                        <TableCell>
                          <Input
                            className="h-8"
                            value={row.reason}
                            disabled={!canEdit || isBlank(row)}
                            placeholder={isBlank(row) ? '—' : 'Why'}
                            aria-label={`${key.permission_key} reason`}
                            onChange={(event) => setRow(key.permission_key, { reason: event.target.value })}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="permissions-reason">
              Reason for this change <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="permissions-reason"
              rows={2}
              value={reason}
              disabled={!canEdit}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Recorded against the before/after audit record"
            />
          </div>

          {!canEdit && (
            <Alert>
              <ShieldAlert className="h-4 w-4" aria-hidden />
              <AlertDescription>
                You have read-only access to this module, so permissions cannot be changed.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!canEdit || busy || loading} onClick={() => void save()}>
            Save permissions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
