import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, ShieldCheck } from 'lucide-react';

/**
 * Per-membership permission overrides.
 *
 * Three things this surface does not do, all of them deliberate:
 *
 *  * It never invents a permission key. The list comes from the server's
 *    catalogue, which already excludes every forbidden key, so a key that must
 *    not be grantable cannot appear here to be granted.
 *  * `inherit` is the default and stays the default. Resolution is
 *    deny-by-default underneath, so leaving a key alone grants nothing.
 *  * Inbound projections are read-only. Edit and delete are fixed at inherit
 *    for them here, and the Edge Function forces the same thing again before
 *    the write.
 */
export type PermissionDecision = 'inherit' | 'allow' | 'deny';

export interface BuilderPermissionKey {
  permission_key: string;
  description: string | null;
  key_kind: string;
}

export interface BuilderPermissionOverride {
  permission_key: string;
  view_decision: PermissionDecision;
  edit_decision: PermissionDecision;
  delete_decision: PermissionDecision;
}

export interface BuilderRoleDefault {
  membership_role: string;
  permission_key: string;
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export interface BuilderPermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  membershipLabel: string;
  membershipRole: string;
  permissionKeys: ReadonlyArray<BuilderPermissionKey>;
  roleDefaults: ReadonlyArray<BuilderRoleDefault>;
  overrides: ReadonlyArray<BuilderPermissionOverride>;
  loading?: boolean;
  busy?: boolean;
  onSave: (overrides: BuilderPermissionOverride[]) => void;
}

const DECISIONS: PermissionDecision[] = ['inherit', 'allow', 'deny'];

export function BuilderPermissionsDialog({
  open, onOpenChange, membershipLabel, membershipRole,
  permissionKeys, roleDefaults, overrides, loading = false, busy = false, onSave,
}: BuilderPermissionsDialogProps) {
  const [draft, setDraft] = useState<Record<string, BuilderPermissionOverride>>({});

  useEffect(() => {
    if (!open) return;
    setDraft(Object.fromEntries(overrides.map((o) => [o.permission_key, { ...o }])));
  }, [open, overrides]);

  const defaultsForRole = useMemo(() => {
    const map = new Map<string, BuilderRoleDefault>();
    for (const entry of roleDefaults) {
      if (entry.membership_role === membershipRole) map.set(entry.permission_key, entry);
    }
    return map;
  }, [roleDefaults, membershipRole]);

  const decisionFor = (key: string, field: keyof BuilderPermissionOverride): PermissionDecision => {
    const row = draft[key];
    const value = row?.[field];
    return value === 'allow' || value === 'deny' ? value : 'inherit';
  };

  const setDecision = (key: string, field: 'view_decision' | 'edit_decision' | 'delete_decision') =>
    (value: string) => setDraft((current) => {
      const existing = current[key] ?? {
        permission_key: key,
        view_decision: 'inherit' as PermissionDecision,
        edit_decision: 'inherit' as PermissionDecision,
        delete_decision: 'inherit' as PermissionDecision,
      };
      return { ...current, [key]: { ...existing, [field]: value as PermissionDecision } };
    });

  const changedCount = useMemo(
    () => Object.values(draft).filter((row) =>
      row.view_decision !== 'inherit' || row.edit_decision !== 'inherit' || row.delete_decision !== 'inherit').length,
    [draft],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit permissions</DialogTitle>
          <DialogDescription>
            Overrides for {membershipLabel}. Anything left on <strong>inherit</strong> follows the
            baseline for the {membershipRole.replace(/_/g, ' ')} role, which resolves deny-by-default.
          </DialogDescription>
        </DialogHeader>

        <Alert className="border-border bg-muted/40">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          <AlertDescription>
            Builder permissions only ever reach Builder Portal data. Finance, Solicitor, AML and
            Command Centre keys are not in this catalogue and cannot be granted from here.
          </AlertDescription>
        </Alert>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading permissions" />
          </div>
        ) : permissionKeys.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No grantable permission keys are published.
          </p>
        ) : (
          <div className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
            {permissionKeys.map((key) => {
              const readOnlyKind = key.key_kind === 'inbound_projection';
              const baseline = defaultsForRole.get(key.permission_key);
              return (
                <div key={key.permission_key} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-medium">{key.permission_key}</p>
                      {key.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{key.description}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {readOnlyKind && (
                        <Badge variant="outline" className="font-normal">Read only</Badge>
                      )}
                      <Badge variant="outline" className="font-normal text-muted-foreground">
                        baseline{' '}
                        {baseline
                          ? [baseline.can_view && 'view', baseline.can_edit && 'edit', baseline.can_delete && 'delete']
                            .filter(Boolean).join(' · ') || 'none'
                          : 'none'}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    {([
                      ['view_decision', 'View'],
                      ['edit_decision', 'Edit'],
                      ['delete_decision', 'Delete'],
                    ] as const).map(([field, label]) => {
                      const disabled = busy || (readOnlyKind && field !== 'view_decision');
                      const selectId = `perm-${key.permission_key}-${field}`;
                      return (
                        <div key={field} className="space-y-1.5">
                          <Label htmlFor={selectId} className="text-xs text-muted-foreground">{label}</Label>
                          <Select
                            value={disabled && readOnlyKind && field !== 'view_decision'
                              ? 'inherit'
                              : decisionFor(key.permission_key, field)}
                            onValueChange={setDecision(key.permission_key, field)}
                            disabled={disabled}
                          >
                            <SelectTrigger id={selectId} className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {DECISIONS.map((decision) => (
                                <SelectItem key={decision} value={decision}>{decision}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {changedCount} override{changedCount === 1 ? '' : 's'} set. Keys left on inherit are not stored.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button
              disabled={busy || loading}
              onClick={() => onSave(Object.values(draft))}
            >
              Save permissions
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
