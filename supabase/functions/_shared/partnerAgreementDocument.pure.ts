/**
 * The executed copy of a Partner Portal Agreement, as a print document.
 *
 * This is the artefact a partner organisation and the Command Centre both keep:
 * the agreement as it stood when it was executed, the two parties named, and
 * the acceptance that binds them. It is not a receipt and not a summary — the
 * full text is in it, because a copy of an agreement that does not contain the
 * agreement is not a copy.
 *
 * PURE. No network, no storage, no clock: every value it prints is passed in.
 * That is what makes the document reproducible — the same acceptance and the
 * same branding snapshot produce the same bytes, which is the property that
 * lets the Command Centre hand a partner "the" copy rather than "a" copy.
 *
 * WHITE LABEL. The operator side of the document is drawn entirely from the
 * Command Centre's brand configuration, snapshotted at generation. Nothing here
 * hardcodes a company name, an ABN or an address; a deployment configured for a
 * different operator produces that operator's agreement.
 */

export interface AgreementBrand {
  companyName: string;
  abn?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactWebsite?: string | null;
  contactAddress?: string | null;
}

export interface AgreementParty {
  /** Legal name of the partner organisation. */
  organisationName: string | null;
  /** Trading name, when it differs and is worth showing. */
  organisationTradingName?: string | null;
  acceptedByName: string | null;
  acceptedByEmail: string | null;
}

export interface AgreementAcknowledgement {
  key: string;
  heading: string;
  statement: string;
}

export interface AgreementExecution {
  portal: 'solicitor' | 'builder' | 'finance';
  portalLabel: string;
  acceptanceId: string;
  version: string;
  title: string;
  documentHash: string | null;
  acceptedAt: string;
  /** Keys the accepting person asserted. Unknown keys are ignored by the caller. */
  acknowledgements: readonly AgreementAcknowledgement[];
  /** Whether the acceptance carries a hashed source address / user agent. */
  hasIpFingerprint: boolean;
  hasUserAgentFingerprint: boolean;
  /** When this copy was produced. Printed, so a re-issued copy is not mistaken for a re-execution. */
  generatedAt: string;
}

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Australian long form, in UTC, with the zone named. A bare date is ambiguous in a legal record. */
export function formatExecutionTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return escapeHtml(iso);
  const parts = new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC',
  }).formatToParts(date).map((part) => part.value).join('');
  return `${parts} UTC`;
}

const definition = (term: string, value: string | null | undefined): string =>
  value ? `<div class="row"><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>` : '';

/**
 * Build the document.
 *
 * `agreementHtml` is the rendered agreement body — the caller passes the output
 * of the shared Markdown renderer rather than raw Markdown, so this module
 * never becomes a second Markdown implementation.
 */
export function buildPartnerAgreementDocument(input: {
  brand: AgreementBrand;
  party: AgreementParty;
  execution: AgreementExecution;
  agreementHtml: string;
}): string {
  const { brand, party, execution, agreementHtml } = input;

  const operatorContact = [
    brand.abn ? `ABN ${brand.abn}` : null,
    brand.contactAddress,
    brand.contactEmail,
    brand.contactPhone,
    brand.contactWebsite,
  ].filter(Boolean).map((line) => `<div>${escapeHtml(line)}</div>`).join('');

  const acknowledgements = execution.acknowledgements.map((item, index) => `
        <li>
          <div class="ack-heading">${index + 1}. ${escapeHtml(item.heading)}</div>
          <div class="ack-statement">${escapeHtml(item.statement)}</div>
        </li>`).join('');

  // The fingerprints are hashes and stay hashes: printing "recorded" is the
  // honest statement, and the hash itself is of no use to a reader.
  const fingerprints = [
    execution.hasIpFingerprint ? 'source address (hashed)' : null,
    execution.hasUserAgentFingerprint ? 'user agent (hashed)' : null,
  ].filter(Boolean).join(', ');

  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(execution.title)} — executed copy</title>
