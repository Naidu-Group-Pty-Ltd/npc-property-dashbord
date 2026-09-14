/**
 * THE BUILDER RECORDS ARE A FROZEN ARCHIVE (extraction plan §7 Phase 6).
 *
 * The Builder / Developer Portal moved to the central Builders Network;
 * `/builder/*` on this workspace is a redirect and the builder tables here
 * await the Phase 7 decommission. A staff edit made through the Command
 * Centre's builder admin plane would fork this copy from the network's
 * record and be silently destroyed at decommission — a person's work, lost
 * without anything reporting it. So every RECORD mutation is refused HERE,
 * server-side, because hiding buttons was never authorisation.
 *
 * What is deliberately NOT frozen:
 *
 * - READS. The archive is still worth looking at, and Phase 7's export
 *   depends on it being readable.
 * - CONTAINMENT. The prime's builder-portal functions keep answering direct
 *   HTTP with valid session cookies until Phase 7 removes them, so the acts
 *   that END access — suspending a user or organisation, revoking a
 *   membership, killing sessions — must keep working. Removing a ceremony
 *   must never remove a control: a compromised builder account has to be
 *   containable for exactly as long as anything still answers to it.
 *
 * The freeze is a constant, not a flag: the phase is the switch, and a
 * configuration bit that could quietly re-open a frozen archive is the kind
 * of silent divergence this module exists to prevent. It lifts by deleting
 * this refusal — which Phase 7 does by deleting the functions themselves.
 */

/**
 * Containment operations that survive the freeze, per function. Only the
 * portal admin (organisations, users, memberships, sessions) has any;
 * every other admin function's mutations are record content.
 */
export const BUILDER_ADMIN_CONTAINMENT_OPERATIONS: ReadonlySet<string> = new Set([
  'set_user_status',
  'set_organisation_status',
  'revoke_membership',
  'revoke_user_sessions',
]);

export interface BuilderAdminFreezeRefusal {
  error: string;
  code: 'builder_admin_read_only';
  moved_to: string;
}

/**
 * The refusal for a frozen mutation, or null where the operation may
 * proceed (a read, or a containment act).
 *
 * `isRead` is the caller's own READ_OPERATIONS verdict — the same set that
 * already decides `can_view` vs `can_edit`, so the freeze and the
 * permission model cannot classify an operation differently.
 */
export function builderAdminFreezeRefusal(
  operation: string,
  isRead: boolean,
): BuilderAdminFreezeRefusal | null {
  if (isRead) return null;
  if (BUILDER_ADMIN_CONTAINMENT_OPERATIONS.has(operation)) return null;
  return {
    error: 'The Builder Portal has moved to the Builders Network and this '
      + 'workspace’s builder records are a read-only archive awaiting '
      + 'decommission. Manage builders at builders.aurixasystems.com.au; '
      + 'suspension and session revocation still work here.',
    code: 'builder_admin_read_only',
    moved_to: 'https://builders.aurixasystems.com.au',
  };
}
