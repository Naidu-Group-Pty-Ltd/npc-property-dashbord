import L from 'leaflet';
import 'leaflet.markercluster';
import { robustClusterAnchor } from '@/lib/listingsMap';

/**
 * Teaches leaflet.markercluster to draw its bubbles on a real property.
 *
 * The library positions every cluster at the weighted average of its members
 * (`_recalculateBounds`), and Australian stock hugs the coastline — so the
 * average of Perth's arc of suburbs is a point in the Indian Ocean, and the
 * bubble counting 285 properties floats in open water. The first fix moved
 * bubbles *after* the library placed them, which worked but announced itself:
 * every zoom ended with the bubbles visibly hopping from the sea onto land a
 * frame later, and it had a degenerate case when the library had anchored a
 * bubble on a member that was itself a wrong coordinate.
 *
 * This replaces that chase with a patch at the source. The library keeps two
 * positions per cluster: `_wLatLng`, the weighted average it uses for parent
 * aggregation math, and `_latlng`, the position it actually draws. Only the
 * drawn one is overridden — to the member nearest the coordinate-wise median,
 * a real property that one outlier cannot drag offshore — so the library's
 * internal arithmetic is untouched and clusters are simply *born* on land.
 * No events to chase, no post-zoom hop, correct during animations.
 */
let installed = false;

interface ClusterInternals {
  _latlng: L.LatLng;
  getAllChildMarkers?: () => L.Marker[];
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
      const markers = this.getAllChildMarkers?.() ?? [];
      if (markers.length < 2) return;
      const anchor = robustClusterAnchor(
        markers.map((marker) => {
          const at = marker.getLatLng();
          return { lat: at.lat, lng: at.lng };
        }),
      );
      if (anchor) this._latlng = new L.LatLng(anchor.lat, anchor.lng);
    } catch {
      /* positioning nicety — never let it break clustering itself */
    }
  };
}
