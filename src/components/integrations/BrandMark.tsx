import { useState, type ReactNode } from 'react';
import { brandLogoUrl, getBrandProfile } from '@/lib/integrations/brandProfiles';
import { getInlineGlyph } from './brandGlyphs';

interface BrandMarkProps {
  integrationId: string;
  /** Fallback lucide (or arbitrary) node when no brand asset is available */
  fallback: ReactNode;
  /** Rendered SVG size in px */
  size?: number;
  className?: string;
}

/**
 * Renders the brand's mark in its official color.
 * Priority: inline SVG (for brands Simple Icons dropped for trademark reasons)
 *   → Simple Icons CDN (colored SVG)
 *   → provided lucide fallback.
 */
export function BrandMark({ integrationId, fallback, size = 24, className }: BrandMarkProps) {
  const profile = getBrandProfile(integrationId);
  const [errored, setErrored] = useState(false);

  const Inline = getInlineGlyph(integrationId);
  if (Inline) {
    return <Inline size={size} color={profile ? `#${profile.color}` : undefined} className={className} />;
  }

  if (!profile?.slug || errored) {
    return <>{fallback}</>;
  }

  return (
    <img
      src={brandLogoUrl(profile.slug, profile.color)}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setErrored(true)}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}
