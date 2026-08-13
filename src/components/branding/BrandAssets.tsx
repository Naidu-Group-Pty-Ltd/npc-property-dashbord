import { Globe, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBrand } from '@/branding/useTokens';
import { getBrandAssetSrc, type BrandAssetSlot } from '@/branding/brand-assets';
import type { WhiteLabelSettings } from '@/branding/brand-types';

interface BrandLogoProps {
  slot: BrandAssetSlot;
  alt?: string;
  className?: string;
  fallbackClassName?: string;
  settings?: WhiteLabelSettings;
}

export function BrandLogo({ slot, alt, className, fallbackClassName, settings: settingsOverride }: BrandLogoProps) {
  const { settings: brandSettings } = useBrand();
  const settings = settingsOverride ?? brandSettings;
  const src = getBrandAssetSrc(settings, slot);

  if (src) {
    return <img src={src} alt={alt || settings.companyName} className={className} />;
  }

  const fallbackIcon = slot === 'favicon' ? Globe : Building2;
  const FallbackIcon = fallbackIcon;

  return (
    <div className={cn('flex items-center justify-center rounded-xl bg-primary/10 text-primary', fallbackClassName)}>
      <FallbackIcon className="h-5 w-5" />
    </div>
  );
}

interface BrandMarkProps {
  slot?: Extract<BrandAssetSlot, 'sidebar-icon' | 'favicon'>;
  alt?: string;
  className?: string;
  fallbackClassName?: string;
  settings?: WhiteLabelSettings;
}

export function BrandMark({
  slot = 'sidebar-icon',
  alt,
  className = 'h-10 w-10 object-contain',
  fallbackClassName = 'h-10 w-10',
  settings,
}: BrandMarkProps) {
  return <BrandLogo slot={slot} alt={alt} className={className} fallbackClassName={fallbackClassName} settings={settings} />;
}

interface BrandFaviconProps {
  alt?: string;
  className?: string;
  fallbackClassName?: string;
  settings?: WhiteLabelSettings;
}

export function BrandFavicon({
  alt,
  className = 'h-8 w-8 rounded-lg object-contain',
  fallbackClassName = 'h-8 w-8 rounded-lg',
  settings,
}: BrandFaviconProps) {
  return <BrandLogo slot="favicon" alt={alt} className={className} fallbackClassName={fallbackClassName} settings={settings} />;
}

interface BrandLockupProps {
  slot?: Extract<BrandAssetSlot, 'auth' | 'sidebar' | 'sidebar-icon'>;
  meta?: string;
  className?: string;
  logoClassName?: string;
  fallbackClassName?: string;
  companyClassName?: string;
  metaClassName?: string;
  settings?: WhiteLabelSettings;
}

export function BrandLockup({
  slot = 'sidebar',
  meta,
  className,
  logoClassName,
  fallbackClassName,
  companyClassName,
  metaClassName,
  settings: settingsOverride,
}: BrandLockupProps) {
  const { settings: brandSettings } = useBrand();
  const settings = settingsOverride ?? brandSettings;

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <BrandLogo
        slot={slot}
        alt={settings.companyName}
        className={logoClassName}
        fallbackClassName={fallbackClassName}
        settings={settings}
      />
      <div className="min-w-0">
        <p className={cn('break-words font-semibold leading-tight text-foreground', companyClassName)}>{settings.companyName}</p>
        {meta ? <p className={cn('mt-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground', metaClassName)}>{meta}</p> : null}
      </div>

    </div>
  );
}