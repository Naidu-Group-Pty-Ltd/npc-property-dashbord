import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { invokeSecureFunction, hasActiveSession, isAuthExhausted } from '@/lib/secureInvoke';
import { useAuth } from '@/hooks/useAuth';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { useGenerationHistory } from '@/hooks/useGenerationHistory';
import {
  GenerationProgressHeader,
  GenerationProgressItem,
  GenerationProgressPill,
  GenerationHistoryList,
  BulkJobGroup,
  groupReportsByBulkJob,
  type AggregateCounts,
  type AutoContinueSettings,
  type ReportProgress,
} from './progress/parts';
import { sectionCountForTier } from '@/lib/reports/compassSectionRegistry';

/* ---------- Settings persistence ---------- */

interface RetryState {
  [reportId: string]: {
    attempts: number;
    lastAttempt: number;
    scheduledRetry?: NodeJS.Timeout;
  };
}

type Corner = 'br' | 'bl' | 'tr' | 'tl';
const POSITION_KEY = 'report-progress-position-v1';
const COLLAPSED_KEY = 'report-progress-collapsed-v1';
const DRAWER_SNAP_POINTS: (string | number)[] = [0.45, 0.92];

function getAutoContinueSettings(): AutoContinueSettings {
  try {
    const saved = localStorage.getItem('dashboard-settings');
    if (saved) {
      const parsed = JSON.parse(saved);
      return {
        enabled: parsed.autoContinueReports ?? true,
        maxRetries: parsed.autoContinueMaxRetries ?? 3,
        delaySeconds: parsed.autoContinueDelaySeconds ?? 15,
      };
    }
  } catch (e) {
    console.error('Failed to parse auto-continue settings:', e);
  }
  return { enabled: true, maxRetries: 3, delaySeconds: 15 };
}

function saveAutoContinueSettings(next: AutoContinueSettings) {
  try {
    const saved = localStorage.getItem('dashboard-settings');
    const parsed = saved ? JSON.parse(saved) : {};
    parsed.autoContinueReports = next.enabled;
    parsed.autoContinueMaxRetries = next.maxRetries;
    parsed.autoContinueDelaySeconds = next.delaySeconds;
    localStorage.setItem('dashboard-settings', JSON.stringify(parsed));
  } catch (e) {
    console.error('Failed to save auto-continue settings:', e);
  }
}

function getCorner(): Corner {
  const v = localStorage.getItem(POSITION_KEY) as Corner | null;
  return v && ['br', 'bl', 'tr', 'tl'].includes(v) ? v : 'br';
}
function getCollapsed(): boolean {
  return localStorage.getItem(COLLAPSED_KEY) === '1';
}

/* ---------- Public component ---------- */

export function ReportGenerationProgress() {
  const location = useLocation();
  const { user, loading } = useAuth();
  const isPortalRoute =
    location.pathname.startsWith('/client') ||
    location.pathname.startsWith('/portal') ||
    location.pathname.startsWith('/finance');

  if (isPortalRoute) return null;
  if (loading || !user) return null;

  return <ReportGenerationProgressInner />;
}

