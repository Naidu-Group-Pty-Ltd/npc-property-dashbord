/**
 * BUILDER STOCK — THE SECOND AND THIRD REASONS 119 PROPERTIES CAME OUT BLANK.
 *
 * PRODUCTION, 30 AUGUST 2026. A stock list imported cleanly, the cutover
 * published it, every property was claimed and every property advanced through
 * source, eligibility, sanitization and fallback. Two pictures came out of it.
 *
 * The identity half is `builderStockCanonicalIdentity.test.ts`: the ladder had
 * no name to look the property up by, because an address was only ever taken
 * from a column and never composed from the lot and the estate beside it.
 * This file is the other two, and each one on its own leaves a property
 * settled and permanently blank.
 *
 *
 * TWO. AN OUTAGE WAS CREDITED AS A COMPLETED STAGE.
 *
 * `stageWasAttempted` counts any row for a stage as that stage having run —
 * a deliberate widening, because a search that returned nothing used to read
 * as a search never made and the ladder asked for it again for ever. But it
 * widened past the line: 58 properties of that upload hold an
 * `internet_search` row reading "The property search service did not respond",
 * which is the provider being down. It says nothing whatever about the
 * property, and every one of those 58 was moved down the ladder on it.
 *
 * A FINDING IS AN ANSWER; A FAILURE IS NOT. `unavailable` — nothing published,
 * no address to look up — is the stage answering, and the ladder moves on. The
 * retry is BOUNDED at `MAX_STAGE_FAILURES`, because the unbounded version of
 * this correction is the loop the widening was written to close.
 *
 *
 * THREE. AN IMPROVED LADDER COULD NOT REACH THE PROPERTIES IT WAS WRITTEN FOR.
 *
 * `settleItemImages.ts` states the rule in its own header and admits it has no
 * mechanism: a property at `settled` is never claimed again, so every ladder
 * improvement applies to future uploads only. The re-open added for a
 * re-judged IMAGE cannot see a change to the ENGINE — no image moves when the
 * ladder learns to compose an address. A generation stamp closes it.
 *
 * Written on invented data. No estate, lot, suburb, organisation, upload,
 * spreadsheet or source URL here belongs to any deployment.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  MAX_STAGE_FAILURES, nextImageStage, stageFailureCount, stageWasAttempted,
  STAGE_SKIPPED_MESSAGE, STAGE_SKIPPED_REFERENCE,
} from '../../../supabase/functions/_shared/builderStock/imagePriority.pure';
import { geocodableAddress, normaliseStockRow } from '../../../supabase/functions/_shared/builderStock/normalise.pure';
import { repairStoredIdentity } from '../../../supabase/functions/_shared/builderStock/storedIdentityRepair.pure';
import {
  assessGeocodePrecision, assessPanoramaUsefulness,
} from '../../../supabase/functions/_shared/builderStock/streetViewHeading.pure';

const WEB = 'internet_search';
const STREET = 'google_maps';

/** A `stage-status` row: the ladder's own note about what a stage did. */
const statusRow = (stage: string, over: Record<string, unknown> = {}) => ({
  id: `${stage}-status`, source_stage: stage, source_reference: 'stage-status',
  processing_status: 'unavailable', verification_status: 'unverified',
  storage_path: null, external_url: null, position: 0, source_detail: null,
  ...over,
});

const settled = { sourceSettlementComplete: true };

// ── TWO ─────────────────────────────────────────────────────────────────────

