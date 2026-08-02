import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthenticatedSupabase } from '@/hooks/useAuthenticatedSupabase';
import type { Json } from '@/integrations/supabase/types';
import {
  BRAND_THEME_STORAGE_KEY,
  defaultBrandConfig,
  defaultEmailSignature,
  defaultBrandLogoConfig,
  defaultBrandThemeConfig,
} from './brand-defaults';
import { getBrandAssetSrc } from './brand-assets';
import { applyBrandTokenMap, resolveBrandFontVars, resolveBrandTokens } from './token-resolver';
import type { BrandContextValue, BrandLogoConfig, BrandThemeConfig, EmailSignatureSettings, ThemeMode, WhiteLabelSettings } from './brand-types';

const BrandContext = createContext<BrandContextValue | undefined>(undefined);

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialThemeMode(defaultTheme: ThemeMode): ThemeMode {
  if (typeof window === 'undefined') return defaultTheme;
  const storedTheme = localStorage.getItem(BRAND_THEME_STORAGE_KEY) as ThemeMode | null;
  return storedTheme || defaultTheme;
}

function mergeThemeConfig(themeConfig: Partial<BrandThemeConfig> | null | undefined): BrandThemeConfig {
  return {
    ...defaultBrandThemeConfig,
    ...themeConfig,
    emailSignature: {
      ...defaultEmailSignature,
      ...(themeConfig?.emailSignature || {}),
    },
  };
}

function mergeLogoConfig(logoConfig: Partial<BrandLogoConfig> | null | undefined): BrandLogoConfig {
  return {
    ...defaultBrandLogoConfig,
    ...logoConfig,
  };
}

function buildStructuredConfig(settings: WhiteLabelSettings) {
  const themeConfig: BrandThemeConfig = mergeThemeConfig({
    primaryColor: settings.primaryColor,
    accentColor: settings.accentColor,
    brandColor: settings.brandColor,
    fontFamily: settings.fontFamily,
    headingFontFamily: settings.headingFontFamily,
    fontScale: settings.fontScale,
    darkModeDefault: settings.darkModeDefault,
    emailSignature: settings.emailSignature,
  });

  const logoConfig: BrandLogoConfig = mergeLogoConfig({
    auth: settings.authLogo,
    sidebar: settings.sidebarLogo,
    sidebarIcon: settings.sidebarIcon,
    favicon: settings.favicon,
    report: settings.reportLogo,
    reportMono: settings.reportMonoLogo,
  });

  return {
    themeConfig,
    logoConfig,
    themeVersion: settings.themeVersion ?? 1,
  };
}

function mapDatabaseSettings(data: Record<string, unknown>): WhiteLabelSettings {
  const rawThemeConfig = (data.theme_config as Partial<BrandThemeConfig> | null | undefined) ?? null;
  const rawLogoConfig = (data.logo_config as Partial<BrandLogoConfig> | null | undefined) ?? null;

  // Backward compatibility: prefer raw structured values, otherwise fall back to legacy
  // flat columns. This guarantees presets saved before theme_version=2 keep rendering
  // exactly as they did before the JSONB columns existed.
  const rawSig = (rawThemeConfig?.emailSignature ?? {}) as Partial<EmailSignatureSettings>;
  const emailSignature: EmailSignatureSettings = {
    banner: rawSig.banner ?? (data.email_signature_banner as string) ?? null,
    name: rawSig.name ?? (data.email_signature_name as string) ?? defaultEmailSignature.name,
    title: rawSig.title ?? (data.email_signature_title as string) ?? defaultEmailSignature.title,
    phone: rawSig.phone ?? (data.email_signature_phone as string) ?? '',
    email: rawSig.email ?? (data.email_signature_email as string) ?? '',
    website: rawSig.website ?? (data.email_signature_website as string) ?? '',
    address: rawSig.address ?? (data.email_signature_address as string) ?? '',
    disclaimer: rawSig.disclaimer ?? (data.email_signature_disclaimer as string) ?? defaultEmailSignature.disclaimer,
  };

  const themeConfig: BrandThemeConfig = {
    primaryColor: rawThemeConfig?.primaryColor ?? (data.primary_color as string) ?? null,
    accentColor: rawThemeConfig?.accentColor ?? (data.accent_color as string) ?? null,
    // New brand + typography inputs live only in the theme_config JSONB (no
    // legacy columns), so read them straight from the structured config.
    brandColor: rawThemeConfig?.brandColor ?? null,
    fontFamily: rawThemeConfig?.fontFamily ?? null,
    headingFontFamily: rawThemeConfig?.headingFontFamily ?? null,
    fontScale: rawThemeConfig?.fontScale ?? null,
    darkModeDefault:
      (rawThemeConfig?.darkModeDefault as ThemeMode | undefined) ??
      (data.dark_mode_default as ThemeMode) ??
      defaultBrandThemeConfig.darkModeDefault,
    emailSignature,
  };

  const logoConfig: BrandLogoConfig = {
    auth: rawLogoConfig?.auth ?? (data.auth_logo as string) ?? null,
    sidebar: rawLogoConfig?.sidebar ?? (data.sidebar_logo as string) ?? null,
    sidebarIcon: rawLogoConfig?.sidebarIcon ?? (data.sidebar_icon as string) ?? null,
    favicon: rawLogoConfig?.favicon ?? (data.favicon as string) ?? null,
    // Report marks live only in the JSONB — there is no legacy flat column, and
    // no `theme_version` gate: they are additive, so a tenant on version 1 keeps
    // saving without being forced to upload one.
    report: rawLogoConfig?.report ?? null,
    reportMono: rawLogoConfig?.reportMono ?? null,
  };

  return {
    id: data.id as string,
    authLogo: logoConfig.auth,
    sidebarLogo: logoConfig.sidebar,
    sidebarIcon: logoConfig.sidebarIcon,
    favicon: logoConfig.favicon,
    reportLogo: logoConfig.report,
    reportMonoLogo: logoConfig.reportMono,
    companyName: (data.company_name as string) || defaultBrandConfig.companyName,
    primaryColor: themeConfig.primaryColor,
    accentColor: themeConfig.accentColor,
    brandColor: themeConfig.brandColor,
    fontFamily: themeConfig.fontFamily,
    headingFontFamily: themeConfig.headingFontFamily,
    fontScale: themeConfig.fontScale,
    darkModeDefault: themeConfig.darkModeDefault,
    emailSignature,
    themeConfig,
    logoConfig,
    themeVersion: (data.theme_version as number) || 1,
  };
}

