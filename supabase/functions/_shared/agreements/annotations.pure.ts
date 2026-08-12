/**
 * A change request pinned to the clause it is about.
 *
 * ## What this replaces
 *
 * "Request changes" was a small modal with a section dropdown and a free-text
 * box: pick one of nine broad sections, describe what you want, submit. The
 * partner is reading a fourteen-page agreement and has to look away from it,
 * translate "the second sentence of 3.2" into "Commercial Schedule", and type
 * out enough context that somebody on the other side can find the thing they
 * meant. The issuer then reads a paragraph of prose and goes looking.
 *
 * Both halves of that are the same missing idea: **the request has no address**.
 *
 * ## The address already existed
 *
 * `contentOverrides.pure.ts` addresses every text node of the template with a
 * stable path (`s:commercial/b:3:lead`) so the issuer can amend the wording of
 * that exact node. `listAgreementContentSlots` enumerates them, each with a
 * human label and its section.
 *
 * An annotation anchors to the same path. That is not a convenience — it is
 * what makes the loop close: the partner pins **the clause**, and when the
 * issuer amends the wording they amend **that same path**. The request and the
 * change it produced name the same address, in the same vocabulary, and neither
 * side had to describe a location in prose.
 *
 * ## Anchors go stale, and must not vanish
 *
 * A path is stable within a template revision, not across all of them. A clause
 * that has been renumbered, split or removed leaves an anchor pointing at
 * nothing — and the request is still a request somebody is waiting on.
 *
 * So an unresolvable anchor **degrades to a section-level request**: the
 * annotation keeps the label it was captured with, is listed with the others,
 * and simply cannot be pinned to a spot on the page. It is never dropped, and
 * it never silently attaches to whatever clause now occupies that path — which
 * is the failure mode worth being careful about, because a comment about a
 * commission rate landing on a termination clause is worse than no pin at all.
 * That is why the captured `label` is stored alongside the path rather than
 * being re-derived on read.
 */

import { listAgreementContentSlots } from './contentOverrides.pure.ts';
import type { AgreementTemplateContent } from './types.pure.ts';

/** Where an annotation sits, as captured when it was raised. */
export interface AgreementAnchor {
  /** The content-slot path — the same key an amendment writes to. */
  path: string;
  /** Human label at capture time ("Clause 11.2"). Stored, never re-derived. */
  label: string;
  /** Section it belonged to, for grouping when the path no longer resolves. */
  sectionId: string;
  /** A short extract of the wording, so a stale anchor still shows its subject. */
  quote: string;
}

/** How much of the clause travels with the pin. Enough to recognise, not a copy. */
export const ANCHOR_QUOTE_LIMIT = 240;

export function truncateQuote(text: string, limit = ANCHOR_QUOTE_LIMIT): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Resolve a path against the agreement's own wording.
 *
 * `content` must be the agreement's wording — the template with its amendments
 * already applied — so the quote captured is what the partner actually read,
 * not what the template says.
 */
export function anchorForPath(
  content: AgreementTemplateContent,
  path: string,
): AgreementAnchor | null {
  const slot = listAgreementContentSlots(content).find((candidate) => candidate.path === path);
  if (!slot) return null;
  return {
    path: slot.path,
    label: slot.label,
    sectionId: slot.sectionId,
    quote: truncateQuote(slot.text),
  };
}

/** Every path a pin may be dropped on, in document order. */
export function annotatablePaths(content: AgreementTemplateContent): string[] {
  return listAgreementContentSlots(content).map((slot) => slot.path);
}

/** A change request as both portals render it. */
export interface AgreementAnnotation {
  id: string;
  sectionKey: string;
  comment: string;
  status: 'open' | 'resolved' | 'declined';
  requestedByLabel: string | null;
  resolutionNote: string | null;
  resolvedByLabel?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  /** Null for a request raised before anchoring existed, or without a pin. */
  anchor: AgreementAnchor | null;
}

/**
 * An annotation prepared for display: whether its pin can actually be placed,
 * and the number it wears.
 *
 * Numbering is by document order of the anchor, then by age for everything
 * else, so the pin labelled 3 is the third one down the page. A number that
 * jumped around as requests were resolved would be useless for talking about
 * ("look at pin 3") which is most of the point of having one.
 */
export interface PlacedAnnotation extends AgreementAnnotation {
  /** 1-based, in reading order. */
  index: number;
  /** False when the path no longer exists in this version's wording. */
  placeable: boolean;
}

export function placeAnnotations(
  content: AgreementTemplateContent,
  annotations: readonly AgreementAnnotation[],
): PlacedAnnotation[] {
  const order = new Map(annotatablePaths(content).map((path, at) => [path, at]));

  const scored = annotations.map((annotation) => {
    const at = annotation.anchor ? order.get(annotation.anchor.path) : undefined;
    return { annotation, at: at ?? Number.MAX_SAFE_INTEGER, placeable: at !== undefined };
  });

  scored.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    return String(a.annotation.createdAt).localeCompare(String(b.annotation.createdAt));
  });

  return scored.map((entry, at) => ({
    ...entry.annotation,
    index: at + 1,
    placeable: entry.placeable,
  }));
}

/** Pins for one path, so the renderer can ask per text node in O(1). */
export function annotationsByPath(
  placed: readonly PlacedAnnotation[],
): Map<string, PlacedAnnotation[]> {
  const out = new Map<string, PlacedAnnotation[]>();
  for (const annotation of placed) {
    if (!annotation.placeable || !annotation.anchor) continue;
    const bucket = out.get(annotation.anchor.path);
    if (bucket) bucket.push(annotation);
    else out.set(annotation.anchor.path, [annotation]);
  }
  return out;
}

/** Open requests are the ones anybody is waiting on. */
export function openAnnotations(
  placed: readonly PlacedAnnotation[],
): PlacedAnnotation[] {
  return placed.filter((annotation) => annotation.status === 'open');
}

/**
 * What the marker shows when a clause carries several.
 *
 * An open request beats a settled one: the pin's job is to say "somebody is
 * waiting here", and a clause with one open and three resolved requests is
 * still a clause with an open request.
 */
export type AnnotationTone = 'open' | 'settled';

export function toneForPath(annotations: readonly PlacedAnnotation[]): AnnotationTone {
  return annotations.some((annotation) => annotation.status === 'open') ? 'open' : 'settled';
}

/**
 * Fold the anchor into the comment when there is nowhere to store it.
 *
 * The anchor columns are additive and nullable, but migrations in this repo are
 * applied out of band and one has already sat unapplied for three weeks
 * (`docs/agreements/SENDING.md`). If the columns are missing, an insert naming
 * them fails outright and the partner loses the request — which is far worse
 * than losing the pin. So the server falls back to this: the request is saved,
 * the location is stated in the first line of the comment where a person can
 * still read it, and only the ability to draw a marker is lost.
 */
export function commentWithAnchorPrefix(comment: string, anchor: AgreementAnchor | null): string {
  if (!anchor) return comment;
  return `Re: ${anchor.label}\n\n${comment}`;
}
