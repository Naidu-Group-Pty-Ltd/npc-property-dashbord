## What the screenshot shows

The failed file row reads `... .docx: unknown action: attachment_u…` and the composer shows "1 file failed to upload — retry or remove before sending".

That message is produced by the **edge function's own fallback branch** (`unknown action: ${action}`, 400), reached only *after* authentication succeeds. The repo's `supabase/functions/internal-messaging/index.ts` does handle `attachment_upload_url` / `attachment_download_url` (lines ~561–602), and the client (`src/lib/internalMessageAttachments.ts`) sends exactly those action names. So the code is correct; the **currently deployed** copy of `internal-messaging` is an older build that predates the attachment actions — every upload ticket request 400s, retries 4× with fresh tickets, and lands as a hard failure.

## Fix

1. **Redeploy `internal-messaging`** with the current repo source (this is the actual fix — no code change needed for the reported error). Then confirm the deployed build answers `attachment_upload_url` for an authenticated participant instead of `unknown action`.
2. **Verify the storage side** so the ticket is usable end to end: `internal-message-attachments` bucket exists and is private, and the `storage.objects` policies allow the service-role-minted signed upload/download path.
3. **Make this class of failure diagnosable instead of cryptic** (small, contained client change in `src/lib/internalMessageAttachments.ts`):
   - When the ticket request fails with an `unknown action` / non-retryable 4xx, stop retrying immediately and surface "Attachment service out of date — redeploy required" rather than burning 4 attempts.
   - Keep the existing per-file retry button and progress behaviour untouched.
4. **Verify in the browser** via Playwright against the running preview: open the Aurixa internal messages panel, attach a document to an existing thread, and confirm the progress bar completes, the chip turns green, and the message sends with the attachment.

## Technical notes

- No SQL migration is expected; the group/archive migrations from the previous turn are already applied.
- Deployment scope is limited to the single `internal-messaging` function so the other tri-portal functions are untouched.
- Server-side magic-byte screening in `send_message` stays as-is; a `.docx` will screen clean, and anything unreadable is marked `unscanned` rather than rejected.
