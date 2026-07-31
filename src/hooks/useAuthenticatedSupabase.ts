import { useMemo } from 'react';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from './useAuth';

const SUPABASE_URL = "https://dduzbchuswwbefdunfct.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkdXpiY2h1c3d3YmVmZHVuZmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU0NDM4NzksImV4cCI6MjA3MTAxOTg3OX0.eSYU6fxIc3tBQuGLsdBRff0alBMkNfvv7OpW0efNjxk";

let cachedToken: string | null | undefined;
let cachedClient: SupabaseClient<Database> | null = null;

function clientForToken(accessToken: string | null): SupabaseClient<Database> {
  if (cachedClient && cachedToken === accessToken) return cachedClient;

  cachedToken = accessToken;
  cachedClient = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    ...(accessToken
      ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
      : {}),
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'npc-custom-auth-query-client',
    },
  });
  return cachedClient;
}

/**
 * Hook that provides an authenticated Supabase client using the custom JWT.
 * This client will be recognized as 'authenticated' role by Supabase RLS.
 * 
 * Usage:
 * ```tsx
 * const { supabase, isAuthenticated } = useAuthenticatedSupabase();
 * 
 * // Use supabase client for queries
 * const { data } = await supabase.from('table').select('*');
 * ```
 */
export function useAuthenticatedSupabase() {
  const { accessToken, user } = useAuth();

  const supabase = useMemo<SupabaseClient<Database>>(() => {
    return clientForToken(accessToken);
  }, [accessToken]);

  return {
    supabase,
    isAuthenticated: !!accessToken && !!user,
    userId: user?.id || null,
  };
}

/**
 * Get an authenticated Supabase client outside of React components.
 * WP-11B/C — reads the short-lived access-token JWT from tab-scoped
 * `sessionStorage` only; the legacy `localStorage` fallback has been removed
 * so the token no longer survives tab close or leak into durable storage.
 *
 * Note: Prefer useAuthenticatedSupabase hook inside React components.
 */
export function getAuthenticatedSupabaseClient(): SupabaseClient<Database> {
  let accessToken: string | null = null;
  try { accessToken = sessionStorage.getItem('supabase_access_token'); } catch { /* ignore */ }

  return clientForToken(accessToken);
}
