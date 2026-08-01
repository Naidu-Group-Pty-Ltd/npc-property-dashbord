## Scope

The internal (staff) messaging tool in the Aurixa agent widget calls exactly one edge function from the frontend — `internal-messaging`. Verified call sites:

- `src/components/agent/InternalMessagesPanel.tsx:99`
- `src/components/agent/InternalMessageToasts.tsx:283, 303, 530`
- `src/lib/internalMessageAttachments.ts:67`

It imports only `../_shared/auth.ts` (CORS + `verifyAuth`), which is bundled with the deploy.

Notification delivery for internal messages happens through DB triggers writing to `notifications`, then the existing feed/push functions — so those are the only adjacent pieces worth refreshing.

## Plan

1. Redeploy `internal-messaging` (primary — this is the function that served the stale `unknown action: attachment_upload_url` build).
2. Redeploy the notification delivery functions that carry internal-message alerts so the whole path runs the current source: `notifications-feed`, `send-web-push`.
3. Verify after deploy:
   - Call `internal-messaging` with `action: list_threads` and confirm it returns an auth-gated response (401 without a session) rather than a routing error.
   - Call `action: attachment_upload_url` and confirm the response is no longer `unknown action` (a 401/403 is the expected unauthenticated result).
   - Check recent `internal-messaging` logs for boot errors.

No code changes, no SQL migrations — deploy-only.

## Technical notes

- Deploys go through `supabase--deploy_edge_functions`; edge deploys are immediate and do not require a Publish.
- `push-subscribe` / `push-unsubscribe` are subscription-management only and are left untouched unless you want them included.
- `message-governance`, `finance-portal-messages`, and `staff-client-portal-messages` belong to the client/finance portals, not internal staff messaging, so they are out of scope.
