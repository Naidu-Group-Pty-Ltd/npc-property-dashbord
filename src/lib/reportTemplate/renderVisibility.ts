import type { Overlay } from './templateSchema';
import { evalConditional, type ResolveContext } from './bindingResolver';

/** Shared export guard for overlays across HTML and PDF renderers. */
export function shouldRenderOverlay(overlay: Overlay, ctx: ResolveContext): boolean {
  return overlay.hidden !== true && evalConditional(overlay.conditional, ctx);
}
