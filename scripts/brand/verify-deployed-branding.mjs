/**
 * Verify that a DEPLOYED site is actually serving the branded notification
 * artwork — not just that the repository contains it.
 *
 * Why this exists: the notification-branding work was merged to `main` and the
 * stock scaffold heart kept appearing in production for days. Every repo-side
 * check was green the whole time. The site had simply never been republished,
 * so the published bundle predated the fix — and nothing in the repo can
 * observe that. Three HTTP probes settle it in seconds:
 *
 *   1. `/favicon.ico` must not be the stock heart, and must be a real ICO.
 *   2. `/brand/*` must be served (a 404 means the build predates the assets).
 *   3. `/sw-push.js` must carry the branded default, not `/favicon.ico`.
 *
 * Usage:
 *   npm run verify:branding                        # uses DEPLOY_URL
 *   npm run verify:branding -- https://example.com
 */
import { createHash } from 'node:crypto';

/**
 * sha256 of the scaffold's stock heart as it shipped: a 73x74 PNG named `.ico`.
 * Pinned identically in `desktopMessageAlertsContract.test.ts` — if you change
 * one, change both.
 */
const STOCK_HEART_SHA256 =
  '29a40d56580a5366083461297773dbf146ec043d1156f432f5472cb3487f506b';

const BRANDED_ICON = '/brand/aurixa-notification-192.png';
const BRANDED_BADGE = '/brand/aurixa-badge-96.png';

const target = (process.argv[2] || process.env.DEPLOY_URL || '').replace(/\/+$/, '');
if (!target) {
  console.error('Usage: npm run verify:branding -- https://your-site.example');
  console.error('   or: DEPLOY_URL=https://your-site.example npm run verify:branding');
  process.exit(2);
}

// Some edges refuse requests without a browser-shaped User-Agent.
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Cache-Control': 'no-cache',
};

async function fetchPath(path) {
  try {
    const response = await fetch(`${target}${path}`, { headers: HEADERS, redirect: 'follow' });
    const buffer = Buffer.from(await response.arrayBuffer());
    return { ok: response.ok, status: response.status, buffer };
  } catch (error) {
    return { ok: false, status: 0, buffer: Buffer.alloc(0), error };
  }
}

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
};

console.log(`Verifying deployed branding at ${target}\n`);

// 1. The stock heart must not be served.
{
  const { ok, status, buffer } = await fetchPath('/favicon.ico');
  if (!ok) {
    record('favicon.ico is reachable', false, `HTTP ${status}`);
  } else {
    const digest = createHash('sha256').update(buffer).digest('hex');
    const isHeart = digest === STOCK_HEART_SHA256;
    // A genuine ICO opens reserved=0, type=1. The stock file was a bare PNG.
    const isIco = buffer.length > 6 && buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1;
    record(
      'favicon.ico is not the stock heart',
      !isHeart,
      isHeart
        ? `serving the stock heart (sha256 ${digest.slice(0, 16)}…, ${buffer.length}b)`
        : `sha256 ${digest.slice(0, 16)}…, ${buffer.length}b`,
    );
    record(
      'favicon.ico is a real multi-size ICO',
      isIco,
      isIco
        ? `${buffer.readUInt16LE(4)} sub-images`
        : `header ${buffer.subarray(0, 4).toString('hex')} — not an ICO container`,
    );
  }
}

// 2. The branded artwork must actually be served.
for (const path of [BRANDED_ICON, BRANDED_BADGE]) {
  const { ok, status, buffer } = await fetchPath(path);
  const isPng = buffer.subarray(0, 4).toString('hex') === '89504e47';
  record(
    `${path} is served`,
    ok && isPng,
    ok
      ? isPng
        ? `HTTP ${status}, ${buffer.length}b PNG`
        : `HTTP ${status} but not a PNG — check for an SPA catch-all rewrite`
      : `HTTP ${status} — this build predates the branded assets`,
  );
}

// 3. The service worker's fallback must be branded.
{
  const { ok, status, buffer } = await fetchPath('/sw-push.js');
  const source = buffer.toString('utf8');
  const stockFallback = source.includes("data.icon || '/favicon.ico'");
  const brandedFallback = source.includes('DEFAULT_NOTIFICATION_ICON');
  record(
    'sw-push.js falls back to branded artwork',
    ok && brandedFallback && !stockFallback,
    !ok
      ? `HTTP ${status}`
      : stockFallback
        ? "still falls back to '/favicon.ico' — this build predates the fix"
        : brandedFallback
          ? 'branded default present'
          : 'unrecognised service worker',
  );
}

const failed = results.filter((r) => !r.pass);
console.log('');
if (!failed.length) {
  console.log(`All ${results.length} checks passed — the deployment is serving branded artwork.`);
  process.exit(0);
}

console.error(`${failed.length} of ${results.length} checks failed.`);
console.error(
  '\nThe repository can be entirely correct while this fails: it means the site\n' +
    'has not been rebuilt and republished since the branding change merged.\n' +
    'Publish the current `main`, then re-run this command.\n' +
    '\nNote that browsers cache favicons and service workers aggressively, so a\n' +
    'hard reload (or a fresh profile) may be needed before a human sees the change.',
);
process.exit(1);
