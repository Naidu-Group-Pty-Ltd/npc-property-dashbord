/**
 * Whether the premium-PDF design controls are offered anywhere in the product.
 *
 * OFF. The design factor is not a feature we are exposing at this point in
 * time: every document renders from `DEFAULT_PDF_DESIGN_OPTIONS`, so the
 * output is the same for every operator, every client and every report, and
 * nobody can hand a client a document tuned into something the brand has not
 * approved.
 *
 * ## This is a hide, not a removal
 *
 * The renderer, the option contract and the whole `reportDesign` system are
 * untouched and still exercised — `PremiumPdfButton` continues to send design
 * options to the Premium PDF renderer, they are simply always the defaults.
 * Turning the controls back on is this one constant, and nothing else.
 *
 * ## Why the switch lives here rather than in the markup
 *
 * Deleting the panel from the one screen that mounts it today would leave the
 * next mount to rediscover the decision — and the panel is a shared component,
 * so "the next mount" is a plausible accident rather than a hypothetical.
 * `PremiumPdfDesignPanel` therefore refuses to render itself while this is
 * false, and the surfaces that frame it (heading, description, Reset) check
 * the same constant so no chrome is drawn around nothing. One switch, and no
 * surface can opt out of it.
 *
 * Typed `boolean` rather than the literal `false` deliberately: a literal would
 * narrow every guard to dead code, which reads as deletion to both the compiler
 * and the next person, and this is a setting rather than a removal.
 *
 * Pinned by `src/lib/reports/__tests__/reportDesignControlsHidden.spec.ts`.
 */
export const PREMIUM_PDF_DESIGN_CONTROLS_VISIBLE: boolean = false;
