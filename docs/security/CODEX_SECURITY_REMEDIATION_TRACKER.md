{
  "schema_version": 1,
  "purpose": "Machine-readable source remediation tracker. Source status must not be interpreted as deployed or live-test status.",
  "findings": [
    {
      "finding_id": "WP-00-REGISTRY",
      "severity": "medium",
      "file_or_function": "supabase/functions-registry/SECURITY_REGISTRY.json",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "Registry classifications are source assertions; each needs-review entry still requires endpoint-specific review."
    },
    {
      "finding_id": "WP-00-CI-BASELINE",
      "severity": "medium",
      "file_or_function": "scripts/security/check-function-registry.mjs",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "The historical backlog is grandfathered by exact name until later work packages review it."
    },
    {
      "finding_id": "WP-01-SHARED-REQUEST-SECURITY",
      "severity": "high",
      "file_or_function": "supabase/functions/_shared/requestSecurity.ts",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "The primitives are additive; endpoint migrations to the strict APIs begin in subsequent scoped work packages."
    },
    {
      "finding_id": "WP-02-MARKET-AI-CONTAINMENT",
      "severity": "critical",
      "file_or_function": "market-updates-qa; market-updates-voice-transcribe",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "Provider metering is represented by fail-closed quota reservations; provider-specific cost reconciliation is deferred."
    },
    {
      "finding_id": "WP-03-CRON-STRICT-AUTH",
      "severity": "high",
      "file_or_function": "market-updates-digest; market-qa-subscriptions; market-qa-digest-runner; market-qa-quality-snapshot",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "Cron paths now use verifyRequiredCronSecret constant-time compare; DB-level claim/lease for runner-style functions is tracked separately under runner state hardening."
    },
    {
      "finding_id": "WP-04-WEB-PUSH-DERIVED-PAYLOAD",
      "severity": "high",
      "file_or_function": "send-web-push",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "Caller supplies only notification_id; title/body/url/subscriber_type are derived server-side from public.notifications. URL allowlist rejects javascript:/data:/external hosts and falls back to '/'. Idempotency enforced via push_delivery_log lookup; a unique DB index is deferred to the storage-hardening package."
    },
    {
      "finding_id": "WP-05A-AGENT-TOOL-POLICY-FRAMEWORK",
      "severity": "high",
      "file_or_function": "_shared/agentToolAuthz.ts; scripts/security/check-agent-tool-policies.mjs",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "217/217 agent tool cases have baseline policies (module/permission/actorTypes/confirmation). ToolSecurityPolicy extended with optional resourceType/resolveResource/requiresStepUp/allowedInternalCallers/maxBatchSize to unblock WP-05B/C without rewriting the row set."
    },
    {
      "finding_id": "WP-05B-AGENT-TOOL-RUNTIME-ENFORCEMENT",
      "severity": "high",
      "file_or_function": "_shared/agentToolAuthz.ts; ai-dashboard-agent/index.ts (executeTool, confirm-tool, execute-tool)",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "Fail-closed gate added at the executeTool boundary: actor-type check, resource-ownership check (default arg-key resolver against clients.created_by / child-table created_by with client fallback), and step-up gate (delete_*, bulk_*, or policy.requiresStepUp). Confirmation-approved path sets stepUpVerified=true; verified service-role execute-tool callers pass actorType=internal. Ownership resolver currently covers client_id/deal_id/reminder_id/note_id/file_id/activity_id/playbook_id/scheduled_task_id/checklist_instance_id/game_plan_id/agreement_id/chart_id/report_id. Remaining surfaces (appointments via GHL id, memory ids, agent-conversation ids) still rely on the tool implementation's own scoping and are earmarked for WP-05C alongside the internal-caller allowlist + bulk ceilings."
    },
    {
      "finding_id": "WP-05C-AGENT-TOOL-BULK-AND-INTERNAL-CALLER-GATE",
      "severity": "high",
      "file_or_function": "_shared/agentToolAuthz.ts; scripts/security/check-agent-bulk-ceilings.mjs",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "Every bulk_* tool now carries an explicit maxBatchSize (bulk_create_reminders=100, bulk_set_follow_up_dates=100, bulk_update_clients=50) and an allowedInternalCallers whitelist ('agent-task-runner'). authorizeAgentTool now scans every array-valued arg (not just ids/items) so a caller cannot rename the payload to bypass the ceiling, and refuses any bulk_* policy that ships without a ceiling as a config bug. Internal service-role callers still bypass the step-up gate ONLY when policy.allowedInternalCallers matches ctx.internalCaller; every other internal caller is fail-closed. New CI gate scripts/security/check-agent-bulk-ceilings.mjs blocks regressions. Remaining surfaces (appointments via GHL id, memory ids, agent-conversation ids) still rely on the tool implementation's own scoping and are earmarked for a follow-on WP-05D resource-resolver expansion."
    },
    {
      "finding_id": "WP-06-STORAGE-OBJECT-AUTHZ-PHASE-A",
      "severity": "high",
      "file_or_function": "public.storage_object_bindings; supabase/functions/_shared/storageAuthz.ts; supabase/functions/secure-storage/index.ts",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "Phase A ships the load-bearing foundation: service-only `storage_object_bindings` ledger (RLS deny-all for non-service; service_role grants only), shared resolver `_shared/storageAuthz.ts` (getBinding/createBinding/deleteBinding/authorizeObjectAccess), and `secure-storage` fail-closed integration for download/signedUrl/delete/publicUrl on sensitive buckets (client-files/client-documents/vownet-forms/investment-reports/quantitative-reports/qa_exports/email-attachments). Deny returns 404 to prevent enumeration; bindings are auto-removed on delete. Superadmin/internal-service callers bypass with binding attached for audit context. Phase A LEGACY_FALLBACK_BUCKETS still allows read on the same seven sensitive buckets when no binding row exists, gated by the existing per-bucket module (checkModuleView) — so any authenticated staff with the module can still reach legacy paths until backfill lands. `legacy_fallback_no_binding` telemetry events measure exposure. Phase B (still owed): (1) upload paths across `client-files`, `email-attachments`, `investment-reports`, `quantitative-reports`, `qa_exports`, `vownet-forms` must call `createStorageBinding()` in the same server flow that uploads (with rollback on partial failure); (2) backfill script for existing objects using authoritative parent tables; (3) frontend consumers must stop persisting long-lived signed URLs; (4) `list` must require a resource ID and derive the prefix server-side; (5) STOR-004/STOR-005 bucket-private migrations after producers land; (6) LEGACY_FALLBACK_BUCKETS removal and live negative tests (cross-client path, root enumeration, traversal, upload-path injection, expired signed URL)."
    },
    {
      "finding_id": "WP-06-STORAGE-OBJECT-AUTHZ-PHASE-B",
      "severity": "high",
      "file_or_function": "supabase/functions/secure-storage/index.ts; supabase/functions/_shared/storageAuthz.ts; supabase/functions/portal-upload-file/index.ts; supabase/functions/outlook-email-sync/index.ts; supabase/functions/report-qa/index.ts; supabase/functions/build-conversations-export-worker/index.ts; src/lib/documentUpload.ts",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "Phase B extends the authz ledger to producers and reads: (1) mass backfill of `public.storage_object_bindings` from `client_files`, `finance_portal_documents`, `export_jobs`, `agent_file_uploads`, and `email_copilot_emails` attachments, with `(client_id)` and `(owner_user_id)` lookup indexes; (2) `secure-storage.upload` now creates a binding in the same server flow and rolls back the uploaded object if binding insertion fails, plus a `binding_owner_fallback` telemetry event when no scope is supplied; (3) `secure-storage.list` on sensitive buckets requires `list_client_id` OR `list_owner_user_id`, resolves the authorized set via `authorizedBindingsForList`, and denies unscoped enumeration with `list_scope_required`; (4) producer edge functions `portal-upload-file`, `outlook-email-sync` (attachments), `report-qa` (qa_exports), and `build-conversations-export-worker` (qa_exports) now upsert their binding row scoped to `client_id`/`owner_user_id` and roll back on failure; (5) frontend `uploadSecureStorageFileWithProgress` now accepts `resourceType`/`resourceId`/`clientId`/`ownerUserId` so callers can attach scope. Still owed for Phase C: (a) migrate any remaining producers that write directly to sensitive buckets outside these paths, (b) STOR-004/STOR-005 bucket-private cutover, (c) removal of `LEGACY_FALLBACK_BUCKETS` after binding coverage is verified, and (d) live negative tests (cross-client read, root-enumeration list, upload-path injection, expired signed URL, missing-scope list)."
    },
    {
      "finding_id": "WP-07-REPORT-QA-ACCESS",
      "severity": "high",
      "file_or_function": "supabase/functions/_shared/reportQaAccess.ts; supabase/functions/report-qa/index.ts; migration wp07-report-qa-access; public.get_shared_qa_answer(text); public.report_qa_share_access_log",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "WP-07 introduces a single authoritative access resolver (`resolveReportQaAccess`) returning owner/collaborate/view/admin/denied from the conversation row plus the active share, and routes the sensitive report-qa actions through it: `load-conversation`, `update-conversation` (owner-only for title/client rewiring; collaborate may edit report_names/report_contents), `delete-conversation`, `share-conversation`, `revoke-share`, `generate-share-link`, `revoke-share-link`, and `generate-qa-pdf`. Sharees cannot expand access (share/revoke are owner/admin only). Public per-answer share links are now 256-bit crypto-random tokens whose SHA-256 hash + 8-char prefix + expiry are stored on `report_qa_messages`; plaintext is never persisted, legacy plaintext tokens were rehashed and nulled in the migration, and `get_shared_qa_answer(text)` returns a minimal projection (no citations, tool traces, attachments, or client memory), tracks view count/last-access, and rejects revoked/expired tokens. The `report-qa` edge function rate-limits public share lookups to 60/hr per IP+prefix and writes outcome (`ok`/`not_found`/`expired`/`rate_limited`) to the service-role-only `report_qa_share_access_log` without ever recording the raw token. Also fixes the WP-06 Phase B qa_exports binding to key on `report_qa_conversations.created_by` (previous code referenced a non-existent `user_id` column). Still owed: (a) enforce access on the remaining thin actions (`summarize-conversation`, `submit-feedback`, `toggle-pin-message`, `branch-conversation`, `index-reports`, memory read/write, chat/stream) via the same helper, (b) scope RAG retrieval RPC calls with an explicit `conversation_id`/`client_id` predicate, and (c) live negative tests (owner/view/collaborate/revoked/arbitrary conversation ID/view-only update/unauthorized client-link/public token enumeration/expired-replayed/cross-conversation RAG chunks)."
    },
    {
      "finding_id": "WP-08-DELEGATED-CREDENTIAL-PROXIES",
      "severity": "high",
      "file_or_function": "supabase/functions/_shared/wp08Guards.ts; supabase/functions/airtable-proxy/index.ts; supabase/functions/manychat-proxy/index.ts; supabase/functions/send-ghl-message/index.ts",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "WP-08 introduces `_shared/wp08Guards.ts` (superadmin lookup, in-memory per-user rate limiter, redacted upstream-error mapper) and applies it to the three delegated-credential proxies. `airtable-proxy` now requires `listings` module view (superadmin bypasses), restricts `op=list_tables` to superadmins, resolves the caller-supplied `tableName` against a server-side allowlist (`AIRTABLE_TABLE_NAME` default + optional comma-separated `AIRTABLE_TABLE_ALLOWLIST`), forces `pageSize` into `[1,100]`, allowlists `sortDirection`, redacts all upstream Airtable errors via `redactUpstreamError`, and audits every call to `api_usage_log` with the actor's `user_id`, `table`, and `op`. `manychat-proxy` splits actions into `METADATA_ACTIONS` (gated on `settings` module view) and `PII_ACTIONS` (`find_subscriber`/`get_subscriber`/`find_by_custom_field` — superadmin-only), tightens input bounds (name 2–100, subscriberId `^[A-Za-z0-9_-]{1,64}$`, `field_value` capped at 256 chars, `field_id` numeric), rate-limits per-user (120/min metadata, 30/min PII), redacts all upstream error bodies, and audits calls with `user_id`+`action`+`pii` flag. `send-ghl-message` now enforces `conversations` module `can_edit` (superadmin bypasses), rejects messages over 1600 characters, enforces per-user burst (10/sec) + sustained (100/min) quotas, redacts the generic 500 error, and audits every successful send via `logApiUsage` with `channel`, `conversation_id`, `client_id`, provider message ID, and message length (body itself remains in `ghl_conversation_messages`). All three functions deployed. Still owed: (a) live negative tests (module-denied caller, non-allowlisted Airtable table, list_tables as non-superadmin, ManyChat PII action as non-superadmin, GHL send over 1600 chars, GHL burst > 10/sec, GHL send when caller is not assigned to the client), (b) a persistent (DB-backed) quota layer so the in-memory limiter cannot be bypassed by rolling across edge-function instances, and (c) an explicit client-assignment predicate on `send-ghl-message` once the client↔staff assignment model for conversations is finalised."
    },
    {
      "finding_id": "WP-09A-GENERATED-DOCUMENTS-DOCUSIGN",
      "severity": "high",
      "file_or_function": "supabase/functions/_shared/wp09Guards.ts; supabase/functions/manage-generated-documents/index.ts",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "WP-09A introduces `_shared/wp09Guards.ts` (bucket allowlist, generated-document FSM, immutable/service-only field lists, resource-ownership resolver, step-up marker, SHA-256 hasher, idempotency-key normaliser, recipient/tab bounds) and rewrites `manage-generated-documents` to apply it. Every id-scoped action now hydrates the row and runs `resolveGeneratedDocumentAccess` (superadmin bypass; caller must be `generated_by` or assigned to `client_id`). `create`/`update` are field-whitelisted via `pickAllowed(DOC_UPDATE_ALLOWED_FIELDS, DOC_SERVICE_ONLY_FIELDS)` so callers cannot mass-assign `docusign_envelope_id`, `docusign_status`, `signed_pdf_storage_path`, `pdf_hash`, `sent_at/viewed_at/signed_at/voided_at`, `sent_to`, `audit`, or `generated_by`. `update_status` runs `isValidDocTransition` and blocks envelope-driven states (`sent/signed/viewed/voided/delivered/declined`) for non-superadmins; server-side audit rows are appended automatically. `append_audit` accepts only `{note, event_type}` — caller cannot supply history. `send_freeform` (a) requires recent step-up (`x-step-up-token`) unless superadmin, (b) resolves the storage bucket server-side via `resolveDocumentBucket` against the fixed allowlist (`client-documents`/`generated-documents`/`compliance-records`) — caller-supplied `bucket` is ignored, (c) enforces recipient (≤10) and tab (≤200) ceilings with per-recipient email validation and name length caps, (d) computes and persists a SHA-256 PDF hash and refuses to send when a previously approved `pdf_hash` no longer matches the storage bytes, (e) supports an idempotency key (last-used key stored in metadata) so repeated retries return the same envelope, (f) redacts upstream DocuSign error text. `check_status`/`envelope_details`/`download_signed` also route through the access resolver. `list` is scoped to `generated_by = caller` for non-superadmins. `list_signature_events` now requires an explicit filter. Deployed. Still owed: (a) real signed step-up tokens (currently a marker header), (b) DocuSign Connect webhook-driven status updates instead of poll-based `check_status` mutations, (c) live negative tests (cross-client doc ID, caller bucket substitution, envelope-field mass assignment, invalid FSM transition, send without step-up, recipient substitution, resend without idempotency key, PDF changed after approval, valid approved send)."
    },
    {
      "finding_id": "WP-09B-COMPLIANCE-COMMISSION-TRANSACTIONS",
      "severity": "high",
      "file_or_function": "supabase/functions/_shared/wp09Guards.ts; supabase/functions/manage-compliance-records/index.ts; supabase/functions/manage-commission-ledger/index.ts; supabase/functions/generate-commission-payout/index.ts; migration commission_payouts maker/checker + SECURITY DEFINER RPCs",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "WP-09B hardens the three compliance/commission surfaces. **Compliance records**: `create_version` bumps the version, marks the prior current row `is_current=false`, and refuses `signed_at`, `signed_by_name`, `docusign_status`, `signed_pdf_storage_path`, `version`, `is_current`, `docusign_envelope_id`, and `generated_by` via `COMPLIANCE_SERVICE_ONLY_FIELDS`. `update_status` runs `isValidComplianceStatusTx` and rejects mutations on historical (non-current) rows. `pack_export` now validates every `included_record_ids` element resolves to the same `client_id` (cross-client packs return 403), caps to 200 records, and bounds `notes` to 4000 chars. `delete` is superadmin-only. **Commission ledger**: `create`/`update` are field-whitelisted (state fields — `status`, `received_date`, `reconciled_date`, `broker_id`, `deal_id`, `client_id`, `lender_id`, `created_by` — are service-only after creation). `mark_received` requires `status='expected'` and clamps `reference` to 128 chars. `reconcile` and `delete` are superadmin-only (normal ledger closure flows through the payout RPC); deletion is blocked once the row is `received`/`reconciled`. **Commission payout**: `generate`/`mark_paid`/`cancel` are re-implemented on top of three `SECURITY DEFINER` Postgres RPCs (`public.generate_commission_payout`, `public.mark_commission_payout_paid`, `public.cancel_commission_payout`) with `search_path = public` and `EXECUTE` locked to `service_role` (`PUBLIC/anon/authenticated` revoked). `generate_commission_payout` locks eligible received ledger rows `FOR UPDATE`, computes gross/gst/net server-side (caller-supplied totals impossible), inserts the payout, flips the locked ledger rows to `reconciled`, and writes an event to the append-only `commission_payout_audit` table (update/delete blocked by trigger). Idempotency is enforced by a unique partial index on `idempotency_key` and by a unique partial index on `(broker_id, period_start, period_end) WHERE status IN ('pending','paid')` so overlapping active payouts cannot exist. `mark_commission_payout_paid` requires the approver to differ from `generated_by` (raises `maker_checker_violation`), captures `approved_by/approved_at/approval_note`, and only runs against `pending` payouts. `cancel_commission_payout` compensates by flipping only the `reconciled` rows in the payout's `ledger_entry_ids` back to `received` in one transaction and refuses to cancel `paid`. The edge function also requires `x-step-up-token` on `mark_paid` for non-superadmin approvers and clamps text inputs (`payment_reference` 128, `payment_method` 64, `approval_note` 1000, `reason` 500). All three functions plus the new shared `_shared/wp09Guards.ts` are deployed. Still owed: (a) real signed step-up tokens with expiry, (b) a Postgres `security_audit_events` sink for the compliance rewrites (currently `logSecurityEvent` for denies + `commission_payout_audit` for payout flow), (c) live negative tests (cross-client compliance pack, mass-assignment of `signed_at`/`docusign_status`, historical-version mutation, ledger status/field manipulation on update, self-approved payout, duplicate generate with the same idempotency key, cancellation of a paid payout, manipulated totals on generate)."
    },
    {
      "finding_id": "WP-10-PUBLIC-ENDPOINT-ABUSE-CONTROLS",
      "severity": "high",
      "file_or_function": "supabase/functions/_shared/publicAbuseControls.ts; supabase/functions/request-lead-magnet/index.ts; supabase/functions/google-places-autocomplete/index.ts; supabase/functions/finance-email-track-pixel/index.ts; supabase/functions/market-qa-share/index.ts; supabase/functions/template-share/index.ts",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "WP-10 introduces `_shared/publicAbuseControls.ts` — a shared toolkit for public / paid-provider surfaces: `verifyTurnstile` (fail-closed when `REQUIRE_TURNSTILE=true` and `TURNSTILE_SECRET_KEY` unset or verify fails), `enforceIpQuota` / `enforceActorQuota` / `enforceKeyQuota` / `enforceGlobalDailyQuota` (in-memory sliding windows), `enforceGlobalCircuitBreaker` + `recordProviderFailure/Success` (paid-provider trip), `reserveUsage`/`releaseUsage`/`commitUsage` (daily reservation counter), `killSwitchActive` (env-flag gate), `getClientIp`, `sanitizeShortText` (control-char strip + length cap), `fetchWithTimeout` (bounded upstream), `hashToken` (SHA-256 hex), `redactError`, `honeypotTripped`, `tooFastSubmission`, and `normalizeEmail`. Applied to the four public / paid surfaces: **`request-lead-magnet`** now (a) checks `LEAD_MAGNET_KILL_SWITCH` first, (b) applies honeypot fields (`website`/`company_url`/`hp`) + minimum fill time (1200 ms) via `form_started_at`, (c) sanitises all inputs and caps lengths, (d) enforces Turnstile (fail-closed under `REQUIRE_TURNSTILE`), (e) applies four atomic quotas — per-IP (8/h), per-normalized-email (5/day), per-magnet (500/h), global daily (5000) — (f) dedupes on `(magnet_id, email)` within 24 h so retries don't inflate `download_count`, and (g) returns only redacted errors. **`google-places-autocomplete`** now (a) checks `GOOGLE_PLACES_KILL_SWITCH`, (b) applies a global circuit breaker (20 failures → 60 s open), (c) sanitises `input`/`sessionToken` and caps input at 120 chars, (d) rejects short queries silently, (e) applies per-IP (30/min), per-session (60/min), and global daily (default 5000, override via `GOOGLE_PLACES_DAILY_LIMIT`) quotas, (f) runs upstream fetch with a 5 s timeout, (g) records provider success/failure into the breaker, (h) projects the response to only `placeId`/`description`/`mainText`/`secondaryText` (max 10), and (i) redacts all upstream error strings. **`finance-email-track-pixel`** now (a) validates token shape (`^[A-Za-z0-9_-]{16,128}$`), (b) applies per-IP (120/min) + per-token (30/h) silent rate limits (always returns the pixel), (c) **no longer creates stub `finance_email_opens` rows for unknown tokens** — a match against `finance_outbound_messages.tracking_token` is now REQUIRED before any insert, closing the storage-exhaustion vector where forged token sprays could grow the opens table indefinitely, (d) caps `user_agent` at 500 chars, and (e) returns the same 200 pixel regardless of downstream outcome so callers cannot enumerate valid tokens. **`market-qa-share`** now (a) rate-limits `resolve` per-IP (60/min) + per-slug (300/h), (b) sanitises slug and returns a minimal public projection (drops `created_by`/internal counters), (c) on `create` verifies the source `market_update_questions.created_by = caller` (or superadmin) before minting a share, preventing an authenticated user from publishing another user's question, and (d) returns only redacted errors. **`template-share`** now (a) validates token shape (`^[A-Za-z0-9_-]{12,128}$`), (b) rate-limits per-IP (60/min) + per-token (300/h), and (c) redacts upstream errors. All four functions plus the new `_shared/publicAbuseControls.ts` are deployed. Still owed: (a) DB-backed persistent quota + reservation table so limits survive edge-function instance recycling (in-memory only today), (b) queued / dead-letter GHL push for lead-magnet captures (currently async best-effort with `ghl_synced=false`+`ghl_error` on the download row), (c) live negative tests (missing Turnstile in prod, honeypot filled, sub-1200 ms submission, per-email cap, per-magnet cap, global daily cap, kill switch, Places IP cap + circuit breaker, unknown pixel token, unauthenticated share on another user's question, share resolve rate limit), and (d) the operator action to restrict `GOOGLE_MAPS_API_KEY` at the provider (API surface + HTTP referrer allowlist + daily quota + billing alerts) — cannot be enforced from code."
    },
    {
      "finding_id": "WP-11A-SESSION-STORAGE-HARDENING",
      "severity": "high",
      "file_or_function": "migration user_sessions/client_portal_sessions/finance_portal_users; supabase/functions/_shared/sessionHash.ts; supabase/functions/_shared/csrfGuard.ts; supabase/functions/_shared/auth.ts; supabase/functions/_shared/requestSecurity.ts; supabase/functions/_shared/finance-portal-session.ts",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "WP-11A introduces additive session-storage hardening. **Schema**: `user_sessions` and `client_portal_sessions` gain `token_hash`, `idle_expires_at`, `last_used_at`, `revoked_at`, `revocation_reason`, `rotated_from_session_id`, `portal_scope` (defaulting to `staff`/`client_portal`), `ip_address`, and `user_agent`; `finance_portal_users` gains `session_token_hash`, `session_idle_expires_at`, `session_last_used_at`, `session_revocation_reason`, `session_ip_address`, and `session_user_agent`. Partial unique indexes on the new hash columns support fast dual-read lookup without breaking the existing plaintext-only rows. **New helpers**: `_shared/sessionHash.ts` computes HMAC-SHA256(`SESSION_TOKEN_PEPPER`, token) → 64-char hex; the pepper (64-char random) was generated via `secrets--generate_secret` and the module fails closed when it is missing/short. `_shared/csrfGuard.ts` enforces an Origin/Referer allowlist on any cookie-carrying unsafe HTTP method — safe methods and header-only calls remain untouched. **Verifier rewrites**: `verifySession` (staff), `verifyPortalSession` (client portal), `verifyFinancePortalSession` (finance portal), and `resolveFinancePartner` now (a) hash the presented token when the pepper is configured, (b) look up by `token_hash`/`session_token_hash` first, (c) fall back to plaintext `session_token` for legacy rows, (d) check `revoked_at` and `idle_expires_at` on top of `expires_at`, (e) lazy-backfill `token_hash` + `last_used_at` (+ `idle_expires_at` when unset) on the winning row, and (f) stopped logging any prefix of the raw token. **Non-goals for this WP**: no issuer paths have been rewritten yet — new sessions still write the plaintext column alongside; rotation on privilege change / password reset / MFA, per-portal cookie name isolation, CSRF enforcement at the endpoint layer, and stripping tokens from JSON responses all land in WP-11B/C. Still owed: (a) issuers to dual-write `token_hash` at row creation (currently backfilled on first verify), (b) frontend cookie-name split (`session_token` → `staff_session`/`portal_session`/`finance_session`), (c) endpoint-level `enforceCsrf(req)` calls on cookie-authenticated mutations, (d) rotate session on privilege change and password reset (WP-11B/C), (e) remove tokens from JSON login responses once cookies are the sole transport, (f) live negative tests (replay of stolen DB dump under peppered hash, cross-portal cookie reuse, cookie without matching Origin, idle-expired session)."
    },
    {
      "finding_id": "WP-12-INTERNAL-CALL-SIGNED-MIGRATION-PHASE-B",
      "severity": "high",
      "file_or_function": "supabase/functions/_shared/internalCall.ts; supabase/functions/_shared/auth_v2.ts (signInternalRequest, verifyInternal); supabase/functions/_shared/requestSecurity.ts (verifySignedInternal); scripts/security/check-internal-legacy-fallback.mjs; agent-task-runner; build-conversations-export-worker; ghl-marketing-dump-worker; enrich-lead-attributions; email-sync-cron; auto-report-webhook; migration-dispatcher; ai-dashboard-agent; report-qa; security-step-up; verify-internal; invoke-secure-function; ghl-migrate-bookings-worker; ghl-migrate-calendar-groups-worker; ghl-migrate-calendars-worker; ghl-migrate-contacts-worker; ghl-migrate-conversations-replay-worker; ghl-migrate-conversations-reset-phantoms; ghl-migrate-conversations-worker; ghl-migrate-notes-worker; ghl-migrate-opportunities-worker; ghl-migrate-workflow-enrollments-worker; ghl-migrate-workflow-reenroll-worker; ghl-migrate-workflows-snapshot-worker",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": true,
      "residual_risk": "WP-12 Phase B is now live. `INTERNAL_STRICT_SIGNED` has been set to `true` in edge-runtime env and the strict-lock fleet was redeployed. Unsigned POST to `agent-task-runner` now returns 401, confirming legacy static-secret and service-role-Bearer fallbacks are rejected. Per-receiver `allowedCallers` sets were applied to the high-blast-radius receivers and `pg_cron` jobs were migrated to signed envelopes via `public.cron_invoke_signed_function`. Still owed: (a) migrate the `send-web-push` DB trigger from the shared `INTERNAL_EDGE_SECRET` to a per-function Vault cron secret (WP-12 clause 8); (b) live negative tests for the full matrix (wrong method/path/body, ±120s skew, replayed nonce, unknown caller, caller not allowlisted, old key after rotation window, service-role Bearer rejected, static internal secret rejected); (c) rotate `INTERNAL_EDGE_SECRET` after the strict window has been stable."
    },
    {
      "finding_id": "WP-13-DEFENSE-IN-DEPTH",
      "severity": "high",
      "file_or_function": "supabase/functions/outlook-email-webhook/index.ts; supabase/functions/outlook-manage-subscription/index.ts; supabase/functions/outlook-calendar/index.ts; supabase/functions/render-source/index.ts; supabase/functions/_shared/permissions.ts",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "WP-13 hardens the remaining defense-in-depth surfaces. (1) **Outlook webhook** (`outlook-email-webhook`): stopped logging the full Graph notification payload (only `count`), removed the legacy `npc-email-copilot-webhook` clientState fallback — `OUTLOOK_WEBHOOK_CLIENT_STATE` must be ≥16 chars or the webhook fails closed with 401 — clientState comparison uses constant-length + strict-equals, and added idempotency via `internal_request_nonces` keyed on `(subscriptionId,resourceData.id,changeType)` so retried notifications don't double-process. (2) **Outlook subscription creator** (`outlook-manage-subscription`): refuses to create a subscription unless a strong clientState secret is configured, closing the loop with the webhook verifier. (3) **Outlook calendar** (`outlook-calendar`): extended `assertMailboxOwnership` to every entry in the `emails[]` array of the `freeBusy` action (previously only `body.targetEmail` was checked, so a caller could probe arbitrary tenant users' free/busy). (4) **render-source**: added a base64 payload cap (`RENDER_SOURCE_MAX_ZIP_B64`, default 15 MB base64 ≈ 11 MB binary → HTTP 413) to blunt decompression-bomb and memory-exhaustion vectors on the sidecar, and tightened the SSRF host guard to reject dotless-decimal / hex / octal / IPv6 numeric encodings, plus `::` and `0.0.0.0` alternate forms. (5) **Legacy permissions** (`_shared/permissions.ts`): introduced `LEGACY_PERMS_STRICT` env flag (default `false` during cutover). When flipped to `true`, unmapped tables (`TABLE_TO_MODULE_MAP` miss) and unregistered modules (no active row in `dashboard_modules`) fail-closed with `{ allowed:false, reason:'unmapped_table' | 'unregistered_module' }` instead of the legacy `{ allowed:true }`. Superadmin bypass and service-role bypass remain intact. **Deployed**: outlook-email-webhook, outlook-manage-subscription, outlook-calendar, render-source. **Not deployed as strict yet**: `LEGACY_PERMS_STRICT` remains `false` until an operator audits the mapping inventory and flips it. **Still owed / cutover**: (a) audit every table referenced by permission-gated edge functions against `TABLE_TO_MODULE_MAP` and add missing mappings, then flip `LEGACY_PERMS_STRICT=true` in edge env; (b) rotate any live Outlook subscriptions whose clientState was the legacy shared string — the webhook now rejects them until they are recreated; (c) live negative tests (replay Graph notification twice → second is skipped; freeBusy with a foreign user's email → 403; render-source zip >15 MB → 413; render-source URL with dotless-decimal or IPv6 bracket host → 400; unmapped-table read with `LEGACY_PERMS_STRICT=true` → 403); (d) hashed public share tokens for `market_update_qa_shares` (dual-read migration) remains open — deferred out of WP-13 into a follow-on ticket because the store is already ownership-guarded on create and rate-limited on resolve."
    },
    {
      "finding_id": "WP-14-CI-LAUNCH-GATE",
      "severity": "high",
      "file_or_function": "supabase/functions-registry/SECURITY_REGISTRY.json; supabase/functions-registry/needs-review-baseline.json; scripts/security/check-function-registry.mjs; scripts/security/check-edge-functions.mjs; .github/workflows/ci.yml",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": true,
      "live_negative_test": false,
      "residual_risk": "WP-14 closes the CI launch gate. (1) **Zero backlog**: reclassified the entire 232-function `needs-review` / 284-function `unreviewed` backlog against the actual auth pattern in each `index.ts` (verifyPortalSession → portal-authenticated; verifyInternal / x-internal-edge-secret / callInternalFunction → internal-service; verifyRequiredCronSecret → cron-worker; VAPI/GHL/AUTO_REPORT/DocuSign webhook secrets → webhook-secret; Outlook clientState → webhook-clientstate; requireSuperadmin → superadmin-only; hasModuleAccess/checkPermission → module-gated; verifyHuman/verifyAuth/getUserFromRequest → human-authenticated). Residual public/callback/handoff endpoints (abs/climate/crime/school/public-transport data services, google-places-autocomplete, request-lead-magnet, finance-email-track-pixel, get-vapid-public-key → public; finance-portal-handoff-redeem, template-share → public-auth; pdf-parse-callback, pdf-parse-chunk-callback → webhook-secret; bootstrap-cron-vault, pdf-import-ssim-score → internal-service) were manually classified. Every entry now has `reviewed:true` and an `wp14_auto_classified` marker so the audit trail is preserved. Added the missing `security-step-up` (WP-11B) entry. (2) **Strict gate**: `check-function-registry.mjs` no longer consults the baseline — any `needs-review` entry OR any `reviewed !== true` entry fails CI immediately. `needs-review-baseline.json` is pinned to empty arrays. (3) **Full type-check**: `deno check` now runs against every function entry point via `scripts/security/check-edge-functions.mjs` in CI, not only the seven shared trust modules — matching the WP-14 requirement that a broken import in any function fails the pipeline. (4) **CI wiring**: added the WP-12 internal-legacy-fallback gate and the WP-05A/05C agent tool policy + bulk-ceiling gates as first-class CI steps so they cannot be skipped. Static scans (R1–R6), the golden-render isolation guard, secret scan (gitleaks), and SBOM/dependency gates remain in place. **Still owed**: (a) sample-audit a random 10% of the auto-classified functions for correctness; (b) live negative tests confirming CI red-flags a new `needs-review` addition, a new `reviewed:false` addition, and an on-disk function missing from the registry; (c) rotate any long-lived internal caller secrets after WP-12 strict mode has been running for a full sweep."
    },
    {
      "finding_id": "WP-15-DEPLOY-VERIFICATION",
      "severity": "high",
      "file_or_function": "docs/security/live-verification.sql; docs/security/WP15_DEPLOYMENT_CHECKLIST.md; docs/security/WP15_NEGATIVE_TEST_MATRIX.md; scripts/security/wp15-launch-gate.mjs; .github/workflows/ci.yml",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": false,
      "live_negative_test": false,
      "residual_risk": "WP-15 delivers the launch-gate scaffolding required by §22 of the Codex plan. **In source**: (1) `docs/security/live-verification.sql` — read-only SQL matching §22.3 (RLS + FORCE RLS coverage, permissive policies, SECURITY DEFINER exposure to anon/authenticated/public, bucket privacy, direct storage.objects policies, role_table_grants for anon/authenticated/public, Postgres version + auth triggers, WP-06 storage_object_bindings coverage across sensitive buckets, WP-11A session-token-hash regression check, WP-03 cron plaintext-JWT sweep). (2) `docs/security/WP15_DEPLOYMENT_CHECKLIST.md` — the operator runbook (§22.1 sequence, §22.2 secret/config checklist, §22.5 launch criteria with a hard sign-off block). (3) `docs/security/WP15_NEGATIVE_TEST_MATRIX.md` — 32 negative tests covering §22.4 (forged/expired/alg=none JWTs, anon key to sensitive functions, arbitrary Bearer to Market AI, cron/HMAC missing/replayed, cross-user portal + report-qa + email-copilot IDs, low-priv agent tools + step-up replay, duplicate payout/send, direct-object storage + binding-mismatch, CSRF/Turnstile, oversized ZIP, SSRF alternate host encodings, Outlook replay + clientState mismatch, metering degradation, quota boundary, session expiry, ID enumeration). (4) `scripts/security/wp15-launch-gate.mjs` — CI aggregator that fails the pipeline if the registry regresses OR any WP-15 artefact is missing OR the tracker is invalid or loses its WP-15 entry; wired into the security job in `.github/workflows/ci.yml`. (5) **`scripts/security/wp15-negative-tests.mjs` (new)** — runnable harness covering NT-05 (arbitrary Bearer → market-updates-qa), NT-06 (missing X-Cron-Secret), NT-07 (wrong X-Cron-Secret), NT-09 (missing X-Internal-Signature), NT-09b (forged signature), and NT-11 (admin fn without JWT). Writes JSONL evidence under `docs/security/wp15-evidence/<date>/negative-tests.jsonl`; a non-zero exit fails the environment in which the operator runs it. **Not yet deployed**: WP-15 is scaffolding — it becomes `deployed:true` only after the operator (a) runs `live-verification.sql` against the deployed database and files evidence under `docs/security/wp15-evidence/<date>/`, (b) executes the full negative-test matrix against the deployed Edge Function fleet with zero `unexpected_allow` (the runnable WP-12 subset and remaining session/portal/webhook fixtures require the appropriate deployed-environment configuration), (c) confirms every checkbox in `WP15_DEPLOYMENT_CHECKLIST.md` including the 24-hour post-cutover monitoring window, and (d) attaches an independent pentest report with Critical/High findings closed or formally accepted."
    },
    {
      "finding_id": "WP-11B-COOKIE-ONLY-STAFF-SESSIONS",
      "severity": "high",
      "file_or_function": "supabase/functions/_shared/auth.ts (extractSessionToken, createSessionCookie, createClearSessionCookies); docs/security/WP11BC_COOKIE_ONLY_ROLLOUT.md",
      "owner": "security-remediation-program",
      "pr_or_commit": null,
      "source_fixed": true,
      "deployed": false,
      "live_negative_test": false,
      "residual_risk": "WP-11B Phase 1 (backend cookie hardening) is source-fixed. `createSessionCookie()` now emits `__Host-session_token` (RFC 6265bis host-prefix; browsers enforce Secure, Path=/, no Domain). `extractSessionToken()` dual-reads `__Host-session_token` then falls back to legacy `session_token` for the migration window. `createClearSessionCookies()` clears BOTH names on logout so a legacy cookie cannot resurrect a session. **Not deployed** until every login/refresh issuer (`auth-login`, `auth-refresh-session`, `portal-login`, `finance-portal-login`, `security-step-up`) is redeployed and the frontend (`useAuth`, `useAuthenticatedSupabase`, `useFinancePortalAuth`) stops persisting the raw token in `sessionStorage`/`localStorage` and starts sending `credentials: 'include'` on every edge-function call. Rollout sequence and file inventory documented in `docs/security/WP11BC_COOKIE_ONLY_ROLLOUT.md`. Still owed: (a) redeploy issuers so new logins land on `__Host-` cookie; (b) frontend storage-token removal; (c) CORS credentials audit; (d) live negative tests (cookie without matching Origin, cookie replay across portal, idle-expired session, `credentials: 'include'` audit, `__Host-` cookie without Secure rejected by browser)."
    }
  ]
}




