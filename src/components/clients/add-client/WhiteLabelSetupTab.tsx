import { useEffect } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { FileCog, Info, Palette, Sparkles } from 'lucide-react';
import { useBrand } from '@/branding/useBrand';
import { FormField } from './FormField';
import type { AdvancedClientCreationPayload } from '@/lib/client-fact-find/types';
import { AdvancedSectionHeader, premiumSectionClass } from './AdvancedSectionHeader';

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
  return <div className="space-y-5" data-testid="advanced-branding-tab">
    <div className="flex gap-3 rounded-2xl border border-brand-300/20 bg-brand-300/10 p-4 text-sm text-muted-foreground"><Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-200"/><p>These values are a local preview only. They are not saved and do not update organisation-wide white-label settings.</p></div>
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]"><div className="space-y-6"><section className={premiumSectionClass}><AdvancedSectionHeader icon={Palette} title="Brand Information" description="Client-facing organisation identity and contact details."/><div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
      <FormField name="branding.organisationName" label="Organisation Name"/><FormField name="branding.tradingName" label="Trading Name / Division"/><FormField name="branding.tagline" label="Tagline"/>
      <ColourField name="branding.primaryColour" label="Primary Colour"/><ColourField name="branding.accentColour" label="Accent Colour"/><FormField name="branding.website" label="Website"/>
      <FormField name="branding.email" label="Email" type="email"/><FormField name="branding.phone" label="Phone" type="tel"/><FormField name="branding.businessAddress" label="Business Address"/>
    </div></section>
    <section className={premiumSectionClass}><AdvancedSectionHeader icon={FileCog} title="Document Settings" description="Output title, confidentiality and version details."/><div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
      <FormField name="branding.documentTitle" label="Document Title"/><FormField name="branding.confidentialityLabel" label="Confidentiality Label"/><FormField name="branding.preparedBy" label="Prepared By"/>
      <FormField name="branding.logoReference" label="Logo" readOnly/><FormField name="branding.version" label="Version"/>
    </div><p className="px-5 pb-5 text-xs text-muted-foreground">Logo uses the existing secure organisation asset. Uploads are managed in White Label settings.</p></section></div>
    <aside className="xl:sticky xl:top-2"><section className="overflow-hidden rounded-3xl border border-brand-300/30 bg-gradient-to-br from-card via-card to-brand-300/10 shadow-xl shadow-brand-950/15"><div className="border-b border-brand-300/20 bg-brand-300/10 px-5 py-3"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand-200"><Sparkles className="h-4 w-4"/>Local document preview</p></div><div className="min-h-72 p-6"><div className="flex items-start justify-between gap-4">{brand.logoReference ? <img src={brand.logoReference} alt="Organisation logo preview" className="max-h-14 max-w-36 object-contain"/> : <span className="dashboard-luxury-icon-tile flex h-12 w-12 items-center justify-center rounded-2xl border"><Palette className="h-6 w-6"/></span>}<span className="rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider">{brand.confidentialityLabel||'Confidential'}</span></div><div className="mt-12 border-l-2 border-brand-300/50 pl-4"><h3 className="text-xl font-semibold tracking-tight">{brand.organisationName || 'Organisation Name'}</h3><p className="mt-1 text-sm text-muted-foreground">{brand.tradingName || brand.tagline || 'Client Financial Position & Fact Find'}</p></div><div className="mt-8 rounded-2xl border border-border/60 bg-background/50 p-4"><p className="font-semibold">{brand.documentTitle || 'Document title'}</p><p className="mt-1 text-sm text-muted-foreground">Version {brand.version || '1.0'}</p><div className="mt-4 flex gap-2"><span className="h-2 flex-1 rounded-full bg-brand-300/70"/><span className="h-2 flex-1 rounded-full bg-primary/70"/></div></div></div></section></aside></div>
  </div>;
}
function ColourField({name,label}:{name:'branding.primaryColour'|'branding.accentColour';label:string}){const {register,watch}=useFormContext<AdvancedClientCreationPayload>();const value=watch(name);return <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor={`advanced-${name}`}>{label}</label><div className="flex gap-2"><input aria-label={`${label} picker`} type="color" value={value||'#' + '000000'} {...register(name)} className="h-10 w-12 cursor-pointer rounded-md border border-input bg-background p-1"/><FormField name={name} label="Hex value" aria-label={`${label} hex value`}/></div></div>}
