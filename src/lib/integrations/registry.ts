/**
 * Central registry of every external service this platform talks to.
 *
 * Every entry maps to real credentials consumed by edge functions
 * (`Deno.env.get(...)`) or by the browser. Grouping is by capability so the
 * Integrations page can render categorised, searchable sections.
 *
 * Field `key` values MUST stay stable — they are the primary key in
 * `integration_configs.key_name`. For legacy entries (airtable, gohighlevel)
 * the stored key differs from the Supabase secret name; that translation lives
 * in `SUPABASE_SECRET_ALIASES` below.
 */

export type IntegrationCategoryId =
  | 'ai'
  | 'property_data'
  | 'crm_marketing'
  | 'communications'
  | 'documents'
  | 'automation'
  | 'infrastructure';

export interface IntegrationCategory {
  id: IntegrationCategoryId;
  label: string;
  description: string;
}

export interface IntegrationField {
  key: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password';
  required?: boolean;
}

export interface IntegrationDefinition {
  id: string;
  name: string;
  description: string;
  category: IntegrationCategoryId;
  /** Free-text keywords used by the search box (name/description already indexed). */
  tags: string[];
  fields: IntegrationField[];
  docsUrl?: string;
  /** Rendered when neither Simple Icons nor thesvg.org has a mark. */
  fallbackIcon:
    | 'brain'
    | 'database'
    | 'phone'
    | 'mail'
    | 'webhook'
    | 'shield'
    | 'cloud'
    | 'map'
    | 'file'
    | 'sparkles'
    | 'megaphone'
    | 'settings'
    | 'bell'
    | 'creditCard';
}

export const INTEGRATION_CATEGORIES: IntegrationCategory[] = [
  { id: 'ai', label: 'AI & Models', description: 'LLM providers and inference gateways powering agents, reports and analysis.' },
  { id: 'property_data', label: 'Property & Market Data', description: 'Listing feeds, valuations, geocoding and location intelligence.' },
  { id: 'crm_marketing', label: 'CRM & Marketing', description: 'Pipelines, lead capture, ad platforms and conversational marketing.' },
  { id: 'communications', label: 'Communications', description: 'Email, SMS, voice, calendar and push notification delivery.' },
  { id: 'documents', label: 'Documents & Rendering', description: 'PDF pipelines, e-signature, decks and document extraction services.' },
  { id: 'automation', label: 'Automation & Workflows', description: 'Webhooks, scraping, orchestration and platform control planes.' },
  { id: 'infrastructure', label: 'Infrastructure & Security', description: 'Edge network, secret management, bot protection and design tooling.' },
];

