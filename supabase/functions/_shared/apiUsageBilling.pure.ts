/**
 * Which secret backs which service, and what one unit of it is.
 *
 * Mission Control forwards *our* vendor keys into every clone project it
 * provisions. It recharges a clone for calls made on a forwarded key, and
 * charges nothing for calls made on a key the clone supplied itself. The only
 * identifier that connects the three sides of that arrangement is the **secret
 * name** — the string this repo passes to `Deno.env.get`, that Mission Control's
 * `prime_secret_forwards` whitelists, and that `clone_backend_secrets` records
 * the ownership of.
 *
 * `api_usage_log.service_name` is not that string. It grew organically ('ghl',
 * 'lovable-ai' and 'lovable-ai-gateway' all exist in the wild) and it names a
 * vendor, not a credential — GOOGLE_MAPS_API_KEY and GOOGLE_API_KEY are the
 * same vendor and separate bills. This module is the translation, and it is
 * pure so it can be tested without a database or a network.
 *
 * No imports and no Deno globals: it is loaded both by an edge function and by
 * the repo's vitest suite.
 */

/** Must match Mission Control's `api_provider_rates.unit` CHECK constraint. */
export type UsageUnit =
  | "request"
  | "token"
  | "email"
  | "minute"
  | "document"
  | "page"
  | "render"
  | "verification"
  | "message"
  | "lookup";

export type ServiceBinding = {
  /** The `Deno.env.get` name whose key this call consumed. */
  secretName: string;
  unit: UsageUnit;
  /**
   * How to read the quantity off an `api_usage_log` row. Token-priced services
   * bill on `tokens_used`; everything else bills per call.
   */
  quantityFrom: "tokens" | "requests";
};

/**
 * service_name → the credential it spends.
 *
 * Keys are lowercased and stripped of separators before lookup, so 'lovable-ai',
 * 'lovable_ai' and 'LovableAI' all resolve. Aliases are listed explicitly
 * rather than guessed: a service that silently resolves to the wrong secret
 * bills the wrong tenant, which is worse than not billing at all.
 */
const BINDINGS: Record<string, ServiceBinding> = {
  // ── AI, priced per token ──
  openai: { secretName: "OPENAI_API_KEY", unit: "token", quantityFrom: "tokens" },
  anthropic: { secretName: "ANTHROPIC_API_KEY", unit: "token", quantityFrom: "tokens" },
  claude: { secretName: "ANTHROPIC_API_KEY", unit: "token", quantityFrom: "tokens" },
  perplexity: { secretName: "PERPLEXITY_API_KEY", unit: "token", quantityFrom: "tokens" },
  openrouter: { secretName: "OPENROUTER_API_KEY", unit: "token", quantityFrom: "tokens" },
  gemini: { secretName: "GEMINI_API_KEY", unit: "token", quantityFrom: "tokens" },
  googleai: { secretName: "GOOGLE_API_KEY", unit: "token", quantityFrom: "tokens" },
  lovableai: { secretName: "LOVABLE_API_KEY", unit: "token", quantityFrom: "tokens" },
  lovableaigateway: { secretName: "LOVABLE_API_KEY", unit: "token", quantityFrom: "tokens" },
  lovable: { secretName: "LOVABLE_API_KEY", unit: "token", quantityFrom: "tokens" },
  // The commercial borrowing-capacity segment engine runs on the gateway.
  bcsegmentengine: { secretName: "LOVABLE_API_KEY", unit: "token", quantityFrom: "tokens" },

  // ── Email ──
  resend: { secretName: "RESEND_API_KEY", unit: "email", quantityFrom: "requests" },
  microsoftgraph: {
    secretName: "MICROSOFT_CLIENT_SECRET",
    unit: "request",
    quantityFrom: "requests",
  },
  outlook: { secretName: "MICROSOFT_CLIENT_SECRET", unit: "request", quantityFrom: "requests" },

  // ── Property data ──
  domain: { secretName: "DOMAIN_API_KEY", unit: "lookup", quantityFrom: "requests" },
  cotality: { secretName: "COTALITY_API_KEY", unit: "lookup", quantityFrom: "requests" },
  corelogic: { secretName: "COTALITY_API_KEY", unit: "lookup", quantityFrom: "requests" },
  airtable: { secretName: "AIRTABLE_TOKEN", unit: "request", quantityFrom: "requests" },
  firecrawl: { secretName: "FIRECRAWL_API_KEY", unit: "page", quantityFrom: "requests" },

  // ── Maps ──
  googlemaps: { secretName: "GOOGLE_MAPS_API_KEY", unit: "request", quantityFrom: "requests" },
  googleplaces: { secretName: "GOOGLE_MAPS_API_KEY", unit: "request", quantityFrom: "requests" },
  googlegeocoding: { secretName: "GOOGLE_MAPS_API_KEY", unit: "request", quantityFrom: "requests" },
  googlestreetview: {
    secretName: "GOOGLE_MAPS_API_KEY",
    unit: "request",
    quantityFrom: "requests",
  },

  // ── Voice ──
  vapi: { secretName: "VAPI_API_KEY", unit: "minute", quantityFrom: "requests" },

  // ── Documents and rendering ──
  gamma: { secretName: "GAMMA_API_KEY", unit: "document", quantityFrom: "requests" },
  api2pdf: { secretName: "API2PDF_API_KEY", unit: "render", quantityFrom: "requests" },
  weasyprint: { secretName: "WEASYPRINT_SERVICE_TOKEN", unit: "render", quantityFrom: "requests" },
  pdfparse: { secretName: "PDF_PARSE_SERVICE_TOKEN", unit: "document", quantityFrom: "requests" },
  docusign: { secretName: "DOCUSIGN_INTEGRATION_KEY", unit: "document", quantityFrom: "requests" },

  // ── Compliance ──
  aml: { secretName: "AML_VERIFICATION_SERVICE_TOKEN", unit: "verification", quantityFrom: "requests" },
  amlverification: {
    secretName: "AML_VERIFICATION_SERVICE_TOKEN",
    unit: "verification",
    quantityFrom: "requests",
  },

  // ── CRM and marketing ──
  ghl: { secretName: "GOHIGHLEVEL_API_KEY", unit: "request", quantityFrom: "requests" },
  gohighlevel: { secretName: "GOHIGHLEVEL_API_KEY", unit: "request", quantityFrom: "requests" },
  manychat: { secretName: "MANYCHAT_API_KEY", unit: "message", quantityFrom: "requests" },
  metaads: { secretName: "META_ADS_ACCESS_TOKEN", unit: "request", quantityFrom: "requests" },
  metaadsanalysis: {
    secretName: "META_ADS_ACCESS_TOKEN",
    unit: "request",
    quantityFrom: "requests",
  },
};

