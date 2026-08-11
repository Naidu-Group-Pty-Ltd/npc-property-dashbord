/**
 * Which revision of the Agreement Centre document this build renders.
 *
 * Its own module, with **no imports**, because both sides need it: the Edge
 * Functions that render and store the artefacts, and the Command Centre, which
 * has to be able to say whether the service it is talking to is the one it
 * expects. `documentHtml.pure.ts` is deliberately not bridged to the browser —
 * it pulls the whole report stylesheet into the bundle — so the number cannot
 * live there.
 *
 * ## Why an artefact carries a revision at all
 *
 * An issued version freezes two different things, and until this module existed
 * the code froze them together:
 *
 *  1. **What the agreement says** — the field values, the parties, the
 *     commercial schedule, the brand it was issued under. That is the bargain,
 *     and it must never move. It is frozen properly, on the version row, in
 *     `field_values` and `brand_snapshot`.
 *  2. **How that content is typeset** — margins, bands, type scale, where the
 *     cover breaks. That is not part of the bargain. Two partners holding the
 *     same version should hold the same document, and improving the layout does
 *     not change a word of what was agreed.
 *
 * Caching the rendered bytes froze (2) along with (1). So on 2026-08-09 an
 * agreement was issued whose cover ran off the page: the title clipped at the
 * trim, every line hard against the paper's left edge, the particulars crushed
 * into the foot and the last band spilling onto a second sheet. The generator
 * was fixed and deployed on 2026-08-11 — the draft export came out right
 * immediately, and **the issued PDF kept coming out wrong for ever**, because
 * `pdf_storage_path` still named the bytes written on the 9th and nothing ever
 * looked at them again.
 *
 * That is the identical failure `partnerAgreementRevision.pure.ts` was written
 * for one subsystem over, and this is the identical remedy: the revision is
 * part of the object's path (`…/issued-r2.pdf`; revision 1 has **no** suffix, so
 * artefacts stored before revisions existed still resolve). A refresh writes a
 * **new** object and repoints the row. No stored object is ever replaced.
 *
 * ## What must never be refreshed
 *
 * A signature is a person committing to a document they read. Re-typesetting
 * under them would leave the thing they signed and the thing on file different
 * documents, which is exactly the property a signed instrument exists to deny.
 * So **any signature on the version freezes both its artefacts**, as does an
 * executed version, and the freeze is reported rather than silently applied.
 *
 * ## Why the number is also on the wire
 *
 * Merging is not deploying, and in this repo that gap is not hypothetical — it
 * is the whole reason the sibling module exists. The frontend ships on the site
 * build, which does deploy; the render functions ship separately. So the app
 * carries the revision it expects, the download routes report the revision they
 * are actually running, and a mismatch is stated on screen instead of being
 * discovered in a partner's inbox.
 *
 * ## Changing it
 *
 * Bump when the document's visual composition changes materially. Every stored
 * artefact below the new number then reports as `stale`, and the next download
 * of an unsigned one re-renders it from its own frozen inputs — same words,
 * current typesetting.
 *
 *  - **1** — the original Agreement Centre document.
 *  - **2** — the cover rebuilt as three bands that own their geometry, and the
 *    organisation eyebrow moved off `accentOnField` (floor `display`, ~1.2:1 at
 *    7.5pt against a bronze brand) onto `onFieldInk`.
 */

export const AGREEMENT_CENTRE_DOCUMENT_REVISION = 2;

/** Which revision produced the artefact at this path. `0` when there is none. */
export function agreementCentreRevisionForPath(path: string | null | undefined): number {
  if (!path) return 0;
  const match = /-r(\d+)\.pdf$/.exec(path);
  return match ? Number(match[1]) : 1;
}

/**
 * What the download route should do with the artefact it found.
 *
 *  - `absent`  — nothing stored; render it now (the long-standing deferred path).
 *  - `current` — stored by this revision; serve it.
 *  - `stale`   — stored by an older revision and nothing has been signed;
 *                re-render from the version row's frozen inputs and repoint.
 *  - `frozen`  — older, but signed or executed. Serve the stored bytes and say
 *                why they are not being refreshed.
 */
export type AgreementArtefactState = 'absent' | 'current' | 'stale' | 'frozen';

export interface AgreementArtefactInput {
  /** `pdf_storage_path` or `executed_pdf_storage_path` from the version row. */
  path: string | null | undefined;
  /** Which artefact is being asked for. */
  kind: 'issued' | 'executed';
  /** How many signature rows exist against this version. */
  signatureCount: number;
  /** `status` from the version row. */
  versionStatus?: string | null;
  expected?: number;
}

export function agreementArtefactState(input: AgreementArtefactInput): AgreementArtefactState {
  const expected = input.expected ?? AGREEMENT_CENTRE_DOCUMENT_REVISION;
  const stored = agreementCentreRevisionForPath(input.path);
  if (stored === 0) return 'absent';
  if (stored >= expected) return 'current';
  // An executed artefact is the instrument itself; an issued one becomes the
  // instrument the moment anybody signs against that version. Neither is ours
  // to re-typeset afterwards — see the header.
  if (input.kind === 'executed') return 'frozen';
  if (input.signatureCount > 0) return 'frozen';
  if (input.versionStatus === 'executed') return 'frozen';
  return 'stale';
}

/** Whether this state means the route has to render before it can serve. */
export function agreementArtefactNeedsRender(state: AgreementArtefactState): boolean {
  return state === 'absent' || state === 'stale';
}

/**
 * What the Command Centre should say about the render service it just called.
 *
 * `reported` is the revision the function sent back. **`null` means it sent
 * none at all**, which is not a missing field to shrug at — it is a function
 * deployed before revisions existed, and therefore one still writing the
 * previous document. That is the exact state this mechanism exists to make
 * visible, so it folds into `behind` rather than into an "unknown".
 */
export type AgreementRenderServiceState = 'current' | 'behind' | 'ahead';

export function agreementRenderServiceState(
  reported: number | null | undefined,
  expected: number = AGREEMENT_CENTRE_DOCUMENT_REVISION,
): AgreementRenderServiceState {
  const running = typeof reported === 'number' && Number.isFinite(reported) ? reported : 1;
  if (running < expected) return 'behind';
  // A function ahead of the app is the ordinary order of a staged deploy and is
  // harmless: the artefacts it writes are newer than the app knows how to
  // describe, not older than the ones it promises.
  if (running > expected) return 'ahead';
  return 'current';
}
