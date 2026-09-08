import { describe, expect, it } from 'vitest';

import {
  assessAddressInput,
  assessCoordinateIsAPlace,
  KNOWN_FAILURE_COORDINATES,
} from '@/lib/reports/location/addressInputQuality.pure';

/**
 * ME-5.1 item 7.
 *
 * Every string below is a verbatim `investment_reports.property_address` from
 * production. Invented fixtures would only prove the assertion matches the
 * fixture.
 */

/** Real addresses that produced a foreign or fallback coordinate. */
const CORRUPTED: Array<[string, string]> = [
  ['Unknown Property (recekKBh9NIZaebhq)', 'Airtable record id'],
  ['Property from Lot 2267 - Brochure - Parklea-151 (Lisbon - LHS).pdf', 'PDF filename → Lisbon'],
  ['Properties in 4510 Bellmore', 'listing fragment → New York'],
];

/** Real, legitimate addresses that carry NO Australian anchor and resolved correctly. */
const LEGITIMATE_UNANCHORED = [
  '42 Lowanna Drive',      // → Buddina, QLD
  '285 Old Toowoomba Road', // → Gatton, QLD
  '19 McDonald Street',     // → Mordialloc, VIC
  '8 Agett Way',            // → Northam, WA
  '2 Bliss Lane',           // → South Ripley, QLD
];

describe('address input quality', () => {
  describe('what is not an address is refused before the geocoder is called', () => {
    it.each(CORRUPTED)('refuses %j (%s)', (addr) => {
      const a = assessAddressInput(addr);
      expect(a.kind).toBe('not_an_address');
      expect(a.mayGeocode).toBe(false);
    });

    it('says why a geocoder must not simply be asked', () => {
      expect(assessAddressInput(CORRUPTED[0][0]).reason)
        .toMatch(/a geocoder always answers/);
    });

    it('refuses an empty address as absent rather than as garbage', () => {
      for (const empty of ['', '   ', null, undefined]) {
        const a = assessAddressInput(empty);
        expect(a.kind).toBe('absent');
        expect(a.mayGeocode).toBe(false);
      }
    });
  });

  describe('a missing Australian anchor is disclosed, never refused', () => {
    it.each(LEGITIMATE_UNANCHORED)('lets %j through while reporting it is unanchored', (addr) => {
      const a = assessAddressInput(addr);
      expect(a.kind).toBe('usable');
      expect(a.mayGeocode).toBe(true);
      expect(a.anchor).toBe('unanchored');
    });

    it('states the measured reason a required anchor was rejected as a gate', () => {
      expect(assessAddressInput('42 Lowanna Drive').reason).toMatch(/63\.7% of\s+legitimate/);
    });

    it('marks a properly anchored address as anchored', () => {
      for (const addr of [
        '54 Foxtail Circuit, Wallan VIC 3756, Australia',
        '23 MACKAY Street, Moranbah QLD 4744',
        '12/33 Bronte Street, East Perth, WA 6004',
      ]) {
        expect(assessAddressInput(addr).anchor).toBe('anchored');
        expect(assessAddressInput(addr).mayGeocode).toBe(true);
      }
    });

    it('an anchor does not rescue something that is not an address', () => {
      // Real: carries `WA` and a four-digit run, and geocoded to Washington State.
      const a = assessAddressInput('Properties in 4510 Bellmore');
      expect(a.anchor).toBe('anchored');
      expect(a.mayGeocode).toBe(false);
    });
  });

  describe('a coordinate that is a known failure value is not a location', () => {
    it('rejects Sydney CBD to four decimal places', () => {
      const v = assessCoordinateIsAPlace(-33.8688, 151.2093);
      expect(v.ok).toBe(false);
      expect(v.failureValue).toBe('Sydney CBD');
      expect(v.reason).toMatch(/none of their addresses mentions Sydney|64 stored reports/);
    });

    it('rejects the centre of the continent', () => {
      expect(assessCoordinateIsAPlace(-25.2744, 133.7751).ok).toBe(false);
    });

    it('accepts a genuine coordinate a few hundred metres from the fallback', () => {
      // A real Sydney CBD property must still resolve; only the exact constant is refused.
      expect(assessCoordinateIsAPlace(-33.8712, 151.2065).ok).toBe(true);
    });

    it('accepts ordinary Australian coordinates', () => {
      for (const [lat, lng] of [
        [-21.9993496, 148.0641236],  // Moranbah QLD
        [-31.9505, 115.8605 + 0.01], // near Perth
        [-37.8136 + 0.02, 144.9631], // near Melbourne
      ]) {
        expect(assessCoordinateIsAPlace(lat, lng).ok).toBe(true);
      }
    });

    it('rejects a non-numeric coordinate rather than throwing', () => {
      expect(assessCoordinateIsAPlace('x', 151).ok).toBe(false);
      expect(assessCoordinateIsAPlace(null, undefined).ok).toBe(false);
    });

    it('documents every failure value it knows, with why', () => {
      expect(KNOWN_FAILURE_COORDINATES.length).toBeGreaterThanOrEqual(2);
      for (const f of KNOWN_FAILURE_COORDINATES) {
        expect(f.why.length).toBeGreaterThan(30);
        expect(f.label.length).toBeGreaterThan(3);
      }
    });
  });
});
