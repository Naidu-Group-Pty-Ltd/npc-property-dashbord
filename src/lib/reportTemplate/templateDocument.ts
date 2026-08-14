/**
 * "Is there an activated template for this document?" — asked once, the same
 * way, by every format's delivery path.
 *
 * ## What this is for
 *
 * Nine adapters can turn a stored record into a templated PDF, and for a year
 * exactly one surface could ask for one: `PremiumPdfButton`, for Compass
 * investment reports. Every other format's fifty masters could be designed,
 * previewed, seeded and activated, and no button in the product would ever
 * render one. This is the call that closes that gap, and it belongs in the
 * `deliver*` modules rather than in the buttons because that is where every
 * surface for a format already meets — the download, the email attachment, the
 * blob a broker portal uploads.
 *
 * ## It is inert until somebody activates a template
 *
 * `resolveReportTemplate` matches only *active* `report_templates` rows, so on
 * a deployment with nothing activated this costs one lookup and answers null,
 * and the format's existing route runs exactly as it does today. That is the
 * designed switch, and it is what every adapter's `legacyFallback` text
 * promises: "the legacy generator remains the default until a template is
 * activated for this report type".
 *
 * ## Every failure is a fallback, never an error
 *
 * A refused adapter, no active template, a render that failed, a signed URL
 * that would not fetch: all of them answer `null`, because the caller's next
 * line is the route that has produced this document for the life of the
 * product. A templated document is an improvement on a working path, so it may
 * never be the reason somebody cannot get their file.
 */
import { tryRouteThroughTemplateBuilderFor } from './compassRoute';
import {
  fetchTemplateSelections,
  normaliseReportType,
  selectionsByFormat,
} from './templateSelection';

export interface TemplateDocument {
  blob: Blob;
  fileName: string;
  /** Which template rendered it, for the caller that wants to say. */
  templateId: string;
}

/**
 * The template this person chose for this format, if they chose one.
 *
 * ## Why this is looked up here rather than passed in
 *
 * The picker lists **every** format the adapter registry knows, and its own
 * words are "a choice is kept for every report of that format until it is
 * changed here". Only `PremiumPdfButton` ever passed the chosen id, so on the
 * other eight formats a selection was stored, displayed as selected, and then
 * ignored by the thing it was a choice about — the UI promising something the
 * generator did not do, which is worse than not offering the choice.
 *
 * Threading the id through eight `deliver*` signatures would have fixed the
 * surfaces that remembered to pass it and left the same hole open for the
 * email, attachment and portal paths that do not use the picker's hook. Asking
 * here means the choice is honoured wherever a document is produced, which is
 * what the picker says happens.
 *
 * Not cached: a person who changes their template and generates again expects
 * the new one, and one edge call against a download that already takes seconds
 * is the cheaper side of that trade. A failed read answers null and the format
 * resolves by ranking, exactly as it did before selections existed.
 */
async function selectedTemplateFor(reportType: string): Promise<string | null> {
  try {
    const rows = await fetchTemplateSelections();
    const key = normaliseReportType(reportType);
    return selectionsByFormat(rows).get(key)?.template_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Save it the way a browser saves files, for a caller that has no `deliver*`
 * module of its own to do it.
 *
 * The revoke is on a delay rather than in a `finally`, because Safari cancels
 * an in-flight download when the URL disappears underneath it — the same
 * reason every `deliver*` module in the programme delays its own.
 */
export function saveTemplateDocument(doc: TemplateDocument): void {
  const url = URL.createObjectURL(doc.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * The templated document for this record, or null to carry on as before.
 *
 * `reportId` is nullable for the callers that may not have one — a Borrowing
 * Capacity Snapshot can be asked for without naming an assessment, and there is
 * no stored record for an adapter to read in that case.
 */
export async function tryTemplateDocument(
  reportType: string,
  reportId: string | null | undefined,
  opts?: { variant?: string | null },
): Promise<TemplateDocument | null> {
  if (!reportId) return null;

  try {
    const routed = await tryRouteThroughTemplateBuilderFor(reportType, reportId, {
      variant: opts?.variant ?? null,
      // The person's own answer to "which template does this format come out
      // in", honoured here so that every surface gets it rather than only the
      // ones that remembered to ask. See `selectedTemplateFor`.
      templateId: await selectedTemplateFor(reportType),
    });
    if (!routed?.fileUrl) return null;

    // Fetched rather than followed, for the reason every `deliver*` module
    // gives: a PDF that opens in a tab is a PDF someone has to find again.
    const response = await fetch(routed.fileUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    // A zero-byte body is not a document. It would save as a file that opens
    // to an error, which is worse than the legacy layout.
    if (!blob.size) return null;

    return { blob, fileName: routed.fileName, templateId: routed.templateId };
  } catch {
    return null;
  }
}
