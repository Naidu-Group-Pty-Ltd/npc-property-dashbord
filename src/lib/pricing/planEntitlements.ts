// What each plan tier entitles a workspace to.
//
// Generated from the signed-off pricing sheet's own tier matrices, and kept in
// step with Mission Control's `plan_module_entitlements`. Embedded rather than
// fetched on purpose: gating that depends on a network call has to decide what
// to do when the call fails, and both answers are bad — fail closed and an
// outage locks people out of features they pay for, fail open and the gate is
// decorative. Product data that changes at the pace of a price list belongs in
// the bundle.
//
// PLAN entitlement is a separate question from USER permission. This module
// answers "does this workspace's plan include the feature"; `usePermissions`
// answers "is this user allowed to use it". Both must pass.

export type PlanSlug = "launch" | "growth" | "scale";

export type SubModuleEntitlement = {
  key: string;
  module: string;
  subModule: string;
  launch: boolean;
  growth: boolean;
  scale: boolean;
};

/** Per-tier sub-module availability, one row per sub-module. */
export const SUB_MODULE_ENTITLEMENTS: readonly SubModuleEntitlement[] = [
  { key: "generated-reports.investment", module: "Generated Reports", subModule: "Investment", launch: true, growth: true, scale: true },
  { key: "generated-reports.comparisons", module: "Generated Reports", subModule: "Comparisons", launch: false, growth: true, scale: true },
  { key: "cash-flow-analysis.10-year-cash-flow", module: "Cash Flow Analysis", subModule: "10 Year Cash Flow", launch: true, growth: true, scale: true },
  { key: "cash-flow-analysis.comparisons", module: "Cash Flow Analysis", subModule: "Comparisons", launch: false, growth: true, scale: true },
  { key: "clients.send-to-finance", module: "Clients", subModule: "Send To Finance", launch: false, growth: false, scale: true },
  { key: "clients.review", module: "Clients", subModule: "Review", launch: true, growth: true, scale: true },
  { key: "clients.portfolio-analysis", module: "Clients", subModule: "Portfolio Analysis", launch: false, growth: false, scale: true },
  { key: "clients.download-client-details-pdf", module: "Clients", subModule: "Download Client Details PDF", launch: true, growth: true, scale: true },
  { key: "clients.send-portfolio-to-client", module: "Clients", subModule: "Send Portfolio To Client", launch: false, growth: false, scale: true },
  { key: "clients.send-agreement", module: "Clients", subModule: "Send Agreement", launch: false, growth: false, scale: true },
  { key: "clients.portal-access", module: "Clients", subModule: "Portal Access", launch: true, growth: true, scale: true },
  { key: "clients.view-as-client", module: "Clients", subModule: "View As Client", launch: true, growth: true, scale: true },
  { key: "clients.overview", module: "Clients", subModule: "Overview", launch: true, growth: true, scale: true },
  { key: "clients.personal", module: "Clients", subModule: "Personal", launch: true, growth: true, scale: true },
  { key: "clients.properties", module: "Clients", subModule: "Properties", launch: true, growth: true, scale: true },
  { key: "clients.deals", module: "Clients", subModule: "Deals", launch: false, growth: true, scale: true },
  { key: "clients.employment", module: "Clients", subModule: "Employment", launch: true, growth: true, scale: true },
  { key: "clients.financials", module: "Clients", subModule: "Financials", launch: true, growth: true, scale: true },
  { key: "clients.reports", module: "Clients", subModule: "Reports", launch: true, growth: true, scale: true },
  { key: "clients.sent-reports", module: "Clients", subModule: "Sent Reports", launch: true, growth: true, scale: true },
  { key: "clients.requests", module: "Clients", subModule: "Requests", launch: true, growth: true, scale: true },
  { key: "clients.emails", module: "Clients", subModule: "Emails", launch: false, growth: false, scale: false },
  { key: "clients.conversations", module: "Clients", subModule: "Conversations", launch: false, growth: false, scale: true },
  { key: "clients.appointments", module: "Clients", subModule: "Appointments", launch: false, growth: false, scale: true },
  { key: "clients.portal-messages", module: "Clients", subModule: "Portal Messages", launch: true, growth: true, scale: true },
  { key: "clients.finance-messages", module: "Clients", subModule: "Finance Messages", launch: false, growth: false, scale: true },
  { key: "clients.notes", module: "Clients", subModule: "Notes", launch: true, growth: true, scale: true },
  { key: "clients.reminders", module: "Clients", subModule: "Reminders", launch: true, growth: true, scale: true },
  { key: "clients.client-forms", module: "Clients", subModule: "Client Forms", launch: true, growth: true, scale: true },
  { key: "clients.files", module: "Clients", subModule: "Files", launch: true, growth: true, scale: true },
  { key: "clients.activity-documents", module: "Clients", subModule: "Activity/Documents", launch: true, growth: true, scale: true },
  { key: "clients.borrowing-capacity", module: "Clients", subModule: "Borrowing Capacity", launch: false, growth: false, scale: true },
  { key: "clients.lenders", module: "Clients", subModule: "Lenders", launch: false, growth: false, scale: false },
  { key: "clients.ai", module: "Clients", subModule: "AI", launch: false, growth: false, scale: true },
];

