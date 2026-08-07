import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0'
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/auth.ts'
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts'
import { meteredFetch } from "../_shared/meteredFetch.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
}

interface StampDutyBracket {
  threshold: number
  base: number
  rate: number
}

interface StateConfig {
  state: string
  url: string
  scrapePrompt: string
}

const STATE_CONFIGS: StateConfig[] = [
  {
    state: 'NSW',
    url: 'https://www.revenue.nsw.gov.au/taxes-duties-levies-royalties/transfer-duty',
    scrapePrompt: 'Extract the stamp duty brackets for property transfer duty in NSW. Include threshold amounts, base amounts, and rates for each bracket.'
  },
  {
    state: 'VIC',
    url: 'https://www.sro.vic.gov.au/duty',
    scrapePrompt: 'Extract the stamp duty brackets for property transfer duty in Victoria. Include threshold amounts, base amounts, and rates for each bracket.'
  },
  {
    state: 'QLD',
    url: 'https://www.qro.qld.gov.au/duties/transfer-duty/',
    scrapePrompt: 'Extract the stamp duty brackets for property transfer duty in Queensland. Include threshold amounts, base amounts, and rates for each bracket.'
  },
  {
    state: 'WA',
    url: 'https://www.wa.gov.au/service/financial-services/taxation/transfer-duty',
    scrapePrompt: 'Extract the stamp duty brackets for property transfer duty in Western Australia. Include threshold amounts, base amounts, and rates for each bracket.'
  },
  {
    state: 'SA',
    url: 'https://www.revenuesa.sa.gov.au/stampduty/property',
    scrapePrompt: 'Extract the stamp duty brackets for property transfer duty in South Australia. Include threshold amounts, base amounts, and rates for each bracket.'
  },
  {
    state: 'TAS',
    url: 'https://www.sro.tas.gov.au/property-transfer-duty',
    scrapePrompt: 'Extract the stamp duty brackets for property transfer duty in Tasmania. Include threshold amounts, base amounts, and rates for each bracket.'
  },
  {
    state: 'NT',
    url: 'https://nt.gov.au/property/land-title-unit/property-transactions/stamp-duty',
    scrapePrompt: 'Extract the stamp duty brackets for property transfer duty in Northern Territory. Include threshold amounts, base amounts, and rates for each bracket.'
  },
  {
    state: 'ACT',
    url: 'https://www.revenue.act.gov.au/duties/conveyance-duty',
    scrapePrompt: 'Extract the stamp duty brackets for property conveyance duty in ACT. Include threshold amounts, base amounts, and rates for each bracket.'
  }
]

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!firecrawlApiKey) {
      throw new Error('FIRECRAWL_API_KEY not configured')
    }
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing')
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // SECURITY: Verify authentication and admin role
    const body = await req.json();
    const { states } = body;
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[update-stamp-duty-rates] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    
    // Check if user has admin role (rate updates should be admin-only)
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['superadmin', 'admin'])
      .single();

    if (roleError || !roleData) {
      console.warn(`User ${userId} attempted to update stamp duty rates without admin role.`);
      return createForbiddenResponse('Forbidden: Admin access required', corsHeaders);
    }
    console.log(`[update-stamp-duty-rates] Admin user ${userId} updating stamp duty rates`);
    const statesToUpdate = states || STATE_CONFIGS.map(c => c.state)

    console.log(`Updating stamp duty rates for states: ${statesToUpdate.join(', ')}`)

    // Process all states in parallel for faster execution
    const scrapePromises = STATE_CONFIGS
      .filter(c => statesToUpdate.includes(c.state))
      .map(async (stateConfig) => {
        console.log(`Scraping ${stateConfig.state} from ${stateConfig.url}`)

        try {
          // Use Firecrawl API directly to scrape the government website
          const scrapeResponse = await meteredFetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${firecrawlApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: stateConfig.url,
              formats: ['markdown'],
            })
          })

          if (!scrapeResponse.ok) {
            const errorText = await scrapeResponse.text()
            throw new Error(`Firecrawl API error (${scrapeResponse.status}): ${errorText}`)
          }

          const scrapeResult = await scrapeResponse.json()
          
          if (!scrapeResult.success) {
            throw new Error(`Failed to scrape ${stateConfig.state}: ${scrapeResult.error || 'Unknown error'}`)
          }

          const markdown = scrapeResult.data?.markdown || ''
          console.log(`Scraped content for ${stateConfig.state}, length: ${markdown.length}`)

          // Parse the markdown content to extract stamp duty brackets
          const brackets = parseStampDutyBrackets(markdown, stateConfig.state)

          if (brackets.length === 0) {
            console.warn(`No brackets found for ${stateConfig.state}, keeping fallback data`)
            return {
              state: stateConfig.state,
              success: false,
              error: 'Could not parse brackets from scraped content',
              dataQuality: 'fallback'
            }
          }

          // Update the cache with live data
          const { error: updateError } = await supabase
            .from('stamp_duty_rates_cache')
            .upsert({
              state: stateConfig.state,
              brackets: brackets,
              data_quality: 'live',
              fetched_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
              source_url: stateConfig.url,
              updated_at: new Date().toISOString()
            }, {
              onConflict: 'state'
            })

          if (updateError) {
            throw updateError
          }

          console.log(`✅ Successfully updated ${stateConfig.state} with ${brackets.length} brackets`)
          return {
            state: stateConfig.state,
            success: true,
            brackets: brackets.length,
            dataQuality: 'live'
          }

        } catch (error) {
          console.error(`Error processing ${stateConfig.state}:`, error)
          return {
            state: stateConfig.state,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            dataQuality: 'fallback'
          }
        }
      })

    // Wait for all scraping operations to complete
    const results = await Promise.all(scrapePromises)

    return new Response(
      JSON.stringify({
        success: true,
        results,
        timestamp: new Date().toISOString()
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    )

  } catch (error) {
    console.error('Error in update-stamp-duty-rates:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    )
  }
})

function parseStampDutyBrackets(markdown: string, state: string): StampDutyBracket[] {
  const brackets: StampDutyBracket[] = []
  
  // This is a simplified parser that looks for common patterns in stamp duty tables
  // In production, you'd want to use more sophisticated parsing or AI-based extraction
  
  // Look for table-like structures with amounts and percentages
  const lines = markdown.split('\n')
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase()
    
    // Skip non-relevant lines
    if (!line.includes('$') && !line.includes('%')) continue
    
    // Try to extract numbers from the line
    const amounts = line.match(/\$[\d,]+/g)?.map(a => parseFloat(a.replace(/[$,]/g, ''))) || []
    const percentages = line.match(/\d+\.?\d*%/g)?.map(p => parseFloat(p.replace('%', '')) / 100) || []
    
    if (amounts.length > 0 && percentages.length > 0) {
      // Found a potential bracket
      const threshold = amounts[0] || 0
      const rate = percentages[0] || 0
      
      // Calculate base amount (this is simplified, actual calculation would be more complex)
      let base = 0
      if (brackets.length > 0) {
        const prevBracket = brackets[brackets.length - 1]
        base = prevBracket.base + (threshold - prevBracket.threshold) * prevBracket.rate
      }
      
      brackets.push({ threshold, base, rate })
    }
  }
  
  // Sort brackets by threshold
  brackets.sort((a, b) => a.threshold - b.threshold)
  
  // If we couldn't parse any brackets, return empty array to keep fallback
  return brackets.length >= 2 ? brackets : []
}
