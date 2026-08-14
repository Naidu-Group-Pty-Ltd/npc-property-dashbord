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

export interface TemplateDocument {
  blob: Blob;
  fileName: string;
  /** Which template rendered it, for the caller that wants to say. */
  templateId: string;
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
