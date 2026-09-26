/**
 * Which report types may be drawn through a design-system template today.
 *
 * ## The owner's rule
 *
 * A template changes the LAYOUT of a document and nothing else. For every
 * report type other than the five Investment tiers, the information a
 * template carries must be exactly the information the report's standard
 * document carries (owner, 26 Sep 2026).
 *
 * ## Why nine of the ten are held
 *
 * On 26 Sep 2026 each non-Investment report type's standard document and its
 * template document were rendered from the same real record, on all 50
 * masters, and what each printed was compared. None of the nine carried the
 * same information. Three examples, each verified in code:
 *
 *   - Report Q&A printed the conversation's FIRST answer whichever answer was
 *     chosen, and its transcript carried the first answer alone.
 *   - The 10 Year Cash Flow printed after-tax figures beneath a master that
 *     says "No tax position is modelled".
 *   - Client Details never printed the primary contact's email or mobile.
 *
 * `docs/reports/TEMPLATE_PARITY.md` lists every difference found. The tests
 * that should have caught them checked wiring (projections restate the
 * normaliser, masters bind only published paths), and no test ever rendered
 * one record through both paths and compared what was printed.
 *
 * A template that drops a figure is not a layout. So a held report type is
 * produced as its standard document for every person, whatever template they
 * chose, until its parity check passes, and the person is told why.
 *
 * ## Released means proven
 *
 * A report type joins `TEMPLATE_RELEASED_REPORT_TYPES` only once its parity
 * check passes in CI: the standard document's content, found in the template
 * document's, for the same record, on every master. Investment is released
 * because the owner's rule sets its tiers apart. Their template path is the
 * one the report was built for, and its content is governed by
 * `tierContent.pure.ts` and `audienceContent.pure.ts`.
 *
 * One register, read by the one function every delivery path calls
 * (`tryTemplateDocument`), so no surface can release a report type by
 * itself.
 */
import { normaliseReportType } from './reportTemplateSelection.pure.ts';

/**
 * Report types whose template path is released. Canonical keys only — every
 * spelling is normalised before it is looked up.
 */
export const TEMPLATE_RELEASED_REPORT_TYPES: readonly string[] = Object.freeze(['investment']);

/**
 * Whether a report type is held on its standard document.
 *
 * Anything not released is held, an empty or unrecognised type included: a
 * register that answers "not held" for a spelling it does not know is one
 * that a new alias releases by accident. Only a released report type ever
 * reaches a template.
 */
export function isTemplateDeliveryHeld(reportType?: string | null): boolean {
  return !TEMPLATE_RELEASED_REPORT_TYPES.includes(normaliseReportType(reportType));
}

/** What a person who chose a template for a held report type is told. */
export const TEMPLATE_HOLD_NOTICE = Object.freeze({
  title: 'This report uses its standard layout for now',
  description:
    'Templates for this report are on hold until they carry everything the standard document '
    + 'prints. Your choice is kept, and it applies as soon as this report is released.',
});

/** The same, for the chooser, where the report type is named. */
export function templateHoldExplanation(formatLabel: string): string {
  return `${formatLabel} reports use the standard layout until their templates carry everything `
    + 'the standard document prints. Report types are released one at a time, as each passes '
    + 'that check. You can still look through the designs and save a choice; it applies as soon '
    + 'as this report type is released.';
}
