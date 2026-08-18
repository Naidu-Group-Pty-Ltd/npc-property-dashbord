/**
 * Where the staff AML surfaces actually live.
 *
 * ── The 404 this exists to prevent ────────────────────────────────────
 * Stage 5's only offered action for a provider fault navigated to
 * `/aml/configuration`, which is not a route. `/aml` and `/aml/passport` ARE
 * routes — they are the CLIENT-facing surfaces — so the path looked plausible
 * and failed at run time rather than at build time. Every staff AML page is
 * mounted under `/admin/aml/*`, and the sidebar had always linked there; this
 * one navigation did not, so the single step an operator was given for
 * "Screening cannot run yet" led nowhere.
 *
 * A named constant rather than a literal at each call site, so the next
 * surface that needs it cannot spell it differently, and so a test can assert
 * no `/aml/configuration` literal survives anywhere.
 */
export const ADMIN_AML_CONFIGURATION_PATH = "/admin/aml/configuration";
