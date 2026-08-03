/**
 * Rasterise the Aurixa Systems mark into every raster surface the app serves.
 *
 * Why PNG and not the SVG directly: Chromium does not reliably decode SVG for
 * `Notification.icon` / `badge`, and Android's status-bar badge needs a real
 * alpha channel. The SVGs in `public/brand/` stay the source of truth — run
 * `npm run brand:icons` after editing one.
 *
 * `public/favicon.ico` is generated here too, and that is deliberate. Redirecting
 * every *reference* away from the stock scaffold icon still leaves the stock icon
 * being served at `/favicon.ico` — reachable through a cached manifest, a
 * platform-injected tag, or Chromium's own fallback when a notification icon
 * fails to load. Owning the file closes that off.
 *
 * Usage:
 *   npm run brand:icons            # regenerate
 *   npm run brand:icons -- --check # fail if the committed output is stale
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BRAND_DIR = join(ROOT, 'public', 'brand');
const PUBLIC_DIR = join(ROOT, 'public');

const FULL = 'aurixa-mark.svg';
/** Rings and speculars turn to noise below ~48px; the compact mark drops them. */
const COMPACT = 'aurixa-mark-compact.svg';

/** Standalone PNGs. `transparent` keeps the alpha for badge glyphs. */
const PNG_TARGETS = [
  { svg: FULL, out: 'aurixa-notification-192.png', size: 192, transparent: false },
  { svg: FULL, out: 'aurixa-notification-512.png', size: 512, transparent: false },
  { svg: 'aurixa-badge.svg', out: 'aurixa-badge-96.png', size: 96, transparent: true },
];

/** Sub-images packed into favicon.ico, smallest first. */
const ICO_SIZES = [
  { svg: COMPACT, size: 16 },
  { svg: COMPACT, size: 32 },
  { svg: FULL, size: 48 },
  { svg: FULL, size: 64 },
  { svg: FULL, size: 128 },
  { svg: FULL, size: 256 },
];

const check = process.argv.includes('--check');

/**
 * Pack PNGs into an ICO container. Every browser in support has read
 * PNG-compressed ICO entries for over a decade, so no BMP encoding is needed.
 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;

  entries.forEach((entry, i) => {
    const at = i * 16;
    // 256 is stored as 0 — the field is a single byte.
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    directory.writeUInt8(0, at + 2); // palette size (0 = truecolour)
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.buffer.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.buffer.length;
  });

  return Buffer.concat([header, directory, ...entries.map((e) => e.buffer)]);
}

async function render(browser, svgName, size, transparent) {
  const svg = readFileSync(join(BRAND_DIR, svgName), 'utf8');
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>
       html,body{margin:0;padding:0;background:transparent}
       svg{display:block;width:${size}px;height:${size}px}
     </style>
     ${svg}`,
    { waitUntil: 'load' },
  );
  const buffer = await page.screenshot({ omitBackground: !!transparent });
  await page.close();
  return buffer;
}

/**
 * CI images often ship one Chromium build while the pinned Playwright wants
 * another, so try an explicit binary, then the managed one.
 */
async function launch() {
  const candidates = [process.env.CHROMIUM_EXECUTABLE_PATH, undefined];
  let lastError;
  for (const executablePath of candidates) {
    try {
      return await chromium.launch(executablePath ? { executablePath } : {});
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

let browser;
try {
  browser = await launch();
} catch (error) {
  // Freshness checking is advisory: an agent without a browser should not turn
  // a green pipeline red over artwork nobody touched.
  const hint =
    'No usable Chromium. Set CHROMIUM_EXECUTABLE_PATH or run: npx playwright install chromium';
  if (check) {
    console.warn(`skip  icon freshness check — ${hint}`);
    process.exit(0);
  }
  console.error(`${hint}\n${error?.message ?? error}`);
  process.exit(1);
}

let stale = 0;

function emit(absolutePath, label, buffer) {
  const current = existsSync(absolutePath) ? readFileSync(absolutePath) : null;
  if (current && current.equals(buffer)) {
    console.log(`ok    ${label}`);
    return;
  }
  if (check) {
    stale += 1;
    console.error(`stale ${label} — run: npm run brand:icons`);
    return;
  }
  writeFileSync(absolutePath, buffer);
  console.log(`wrote ${label} (${buffer.length} bytes)`);
}

try {
  mkdirSync(BRAND_DIR, { recursive: true });

  for (const target of PNG_TARGETS) {
    const buffer = await render(browser, target.svg, target.size, target.transparent);
    emit(join(BRAND_DIR, target.out), target.out, buffer);
  }

  const icoEntries = [];
  for (const entry of ICO_SIZES) {
    icoEntries.push({ size: entry.size, buffer: await render(browser, entry.svg, entry.size) });
  }
  emit(join(PUBLIC_DIR, 'favicon.ico'), 'favicon.ico', buildIco(icoEntries));
} finally {
  await browser.close();
}

if (stale) process.exit(1);
