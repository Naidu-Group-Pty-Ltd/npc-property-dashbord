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
 *       'issued'   → signed URL to the frozen as-issued PDF (generated from
 *                    the frozen version row on first ask).
 *       'executed' → signed URL to the executed master, same rule; the
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
  agreementTemplate,
  templateKeyForDirection,
  versionLabel,
} from '../_shared/agreements/index.pure.ts';
import {
  AGREEMENTS_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  executionContextFromSignatures,
  renderAgreementPdf,
  renderAndStoreVersionPdf,
} from '../_shared/agreements/render.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

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

      let path: string | null = kind === 'executed'
        ? version.executed_pdf_storage_path
        : version.pdf_storage_path;
      if (!path) {
        const execution = kind === 'executed'
          ? executionContextFromSignatures(
            (await supabase.from('partner_agreement_signatures').select('*').eq('version_id', version.id)).data ?? [])
          : null;
        const stored = await renderAndStoreVersionPdf(supabase, supabaseUrl, agreement, version, kind, execution);
        path = stored.path;
        await supabase.from('partner_agreement_versions')
          .update(kind === 'executed'
            ? { executed_pdf_storage_path: path, executed_pdf_bytes: stored.bytes }
            : { pdf_storage_path: path })
          .eq('id', version.id);
      }

      const fileName = agreementDownloadFileName(
        title, agreement.partner_legal_name, version.version_label, kind,
      );
      const { data: signed, error: signError } = await supabase.storage
        .from(AGREEMENTS_BUCKET)
        .createSignedUrl(path!, SIGNED_URL_TTL_SECONDS, { download: fileName });
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
      });
    }

    return json({ error: 'unknown_operation' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('[agreement-centre-render] error:', message);
    return json({ error: message }, 500);
  }
});
