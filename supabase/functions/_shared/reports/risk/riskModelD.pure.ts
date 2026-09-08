/**
 * ME-5.1 items 1, 3 and 4 — Model D, and what to do with overheating.
 *
 * Model D's rules, taken from the brief and enforced here rather than promised:
 *
 *   * property type selects the applicable checks and contributes **zero** points;
 *   * buyer LVR contributes **zero** property-risk points;
 *   * buyer cash flow contributes **zero** property-risk points;
 *   * buyer finance is reported separately as Finance Suitability;
 *   * Risk is **null** when insufficient genuine property-level evidence exists.
 *
 * ## The renormalisation trap, and why it is the whole of item 4
 *
 * Strip asset type out and twelve-month overheating is the only property-scoped
 * input left. Renormalising it to 100 would take a signal the live model gives
 * **0.10** of one dimension and make it **the entire** Risk score — replacing a
 * property-type bias with a single-indicator one. It would also be a second
 * opinion on Growth wearing a different hat, since the input IS Growth's own
 * twelve-month figure, read under ME-4's one declared cross-dimension exception.
 *
 * Three candidates, compared on independence rather than on what they do to the
 * grade distribution:
 *
 * **D1 — overheating is a disclosed flag and creates no Risk dimension.**
 * Risk is null until a genuine property-risk category is measurable. The
 * caution still reaches the reader; it simply is not a score.
 *
 * **D2 — overheating may contribute only alongside at least one independent
 * property-risk category.** It is never alone, so it can never become 100% by
 * renormalisation. Today no such category is measurable, so D2 behaves exactly
 * like D1 — and that identity is the point: D2 is D1 plus a door that opens by
 * itself the moment hazard or strata evidence lands.
 *
 * **D3 — overheating stays inside Growth as a trajectory caution** and Risk
 * carries no market input at all. Cleanest on independence, because the signal
 * lives once, in the dimension that owns it. Its cost is that a reader looking
 * for risk finds nothing about an overheated market under the Risk heading.
 *
 * `compareOverheatingVariants` runs the comparison; the recommendation is
 * argued in the audit document, not asserted here.
 */

import {
  answerableCount,
  resolveAssetClass,
  scoreableQuestions,
  type AssetClass,
  type RiskQuestion,
} from './propertyRiskSchema.pure.ts';

export const RISK_MODEL_D_VERSION = '1.0.0';

export type OverheatingVariant = 'D1_flag_only' | 'D2_requires_a_peer' | 'D3_inside_growth';

/** What Model D was given. Buyer facts are deliberately absent from this type. */
export interface PropertyRiskInputs {
  /** The stored property type. Used to SELECT questions; never scored. */
  propertyType?: string | null;
  /**
   * Answers to the class's own property-level risk questions, by question id.
   * A score of 0-100 where higher is safer. Absent means unanswered.
   */
  answers?: Readonly<Record<string, number>>;
  /** Twelve-month capital growth, per cent. Growth's input, read under exception. */
  growth1Year?: number | null;
}

export interface PropertyRiskResult {
  version: string;
  variant: OverheatingVariant;
  /** The class the type selected, or null where the type is a placeholder. */
  assetClass: AssetClass | null;
  /** Null unless genuine property-level evidence supports a score. */
  score: number | null;
  /** Every question the class makes applicable, with its standing. */
  questions: ReadonlyArray<RiskQuestion & { answered: boolean; value: number | null }>;
  /** Property-level questions answered, over those that could be. */
  coverage: { answered: number; scoreable: number };
  /** The overheating reading, whether or not it scored. */
  overheating: { value: number | null; scored: boolean; statement: string } | null;
  statement: string;
}

/** Flat below 12%: ordinary appreciation is not a risk, and charging for it is Growth's job twice. */
export const OVERHEATING_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 100], [12, 100], [16, 85], [20, 68], [25, 48], [35, 25],
];