function ReportGenerationProgressInner() {
  const location = useLocation();
  const isGeneratedReportsRoute = location.pathname === '/generated-reports';
  const { user } = useAuth();
  const currentUserLabel = user?.username || 'unknown user';
  const [reports, setReports] = useState<ReportProgress[]>([]);
  const [isMinimized, setIsMinimized] = useState<boolean>(getCollapsed);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [corner, setCorner] = useState<Corner>(getCorner);
  const [drawerSnap, setDrawerSnap] = useState<number | string | null>(0.45);
  const [autoContinueSettings, setAutoContinueSettings] =
    useState<AutoContinueSettings>(getAutoContinueSettings);

  const retryStateRef = useRef<RetryState>({});
  const autoRetryInProgressRef = useRef<Set<string>>(new Set());
  const isMobile = useIsMobile();
  const { entries: history, addEntry: addHistory, clear: clearHistory } = useGenerationHistory();

  /* Track section completion timestamps per report (for ETA + sparkline) */
  const sectionTimelineRef = useRef<Map<string, number[]>>(new Map());
  const lastSectionsRef = useRef<Map<string, number>>(new Map());
  const previousReportIdsRef = useRef<Set<string>>(new Set());
  const prevReportsRef = useRef<ReportProgress[]>([]);
  /* IDs cancelled by the user — skip finalizeJob to avoid overwriting the 'cancelled' history entry */
  const cancelledIdsRef = useRef<Set<string>>(new Set());
  /* IDs the user dismissed locally — hide from the active list even while the
     server-side job continues. Persisted so a reload/re-poll doesn't resurrect them. */
  const DISMISSED_KEY = 'report-dismissed-ids';
  const dismissedIdsRef = useRef<Set<string>>(
    (() => {
      try {
        const raw = localStorage.getItem(DISMISSED_KEY);
        return new Set<string>(raw ? JSON.parse(raw) : []);
      } catch {
        return new Set<string>();
      }
    })(),
  );
  const persistDismissed = () => {
    try {
      localStorage.setItem(
        DISMISSED_KEY,
        JSON.stringify(Array.from(dismissedIdsRef.current)),
      );
    } catch {}
  };

  /* Persist collapsed + corner */
  useEffect(() => {
    localStorage.setItem(COLLAPSED_KEY, isMinimized ? '1' : '0');
  }, [isMinimized]);
  useEffect(() => {
    if (!isGeneratedReportsRoute) {
      localStorage.setItem(POSITION_KEY, corner);
    }
  }, [corner, isGeneratedReportsRoute]);

  /* Sync auto-continue settings (cross-tab + periodic).
     IMPORTANT: only update state when values actually change, otherwise the
     new object identity invalidates downstream useCallbacks every 5s and the
     polling effect's cleanup cancels every scheduled auto-retry before its
     timer can fire. */
  useEffect(() => {
    const refresh = () => {
      const next = getAutoContinueSettings();
      setAutoContinueSettings((prev) =>
        prev.enabled === next.enabled &&
        prev.maxRetries === next.maxRetries &&
        prev.delaySeconds === next.delaySeconds
          ? prev
          : next
      );
    };
    const interval = setInterval(refresh, 5000);
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'dashboard-settings') refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  /* Load retry state on mount */
  useEffect(() => {
    try {
      const saved = localStorage.getItem('report-retry-state');
      if (saved) {
        const parsed = JSON.parse(saved);
        Object.keys(parsed).forEach((id) => {
          retryStateRef.current[id] = {
            attempts: parsed[id].attempts || 0,
            lastAttempt: parsed[id].lastAttempt || 0,
          };
        });
      }
    } catch (e) {
      console.error('Failed to load retry state:', e);
    }
  }, []);

  const saveRetryState = useCallback(() => {
    try {
      const toSave: Record<string, { attempts: number; lastAttempt: number }> = {};
      Object.entries(retryStateRef.current).forEach(([id, state]) => {
        toSave[id] = { attempts: state.attempts, lastAttempt: state.lastAttempt };
      });
      localStorage.setItem('report-retry-state', JSON.stringify(toSave));
    } catch (e) {
      console.error('Failed to save retry state:', e);
    }
  }, []);

  const handleContinueGeneration = useCallback(
    async (reportId: string, isAutoRetry = false) => {
      try {
        if (isAutoRetry && autoRetryInProgressRef.current.has(reportId)) return;
        if (isAutoRetry) autoRetryInProgressRef.current.add(reportId);

        setReports((prev) =>
          prev.map((r) =>
            r.id === reportId
              ? { ...r, status: 'processing', error_message: null, lastUpdated: new Date() }
              : r
          )
        );

        await invokeSecureFunction('manage-investment-reports', {
          action: 'update',
          reportId,
          data: {
            status: 'processing',
            error_message: null,
            updated_at: new Date().toISOString(),
          },
        });

        // Drive sections in a continuous loop instead of one-shot. The edge
        // function returns `{ success, isComplete }` after each single-section
        // call; we keep firing until complete, with bounded per-section
        // retries on transient errors. This is what makes auto-resume actually
        // converge instead of waiting 120s between each section.
        const MAX_SECTION_CALLS = 60; // hard upper bound
        const MAX_TRANSIENT_RETRIES = 4;
        let consecutiveTransientErrors = 0;
        let done = false;

        for (let call = 0; call < MAX_SECTION_CALLS && !done; call++) {
          if (paused) break;
          const { data, error } = await invokeSecureFunction(
            'generate-investment-report',
            { reportId, continueFrom: true, singleSection: true },
            { timeoutMs: 180000 }
          );

          if (error) {
            const msg = String(error.message || '');
            const isTransient =
              msg.includes('5') && (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504'))
              || msg.includes('Failed to fetch')
              || msg.includes('NetworkError')
              || msg.includes('timeout')
              || msg.includes('aborted');
            if (isTransient && consecutiveTransientErrors < MAX_TRANSIENT_RETRIES) {
              consecutiveTransientErrors++;
              const backoff = Math.min(15000, 1500 * 2 ** (consecutiveTransientErrors - 1));
              console.warn(
                `[ReportGenerationProgress] Transient section error (#${consecutiveTransientErrors}), retrying in ${backoff}ms`,
                msg
              );
              await new Promise((r) => setTimeout(r, backoff));
              continue;
            }
            console.error('Error invoking generation:', error);
            setReports((prev) =>
              prev.map((r) =>
                r.id === reportId
                  ? { ...r, status: 'pending', error_message: msg || 'Failed to resume generation' }
                  : r
              )
            );
            break;
          }

          consecutiveTransientErrors = 0;
          if (data?.isComplete === true || data?.success === false) {
            done = true;
            break;
          }
          // small jitter to avoid hammering
          await new Promise((r) => setTimeout(r, 250 + Math.random() * 250));
        }
      } catch (error) {
        console.error('Error continuing generation:', error);
      } finally {
        if (isAutoRetry) autoRetryInProgressRef.current.delete(reportId);
      }
    },
    [paused]
  );

  const scheduleAutoRetry = useCallback(
    (report: ReportProgress) => {
      const { id } = report;
      const settings = autoContinueSettings;
      if (!settings.enabled || paused) return;
      if (!retryStateRef.current[id]) {
        retryStateRef.current[id] = { attempts: 0, lastAttempt: 0 };
      }
      const state = retryStateRef.current[id];
      if (state.attempts >= settings.maxRetries) return;
      if (state.scheduledRetry) return;

      const timeSinceLastAttempt = Date.now() - state.lastAttempt;
      const delayMs = settings.delaySeconds * 1000;

      const scheduleIn = timeSinceLastAttempt < delayMs ? delayMs - timeSinceLastAttempt : delayMs;
      state.scheduledRetry = setTimeout(() => {
        delete state.scheduledRetry;
        state.attempts++;
        state.lastAttempt = Date.now();
        saveRetryState();
        handleContinueGeneration(id, true);
      }, scheduleIn);
    },
    [autoContinueSettings, handleContinueGeneration, saveRetryState, paused]
  );

  const cancelScheduledRetry = useCallback((reportId: string) => {
    const state = retryStateRef.current[reportId];
    if (state?.scheduledRetry) {
      clearTimeout(state.scheduledRetry);
      delete state.scheduledRetry;
    }
  }, []);

  const cleanupRetryState = useCallback(
    (activeReportIds: Set<string>) => {
      Object.keys(retryStateRef.current).forEach((id) => {
        if (!activeReportIds.has(id)) {
          cancelScheduledRetry(id);
          delete retryStateRef.current[id];
        }
      });
      saveRetryState();
    },
    [cancelScheduledRetry, saveRetryState]
  );

  /* Polling state */
  const authFailCountRef = useRef(0);
  const AUTH_FAIL_THRESHOLD = 3;
  const transientFailCountRef = useRef(0);
  const transientBackoffUntilRef = useRef(0);
  const visibleRef = useRef(typeof document !== 'undefined' ? !document.hidden : true);

  useEffect(() => {
    const onVis = () => {
      visibleRef.current = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const fetchActiveReports = useCallback(async () => {
    if (paused) return;
    if (!visibleRef.current) return;
    if (!hasActiveSession()) return;
    if (isAuthExhausted()) return;
    if (authFailCountRef.current >= AUTH_FAIL_THRESHOLD) return;
    if (Date.now() < transientBackoffUntilRef.current) return;

    const { data, error } = await invokeSecureFunction('get-investment-reports', {
      listMode: true,
      listOptions: {
        select:
          'id, property_address, status, report_content, error_message, updated_at, created_at, last_completed_section, bulk_job_id, report_tier, generation_engine, total_sections',
        filters: { status: ['pending', 'processing', 'failed'] },
        orderBy: 'updated_at',
        orderAsc: false,
        limit: 10,
      },
    });

    if (error) {
      const isAuthError =
        error.message === 'Authentication required' || error.message?.includes('401');
      if (isAuthError) {
        authFailCountRef.current += 1;
        if (authFailCountRef.current >= AUTH_FAIL_THRESHOLD) {
          console.warn(
            '[ReportGenerationProgress] Stopped polling after repeated auth failures.'
          );
        }
        return;
      }
      const msg = String(error.message || '');
      const isTransient =
        msg.includes('503') ||
        msg.includes('502') ||
        msg.includes('504') ||
        msg.includes('500') ||
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        msg.includes('temporarily unavailable');
      if (isTransient) {
        transientFailCountRef.current += 1;
        const backoffSeconds = Math.min(60, 5 * Math.pow(2, transientFailCountRef.current - 1));
        transientBackoffUntilRef.current = Date.now() + backoffSeconds * 1000;
        console.warn(
          `[ReportGenerationProgress] Transient error (attempt ${transientFailCountRef.current}). Backing off ${backoffSeconds}s.`,
          msg
        );
        return;
      }
      console.error('Error fetching active reports:', error);
      return;
    }

    authFailCountRef.current = 0;
    transientFailCountRef.current = 0;
    transientBackoffUntilRef.current = 0;

    const records = data?.reports || [];
    const now = Date.now();
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;

    const recentReports = records.filter((report: any) => {
      const createdAt = new Date(report.created_at).getTime();
      if (now - createdAt >= MAX_AGE_MS) return false;
      if (dismissedIdsRef.current.has(report.id)) return false;
      return true;
    });

    // Prune dismissed IDs no longer present server-side so the set doesn't
    // grow unbounded and a re-used ID (unlikely) can re-surface cleanly.
    if (dismissedIdsRef.current.size > 0) {
      const serverIds = new Set<string>(records.map((r: any) => r.id));
      let mutated = false;
      dismissedIdsRef.current.forEach((id) => {
        if (!serverIds.has(id)) {
          dismissedIdsRef.current.delete(id);
          mutated = true;
        }
      });
      if (mutated) persistDismissed();
    }

    const processedReports: ReportProgress[] = recentReports.map((report: any) => {
      const content = report.report_content || '';
      const sectionsCompleted = countSections(content);
      const dbSection = report.last_completed_section || 0;
      // Engine-aware total: prefer the actual chunk count persisted by the
      // edge function (`total_sections`), so legacy and Compass-40 reports
      // show the correct chunk count instead of always defaulting to 17.
      const engine: 'legacy' | 'compass-40' | null =
        report.generation_engine === 'compass-40' ? 'compass-40'
        : report.generation_engine === 'legacy' ? 'legacy'
        : null;
      const persistedTotal = Number(report.total_sections) || 0;
      const total = persistedTotal > 0 ? persistedTotal : sectionCountForTier(report.report_tier);
      return {
        id: report.id,
        property_address: report.property_address,
        status: report.status,
        sectionsCompleted: Math.max(sectionsCompleted, dbSection),
        totalSections: total,
        contentLength: content.length,
        error_message: report.error_message,
        lastUpdated: new Date(report.updated_at),
        lastCompletedSection: dbSection,
        createdAt: new Date(report.created_at),
        bulkJobId: report.bulk_job_id ?? null,
        generationEngine: engine,
      };
    });

    /* Track section-completion timestamps for ETA + sparkline */
    processedReports.forEach((r) => {
      const prevSections = lastSectionsRef.current.get(r.id) ?? 0;
      if (r.sectionsCompleted > prevSections) {
        const timeline = sectionTimelineRef.current.get(r.id) ?? [];
        const delta = r.sectionsCompleted - prevSections;
        for (let i = 0; i < delta; i++) timeline.push(now);
        sectionTimelineRef.current.set(r.id, timeline);
      }
    });

    /* Detect completed/failed jobs that disappeared from the active list -> push to history + toast */
    const currentIds = new Set(processedReports.map((r) => r.id));
    const previous = prevReportsRef.current;
    const previousIds = previousReportIdsRef.current;
    if (previousIds.size > 0) {
      previous.forEach((prev) => {
        if (!currentIds.has(prev.id)) {
          // Disappeared from active list — fetch final status to know completed vs failed
          finalizeJob(prev);
        }
      });
    }
    previousReportIdsRef.current = currentIds;
    prevReportsRef.current = processedReports;

    setReports(processedReports);
    cleanupRetryState(currentIds);

    processedReports.forEach((report) => {
      // Reset retry attempts whenever progress moves forward — we only want
      // the maxRetries cap to bite when a report is genuinely stuck, not
      // when a long generation is steadily completing sections.
      const prevSections = lastSectionsRef.current.get(report.id) ?? -1;
      if (prevSections >= 0 && report.sectionsCompleted > prevSections) {
        const rs = retryStateRef.current[report.id];
        if (rs && rs.attempts > 0) {
          rs.attempts = 0;
          saveRetryState();
        }
      }

      const timeSinceUpdate = now - report.lastUpdated.getTime();
      const isTimedOut = timeSinceUpdate > 75000; // 75s — react before a chunk fully times out
      const hasPartialContent = report.contentLength > 1000;
      const isIncomplete = report.sectionsCompleted < report.totalSections;
      const isStuck =
        report.status === 'processing' && isTimedOut && hasPartialContent && isIncomplete;

      const isInitiallyStuck =
        report.status === 'processing' &&
        timeSinceUpdate > 180000 &&
        report.contentLength < 100 &&
        report.sectionsCompleted === 0;

      // Failed/pending status with partial progress → resume immediately
      const hasFailedMidway =
        (report.status === 'failed' || report.status === 'pending') &&
        hasPartialContent &&
        isIncomplete;

      if ((isStuck || isInitiallyStuck || hasFailedMidway) && autoContinueSettings.enabled && !paused) {
        scheduleAutoRetry(report);
      }

      lastSectionsRef.current.set(report.id, report.sectionsCompleted);
    });
  }, [autoContinueSettings.enabled, cleanupRetryState, paused, saveRetryState, scheduleAutoRetry]);

  const finalizeJob = useCallback(
    async (prev: ReportProgress) => {
      try {
        if (cancelledIdsRef.current.has(prev.id)) {
          // User-cancelled jobs are already logged in history as 'cancelled'.
          cancelledIdsRef.current.delete(prev.id);
          return;
        }
        const { data } = await invokeSecureFunction('get-investment-reports', {
          reportId: prev.id,
          listOptions: { select: 'id, property_address, status, error_message, updated_at' },
        });
        const final = data?.report;
        if (!final) return;
        if (final.status === 'completed') {
          toast.success(`Report ready: ${final.property_address}`, {
            action: {
              label: 'Open',
              onClick: () => {
                window.location.href = `/investment-report/${final.id}`;
              },
            },
          });
          addHistory({
            id: final.id,
            property_address: final.property_address,
            status: 'completed',
            totalSections: prev.totalSections,
            sectionsCompleted: prev.totalSections,
            durationMs: Date.now() - prev.createdAt.getTime(),
            finishedAt: Date.now(),
          });
        } else if (final.status === 'failed') {
          toast.error(`Report failed: ${final.property_address}`);
          addHistory({
            id: final.id,
            property_address: final.property_address,
            status: 'failed',
            totalSections: prev.totalSections,
            sectionsCompleted: prev.sectionsCompleted,
            durationMs: Date.now() - prev.createdAt.getTime(),
            error_message: final.error_message,
            finishedAt: Date.now(),
          });
        }
      } catch (e) {
        console.error('Failed to finalize job:', e);
      } finally {
        sectionTimelineRef.current.delete(prev.id);
        lastSectionsRef.current.delete(prev.id);
      }
    },
    [addHistory]
  );

  useEffect(() => {
    if (hasActiveSession()) authFailCountRef.current = 0;
    fetchActiveReports();
    const interval = setInterval(fetchActiveReports, 3000);
    return () => {
      clearInterval(interval);
      // NOTE: do NOT cancel scheduled retries here. This effect re-runs
      // whenever fetchActiveReports identity changes (e.g. settings refresh),
      // and cancelling pending timers on every re-run would prevent the
      // 15s auto-retry from ever firing for stuck reports.
    };
  }, [fetchActiveReports]);

  /* True unmount cleanup: cancel any pending auto-retry timers exactly once. */
  useEffect(() => {
    return () => {
      Object.keys(retryStateRef.current).forEach((id) => {
        const s = retryStateRef.current[id];
        if (s?.scheduledRetry) {
          clearTimeout(s.scheduledRetry);
          delete s.scheduledRetry;
        }
      });
    };
  }, []);

  /* ⌘⇧R toggles minimised */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
        // Avoid hijacking page-reload only when no reports exist
        if (reports.length === 0 && !historyOpen) return;
        e.preventDefault();
        setIsMinimized((m) => !m);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reports.length, historyOpen]);

  const handleManualContinue = (reportId: string) => {
    if (retryStateRef.current[reportId]) {
      retryStateRef.current[reportId].attempts = 0;
      saveRetryState();
    }
    cancelScheduledRetry(reportId);
    handleContinueGeneration(reportId, false);
  };

  const dismissReport = (reportId: string) => {
    const r = reports.find((x) => x.id === reportId);
    if (r) {
      addHistory({
        id: r.id,
        property_address: r.property_address,
        status: 'dismissed',
        totalSections: r.totalSections,
        sectionsCompleted: r.sectionsCompleted,
        durationMs: Date.now() - r.createdAt.getTime(),
        error_message: r.error_message,
        finishedAt: Date.now(),
      });
    }
    cancelScheduledRetry(reportId);
    dismissedIdsRef.current.add(reportId);
    persistDismissed();
    // Prevent the next poll from re-adding this row via prevReportsRef diffing
    // and stop finalizeJob from firing a completed/failed toast for a row the
    // user explicitly hid.
    previousReportIdsRef.current.delete(reportId);
    prevReportsRef.current = prevReportsRef.current.filter((x) => x.id !== reportId);
    setReports((prev) => prev.filter((x) => x.id !== reportId));
  };

  const killReport = useCallback(
    async (reportId: string) => {
      const r = reports.find((x) => x.id === reportId);
      cancelScheduledRetry(reportId);
      cancelledIdsRef.current.add(reportId);
      // Reflect the cancellation in the active list immediately so the user
      // sees the status flip before the next polling cycle removes the row.
      setReports((prev) =>
        prev.map((x) =>
          x.id === reportId
            ? {
                ...x,
                status: 'failed',
                error_message: `Cancelled by ${currentUserLabel}`,
                lastUpdated: new Date(),
              }
            : x,
        ),
      );
      try {
        const { error } = await invokeSecureFunction('manage-investment-reports', {
          action: 'update',
          reportId,
          data: {
            status: 'failed',
            error_message: `Cancelled by ${currentUserLabel}`,
            updated_at: new Date().toISOString(),
          },
        });
        if (error) {
          toast.error(`Failed to stop generation: ${error.message || 'Unknown error'}`);
          return;
        }
        toast.success(
          r ? `Stopped "${r.property_address}" — marked as failed` : 'Generation stopped',
        );
        if (r) {
          addHistory({
            id: r.id,
            property_address: r.property_address,
            status: 'cancelled',
            totalSections: r.totalSections,
            sectionsCompleted: r.sectionsCompleted,
            durationMs: Date.now() - r.createdAt.getTime(),
            error_message: `Cancelled by ${currentUserLabel}`,
            finishedAt: Date.now(),
            cancelledBy: currentUserLabel,
          });
        }
      } catch (e: any) {
        toast.error(`Failed to stop generation: ${e?.message || 'Unknown error'}`);
      }
    },
    [reports, cancelScheduledRetry, addHistory, currentUserLabel],
  );

  const killReports = useCallback(
    (ids: string[]) => {
      ids.forEach((id) => killReport(id));
      if (ids.length > 1) {
        toast.success(`Stopping ${ids.length} reports…`);
      }
    },
    [killReport],
  );

  const handleResumeAllStalled = () => {
    reports.forEach((r) => {
      const timeSinceUpdate = Date.now() - r.lastUpdated.getTime();
      const isTimedOut = timeSinceUpdate > 120000;
      const isStuck = r.status === 'processing' && isTimedOut && r.sectionsCompleted < r.totalSections;
      if (isStuck) handleManualContinue(r.id);
    });
  };

  /* Aggregate counts */
  const counts: AggregateCounts = useMemo(() => {
    let queued = 0;
    let processing = 0;
    let stalled = 0;
    let failed = 0;
    let completedSections = 0;
    let totalSections = 0;
    const now = Date.now();
    reports.forEach((r) => {
      completedSections += r.sectionsCompleted;
      totalSections += r.totalSections;
      const since = now - r.lastUpdated.getTime();
      const isStuck =
        r.status === 'processing' &&
        since > 120000 &&
        r.sectionsCompleted < r.totalSections;
      if (r.status === 'failed') failed++;
      else if (isStuck) stalled++;
      else if (r.status === 'pending') queued++;
      else if (r.status === 'processing') processing++;
    });
    return {
      queued,
      processing,
      stalled,
      failed,
      total: reports.length,
      completedSections,
      totalSections,
    };
  }, [reports]);

  /* ETA calculation per report */
  const etaForReport = useCallback((r: ReportProgress): number | null => {
    const timeline = sectionTimelineRef.current.get(r.id) ?? [];
    if (timeline.length < 2) {
      // Fallback: use elapsed time / sections done if at least 1 section done
      if (r.sectionsCompleted > 0) {
        const elapsed = Date.now() - r.createdAt.getTime();
        const avg = elapsed / r.sectionsCompleted;
        const remaining = r.totalSections - r.sectionsCompleted;
        return avg * remaining;
      }
      return null;
    }
    const total = timeline[timeline.length - 1] - timeline[0];
    const avg = total / Math.max(1, timeline.length - 1);
    const remaining = r.totalSections - r.sectionsCompleted;
    return avg * remaining;
  }, []);

  const aggregateEta = useMemo(() => {
    const etas = reports.map(etaForReport).filter((v): v is number => v !== null);
    if (etas.length === 0) return null;
    return Math.max(...etas);
  }, [reports, etaForReport]);

  /* Group reports by bulk_job_id */
  const { groups: bulkGroups, loose: looseReports } = useMemo(
    () => groupReportsByBulkJob(reports),
    [reports],
  );

  const renderItem = (report: ReportProgress, mobile: boolean) => (
    <GenerationProgressItem
      key={report.id}
      report={report}
      etaMs={etaForReport(report)}
      retryState={retryStateRef.current[report.id]}
      autoContinueSettings={autoContinueSettings}
      sectionTimeline={sectionTimelineRef.current.get(report.id) ?? []}
      onContinue={() => handleManualContinue(report.id)}
      onDismiss={() => dismissReport(report.id)}
      onKill={() => killReport(report.id)}
      isMobile={mobile}
    />
  );

  const renderReportList = (mobile: boolean) => (
    <>
      {bulkGroups.map((g) => (
        <BulkJobGroup
          key={g.jobId}
          group={g}
          etaForReport={etaForReport}
          onRetryAllFailed={(ids) => ids.forEach((id) => handleManualContinue(id))}
          onKillAll={(ids) => killReports(ids)}
        >
          {g.reports.map((r) => renderItem(r, mobile))}
        </BulkJobGroup>
      ))}
      {looseReports.map((r) => renderItem(r, mobile))}
    </>
  );

  /* Drag-to-reposition (desktop) */
  const onDragStart = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) < 80 && Math.abs(dy) < 80) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const left = ev.clientX < w / 2;
      const top = ev.clientY < h / 2;
      const next: Corner = `${top ? 't' : 'b'}${left ? 'l' : 'r'}` as Corner;
      setCorner(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  /* Visibility logic — hide entirely when nothing to show */
  const hasAnything = reports.length > 0 || historyOpen;
  if (!hasAnything) return null;

  const cornerClass = (() => {
    if (isGeneratedReportsRoute) {
      return isMobile ? 'bottom-44 right-4' : 'bottom-24 right-6';
    }

    switch (corner) {
      case 'bl':
        return isMobile ? 'bottom-44 left-4' : 'bottom-24 left-6';
      case 'tr':
        return isMobile ? 'top-20 right-4' : 'top-20 right-6';
      case 'tl':
        return isMobile ? 'top-20 left-4' : 'top-20 left-6';
      case 'br':
      default:
        return isMobile ? 'bottom-44 right-4' : 'bottom-24 right-6';
    }
  })();

  /* Live region for screen readers */
  const liveText = (() => {
    if (counts.total === 0) return '';
    if (counts.failed > 0) return `${counts.failed} report generations failed.`;
    if (counts.processing > 0)
      return `Generating ${counts.processing} report${counts.processing === 1 ? '' : 's'}.`;
    return '';
  })();

  /* Mobile uses a Vaul drawer when expanded */
  if (isMobile) {
    return (
      <TooltipProvider delayDuration={200}>
        <span aria-live="polite" className="sr-only">
          {liveText}
        </span>
        <div className={cn('fixed z-50 transition-all duration-300', cornerClass)}>
          <GenerationProgressPill
            counts={counts}
            etaMs={aggregateEta}
            onClick={() => setIsMinimized(false)}
          />
        </div>
        <Drawer
          open={!isMinimized}
          onOpenChange={(o) => setIsMinimized(!o)}
          snapPoints={DRAWER_SNAP_POINTS}
          activeSnapPoint={drawerSnap}
          setActiveSnapPoint={(s) => setDrawerSnap((s as number | string | null) ?? 0.45)}
          dismissible
        >
          <DrawerContent className="max-h-[92vh]">
            <DrawerHeader className="p-0">
              <DrawerTitle className="sr-only">Report generation progress</DrawerTitle>
              <GenerationProgressHeader
                counts={counts}
                paused={paused}
                autoContinueSettings={autoContinueSettings}
                onTogglePaused={() => setPaused((p) => !p)}
                onResumeAllStalled={handleResumeAllStalled}
                onClearCompleted={() => clearHistory()}
                onToggleHistory={() => setHistoryOpen((o) => !o)}
                historyOpen={historyOpen}
                onToggleAutoContinue={(enabled) => {
                  const next = { ...autoContinueSettings, enabled };
                  setAutoContinueSettings(next);
                  saveAutoContinueSettings(next);
                }}
                onChangeDelay={(s) => {
                  const next = { ...autoContinueSettings, delaySeconds: s };
                  setAutoContinueSettings(next);
                  saveAutoContinueSettings(next);
                }}
                onMinimize={() => setIsMinimized(true)}
              />
            </DrawerHeader>
            <ScrollArea
              className={cn(
                'transition-[max-height]',
                drawerSnap === 0.45 ? 'max-h-[35vh]' : 'max-h-[78vh]',
              )}
            >
              {historyOpen ? (
                <GenerationHistoryList entries={history} onClear={clearHistory} />
              ) : (
                renderReportList(true)
              )}
            </ScrollArea>
          </DrawerContent>
        </Drawer>
      </TooltipProvider>
    );
  }

  /* Desktop floating card */
  return (
    <TooltipProvider delayDuration={200}>
      <span aria-live="polite" className="sr-only">
        {liveText}
      </span>
      <div className={cn('fixed z-50 transition-all duration-300', cornerClass)}>
        {isMinimized ? (
          <GenerationProgressPill
            counts={counts}
            etaMs={aggregateEta}
            onClick={() => setIsMinimized(false)}
          />
        ) : (
          <div className="w-80 overflow-hidden rounded-xl border border-primary/40 bg-card/95 shadow-2xl shadow-primary/20 ring-1 ring-primary/20 backdrop-blur">
            <GenerationProgressHeader
              counts={counts}
              paused={paused}
              autoContinueSettings={autoContinueSettings}
              onTogglePaused={() => setPaused((p) => !p)}
              onResumeAllStalled={handleResumeAllStalled}
              onClearCompleted={() => clearHistory()}
              onToggleHistory={() => setHistoryOpen((o) => !o)}
              historyOpen={historyOpen}
              onToggleAutoContinue={(enabled) => {
                const next = { ...autoContinueSettings, enabled };
                setAutoContinueSettings(next);
                saveAutoContinueSettings(next);
              }}
              onChangeDelay={(s) => {
                const next = { ...autoContinueSettings, delaySeconds: s };
                setAutoContinueSettings(next);
                saveAutoContinueSettings(next);
              }}
              onMinimize={() => setIsMinimized(true)}
              onDragStart={isGeneratedReportsRoute ? undefined : onDragStart}
              draggable={!isGeneratedReportsRoute}
            />
            <div className="max-h-64 overflow-y-auto">
              {historyOpen ? (
                <GenerationHistoryList entries={history} onClear={clearHistory} />
              ) : reports.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No active generations.
                </div>
              ) : (
                renderReportList(false)
              )}
            </div>
            {paused && (
              <div className="px-3 py-1.5 text-[10px] text-warning bg-warning/10 border-t border-warning/20">
                Polling paused • new updates will not appear until you resume
              </div>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

/* ---------- Section detection (preserved from original) ---------- */

function countSections(content: string): number {
  let count = 0;
  if (/##?\s*Executive\s*Summary/i.test(content)) count++;
  if (/##?\s*Location\s*Overview/i.test(content)) count++;
  if (
    /##?\s*(Current\s*Market\s*Performance|Current\s*Economic\s*Context|Market\s*(&|and)\s*Economics?)/i.test(
      content
    )
  )
    count++;
  if (/##?\s*(Demographics?\s*(&|and)\s*Demand|Demand\s*Drivers)/i.test(content)) count++;
  if (/##?\s*(Schools?\s*(&|and)\s*Education|Healthcare\s*(&|and)\s*Shopping)/i.test(content))
    count++;
  if (/##?\s*(Recreational\s*Amenities|Transport\s*(&|and)\s*Accessibility)/i.test(content))
    count++;
  if (
    /##?\s*(Environmental\s*Risks?\s*(&|and)\s*Climate|Crime\s*(&|and)\s*Safety)/i.test(content)
  )
    count++;
  if (/##?\s*(Property-Level\s*Information|Zoning\s*(&|and)\s*Planning\s*Analysis)/i.test(content))
    count++;
  if (/##?\s*(Purchase\s*(&|and)\s*Ongoing\s*Costs|Rental\s*Assessment\s*(&|and)\s*Yield)/i.test(content))
    count++;
  if (/##?\s*(Loan\s*Structure\s*(&|and)\s*Repayment|Cashflow\s*Analysis)/i.test(content)) count++;
  if (/##?\s*(10-Year\s*Investment\s*Projections|SWOT\s*Analysis)/i.test(content)) count++;
  const hasRisks = /##?\s*(Top\s*3\s*Risks|Investment\s*Recommendations)/i.test(content);
  const hasConclusion = /##?\s*(Final\s*Conclusion|Data\s*Sources)/i.test(content);
  if (hasRisks && hasConclusion) count++;
  return count;
}
