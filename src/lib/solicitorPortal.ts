/**
 * Solicitor Portal client-side API wrapper.
 *
 * Mirrors the Finance Portal transport: cookie-authenticated edge invocation using an HttpOnly portal-scoped session so the Command Centre,
 * Client Portal, Finance Portal and Solicitor Portal never share a session.
 */

const SUPABASE_URL = 'https://dduzbchuswwbefdunfct.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk';

export interface SolicitorPortalUser {
  id: string;
  firm_id: string;
  email: string;
  name: string;
  phone: string | null;
  position: string | null;
  portal_role: string;
  firm_name: string | null;
  practising_states: string[];
  has_accepted_terms: boolean;
  has_completed_onboarding: boolean;
  must_change_password: boolean;
  current_terms_version: string | null;
  has_accepted_current_terms: boolean;
  has_completed_mandatory_onboarding: boolean;
}

/**
 * The mandatory acknowledgments of the Portal Access, Confidentiality, Privacy
 * and AML/CTF Compliance Passport Agreement, in the order the agreement sets.
 *
 * The wording is the agreement's own. It is duplicated here rather than parsed
 * out of the stored Markdown because these five are the interface contract:
 * `solicitor-portal-verify` refuses an acceptance that does not assert all five
 * keys, and stores the asserted keys as the acknowledgment history. Changing a
 * key here without changing `REQUIRED_TERMS_ACKNOWLEDGEMENTS` in that function
 * locks every solicitor out of the portal, which is why both lists carry this
 * note. Changing the *wording* is a change to the agreement: publish a new
 * terms version, do not edit this in place.
 */
export const SOLICITOR_TERMS_ACKNOWLEDGEMENTS = [
  {
    key: 'global_confidentiality_privacy',
    heading: 'Global confidentiality and privacy',
    statement:
      'I acknowledge that all information made available through the Portal is confidential and may include personal, sensitive, commercially confidential or legally privileged information. I agree that my organisation will access, use, protect and disclose that information only for an authorised client, transaction and lawful professional purpose.',
  },
  {
    key: 'authority_binding_acceptance',
    heading: 'Authority and binding acceptance',
    statement:
      'I confirm that I am authorised to accept this Agreement and legally bind the Partner Organisation identified above. I agree that my electronic acceptance will constitute execution of this Agreement on behalf of the Partner Organisation.',
  },
  {
    key: 'portal_access',
    heading: 'Portal access',
    statement:
      'I agree that the Partner Organisation will access and use the Portal only for authorised matters and will comply with the Portal access, privacy, confidentiality, security and audit requirements set out in this Agreement.',
  },
  {
    key: 'binding_amlctf_arrangement',
    heading: 'Binding AML/CTF arrangement',
    statement:
      'I acknowledge and agree that, where the applicable eligibility and legislative requirements are satisfied, this Agreement is intended to constitute a binding customer due-diligence agreement or arrangement between the Originating Organisation and Partner Organisation for the purposes of section 37A of the AML/CTF Act and section 6-29 of the AML/CTF Rules.',
  },
  {
    key: 'independent_amlctf_responsibility',
    heading: 'Independent AML/CTF responsibility',
    statement:
      'I acknowledge that access to an Aurixa AML/CTF Compliance Passport does not automatically authorise reliance or satisfy all of the Partner Organisation’s AML/CTF obligations. The Partner Organisation remains responsible for assessing, approving and recording reliance and for completing any additional, enhanced, ongoing or independent customer due diligence required.',
  },
] as const;

export type SolicitorAcknowledgementKey = (typeof SOLICITOR_TERMS_ACKNOWLEDGEMENTS)[number]['key'];

export async function invokeSolicitorFunction<T = any>(
  functionName: string,
  body: Record<string, unknown> = {},
  options: { signal?: AbortSignal } = {},
): Promise<{ data: T | null; error: { message: string; code?: string; status?: number } | null }> {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'X-Portal-Request': 'solicitor-portal',
      },
      credentials: 'include',
      signal: options.signal,
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { data, error: { message: (data as any)?.error || `HTTP ${response.status}`, code: (data as any)?.code, status: response.status } };
    }
    return { data, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error?.message || 'Network error' } };
  }
}
