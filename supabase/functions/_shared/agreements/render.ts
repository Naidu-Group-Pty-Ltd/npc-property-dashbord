/**
 * Agreement Centre — server-side rendering and storage.
 *
 * The impure companion to `documentHtml.pure.ts`: reads the brand snapshot,
 * renders through WeasyPrint, writes the private bucket. Three rules:
 *
 *  - **Draft previews float; issued documents freeze.** A working preview
 *    renders from the live row and the live brand. An issued or executed
 *    render uses the version row's frozen `field_values` and `brand_snapshot`
 *    — a partner re-downloading version 1.0 after the tenant rebrands gets
 *    the document they were issued, not a repaint.
 *  - **Storage is write-once.** `upsert: false` everywhere; a race reuses the
 *    winner's bytes. No stored object is ever replaced.
 *  - **A missing renderer degrades, never corrupts.** Neither issue nor
 *    execution fails because WeasyPrint is down — the same rule as portal
 *    acceptances. The artefact is generated on the first download instead,
 *    from the frozen version row, so it is the same document either way.
 */

import { assertSafeRenderResources } from '../renderResourcePolicy.pure.ts';
import { fetchReportBrandSnapshot } from '../reportDesign/fetchBrandSnapshot.ts';
import type { ReportBrandSnapshot } from '../reportDesign/snapshot.pure.ts';
import { renderPdf, weasyPrintConfig } from '../weasyprintClient.ts';

import {
  buildAgreementDocument,
  agreementCentreStoragePath,
} from './documentHtml.pure.ts';
import type { AgreementExecutionContext, AgreementSignatureRecord } from './documentHtml.pure.ts';
import { projectFieldValues } from './fields.pure.ts';
import type { AgreementFieldValues } from './types.pure.ts';
import { agreementContentForValues, templateKeyForDirection } from './index.pure.ts';

export const AGREEMENTS_BUCKET = 'partner-agreements';
export const SIGNED_URL_TTL_SECONDS = 300;

// Rows are handled loosely on purpose: the columns this module reads are
// stable, and a generated row type would couple it to the whole schema.
type Row = Record<string, unknown> & { id: string };

export interface IssuerDefaults {
  companyName: string | null;
  legalName: string | null;
  abn: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
}

/**
 * The tenant's own identity, for prefilling the issuer party block — a light
 * read of the same two tables the brand snapshot uses, without inlining logos.
 */