describe('a stage that FAILED is not a stage that answered', () => {
  it('an outage does not retire the rung it interrupted', () => {
    const outage = statusRow(WEB, {
      processing_status: 'failed',
      error_message: 'The property search service did not respond.',
      source_detail: { stage_failures: 1 },
    });
    expect(stageWasAttempted(outage as never, WEB)).toBe(false);
    // And the ladder therefore still owes the property its web search.
    expect(nextImageStage([outage] as never, settled)).toBe('web_search');
  });

  it('a FINDING is an answer, and the ladder moves on from it', () => {
    // "No published imagery was found" is the search having run and returned
    // nothing. That is knowledge about the property, not about the provider.
    const empty = statusRow(WEB, {
      processing_status: 'unavailable',
      error_message: 'No published imagery was found for this property.',
    });
    expect(stageWasAttempted(empty as never, WEB)).toBe(true);
    expect(nextImageStage([empty] as never, settled)).toBe('street_view');
  });

  it('"no address to look up" is likewise an answer, not a failure', () => {
    const refused = statusRow(STREET, {
      processing_status: 'unavailable', verification_status: 'location_derived',
      error_message: 'This property has no street address to look up.',
    });
    expect(stageWasAttempted(refused as never, STREET)).toBe(true);
  });

  it('the retry is BOUNDED — a provider that stays down stops being asked', () => {
    const spent = statusRow(WEB, {
      processing_status: 'failed', source_detail: { stage_failures: MAX_STAGE_FAILURES },
    });
    expect(stageWasAttempted(spent as never, WEB)).toBe(true);
    // Which is the whole point: the correction must not become an unbounded
    // paid loop against a broken provider.
    expect(nextImageStage([spent] as never, settled)).toBe('street_view');
  });

  it('the ceiling is small enough to be an outage and not a budget', () => {
    expect(MAX_STAGE_FAILURES).toBeGreaterThanOrEqual(2);
    expect(MAX_STAGE_FAILURES).toBeLessThanOrEqual(3);
  });

  it('a row written before the counter existed carries one failure, not none', () => {
    // Otherwise every historical `failed` row would read as zero attempts and
    // the whole estate would re-enter the ladder unbounded on deploy.
    const legacy = statusRow(WEB, { processing_status: 'failed', source_detail: null });
    expect(stageFailureCount(legacy as never)).toBe(1);
    expect(stageWasAttempted(legacy as never, WEB)).toBe(false);
    const legacyTwice = statusRow(WEB, {
      processing_status: 'failed', source_detail: { stage_failures: 2 },
    });
    expect(stageWasAttempted(legacyTwice as never, WEB)).toBe(true);
  });

  it('a nonsense counter is read conservatively rather than trusted', () => {
    for (const bad of [null, undefined, 'many', {}, -4, Number.NaN]) {
      const row = statusRow(WEB, {
        processing_status: 'failed', source_detail: { stage_failures: bad },
      });
      expect(stageFailureCount(row as never)).toBeGreaterThanOrEqual(1);
    }
  });

  it('a SKIP is still not an attempt, whatever its status', () => {
    // The rule 20261026000000 shipped is untouched by this one.
    const skip = statusRow(WEB, {
      source_reference: STAGE_SKIPPED_REFERENCE, error_message: STAGE_SKIPPED_MESSAGE,
    });
    expect(stageWasAttempted(skip as never, WEB)).toBe(false);
    const legacySkip = statusRow(WEB, { error_message: STAGE_SKIPPED_MESSAGE });
    expect(stageWasAttempted(legacySkip as never, WEB)).toBe(false);
  });

  it('a stage that produced a PICTURE is never re-asked on a failure elsewhere', () => {
    const outage = statusRow(WEB, {
      processing_status: 'failed', source_detail: { stage_failures: 1 },
    });
    const photo = {
      id: 'web-1', source_stage: WEB, source_reference: 'ref-a',
      processing_status: 'ready', verification_status: 'property_identity_verified',
      storage_path: 'web-1.jpg', external_url: null, position: 0,
      source_detail: {
        property_identity: { matched: ['lot', 'estate'], verified_at: '2026-01-01T00:00:00Z' },
      },
    };
    expect(nextImageStage([outage, photo] as never, settled)).toBe('none');
  });

  it('both paid stages down leaves the property owed both, not settled', () => {
    const rows = [
      statusRow(WEB, { processing_status: 'failed', source_detail: { stage_failures: 1 } }),
      statusRow(STREET, {
        processing_status: 'failed', verification_status: 'location_derived',
        source_detail: { stage_failures: 1 },
      }),
    ];
    expect(nextImageStage(rows as never, settled)).toBe('web_search');
    // …and after the web rung is spent, the other one is still owed.
    const spentWeb = [
      statusRow(WEB, {
        processing_status: 'failed', source_detail: { stage_failures: MAX_STAGE_FAILURES },
      }),
      rows[1],
    ];
    expect(nextImageStage(spentWeb as never, settled)).toBe('street_view');
  });

  it('and when every stage really is spent, the answer is still `none`', () => {
    // ZERO BUILDER BRANCHES AND TWO EXHAUSTED STAGES IS A LEGITIMATE BLANK.
    const rows = [
      statusRow(WEB, {
        processing_status: 'failed', source_detail: { stage_failures: MAX_STAGE_FAILURES },
      }),
      statusRow(STREET, {
        processing_status: 'unavailable', verification_status: 'location_derived',
      }),
    ];
    expect(nextImageStage(rows as never, settled)).toBe('none');
  });
});

// ── THE SOURCE MATRIX ───────────────────────────────────────────────────────
/*
 * The starved shape is not a property of one spreadsheet. It is a property of
 * STOCK LISTS: the lot in one column, the estate in another, the locality in a
 * third, and no column that is an address. Every supported source can present
 * it, so every supported source is put through the same two questions —
 * can the ladder name this property, and does the repair recover a record
 * already stored in the older shape?
 */
