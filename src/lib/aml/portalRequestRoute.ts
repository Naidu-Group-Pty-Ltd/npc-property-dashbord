/**
 * Client Portal — which step an open AML request opens.
 *
 * ## The defect this exists to fix
 *
 * Routing used to key off `action_code` alone, so every
 * `complete_identity_verification` request opened the electronic capture step
 * — including the ones the Command Centre created *because* no provider was
 * available. Clients saw "Step 2 — take a photo of yourself" while the server
 * refused submission with "Electronic verification is not available for your
 * case", and the capture flow's submit needs a selfie that route can never
 * produce. Contradictory copy, and a dead end.
 *
 * `action_target.target_step` is what the Command Centre already resolved from
 * provider readiness when it created the request. It is authoritative here.
 *
 * ## Safety rules
 *
 *  - an electronic target is downgraded to manual upload when the provider is
 *    no longer available, so nobody is parked in a flow that cannot submit;
 *  - a missing or unrecognised target resolves to manual upload — the route
 *    that always works — never to capture;
 *  - only values in `TARGET_STEPS` are ever honoured, so a URL-shaped or
 *    otherwise crafted target is ignored rather than followed.
 */

/** Closed vocabulary → button copy + the portal step each opens. */
export const REQUEST_ACTIONS: Record<string, { label: string; step: string }> = {
  complete_identity_verification: { label: 'Complete identity verification', step: 'verify' },
  upload_document: { label: 'Upload requested document', step: 'documents' },
  update_questionnaire_section: { label: 'Update information', step: 'questionnaire' },
  review_consent: { label: 'Review updated consent', step: 'consent' },
  provide_clarification: { label: 'Respond', step: 'respond' },
  review_and_submit: { label: 'Review and submit', step: 'review' },
};

/** The only `target_step` values a request may carry. */
export const TARGET_STEPS = ['identity_verification', 'upload_document'] as const;
export type RequestTargetStep = (typeof TARGET_STEPS)[number];

/** Client-safe readiness, as `aml-client-portal` projects it. */
export type IdvAvailability =
  | 'available' | 'temporarily_unavailable' | 'manual_verification_required';

export interface PortalOpenRequest {
  action_code?: string | null;
  action_target?: { target_step?: string | null; section_code?: string | null } | null;
}

export interface ResolvedRequestRoute {
  step: string;
  label: string;
  /** The request wanted electronic capture but cannot have it — say so. */
  manualFallback: boolean;
}

export function resolveRequestStep(
  request: PortalOpenRequest,
  availability: IdvAvailability | null,
): ResolvedRequestRoute {
  const action = REQUEST_ACTIONS[String(request.action_code ?? '')] ?? null;
  if (!action) return { step: 'respond', label: 'Respond', manualFallback: false };

  if (request.action_code !== 'complete_identity_verification') {
    return { step: action.step, label: action.label, manualFallback: false };
  }

  const raw = request.action_target?.target_step;
  const target = (TARGET_STEPS as readonly string[]).includes(String(raw))
    ? (String(raw) as RequestTargetStep)
    : null;

  // Electronic capture only when the request asked for it AND a provider can
  // actually examine the result. Every other combination is manual upload.
  if (target === 'identity_verification' && availability === 'available') {
    return { step: 'verify', label: action.label, manualFallback: false };
  }

  return {
    step: 'documents',
    label: 'Upload identity document',
    manualFallback: target === 'identity_verification' || target === null,
  };
}
