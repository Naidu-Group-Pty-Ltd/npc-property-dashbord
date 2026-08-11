/**
 * The issued PDF must not be a fossil.
 *
 * On 2026-08-09 an agreement was issued whose cover ran off the page. The
 * generator was fixed and deployed on 2026-08-11; the draft export came out
 * right the same minute, and the **issued** PDF kept coming out wrong, because
 * `pdf_storage_path` still named the bytes written on the 9th and nothing ever
 * compared them against anything. The stored artefact was being treated as the
 * record when the record is the version row it was rendered from.
 *
 * These tests hold the two halves of the remedy apart, because they pull in
 * opposite directions and the whole difficulty is honouring both:
 *
 *  - **the wording freezes** — an issued document is rendered from the version
 *    row's own `field_values` and `brand_snapshot`, never from the live row;
 *  - **the typesetting does not** — the bytes are a cache of those frozen
 *    inputs, so a build whose layout has moved on re-renders them.
 *
 * And the line where the second stops: **a signature ends it.** A person
 * committed to a document they read, and re-typesetting under them would leave
 * the thing signed and the thing on file two different documents.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_CENTRE_DOCUMENT_REVISION,
  agreementArtefactNeedsRender,
  agreementArtefactState,
  agreementCentreRevisionForPath,
  agreementRenderServiceState,
} from '@/lib/agreements';

const CURRENT = AGREEMENT_CENTRE_DOCUMENT_REVISION;
const OLD = 'agreement-centre/abc/v1-0/issued.pdf';
const CURRENT_PATH = `agreement-centre/abc/v1-0/issued-r${CURRENT}.pdf`;

describe('the revision recorded in an artefact path', () => {
  it('reads an explicit suffix', () => {
    expect(agreementCentreRevisionForPath('agreement-centre/a/v1-0/issued-r2.pdf')).toBe(2);
    expect(agreementCentreRevisionForPath('agreement-centre/a/v1-0/executed-r11.pdf')).toBe(11);
  });

  it('treats an unsuffixed path as revision 1 rather than as unknown', () => {
    // Every artefact stored before revisions existed is at an unsuffixed path.
    // Reading those as 0 would make them indistinguishable from "no artefact"
    // and re-render even the signed ones.
    expect(agreementCentreRevisionForPath(OLD)).toBe(1);
  });

  it('reports 0 only when there is genuinely nothing stored', () => {
    expect(agreementCentreRevisionForPath(null)).toBe(0);
    expect(agreementCentreRevisionForPath(undefined)).toBe(0);
    expect(agreementCentreRevisionForPath('')).toBe(0);
  });
});

describe('what a download route should do with the artefact it found', () => {
  const unsigned = { signatureCount: 0, versionStatus: 'issued' as const };

  it('renders when nothing is stored', () => {
    const state = agreementArtefactState({ path: null, kind: 'issued', ...unsigned });
    expect(state).toBe('absent');
    expect(agreementArtefactNeedsRender(state)).toBe(true);
  });

  it('serves an artefact this build wrote', () => {
    const state = agreementArtefactState({ path: CURRENT_PATH, kind: 'issued', ...unsigned });
    expect(state).toBe('current');
    expect(agreementArtefactNeedsRender(state)).toBe(false);
  });

  it('re-renders an unsigned artefact a newer build has moved past', () => {
    // The reported bug, in one assertion.
    const state = agreementArtefactState({
      path: OLD, kind: 'issued', signatureCount: 0, versionStatus: 'issued', expected: 2,
    });
    expect(state).toBe('stale');
    expect(agreementArtefactNeedsRender(state)).toBe(true);
  });

  it('never re-renders once the version carries a signature', () => {
    const state = agreementArtefactState({
      path: OLD, kind: 'issued', signatureCount: 1, versionStatus: 'partially_signed', expected: 2,
    });
    expect(state).toBe('frozen');
    expect(agreementArtefactNeedsRender(state)).toBe(false);
  });

  it('never re-renders an executed artefact, signatures counted or not', () => {
    for (const signatureCount of [0, 2]) {
      const state = agreementArtefactState({
        path: 'agreement-centre/abc/v1-0/executed.pdf',
        kind: 'executed', signatureCount, versionStatus: 'executed', expected: 2,
      });
      expect(state).toBe('frozen');
    }
  });

  it('never re-renders the issued copy of an executed version', () => {
    // Belt and braces against a signature row that failed to read: the version
    // status says the instrument exists even when the count says nothing does.
    const state = agreementArtefactState({
      path: OLD, kind: 'issued', signatureCount: 0, versionStatus: 'executed', expected: 2,
    });
    expect(state).toBe('frozen');
  });

  it('still generates a missing executed artefact — freezing is not refusing', () => {
    const state = agreementArtefactState({
      path: null, kind: 'executed', signatureCount: 2, versionStatus: 'executed', expected: 2,
    });
    expect(state).toBe('absent');
    expect(agreementArtefactNeedsRender(state)).toBe(true);
  });
});

describe('what the app says about the render service it just called', () => {
  it('calls a route that reports nothing behind, not unknown', () => {
    // A route that sends no revision is one deployed before revisions existed,
    // and therefore one still writing the previous document. That is the exact
    // state this mechanism exists to make visible.
    expect(agreementRenderServiceState(null, 2)).toBe('behind');
    expect(agreementRenderServiceState(undefined, 2)).toBe('behind');
  });

  it('reads an older running revision as behind', () => {
    expect(agreementRenderServiceState(1, 2)).toBe('behind');
  });

  it('tolerates a route ahead of the app — that is the order of a staged deploy', () => {
    expect(agreementRenderServiceState(3, 2)).toBe('ahead');
  });

  it('is quiet when they agree', () => {
    expect(agreementRenderServiceState(CURRENT)).toBe('current');
  });
});

describe('the revision is bumped with the document', () => {
  const html = readFileSync(
    join(process.cwd(), 'supabase/functions/_shared/agreements/documentHtml.pure.ts'), 'utf8',
  );

  it('is past 1, because the cover has been rebuilt since', () => {
    expect(AGREEMENT_CENTRE_DOCUMENT_REVISION).toBeGreaterThan(1);
  });

  it('records every revision in the module that defines it', () => {
    const doc = readFileSync(
      join(process.cwd(), 'supabase/functions/_shared/agreements/documentRevision.pure.ts'), 'utf8',
    );
    for (let revision = 1; revision <= AGREEMENT_CENTRE_DOCUMENT_REVISION; revision += 1) {
      expect(doc).toContain(`**${revision}** —`);
    }
  });

  it('sets the cover eyebrow in an ink the dark band allows', () => {
    // accentOnField's contrast floor is the display floor; the eyebrow is
    // 7.5pt. Up to the rule's own closing brace, not the first `}` in the
    // block — every other line of it closes a `${...}` interpolation.
    const eyebrow = /\.agc-cover-company\s*\{[\s\S]*?\n {2}\}/.exec(html)?.[0] ?? '';
    expect(eyebrow).not.toBe('');
    expect(eyebrow).toContain('palette.onFieldInk');
    expect(eyebrow).not.toContain('palette.accentOnField');
  });

  it('lets the dark band beat the paper ink a substituted token carries', () => {
    // The eyebrow is a token, so `.agc-bound` painted it bodyInk — a PAPER
    // role — over whatever the band had set: graphite on near-black, about
    // 1.2:1, and it was the tenant's own name. Setting the container's colour
    // alone does not fix that; the span has to yield. Measured after this
    // override: 15.2:1.
    expect(html).toMatch(/\.agc-cover-canvas \.agc-bound,\s*\n\s*\.agc-cover-canvas \.agc-unfilled \{ color: inherit; \}/);
  });
});