<style>
  @page {
    size: A4;
    margin: 20mm 18mm 22mm;
    @bottom-center {
      content: "${escapeHtml(brand.companyName)} · ${escapeHtml(execution.portalLabel)} · executed ${escapeHtml(formatExecutionTimestamp(execution.acceptedAt))} · page " counter(page) " of " counter(pages);
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 7.5pt;
      color: #4a4a4a;
    }
  }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 10pt;
    line-height: 1.55;
    color: #14161a;
  }
  h1 { font-size: 17pt; margin: 0 0 2mm; letter-spacing: -0.01em; }
  h2 { font-size: 11pt; margin: 8mm 0 2mm; text-transform: uppercase; letter-spacing: 0.08em; color: #0d264d; }
  h3 { font-size: 10.5pt; margin: 5mm 0 1.5mm; }
  p { margin: 0 0 3mm; }
  ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
  li { margin: 0 0 1.5mm; }
  .masthead { border-bottom: 1.5pt solid #0d264d; padding-bottom: 4mm; margin-bottom: 6mm; }
  .operator { font-size: 8.5pt; letter-spacing: 0.16em; text-transform: uppercase; color: #0d264d; font-weight: bold; }
  .subtitle { font-size: 9.5pt; color: #4a4a4a; margin-top: 1mm; }
  .parties { display: flex; gap: 8mm; margin-bottom: 4mm; }
  .party { flex: 1; border: 0.5pt solid #c9ccd2; padding: 4mm; }
  .party h3 { margin: 0 0 2mm; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.1em; color: #0d264d; }
  .party .name { font-size: 11pt; font-weight: bold; }
  .party div { font-size: 9pt; }
  dl { margin: 0; }
  .row { display: flex; border-bottom: 0.5pt solid #e4e6ea; padding: 1.4mm 0; }
  dt { width: 46mm; flex: none; font-size: 9pt; color: #4a4a4a; }
  dd { margin: 0; font-size: 9pt; }
  .hash { font-family: 'Courier New', monospace; font-size: 8.5pt; word-break: break-all; }
  .acks { list-style: none; padding: 0; margin: 0; }
  .acks li { border-left: 2pt solid #0d264d; padding: 0 0 0 4mm; margin-bottom: 3mm; }
  .ack-heading { font-weight: bold; font-size: 9.5pt; }
  .ack-statement { font-size: 9pt; color: #23262c; }
  .agreement { margin-top: 3mm; }
  .agreement h1, .agreement h2 { font-size: 10.5pt; text-transform: none; letter-spacing: 0; color: #0d264d; margin: 6mm 0 2mm; }
  .agreement h3 { font-size: 10pt; }
  .note { font-size: 8.5pt; color: #4a4a4a; border-top: 0.5pt solid #c9ccd2; margin-top: 6mm; padding-top: 3mm; }
</style>
</head>
<body>
  <header class="masthead">
    <div class="operator">${escapeHtml(brand.companyName)}</div>
    <h1>${escapeHtml(execution.title)}</h1>
    <div class="subtitle">Executed copy · ${escapeHtml(execution.portalLabel)} · version ${escapeHtml(execution.version)}</div>
  </header>

  <h2>The parties</h2>
  <div class="parties">
    <section class="party">
      <h3>Originating Organisation</h3>
      <div class="name">${escapeHtml(brand.companyName)}</div>
      ${operatorContact}
    </section>
    <section class="party">
      <h3>Partner Organisation</h3>
      <div class="name">${escapeHtml(party.organisationName || 'Not recorded')}</div>
      ${party.organisationTradingName && party.organisationTradingName !== party.organisationName
        ? `<div>Trading as ${escapeHtml(party.organisationTradingName)}</div>` : ''}
      ${party.acceptedByName ? `<div>Accepted by ${escapeHtml(party.acceptedByName)}</div>` : ''}
      ${party.acceptedByEmail ? `<div>${escapeHtml(party.acceptedByEmail)}</div>` : ''}
    </section>
  </div>

  <h2>Execution</h2>
  <dl>
    ${definition('Portal', execution.portalLabel)}
    ${definition('Agreement version', execution.version)}
    ${definition('Accepted', formatExecutionTimestamp(execution.acceptedAt))}
    ${execution.documentHash
      ? `<div class="row"><dt>Document hash (SHA-256)</dt><dd class="hash">${escapeHtml(execution.documentHash)}</dd></div>`
      : ''}
    <div class="row"><dt>Acceptance record</dt><dd class="hash">${escapeHtml(execution.acceptanceId)}</dd></div>
    ${definition('Also recorded', fingerprints || 'none')}
  </dl>

  <h2>Mandatory acknowledgments as executed</h2>
  <p>The person accepting this Agreement on behalf of the Partner Organisation asserted each of the following.</p>
  <ol class="acks">${acknowledgements}</ol>

  <h2>The agreement</h2>
  <div class="agreement">${agreementHtml}</div>

  <p class="note">
    This is a copy of the agreement executed electronically on
    ${escapeHtml(formatExecutionTimestamp(execution.acceptedAt))}, produced from the record held by
    ${escapeHtml(brand.companyName)} on ${escapeHtml(formatExecutionTimestamp(execution.generatedAt))}.
    The document hash above identifies the exact text that was displayed and accepted.
  </p>
</body>
</html>`;
}

export const PORTAL_LABELS: Record<string, string> = {
  solicitor: 'Solicitor / Conveyancer Portal',
  builder: 'Builder / Developer Portal',
  finance: 'Finance Partner Portal',
};

/** `builder/2026/<acceptance id>.pdf` — sortable, and one object per acceptance. */
export function agreementStoragePath(portal: string, acceptanceId: string, acceptedAt: string): string {
  const year = Number.isNaN(new Date(acceptedAt).getTime())
    ? 'undated'
    : new Date(acceptedAt).getUTCFullYear().toString();
  return `${portal}/${year}/${acceptanceId}.pdf`;
}

/** `Partner-Agreement-Kopi-Jantan-Builders-2026-08-07.pdf`, or a safe fallback. */
export function agreementFileName(organisationName: string | null, acceptedAt: string): string {
  const slug = (organisationName || 'partner-organisation')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'partner-organisation';
  const date = Number.isNaN(new Date(acceptedAt).getTime())
    ? 'undated'
    : new Date(acceptedAt).toISOString().slice(0, 10);
  return `Partner-Agreement-${slug}-${date}.pdf`;
}