/** Tiers that include each priced add-on module at no extra cost. */
export const MODULE_TIERS: Record<string, readonly string[]> = {
  "market-updates": ["growth", "scale"],
  "commercial-industrial": ["scale"],
  "opportunity-marketplace": ["scale"],
  "intelligence-hub": [],
  "report-comparisons": ["growth", "scale"],
  "cashflow-comparisons": ["growth", "scale"],
  "email-copilot": [],
  "call-logs": [],
  "portfolio-analysis": ["scale"],
  "send-portfolio": ["scale"],
  "client-forms": ["launch", "growth", "scale"],
  "borrowing-capacity": ["scale"],
  "lenders": [],
  "client-ai": ["scale"],
  "agreements": ["scale"],
  "marketing": ["scale"],
  "deal-pipeline": ["growth", "scale"],
  "aml-ctf": [],
  "model-hub": ["scale"],
  "finance-portal": ["scale"],
  "integrations": [],
  "api-usage": ["scale"],
  "aurixa-agent": [],
};

/** App permission keys whose pricing-catalogue slug is different. */
export const MODULE_KEY_TO_PRICING_SLUG: Readonly<Record<string, string>> = {
  api_usage: "api-usage",
  call_logs: "call-logs",
  deal_pipeline: "deal-pipeline",
  email_copilot: "email-copilot",
  finance_portal_admin: "finance-portal",
  marketing_analytics: "marketing",
  portfolio_reports: "portfolio-analysis",
  agent: "aurixa-agent",
};

const BY_KEY = new Map(SUB_MODULE_ENTITLEMENTS.map((r) => [r.key, r]));

const KNOWN_PLANS: readonly string[] = ["launch", "growth", "scale"];

/** Whether a plan slug is one this matrix actually describes. */
export function isKnownPlan(planSlug: string | null | undefined): planSlug is PlanSlug {
  return !!planSlug && KNOWN_PLANS.includes(planSlug);
}

/**
 * Whether a plan enables a sub-module.
 *
 * An UNKNOWN plan returns true, and that is deliberate. Enterprise, a
 * billing-exempt tenant, a plan lookup that failed, an older Mission Control
 * that does not send a slug — none of those mean "this workspace has bought
 * nothing". Denying on unknown would lock paying customers out of features
 * over a lookup failure, which is a far worse outcome than showing a feature
 * to someone whose plan we could not read.
 */
export function planEnablesSubModule(planSlug: string | null | undefined, key: string): boolean {
  if (!isKnownPlan(planSlug)) return true;
  const row = BY_KEY.get(key);
  if (!row) return true; // not a gated sub-module
  return row[planSlug];
}

/**
 * Whether a plan includes an add-on module without buying it separately.
 *
 * Note what an EMPTY tier list means. `intelligence-hub`, `email-copilot`,
 * `call-logs`, `lenders`, `integrations` and `aurixa-agent` are included in no
 * tier — they are add-ons, bought on top of whatever plan a workspace is on.
 * That is the opposite of "no plan may have this", and reading it the second
 * way denies the module to everybody.
 *
 * It mattered the moment tier allowances shipped. Until then no tenant carried
 * a `plan_id`, so `planSlug` was always null and this function always returned
 * true; the first workspace to be put on Launch would have lost Integrations —
 * and with it Report QA's agent-model management — with nothing to explain it.
 *
 * Plan is the wrong question for an add-on. Whether one has been PURCHASED is
 * a separate fact this matrix does not carry, so it is not answered here.
 */
export function planIncludesModule(planSlug: string | null | undefined, moduleSlug: string): boolean {
  if (!isKnownPlan(planSlug)) return true;
  const pricingSlug = MODULE_KEY_TO_PRICING_SLUG[moduleSlug] ?? moduleSlug;
  const tiers = MODULE_TIERS[pricingSlug];
  if (!tiers) return true; // not a priced module
  if (tiers.length === 0) return true; // an add-on, not a denial
  return tiers.includes(planSlug);
}

/** Every sub-module key a plan enables — useful for debugging and tests. */
export function enabledSubModules(planSlug: PlanSlug): string[] {
  return SUB_MODULE_ENTITLEMENTS.filter((r) => r[planSlug]).map((r) => r.key);
}
