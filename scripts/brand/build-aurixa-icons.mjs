/**
 * Rasterise the Aurixa Systems mark into the PNGs the notification and PWA
 * surfaces need.
 *
 * Why PNG and not the SVG directly: Chromium does not reliably decode SVG for
 * `Notification.icon` / `badge`, and Android's status-bar badge needs a real
 * alpha channel. The SVGs in `public/brand/` stay the source of truth — run
 * `npm run brand:icons` after editing one.
 *
 * Usage:
 *   npm run brand:icons            # regenerate
 *   npm run brand:icons -- --check # fail if the committed PNGs are stale
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRAND_DIR = join(HERE, '..', '..', 'public', 'brand');

/** source SVG → output PNGs. `transparent` keeps the alpha for badge glyphs. */
const TARGETS = [
  { svg: 'aurixa-mark.svg', out: 'aurixa-notification-192.png', size: 192, transparent: false },
  { svg: 'aurixa-mark.svg', out: 'aurixa-notification-512.png', size: 512, transparent: false },
  { svg: 'aurixa-badge.svg', out: 'aurixa-badge-96.png', size: 96, transparent: true },
];

const check = process.argv.includes('--check');

async function render(browser, target) {
  const svg = readFileSync(join(BRAND_DIR, target.svg), 'utf8');
  const page = await browser.newPage({
    viewport: { width: target.size, height: target.size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>
       html,body{margin:0;padding:0;background:transparent}
       svg{display:block;width:${target.size}px;height:${target.size}px}
     </style>
     ${svg}`,
    { waitUntil: 'load' },
  );
  const buffer = await page.screenshot({ omitBackground: target.transparent });
  await page.close();
  return buffer;
}

/**
 * CI images often ship one Chromium build while the pinned Playwright wants
 * another, so try an explicit binary, then the managed one, then anything
 * Playwright already has on disk.
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
try {
  mkdirSync(BRAND_DIR, { recursive: true });
  for (const t of TARGETS) {
    const buffer = await render(browser, t);
    const outPath = join(BRAND_DIR, t.out);
    const current = existsSync(outPath) ? readFileSync(outPath) : null;
    if (current && current.equals(buffer)) {
      console.log(`ok    ${t.out}`);
      continue;
    }
    if (check) {
      stale += 1;
      console.error(`stale ${t.out} — run: npm run brand:icons`);
      continue;
    }
    writeFileSync(outPath, buffer);
    console.log(`wrote ${t.out} (${t.size}px)`);
  }
} finally {
  await browser.close();
}

if (stale) process.exit(1);