const SOURCES: Array<{ name: string; headers: Record<string, string> }> = [
  { name: 'a Google Sheets tab', headers: { 'Lot #': '605', Estate: 'Sample Rise', Location: 'Northfield' } },
  { name: 'a Notion database', headers: { Lot: '12', Development: 'Second Estate', Area: 'Eastvale' } },
  { name: 'an uploaded CSV', headers: { 'Lot Number': '3', 'Estate Name': 'Third Estate', Suburb: 'Westbrook' } },
  { name: 'an XLSX workbook', headers: { LOT: '88', Project: 'Fourth Stage', 'Suburb Location': 'Southgate' } },
];

describe('every supported source presents the same starved shape', () => {
  for (const source of SOURCES) {
    it(`${source.name} — the ladder can name the property`, () => {
      const row = normaliseStockRow(source.headers);
      expect(row).not.toBeNull();
      // The builder gave no address column, and none is invented on the record.
      expect(row!.address_line).toBeNull();
      const address = geocodableAddress(row!);
      expect(address).toBeTruthy();
      expect(address).toMatch(/, Australia$/);
      // Every part of it came out of a column the builder supplied.
      for (const value of Object.values(source.headers)) {
        expect(address!.toLowerCase()).toContain(value.toLowerCase());
      }
    });
  }

  it('and a row with no place still refuses, whatever the source called it', () => {
    for (const heading of ['Lot #', 'Lot', 'Lot Number', 'LOT']) {
      const row = normaliseStockRow({ [heading]: '605' });
      expect(geocodableAddress(row!)).toBeNull();
    }
  });
});

describe('a record stored in the older shape recovers without being re-uploaded', () => {
  for (const source of SOURCES) {
    it(`${source.name} — the locality is recovered from the raw row`, () => {
      /*
       * How the record actually looks in the table: the import placed the lot
       * and the estate, and the locality heading it did not recognise went to
       * `unmapped` rather than being dropped. That is what makes this
       * recoverable at all.
       */
      const [lotHeader, placeHeader, localityHeader] = Object.keys(source.headers);
      const stored = {
        address_line: null, suburb: null, state: null, postcode: null,
        lot_number: source.headers[lotHeader], unit_number: null,
        development_name: source.headers[placeHeader], project_name: null,
      };
      const raw = { unmapped: { [localityHeader]: source.headers[localityHeader] } };

      const { patch, recovered } = repairStoredIdentity(stored, raw);
      expect(recovered).toContain('suburb');
      expect(patch.suburb).toBe(source.headers[localityHeader]);

      // And with it, the property is findable where it was not.
      expect(geocodableAddress(stored as never)).toBeNull();
      expect(geocodableAddress({ ...stored, ...patch } as never)).toBeTruthy();
    });
  }

  it('a repair is idempotent — the second pass has nothing left to do', () => {
    const stored = {
      address_line: null, suburb: null, state: null, postcode: null,
      lot_number: '605', unit_number: null,
      development_name: 'Sample Rise', project_name: null,
    };
    const raw = { unmapped: { Location: 'Northfield' } };
    const first = repairStoredIdentity(stored, raw);
    const second = repairStoredIdentity({ ...stored, ...first.patch }, raw);
    expect(second.recovered).toEqual([]);
    expect(second.patch).toEqual({});
  });

  it('a record the builder filled in properly is never touched', () => {
    const complete = {
      address_line: '12 Wattle Street', suburb: 'Northfield', state: 'VIC',
      postcode: '3000', lot_number: null, unit_number: null,
      development_name: null, project_name: null,
    };
    const { patch } = repairStoredIdentity(complete, { unmapped: { Location: 'Somewhere Else' } });
    expect(patch).toEqual({});
  });
});

// ── THREE ───────────────────────────────────────────────────────────────────

