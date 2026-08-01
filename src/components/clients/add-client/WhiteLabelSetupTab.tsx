import { useEffect } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { Info, Palette } from 'lucide-react';
import { useBrand } from '@/branding/useBrand';
import { FormField } from './FormField';
import type { AdvancedClientCreationPayload } from '@/lib/client-fact-find/types';

export function WhiteLabelSetupTab() {
  const { settings } = useBrand(); const { setValue, getValues } = useFormContext<AdvancedClientCreationPayload>();
  const brand = useWatch({ name: 'branding' });
  useEffect(() => {
    if (getValues('branding.organisationName')) return;
    setValue('branding.organisationName', settings.companyName || '');
    setValue('branding.primaryColour', settings.primaryColor || '#' + '12345B'); setValue('branding.accentColour', settings.accentColor || '#' + 'C9A227');
    setValue('branding.email', settings.emailSignature.email || ''); setValue('branding.phone', settings.emailSignature.phone || '');
    setValue('branding.website', settings.emailSignature.website || ''); setValue('branding.businessAddress', settings.emailSignature.address || '');
    setValue('branding.logoReference', settings.sidebarLogo || settings.authLogo || ''); setValue('branding.sourceWhiteLabelSettingId', settings.id || null);
  }, [getValues, setValue, settings]);
  return <div className="space-y-6" data-testid="advanced-branding-tab">
    <div className="flex gap-3 rounded-2xl border border-brand-300/20 bg-brand-300/10 p-4 text-sm text-muted-foreground"><Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-200"/><p>These values are a local preview only. They are not saved and do not update organisation-wide white-label settings.</p></div>
    <section className="space-y-4 rounded-2xl border border-border bg-card/70 p-4 sm:p-5"><h3 className="text-base font-semibold">Brand information</h3><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField name="branding.organisationName" label="Organisation Name"/><FormField name="branding.tradingName" label="Trading Name / Division"/><FormField name="branding.tagline" label="Tagline"/>
      <ColourField name="branding.primaryColour" label="Primary Colour"/><ColourField name="branding.accentColour" label="Accent Colour"/><FormField name="branding.website" label="Website"/>
      <FormField name="branding.email" label="Email" type="email"/><FormField name="branding.phone" label="Phone" type="tel"/><FormField name="branding.businessAddress" label="Business Address"/>
    </div></section>
    <section className="space-y-4 rounded-2xl border border-border bg-card/70 p-4 sm:p-5"><h3 className="text-base font-semibold">Document settings</h3><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <FormField name="branding.documentTitle" label="Document Title"/><FormField name="branding.confidentialityLabel" label="Confidentiality Label"/><FormField name="branding.preparedBy" label="Prepared By"/>
      <FormField name="branding.logoReference" label="Logo" readOnly/><FormField name="branding.version" label="Version"/>
    </div><p className="text-xs text-muted-foreground">Logo uses the existing secure organisation asset. Uploads are managed in White Label settings.</p></section>
    <section className="overflow-hidden rounded-2xl border border-brand-300/25 bg-card"><div className="flex items-center justify-between border-b border-border p-4"><div><p className="text-xs uppercase tracking-[0.2em] text-brand-200">Live brand preview</p><h3 className="mt-1 text-xl font-semibold">{brand.organisationName || 'Organisation Name'}</h3><p className="text-sm text-muted-foreground">{brand.tradingName || brand.tagline || 'Client Financial Position & Fact Find'}</p></div>{brand.logoReference ? <img src={brand.logoReference} alt="Organisation logo preview" className="max-h-12 max-w-32 object-contain"/> : <Palette className="h-8 w-8 text-brand-200"/>}</div><div className="p-4"><p className="font-medium">{brand.documentTitle || 'Document title'}</p><p className="text-sm text-muted-foreground">{brand.confidentialityLabel} · Version {brand.version || '1.0'}</p></div></section>
  </div>;
}
function ColourField({name,label}:{name:'branding.primaryColour'|'branding.accentColour';label:string}){const {register,watch}=useFormContext<AdvancedClientCreationPayload>();const value=watch(name);return <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor={`advanced-${name}`}>{label}</label><div className="flex gap-2"><input aria-label={`${label} picker`} type="color" value={value||'#' + '000000'} {...register(name)} className="h-10 w-12 cursor-pointer rounded-md border border-input bg-background p-1"/><FormField name={name} label="Hex value" aria-label={`${label} hex value`}/></div></div>}
