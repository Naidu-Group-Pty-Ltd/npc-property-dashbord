ALTER TABLE public.token_balance_cache
  ADD COLUMN IF NOT EXISTS plan_slug TEXT;

COMMENT ON COLUMN public.token_balance_cache.plan_slug IS
  'Mission Control billing plan slug (launch/growth/scale). Drives plan-tier feature gating; NULL means unknown, which gates open.';

NOTIFY pgrst, 'reload schema';