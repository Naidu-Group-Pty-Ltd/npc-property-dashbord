CREATE TABLE IF NOT EXISTS public.internal_message_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'direct' CHECK (kind IN ('direct','broadcast')),
  title text,
  created_by uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  direct_key text UNIQUE,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_thread_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.internal_message_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.custom_users(id) ON DELETE CASCADE,
  last_read_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.internal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.internal_message_threads(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.custom_users(id) ON DELETE SET NULL,
  body text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_thread_participants_user ON public.internal_thread_participants(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_internal_messages_thread_created ON public.internal_messages(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_internal_threads_last_message ON public.internal_message_threads(last_message_at DESC);

GRANT ALL ON public.internal_message_threads TO service_role;
GRANT ALL ON public.internal_thread_participants TO service_role;
GRANT ALL ON public.internal_messages TO service_role;

ALTER TABLE public.internal_message_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_thread_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "internal_threads_service_role" ON public.internal_message_threads;
CREATE POLICY "internal_threads_service_role" ON public.internal_message_threads FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "internal_participants_service_role" ON public.internal_thread_participants;
CREATE POLICY "internal_participants_service_role" ON public.internal_thread_participants FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "internal_messages_service_role" ON public.internal_messages;
CREATE POLICY "internal_messages_service_role" ON public.internal_messages FOR ALL TO service_role USING (true) WITH CHECK (true);