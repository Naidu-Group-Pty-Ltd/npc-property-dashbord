import { useState, type ReactNode } from 'react';
import { brandLogoUrl, getBrandProfile, svgOrgLogoUrl } from '@/lib/integrations/brandProfiles';
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
 *   → thesvg.org CDN (fallback brand library)
 *   → provided lucide fallback.
 */
export function BrandMark({ integrationId, fallback, size = 24, className }: BrandMarkProps) {
  const profile = getBrandProfile(integrationId);
  const [simpleIconsFailed, setSimpleIconsFailed] = useState(false);
  const [svgOrgFailed, setSvgOrgFailed] = useState(false);

  const Inline = getInlineGlyph(integrationId);
  if (Inline) {
    return <Inline size={size} color={profile ? `#${profile.color}` : undefined} className={className} />;
  }

  const useSimpleIcons = Boolean(profile?.slug) && !simpleIconsFailed;
  const useSvgOrg = !useSimpleIcons && Boolean(profile?.svgOrgSlug) && !svgOrgFailed;

  if (!useSimpleIcons && !useSvgOrg) {
    return <>{fallback}</>;
  }

  const src = useSimpleIcons
    ? brandLogoUrl(profile!.slug!, profile!.color)
    : svgOrgLogoUrl(profile!.svgOrgSlug!);

  return (
    <img
      key={src}
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => (useSimpleIcons ? setSimpleIconsFailed(true) : setSvgOrgFailed(true))}
      className={className}
      style={{ width: size, height: size }}
    />
  );
}
