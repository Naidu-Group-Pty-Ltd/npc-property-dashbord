-- Isolated-cluster stand-ins for what production already holds, so that
-- 20261204000000_property_condition_records.sql can be applied VERBATIM.
--
-- Everything here exists in the production schema before that migration runs;
-- nothing here is part of the migration under test. Where a definition
-- matters to the probes it is copied from the migration that created it:
-- `app_role`, `user_roles` and `has_role` are verbatim from
-- 20251224033443_6d554b65-5100-4416-925a-56e18ea8368a.sql. `auth.uid()` is a
-- STUB — production's reads the request JWT; this one reads the `app.test_uid`
-- setting so a probe can act as a chosen user. The FK targets
-- (`custom_users`, `investment_reports`, `client_files`) are uuid-keyed stubs:
-- the probes exercise the linkage, not those tables' own shapes.

-- The role Supabase authenticates browser sessions as, and per-probe members
-- of it. A policy written `TO authenticated` applies to members by
-- inheritance, which is how the probes act as three different people.
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE test_admin NOLOGIN IN ROLE authenticated;
CREATE ROLE test_recorder NOLOGIN IN ROLE authenticated;
CREATE ROLE test_user NOLOGIN IN ROLE authenticated;

GRANT USAGE ON SCHEMA public TO authenticated;
-- Supabase grants table privileges to `authenticated` by default privilege;
-- RLS is the deny layer. Mirror that so the probes measure the policies.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;

-- auth.uid() stub: production resolves the JWT subject; the harness resolves
-- a session setting the probe sets per acting user.
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.test_uid', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

-- Verbatim from 20251224033443 (enum, table shape, function), minus the
-- columns and policies the probes never touch.
CREATE TYPE public.app_role AS ENUM ('superadmin', 'admin', 'user');

CREATE TABLE public.custom_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.custom_users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

-- FK targets. uuid-keyed stubs — the probes exercise the references.
CREATE TABLE public.investment_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
CREATE TABLE public.client_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- The people the probes act as: an admin, a recorder with no admin role, and
-- a plain user with no role at all.
INSERT INTO public.custom_users (id) VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000001', 'admin'),
  ('00000000-0000-4000-8000-000000000002', 'user'),
  ('00000000-0000-4000-8000-000000000003', 'user');