describe('the ladder generation reaches properties that already settled', () => {
  const migration = readFileSync(
    'supabase/migrations/20261027000000_builder_stock_ladder_generation.sql', 'utf8');

  it('re-opens on the ENGINE changing, not only on evidence changing', () => {
    // The sibling rule (an image re-judged after the property settled) cannot
    // see a ladder improvement, because no image moves when one ships.
    expect(migration).toContain('image_ladder_generation_at');
    expect(migration).toMatch(/i\.image_work_updated_at\s*<\s*v_generation/);
    // The evidence rule is kept, not replaced.
    expect(migration).toMatch(/x\.updated_at\s*>\s*i\.image_work_updated_at/);
  });

  it('only blank properties, so nothing already showing a picture is re-bought', () => {
    expect(migration).toMatch(/primary_image_id IS NULL/);
  });

  it('is self-limiting — re-opening stamps the timestamp it is compared against', () => {
    expect(migration).toMatch(/image_work_updated_at = now\(\)/);
  });

  it('clears the terminal enrichment verdict, or the fallback queue never sees it', () => {
    // `settleFallbackImages` reads `enrichment_status IN ('pending','enriching')`.
    // A property re-opened while still `failed` would climb no rung at all.
    expect(migration).toMatch(/enrichment_status = 'pending'/);
  });

  it('re-arms the scheduler, which unschedules itself when nothing is owed', () => {
    // A deployment whose properties have all settled blank has no job left to
    // run the re-open from, so shipping a generation has to wake it.
    expect(migration).toContain('ensure_builder_stock_settlement_scheduled');
    // Through the same function the insert trigger calls — the schedule is
    // stated once and this migration cannot drift from it.
    expect(migration).not.toMatch(/cron\.schedule\s*\(/);
  });

  it('names no upload, organisation, builder, estate or source', () => {
    const withoutComments = migration
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*--.*$/gm, ' ');
    expect(withoutComments).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    expect(withoutComments).not.toMatch(/https?:\/\//);
    for (const word of ['upload_id =', 'organisation_id =', 'docs.google', 'notion']) {
      expect(withoutComments.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });
});

describe('nothing in this fix is specific to anything', () => {
  const files = [
    'supabase/functions/_shared/builderStock/canonicalIdentity.pure.ts',
    'supabase/functions/_shared/builderStock/storedIdentityRepair.pure.ts',
    'supabase/functions/_shared/builderStock/imagePriority.pure.ts',
  ];

  it('carries no identifier belonging to a deployment', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
      expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
      expect(source).not.toMatch(/https?:\/\/(?!example\.invalid)/);
    }
  });

  it('decides nothing from a source type', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
      for (const word of ['sheets', 'notion', 'csv', 'xlsx', 'gid']) {
        expect(source.toLowerCase()).not.toContain(word);
      }
    }
  });
});

// ── THE HAZARD THE COMPOSITION CREATES, AND ITS GUARD ───────────────────────
/*
 * Composing an address makes stage 3 reachable for properties that could never
 * reach it, which is the point. It also makes a new way of being WRONG
 * reachable: Google answers an estate name it has never heard of by falling
 * back to the locality, and the panorama guard cannot catch that — it measures
 * the panorama against the geocode, and the nearest panorama to the middle of
 * a suburb is a street in that suburb. Every distance check passes on a
 * photograph of somewhere else.
 */
describe('a geocode of a suburb is not a geocode of a property', () => {
  it('refuses a match that resolved only as far as the locality', () => {
    const verdict = assessGeocodePrecision({ types: ['locality', 'political'] });
    expect(verdict.usable).toBe(false);
    expect(verdict.coarsestType).toBe('locality');
    // And it says so in words a builder can act on, not a type name.
    expect(verdict.reason).not.toContain('locality');
  });

  it('refuses a postcode and an administrative area too', () => {
    for (const type of ['postal_code', 'postal_town',
      'administrative_area_level_1', 'administrative_area_level_2', 'country']) {
      expect(assessGeocodePrecision({ types: [type, 'political'] }).usable).toBe(false);
    }
  });

  it('accepts every precision a NAMED ESTATE legitimately resolves to', () => {
    // This is the whole point of composing — an estate is not a street number,
    // and refusing everything short of a rooftop would refuse the feature.
    for (const type of ['street_address', 'premise', 'subpremise', 'route',
      'neighborhood', 'establishment', 'point_of_interest', 'sublocality']) {
      expect(assessGeocodePrecision({ types: [type] }).usable).toBe(true);
    }
  });

  it('a match that states no precision is accepted, never refused', () => {
    // Same rule the panorama guard follows: a missing optional field must not
    // turn a working card blank.
    for (const shape of [{}, { types: [] }, { types: null }, null, undefined]) {
      expect(assessGeocodePrecision(shape).usable).toBe(true);
    }
  });

  it('the panorama distance guard is untouched and still binds', () => {
    // The two guards answer different questions and both have to hold: this
    // one asks whether the POINT is the property, that one whether the CAMERA
    // was near the point.
    const near = assessPanoramaUsefulness(
      { lat: -37.8, lng: 144.9 }, { lat: -37.8, lng: 144.9 });
    expect(near.usable).toBe(true);
    const far = assessPanoramaUsefulness(
      { lat: -37.81, lng: 144.9 }, { lat: -37.8, lng: 144.9 });
    expect(far.usable).toBe(false);
  });

  it('a refused geocode is a FINDING, so the ladder is not asked for it again', () => {
    // It is recorded `unavailable` rather than `failed`: the lookup ran and
    // answered, and the answer is that this property cannot be photographed
    // from a location. Retrying it would buy the same answer.
    const source = readFileSync(
      'supabase/functions/_shared/builderStock/images.ts', 'utf8');
    expect(source).toMatch(/assessGeocodePrecision\(match\)/);
    expect(source).toMatch(/precision\.usable[\s\S]{0,220}'unavailable', precision\.reason/);
  });
});
