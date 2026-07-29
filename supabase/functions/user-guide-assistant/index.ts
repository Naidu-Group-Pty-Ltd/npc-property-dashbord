import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { logApiUsage } from '../_shared/logApiUsage.ts';
import { createUsageTrackingStream } from '../_shared/streamUsageLogger.ts';
import { getBrandConfig } from '../_shared/brand-config.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

// System prompt for the User Guide Assistant — brand name is injected dynamically
const buildSystemPrompt = (brandName: string) => `You are a helpful AI assistant for the ${brandName} Property Dashboard. Your role is to guide users through the platform's features and help them understand how to use the dashboard effectively.

IMPORTANT GUIDELINES:
1. Be concise and helpful - provide clear, actionable answers
2. When referencing a feature, include the section ID for navigation using this format: [[section:SECTION_ID|Section Title]]
3. Use the knowledge base context provided to answer questions accurately
4. If you're unsure about something, say so rather than guessing
5. Format your responses using Markdown for better readability
6. When listing steps, use numbered lists
7. When explaining features, use bullet points
8. Always be friendly and encouraging

SECTION LINKING FORMAT:
- Use [[section:getting-started|Getting Started]] to link to the Getting Started section
- Use [[section:client-management|Client Management]] to link to Client Management
- Use [[section:email-copilot|Email Copilot]] to link to Email Copilot
- Use [[section:report-qa|Report Q&A]] to link to Report Q&A
- Use [[section:property-management|Property Management]] to link to Property Management
- Use [[section:cash-flow-analysis|Cash Flow Analysis]] to link to Cash Flow Analysis
- Use [[section:borrowing-capacity|Borrowing Capacity]] to link to Borrowing Capacity
- Use [[section:call-logs|Call Logs]] to link to Call Logs
- Use [[section:automation|Automation]] to link to Automation
- Use [[section:reports-analytics|Reports & Analytics]] to link to Reports & Analytics
- Use [[section:data-import|Data Import]] to link to Data Import
- Use [[section:templates|Template Management]] to link to Templates
- Use [[section:sources|Data Sources]] to link to Sources
- Use [[section:integrations|Integrations]] to link to Integrations
- Use [[section:depreciation|Depreciation Comps]] to link to Depreciation
- Use [[section:settings|Settings]] to link to Settings
- Use [[section:white-label|Branding]] to link to White Label/Branding
- Use [[section:calendar|Calendar]] to link to Calendar
- Use [[section:monitoring|Monitoring]] to link to Monitoring & Logs
- Use [[section:admin|Administration]] to link to Admin features
- Use [[section:deal-pipeline|Deal Pipeline]] to link to Deal Pipeline
- Use [[section:agreements|Agency Agreements]] to link to Agreements
- Use [[section:checklists|Checklists]] to link to Checklists
- Use [[section:marketing-analytics|Marketing Analytics]] to link to Marketing Analytics
- Use [[section:reminders|Reminders Hub]] to link to Reminders
- Use [[section:report-requests|Report Requests]] to link to Report Requests
- Use [[section:client-portal|Client Portal]] to link to Client Portal
- Use [[section:ai-agent|AI Agent]] to link to AI Agent
- Use [[section:notifications|Notifications]] to link to Notifications
- Use [[section:api-usage|API Usage]] to link to API Usage & Costs

Always include relevant section links when discussing features so users can easily navigate to that part of the guide.`;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    // SECURITY: Verify authentication
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json();
    const { messages, knowledgeBase } = body;
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[user-guide-assistant] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[user-guide-assistant] Authenticated user: ${userId}`);
    
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing user guide assistant request with ${messages.length} messages`);

    // Build the full system prompt with knowledge base (brand-aware)
    const _brand = await getBrandConfig();
    const fullSystemPrompt = `${buildSystemPrompt(_brand.companyName)}

---

# KNOWLEDGE BASE (Use this to answer questions):

${knowledgeBase}`;

    const { streamLLM } = await import('../_shared/llmRouter.ts');
    const response = await streamLLM({
      agentKey: 'user_guide_assistant',
      messages: [
        { role: 'system', content: fullSystemPrompt },
        ...messages,
      ],
      extraBody: { stream_options: { include_usage: true } },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please contact support." }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: "Failed to get AI response" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Intercept stream to capture token usage from the final SSE chunk
    const trackedStream = createUsageTrackingStream(response.body!, {
      supabase,
      serviceName: 'gemini',
      modelUsed: 'gemini-3-flash-preview',
      userId: userId || undefined,
      metadata: { function: 'user-guide-assistant', messageCount: messages.length },
    });

    // Return the tracked stream
    return new Response(trackedStream, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
    });

  } catch (error) {
    console.error("User guide assistant error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
