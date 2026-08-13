/**
 * Project the deployment's `whitelabel_settings` row into the `org` namespace.
 *
 * ## Every generated document had a blank letterhead, on every format
 *
 * `disclaimerPage()` is the last page of all 293 seeded templates, and it binds
 * `{{org.name}}`, `{{org.abn}}`, `{{org.address}}`, `{{org.phone}}`,
 * `{{org.email}}` and `{{org.website}}`. The family covers bind `{{org.name}}`
 * as the wordmark on top of that.
 *
 * **Nothing published `org`.** Not one adapter, not the edge mirror, not the
 * render route — the namespace had no producer anywhere in the codebase. An
 * unresolved binding renders as the empty string rather than as a visible
 * `{{…}}`, so the contact block at the foot of every report printed its labels
 * with nothing beside them, and the cover wordmark was blank. The `disclaimer`
 * block even carries a `?? 'Property Consulting'` default, which never fired:
 * the prop was *present*, it just resolved to nothing.
 *
 * `reportBindingProjection.spec.ts` has listed these six as "organisation,
 * adviser and client identity live outside this row" since it was written —
 * true of the *report* row, and read for four months as though it meant no
 * source existed. One does: `whitelabel_settings`, one row, the same table the
 * Branding page writes.
 *
 * ## Four of the six resolve, and two do not
 *
 * Measured against the live row:
 *
 * | Binding | Column | Present |
 * | --- | --- | --- |
 * | `org.name` | `company_name` | yes |
 * | `org.phone` | `email_signature_phone` | yes — `02 8609 3299` |
 * | `org.email` | `email_signature_email` | yes |
 * | `org.website` | `email_signature_website` | yes |
 * | `org.address` | `email_signature_address` | **empty string** |
 * | `org.abn` | — | **no column** |
 *
 * The two that cannot be filled stay absent rather than being defaulted. An ABN
 * is a legal identifier; a plausible-looking wrong one on a client's financial
 * report is materially worse than a missing line, and the disclaimer block
 * already omits a row whose value is empty.
 *
 * ## Why the email-signature columns, when a report is not an email
 *
 * `REPORT_RULES.md` is blunt that most of this repo's "logo" files are
 * email-signature banners carrying the director's personal mobile number, and
 * that they must not reach a report. That warning is about the **banner image**,
 * and it does not extend to these four fields by default — but it is the reason
 * this module reads them one at a time rather than spreading the object:
 *
 *  - `email_signature_phone` is `02 8609 3299`, a Sydney landline. Checked,
 *    because a mobile here would be the exact defect that rule exists for.
 *  - `email_signature_banner` is **not read**. It is the image the rule names.
 *  - `email_signature_disclaimer` is **not read**. Templates carry
 *    `STANDARD_DISCLAIMER`, which is written for print; the signature's is
 *    written for the foot of an email and is a different document's text.
 *  - `email_signature_name` / `_title` are **not read as an author**. On this
 *    deployment they hold "NPC Services" and "Property Investment Specialist" —
 *    the organisation and a role, not the person who prepared the report. There
 *    is no `profiles` table, so `author.name` has no source and the templates
 *    no longer claim one.
 *
 * If a deployment later grows a real organisation record with an ABN and a
 * postal address, this module is the one place that changes.
 */

export interface OrganisationRowLike {
  company_name?: string | null;
  email_signature_phone?: string | null;
  email_signature_email?: string | null;
  email_signature_website?: string | null;
  email_signature_address?: string | null;
  [k: string]: unknown;
}

/** The columns this projection reads, for a `select()` that pulls nothing else. */
export const ORGANISATION_COLUMNS =
  'company_name, email_signature_phone, email_signature_email, '
  + 'email_signature_website, email_signature_address';

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s || undefined;
}

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

/**
 * The `org` namespace, with absent meaning absent.
 *
 * `company_name` is trimmed because the stored value carries a trailing space,
 * and a wordmark set from it would be typeset with it.
 */
export function projectOrganisation(row: OrganisationRowLike | null | undefined): Record<string, unknown> {
  const org: Record<string, unknown> = {};
  if (!row) return org;
  put(org, 'name', str(row.company_name));
  put(org, 'phone', str(row.email_signature_phone));
  put(org, 'email', str(row.email_signature_email));
  put(org, 'website', str(row.email_signature_website));
  // Empty on the live row; published where a deployment fills it in.
  put(org, 'address', str(row.email_signature_address));
  // No `abn`: there is no column, and inventing one is out of the question.
  return org;
}

/**
 * Merge the organisation into a binding-context `data` object.
 *
 * Additive and non-clobbering: a caller that already set `org` — the converter
 * passes a brand snapshot — keeps what it set, because a **stored** brand is
 * what an issued document was typeset under and the live settings row may have
 * moved since.
 */
export function applyOrganisationProjection(
  data: Record<string, any>,
  row: OrganisationRowLike | null | undefined,
): Record<string, any> {
  const org = projectOrganisation(row);
  if (!Object.keys(org).length) return data;
  const existing = data.org && typeof data.org === 'object' && !Array.isArray(data.org)
    ? data.org as Record<string, unknown>
    : {};
  data.org = { ...org, ...existing };
  return data;
}
