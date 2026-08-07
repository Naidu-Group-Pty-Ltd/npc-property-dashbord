/**
 * Partner Agreement Records — Command Centre control plane.
 *
 * Every executed Portal Access, Confidentiality, Privacy and AML/CTF Compliance
 * Passport Agreement, across the Solicitor, Builder/Developer and Finance
 * portals, with a downloadable copy of each.
 *
 * Operations
 *   list_records     { portal }        — who has executed what, and whether a copy exists
 *   download_record  { acceptance_id } — a signed URL for the copy, generating it if absent
 *
 * This function serves the INTERNAL surface only. It resolves a Command Centre
 * session and never accepts a portal session cookie (ADR 018), and it is gated
 * deny-by-default on the admin module of the portal being asked about — the
 * Solicitor tab's permission does not open the Finance tab's agreements.
 *
 * WHY GENERATION LIVES HERE rather than in the accept path: an acceptance must
 * never fail because a PDF renderer is down, and every acceptance already taken
 * — including those from before this existed — must still be able to produce a
 * copy. So the first download renders and stores; every later one serves the
 * same stored bytes. The file is written once and never replaced, so the copy a
 * partner holds and the copy the Command Centre holds are the same document.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, createForbiddenResponse, verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { csrfDenied, enforceCsrf } from '../_shared/csrfGuard.ts';
import { getBrandConfig } from '../_shared/brand-config.ts';
import { renderPdf, weasyPrintConfig } from '../_shared/weasyprintClient.ts';
import { renderMarkdown } from '../_shared/reports/markdown.pure.ts';
import { PORTAL_TERMS_ACKNOWLEDGEMENTS } from '../_shared/portalAgreement.ts';
import {
  agreementFileName,
  agreementStoragePath,
  buildPartnerAgreementDocument,
  PORTAL_LABELS,
} from '../_shared/partnerAgreementDocument.pure.ts';

const BUCKET = 'partner-agreements';
const SIGNED_URL_TTL_SECONDS = 300;

/** The admin module that owns each portal's agreements. */
const MODULE_BY_PORTAL: Record<string, string> = {
  solicitor: 'solicitor_portal_admin',
  builder: 'builder_portal_admin',
  finance: 'finance_portal_admin',
};

const PORTALS = Object.keys(MODULE_BY_PORTAL);

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* a bare call has no body */ }
    const operation = typeof body.operation === 'string' ? body.operation : null;

    // 1. Command Centre session. A portal cookie is not a staff session.
    const auth = await verifyAuth(supabase, req.headers, body as any);
    if (auth.error || !auth.userId) {
      return json({ error: auth.error || 'Authentication required' }, 401);
    }

    // 2. `download_record` can write the artefact, so it is a mutation and the
    //    staff session is cookie-carried.
    if (operation === 'download_record') {
      const csrf = enforceCsrf(req);
      if (!csrf.ok) return csrfDenied(corsHeaders, csrf);
    }

    if (operation === 'list_records') {
      const portal = typeof body.portal === 'string' ? body.portal : null;
      if (!portal || !PORTALS.includes(portal)) {
        return json({ error: 'A known portal is required' }, 400);
      }

      const authz = await requireModulePermission(
        supabase, { userId: auth.userId, authMethod: auth.authMethod },
        MODULE_BY_PORTAL[portal], 'can_view',
      );
      if (!authz.ok) return createForbiddenResponse(authz.error || 'Not authorized', corsHeaders);

      const { data, error } = await supabase
        .from('partner_agreement_records')
        .select('*')
        .eq('portal', portal)
        .order('accepted_at', { ascending: false });
      if (error) throw error;

      return json({ success: true, records: data ?? [] });
    }

    if (operation === 'download_record') {
      const acceptanceId = typeof body.acceptance_id === 'string' ? body.acceptance_id : null;
      if (!acceptanceId) return json({ error: 'An acceptance id is required' }, 400);

      // The record is read server-side before anything is authorised: a browser
      // -supplied portal would otherwise let a Finance-only user name a
      // solicitor acceptance and have it checked against the Finance module.
      const { data: record, error: recordError } = await supabase
        .from('partner_agreement_records')
        .select('*')
        .eq('acceptance_id', acceptanceId)
        .maybeSingle();
      if (recordError) throw recordError;
      if (!record) return json({ error: 'Agreement record not found' }, 404);

      const module = MODULE_BY_PORTAL[record.portal as string];
      if (!module) return json({ error: 'Agreement record not found' }, 404);

      const authz = await requireModulePermission(
        supabase, { userId: auth.userId, authMethod: auth.authMethod },
        module, 'can_view',
      );
      if (!authz.ok) return createForbiddenResponse(authz.error || 'Not authorized', corsHeaders);

      const path = record.agreement_storage_path
        ?? await generateAgreementCopy(supabase, record);

      const { data: signed, error: signError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, {
          download: agreementFileName(record.organisation_name, record.accepted_at),
        });
      if (signError || !signed?.signedUrl) {
        throw new Error(`signing failed: ${signError?.message ?? 'no url returned'}`);
      }

      // Downloading an executed agreement is an access event on a legal record.
      await supabase.from('security_audit_log').insert({
        user_id: auth.userId === 'service_role' ? null : auth.userId,
        action: 'partner_agreement_downloaded',
        resource_type: 'portal_terms_acceptance',
        resource_id: acceptanceId,
        metadata: {
          portal: record.portal,
          version: record.version,
          organisation: record.organisation_name,
        },
      }).then(({ error }) => {
        // An audit write must not swallow the download, but it must be visible.
        if (error) console.error('[partner-agreement-records] audit insert failed:', error);
      });

      return json({
        success: true,
        url: signed.signedUrl,
        file_name: agreementFileName(record.organisation_name, record.accepted_at),
        expires_in: SIGNED_URL_TTL_SECONDS,
      });
    }

    return json({ error: 'Unknown operation' }, 400);
  } catch (error: any) {
    console.error('[partner-agreement-records] error:', error);
    return json({ error: error?.message || 'Internal server error' }, 500);
  }
});

