import { describe, expect, it } from 'vitest';

import {
  agentFeeLabelFor,
  commissionModelFor,
  hasTrailAndClawback,
} from '../commissionModel.pure';

describe('commissionModelFor', () => {
  it('tracks a house-and-land deal per build stage', () => {
    expect(commissionModelFor('house_and_land')).toBe('per_build_stage');
  });

  it('gives an existing-property purchase an agent fee', () => {
    // The reported case: the Commission section said nothing applied.
    expect(commissionModelFor('existing_property')).toBe('agent_fee');
  });

  it('gives a refinance an agent fee too', () => {
    expect(commissionModelFor('refinance')).toBe('agent_fee');
  });

  it('answers "none" for a type it does not know, rather than guessing', () => {
    // A new deal type must not silently inherit somebody else's commission
    // arrangement — showing nothing is recoverable, showing the wrong figure
    // against a client's file is not.
    expect(commissionModelFor('commercial_lease')).toBe('none');
    expect(commissionModelFor(null)).toBe('none');
    expect(commissionModelFor(undefined)).toBe('none');
  });
});

describe('agentFeeLabelFor', () => {
  it('names a refinance commission and a purchase fee differently', () => {
    expect(agentFeeLabelFor('refinance')).toBe('Commission & clawback');
    expect(agentFeeLabelFor('existing_property')).toBe('Agent fee / commission');
  });
});

describe('hasTrailAndClawback', () => {
  it('is a refinance concept only', () => {
    // An agent fee is paid once. Drawing an empty clawback window against one
    // would invent an obligation the deal does not carry.
    expect(hasTrailAndClawback('refinance')).toBe(true);
    expect(hasTrailAndClawback('existing_property')).toBe(false);
    expect(hasTrailAndClawback('house_and_land')).toBe(false);
  });
});
