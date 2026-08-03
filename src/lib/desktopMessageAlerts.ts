/**
 * Desktop alerts for internal staff messages.
 *
 * Problem: when the Command Centre tab is in the background (another tab,
 * another window, minimised browser) the in-app chip/pop-up is invisible, so
 * inbound team messages went unnoticed.
 *
 * Strategy — three independent, layered signals, all client-side and all
 * non-blocking:
 *   1. Native OS notification (Notification API) — rendered by the operating
 *      system, so it shows even while the tab is backgrounded. Clicking it
 *      focuses the dashboard and pops the conversation open.
 *   2. Tab title badge + favicon-free "(3) New message" flashing so an
 *      un-focused-but-visible tab still signals.
 *   3. A short audible ping.
 *
 * Nothing here fetches or trusts message content from the wire — callers pass
 * already-verified data loaded through the `internal-messaging` edge function.
 */
import { requestPopOutInternalThread } from '@/lib/internalMessagingBus';

const PREF_KEY = 'aurixa.internalMessages.desktopAlerts';
const PROMPTED_KEY = 'aurixa.internalMessages.desktopAlertsPrompted';

export type DesktopAlertStatus = 'unsupported' | 'default' | 'denied' | 'granted';

export function getDesktopAlertStatus(): DesktopAlertStatus {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as DesktopAlertStatus;
}

/** User-level opt-out (defaults to enabled once permission is granted). */
export function desktopAlertsEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setDesktopAlertsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(PREF_KEY, enabled ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

export function hasPromptedDesktopAlerts(): boolean {
  try {
    return localStorage.getItem(PROMPTED_KEY) === '1';
  } catch {
    return true;
  }
}

export function markPromptedDesktopAlerts() {
  try {
    localStorage.setItem(PROMPTED_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** Ask the browser for permission. Must be called from a user gesture. */
export async function requestDesktopAlertPermission(): Promise<DesktopAlertStatus> {
  if (getDesktopAlertStatus() === 'unsupported') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission as DesktopAlertStatus;
  try {
    const result = await Notification.requestPermission();
    return result as DesktopAlertStatus;
  } catch {
    return 'denied';
  }
}

/* ------------------------------------------------------------------ sound */

let audioCtx: AudioContext | null = null;

/** Two-tone synthesised ping — no asset download, no autoplay video surface. */
export function playMessagePing() {
  try {
    const Ctx =
      (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx ?? new Ctx();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const now = audioCtx.currentTime;
    [
      { f: 880, t: 0 },
      { f: 1174, t: 0.12 },
    ].forEach(({ f, t }) => {
      const osc = audioCtx!.createOscillator();
      const gain = audioCtx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.09, now + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.22);
      osc.connect(gain).connect(audioCtx!.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.25);
    });
  } catch {
    /* audio is a nice-to-have */
  }
}

/* ------------------------------------------------------- tab title badge */

let baseTitle: string | null = null;
let flashTimer: ReturnType<typeof setInterval> | null = null;
let flashOn = false;

function stopFlashing() {
  if (flashTimer) {
    clearInterval(flashTimer);
    flashTimer = null;
  }
  if (baseTitle !== null) document.title = baseTitle;
  flashOn = false;
}

/**
 * Reflect the pending unread count in the tab title, alternating with a
 * "New message" flash so a background tab is noticeable in the tab strip.
 */
export function setTabUnreadBadge(count: number, label?: string) {
  if (typeof document === 'undefined') return;
  if (baseTitle === null) baseTitle = document.title;

  if (count <= 0) {
    stopFlashing();
    return;
  }

  const badge = `(${count > 99 ? '99+' : count})`;
  const alt = `${badge} ${label ? `${label} sent a message` : 'New team message'}`;
  const primary = `${badge} ${baseTitle}`;

  document.title = primary;
  if (flashTimer) return;
  flashTimer = setInterval(() => {
    flashOn = !flashOn;
    document.title = flashOn ? alt : primary;
  }, 1600);
}

export function clearTabUnreadBadge() {
  stopFlashing();
}

/* ------------------------------------------------- native OS notification */

const live = new Map<string, Notification>();

export interface DesktopMessageAlert {
  thread_id: string;
  /** Conversation label — person, group or announcement title. */
  title: string;
  /** Who sent it. */
  sender: string;
  /** Plain-text preview (already server-verified). */
  body: string;
  kind?: 'direct' | 'group' | 'broadcast';
  priority?: 'normal' | 'high' | 'urgent';
  hasAttachments?: boolean;
}

/**
 * Fire an OS-level notification for an inbound message. Safe to call always:
 * it self-suppresses when the tab is focused, permission is missing, or the
 * user has opted out.
 */
export function showDesktopMessageAlert(alert: DesktopMessageAlert): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted' || !desktopAlertsEnabled()) return false;
  // Focused tab already shows the chip/pop-up — don't double-notify.
  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus())
    return false;

  const prefix =
    alert.priority === 'urgent' ? '🔴 Urgent · ' : alert.priority === 'high' ? '🟡 ' : '';
  const heading =
    alert.kind === 'broadcast'
      ? `${prefix}Announcement · ${alert.title}`
      : alert.kind === 'group'
        ? `${prefix}${alert.sender} in ${alert.title}`
        : `${prefix}${alert.sender || alert.title}`;

  const body =
    (alert.body?.trim() || (alert.hasAttachments ? 'Sent an attachment' : 'New message')).slice(
      0,
      180,
    ) + (alert.hasAttachments && alert.body?.trim() ? ' · 📎 attachment' : '');

  try {
    const existing = live.get(alert.thread_id);
    existing?.close();

    const n = new Notification(heading, {
      body,
      // One notification per conversation: later messages replace the earlier
      // OS bubble instead of stacking a wall of alerts.
      tag: `aurixa-internal-${alert.thread_id}`,
      renotify: true,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      requireInteraction: alert.priority === 'urgent',
      silent: false,
    } as NotificationOptions);

    live.set(alert.thread_id, n);

    n.onclick = () => {
      try {
        window.focus();
        window.parent?.focus?.();
      } catch {
        /* ignore cross-origin focus refusal */
      }
      requestPopOutInternalThread({
        thread_id: alert.thread_id,
        kind: alert.kind,
        title: alert.title,
      });
      n.close();
      live.delete(alert.thread_id);
    };
    n.onclose = () => live.delete(alert.thread_id);
    return true;
  } catch {
    return false;
  }
}

/** Close any OS bubble still showing for a conversation the user just opened. */
export function dismissDesktopMessageAlert(threadId: string) {
  const n = live.get(threadId);
  if (n) {
    try {
      n.close();
    } catch {
      /* ignore */
    }
    live.delete(threadId);
  }
}
