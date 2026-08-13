/**
 * agreement-centre-render — staff-side document delivery.
 *
 * Separated from `manage-partner-agreements` so lifecycle actions stay fast:
 * everything here calls the PDF service, which is seconds, not milliseconds.
 *
 * Operations
 *   preview  { id, include_template_pack? }
 *       The working document as it stands right now — live row, live brand —
 *       returned as base64 PDF for the in-app viewer. Never stored: a preview
 *       is a look, not a record.
 *   download { id, kind: 'draft' | 'issued' | 'executed' }
 *       'draft'    → rendered fresh from the live row, returned as base64
 *                    (with the template pack — this is the manual-path export).
 *       'issued'   → signed URL to the as-issued PDF, rendered from the frozen
 *                    version row on first ask and RE-rendered from those same
 *                    frozen inputs when this build's document revision has
 *                    moved past the stored artefact's — unless the version has
 *                    been signed, which freezes it for good. The response says
 *                    which of those happened.
 *       'executed' → signed URL to the executed master, generated on first ask
 *                    and never refreshed afterwards: it is the instrument. The
 *                    download of a legal record is written to the security
 *                    audit log, exactly like partner-agreement-records.
 *
 * Auth: staff session + `agreements` module (view). CSRF enforced — download
 * can write the stored artefact on first ask.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, createForbiddenResponse, verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';
import {
  agreementDownloadFileName,
} from '../_shared/agreements/documentHtml.pure.ts';
import {
  AGREEMENT_CENTRE_DOCUMENT_REVISION,
  agreementDelivery,
  agreementTemplate,
  partnerNotificationsAddressable,
  partnerPortalAccess,
  recipientBlocker,
  resolveRecipients,
  templateKeyForDirection,
  versionLabel,
} from '../_shared/agreements/index.pure.ts';
import { sendAgreementEmail } from '../_shared/agreements/sendAgreementEmail.ts';
import {
  AGREEMENTS_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  executionContextFromSignatures,
  loadIssuerDefaults,
  renderAgreementPdf,
  resolveVersionArtefact,
} from '../_shared/agreements/render.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

/**
 * Where a partner opens their copy. Pinned to the production domain for the
 * same reason `finance-portal-invite` pins its own: `APP_URL` has leaked
 * preview hostnames into partner-facing mail before, and a link a partner
 * cannot reach is worse than no link.
 */
