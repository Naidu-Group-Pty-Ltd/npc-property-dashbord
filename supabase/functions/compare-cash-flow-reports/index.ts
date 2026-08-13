import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  const startTime = Date.now();

  try {
    const body = await req.json();
    const { 
      reportIds, 
      projectionData,
      investorProfile = 'balanced',
      timeHorizon = '10 years',
    } = body;

    // SECURITY: Verify authentication
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[compare-cash-flow-reports] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    // Cash Flow Comparisons is a Growth/Scale capability — enforced server-side.
    const entitlement = await requireWorkspaceCapability(supabase, { userId, authMethod }, 'cashflow-comparisons');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);
    console.log('[compare-cash-flow-reports] Authenticated user:', userId);

    if (!reportIds || !Array.isArray(reportIds) || reportIds.length < 2 || reportIds.length > 5) {
      return new Response(
        JSON.stringify({ error: 'Please provide 2-5 report IDs for comparison' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch all investment reports
    const { data: reports, error: fetchError } = await supabase
      .from('investment_reports')
      .select('id, property_address, financial_calculations, manual_overrides, investment_score')
      .in('id', reportIds);

    if (fetchError) {
      console.error('Error fetching reports:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch investment reports' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!reports || reports.length !== reportIds.length) {
      return new Response(
        JSON.stringify({ error: 'Some reports could not be found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Comparing cash flow projections for ${reports.length} properties...`);

    // Structure data for AI analysis
    const propertiesData = reports.map((report, index) => {
      const fc = report.financial_calculations || {};
      const mo = report.manual_overrides || {};
      const score = report.investment_score || {};
      const projection = projectionData?.[report.id] || {};

      return {
        propertyNumber: index + 1,
        address: report.property_address,
        
        // Financial Metrics
        purchasePrice: mo.purchasePrice || fc.purchasePrice || 0,
        weeklyRent: mo.weeklyRent || fc.weeklyRent || 0,
        // IMPORTANT: Do not default to 5% - use researched/overridden value or null
        capitalGrowthRate: mo.capitalGrowth || fc.capitalGrowth || fc.assumptions?.capitalGrowth || null,
        interestRate: mo.interestRate || fc.interestRate || 5.5,
        loanToValueRatio: mo.loanToValueRatio || fc.loanToValueRatio || 80,
        
        // Investment Score
        overallScore: score.totalScore || null,
        letterGrade: score.letterGrade || null,
        
        // 10-Year Projections (from frontend calculations)
        projections: {
          year1: projection.year1 || {},
          year5: projection.year5 || {},
          year10: projection.year10 || {},
        },
        
        // Summary metrics
        metrics: projection.metrics || {},
      };
    });

    const prompt = `You are an expert Australian property investment analyst specializing in 10-year cash flow analysis. Compare the following ${reports.length} investment properties.

**INVESTOR PROFILE:** ${investorProfile}
**TIME HORIZON:** ${timeHorizon}

**PROPERTIES TO COMPARE:**
${JSON.stringify(propertiesData, null, 2)}

Provide a comprehensive comparative cash flow analysis including:

1. EXECUTIVE SUMMARY (2-3 paragraphs)
   - Overview of which properties perform best over the 10-year horizon
   - Key differentiators in cash flow performance
   - Quick verdict on which property is best for each investor type

2. CASH FLOW TRAJECTORY ANALYSIS
   - Which property reaches positive cash flow fastest?
   - Which property has the strongest cash flow growth trajectory?
   - Identify any properties with concerning cash flow patterns

3. CAPITAL GROWTH COMPARISON
   - Which property shows the strongest equity accumulation?
   - Compare Year 10 property values and equity positions
   - Identify the best wealth-building property

4. YIELD & RETURN ANALYSIS
   - Compare gross and net yields across properties
   - Which offers best ROI over 10 years?
   - Annualized returns comparison

5. RISK ASSESSMENT
   - Which property has the most stable cash flow projections?
   - Identify properties with higher volatility or risk factors
   - Break-even analysis and safety margins

6. INVESTOR PROFILE RECOMMENDATIONS
   For each investor type, recommend the best property:
   - Growth Focused (capital appreciation priority)
   - Income Focused (cash flow priority)
   - Balanced (optimal mix)
   - Risk-Averse (stability priority)

7. FINAL RANKINGS & RECOMMENDATION
   - Rank all properties from best to worst for the ${investorProfile} investor profile
   - Provide specific reasoning for each ranking
   - Identify any properties to avoid and why

Format your response as valid JSON with this structure:
{
  "executiveSummary": "string",
  "cashFlowTrajectory": {
    "fastestPositiveCashFlow": { "propertyNumber": number, "timeframe": "string", "reason": "string" },
    "strongestGrowth": { "propertyNumber": number, "reason": "string" },
    "concerns": [{ "propertyNumber": number, "concern": "string" }]
  },
  "capitalGrowth": {
    "strongestEquity": { "propertyNumber": number, "year10Equity": "string", "reason": "string" },
    "wealthBuilder": { "propertyNumber": number, "reason": "string" },
    "year10Values": [{ "propertyNumber": number, "value": "string", "equity": "string" }]
  },
  "yieldAnalysis": {
    "bestGrossYield": { "propertyNumber": number, "value": "string" },
    "bestNetYield": { "propertyNumber": number, "value": "string" },
    "best10YearROI": { "propertyNumber": number, "value": "string", "reason": "string" }
  },
  "riskAssessment": {
    "mostStable": { "propertyNumber": number, "reason": "string" },
    "highestRisk": { "propertyNumber": number, "risks": ["string"] },
    "breakEvenAnalysis": [{ "propertyNumber": number, "breakEvenYear": "string", "safetyMargin": "string" }]
  },
  "investorRecommendations": {
    "growthFocused": { "propertyNumber": number, "reason": "string" },
    "incomeFocused": { "propertyNumber": number, "reason": "string" },
    "balanced": { "propertyNumber": number, "reason": "string" },
    "riskAverse": { "propertyNumber": number, "reason": "string" }
  },
  "finalRankings": [
    {
      "rank": number,
      "propertyNumber": number,
      "address": "string",
      "score": number,
      "strengths": ["string"],
      "weaknesses": ["string"],
      "verdict": "string"
    }
  ],
  "overallRecommendation": {
    "bestProperty": { "propertyNumber": number, "reason": "string" },
    "avoid": [{ "propertyNumber": number, "reason": "string" }],
    "alternativeScenarios": [{ "scenario": "string", "recommendation": number }]
  }
}`;

    // Call Lovable AI
    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    console.log('Calling LLM router for cash flow comparison analysis...');
    const aiResponse = await callLLMRaw({
      agentKey: 'cash_flow_comparison',
      messages: [
        {
          role: 'system',
          content: (await (await import('../_shared/engine-prompts.ts')).resolvePrompt('comparison.cash_flow_system')).text,
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      maxTokens: 4000,
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Lovable AI error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded', details: 'Too many requests. Please wait a moment and try again.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Payment required', details: 'AI credits exhausted. Please add credits to your Lovable workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'AI analysis failed', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const analysisText = aiData.choices[0].message.content;

    // Parse JSON response
    let analysis;
    try {
      let jsonString = analysisText;
      const jsonMatch = analysisText.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
      if (jsonMatch) {
        jsonString = jsonMatch[1];
      }
      analysis = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
      console.error('Raw response:', analysisText);
      return new Response(
        JSON.stringify({ error: 'Failed to parse AI analysis', rawResponse: analysisText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const processingTime = Date.now() - startTime;
    console.log(`Cash flow comparison analysis completed in ${processingTime}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        propertyCount: reports.length,
        investorProfile,
        analysis,
        processingTimeMs: processingTime
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in compare-cash-flow-reports:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'compare-cash-flow-reports'), error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
