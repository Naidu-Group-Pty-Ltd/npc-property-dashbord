import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';

export interface HeatPoint {
  lat: number;
  lng: number;
  intensity: number;
}

interface HeatLayerProps {
  points: HeatPoint[];
  visible: boolean;
}

function readToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value ? `hsl(${value})` : fallback;
}

export function HeatLayer({ points, visible }: HeatLayerProps) {
  const map = useMap();

  useEffect(() => {
    if (!visible || points.length === 0) return;

    const gradient = {
      0.2: readToken('--success', 'hsl(150 60% 45%)'),
      0.45: readToken('--primary', 'hsl(43 62% 55%)'),
      0.7: readToken('--warning', 'hsl(38 92% 55%)'),
      1.0: readToken('--destructive', 'hsl(0 72% 55%)'),
    } as Record<number, string>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layer = (L as any).heatLayer(
      points.map((p) => [p.lat, p.lng, p.intensity]),
      { radius: 28, blur: 22, maxZoom: 13, minOpacity: 0.32, gradient },
    );

    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map, points, visible]);

  return null;
}

export default HeatLayer;