const PARTNER_PORTAL_BASE = 'https://command-centre.npcservices.com.au';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const body = await req.json().catch(() => ({}));

    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return json({ error: auth.error || 'Authentication required' }, 401);
    }
    const authz = await requireModulePermission(
      supabase, { userId: auth.userId, authMethod: auth.authMethod }, 'agreements', 'can_view',
    );
    if (!authz.ok) return createForbiddenResponse(authz.error || 'Not authorized', corsHeaders);

    const operation = typeof body.operation === 'string' ? body.operation : null;

    // ─── TEMPLATE (no agreement row) ────────────────────────
    // The white-labelled template itself, for users sending through an
    // external platform (DocuSign, PandaDoc, …): the full pack including the
    // partner email page, the issuer's own details prefilled from settings,
    // every other field printing its original bracket text.
    if (operation === 'template') {
      const templateKey = body.template_key === 'finance_referral_commission'
        ? 'finance_referral_commission' as const
        : 'strategic_property_referral' as const;
      const issuer = await loadIssuerDefaults(supabase);
      const pseudoRow = {
        id: `template-${templateKey}`,
        direction: templateKey === 'strategic_property_referral'
          ? 'inbound_property_referral' : 'outbound_finance_referral',
        document_version: '2.0',
        // The tenant is the buyer's agency in both templates.
        principal_legal_name: issuer.legalName ?? issuer.companyName,
        principal_trading_name: issuer.companyName,
        principal_abn: issuer.abn,
        principal_address: issuer.address,
        principal_contact_email: issuer.email,
        schedule_extras: {},
      };
      const rendered = await renderAgreementPdf(supabase, supabaseUrl, {
        row: pseudoRow as never,
        versionLabel: 'Template',
        statusKey: null,
        includeTemplatePack: true,
      });
      const title = agreementTemplate(templateKey).title;
      return json({
        pdf_base64: toBase64(rendered.pdf),
        gaps: rendered.gaps,
        file_name: `${title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')}-template.pdf`,
      });
    }

    const id = typeof body.id === 'string' ? body.id : null;
    if (!id) return json({ error: 'id_required' }, 400);

    const { data: agreement } = await supabase.from('partner_agreements')
      .select('*').eq('id', id).maybeSingle();
    if (!agreement) return json({ error: 'not_found' }, 404);

    const templateKey = templateKeyForDirection(agreement.direction);
    const title = agreementTemplate(templateKey).title;
    const workingLabel = agreement.issued_version_id
      ? null // resolved below when needed
      : `${versionLabel(agreement.version ?? 1, 1)} draft`;

    if (operation === 'preview') {
      const rendered = await renderAgreementPdf(supabase, supabaseUrl, {
        row: agreement,
        versionLabel: workingLabel ?? 'preview',
        statusKey: agreement.status,
        includeTemplatePack: body.include_template_pack === true,
      });
      return json({
        pdf_base64: toBase64(rendered.pdf),
        gaps: rendered.gaps,
        file_name: agreementDownloadFileName(title, agreement.partner_legal_name, String(agreement.version ?? 1), 'draft'),
      });
    }

    // ─── SEND / RESEND ──────────────────────────────────────
    // The Command Centre had no way to send an issued agreement anywhere. The
    // issue itself wrote one in-app notification and nothing else, so a partner
    // who had not logged in received no signal at all, and once issued there
    // was no second chance — no resend, no covering note, no way to copy the
    // broker's admin or a compliance mailbox.
    //
    // It lives here rather than in `manage-partner-agreements` for the same
    // reason every other document operation does: it renders a PDF, which is
    // seconds, and lifecycle actions stay fast.
    if (operation === 'send') {
      const versionId = agreement.issued_version_id as string | null;
      if (!versionId) {
        return json({
          error: 'no_issued_version',
          message: 'Issue the agreement before sending it.',
        }, 409);
      }
      const { data: version } = await supabase.from('partner_agreement_versions')
        .select('*').eq('id', versionId).maybeSingle();
      if (!version) return json({ error: 'no_issued_version' }, 404);

      const recipients = resolveRecipients(
        agreement.partner_contact_email as string | null,
        typeof body.additional_recipients === 'string' ? body.additional_recipients : '',
      );
      const blocker = recipientBlocker(recipients);
      if (blocker) return json({ error: 'recipients_invalid', message: blocker }, 422);

      // The attachment is the stored artefact, refreshed if this build's
      // document revision has moved past it — never a re-render of the live
      // row. What the partner receives and what the Issued PDF download hands
      // over have to be one document.
      const signatureRows = (await supabase.from('partner_agreement_signatures')
        .select('*').eq('version_id', version.id)).data ?? [];
      let pdf: { fileName: string; base64: string } | null = null;
      try {
        const artefact = await resolveVersionArtefact(
          supabase, supabaseUrl, agreement, version, 'issued',
          { signatureCount: signatureRows.length },
        );
        if (artefact.rendered) {
          await supabase.from('partner_agreement_versions')
            .update({ pdf_storage_path: artefact.path }).eq('id', version.id);
        }
        const { data: blob } = await supabase.storage
          .from(AGREEMENTS_BUCKET).download(artefact.path);
        if (blob) {
          pdf = {
            fileName: agreementDownloadFileName(
              title, agreement.partner_legal_name, version.version_label, 'issued',
            ),
            base64: toBase64(new Uint8Array(await blob.arrayBuffer())),
          };
        }
      } catch (e) {
        // A renderer outage must not stop the partner being told. The email
        // still carries the portal link, which is the actionable half.
        console.warn('[agreement-centre-render] send without attachment:', e instanceof Error ? e.message : e);
      }

      const access = partnerPortalAccess({
        row: (await supabase.from('finance_portal_users')
          .select('id, is_active, revoked_at, password_hash, invite_accepted_at')
          .eq('finance_contact_id', agreement.finance_agent_contact_id).maybeSingle()).data ?? null,
      });

      const issuer = await loadIssuerDefaults(supabase);
      const email = await sendAgreementEmail({
        to: recipients.all,
        title,
        partnerName: agreement.partner_legal_name as string | null,
        issuerName: issuer.companyName ?? issuer.legalName ?? '',
        versionLabel: String(version.version_label),
        portalUrl: `${PARTNER_PORTAL_BASE}/finance/agreements/${id}`,
        note: typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null,
        pdf,
        isResend: body.is_resend === true,
        awaitingActivation: agreementDelivery(agreement.issued_at, access) === 'awaiting_activation',
      });

      // Re-raise the in-app notification unless the caller asked not to. It is
      // separately useful: a partner already in the portal sees it without
      // going to their inbox.
      let notified = false;
      if (body.notify_portal !== false && partnerNotificationsAddressable(access)) {
        const { data: portalUser } = await supabase.from('finance_portal_users')
          .select('id').eq('finance_contact_id', agreement.finance_agent_contact_id).maybeSingle();
        if (portalUser?.id) {
          const { error: notifyError } = await supabase.from('finance_portal_notifications').insert({
            portal_user_id: portalUser.id,
            client_id: null,
            notification_type: 'agreement_resent',
            title: 'Agreement sent to you',
            body: `${title} (version ${version.version_label}) is ready for your review.`,
            link_path: `/finance/agreements/${id}`,
            metadata: { agreement_id: id, origin_portal: 'command_center' },
          });
          notified = !notifyError;
        }
      }

      // Who was sent what, and when. A copy of an agreement leaving the tenant
      // is a compliance fact, so it is on the agreement's own timeline rather
      // than only in a log — the recipients are recorded, the note is not.
      await supabase.from('partner_agreement_events').insert({
        agreement_id: id,
        event_type: 'agreement_sent',
        actor_id: auth.userId === 'service_role' ? null : auth.userId,
        actor_label: 'Command Centre',
        summary: email.sent
          ? `Sent to ${recipients.all.join(', ')}`
          : `Send to ${recipients.all.join(', ')} failed`,
        payload: {
          recipients: recipients.all,
          additional_count: recipients.additional.length,
          attached: pdf !== null,
          email_sent: email.sent,
          email_error: email.error,
          notified_portal: notified,
          version_label: version.version_label,
        },
      }).then(({ error }: { error: unknown }) => {
        if (error) console.error('[agreement-centre-render] send event insert failed:', error);
      });

      if (!email.sent) {
        return json({
          error: 'email_failed',
          message: `The agreement could not be emailed: ${email.error ?? 'unknown error'}.`
            + (notified ? ' The portal notification was raised.' : ''),
          notified_portal: notified,
        }, 502);
      }

      return json({
        sent_to: recipients.all,
        attached: pdf !== null,
        notified_portal: notified,
        duplicates: recipients.duplicates,
        overflow: recipients.overflow,
        message_id: email.messageId,
      });
    }

    if (operation === 'download') {
      const kind = body.kind === 'issued' ? 'issued' : body.kind === 'executed' ? 'executed' : 'draft';

      if (kind === 'draft') {
        const rendered = await renderAgreementPdf(supabase, supabaseUrl, {
          row: agreement,
          versionLabel: `${agreement.version ?? 1}.0 draft`,
          statusKey: agreement.status,
          // The manual path: the export carries the full template pack,
          // email page included, exactly as the supplied document does.
          includeTemplatePack: true,
        });
        return json({
          pdf_base64: toBase64(rendered.pdf),
          gaps: rendered.gaps,
          file_name: agreementDownloadFileName(title, agreement.partner_legal_name, String(agreement.version ?? 1), 'draft'),
        });
      }

      const versionId = agreement.issued_version_id as string | null;
      if (!versionId) return json({ error: 'no_issued_version', message: 'This agreement has not been issued yet.' }, 404);
      const { data: version } = await supabase.from('partner_agreement_versions')
        .select('*').eq('id', versionId).maybeSingle();
      if (!version) return json({ error: 'no_issued_version' }, 404);
      if (kind === 'executed' && version.status !== 'executed') {
        return json({ error: 'not_executed', message: 'The agreement has not been fully executed yet.' }, 409);
      }

      // The signatures are read either way: the executed render needs their
      // content, and the issued one needs to know whether any exist before it
      // is allowed to re-typeset.
      const signatureRows = (await supabase.from('partner_agreement_signatures')
        .select('*').eq('version_id', version.id)).data ?? [];
      const artefact = await resolveVersionArtefact(supabase, supabaseUrl, agreement, version, kind, {
        signatureCount: signatureRows.length,
        execution: kind === 'executed' ? executionContextFromSignatures(signatureRows) : null,
      });
      if (artefact.rendered) {
        await supabase.from('partner_agreement_versions')
          .update(kind === 'executed'
            ? { executed_pdf_storage_path: artefact.path, executed_pdf_bytes: artefact.bytes }
            : { pdf_storage_path: artefact.path })
          .eq('id', version.id);
      }

      const fileName = agreementDownloadFileName(
        title, agreement.partner_legal_name, version.version_label, kind,
      );
      const { data: signed, error: signError } = await supabase.storage
        .from(AGREEMENTS_BUCKET)
        .createSignedUrl(artefact.path, SIGNED_URL_TTL_SECONDS, { download: fileName });
      if (signError || !signed?.signedUrl) {
        throw new Error(`signing failed: ${signError?.message ?? 'no url returned'}`);
      }

      if (kind === 'executed') {
        // Downloading an executed agreement is an access event on a legal record.
        await supabase.from('security_audit_log').insert({
          user_id: auth.userId === 'service_role' ? null : auth.userId,
          action: 'partner_agreement_downloaded',
          resource_type: 'partner_agreement_version',
          resource_id: version.id,
          metadata: {
            agreement_id: id,
            version: version.version_label,
            organisation: agreement.partner_legal_name,
          },
        }).then(({ error }: { error: unknown }) => {
          if (error) console.error('[agreement-centre-render] audit insert failed:', error);
        });
      }

      return json({
        url: signed.signedUrl,
        file_name: fileName,
        expires_in: SIGNED_URL_TTL_SECONDS,
        // The revision this function is actually running, so the app can say
        // "the render service has not been deployed yet" instead of letting a
        // superseded document leave in a partner's direction unremarked.
        document_revision: AGREEMENT_CENTRE_DOCUMENT_REVISION,
        artefact_state: artefact.state,
        refreshed: artefact.rendered && artefact.state === 'stale',
      });
    }

    return json({ error: 'unknown_operation' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[agreement-centre-render] error:', message);
    return json({ error: message }, 500);
  }
});