function interpolate(anchors: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i += 1) {
    const [x0, y0] = anchors[i - 1];
    const [x1, y1] = anchors[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

/**
 * Score a property's own risk.
 *
 * The asset class appears in the result and in no arithmetic. A test asserts
 * that: two properties differing only in type receive the same score.
 */
export function scorePropertyRisk(
  input: PropertyRiskInputs,
  variant: OverheatingVariant = 'D2_requires_a_peer',
): PropertyRiskResult {
  const assetClass = resolveAssetClass(input.propertyType);
  const answers = input.answers ?? {};

  if (!assetClass) {
    return {
      version: RISK_MODEL_D_VERSION, variant, assetClass: null, score: null,
      questions: [], coverage: { answered: 0, scoreable: 0 }, overheating: null,
      statement: 'The stored property type is a placeholder, so no risk schema applies and no '
        + 'property risk is assessed. This is a gap in the record, not a finding about the property.',
    };
  }

  const scoreable = scoreableQuestions(assetClass);
  const questions = SCHEMA_WITH_ANSWERS(assetClass, answers);
  const answered = scoreable.filter((q) => typeof answers[q.id] === 'number');

  // --- the property-level component ------------------------------------
  const propertyScore = answered.length
    ? answered.reduce((a, q) => a + answers[q.id], 0) / answered.length
    : null;

  // --- overheating, per variant ----------------------------------------
  const g = typeof input.growth1Year === 'number' ? input.growth1Year : null;
  const overheatingScore = g === null ? null : interpolate(OVERHEATING_ANCHORS, g);

  let overheatingScored = false;
  if (overheatingScore !== null) {
    if (variant === 'D2_requires_a_peer') overheatingScored = answered.length > 0;
    // D1 never scores it; D3 does not read it here at all.
  }

  const overheating = variant === 'D3_inside_growth'
    ? {
        value: g, scored: false,
        statement: 'Twelve-month growth is read as a trajectory caution inside Growth, where the '
          + 'signal already lives. Risk carries no market input.',
      }
    : overheatingScore === null
      ? null
      : {
          value: g, scored: overheatingScored,
          statement: overheatingScored
            ? 'Rapid twelve-month appreciation is scored alongside a measured property-risk '
              + 'category, so it cannot become the whole of Risk by renormalisation.'
            : 'Rapid twelve-month appreciation is disclosed as a market caution. It does not '
              + 'create a Risk score on its own, because one indicator renormalised to 100 is a '
              + 'single-indicator bias in place of a property-type one.',
        };

  const score = overheatingScored && propertyScore !== null && overheatingScore !== null
    // Overheating is a minority contributor even when admitted: it is a market
    // reading standing beside property evidence, not a peer of it.
    ? propertyScore * 0.75 + overheatingScore * 0.25
    : propertyScore;

  return {
    version: RISK_MODEL_D_VERSION,
    variant,
    assetClass,
    score,
    questions,
    coverage: { answered: answered.length, scoreable: scoreable.length },
    overheating,
    statement: score === null
      ? `No property-level risk evidence is held for a ${assetClass.replace(/_/g, ' ')}, so Risk `
        + `is not assessed. ${scoreable.length} question(s) apply to this asset class and `
        + `${answerableCount(assetClass)} can be answered by this deployment today.`
      : `Assessed from ${answered.length} of ${scoreable.length} applicable property-risk `
        + 'question(s). The property type selected those questions and contributed no points.',
  };
}

function SCHEMA_WITH_ANSWERS(
  cls: AssetClass,
  answers: Readonly<Record<string, number>>,
): PropertyRiskResult['questions'] {
  return scoreableQuestions(cls).map((q) => ({
    ...q,
    answered: typeof answers[q.id] === 'number',
    value: typeof answers[q.id] === 'number' ? answers[q.id] : null,
  }));
}

export interface VariantComparison {
  variant: OverheatingVariant;
  /** Can this variant ever let overheating be the sole basis of a Risk score? */
  overheatingCanStandAlone: boolean;
  /** Does the signal appear in exactly one dimension? */
  signalLivesOnce: boolean;
  /** Does an overheated market still reach the reader under Risk? */
  cautionVisibleUnderRisk: boolean;
  /** What it produces on this corpus today, where no property evidence exists. */
  scoreToday: number | null;
  note: string;
}

/**
 * Compare the three variants on independence and defensibility.
 *
 * Deliberately reports no grade distribution: the brief forbids choosing on
 * A/A+ count, and offering the number invites exactly that.
 */
export function compareOverheatingVariants(input: PropertyRiskInputs): VariantComparison[] {
  const variants: OverheatingVariant[] = ['D1_flag_only', 'D2_requires_a_peer', 'D3_inside_growth'];
  return variants.map((variant) => {
    const result = scorePropertyRisk(input, variant);
    return {
      variant,
      overheatingCanStandAlone: variant === 'D1_flag_only' || variant === 'D3_inside_growth'
        ? false
        // D2 admits it only beside a measured peer, so it is never alone either.
        : false,
      signalLivesOnce: variant === 'D3_inside_growth',
      cautionVisibleUnderRisk: variant !== 'D3_inside_growth',
      scoreToday: result.score,
      note: variant === 'D1_flag_only'
        ? 'Simplest. Risk stays null until a property-risk category is measurable, and the market '
          + 'caution is disclosed rather than scored.'
        : variant === 'D2_requires_a_peer'
          ? 'Identical to D1 on today’s evidence, and opens by itself when hazard or strata data '
            + 'lands — the gate is the evidence, not a later code change.'
          : 'Cleanest on independence: the signal lives once, in Growth. Costs the reader a risk '
            + 'caution under the Risk heading.',
    };
  });
}
