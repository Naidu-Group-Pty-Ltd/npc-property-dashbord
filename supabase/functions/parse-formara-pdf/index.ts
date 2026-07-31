import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const corsHeaders = createCorsHeaders();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const authResult = await verifyAuth(supabase, req.headers, body);
    if (authResult.error) {
      return createUnauthorizedResponse(authResult.error);
    }

    const { extractedText } = body;

    if (!extractedText || typeof extractedText !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'extractedText is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'OpenAI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Truncate to ~60k chars to stay within token limits
    const truncatedText = extractedText.slice(0, 60000);

    console.log(`[parse-formara-pdf] Processing ${truncatedText.length} chars of PDF text`);

    const systemPrompt = `You are a data extraction specialist. You will receive text extracted from a Formara financial form PDF. 
Extract ALL structured client data and return it as a JSON object matching the schema below EXACTLY.

IMPORTANT RULES:
- Return ONLY valid JSON, no markdown, no explanation
- Use null for missing values, 0 for missing numbers
- Dates should be in YYYY-MM-DD format
- Currency values should be plain numbers (no $ or commas)
- Property types must be "owner_occupied" or "investment"
- Asset types must be "vehicle", "savings", "superfund", or "other"
- Liability types must be "mortgage", "credit_card", "personal_loan", "vehicle_loan", "student_loan", or "other"
- Contact types must be "primary" or "secondary"
- Employment types can be "full_time", "part_time", "casual", "self_employed", "contract"
- If weekly rental income is given, also compute monthly (weekly * 52 / 12)
- Extract ALL properties, assets, liabilities, etc. found in the document

JSON Schema:
{
  "primaryContact": { "firstName": string|null, "middleName": string|null, "surname": string|null, "mobile": string|null, "email": string|null, "gender": string|null, "dob": string|null },
  "secondaryContact": { "firstName": string|null, "middleName": string|null, "surname": string|null, "mobile": string|null, "email": string|null, "gender": string|null, "dob": string|null } | null,
  "additionalContacts": [{ "relationship": string, "firstName": string|null, "middleName": string|null, "surname": string|null, "mobile": string|null, "email": string|null, "gender": string|null, "dob": string|null, "displayOrder": number }],
  "address": { "currentAddress": string|null, "country": string|null, "livingSituation": string|null } | null,
  "residentialStatus": string | null,
  "familyRelations": { "maritalStatus": string|null, "dependentsCount": number } | null,
  "employment": [{ "contactType": "primary"|"secondary", "employerName": string|null, "employmentType": string|null, "occupationRole": string|null, "startDate": string|null }],
  "income": [{ "contactType": "primary"|"secondary", "grossSalary": number, "salaryFrequency": string, "bonus": number, "allowance": number, "commission": number, "overtimeEssential": number, "overtimeNonEssential": number, "otherTaxableIncome": number }],
  "properties": [{ "propertyType": "owner_occupied"|"investment", "address": string|null, "value": number, "loanRemaining": number, "interestRate": number, "ownershipPercentage": number, "monthlyInterestRepayment": number, "monthlyBodyCorporate": number, "monthlyCouncilRates": number, "monthlyWaterRates": number, "monthlyRepairsMaintenance": number, "monthlyPropertyManagement": number, "monthlyLandlordInsurance": number, "monthlyBuildingInsurance": number, "monthlyRentalIncome": number, "weeklyRentalIncome": number, "totalMonthlyExpenditure": number, "netMonthlyCashflow": number }],
  "assets": [{ "assetType": "vehicle"|"savings"|"superfund"|"other", "vehicleType": string|null, "makeModel": string|null, "institutionName": string|null, "description": string|null, "value": number }],
  "liabilities": [{ "liabilityType": "mortgage"|"credit_card"|"personal_loan"|"vehicle_loan"|"student_loan"|"other", "providerName": string|null, "currentBalance": number, "creditLimit": number|null, "interestRate": number|null, "monthlyRepayment": number, "repaymentType": string|null }],
  "portfolioSummary": { "totalPortfolioValue": number, "totalDebt": number, "totalMonthlyExpenditure": number, "totalMonthlyIncome": number, "totalMonthlyRentalIncome": number, "netMonthlyCashFlow": number } | null
}`;

    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    const response = await callLLMRaw({
      agentKey: 'pdf_formara_extraction',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Extract all client data from this Formara form PDF text:\n\n${truncatedText}` },
      ],
      temperature: 0.1,
      responseFormat: { type: 'json_object' },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[parse-formara-pdf] OpenAI error: ${response.status}`, errText);
      return new Response(
        JSON.stringify({ success: false, error: `AI parsing failed: ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(
        JSON.stringify({ success: false, error: 'No response from AI' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const parsedData = JSON.parse(content);
    console.log(`[parse-formara-pdf] Successfully parsed PDF data`);

    return new Response(
      JSON.stringify({ success: true, data: parsedData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[parse-formara-pdf] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
