/**
 * Contract tests for internal-message desktop alerts.
 *
 * The behaviours pinned here are the ones that are invisible in a single-tab
 * manual test and expensive in production:
 *
 * 1. DUPLICATE SUPPRESSION IS CROSS-TAB AND CROSS-RELOAD.
 *    Every dashboard tab polls `internal-messaging` independently. An in-memory
 *    "already alerted" map therefore fires once per tab, and again after every
 *    reload. The claim ledger is persisted and shared, so a message notifies
 *    exactly once — while a genuinely newer message in the same thread still
 *    claims and still notifies.
 *
 * 2. BACKLOG IS SEEDED, NOT REPLAYED.
 *    Signing in with ten unread threads must not throw ten OS notifications.
 *
 * 3. THE CLICK ROUTE SURVIVES A CLOSED DASHBOARD.
 *    The service worker reaches an open tab by postMessage (preserving the page
 *    the user was on) and cold-starts one via `?internalThread=` otherwise.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AURIXA_NOTIFICATION_BADGE,
  AURIXA_NOTIFICATION_ICON,
  INTERNAL_NOTIFICATION_KIND,
  INTERNAL_THREAD_DEEPLINK_PARAM,
  SW_OPEN_THREAD_MESSAGE,
  buildAlertCopy,
  getNotificationBadge,
  getNotificationIcon,
  setBrandNotificationIcon,
  claimMessageAlert,
  consumeInternalThreadDeepLink,
  desktopAlertsEnabled,
  hasClaimedMessageAlert,
  internalNotificationTag,
  isDesktopAlertPromptSnoozed,
  messageSoundEnabled,
  resetMessageAlertClaims,
  seedMessageAlert,
  setDesktopAlertsEnabled,
  setMessageSoundEnabled,
  shouldOfferDesktopAlerts,
  snoozeDesktopAlertPrompt,
} from '@/lib/desktopMessageAlerts';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const THREAD = '11111111-2222-3333-4444-555555555555';
const T1 = '2026-08-03T09:00:00.000Z';
const T2 = '2026-08-03T09:05:00.000Z';

beforeEach(() => {
  localStorage.clear();
  resetMessageAlertClaims();
  setBrandNotificationIcon(null);
});

describe('duplicate-notification prevention', () => {
  it('lets exactly one caller claim a given message', () => {
    expect(claimMessageAlert(THREAD, T1)).toBe(true);
    // A second tab polling the same message must not alert again.
    expect(claimMessageAlert(THREAD, T1)).toBe(false);
    expect(claimMessageAlert(THREAD, T1)).toBe(false);
  });

  it('still alerts on a genuinely newer message in the same thread', () => {
    expect(claimMessageAlert(THREAD, T1)).toBe(true);
    expect(claimMessageAlert(THREAD, T2)).toBe(true);
    // ...but never re-alerts on the older one arriving out of order.
    expect(claimMessageAlert(THREAD, T1)).toBe(false);
  });

  it('persists claims so a reload does not replay the notification', () => {
    expect(claimMessageAlert(THREAD, T1)).toBe(true);
    // Simulate a fresh page load: the module's in-memory mirror is dropped and
    // rebuilt from localStorage exactly as it is on boot.
    window.dispatchEvent(new StorageEvent('storage', { key: 'aurixa.internalMessages.alertClaims' }));
    expect(hasClaimedMessageAlert(THREAD, T1)).toBe(true);
    expect(claimMessageAlert(THREAD, T1)).toBe(false);
  });

  it('seeds a backlog as already-seen without alerting', () => {
    seedMessageAlert(THREAD, T1);
    expect(claimMessageAlert(THREAD, T1)).toBe(false);
    // A message that arrives after the seed is still new.
    expect(claimMessageAlert(THREAD, T2)).toBe(true);
  });

  it('tracks threads independently', () => {
    expect(claimMessageAlert('thread-a', T1)).toBe(true);
    expect(claimMessageAlert('thread-b', T1)).toBe(true);
  });

  it('ignores empty identifiers rather than poisoning the ledger', () => {
    expect(claimMessageAlert('', T1)).toBe(false);
    expect(claimMessageAlert(THREAD, '')).toBe(false);
  });
});

describe('notification copy', () => {
  it('names the sender and previews the message for a direct message', () => {
    const { heading, body } = buildAlertCopy({
      thread_id: THREAD,
      title: 'Priya Naidu',
      sender: 'Priya Naidu',
      body: 'Can you look at the Kellyville valuation before 3pm?',
      kind: 'direct',
    });
    expect(heading).toBe('Priya Naidu');
    expect(body).toBe('Can you look at the Kellyville valuation before 3pm?');
  });

  it('names both the sender and the room for a group message', () => {
    const { heading } = buildAlertCopy({
      thread_id: THREAD,
      title: 'Acquisitions',
      sender: 'Priya Naidu',
      body: 'Settlement moved',
      kind: 'group',
    });
    expect(heading).toBe('Priya Naidu in Acquisitions');
  });

  it('flags urgent messages in the heading', () => {
    const { heading } = buildAlertCopy({
      thread_id: THREAD,
      title: 'Priya Naidu',
      sender: 'Priya Naidu',
      body: 'Call me',
      kind: 'direct',
      priority: 'urgent',
    });
    expect(heading.startsWith('🔴 Urgent · ')).toBe(true);
  });

  it('describes an attachment-only message instead of showing an empty bubble', () => {
    const { body } = buildAlertCopy({
      thread_id: THREAD,
      title: 'Priya Naidu',
      sender: 'Priya Naidu',
      body: '   ',
      kind: 'direct',
      hasAttachments: true,
    });
    expect(body).toBe('Sent an attachment');
  });

  it('truncates long previews and collapses newlines', () => {
    const { body } = buildAlertCopy({
      thread_id: THREAD,
      title: 'Priya Naidu',
      sender: 'Priya Naidu',
      body: `line one\nline two ${'x'.repeat(400)}`,
      kind: 'direct',
    });
    expect(body).not.toContain('\n');
    expect(body.length).toBeLessThanOrEqual(180);
    expect(body.endsWith('…')).toBe(true);
  });
});

describe('preferences and the opt-in invitation', () => {
  it('defaults both alerts and sound to on', () => {
    expect(desktopAlertsEnabled()).toBe(true);
    expect(messageSoundEnabled()).toBe(true);
  });

  it('round-trips the opt-outs independently', () => {
    setDesktopAlertsEnabled(false);
    expect(desktopAlertsEnabled()).toBe(false);
    expect(messageSoundEnabled()).toBe(true);

    setMessageSoundEnabled(false);
    setDesktopAlertsEnabled(true);
    expect(desktopAlertsEnabled()).toBe(true);
    expect(messageSoundEnabled()).toBe(false);
  });

  it('goes quiet for a week when the invitation is ignored', () => {
    expect(isDesktopAlertPromptSnoozed()).toBe(false);
    snoozeDesktopAlertPrompt();
    expect(isDesktopAlertPromptSnoozed()).toBe(true);
    expect(shouldOfferDesktopAlerts()).toBe(false);
  });

  it('never offers the invitation to someone who switched alerts off', () => {
    setDesktopAlertsEnabled(false);
    expect(shouldOfferDesktopAlerts()).toBe(false);
  });
});

describe('deep linking back to a conversation', () => {
  it('reads the thread id and strips it from the address bar', () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    window.history.replaceState({}, '', `/dashboard?${INTERNAL_THREAD_DEEPLINK_PARAM}=${THREAD}&tab=x`);

    expect(consumeInternalThreadDeepLink()).toBe(THREAD);
    expect(window.location.search).not.toContain(INTERNAL_THREAD_DEEPLINK_PARAM);
    // Unrelated params survive — the deep link must not eat existing state.
    expect(window.location.search).toContain('tab=x');
    // A second read finds nothing, so a re-render cannot re-open the thread.
    expect(consumeInternalThreadDeepLink()).toBeNull();
    replaceState.mockRestore();
  });

  it('returns null when no deep link is present', () => {
    window.history.replaceState({}, '', '/dashboard');
    expect(consumeInternalThreadDeepLink()).toBeNull();
  });
});

describe('service worker click routing', () => {
  const sw = read('public/sw-push.js');

  it('recognises internal message notifications', () => {
    expect(sw).toContain(`const INTERNAL_MESSAGE_KIND = '${INTERNAL_NOTIFICATION_KIND}'`);
    expect(sw).toContain(`const OPEN_INTERNAL_THREAD_MESSAGE = '${SW_OPEN_THREAD_MESSAGE}'`);
  });

  it('reaches an open dashboard by postMessage rather than navigating it', () => {
    const handler = sw.slice(sw.indexOf('async function openInternalThread'));
    expect(handler).toContain('client.focus()');
    expect(handler).toContain('client.postMessage(');
    // Navigating an open tab would discard whatever the user was working on.
    expect(handler.slice(0, handler.indexOf('openWindow'))).not.toContain('client.navigate');
  });

  it('cold-starts a deep-linked window when no dashboard is open', () => {
    expect(sw).toContain(`'/?${INTERNAL_THREAD_DEEPLINK_PARAM}=' + encodeURIComponent`);
  });

  it('treats the Dismiss action as an acknowledgement, opening nothing', () => {
    expect(sw).toContain("if (event.action === 'dismiss') return;");
  });

  it('leaves the existing Web Push click behaviour intact', () => {
    expect(sw).toContain("await client.navigate(targetUrl)");
    expect(sw).toContain('await self.clients.openWindow(targetUrl)');
  });
});

describe('notification branding', () => {
  it('falls back to the Aurixa Systems mark when no white-label logo is set', () => {
    expect(getNotificationIcon()).toBe(AURIXA_NOTIFICATION_ICON);
    expect(AURIXA_NOTIFICATION_ICON).not.toContain('favicon.ico');
  });

  it('uses the white-label logo when branding provides one', () => {
    setBrandNotificationIcon('https://cdn.example.com/tenant-mark.png');
    expect(getNotificationIcon()).toBe('https://cdn.example.com/tenant-mark.png');
  });

  it('reverts to Aurixa when the white-label logo is removed', () => {
    setBrandNotificationIcon('https://cdn.example.com/tenant-mark.png');
    setBrandNotificationIcon(null);
    expect(getNotificationIcon()).toBe(AURIXA_NOTIFICATION_ICON);
  });

  it('treats an empty or whitespace logo as no logo', () => {
    setBrandNotificationIcon('   ');
    expect(getNotificationIcon()).toBe(AURIXA_NOTIFICATION_ICON);
  });

  it('refuses the stock scaffold icon even if branding hands it over', () => {
    // The stock mark is the one thing that must never reach a notification.
    setBrandNotificationIcon('/favicon.ico');
    expect(getNotificationIcon()).toBe(AURIXA_NOTIFICATION_ICON);
  });

  it('keeps the monochrome Aurixa glyph in the badge slot', () => {
    // Android discards badge colour and keeps only alpha, so a client's
    // full-colour logo would render as a grey block.
    setBrandNotificationIcon('https://cdn.example.com/tenant-mark.png');
    expect(getNotificationBadge()).toBe(AURIXA_NOTIFICATION_BADGE);
  });

  it('ships the default artwork the fallbacks point at', () => {
    for (const asset of [AURIXA_NOTIFICATION_ICON, AURIXA_NOTIFICATION_BADGE]) {
      expect(existsSync(join(REPO_ROOT, 'public', asset))).toBe(true);
    }
  });

  it('leaves no stock-icon reference on any notification path', () => {
    for (const file of [
      'src/lib/desktopMessageAlerts.ts',
      'src/hooks/useEmailNotifications.tsx',
      'public/sw-push.js',
    ]) {
      const source = read(file);
      // The only permitted mentions are the constant that names it in order to
      // refuse it, and the comments explaining why.
      const offending = source
        .split('\n')
        .filter((line) => line.includes('favicon.ico'))
        .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
        .filter((line) => !line.includes('STOCK_FAVICON ='));
      expect(offending).toEqual([]);
    }
  });

  it('publishes the tenant mark from BrandProvider so alerts follow branding', () => {
    const provider = read('src/branding/BrandProvider.tsx');
    expect(provider).toContain("setBrandNotificationIcon(getBrandAssetSrc(settings, 'favicon'))");
  });

  it('declares an explicit favicon so the browser never guesses the stock one', () => {
    const html = read('index.html');
    expect(html).toContain(`href="${AURIXA_NOTIFICATION_ICON}"`);
    expect(html).not.toContain('content="/favicon.ico"');
  });

  it('keeps the stock icon out of the PWA manifest', () => {
    expect(read('public/manifest.json')).not.toContain('favicon.ico');
  });
});

describe('platform wiring', () => {
  it('mounts the alert surface on every dashboard route, mobile and desktop', () => {
    const layout = read('src/components/layout/DashboardLayout.tsx');
    expect(layout.match(/<InternalMessageToasts \/>/g)?.length).toBe(2);
  });

  it('exposes a durable way to turn alerts on or off', () => {
    const settings = read('src/pages/Settings.tsx');
    expect(settings).toContain('<DesktopMessageAlertsToggle />');
  });

  it('tags one notification per conversation so messages collapse, not stack', () => {
    expect(internalNotificationTag(THREAD)).toBe(`aurixa-internal-${THREAD}`);
  });

  it('keeps the in-app fallback for every non-OS outcome', () => {
    const toasts = read('src/components/agent/InternalMessageToasts.tsx');
    // Focused tab = the chip already told them; anything else owes a fallback.
    expect(toasts).toContain("if (outcome === 'suppressed-focused') return;");
    expect(toasts).toContain('missedRef.current.set(');
    expect(toasts).toContain('setTabUnreadBadge(totalUnread');
  });
});
