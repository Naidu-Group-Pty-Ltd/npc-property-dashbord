import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source contract for the cluster anchor patch.
 *
 * The patch lives inside `_recalculateBounds`, which leaflet.markercluster
 * runs over the whole cluster tree on every marker add and remove — and this
 * map's markers arrive in waves as coordinates resolve. The first version
 * walked every descendant and sorted them for a median, per cluster, per
 * wave, and froze the page hard enough to be reported as "the map is
 * glitching and not loading". These assertions pin the properties that make
 * the patch safe to run at that frequency, so a future edit cannot
 * reintroduce the freeze without a test telling on it.
 */
const src = readFileSync(join(__dirname, 'leafletClusterAnchor.ts'), 'utf8');

describe('leafletClusterAnchor source contract', () => {
  it('patches _recalculateBounds and calls the original first', () => {
    expect(src).toContain("_recalculateBounds");
    expect(src).toContain('original.call(this)');
  });

  it('never walks the full descendant tree — direct children only', () => {
    // getAllChildMarkers recurses and allocates; at tree × wave frequency it
    // is the difference between free and frozen.
    // Call sites only — the comment is allowed to name the trap it avoids.
    expect(src).not.toMatch(/\.getAllChildMarkers/);
    expect(src).toContain('this._markers');
    expect(src).toContain('this._childClusters');
  });

  it('never sorts — one flat pass, no allocation', () => {
    expect(src).not.toMatch(/\.sort\(/);
    expect(src).not.toMatch(/\.map\(/);
  });

  it('overrides only the drawn position, never the aggregation position', () => {
    // _wLatLng feeds the library's parent-cluster arithmetic; writing to it
    // would corrupt every ancestor's position.
    expect(src).toContain('this._latlng = new L.LatLng');
    expect(src).not.toMatch(/this\._wLatLng\s*=/);
  });

  it('cannot break clustering itself', () => {
    expect(src).toContain('catch');
  });
});
