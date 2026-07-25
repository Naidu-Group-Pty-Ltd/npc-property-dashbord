import { assert, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));

Deno.test('marketing report cron dispatch requires the internal edge secret', () => {
  assertStringIncludes(source, 'verifyRequiredCronSecret(');
  assertStringIncludes(source, "req.headers.get('x-internal-edge-secret')");
  assert(!source.includes("bearerToken === supabaseAnonKey"));
});

Deno.test('marketing report dispatch initializes its downstream anon credential', () => {
  assertStringIncludes(source, "const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!");
  assertStringIncludes(source, 'processScheduleDispatch(supabase, supabaseUrl, supabaseServiceKey, supabaseAnonKey,');
});
