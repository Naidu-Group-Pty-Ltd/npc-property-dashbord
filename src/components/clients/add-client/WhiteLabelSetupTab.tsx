import { useEffect } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Building2, FileCog, Info, Sparkles } from 'lucide-react';
import { useBrand } from '@/branding/useBrand';
import type { AdvancedClientCreationPayload } from '@/lib/client-fact-find/types';
import { FormField } from './FormField';
import { AdvancedSectionHeader, premiumSectionClass } from './AdvancedSectionHeader';

const previewNames = ['branding.organisationName', 'branding.tradingName', 'branding.tagline', 'branding.documentTitle', 'branding.confidentialityLabel', 'branding.logoReference', 'branding.version'] as const;

export function WhiteLabelSetupTab() {
  const { settings } = useBrand();
  const { control, setValue, getValues } = useFormContext<AdvancedClientCreationPayload>();
  const [organisationName, tradingName, tagline, documentTitle, confidentialityLabel, logoReference, version] = useWatch({ control, name: previewNames });
  useEffect(() => {
    if (getValues('branding.organisationName')) return;
    setValue('branding.organisationName', settings.companyName || '');
    setValue('branding.primaryColour', settings.primaryColor || '#' + '12345B');
    setValue('branding.accentColour', settings.accentColor || '#' + 'C9A227');
    setValue('branding.email', settings.emailSignature.email || '');
    setValue('branding.phone', settings.emailSignature.phone || '');
    setValue('branding.website', settings.emailSignature.website || '');
    setValue('branding.businessAddress', settings.emailSignature.address || '');
    setValue('branding.logoReference', settings.sidebarLogo || settings.authLogo || '');
    setValue('branding.sourceWhiteLabelSettingId', settings.id || null);
  }, [getValues, setValue, settings]);

  return <div className="space-y-5" data-testid="advanced-branding-tab">
    <div className="flex gap-3 rounded-xl border border-border bg-muted/30 p-4 text-sm text-muted-foreground"><Info className="mt-0.5 h-4 w-4 shrink-0" /><p>These values are a local preview only. They are not saved and do not update organisation-wide white-label settings.</p></div>
    <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <div className="min-w-0 space-y-6">
        <section className={premiumSectionClass}><AdvancedSectionHeader icon={Building2} title="Brand Information" description="Client-facing organisation identity and contact details." /><div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <FormField name="branding.organisationName" label="Organisation Name" /><FormField name="branding.tradingName" label="Trading Name / Division" /><FormField name="branding.tagline" label="Tagline" />
          <FormField name="branding.website" label="Website" /><FormField name="branding.email" label="Email" type="email" /><FormField name="branding.phone" label="Phone" type="tel" /><FormField name="branding.businessAddress" label="Business Address" />
        </div></section>
        <section className={premiumSectionClass}><AdvancedSectionHeader icon={FileCog} title="Document Settings" description="Output title, confidentiality and version details." /><div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <FormField name="branding.documentTitle" label="Document Title" /><FormField name="branding.confidentialityLabel" label="Confidentiality Label" /><FormField name="branding.preparedBy" label="Prepared By" /><FormField name="branding.logoReference" label="Logo" readOnly /><FormField name="branding.version" label="Version" />
        </div><p className="px-5 pb-5 text-xs text-muted-foreground">Logo uses the existing secure organisation asset. Uploads are managed in White Label settings.</p></section>
      </div>
      <aside><section className="overflow-hidden rounded-xl border border-border bg-card"><div className="border-b border-border bg-muted/30 px-5 py-3"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"><Sparkles className="h-4 w-4" />Local document preview</p></div><div className="min-h-72 p-6"><div className="flex items-start justify-between gap-4">{logoReference ? <img src={logoReference} alt="Organisation logo preview" className="max-h-14 max-w-36 object-contain" /> : <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted/30"><Building2 className="h-6 w-6" /></span>}<span className="rounded-full border border-border bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-wider">{confidentialityLabel || 'Confidential'}</span></div><div className="mt-12 border-l-2 border-primary pl-4"><h3 className="text-xl font-semibold tracking-tight">{organisationName || 'Organisation Name'}</h3><p className="mt-1 text-sm text-muted-foreground">{tradingName || tagline || 'Client Financial Position & Fact Find'}</p></div><div className="mt-8 rounded-xl border border-border bg-muted/30 p-4"><p className="font-semibold">{documentTitle || 'Document title'}</p><p className="mt-1 text-sm text-muted-foreground">Version {version || '1.0'}</p></div></div></section></aside>
    </div>
  </div>;
}
