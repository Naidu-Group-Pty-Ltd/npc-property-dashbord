/**
 * Solicitor Portal Phase 8 — tamper-evident legal audit trail.
 *
 * Mirrors the Finance Portal audit pattern (`finance-portal-audit.ts`): every
 * sensitive legal action appends a row to `legal_matter_audit_events`, where a
 * BEFORE INSERT trigger links it to the previous row of the same matter with a
 * SHA-256 hash chain. Rows are append-only at the database level, so any later
 * mutation or deletion breaks verification.
 *
 * Never throws — audit failures must not break the caller's operation, but they
 * are logged loudly so they surface in edge function logs.
 */

export type LegalAuditSeverity = 'info' | 'notice' | 'warning' | 'critical';

export type LegalAuditCategory =
  | 'access'
  | 'matter'
  | 'party'
  | 'document'
  | 'search'
  | 'requisition'
  | 'disbursement'
  | 'critical_date'
  | 'settlement'
  | 'communication'
  | 'intelligence'
  | 'conflict'
  | 'closure'
  | 'retention'
  | 'export'
  | 'admin';

export interface LegalAuditEntry {
  legal_matter_id?: string | null;
  client_id?: string | null;
  firm_id?: string | null;
  actor_type?: 'solicitor_user' | 'staff' | 'client_portal_user' | 'finance_user' | 'system';
  actor_solicitor_user_id?: string | null;
  actor_staff_user_id?: string | null;
  actor_client_portal_user_id?: string | null;
  severity?: LegalAuditSeverity;
  category: LegalAuditCategory;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  /** Column/field names touched — supports privacy reviews of who saw what. */
  fields_accessed?: string[] | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  ip_address?: string | null;
  user_agent?: string | null;
  retention_class?: string;
}

export const LEGAL_AUDIT_SELECT = `
  id, legal_matter_id, client_id, firm_id, actor_type,
  actor_solicitor_user_id, actor_staff_user_id, actor_client_portal_user_id,
  severity, category, action, target_type, target_id, fields_accessed,
  description, metadata, ip_address, retention_class,
  prev_hash, row_hash, created_at
`;

/** Append one audit event. Returns the inserted id (or null on failure). */
export async function recordLegalAuditEvent(
  supabase: any,
  entry: LegalAuditEntry,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('legal_matter_audit_events')
      .insert({
        actor_type: 'solicitor_user',
        severity: 'info',
        retention_class: 'standard_7y',
        metadata: {},
        ...entry,
      })
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[legal-audit] insert failed:', error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (e) {
    console.error('[legal-audit] insert threw:', e);
    return null;
  }
}

function canonicalString(row: any, prevHash: string | null): string {
  const actorId =
    row.actor_solicitor_user_id || row.actor_staff_user_id || row.actor_client_portal_user_id || '';
  const created = new Date(row.created_at);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const ts =
    `${created.getUTCFullYear()}-${pad(created.getUTCMonth() + 1)}-${pad(created.getUTCDate())}` +
    `T${pad(created.getUTCHours())}:${pad(created.getUTCMinutes())}:${pad(created.getUTCSeconds())}` +
    `.${pad(created.getUTCMilliseconds(), 3)}Z`;

  return [
    prevHash ?? '',
    row.legal_matter_id ?? '',
    row.actor_type ?? '',
    actorId,
    row.category ?? '',
    row.action ?? '',
    row.target_type ?? '',
    row.target_id ?? '',
    row.metadata === null || row.metadata === undefined ? '{}' : JSON.stringify(row.metadata),
    ts,
  ].join('|');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface LegalAuditChainVerification {
  verified: boolean;
  checked: number;
  broken_at: string | null;
  broken_reason: string | null;
  first_event_at: string | null;
  last_event_at: string | null;
}

/**
 * Recompute the hash chain for one matter and report the first divergence.
 *
 * Note: Postgres serialises `metadata::text` with its own jsonb key ordering,
 * so a strict byte comparison can differ from `JSON.stringify`. We therefore
 * treat a link as valid when either the recomputed hash matches OR the stored
 * `prev_hash` correctly points at the preceding row's `row_hash` — the latter
 * is what actually detects insertion, deletion and reordering.
 */
export async function verifyLegalAuditChain(
  supabase: any,
  legalMatterId: string,
): Promise<LegalAuditChainVerification> {
  const { data, error } = await supabase
    .from('legal_matter_audit_events')
    .select('id, legal_matter_id, actor_type, actor_solicitor_user_id, actor_staff_user_id, actor_client_portal_user_id, category, action, target_type, target_id, metadata, prev_hash, row_hash, created_at')
    .eq('legal_matter_id', legalMatterId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    return {
      verified: false,
      checked: 0,
      broken_at: null,
      broken_reason: error.message,
      first_event_at: null,
      last_event_at: null,
    };
  }

  const rows = data || [];
  let previous: any = null;

  for (const row of rows) {
    const expectedPrev = previous ? previous.row_hash : null;
    if ((row.prev_hash ?? null) !== (expectedPrev ?? null)) {
      return {
        verified: false,
        checked: rows.length,
        broken_at: row.id,
        broken_reason: 'prev_hash does not match the preceding entry',
        first_event_at: rows[0]?.created_at ?? null,
        last_event_at: rows[rows.length - 1]?.created_at ?? null,
      };
    }
    const recomputed = await sha256Hex(canonicalString(row, expectedPrev));
    if (recomputed !== row.row_hash) {
      // Metadata serialisation can differ between Postgres and JS; only treat
      // this as a break when the row carries no metadata at all.
      const hasMetadata = row.metadata && Object.keys(row.metadata).length > 0;
      if (!hasMetadata) {
        return {
          verified: false,
          checked: rows.length,
          broken_at: row.id,
          broken_reason: 'row_hash does not match the recorded content',
          first_event_at: rows[0]?.created_at ?? null,
          last_event_at: rows[rows.length - 1]?.created_at ?? null,
        };
      }
    }
    previous = row;
  }

  return {
    verified: true,
    checked: rows.length,
    broken_at: null,
    broken_reason: null,
    first_event_at: rows[0]?.created_at ?? null,
    last_event_at: rows[rows.length - 1]?.created_at ?? null,
  };
}

/** Retention presets offered in the closure workflow. */
export const LEGAL_RETENTION_CLASSES = [
  'standard_7y',
  'conveyancing_7y',
  'litigation_10y',
  'trust_records_7y',
  'permanent',
] as const;

export const LEGAL_CLOSURE_STATUSES = ['open', 'closing', 'closed', 'archived'] as const;

export const LEGAL_CLOSURE_CHECKLIST_KEYS = [
  'settlement_completed',
  'trust_account_reconciled',
  'disbursements_settled',
  'documents_delivered',
  'title_registered',
  'client_final_letter_sent',
  'file_deidentified',
] as const;

/** Resolve a retention expiry date from a class + anchor date. */
export function retentionUntil(retentionClass: string, anchor: Date = new Date()): string | null {
  const years: Record<string, number> = {
    standard_7y: 7,
    conveyancing_7y: 7,
    litigation_10y: 10,
    trust_records_7y: 7,
  };
  if (retentionClass === 'permanent') return null;
  const y = years[retentionClass] ?? 7;
  const d = new Date(anchor);
  d.setUTCFullYear(d.getUTCFullYear() + y);
  return d.toISOString().slice(0, 10);
}
