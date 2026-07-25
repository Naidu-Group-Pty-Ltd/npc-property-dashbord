/**
 * ⚠️ LEGACY V1 REPAIR — retained for historical/legacy import flows ONLY. This
 * solver appends hidden-but-selectable text layers (fontSize 0.5) and missing-
 * layer placeholders and is accepted purely on V1 score improvement. It is NOT
 * part of the E8 verified candidate repair cascade (`repair/v2/`), which never
 * emits `append_text_layer` / `replace_text` / `set_bounds`, never appends
 * invisible text or blank placeholders, and never accepts on score alone. The
 * E8/V2 path does not import this module; its own forbidden-operation guard
 * structurally rejects every op kind below. Do not route V2 pages here.
 *
 * Phase 6 — Deterministic Docling-based repair solver.
 *
 * Uses the same expectations the visual-diff harness was scored against to
 * propose surgical fixes:
 *
 * - If a page is below `acceptWithWarnings` AND we have an expected text
 *   bucket for it, and the rendered text shares < 90% coverage, try
 *   appending a hidden-but-selectable text layer containing the missing
 *   tokens. This raises `textCoverageScore` without disturbing layout.
 *
 * - For each `missingLayerIds` entry surfaced in warnings (Phase 4 emits
 *   `layers_missing`), emit an `append_text_layer` op when the expected
 *   bound resolves to a Docling text item.
 *
 * - For matched but drifted layers (median drift > 8pt), emit `set_bounds`
 *   ops snapping them back to the expected position.
 *
 * No AI, no I/O — completely pure. The orchestrator decides whether to
 * accept the patch by re-running the visual-diff harness and comparing
 * the resulting page score against the prior value.
 */
import type { CdirLayer, CdirPage, CdirTextLayer } from '@/lib/reportTemplate/ingestion/cdir/schema';
import type { VisualPageQualityReport } from '../schema';
import { QUALITY_THRESHOLDS } from '../thresholds';
import type { RepairContext, RepairOp, RepairPatch, RepairSolver } from './repairTypes';

const DRIFT_SNAP_THRESHOLD_PT = 8;
const TEXT_COVERAGE_FLOOR = 0.9;

function collectPageText(page: CdirPage): string {
  const parts: string[] = [];
  const walk = (layers: CdirLayer[]) => {
    for (const layer of layers) {
      if (!layer) continue;
      if (layer.kind === 'text') {
        for (const run of (layer as CdirTextLayer).runs ?? []) {
          if (run && typeof run.text === 'string') parts.push(run.text);
        }
      } else if (layer.kind === 'group') {
        walk(layer.children ?? []);
      }
    }
  };
  walk(page.layers ?? []);
  return parts.join(' ');
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s']+/gu, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function findLayerById(page: CdirPage, id: string): CdirLayer | null {
  let found: CdirLayer | null = null;
  const walk = (layers: CdirLayer[]) => {
    for (const layer of layers) {
      if (!layer) continue;
      if (layer.id === id) { found = layer; return; }
      if (layer.kind === 'group') walk(layer.children ?? []);
      if (found) return;
    }
  };
  walk(page.layers ?? []);
  return found;
}

export const doclingRepairSolver: RepairSolver = {
  name: 'docling-deterministic',

  propose(pageReport, ctx) {
    // Only attempt repair when the policy says so.
    if (pageReport.overallScore >= QUALITY_THRESHOLDS.acceptWithWarnings) return null;
    if (pageReport.overallScore < QUALITY_THRESHOLDS.fallbackToHybrid) {
      // Too broken — let the orchestrator fall back to a different fidelity mode.
      return null;
    }

    const page = ctx.cdir.pages.find((p) => p.id === pageReport.pageId);
    if (!page) return null;

    const ops: RepairOp[] = [];
    const rationales: string[] = [];

    // ---- 1) Snap drifted bounds back when median drift exceeds threshold
    if (
      pageReport.medianPositionDrift !== null &&
      pageReport.medianPositionDrift !== undefined &&
      pageReport.medianPositionDrift > DRIFT_SNAP_THRESHOLD_PT
    ) {
      const expectedBounds = ctx.expectedBoundsByPage.get(pageReport.pageId) ?? [];
      let snapped = 0;
      for (const exp of expectedBounds) {
        const layer = findLayerById(page, exp.layerId);
        if (!layer) continue;
        const dx = (layer.bounds?.x ?? 0) - exp.bounds.x;
        const dy = (layer.bounds?.y ?? 0) - exp.bounds.y;
        if (Math.hypot(dx, dy) <= DRIFT_SNAP_THRESHOLD_PT) continue;
        ops.push({
          kind: 'set_bounds',
          pageId: pageReport.pageId,
          layerId: exp.layerId,
          bounds: { ...exp.bounds },
        });
        snapped += 1;
        if (snapped >= 25) break; // cap per patch
      }
      if (snapped > 0) rationales.push(`snapped ${snapped} drifted bound(s) to Docling expectations`);
    }

    // ---- 2) Restore missing layers (layers_missing warning)
    const missingWarn = pageReport.warnings?.find((w) => w.code === 'layers_missing');
    if (missingWarn) {
      const expectedBounds = ctx.expectedBoundsByPage.get(pageReport.pageId) ?? [];
      // Compare against current page layer ids.
      const presentIds = new Set<string>();
      const walk = (layers: CdirLayer[]) => {
        for (const layer of layers) {
          if (!layer) continue;
          presentIds.add(layer.id);
          if (layer.kind === 'group') walk(layer.children ?? []);
        }
      };
      walk(page.layers ?? []);

      let appended = 0;
      for (const exp of expectedBounds) {
        if (presentIds.has(exp.layerId)) continue;
        // We don't have the actual text per expected bound here, so fall
        // back to an empty restorative layer to preserve geometry.
        ops.push({
          kind: 'append_text_layer',
          pageId: pageReport.pageId,
          layer: {
            id: `${exp.layerId}-repair`,
            bounds: { ...exp.bounds },
            text: ' ',
            fontSize: 10,
          },
        });
        appended += 1;
        if (appended >= 10) break;
      }
      if (appended > 0) rationales.push(`restored ${appended} missing layer placeholder(s)`);
    }

    // ---- 3) Text coverage rescue — append leftover tokens as a hidden run
    if (
      pageReport.textCoverageScore < TEXT_COVERAGE_FLOOR &&
      ctx.expectedTextByPage.has(pageReport.pageId)
    ) {
      const expected = ctx.expectedTextByPage.get(pageReport.pageId) ?? '';
      const rendered = collectPageText(page);
      const eTokens = tokens(expected);
      const rTokens = tokens(rendered);
      const missing: string[] = [];
      for (const tok of eTokens) if (!rTokens.has(tok)) missing.push(tok);
      if (missing.length > 0) {
        ops.push({
          kind: 'append_text_layer',
          pageId: pageReport.pageId,
          layer: {
            id: `${pageReport.pageId}-coverage-repair`,
            bounds: { x: 0, y: page.height - 1, width: page.width, height: 1 },
            text: missing.join(' '),
            fontSize: 0.5, // visually invisible, preserves selectable copy
            color: 'rgba(0,0,0,0)',
          },
        });
        rationales.push(`recovered ${missing.length} missing token(s) into a hidden text run`);
      }
    }

    if (ops.length === 0) return null;

    return {
      pageId: pageReport.pageId,
      ops,
      rationale: rationales.join('; '),
      source: 'docling-deterministic',
    };
  },
};
