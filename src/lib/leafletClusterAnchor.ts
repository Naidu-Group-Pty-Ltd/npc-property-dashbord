import L from 'leaflet';
import 'leaflet.markercluster';

/**
 * Teaches leaflet.markercluster to draw its bubbles on a real property.
 *
 * The library positions every cluster at the weighted average of its members
 * (`_recalculateBounds`), and Australian stock hugs the coastline — so the
 * average of Perth's arc of suburbs is a point in the Indian Ocean, and the
 * bubble counting 285 properties floats in open water. The library keeps two
 * positions per cluster: `_wLatLng`, the weighted average it aggregates with,
 * and `_latlng`, the position it draws. Only the drawn one is overridden, so
 * the internal arithmetic is untouched and clusters are simply *born* on
 * land — no post-hoc snapping, no post-zoom hop.
 *
 * **This must be effectively free.** `_recalculateBounds` runs over the whole
 * cluster tree on every marker add and remove, and the map's markers arrive
 * in waves as fourteen hundred coordinates resolve — the first version of
 * this patch walked every descendant (`getAllChildMarkers`) and sorted them
 * for a median, per cluster, per wave, and froze the page. This version does
 * one flat pass over the cluster's *direct* children, no recursion, no
 * allocation, no sort: child clusters recalculate bottom-up, so a child
 * cluster's own `_latlng` is already anchored on a real property, and
 * inheriting the nearest of those is transitively a real property too.
 */
let installed = false;

interface ClusterInternals {
  _latlng: L.LatLng;
  _wLatLng?: L.LatLng;
  _markers?: Array<{ _latlng?: L.LatLng }>;
  _childClusters?: Array<{ _latlng?: L.LatLng }>;
}

export function installClusterAnchorPatch(): void {
  if (installed) return;
  const proto = (
    L as unknown as { MarkerCluster?: { prototype: Record<string, unknown> } }
  ).MarkerCluster?.prototype;
  if (!proto || typeof proto._recalculateBounds !== 'function') return;
  installed = true;

  const original = proto._recalculateBounds as (this: ClusterInternals) => void;
  proto._recalculateBounds = function patchedRecalculateBounds(this: ClusterInternals): void {
    original.call(this);
    try {
      const centre = this._wLatLng ?? this._latlng;
      if (!centre) return;

      let bestLat = 0;
      let bestLng = 0;
      let bestDistance = Infinity;

      const consider = (at: L.LatLng | undefined) => {
        if (!at) return;
        const d = (at.lat - centre.lat) ** 2 + (at.lng - centre.lng) ** 2;
        if (d < bestDistance) {
          bestDistance = d;
          bestLat = at.lat;
          bestLng = at.lng;
        }
      };

      const markers = this._markers ?? [];
      for (let i = 0; i < markers.length; i += 1) consider(markers[i]._latlng);
      const childClusters = this._childClusters ?? [];
      for (let i = 0; i < childClusters.length; i += 1) consider(childClusters[i]._latlng);

      if (bestDistance < Infinity) this._latlng = new L.LatLng(bestLat, bestLng);
    } catch {
      /* positioning nicety — never let it break clustering itself */
    }
  };
}
