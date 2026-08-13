/**
 * The annotation layer, assembled once for whichever portal is asking.
 *
 * Both the Command Centre and the Finance Portal render the same document
 * component and the same rail; this is the third shared piece — the state that
 * links them. Selection, composition and placement are identical on both sides,
 * so they live here rather than being written twice with a subtly different
 * idea of which pin is active.
 *
 * The two portals differ in exactly two ways, and both are arguments: whether
 * this reader may raise a request (`canAdd`), and what happens when they
 * submit. Everything else — numbering, ordering, stale-anchor handling — is the
 * same because it is the same document.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  agreementContentForValues,
  anchorForPath,
  annotationsByPath,
  placeAnnotations,
  type AgreementAnnotation,
  type AgreementFieldValues,
  type AgreementTemplateKey,
  type PlacedAnnotation,
} from '@/lib/agreements';
import type { AnnotationLayer } from '@/components/agreement-centre/annotationContext';

/** A change-request row as either portal's API returns it. */
export interface ChangeRequestRow {
  id: string;
  section_key: string;
  comment: string;
  status: string;
  created_at: string;
  requested_by_label?: string | null;
  resolved_by_label?: string | null;
  resolution_note?: string | null;
  resolved_at?: string | null;
  anchor_path?: string | null;
  anchor_label?: string | null;
  anchor_quote?: string | null;
}

/**
 * Rows → annotations.
 *
 * The anchor is read from the row rather than re-derived from the path, so a
 * clause that has since been renumbered still shows the label it was raised
 * against. Re-deriving would silently re-point the request at whatever now
 * occupies that path, and a comment about a commission rate appearing on a
 * termination clause is worse than one with no pin.
 */
export function annotationsFromRows(rows: readonly ChangeRequestRow[]): AgreementAnnotation[] {
  return rows.map((row) => ({
    id: row.id,
    sectionKey: row.section_key,
    comment: row.comment,
    status: (row.status === 'resolved' || row.status === 'declined') ? row.status : 'open',
    requestedByLabel: row.requested_by_label ?? null,
    resolvedByLabel: row.resolved_by_label ?? null,
    resolutionNote: row.resolution_note ?? null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
    anchor: row.anchor_path
      ? {
        path: row.anchor_path,
        label: row.anchor_label || 'Clause',
        sectionId: '',
        quote: row.anchor_quote || '',
      }
      : null,
  }));
}

export interface UseAgreementAnnotationsArgs {
  templateKey: AgreementTemplateKey | null;
  values: AgreementFieldValues;
  rows: readonly ChangeRequestRow[];
  /** False on every surface except a partner reviewing a live agreement. */
  canAdd: boolean;
}

export interface AgreementAnnotationsState {
  placed: PlacedAnnotation[];
  layer: AnnotationLayer;
  composing: { path: string; label: string; quote: string } | null;
  cancelCompose: () => void;
  activeId: string | null;
  select: (id: string | null) => void;
}

export function useAgreementAnnotations({
  templateKey, values, rows, canAdd,
}: UseAgreementAnnotationsArgs): AgreementAnnotationsState {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composingPath, setComposingPath] = useState<string | null>(null);

  // The agreement's OWN wording — template plus its amendments — which is what
  // the reader is looking at and therefore what a path must resolve against.
  const content = useMemo(
    () => (templateKey ? agreementContentForValues(templateKey, values) : null),
    [templateKey, values],
  );

  const placed = useMemo(
    () => (content ? placeAnnotations(content, annotationsFromRows(rows)) : []),
    [content, rows],
  );

  const byPath = useMemo(() => annotationsByPath(placed), [placed]);

  const composing = useMemo(() => {
    if (!composingPath || !content) return null;
    const anchor = anchorForPath(content, composingPath);
    if (!anchor) return null;
    return { path: anchor.path, label: anchor.label, quote: anchor.quote };
  }, [composingPath, content]);

  const select = useCallback((id: string | null) => {
    setActiveId(id);
    // Opening an existing thread closes a half-written new one: two open
    // composers on one page is a way to lose what you typed.
    if (id) setComposingPath(null);
  }, []);

  const onAdd = useCallback((path: string) => {
    setComposingPath(path);
    setActiveId(null);
  }, []);

  const cancelCompose = useCallback(() => setComposingPath(null), []);

  const layer: AnnotationLayer = useMemo(() => ({
    byPath,
    activeId,
    onSelect: select,
    canAdd,
    onAdd: canAdd ? onAdd : undefined,
    composingPath,
  }), [byPath, activeId, select, canAdd, onAdd, composingPath]);

  return { placed, layer, composing, cancelCompose, activeId, select };
}
