/**
 * Every colour a report can print must be legible where it is allowed to print.
 *
 * The table in `roles.pure.ts` declares which grounds each ink role is legal on
 * and what floor it must clear. This iterates it, so **a new role cannot be
 * added without declaring its legibility** — the check comes for free.
 *
 * Why this exists: the brand gold is 2.1:1 on ivory. Every previous attempt to
 * fix that by eye produced another hardcoded hex, and the codebase now carries
 * eight golds. A test is the only thing that makes the floor real.
 */
/* eslint-disable no-restricted-syntax --
 * Fixture colours. These are deliberately hostile tenant brands chosen to break
 * the resolver, and expected-value assertions — not palette choices.
 */
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../color.pure';
import {
  auditPaletteContrast,
  resolveReportPalette,
  type ReportPreset,
} from '../brandResolve.pure';
import { INK_LEGALITY, type ResolvedReportPalette } from '../roles.pure';
import { CONTRAST_FLOOR, PRINT_SEMANTIC } from '../tokens.pure';

const PRESETS: ReportPreset[] = ['signature', 'editorial_navy', 'minimal_ink', 'high_contrast'];

/** Brands chosen to stress the resolver, not to flatter it. */
const TENANT_BRANDS: Array<[string, string | null]> = [
  ['NPC default', null],
  ['bright cyan', '#00A3FF'],
  ['near-black', '#111111'],
  ['near-white', '#FFFDF5'],
  ['saturated red', '#FF0000'],
  ['mid grey', '#808080'],
];

describe('print contrast floors', () => {
  describe.each(PRESETS)('preset %s', (preset) => {
    describe.each(TENANT_BRANDS)('tenant brand %s', (_label, brandHex) => {
      const palette = resolveReportPalette({ preset, brandHex });

      it('has no role failing its declared floor', () => {
        const problems = auditPaletteContrast(palette);
        const readable = problems.map(
          (p) => `${p.role} on ${p.ground}: ${p.ratio.toFixed(2)}:1 < ${p.floor}:1`,
        );
        expect(readable).toEqual([]);
      });

      it.each(Object.entries(INK_LEGALITY))(
        '%s clears its floor on every legal ground',
        (role, rule) => {
          const fg = palette[role as keyof ResolvedReportPalette];
          const floor = CONTRAST_FLOOR[rule.floor];
          for (const ground of rule.grounds) {
            const bg = palette[ground as keyof ResolvedReportPalette];
            expect(
              contrastRatio(fg, bg),
              `${role} (${fg}) on ${ground} (${bg})`,
            ).toBeGreaterThanOrEqual(floor);
          }
        },
      );
    });
  });

  it('every ink role is present in the resolved palette', () => {
    const palette = resolveReportPalette();
    for (const role of Object.keys(INK_LEGALITY)) {
      expect(palette[role as keyof ResolvedReportPalette], role).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe('Category B is fixed', () => {
  it('is byte-identical across every tenant and preset', () => {
    for (const preset of PRESETS) {
      for (const [, brandHex] of TENANT_BRANDS) {
        const p = resolveReportPalette({ preset, brandHex });
        expect({
          positive: p.positive,
          caution: p.caution,
          negative: p.negative,
          informative: p.informative,
        }).toEqual({ ...PRINT_SEMANTIC });
      }
    }
  });

  it('cannot be reached through the resolver input', () => {
    // Deliberately hostile: a caller trying to smuggle semantics through.
    const smuggled = resolveReportPalette({
      brandHex: '#00FF00',
      // @ts-expect-error — there is no such input, and that is the point.
      negative: '#00FF00',
      positive: '#FF0000',
    });
    expect(smuggled.negative).toBe(PRINT_SEMANTIC.negative);
    expect(smuggled.positive).toBe(PRINT_SEMANTIC.positive);
  });

  it('is frozen at runtime', () => {
    expect(Object.isFrozen(PRINT_SEMANTIC)).toBe(true);
  });
});
