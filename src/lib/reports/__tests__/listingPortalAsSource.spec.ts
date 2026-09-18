/**
 * A listing portal is not a source.
 *
 * S5/S6 §4. Found by reading the rendered PDFs of the 48 Redfern Street
 * lineage on 18 September 2026, not by reading code: **four bracketed inline
 * citations per document, three of them naming `Property.com.au`** — and one
 * of those three carries the sentence
 *
 * > …multiple nearby addresses on the street recording **no bushfire, flood or
 * > heritage overlays** on public mapping at the time they were last
 * > updated.[Property.com.au, 119, 120, 137 and 139 Redfern Street profiles,
 * > 2024–2026]
 *
 * which is the exact sentence `planningFacts.pure.ts` forbids by name:
 * *"never write … that it is not flood or bushfire affected on the authority
 * of a listing portal"*.
 *
 * ## Why a validator rule and not a prompt change
 *
 * The prohibition already reaches the model. What was missing is the thing
 * §10.3 of `PLANNING_CONTROLS_IN_THE_REPORT.md` established for a different
 * rule and closed with rule 12: **a prompt rule cannot be proven without a
 * model run**, so the finished markdown has to be read. Rule 13 reads it.
 *
 * It REPORTS and never scrubs — prose is never regex-scrubbed, on read or on
 * write — and it is deliberately narrow, because a false caveat teaches people
 * to dismiss the warning.
 *
 * ## Why it matters more than one sentence
 *
 * `fork-investment-report` routes the parent's prose, so the measured defect
 * appears identically in the Compass, the Financial Analysis and the Due
 * Diligence. One bad sentence becomes three documents.
 */
import { describe, expect, it } from 'vitest';
import { runQAValidation } from '../compassQAValidator';

/** The sentence as it printed, verbatim from the rendered PDF's text layer. */
const MEASURED = 'Properties on Redfern Street repeatedly show established detached dwellings, '
  + 'off-street parking and standard residential zoning within Cowra Shire Council, with multiple '
  + 'nearby addresses on the street recording no bushfire, flood or heritage overlays on public '
  + 'mapping at the time they were last updated.[Property.com.au, 119, 120, 137 and 139 Redfern '
  + 'Street profiles, 2024–2026]';

const doc = (body: string) => `# Report\n\n## Executive Verdict\n\n${body}\n`;
const rules = (md: string) => runQAValidation(md, 'compass').findings.map((f) => f.rule);

describe('a listing portal cited as a source is an error', () => {
  it('catches the sentence that shipped', () => {
    const found = rules(doc(MEASURED));
    expect(found).toContain('listing-portal-as-source');
    // And the severe half separately: the portal is carrying an ABSENCE.
    expect(found).toContain('portal-sourced-hazard-absence');
  });

  it('names the portal and the count so the finding can be acted on', () => {
    const f = runQAValidation(doc(MEASURED), 'compass').findings
      .find((x) => x.rule === 'listing-portal-as-source');
    expect(f?.severity).toBe('error');
    expect(f?.message).toContain('property.com.au');
    expect(f?.message).toMatch(/1 inline citation/);
  });

  it('catches the other portals by name', () => {
    for (const portal of ['realestate.com.au', 'domain.com.au', 'allhomes.com.au', 'onthehouse.com.au']) {
      expect(rules(doc(`The street is quiet.[${portal} listings, 2026]`)), portal)
        .toContain('listing-portal-as-source');
    }
  });

  it('a portal citation WITHOUT an absence claim raises only the first rule', () => {
    // Still wrong — a client cannot look a claim up in a listing site — but it
    // is not the planning sentence, and conflating the two loses the severity.
    const found = rules(doc('Land sizes on the street run 900-2,200 m².[Property.com.au listings, 2026]'));
    expect(found).toContain('listing-portal-as-source');
    expect(found).not.toContain('portal-sourced-hazard-absence');
  });
});

describe('what it must NOT flag', () => {
  it('the permitted absence — a register that was asked and matched nothing', () => {
    // `checkedAndNotMapped`'s own wording, which names the register and carries
    // no citation bracket. This is the ONE absence the prose may repeat.
    const found = rules(doc(
      '**Checked and not mapped at this coordinate:** bushfire, flood, heritage. '
      + 'Each of these was asked of a register that answered, and no feature covers this point.',
    ));
    expect(found).not.toContain('listing-portal-as-source');
    expect(found).not.toContain('portal-sourced-hazard-absence');
  });

  it('a register named as the source, in brackets', () => {
    const found = rules(doc(
      'The lot is within a bushfire-prone area.[NSW Rural Fire Service bushfire prone land map, 2026]',
    ));
    expect(found).not.toContain('listing-portal-as-source');
  });

  it('ordinary prose that merely mentions a hazard', () => {
    const found = rules(doc(
      'Bushfire and flood exposure are assessed in the planning section against the state registers.',
    ));
    expect(found).not.toContain('listing-portal-as-source');
    expect(found).not.toContain('portal-sourced-hazard-absence');
  });

  it('a markdown link or a table cell is not a portal citation', () => {
    const found = rules(doc('| Source | Value |\n| --- | --- |\n| Council register | Residential |'));
    expect(found).not.toContain('listing-portal-as-source');
  });

  it('a clean document raises neither rule', () => {
    expect(rules(doc('The property is a detached house on a level lot.'))).toEqual(
      expect.not.arrayContaining(['listing-portal-as-source', 'portal-sourced-hazard-absence']),
    );
  });
});

describe('both copies of the validator carry it', () => {
  it('the edge copy and the browser copy agree but for their imports', async () => {
    const { readFileSync } = await import('node:fs');
    const strip = (s: string) => s.replace(/from '(\.[^']*?)(\.ts)?';/g, "from '$1';")
      .replace(/reports\/investment\//g, 'investment/');
    const edge = strip(readFileSync('supabase/functions/_shared/compassQAValidator.ts', 'utf8'));
    const browser = strip(readFileSync('src/lib/reports/compassQAValidator.ts', 'utf8'));
    for (const marker of ['listing-portal-as-source', 'portal-sourced-hazard-absence', 'PORTALS']) {
      expect(edge, `edge: ${marker}`).toContain(marker);
      expect(browser, `browser: ${marker}`).toContain(marker);
    }
  });
});