/** 'Lovable-AI Gateway' → 'lovableaigateway'. */
export function normalizeServiceName(service: string): string {
  return (service ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve a logged service to the credential it spent.
 *
 * Returns null for anything unrecognised. The caller must not guess: an
 * unmapped service is reported to Mission Control with no secret name at all,
 * where it lands as `rate_missing` on the operator dashboard and gets a row in
 * the catalog, rather than being charged against whichever key looked closest.
 */
export function resolveServiceBinding(service: string): ServiceBinding | null {
  return BINDINGS[normalizeServiceName(service)] ?? null;
}

/** Every secret this repo can currently attribute usage to. */
export function knownBillableSecrets(): string[] {
  return Array.from(new Set(Object.values(BINDINGS).map((b) => b.secretName))).sort();
}

export type UsageLogRow = {
  id: string;
  service_name: string;
  endpoint?: string | null;
  tokens_used?: number | null;
  request_count?: number | null;
  model_used?: string | null;
  status?: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

export type ReportableEvent = {
  secret_name: string;
  quantity: number;
  idempotency_key: string;
  model: string | null;
  feature: string | null;
  status: "success" | "error";
  occurred_at: string;
  metadata: Record<string, unknown>;
};

/**
 * Turn one `api_usage_log` row into the event Mission Control meters.
 *
 * The row id is the idempotency key. That is not a convenience — the forwarder
 * runs on a cron and retries, and a re-sent batch must be recognised as the
 * same calls rather than metered twice. A row id is stable, unique, and already
 * the thing we mark as forwarded.
 *
 * Returns null when the row cannot be attributed to a credential, or when a
 * token-priced call reported zero tokens (nothing was consumed, so there is
 * nothing to charge and a zero-quantity event would only add noise).
 */
export function toReportableEvent(row: UsageLogRow): ReportableEvent | null {
  const binding = resolveServiceBinding(row.service_name);
  if (!binding) return null;

  // An explicit secret name in metadata wins over the map: it lets a call site
  // that knows exactly which credential it used say so, and it is how a new
  // vendor gets metered before this file learns about it.
  const declared = row.metadata?.secret_name;
  const secretName = typeof declared === "string" && /^[A-Z_][A-Z0-9_]*$/.test(declared)
    ? declared
    : binding.secretName;

  const quantity =
    binding.quantityFrom === "tokens"
      ? Number(row.tokens_used ?? 0)
      : Math.max(Number(row.request_count ?? 1), 1);

  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  return {
    secret_name: secretName,
    quantity,
    idempotency_key: row.id,
    model: row.model_used ?? null,
    feature: row.endpoint ?? null,
    status: row.status === "error" ? "error" : "success",
    occurred_at: row.created_at,
    metadata: {
      ...(row.metadata ?? {}),
      service_name: row.service_name,
      unit: binding.unit,
    },
  };
}