export async function loadIssuerDefaults(supabase: any): Promise<IssuerDefaults> {
  const [{ data: whitelabel }, { data: contactRow }] = await Promise.all([
    supabase.from('whitelabel_settings').select('company_name, theme_config').limit(1).maybeSingle(),
    supabase.from('global_report_settings').select('setting_value').eq('setting_key', 'contact_details').maybeSingle(),
  ]);
  const contact = (contactRow?.setting_value ?? {}) as Record<string, unknown>;
  const themeConfig = (whitelabel?.theme_config ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => {
    const text = String(v ?? '').trim();
    return text || null;
  };
  return {
    companyName: str(themeConfig.tradingName) ?? str(contact.tradingName) ?? str(whitelabel?.company_name),
    legalName: str(contact.name) ?? str(whitelabel?.company_name),
    abn: str(contact.abn),
    address: str(contact.address),
    email: str(contact.email),
    phone: str(contact.phone),
    website: str(contact.website),
  };
}

/** `show_platform_attribution` from the tenant's theme config. Default off. */
export async function loadAttributionSetting(supabase: any): Promise<boolean> {
  const { data } = await supabase
    .from('whitelabel_settings').select('theme_config').limit(1).maybeSingle();
  const config = (data?.theme_config ?? {}) as Record<string, unknown>;
  return config.show_platform_attribution === true;
}

/** The live brand, frozen for a version row. Same fetch as every report. */
export async function captureBrandSnapshot(
  supabase: any,
  url: string,
): Promise<ReportBrandSnapshot> {
  const { snapshot, notes } = await fetchReportBrandSnapshot(supabase, {
    supabaseUrl: url,
    capturedAt: new Date().toISOString(),
  });
  for (const note of notes) console.warn('[agreement-centre] brand:', note);
  return snapshot;
}

export function executionContextFromSignatures(rows: Row[]): AgreementExecutionContext {
  const signatures: AgreementExecutionContext['signatures'] = {};
  for (const row of rows ?? []) {
    const role = String(row.party_role ?? '');
    if (role !== 'partner' && role !== 'principal' && role !== 'loan_writer' && role !== 'client') continue;
    const record: AgreementSignatureRecord = {
      signatoryName: (row.signatory_name as string) ?? null,
      signatoryTitle: (row.signatory_title as string) ?? null,
      legalEntity: (row.legal_entity as string) ?? null,
      signatureTyped: (row.signature_typed as string) ?? null,
      signedAt: (row.signed_at as string) ?? null,
      method: (row.signature_method as string) ?? null,
    };
    signatures[role as keyof AgreementExecutionContext['signatures']] = record;
  }
  return { signatures };
}

export interface AgreementRenderInput {
  row: Row;
  versionLabel: string;
  statusKey?: string | null;
  includeTemplatePack?: boolean;
  execution?: AgreementExecutionContext | null;
  /** Frozen values from a version row; omitted → projected from the live row. */
  values?: AgreementFieldValues | null;
  /** Frozen snapshot from a version row; omitted → the live brand. */
  snapshot?: ReportBrandSnapshot | null;
}

export interface AgreementRenderResult {
  html: string;
  gaps: string[];
  snapshot: ReportBrandSnapshot;
  values: AgreementFieldValues;
}

export async function buildAgreementHtml(
  supabase: any,
  supabaseUrl: string,
  input: AgreementRenderInput,
): Promise<AgreementRenderResult> {
  const templateKey = templateKeyForDirection(String(input.row.direction) as any);

  let snapshot = input.snapshot ?? null;
  if (!snapshot) {
    const fetched = await fetchReportBrandSnapshot(supabase, {
      supabaseUrl,
      capturedAt: new Date().toISOString(),
    });
    for (const note of fetched.notes) console.warn('[agreement-centre] brand:', note);
    snapshot = fetched.snapshot;
  }

  const values = input.values ?? projectFieldValues(templateKey, input.row as any, {
    companyName: snapshot.company.tradingName || snapshot.company.name,
    phone: snapshot.company.phone,
    email: snapshot.company.email,
    website: snapshot.company.website,
  });

  // The wording this agreement actually carries: the locked template plus its
  // own negotiated clause amendments, which travel inside `values` so a frozen
  // version row renders the wording that version was issued with.
  const content = agreementContentForValues(templateKey, values);

  const showPlatformAttribution = await loadAttributionSetting(supabase);

  const { html, gaps } = buildAgreementDocument({
    content,
    values,
    snapshot,
    versionLabel: input.versionLabel,
    agreementId: input.row.id,
    statusKey: input.statusKey ?? null,
    includeTemplatePack: input.includeTemplatePack === true,
    execution: input.execution ?? null,
    showPlatformAttribution,
  });

  return { html, gaps, snapshot, values };
}

export async function renderAgreementPdf(
  supabase: any,
  supabaseUrl: string,
  input: AgreementRenderInput,
): Promise<AgreementRenderResult & { pdf: Uint8Array }> {
  const weasyprint = weasyPrintConfig((key) => Deno.env.get(key));
  if (!weasyprint) throw new Error('The PDF renderer is not configured');

  const result = await buildAgreementHtml(supabase, supabaseUrl, input);
  assertSafeRenderResources(result.html, supabaseUrl);

  const pdf = await renderPdf(weasyprint, result.html, {
    variant: 'pdf/ua-1',
    tagged: true,
    provenance: {
      format: 'partner-agreement-centre',
      sourceId: input.row.id,
      renderedAt: new Date().toISOString(),
    },
  });
  return { ...result, pdf };
}

/**
 * Render and store a version artefact (`issued` or `executed`), returning the
 * storage path. Never overwrites; a concurrent winner's object is reused.
 */
export async function renderAndStoreVersionPdf(
  supabase: any,
  supabaseUrl: string,
  agreementRow: Row,
  versionRow: Row,
  kind: 'issued' | 'executed',
  execution?: AgreementExecutionContext | null,
): Promise<{ path: string; bytes: number }> {
  const rendered = await renderAgreementPdf(supabase, supabaseUrl, {
    row: agreementRow,
    versionLabel: String(versionRow.version_label),
    statusKey: kind === 'executed' ? 'active' : String(agreementRow.status ?? ''),
    includeTemplatePack: false,
    execution: execution ?? null,
    values: (versionRow.field_values as AgreementFieldValues) ?? null,
    snapshot: (versionRow.brand_snapshot as ReportBrandSnapshot) ?? null,
  });

  const path = agreementCentreStoragePath(agreementRow.id, String(versionRow.version_label), kind);
  const { error } = await supabase.storage.from(AGREEMENTS_BUCKET).upload(path, rendered.pdf, {
    contentType: 'application/pdf',
    upsert: false,
    cacheControl: '3600',
  });
  if (error && !/exists/i.test(error.message)) {
    throw new Error(`storage upload failed: ${error.message}`);
  }
  return { path, bytes: rendered.pdf.length };
}
