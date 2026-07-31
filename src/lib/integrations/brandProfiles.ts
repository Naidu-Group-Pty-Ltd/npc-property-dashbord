// Per-integration brand profiles.
// Logos come from Simple Icons CDN (SVG, no auth, cached on their edge).
// `slug` is the simple-icons slug — see https://simpleicons.org
// `color` is the official brand hex (used for icon halo, header wash, hover ring).
// Third-party brand identity is not a theme token — hex is correct here.

export interface BrandProfile {
  /** simple-icons slug — omit to fall back to thesvg.org / the lucide icon */
  slug?: string;
  /** thesvg.org slug — used when Simple Icons has no (or a removed) mark */
  svgOrgSlug?: string;
  /** Official brand hex, no leading # */
  color: string;
  /** Optional secondary hex for two-tone wash (Gemini spectrum, etc.) */
  color2?: string;
  /** Legibility of the brand color on the header wash — currently informational */
  luminance?: 'light' | 'dark';
}

export const BRAND_PROFILES: Record<string, BrandProfile> = {
  // AI & Models
  openai:      { slug: 'openai',           svgOrgSlug: 'openai',     color: '10A37F', luminance: 'dark' },
  anthropic:   { slug: 'anthropic',        svgOrgSlug: 'anthropic',  color: 'D97757', luminance: 'dark' },
  gemini:      { slug: 'googlegemini',                               color: '4285F4', color2: '9B72CB', luminance: 'dark' },
  perplexity:  { slug: 'perplexity',       svgOrgSlug: 'perplexity', color: '20808D', luminance: 'dark' },
  openrouter:  { slug: 'openrouter',       svgOrgSlug: 'openrouter', color: '6467F2', luminance: 'dark' },
  xai:         { slug: 'x',                                          color: '000000', luminance: 'dark' },

  // Property & market data
  airtable:    { slug: 'airtable',         svgOrgSlug: 'airtable',   color: '18BFFF', luminance: 'dark' },
  cotality:    {                                                     color: '0B7285', luminance: 'dark' },
  domain:      {                                                     color: '2B7A3D', luminance: 'dark' },
  google_maps: { slug: 'googlemaps',                                 color: '4285F4', luminance: 'dark' },

  // CRM & marketing
  gohighlevel: {                                                     color: 'FFB800', luminance: 'dark' },
  gohighlevel_new: {                                                 color: 'FFB800', luminance: 'dark' },
  meta_ads:    { slug: 'meta',             svgOrgSlug: 'meta',       color: '0668E1', luminance: 'dark' },
  manychat:    {                                                     color: '2C6BED', luminance: 'dark' },

  // Communications
  resend:      { slug: 'resend',           svgOrgSlug: 'resend',     color: '000000', luminance: 'dark' },
  twilio:      { slug: 'twilio',           svgOrgSlug: 'twilio',     color: 'F22F46', luminance: 'dark' },
  microsoft:   { slug: 'microsoft',                                  color: '0078D4', luminance: 'dark' },
  vapi:        {                           svgOrgSlug: 'vapi',       color: '14B8A6', luminance: 'dark' },
  webpush:     {                                                     color: '8B5CF6', luminance: 'dark' },

  // Documents & rendering
  docusign:    {                           svgOrgSlug: 'docusign',   color: 'FFCC22', luminance: 'dark' },
  gamma:       {                                                     color: '7C3AED', luminance: 'dark' },
  api2pdf:     {                                                     color: 'E4572E', luminance: 'dark' },
  weasyprint:  {                                                     color: '3B7EA1', luminance: 'dark' },
  pdf_parse:   {                                                     color: 'DC2626', luminance: 'dark' },
  render_source: {                                                   color: '6366F1', luminance: 'dark' },

  // Automation & workflows
  make:        { slug: 'make',             svgOrgSlug: 'make',       color: '6D00CC', luminance: 'dark' },
  firecrawl:   {                           svgOrgSlug: 'firecrawl',  color: 'F97316', luminance: 'dark' },
  mission_control: {                                                 color: 'D4A843', luminance: 'dark' },

  // Infrastructure & security
  cloudflare:  { slug: 'cloudflare',       svgOrgSlug: 'cloudflare', color: 'F38020', luminance: 'dark' },
  supabase:    { slug: 'supabase',         svgOrgSlug: 'supabase',   color: '3ECF8E', luminance: 'dark' },
  turnstile:   { slug: 'cloudflare',       svgOrgSlug: 'cloudflare', color: 'F38020', luminance: 'dark' },
  figma:       { slug: 'figma',            svgOrgSlug: 'figma',      color: 'F24E1E', luminance: 'dark' },


  // Model Hub — direct provider routes
  gateway:     { slug: 'lovable',          color: 'D4A843', luminance: 'dark' },

  // Model Hub — OpenRouter family slugs (id.split('/')[0])
  google:       { slug: 'google',          color: '4285F4', luminance: 'dark' },
  'meta-llama': { slug: 'meta',            color: '0668E1', luminance: 'dark' },
  mistralai:    { slug: 'mistralai',       color: 'FA520F', luminance: 'dark' },
  deepseek:     { slug: 'deepseek',        color: '4D6BFE', luminance: 'dark' },
  qwen:         { slug: 'qwen',            color: '615CED', luminance: 'dark' },
  'x-ai':       { slug: 'x',               color: '000000', luminance: 'dark' },
  cohere:       {                          color: '39594D', luminance: 'dark' },
  nvidia:       { slug: 'nvidia',          color: '76B900', luminance: 'dark' },
  'hugging-face': { slug: 'huggingface',   color: 'FFD21E', luminance: 'dark' },
  huggingfaceh4: { slug: 'huggingface',    color: 'FFD21E', luminance: 'dark' },
  databricks:   { slug: 'databricks',      color: 'FF3621', luminance: 'dark' },
  amazon:       {                          color: 'FF9900', luminance: 'dark' },
  'amazon-bedrock': {                      color: 'FF9900', luminance: 'dark' },
  nousresearch: {                          color: '8B5CF6', luminance: 'dark' },
  microsoft_wsl: { slug: 'microsoft',      color: '0078D4', luminance: 'dark' },
  ai21:         {                          color: 'FF6B00', luminance: 'dark' },
  moonshotai:   {                          color: '2ECC71', luminance: 'dark' },
  z_ai:         {                          color: '0EA5E9', luminance: 'dark' },
  inception:    {                          color: '8B5CF6', luminance: 'dark' },
  liquid:       {                          color: '06B6D4', luminance: 'dark' },
};

export function getBrandProfile(id: string): BrandProfile | undefined {
  return Object.prototype.hasOwnProperty.call(BRAND_PROFILES, id) ? BRAND_PROFILES[id] : undefined;
}

/** Build the Simple Icons CDN URL for a colored SVG mark. */
export function brandLogoUrl(slug: string, colorHex: string): string {
  return `https://cdn.simpleicons.org/${slug}/${colorHex}`;
}

/**
 * Fallback mark from thesvg.org — used when Simple Icons has no entry
 * (or dropped one for trademark reasons). Served as-is in brand colours.
 */
export function svgOrgLogoUrl(slug: string): string {
  return `https://thesvg.org/icons/${slug}/default.svg`;
}