/**
 * Render and store the executed copy, then remember where it went.
 *
 * Called only when the acceptance has no artefact yet. The branding and the
 * party names are snapshotted onto the acceptance in the same write, because
 * both are editable and an executed agreement must keep saying what it said.
 */
async function generateAgreementCopy(supabase: any, record: any): Promise<string> {
  const weasyprint = weasyPrintConfig((key) => Deno.env.get(key));
  if (!weasyprint) throw new Error('The PDF renderer is not configured');

  const { data: version, error: versionError } = await supabase
    .from('portal_terms_versions')
    .select('content_markdown, title, version, document_hash')
    .eq('id', record.terms_version_id)
    .maybeSingle();
  if (versionError) throw versionError;
  if (!version?.content_markdown) throw new Error('The agreement text is unavailable');

  const markdown = renderMarkdown(version.content_markdown);
  if (markdown.truncated) {
    // A clipped legal document is worse than no document: fail loudly.
    throw new Error('The agreement text exceeded the renderer limits and would have been clipped');
  }

  const brandConfig = await getBrandConfig(supabase);
  const brand = {
    companyName: brandConfig.companyName,
    abn: brandConfig.abn || null,
    contactEmail: brandConfig.contactEmail || null,
    contactPhone: brandConfig.contactPhone || null,
    contactWebsite: brandConfig.contactWebsite || null,
    contactAddress: brandConfig.contactAddress || null,
  };
  const party = {
    organisationName: record.organisation_name ?? null,
    organisationTradingName: record.organisation_trading_name ?? null,
    acceptedByName: record.accepted_by_name ?? null,
    acceptedByEmail: record.accepted_by_email ?? null,
  };

  // Only the acknowledgments this acceptance actually asserted, and only ones
  // the agreement defines. An acceptance taken before acknowledgments were
  // recorded prints none rather than inventing four.
  const asserted = new Set<string>(Array.isArray(record.acknowledgements) ? record.acknowledgements : []);
  const acknowledgements = PORTAL_TERMS_ACKNOWLEDGEMENTS.filter((item) => asserted.has(item.key));

  const { data: acceptance } = await supabase
    .from('portal_terms_acceptances')
    .select('ip_hash, user_agent_hash')
    .eq('id', record.acceptance_id)
    .maybeSingle();

  const generatedAt = new Date().toISOString();
  const html = buildPartnerAgreementDocument({
    brand,
    party,
    agreementHtml: markdown.html,
    execution: {
      portal: record.portal,
      portalLabel: PORTAL_LABELS[record.portal] ?? record.portal,
      acceptanceId: record.acceptance_id,
      version: version.version,
      title: version.title,
      documentHash: version.document_hash ?? null,
      acceptedAt: record.accepted_at,
      acknowledgements,
      hasIpFingerprint: Boolean(acceptance?.ip_hash),
      hasUserAgentFingerprint: Boolean(acceptance?.user_agent_hash),
      generatedAt,
    },
  });

  const pdf = await renderPdf(weasyprint, html, {
    variant: 'pdf/ua-1',
    tagged: true,
    provenance: {
      format: 'partner-agreement',
      sourceId: record.acceptance_id,
      renderedAt: generatedAt,
    },
  });

  const path = agreementStoragePath(record.portal, record.acceptance_id, record.accepted_at);
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, pdf, {
    contentType: 'application/pdf',
    // Never overwrite. If two requests race, the loser reuses the winner's
    // bytes rather than replacing a document someone may already hold.
    upsert: false,
    cacheControl: '3600',
  });
  if (uploadError && !/exists/i.test(uploadError.message)) {
    throw new Error(`storage upload failed: ${uploadError.message}`);
  }

  const { error: stampError } = await supabase
    .from('portal_terms_acceptances')
    .update({
      agreement_storage_path: path,
      agreement_generated_at: generatedAt,
      agreement_pdf_bytes: pdf.length,
      agreement_brand_snapshot: brand,
      agreement_party_snapshot: party,
    })
    .eq('id', record.acceptance_id)
    .is('agreement_storage_path', null);
  if (stampError) throw stampError;

  return path;
}
