-- Authenticate finance briefing cron requests before the Edge Function uses its
-- service-role client. Configure the same value in Edge Function secrets as
-- FINANCE_PORTAL_BRIEFING_CRON_SECRET and in Vault (via add_secret) as
-- finance_portal_briefing_cron_secret before applying this migration.
DO $cron$
DECLARE
  _anon text;
  _secret text;
  _url text := 'https://dduzbchuswwbefdunfct.supabase.co/functions/v1/finance-portal-briefing-runner';
BEGIN
  SELECT decrypted_secret
    INTO _anon
    FROM vault.decrypted_secrets
   WHERE name = 'supabase_anon_key'
   LIMIT 1;

  SELECT decrypted_secret
    INTO _secret
    FROM vault.decrypted_secrets
   WHERE name IN ('finance_portal_briefing_cron_secret', 'FINANCE_PORTAL_BRIEFING_CRON_SECRET')
   ORDER BY (name = 'finance_portal_briefing_cron_secret') DESC
   LIMIT 1;

  IF COALESCE(length(btrim(_anon)), 0) < 16 THEN
    RAISE EXCEPTION 'supabase_anon_key must be configured in Vault';
  ELSIF COALESCE(length(btrim(_secret)), 0) < 16 THEN
    RAISE EXCEPTION 'finance_portal_briefing_cron_secret must be configured in Vault with at least 16 characters';
  END IF;

  PERFORM cron.unschedule(jobid)
    FROM cron.job
   WHERE jobname IN ('finance-portal-morning-briefing', 'finance-portal-eod-wrap');

  PERFORM cron.schedule(
    'finance-portal-morning-briefing',
    '0 20 * * *',
    format(
      $job$select net.http_post(url:=%L, headers:=%L::jsonb, body:=%L::jsonb) as request_id;$job$,
      _url,
      jsonb_build_object('Content-Type', 'application/json', 'apikey', _anon, 'x-cron-secret', _secret)::text,
      '{"mode":"morning"}'
    )
  );

  PERFORM cron.schedule(
    'finance-portal-eod-wrap',
    '0 6 * * *',
    format(
      $job$select net.http_post(url:=%L, headers:=%L::jsonb, body:=%L::jsonb) as request_id;$job$,
      _url,
      jsonb_build_object('Content-Type', 'application/json', 'apikey', _anon, 'x-cron-secret', _secret)::text,
      '{"mode":"eod"}'
    )
  );
END
$cron$;