function applyResolvedTheme(themeMode: ThemeMode, resolvedTokens: ReturnType<typeof resolveBrandTokens>) {
  const resolvedTheme = themeMode === 'system' ? getSystemTheme() : themeMode;
  document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  applyBrandTokenMap(resolvedTheme === 'dark' ? resolvedTokens.dark : resolvedTokens.light);
  return resolvedTheme;
}

export function BrandProvider({ children }: { children: React.ReactNode }) {
  // Branding is READ anonymously (login/portal pages before auth), but WRITES
  // must carry the staff JWT so the deny-by-default RLS (Phase 7) can gate
  // them to admins. Reads stay on the anon client below.
  const { supabase: authedSupabase } = useAuthenticatedSupabase();
  const [settings, setSettings] = useState<WhiteLabelSettings>(defaultBrandConfig);
  const [isLoading, setIsLoading] = useState(true);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getInitialThemeMode(defaultBrandConfig.darkModeDefault));
  const [currentTheme, setCurrentTheme] = useState<'light' | 'dark'>(() =>
    themeMode === 'system' ? getSystemTheme() : themeMode
  );

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data, error } = await supabase
          .from('whitelabel_settings')
          .select('*')
          .limit(1)
          .single();

        if (error) {
          console.error('Failed to fetch whitelabel settings:', error);
          return;
        }

        if (data) {
          const mapped = mapDatabaseSettings(data as Record<string, unknown>);
          setSettings(mapped);
          setThemeMode((prevTheme) => {
            if (typeof window === 'undefined') return mapped.darkModeDefault;
            const storedTheme = localStorage.getItem(BRAND_THEME_STORAGE_KEY) as ThemeMode | null;
            return storedTheme || prevTheme || mapped.darkModeDefault;
          });
        }
      } catch (error) {
        console.error('Failed to load whitelabel settings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const resolvedTokens = useMemo(() => resolveBrandTokens(settings), [settings]);
  const resolvedFontVars = useMemo(() => resolveBrandFontVars(settings), [settings]);

  // Typography tokens are theme-agnostic, so apply them independently of the
  // light/dark colour cascade. This makes the White-Label font selection cascade
  // to every text component (body + headings + base size).
  useEffect(() => {
    applyBrandTokenMap(resolvedFontVars);
  }, [resolvedFontVars]);

  useEffect(() => {
    const applyTheme = (nextTheme: ThemeMode) => {
      const resolvedTheme = applyResolvedTheme(nextTheme, resolvedTokens);
      setCurrentTheme(resolvedTheme);
    };

    applyTheme(themeMode);
    localStorage.setItem(BRAND_THEME_STORAGE_KEY, themeMode);

    if (themeMode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [resolvedTokens, themeMode]);

  useEffect(() => {
    const favicon = getBrandAssetSrc(settings, 'favicon');
    if (!favicon) return;

    // <link rel="icon">
    const iconLink = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
    if (iconLink) {
      iconLink.href = favicon;
    } else {
      const newLink = document.createElement('link');
      newLink.rel = 'icon';
      newLink.href = favicon;
      document.head.appendChild(newLink);
    }

    // <link rel="apple-touch-icon">
    const appleLink = document.querySelector("link[rel='apple-touch-icon']") as HTMLLinkElement | null;
    if (appleLink) {
      appleLink.href = favicon;
    } else {
      const newApple = document.createElement('link');
      newApple.rel = 'apple-touch-icon';
      newApple.href = favicon;
      document.head.appendChild(newApple);
    }
  }, [settings]);

  useEffect(() => {
    const company = settings.companyName?.trim();
    if (!company) return;

    const titleStr = `${company} Dashboard`;
    document.title = titleStr;

    const setMeta = (selector: string, attr: 'content' | 'href', value: string) => {
      const el = document.querySelector(selector) as HTMLMetaElement | HTMLLinkElement | null;
      if (el) el.setAttribute(attr, value);
    };

    const description = `${company} - Property investment management dashboard`;

    setMeta("meta[name='apple-mobile-web-app-title']", 'content', company);
    setMeta("meta[name='application-name']", 'content', company);
    setMeta("meta[name='description']", 'content', description);
    setMeta("meta[name='author']", 'content', company);
    setMeta("meta[property='og:title']", 'content', titleStr);
    setMeta("meta[property='og:description']", 'content', description);
    setMeta("meta[name='twitter:title']", 'content', company);

    const favicon = getBrandAssetSrc(settings, 'favicon');
    if (favicon) {
      setMeta("meta[property='og:image']", 'content', favicon);
      setMeta("meta[name='twitter:image']", 'content', favicon);
    }
  }, [settings]);

  const updateSettings = useCallback((newSettings: Partial<WhiteLabelSettings>) => {
    setSettings((prev) => {
      const updated: WhiteLabelSettings = {
        ...prev,
        ...newSettings,
        emailSignature: {
          ...prev.emailSignature,
          ...(newSettings.emailSignature || {}),
        },
      };
      const structured = buildStructuredConfig(updated);
      updated.themeConfig = structured.themeConfig;
      updated.logoConfig = structured.logoConfig;
      updated.themeVersion = structured.themeVersion;

      const saveToSupabase = async () => {
        try {
          const { error } = await authedSupabase
            .from('whitelabel_settings')
            .update({
              auth_logo: updated.authLogo,
              sidebar_logo: updated.sidebarLogo,
              sidebar_icon: updated.sidebarIcon,
              favicon: updated.favicon,
              company_name: updated.companyName,
              primary_color: updated.primaryColor,
              accent_color: updated.accentColor,
              dark_mode_default: updated.darkModeDefault,
              email_signature_banner: updated.emailSignature.banner,
              email_signature_name: updated.emailSignature.name,
              email_signature_title: updated.emailSignature.title,
              email_signature_phone: updated.emailSignature.phone,
              email_signature_email: updated.emailSignature.email,
              email_signature_website: updated.emailSignature.website,
              email_signature_address: updated.emailSignature.address,
              email_signature_disclaimer: updated.emailSignature.disclaimer,
              theme_config: structured.themeConfig as unknown as Json,
              logo_config: structured.logoConfig as unknown as Json,
              theme_version: structured.themeVersion,
            })
            .eq('id', updated.id || '');

          if (error) {
            console.error('Failed to save whitelabel settings:', error);
          }
        } catch (error) {
          console.error('Failed to save whitelabel settings:', error);
        }
      };

      if (newSettings.darkModeDefault) {
        setThemeMode(newSettings.darkModeDefault);
      }

      void saveToSupabase();
      return updated;
    });
  }, []);

  const value = useMemo<BrandContextValue>(
    () => ({
      settings,
      updateSettings,
      isLoading,
      currentTheme,
      themeMode,
      theme: themeMode,
      isDark: currentTheme === 'dark',
      setThemeMode,
      setTheme: setThemeMode,
      resolvedTokens,
    }),
    [currentTheme, isLoading, resolvedTokens, settings, themeMode, updateSettings]
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  const context = useContext(BrandContext);
  if (!context) {
    throw new Error('useBrand must be used within a BrandProvider');
  }
  return context;
}