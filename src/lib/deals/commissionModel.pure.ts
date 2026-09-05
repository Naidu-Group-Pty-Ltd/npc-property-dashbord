/**
 * How a deal earns the agency its commission.
 *
 * ## The defect this exists for
 *
 * The client Deals tab has a section called **Commission / invoice**, described
 * as "Build progress payments, generated documents and invoice-adjacent files".
 * On a house-and-land deal it shows the per-stage payment tracker. On every
 * other deal type it showed one sentence:
 *
 *     No build progress payment schedule applies to this deal type.
 *
 * That is true and it is also a dead end. An existing-property purchase earns
 * an agent fee, and a refinance earns an upfront commission and a trail — the
 * section that owns the subject was telling the reader there was nothing here,
 * while the figure itself sat in a different column under Financial Controls.
 * The audit reported it as "there is currently no agent fee/commission
 * tracking", twice, across two audits.
 *
 * ## Why it is a module
 *
 * The rule was written inline in two components as `deal.deal_type ===
 * 'house_and_land'` and `isRefinance || deal.deal_type === 'existing_property'`
 * — two expressions of one question, in two files, already disagreeing about
 * which types earn what. Naming it once means the section that DISPLAYS the
 * commission and the panel that EDITS it cannot drift apart about whether a
 * deal has one.
 */

/** The three deal types the tracker supports. */
export type DealTypeLike = 'existing_property' | 'house_and_land' | 'refinance' | string | null | undefined;

export type CommissionModel =
  /** Paid stage by stage as the build draws down; tracked per payment row. */
  | 'per_build_stage'
  /** A single agent fee or upfront commission on the deal itself. */
  | 'agent_fee'
  /** This deal type earns the agency nothing directly. */
  | 'none';

export function commissionModelFor(dealType: DealTypeLike): CommissionModel {
  if (dealType === 'house_and_land') return 'per_build_stage';
  if (dealType === 'existing_property' || dealType === 'refinance') return 'agent_fee';
  return 'none';
}

/**
 * What the Commission / invoice section should call the figure.
 *
 * A refinance commission and an existing-property agent fee are the same
 * mechanism and different words in the business, and the Financial Controls
 * panel already draws that distinction — so it is made once, here, rather than
 * a second time beside every heading.
 */
export function agentFeeLabelFor(dealType: DealTypeLike): string {
  return dealType === 'refinance' ? 'Commission & clawback' : 'Agent fee / commission';
}

/**
 * Whether a trail commission and a clawback window apply.
 *
 * They are a refinance concept: an existing-property agent fee is paid once
 * and is not clawed back, so showing an empty clawback row against one would
 * invent an obligation that does not exist.
 */
export function hasTrailAndClawback(dealType: DealTypeLike): boolean {
  return dealType === 'refinance';
}
