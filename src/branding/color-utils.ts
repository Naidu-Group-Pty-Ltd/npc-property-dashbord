function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeHslString(hsl: unknown, fallback: string): string {
  if (typeof hsl !== 'string' || !hsl) return fallback;

  const parts = hsl.match(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
  if (!parts) return fallback;

  const h = ((Number(parts[1]) % 360) + 360) % 360;
  const s = clamp(Number(parts[2]), 0, 100);
  const l = clamp(Number(parts[3]), 0, 100);
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;
}

export function parseHsl(hsl: string): { h: number; s: number; l: number } {
  const normalized = normalizeHslString(hsl, hsl);
  const parts = normalized.match(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);

  if (!parts) {
    return { h: 43, s: 74, l: 49 };
  }

  return {
    h: Number(parts[1]),
    s: Number(parts[2]),
    l: Number(parts[3]),
  };
}

export function formatHsl({ h, s, l }: { h: number; s: number; l: number }): string {
  return `${Math.round(((h % 360) + 360) % 360)} ${Math.round(clamp(s, 0, 100))}% ${Math.round(clamp(l, 0, 100))}%`;
}

export function shiftLightness(hsl: string, delta: number): string {
  const { h, s, l } = parseHsl(hsl);
  return formatHsl({ h, s, l: clamp(l + delta, 0, 100) });
}

export function shiftSaturation(hsl: string, delta: number): string {
  const { h, s, l } = parseHsl(hsl);
  return formatHsl({ h, s: clamp(s + delta, 0, 100), l });
}

export function rotateHue(hsl: string, delta: number): string {
  const { h, s, l } = parseHsl(hsl);
  return formatHsl({ h: h + delta, s, l });
}

export function relativeLuminanceFromHsl(hsl: string): number {
  const { h, s, l } = parseHsl(hsl);
  const hue = h / 360;
  const sat = s / 100;
  const lig = l / 100;

  const hue2rgb = (p: number, q: number, t: number) => {
    let adjusted = t;
    if (adjusted < 0) adjusted += 1;
    if (adjusted > 1) adjusted -= 1;
    if (adjusted < 1 / 6) return p + (q - p) * 6 * adjusted;
    if (adjusted < 1 / 2) return q;
    if (adjusted < 2 / 3) return p + (q - p) * (2 / 3 - adjusted) * 6;
    return p;
  };

  let r: number;
  let g: number;
  let b: number;

  if (sat === 0) {
    r = lig;
    g = lig;
    b = lig;
  } else {
    const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
    const p = 2 * lig - q;
    r = hue2rgb(p, q, hue + 1 / 3);
    g = hue2rgb(p, q, hue);
    b = hue2rgb(p, q, hue - 1 / 3);
  }

  const toLinear = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

  const rLin = toLinear(r);
  const gLin = toLinear(g);
  const bLin = toLinear(b);

  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

export function getReadableForeground(backgroundHsl: string, dark = '0 0% 5%', light = '0 0% 100%') {
  return relativeLuminanceFromHsl(backgroundHsl) > 0.45 ? dark : light;
}

export function hexToHsl(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '43 74% 49%';

  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function hslToHex(hsl: string): string {
  const parts = hsl.match(/(\d+)\s+(\d+)%?\s+(\d+)%?/);
  if (!parts) return '#D4A017';

  const h = parseInt(parts[1], 10) / 360;
  const s = parseInt(parts[2], 10) / 100;
  const l = parseInt(parts[3], 10) / 100;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r: number;
  let g: number;
  let b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number) => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? `0${hex}` : hex;
  };

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
