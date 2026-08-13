/**
 * Shared shapes for the Builder Portal identity and access surfaces.
 *
 * These mirror the projections `builder-portal-admin` returns. They live here
 * rather than in the page so the dialogs that edit each aggregate can be typed
 * without importing from a route module.
 *
 * Every mutable aggregate carries `row_version`: the server requires it as
 * `expected_version` and answers HTTP 409 `stale_write` if it has moved. Any
 * form that edits one of these must round-trip the version it loaded.
 */

export interface BuilderOrganisation {
  id: string;
  legal_name: string;
  trading_name: string | null;
  org_type: string;
  abn: string | null;
  acn: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  address_line1: string | null;
  address_line2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  notes: string | null;
  status: string;
  is_active: boolean;
  row_version: number;
}

export interface BuilderUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  job_title: string | null;
  status: string;
  is_active: boolean;
  invited_at: string | null;
  invite_token_expires_at: string | null;
  invite_accepted_at: string | null;
  last_login_at: string | null;
  /** Derived server-side: the invite was accepted and a password exists. */
  has_completed_account_setup: boolean;
  row_version: number;
}

export interface BuilderMembership {
  id: string;
  builder_user_id: string;
  organisation_id: string;
  membership_role: string;
  is_primary: boolean;
  status: string;
  revoked_at: string | null;
  row_version: number;
}

export interface BuilderUserSession {
  id: string;
  created_at: string;
  last_used_at: string | null;
  absolute_expires_at: string;
  idle_expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  device_label: string | null;
}

/** A permission the catalogue exposes. Forbidden keys are never returned. */
export interface BuilderPermissionKey {
  permission_key: string;
  description: string | null;
  /**
   * `inbound_projection` keys are data this portal receives from another
   * domain. They are readable but never writable, so edit and delete
   * decisions are forced to `inherit` server-side.
   */
  key_kind: string;
  is_forbidden: boolean;
}

export interface BuilderRoleDefault {
  membership_role: string;
  permission_key: string;
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

export type PermissionDecision = 'inherit' | 'allow' | 'deny';

export interface BuilderPermissionOverride {
  permission_key: string;
  scope_type: string;
  view_decision: PermissionDecision;
  edit_decision: PermissionDecision;
  delete_decision: PermissionDecision;
  reason: string | null;
}

export const ORG_TYPES = [
  { value: 'developer', label: 'Developer' },
  { value: 'builder', label: 'Builder' },
  { value: 'builder_developer', label: 'Builder and developer' },
  { value: 'sales_representative', label: 'Authorised sales representative' },
] as const;

export const MEMBERSHIP_ROLES = [
  { value: 'owner', label: 'Organisation owner' },
  { value: 'administrator', label: 'Administrator' },
  { value: 'manager', label: 'Manager' },
  { value: 'member', label: 'Member' },
  { value: 'read_only', label: 'Read only' },
] as const;

export const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const;

/**
 * Organisation statuses, in lifecycle order.
 *
 * `closed` is terminal for access purposes: memberships of a closed
 * organisation cannot be granted and an invitation to one leads nowhere.
 */
export const ORG_STATUSES = [
  { value: 'pending_activation', label: 'Pending activation', hint: 'Created but not yet live. Members cannot sign in.' },
  { value: 'active', label: 'Active', hint: 'Live. Members with a valid membership can sign in.' },
  { value: 'suspended', label: 'Suspended', hint: 'Access blocked and every member session ended.' },
  { value: 'closed', label: 'Closed', hint: 'Terminal. No new memberships or invitations.' },
] as const;

export const ORG_STATUS_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  active: { label: 'Active', variant: 'default' },
  pending_activation: { label: 'Pending activation', variant: 'secondary' },
  suspended: { label: 'Suspended', variant: 'outline' },
  closed: { label: 'Closed', variant: 'destructive' },
};

/** A status change that removes access needs a reason for the audit record. */
export function statusChangeRemovesAccess(next: string): boolean {
  return next !== 'active';
}
