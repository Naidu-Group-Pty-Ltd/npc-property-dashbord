import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import {
  invokeSolicitorFunction,
  type SolicitorPortalUser,
} from '@/lib/solicitorPortal';

interface SolicitorPortalAuthContextType {
  user: SolicitorPortalUser | null;
  loading: boolean;
  previousSeenAt: string | null;
  signIn: (email: string, password: string, turnstileToken?: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ error?: string; success?: boolean }>;
  requestPasswordReset: (email: string) => Promise<{ error?: string; success?: boolean }>;
  verifyOtp: (email: string, otp: string) => Promise<{ error?: string; success?: boolean }>;
  resetPassword: (email: string, otp: string, newPassword: string) => Promise<{ error?: string; success?: boolean }>;
  acceptTerms: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  refresh: () => Promise<void>;
  applySession: (user: SolicitorPortalUser) => void;
}

const SolicitorPortalAuthContext = createContext<SolicitorPortalAuthContextType | undefined>(undefined);

export function SolicitorPortalAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SolicitorPortalUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [previousSeenAt, setPreviousSeenAt] = useState<string | null>(null);

  const clearAuthState = useCallback(() => {
    setUser(null);
    setPreviousSeenAt(null);
  }, []);

  const checkSession = useCallback(async () => {
    const { data, error } = await invokeSolicitorFunction('solicitor-portal-verify');
    if (error || !data?.valid) {
      clearAuthState();
    } else {
      setUser(data.user);
      setPreviousSeenAt(data.previous_seen_at ?? null);
    }
    setLoading(false);
  }, [clearAuthState]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const signIn = useCallback(async (email: string, password: string, turnstileToken?: string) => {
    const { data, error } = await invokeSolicitorFunction('solicitor-portal-login', {
      email,
      password,
      turnstile_token: turnstileToken,
    });

    if (error || !data?.success) {
      return { error: (data as any)?.error || error?.message || 'Login failed' };
    }

    setUser(data.user);
    return {};
  }, []);

  const signOut = useCallback(async () => {
    try {
      await invokeSolicitorFunction('solicitor-portal-logout');
    } catch {
      /* best effort — always clear locally */
    }
    clearAuthState();
  }, [clearAuthState]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const { data, error } = await invokeSolicitorFunction('solicitor-portal-change-password', {
      current_password: currentPassword,
      new_password: newPassword,
    });
    if (error || !data?.success) {
      return { error: (data as any)?.error || error?.message || 'Failed to change password' };
    }
    setUser((prev) => (prev ? { ...prev, must_change_password: false } : prev));
    return { success: true };
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { data, error } = await invokeSolicitorFunction('solicitor-portal-forgot-password', { email });
    if (error) return { error: error.message };
    return { success: !!data?.success };
  }, []);

  const verifyOtp = useCallback(async (email: string, otp: string) => {
    const { data, error } = await invokeSolicitorFunction('solicitor-portal-reset-password', {
      action: 'verify_otp',
      email,
      otp,
    });
    if (error || !data?.success) return { error: (data as any)?.error || error?.message || 'Invalid code' };
    return { success: true };
  }, []);

  const resetPassword = useCallback(async (email: string, otp: string, newPassword: string) => {
    const { data, error } = await invokeSolicitorFunction('solicitor-portal-reset-password', {
      action: 'reset_password',
      email,
      otp,
      new_password: newPassword,
    });
    if (error || !data?.success) return { error: (data as any)?.error || error?.message || 'Failed to reset password' };
    return { success: true };
  }, []);

  const acceptTerms = useCallback(async () => {
    await invokeSolicitorFunction('solicitor-portal-verify', { action: 'accept_terms' });
    setUser((prev) => (prev ? { ...prev, has_accepted_terms: true } : prev));
  }, []);

  const completeOnboarding = useCallback(async () => {
    await invokeSolicitorFunction('solicitor-portal-verify', { action: 'complete_onboarding' });
    setUser((prev) => (prev ? { ...prev, has_completed_onboarding: true } : prev));
  }, []);

  const applySession = useCallback((nextUser: SolicitorPortalUser) => {
    setUser(nextUser);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    await checkSession();
  }, [checkSession]);

  return (
    <SolicitorPortalAuthContext.Provider
      value={{
        user,
        loading,
        previousSeenAt,
        signIn,
        signOut,
        changePassword,
        requestPasswordReset,
        verifyOtp,
        resetPassword,
        acceptTerms,
        completeOnboarding,
        refresh,
        applySession,
      }}
    >
      {children}
    </SolicitorPortalAuthContext.Provider>
  );
}

export function useSolicitorPortalAuth() {
  const context = useContext(SolicitorPortalAuthContext);
  if (context === undefined) {
    throw new Error('useSolicitorPortalAuth must be used within a SolicitorPortalAuthProvider');
  }
  return context;
}
