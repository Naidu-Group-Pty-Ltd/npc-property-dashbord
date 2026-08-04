/**
 * Talking to `generate-brand-design-system`.
 *
 * Three calls, matching the route's three actions. `auditDesignSystem` is the
 * one the form leans on — it runs on every change so a person dragging a brand
 * colour sees the contrast verdict before they commit, rather than discovering
 * at save time that the hue they picked cannot be made legible.
 *
 * No fallback and no local approximation. The palette resolution and the
 * contrast audit are the same modules the renderer uses, and they run on the
 * server; a browser-side "probably fine" would be a second opinion with no
 * authority, which is exactly how a document ships in an unreadable colour.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';
import type { BrandDesignSystem } from './system.pure';
import type { BrandRouteResponse } from './route.pure';

export type BrandDesignSystemResult = BrandRouteResponse;

/**
 * True when the failure means "this function does not exist here yet".
 *
 * Narrow on purpose, and used only to choose the message. A bare 404 does not
 * count — the route answers 404 for a design system that has been deleted, and
 * reading that as "not deployed" would send somebody to deploy a function that
 * is already there.
 */
function looksUndeployed(error: { message?: string } | null): boolean {
  if (!error) return false;
  const message = (error.message || '').toLowerCase();
  return message.includes('function not found')
    || message.includes('requested function')
    || message.includes('does not exist')
    || message.includes('failed to fetch')
    || message.includes('failed to send a request');
}

const UNDEPLOYED_MESSAGE =
  'Brand design systems are not available yet — generate-brand-design-system has not been deployed.';

async function call(
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<BrandDesignSystemResult> {
  const { data, error } = await invokeSecureFunction('generate-brand-design-system', body, { timeoutMs });

  if (!error && data?.action) return data as BrandDesignSystemResult;
  if (looksUndeployed(error)) throw new Error(UNDEPLOYED_MESSAGE);
  throw new Error(error?.message || 'The design system service did not answer');
}

/** Resolve and audit a candidate. No model, no write. */
export function auditDesignSystem(system: BrandDesignSystem): Promise<BrandDesignSystemResult> {
  return call({ action: 'audit', system }, 30_000);
}

/**
 * Ask Claude for a design system from a brief.
 *
 * Returns a draft. Nothing is saved until `saveDesignSystem` is called, because
 * a model's first answer is a proposal and the picker is a list of house styles
 * rather than a log of drafting.
 */
export function generateDesignSystem(
  brief: string,
  companyName: string,
): Promise<BrandDesignSystemResult> {
  return call({ action: 'generate', brief, companyName }, 120_000);
}

/** Write one. Authored or accepted-generated, same validation either way. */
export function saveDesignSystem(
  system: BrandDesignSystem,
  options: { id?: string | null; isActive?: boolean } = {},
): Promise<BrandDesignSystemResult> {
  return call({
    action: 'save',
    system,
    id: options.id ?? null,
    isActive: options.isActive !== false,
  }, 45_000);
}