export const INTEGRATIONS: IntegrationDefinition[] = [
  // ── AI & Models ─────────────────────────────────────────────────────────
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'AI-powered analysis, chart generation, and report Q&A.',
    category: 'ai',
    tags: ['gpt', 'llm', 'embeddings', 'vision'],
    docsUrl: 'https://platform.openai.com/docs',
    fallbackIcon: 'brain',
    fields: [{ key: 'OPENAI_API_KEY', label: 'API Key', placeholder: 'sk-...', type: 'password', required: true }],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Native Claude models (Sonnet, Opus, Haiku) for reasoning-heavy agents. Unlocks Claude in the Model Hub.',
    category: 'ai',
    tags: ['claude', 'llm', 'reasoning'],
    docsUrl: 'https://docs.anthropic.com/en/api/getting-started',
    fallbackIcon: 'brain',
    fields: [{ key: 'ANTHROPIC_API_KEY', label: 'API Key', placeholder: 'sk-ant-...', type: 'password', required: true }],
  },
  {
    id: 'gemini',
    name: 'Google Gemini (Native)',
    description: 'Direct Gemini API access for native calls outside the Lovable Gateway.',
    category: 'ai',
    tags: ['google', 'llm', 'multimodal'],
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    fallbackIcon: 'brain',
    fields: [{ key: 'GEMINI_API_KEY', label: 'API Key', placeholder: 'AIza...', type: 'password', required: true }],
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    description: 'AI search for report regeneration, market research and citation-backed answers.',
    category: 'ai',
    tags: ['search', 'research', 'sonar'],
    docsUrl: 'https://docs.perplexity.ai',
    fallbackIcon: 'brain',
    fields: [{ key: 'PERPLEXITY_API_KEY', label: 'API Key', placeholder: 'pplx-...', type: 'password', required: true }],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Unified gateway to 300+ models (Claude, GPT, Llama, Mistral, DeepSeek, Qwen). Unlocks the OpenRouter section in the Model Hub.',
    category: 'ai',
    tags: ['gateway', 'llm', 'router', 'llama', 'mistral'],
    docsUrl: 'https://openrouter.ai/docs',
    fallbackIcon: 'brain',
    fields: [{ key: 'OPENROUTER_API_KEY', label: 'API Key', placeholder: 'sk-or-v1-...', type: 'password', required: true }],
  },

  // ── Property & Market Data ─────────────────────────────────────────────
  {
    id: 'airtable',
    name: 'Airtable',
    description: 'Property listings and opportunity marketplace source-of-record.',
    category: 'property_data',
    tags: ['listings', 'database', 'opportunity marketplace'],
    docsUrl: 'https://airtable.com/developers/web/api/introduction',
    fallbackIcon: 'database',
    fields: [
      { key: 'AIRTABLE_API_KEY', label: 'API Key', placeholder: 'pat...', type: 'password', required: true },
      { key: 'AIRTABLE_BASE_ID', label: 'Base ID', placeholder: 'app...', type: 'text', required: true },
    ],
  },
  {
    id: 'cotality',
    name: 'Cotality (CoreLogic)',
    description: 'Licensed property data spine — valuations, comparable sales, rental evidence and suburb analytics.',
    category: 'property_data',
    tags: ['corelogic', 'rp data', 'valuation', 'comparables', 'avm'],
    docsUrl: 'https://www.cotality.com/en-au',
    fallbackIcon: 'database',
    fields: [
      { key: 'COTALITY_API_KEY', label: 'API Key', placeholder: 'Enter Cotality API key', type: 'password', required: true },
      { key: 'COTALITY_BASE_URL', label: 'Base URL', placeholder: 'https://api.cotality.com', type: 'text', required: false },
    ],
  },
  {
    id: 'domain',
    name: 'Domain',
    description: 'Australian residential listing and sales history feed for market comparisons.',
    category: 'property_data',
    tags: ['listings', 'australia', 'sales history', 'real estate'],
    docsUrl: 'https://developer.domain.com.au/docs/latest',
    fallbackIcon: 'database',
    fields: [{ key: 'DOMAIN_API_KEY', label: 'API Key', placeholder: 'Enter Domain API key', type: 'password', required: true }],
  },
  {
    id: 'google',
    name: 'Google Maps Platform',
    description: 'Geocoding, Places autocomplete and Street View imagery for the map view and address capture.',
    category: 'property_data',
    tags: ['maps', 'geocoding', 'places', 'street view', 'autocomplete'],
    docsUrl: 'https://developers.google.com/maps/documentation',
    fallbackIcon: 'map',
    fields: [
      { key: 'GOOGLE_MAPS_API_KEY', label: 'Maps API Key', placeholder: 'AIza...', type: 'password', required: true },
      { key: 'GOOGLE_GEOCODING_DAILY_LIMIT', label: 'Geocoding Daily Cap', placeholder: '2500', type: 'text', required: false },
      { key: 'GOOGLE_PLACES_DAILY_LIMIT', label: 'Places Daily Cap', placeholder: '2500', type: 'text', required: false },
      { key: 'GOOGLE_STREET_VIEW_DAILY_LIMIT', label: 'Street View Daily Cap', placeholder: '2500', type: 'text', required: false },
    ],
  },

  // ── CRM & Marketing ────────────────────────────────────────────────────
  {
    id: 'gohighlevel',
    name: 'GoHighLevel',
    description: 'CRM, pipelines and marketing automation — the primary contact system of record.',
    category: 'crm_marketing',
    tags: ['ghl', 'crm', 'pipeline', 'contacts', 'workflows'],
    docsUrl: 'https://highlevel.stoplight.io/docs/integrations',
    fallbackIcon: 'settings',
    fields: [
      { key: 'GHL_API_KEY', label: 'API Key', placeholder: 'Enter GHL API key', type: 'password', required: true },
      { key: 'GHL_LOCATION_ID', label: 'Location ID', placeholder: 'Enter location ID', type: 'text', required: true },
    ],
  },
  {
    id: 'gohighlevel_new',
    name: 'GoHighLevel (Migration Account)',
    description: 'Destination GHL location used by the dual-account resolver during migration cutover.',
    category: 'crm_marketing',
    tags: ['ghl', 'migration', 'cutover', 'crm'],
    docsUrl: 'https://highlevel.stoplight.io/docs/integrations',
    fallbackIcon: 'settings',
    fields: [
      { key: 'GOHIGHLEVEL_API_KEY_NEW', label: 'API Key (New)', placeholder: 'Enter new GHL API key', type: 'password', required: true },
      { key: 'GOHIGHLEVEL_LOCATION_ID_NEW', label: 'Location ID (New)', placeholder: 'Enter new location ID', type: 'text', required: true },
    ],
  },
  {
    id: 'meta_ads',
    name: 'Meta Ads',
    description: 'Facebook and Instagram lead ads plus campaign performance for marketing attribution.',
    category: 'crm_marketing',
    tags: ['facebook', 'instagram', 'ads', 'lead gen', 'campaigns'],
    docsUrl: 'https://developers.facebook.com/docs/marketing-apis',
    fallbackIcon: 'megaphone',
    fields: [
      { key: 'META_ADS_ACCESS_TOKEN', label: 'Access Token', placeholder: 'EAA...', type: 'password', required: true },
      { key: 'META_ADS_AD_ACCOUNT_ID', label: 'Ad Account ID', placeholder: 'act_...', type: 'text', required: true },
    ],
  },
  {
    id: 'manychat',
    name: 'ManyChat',
    description: 'Conversational marketing flows across Messenger, Instagram DM and SMS.',
    category: 'crm_marketing',
    tags: ['chatbot', 'messenger', 'instagram', 'drip'],
    docsUrl: 'https://api.manychat.com',
    fallbackIcon: 'megaphone',
    fields: [{ key: 'MANYCHAT_API_KEY', label: 'API Key', placeholder: 'Enter ManyChat API key', type: 'password', required: true }],
  },

  // ── Communications ─────────────────────────────────────────────────────
  {
    id: 'resend',
    name: 'Resend',
    description: 'Transactional email delivery for portal invites, notifications and client comms.',
    category: 'communications',
    tags: ['email', 'smtp', 'transactional', 'notifications'],
    docsUrl: 'https://resend.com/docs',
    fallbackIcon: 'mail',
    fields: [{ key: 'RESEND_API_KEY', label: 'API Key', placeholder: 're_...', type: 'password', required: true }],
  },
  {
    id: 'microsoft',
    name: 'Microsoft / Outlook',
    description: 'Email sync, calendar and mailbox subscriptions via Microsoft Graph.',
    category: 'communications',
    tags: ['outlook', 'graph', 'calendar', 'email', 'office 365'],
    docsUrl: 'https://learn.microsoft.com/en-us/graph/overview',
    fallbackIcon: 'mail',
    fields: [
      { key: 'MICROSOFT_CLIENT_ID', label: 'Client ID', placeholder: 'Enter client ID', type: 'text', required: true },
      { key: 'MICROSOFT_CLIENT_SECRET', label: 'Client Secret', placeholder: 'Enter client secret', type: 'password', required: true },
      { key: 'MICROSOFT_TENANT_ID', label: 'Tenant ID', placeholder: 'Enter tenant ID', type: 'text', required: true },
      { key: 'MICROSOFT_MAILBOX_EMAIL', label: 'Mailbox Email', placeholder: 'ops@example.com', type: 'text', required: false },
    ],
  },
  {
    id: 'twilio',
    name: 'Twilio',
    description: 'SMS and programmable voice delivery.',
    category: 'communications',
    tags: ['sms', 'voice', 'messaging', 'phone'],
    docsUrl: 'https://www.twilio.com/docs',
    fallbackIcon: 'phone',
    fields: [
      { key: 'TWILIO_ACCOUNT_SID', label: 'Account SID', placeholder: 'AC...', type: 'text', required: true },
      { key: 'TWILIO_AUTH_TOKEN', label: 'Auth Token', placeholder: 'Enter auth token', type: 'password', required: true },
    ],
  },
  {
    id: 'vapi',
    name: 'Vapi',
    description: 'Voice AI agents for inbound and outbound calls, with recordings and transcription.',
    category: 'communications',
    tags: ['voice ai', 'calls', 'transcription', 'recordings'],
    docsUrl: 'https://docs.vapi.ai',
    fallbackIcon: 'phone',
    fields: [
      { key: 'VAPI_API_KEY', label: 'API Key', placeholder: 'Enter Vapi API key', type: 'password', required: true },
      { key: 'VAPI_WEBHOOK_SECRET', label: 'Webhook Secret', placeholder: 'Enter webhook signing secret', type: 'password', required: false },
    ],
  },
  {
    id: 'webpush',
    name: 'Web Push (VAPID)',
    description: 'Browser push notifications for Command Centre and all portals.',
    category: 'communications',
    tags: ['push', 'vapid', 'notifications', 'service worker'],
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Push_API',
    fallbackIcon: 'bell',
    fields: [
      { key: 'VAPID_PUBLIC_KEY', label: 'Public Key', placeholder: 'B...', type: 'text', required: true },
      { key: 'VAPID_PRIVATE_KEY', label: 'Private Key', placeholder: 'Enter VAPID private key', type: 'password', required: true },
      { key: 'VAPID_SUBJECT_EMAIL', label: 'Subject Email', placeholder: 'mailto:ops@example.com', type: 'text', required: false },
    ],
  },

  // ── Documents & Rendering ──────────────────────────────────────────────
  {
    id: 'docusign',
    name: 'DocuSign',
    description: 'E-signature for partner agreements, consents and loan writer undertakings.',
    category: 'documents',
    tags: ['esign', 'signature', 'agreements', 'envelopes'],
    docsUrl: 'https://developers.docusign.com/docs',
    fallbackIcon: 'file',
    fields: [
      { key: 'DOCUSIGN_INTEGRATION_KEY', label: 'Integration Key', placeholder: 'Enter integration key', type: 'text', required: true },
      { key: 'DOCUSIGN_USER_ID', label: 'User ID', placeholder: 'Enter impersonated user GUID', type: 'text', required: true },
      { key: 'DOCUSIGN_ACCOUNT_ID', label: 'Account ID', placeholder: 'Enter account GUID', type: 'text', required: true },
      { key: 'DOCUSIGN_RSA_PRIVATE_KEY', label: 'RSA Private Key', placeholder: '-----BEGIN RSA PRIVATE KEY-----', type: 'password', required: true },
      { key: 'DOCUSIGN_BASE_URL', label: 'Base URL', placeholder: 'https://demo.docusign.net/restapi', type: 'text', required: false },
    ],
  },
  {
    id: 'gamma',
    name: 'Gamma',
    description: 'Branded deck and report generation from structured report payloads.',
    category: 'documents',
    tags: ['decks', 'presentations', 'reports', 'templates'],
    docsUrl: 'https://developers.gamma.app',
    fallbackIcon: 'sparkles',
    fields: [
      { key: 'GAMMA_API_KEY', label: 'API Key', placeholder: 'Enter Gamma API key', type: 'password', required: true },
      { key: 'GAMMA_TEMPLATE_ID', label: 'Template ID', placeholder: 'Enter default template ID', type: 'text', required: false },
    ],
  },
  {
    id: 'api2pdf',
    name: 'API2PDF',
    description: 'HTML-to-PDF fallback renderer for investment and portfolio reports.',
    category: 'documents',
    tags: ['pdf', 'render', 'html', 'chrome'],
    docsUrl: 'https://www.api2pdf.com/documentation',
    fallbackIcon: 'file',
    fields: [{ key: 'API2PDF_API_KEY', label: 'API Key', placeholder: 'Enter API2PDF key', type: 'password', required: true }],
  },
  {
    id: 'weasyprint',
    name: 'WeasyPrint Service',
    description: 'Self-hosted print-grade PDF renderer used for premium report layouts.',
    category: 'documents',
    tags: ['pdf', 'render', 'self-hosted', 'print'],
    docsUrl: 'https://doc.courtbouillon.org/weasyprint/stable/',
    fallbackIcon: 'file',
    fields: [
      { key: 'WEASYPRINT_SERVICE_URL', label: 'Service URL', placeholder: 'https://weasyprint.example.com', type: 'text', required: true },
      { key: 'WEASYPRINT_SERVICE_TOKEN', label: 'Service Token', placeholder: 'Enter service token', type: 'password', required: true },
    ],
  },
  {
    id: 'pdf_parse',
    name: 'PDF Parse Service',
    description: 'Docling / Document AI sidecar that extracts structured data from client PDFs.',
    category: 'documents',
    tags: ['ocr', 'docling', 'extraction', 'document ai', 'sidecar'],
    fallbackIcon: 'file',
    fields: [
      { key: 'PDF_PARSE_SERVICE_URL', label: 'Service URL', placeholder: 'https://pdf-parse.example.com', type: 'text', required: true },
      { key: 'PDF_PARSE_SERVICE_TOKEN', label: 'Service Token', placeholder: 'Enter service token', type: 'password', required: true },
    ],
  },
  {
    id: 'render_source',
    name: 'Render Source Service',
    description: 'Sandboxed renderer that turns report source bundles into paginated output.',
    category: 'documents',
    tags: ['render', 'bundle', 'sandbox', 'reports'],
    fallbackIcon: 'file',
    fields: [
      { key: 'RENDER_SOURCE_URL', label: 'Service URL', placeholder: 'https://render.example.com', type: 'text', required: true },
      { key: 'RENDER_SOURCE_TOKEN', label: 'Service Token', placeholder: 'Enter service token', type: 'password', required: true },
    ],
  },

  // ── Automation & Workflows ─────────────────────────────────────────────
  {
    id: 'make',
    name: 'Make.com',
    description: 'Workflow automation webhooks for cross-system orchestration.',
    category: 'automation',
    tags: ['integromat', 'webhook', 'scenarios', 'automation'],
    docsUrl: 'https://www.make.com/en/help',
    fallbackIcon: 'webhook',
    fields: [{ key: 'MAKE_WEBHOOK_URL', label: 'Webhook URL', placeholder: 'https://hook.make.com/...', type: 'text' }],
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    description: 'Web scraping and crawling for market updates, listing enrichment and research.',
    category: 'automation',
    tags: ['scraping', 'crawler', 'market updates', 'research'],
    docsUrl: 'https://docs.firecrawl.dev',
    fallbackIcon: 'webhook',
    fields: [{ key: 'FIRECRAWL_API_KEY', label: 'API Key', placeholder: 'fc-...', type: 'password', required: true }],
  },
  {
    id: 'mission_control',
    name: 'Aurixa Mission Control',
    description: 'Billing, seats, device caps and pricing catalog control plane.',
    category: 'automation',
    tags: ['billing', 'tokens', 'seats', 'catalog', 'aurixa'],
    fallbackIcon: 'creditCard',
    fields: [
      { key: 'MISSION_CONTROL_URL', label: 'Base URL', placeholder: 'https://mission-control.example.com', type: 'text', required: true },
      { key: 'MISSION_CONTROL_CLONE_API_KEY', label: 'Clone API Key', placeholder: 'Enter Mission Control API key', type: 'password', required: true },
      { key: 'MISSION_CONTROL_AGENCY_NAME', label: 'Agency / Tenant Ref', placeholder: 'npc-services', type: 'text', required: false },
      { key: 'MISSION_CONTROL_WEBHOOK_SECRET', label: 'Webhook Secret', placeholder: 'Enter webhook signing secret', type: 'password', required: false },
    ],
  },

  // ── Infrastructure & Security ──────────────────────────────────────────
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'CDN, R2 storage, analytics, Workers and firewall management.',
    category: 'infrastructure',
    tags: ['cdn', 'r2', 'dns', 'workers', 'waf'],
    docsUrl: 'https://developers.cloudflare.com/api',
    fallbackIcon: 'cloud',
    fields: [
      { key: 'CLOUDFLARE_API_TOKEN', label: 'API Token', placeholder: 'Enter Cloudflare API token', type: 'password', required: true },
      { key: 'CLOUDFLARE_ZONE_ID', label: 'Zone ID', placeholder: 'Enter zone ID', type: 'text', required: true },
      { key: 'CLOUDFLARE_ACCOUNT_ID', label: 'Account ID', placeholder: 'Enter account ID', type: 'text', required: true },
    ],
  },
  {
    id: 'supabase',
    name: 'Supabase Management',
    description: 'Management API access token used to sync secrets and inspect project configuration.',
    category: 'infrastructure',
    tags: ['database', 'secrets', 'edge functions', 'management api'],
    docsUrl: 'https://supabase.com/docs/reference/api/introduction',
    fallbackIcon: 'database',
    fields: [{ key: 'SUPABASE_ACCESS_TOKEN', label: 'Access Token', placeholder: 'sbp_...', type: 'password', required: true }],
  },
  {
    id: 'turnstile',
    name: 'Cloudflare Turnstile',
    description: 'Bot protection on public portal, consent and lead magnet forms.',
    category: 'infrastructure',
    tags: ['captcha', 'bot', 'security', 'forms'],
    docsUrl: 'https://developers.cloudflare.com/turnstile',
    fallbackIcon: 'shield',
    fields: [{ key: 'TURNSTILE_SECRET_KEY', label: 'Secret Key', placeholder: 'Enter Turnstile secret key', type: 'password', required: true }],
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Design token and asset sync for brand and template tooling.',
    category: 'infrastructure',
    tags: ['design', 'tokens', 'assets', 'branding'],
    docsUrl: 'https://www.figma.com/developers/api',
    fallbackIcon: 'sparkles',
    fields: [{ key: 'FIGMA_API_TOKEN', label: 'Personal Access Token', placeholder: 'figd_...', type: 'password', required: true }],
  },
];

/** Frontend field key → Supabase secret name, when they differ. */
export const SUPABASE_SECRET_ALIASES: Record<string, string> = {
  AIRTABLE_API_KEY: 'AIRTABLE_TOKEN',
  GHL_API_KEY: 'GOHIGHLEVEL_API_KEY',
  GHL_LOCATION_ID: 'GOHIGHLEVEL_LOCATION_ID',
};

export function getSupabaseSecretName(fieldKey: string): string {
  return SUPABASE_SECRET_ALIASES[fieldKey] ?? fieldKey;
}

export function getCategory(id: IntegrationCategoryId): IntegrationCategory {
  return INTEGRATION_CATEGORIES.find((c) => c.id === id) ?? INTEGRATION_CATEGORIES[0];
}

/** Lowercased haystack used by the search box. */
export function integrationSearchIndex(integration: IntegrationDefinition): string {
  return [
    integration.name,
    integration.description,
    integration.category,
    ...integration.tags,
    ...integration.fields.map((f) => `${f.key} ${f.label}`),
  ]
    .join(' ')
    .toLowerCase();
}
